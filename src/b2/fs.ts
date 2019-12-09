import { B2Entry, FileEntry, ControllerEntry } from "b2-sdk";
import * as path from "path";
import * as crypto from "crypto";
import * as _ from "lodash";
import { Uri, workspace, window, ProgressLocation } from "vscode";
import { TextEncoder } from "util";
import * as child_process from "child_process";
import { lstat } from "fs";
import { getFileChecksum, getControllerChecksum } from "./checksum";
import { createDirectoryIfNotExists } from "./utils";
import {
  B2ExtEntryState,
  LocalDataMap,
  getLocalHandleMapKey,
  B2ExtObjectType,
  LocalDataMapKey
} from "./state";

const CHUNK_SIZE = 100;

export interface LocalRevisionData {
  handle: string;
  revision: string;
}

export interface LocalRevisionMap {
  [key: string]: LocalRevisionData;
}

export interface LocalChecksumMap {
  [key: string]: string;
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

export async function exportFiles(state: B2ExtEntryState) {
  const { entry } = state;
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Pulling ${entry.name}`,
      cancellable: false
    },
    async (process, token) => {
      const uris = state.subFolderUris;

      const localRevisionsMap: LocalDataMap = {};
      const localChecksumMap: LocalDataMap = {};
      const localHandleMap: LocalDataMap = {};

      process.report({
        message: `Loading snapshots...`,
        increment: 0
      });
      const [fileItems, controllerItems] = await Promise.all([
        entry.file.getSnapshot(),
        entry.controller.getSnapshot()
      ]);

      const files = fileItems.filter(f => {
        const localRevision = state.getRevision(f.id);
        return !localRevision || localRevision !== f.revision;
      });
      const fileCount = files.length;

      const controllers = controllerItems.filter(f => {
        const localRevision = state.getRevision(f.id);
        if (!localRevision && !f.revision) {
          return false;
        }
        return !localRevision || localRevision !== f.revision;
      });
      const controllerCount = controllers.length;

      const fileChunks = _.chunk(files, CHUNK_SIZE);
      const controllerChunks = _.chunk(controllers, CHUNK_SIZE);
      const itemValue = 100.0 / (files.length + controllers.length);

      process.report({
        message: `Exporting ${fileCount} files...`,
        increment: 0
      });

      for (let i = 0; i < fileChunks.length; i++) {
        const chunk = fileChunks[i];
        const files = await entry.file.getSnapshotItems(chunk);
        for (let file of files) {
          localRevisionsMap[file.id!] = file.revision!;
          localChecksumMap[file.id!] = getFileChecksum(file);
          localHandleMap[
            getLocalHandleMapKey(B2ExtObjectType.File, file.handle!)
          ] = file.id!;
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
          message: `Exporting ${fileCount} files...`,
          increment: chunk.length * itemValue
        });
      }

      process.report({
        message: `Exporting ${controllerCount} controllers...`,
        increment: 0
      });

      for (let i = 0; i < controllerChunks.length; i++) {
        const chunk = controllerChunks[i];
        const controllers = await entry.controller.getSnapshotItems(chunk);
        for (let c of controllers) {
          const handle = c.handle!;
          localRevisionsMap[c.id!] = c.revision!;
          localChecksumMap[c.id!] = getControllerChecksum(c);
          localHandleMap[
            getLocalHandleMapKey(B2ExtObjectType.Controller, c.handle!)
          ] = c.id!;
          await exportController(uris.controller, handle, c);
        }
        process.report({
          message: `Exporting ${controllerCount} controllers...`,
          increment: chunk.length * itemValue
        });
      }

      process.report({
        message: `Saving metadata...`,
        increment: 0
      });
      await state.updateLocalMap(LocalDataMapKey.Revision, localRevisionsMap);
      await state.updateLocalMap(LocalDataMapKey.Checksum, localChecksumMap);
      await state.updateLocalMap(LocalDataMapKey.Handle, localHandleMap);
    }
  );
}

// for huz file, create a folder <handle>, then create files:
// - <handle>.html: html source code
// - <handle>.less: less source code
// - <handle>.json: config (path, defualt params, controller binding...)
async function exportHuzFile(uri: Uri, handle: string, file: FileEntry) {
  const base = path.join(uri.path, handle!);
  await createDirectoryIfNotExists(uri.with({ path: base }));
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
      path: path.join(uri.path, `${handle}`)
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
  await createDirectoryIfNotExists(uri.with({ path: base }));

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
          default_params: c.default_params,
          default_query: c.default_query,
          default_path: c.default_path,
          description: c.description,
          exported: c.exported,
          methods: c.methods,
          middleware: c.middleware
        },
        null,
        "  "
      )
    )
  );
}

export function isComponentFilename(handle: string, filename: string) {
  return [
    `${handle}.component.html`,
    `${handle}.component.less`,
    `${handle}.component.json`
  ].includes(filename);
}

export function isControllerFilename(handle: string, filename: string) {
  return [`${handle}.controller.less`, `${handle}.controller.json`].includes(
    filename
  );
}
