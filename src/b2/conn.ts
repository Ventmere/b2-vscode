import {
  Uri,
  window,
  WorkspaceFolder,
  ProgressLocation,
  FileSystemError,
  TextDocument,
  workspace
} from "vscode";
import { B2, connect, B2Entry } from "b2-sdk";
import { loadConfigFile } from "./config";
import { BehaviorSubject, combineLatest } from "rxjs";
import { map, distinct } from "rxjs/operators";
import * as path from "path";

interface Conn {
  workspaceFolder: WorkspaceFolder;
  app?: B2;
}

export interface B2ExtWorkspace {
  app: B2;
  workspaceFolder: WorkspaceFolder;
}

export interface B2ExtCurrentEntry {
  app: B2;
  workspaceFolder: WorkspaceFolder;
  entryName: string | null;
  entry: B2Entry | null;
}

export class ConnRegistry {
  private conns$ = new BehaviorSubject<Conn[]>([]);

  private _currentEntry = combineLatest(
    this.conns$,
    this.currentDocument$
  ).pipe(
    map(([conns, doc]) => {
      if (!doc && conns.length === 1) {
        if (conns[0].app) {
          return {
            app: conns[0].app,
            entryName: null,
            entry: null,
            workspaceFolder: conns[0].workspaceFolder
          } as B2ExtCurrentEntry;
        }
      }

      if (conns.length === 0 || !doc) {
        return null;
      }

      return findEntry(conns, doc.uri);
    }),
    distinct()
  );
  get currentEntry$() {
    return this._currentEntry;
  }

  getAllWorkspaces(): B2ExtWorkspace[] {
    return this.conns$.value.reduce((apps, conn) => {
      if (conn.app) {
        apps.push({
          app: conn.app,
          workspaceFolder: conn.workspaceFolder
        });
      }
      return apps;
    }, [] as B2ExtWorkspace[]);
  }

  constructor(private currentDocument$: BehaviorSubject<TextDocument | null>) {}

  async add(folders: readonly WorkspaceFolder[]) {
    const added = await Promise.all(folders.map(connectFolder));
    this.conns$.next([...this.conns$.value, ...added]);
  }

  async remove(folders: readonly WorkspaceFolder[]) {
    this.conns$.next(
      this.conns$.value.filter(c =>
        folders.every(f => {
          return f !== c.workspaceFolder;
        })
      )
    );
  }
}

async function connectFolder(folder: WorkspaceFolder): Promise<Conn> {
  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Initializing B2 workspace: ${folder.name}`
    },
    async (_progress, _token) => {
      try {
        const config = await loadConfigFile(folder.uri);
        const app = await connect(config);
        console.log(`app: ${app.name}`);
        return {
          workspaceFolder: folder,
          app
        };
      } catch (e) {
        if (
          e instanceof FileSystemError &&
          e.name === "EntryNotFound (FileSystemError)"
        ) {
          return {
            workspaceFolder: folder
          };
        }

        window.showErrorMessage(
          `${folder.name}: Can not initialize B2 workspace: ${e.message}`
        );
        return {
          workspaceFolder: folder
        };
      }
    }
  );
}

function findEntry(conns: Conn[], uri: Uri): B2ExtCurrentEntry | null {
  const workspaceFolder = workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return null;
  }

  const conn = conns.find(c => c.workspaceFolder === workspaceFolder);
  if (!conn || !conn.app) {
    return null;
  }

  const posixPath = uri.path
    .slice(workspaceFolder.uri.path.length)
    .split(path.sep)
    .join("/");
  let entry;
  if (posixPath.startsWith("/__root")) {
    entry = conn.app.entries.find(e => e.path === "/");
  } else {
    entry = conn.app.entries.find(
      e => e.path !== "/" && posixPath.startsWith(e.path)
    );
  }

  return {
    app: conn.app,
    entryName: entry ? entry.name : null,
    entry: entry ? conn.app.entry(entry.name) : null,
    workspaceFolder: conn.workspaceFolder
  } as B2ExtCurrentEntry;
}
