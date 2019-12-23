import {
  Uri,
  window,
  WorkspaceFolder,
  ProgressLocation,
  FileSystemError,
  TextDocument,
  workspace,
  EventEmitter
} from "vscode";
import { B2, connect, B2Entry } from "b2-sdk";
import { loadConfigFile } from "./config";
import { BehaviorSubject, combineLatest } from "rxjs";
import { map, distinct } from "rxjs/operators";
import * as path from "path";
import { B2ExtEntryState, B2ExtObjectRef } from "./state";
import { isFileNotFoundError } from "./utils";
import * as _ from "lodash";
import * as lockfile from "proper-lockfile";

export class B2AppConfig {
  readonly pageModuleIds: string[];
  private idRefLookup = new Map<string, B2ExtEntryState>();
  private assetBaseUrlLookup = new Map<string, string>();

  constructor(app: B2, entries: B2ExtEntryState[]) {
    const pageModules = app.modules["page"];
    this.pageModuleIds = [];
    if (pageModules) {
      for (let { id, path } of pageModules) {
        const e = entries.find(e => e.entryLocalPath === path);
        if (id && e) {
          this.pageModuleIds.push(id);
          this.idRefLookup.set(id, e);
          console.log(`pageModule: id = ${id}, entry = ${e.entryLocalPath}`);
        }
      }
    }
    this.pageModuleIds.sort();

    const assetModules = app.modules["asset"];
    if (assetModules) {
      const base = assetModules.find(m => !m.path);
      for (let e of entries) {
        const override = assetModules.find(m => m.path === e.entryLocalPath);
        if (override) {
          this.assetBaseUrlLookup.set(
            e.entryLocalPath,
            override.metadata.endpoint
          );
        } else if (base) {
          this.assetBaseUrlLookup.set(e.entryLocalPath, base.metadata.endpoint);
        }
      }
    }
  }

  getEntryByPageModuleId(id: string) {
    return this.idRefLookup.get(id);
  }

  getAssetBaseUrlByEntryLocalPath(path: string) {
    return this.assetBaseUrlLookup.get(path);
  }
}

export interface B2ExtWorkspace {
  workspaceFolder: WorkspaceFolder;
  app: B2;
  appConfig: B2AppConfig;
  entries: B2ExtEntryState[];
}

export interface B2ExtDocInfo {
  workspace: B2ExtWorkspace;
  entry?: B2ExtEntryState;
  ref?: B2ExtObjectRef;
}

export class WorkspaceRegistry {
  private conns$ = new BehaviorSubject<B2ExtWorkspace[]>([]);
  private unlockMap = new Map<B2ExtWorkspace, () => void>();

  private _currentDocInfo = combineLatest(
    this.conns$,
    this.currentDocument$
  ).pipe(
    map(([conns, doc]) => {
      if (!doc && conns.length === 1) {
        const workspace = conns[0];
        return {
          workspace
        } as B2ExtDocInfo;
      }

      if (conns.length === 0 || !doc) {
        return null;
      }

      return findEntry(conns, doc.uri);
    }),
    distinct()
  );
  get currentDocInfo$() {
    return this._currentDocInfo;
  }

  findDocInfo(doc: TextDocument | Uri) {
    const conns = this.conns$.value;
    if (doc instanceof Uri) {
      return findEntry(conns, doc);
    } else {
      return findEntry(conns, doc.uri);
    }
  }

  getAllWorkspaces(): B2ExtWorkspace[] {
    return this.conns$.value;
  }

  onChange = new EventEmitter();

  constructor(private currentDocument$: BehaviorSubject<TextDocument | null>) {}

  async add(folders: readonly WorkspaceFolder[]) {
    const added = await Promise.all(folders.map(connectWorkspace));
    const connected = added.filter(v => v !== null) as Locked[];
    const next = [...this.conns$.value];
    for (let { workspace, unlock } of connected) {
      next.push(workspace);
      this.unlockMap.set(workspace, unlock);
    }
    this.conns$.next(next);
    this.onChange.fire();
  }

  async remove(folders: readonly WorkspaceFolder[]) {
    const current = this.conns$.value;
    const next = this.conns$.value.filter(c =>
      folders.every(f => {
        return f !== c.workspaceFolder;
      })
    );
    for (let key of _.difference(current, next)) {
      this.unlockMap.get(key)!();
      this.unlockMap.delete(key);
    }
    this.conns$.next(next);
    this.onChange.fire();
  }

  dispose() {
    for (let unlock of this.unlockMap.values()) {
      unlock();
    }
    this.unlockMap.clear();
  }
}

interface Locked {
  workspace: B2ExtWorkspace;
  unlock: () => void;
}

async function connectWorkspace(
  folder: WorkspaceFolder
): Promise<Locked | null> {
  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Initializing B2 workspace: ${folder.name}`,
      cancellable: false
    },
    async (_progress, _token) => {
      try {
        let unlock;
        try {
          unlock = lockfile.lockSync(folder.uri.fsPath);
        } catch (e) {
          throw new Error(`Unable to lock workspace: ${e.message}`);
        }

        const config = await loadConfigFile(folder.uri);
        const app = await connect(config);
        const states = await Promise.all(
          app.entries.map(async entry => {
            const r = app.entry(entry.name);
            if (r.file.isRef) {
              return null;
            }
            const state = new B2ExtEntryState(folder, app, r);
            try {
              await state.init();
              return state;
            } catch (e) {
              window.showErrorMessage(
                `${folder.name}: Can not initialize B2 entry '${entry.name}': ${e.message}`
              );
              console.error(e);
              return null;
            }
          })
        );

        const entries = states.filter(v => !!v) as B2ExtEntryState[];

        return {
          workspace: {
            workspaceFolder: folder,
            app,
            appConfig: new B2AppConfig(app, entries),
            entries
          },
          unlock
        };
      } catch (e) {
        if (isFileNotFoundError(e)) {
          return null;
        }

        window.showErrorMessage(
          `${folder.name}: Can not initialize B2 workspace: ${e.message}`
        );
        console.error(e);
        return null;
      }
    }
  );
}

function findEntry(conns: B2ExtWorkspace[], uri: Uri): B2ExtDocInfo | null {
  const workspaceFolder = workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return null;
  }

  const conn = conns.find(c => c.workspaceFolder === workspaceFolder);
  if (!conn) {
    return null;
  }

  const posixPath = uri.path
    .slice(workspaceFolder.uri.path.length)
    .split(path.sep)
    .join("/");
  const entry = conn.entries.find(e => posixPath.startsWith(e.entryLocalPath));
  if (!entry) {
    return {
      workspace: conn
    };
  }

  return {
    workspace: conn,
    entry,
    ref: entry.resolveRefByPath(
      posixPath.slice(entry.entryLocalPath.length + 1)
    )
  } as B2ExtDocInfo;
}
