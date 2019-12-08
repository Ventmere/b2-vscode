import { B2Entry, FileEntry, ControllerEntry } from "b2-sdk";
import * as path from "path";
import * as crypto from "crypto";
import * as _ from "lodash";
import { Uri, workspace, window, ProgressLocation } from "vscode";
import { TextEncoder } from "util";
import * as child_process from "child_process";
import { lstat } from "fs";

const CHUNK_SIZE = 100;

export interface LocalRevisionData {
  handle: string;
  revision: string;
}

export interface LocalRevisionMap {
  [key: string]: LocalRevisionData;
}

async function loadLocalRevisions(uri: Uri): Promise<LocalRevisionMap | null> {
  try {
    const fileUri = uri.with({
      path: path.join(uri.path, ".revisions.json")
    });
    const content = await workspace.fs.readFile(fileUri);
    const map = JSON.parse(content.toString());
    if (map && typeof map === "object") {
      return map;
    } else {
      return null;
    }
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function saveLocalRevisions(uri: Uri, map: LocalRevisionMap) {
  const enc = new TextEncoder();
  const fileUri = uri.with({
    path: path.join(uri.path, ".revisions.json")
  });
  await workspace.fs.writeFile(fileUri, enc.encode(JSON.stringify(map)));
}

export async function hasUncommitedLocalChanges(uri: Uri) {
  return new Promise((res, rej) => {
    child_process.exec(
      "git status -s",
      {
        cwd: uri.fsPath
      },
      (err, o, e) => {
        if (err) {
          return rej(err);
        }

        if (o.length) {
          return res(true);
        }

        if (e.length) {
          return rej(new Error(e.toString()));
        }

        return res(false);
      }
    );
  });
}

export async function exportFiles(uri: Uri, entry: B2Entry) {
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Pulling ${entry.path}`,
      cancellable: false
    },
    async (process, token) => {
      const uris = await createFolders(uri, entry);

      const localMap = (await loadLocalRevisions(uris.local)) || {};

      process.report({
        message: `Loading snapshots...`,
        increment: 0
      });
      const [fileItems, controllerItems] = await Promise.all([
        entry.file.getSnapshot(),
        entry.controller.getSnapshot()
      ]);

      let files = fileItems.filter(f => {
        const m = localMap[f.id];
        return !m || m.revision !== f.revision;
      });

      let controllers = controllerItems.filter(f => {
        const m = localMap[f.id];
        return !m || m.revision !== f.revision;
      });

      const fileChunks = _.chunk(files, CHUNK_SIZE);
      const controllerChunks = _.chunk(controllers, CHUNK_SIZE);
      const itemValue = 100.0 / (files.length + controllers.length);

      process.report({
        message: `Exporting ${files.length} files...`,
        increment: 0
      });

      for (let i = 0; i < fileChunks.length; i++) {
        const chunk = fileChunks[i];
        const files = await entry.file.getSnapshotItems(chunk);
        for (let file of files) {
          localMap[file.id!] = {
            handle: file.handle!,
            revision: file.revision!
          };
          const handle = file.handle!;
          switch (file.type) {
            case "huz": {
              await exportHuzFile(uris.component, handle, file);
              break;
            }
            case "less": {
              await exportLessFile(uris.style, handle, file);
              break;
            }
            default: {
              throw new Error(`Unknown file type '${file.type}'`);
            }
          }
        }
        process.report({
          message: `Exporting ${files.length} files...`,
          increment: chunk.length * itemValue
        });
      }

      process.report({
        message: `Exporting ${controllers.length} controllers...`,
        increment: 0
      });

      for (let i = 0; i < controllerChunks.length; i++) {
        const chunk = controllerChunks[i];
        const controllers = await entry.controller.getSnapshotItems(chunk);
        for (let c of controllers) {
          const handle = c.handle!;
          localMap[c.id!] = {
            handle: c.handle!,
            revision: c.revision!
          };
          await exportController(uris.controller, handle, c);
        }
        process.report({
          message: `Exporting ${controllers.length} controllers...`,
          increment: chunk.length * itemValue
        });
      }

      await saveLocalRevisions(uris.local, localMap);
    }
  );
}

export async function createFolders(workspaceUri: Uri, entry: B2Entry) {
  const entryPath = entry.path === "/" ? "__root" : entry.path;
  const base = path.join(workspaceUri.path, entryPath);
  const toUri = (path: string) =>
    workspaceUri.with({
      path
    });
  const map = {
    component: toUri(path.join(base, "components")),
    controller: toUri(path.join(base, "controllers")),
    style: toUri(path.join(base, "styles")),
    local: toUri(path.join(base, ".local"))
  };

  for (let uri of Object.values(map)) {
    await workspace.fs.createDirectory(uri);
  }

  return map;
}

// for huz file, create a folder <handle>, then create files:
// - <handle>.html: html source code
// - <handle>.less: less source code
// - <handle>.json: config (path, defualt params, controller binding...)
async function exportHuzFile(uri: Uri, handle: string, file: FileEntry) {
  const base = path.join(uri.path, handle!);
  await workspace.fs.createDirectory(uri.with({ path: base }));
  const enc = new TextEncoder();
  await workspace.fs.writeFile(
    uri.with({
      path: path.join(base, `${handle}.component.html`)
    }),
    enc.encode(file.content)
  );

  const less = file.children!.find(c => c.type === "less");
  await workspace.fs.writeFile(
    uri.with({
      path: path.join(base, `${handle}.component.less`)
    }),
    enc.encode(less!.content || "")
  );

  await workspace.fs.writeFile(
    uri.with({
      path: path.join(base, `${handle}.component.json`)
    }),
    enc.encode(
      JSON.stringify(
        {
          path: file.path,
          controller_id: file.controller_id,
          override_params: file.override_params
        },
        null,
        "  "
      )
    )
  );
}

export async function exportLessFile(
  uri: Uri,
  handle: string,
  file: FileEntry
) {
  const enc = new TextEncoder();
  await workspace.fs.writeFile(
    uri.with({
      path: path.join(uri.path, `${handle}.less`)
    }),
    enc.encode(file.content || "")
  );
}

export async function exportController(
  uri: Uri,
  handle: string,
  c: ControllerEntry
) {
  const enc = new TextEncoder();

  const base = path.join(uri.path, handle);
  await workspace.fs.createDirectory(uri.with({ path: base }));

  await workspace.fs.writeFile(
    uri.with({
      path: path.join(base, `${handle}.controller.js`)
    }),
    enc.encode(c.script || "")
  );

  await workspace.fs.writeFile(
    uri.with({
      path: path.join(base, `${handle}.controller.json`)
    }),
    enc.encode(
      JSON.stringify(
        {
          id: c.id,
          default_path: c.default_path,
          exported: c.exported,
          middleware: c.middleware
        },
        null,
        "  "
      )
    )
  );
}
