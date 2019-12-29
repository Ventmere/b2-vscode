import { B2Entry, FileEntry, ControllerEntry } from "b2-sdk";
import * as path from "path";
import * as crypto from "crypto";
import * as _ from "lodash";
import { Uri, workspace, window, ProgressLocation } from "vscode";
import { TextEncoder } from "util";
import * as child_process from "child_process";
import { getFileChecksum, getControllerChecksum } from "./checksum";
import {
  createDirectoryIfNotExists,
  isFileNotFoundError,
  joinUriPath,
  stringifyJSONStable,
  isFileExistsError
} from "./utils";
import {
  B2ExtEntryState,
  LocalDataMap,
  getLocalHandleMapKey,
  B2ExtObjectType,
  LocalDataMapKey,
  B2ExtObjectRef
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

      // fix controller items without revision
      for (let c of controllerItems) {
        c.revision = c.revision || c.id;
      }

      const files = fileItems.filter(f => {
        const localRevision = state.getRevision(f.id);
        return !localRevision || localRevision !== f.revision;
      });
      const fileCount = files.length;

      const controllers = controllerItems.filter(f => {
        const localRevision = state.getRevision(f.id);
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
          const handle = file.handle!;
          switch (file.type) {
            case "huz": {
              localHandleMap[
                getLocalHandleMapKey(B2ExtObjectType.Component, file.handle!)
              ] = file.id!;
              await exportHuzFile(uris.component, handle, file);
              break;
            }
            case "less": {
              localHandleMap[
                getLocalHandleMapKey(B2ExtObjectType.Style, file.handle!)
              ] = file.id!;
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
          localRevisionsMap[c.id!] = c.revision || c.id!;
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
// - <handle>.huz: html source code
// - <handle>.less: less source code
// - <handle>.json: config (path, defualt params, controller binding...)
export async function exportHuzFile(uri: Uri, handle: string, file: FileEntry) {
  const base = path.join(uri.path, handle!);
  await createDirectoryIfNotExists(uri.with({ path: base }));
  const enc = new TextEncoder();
  await workspace.fs.writeFile(
    uri.with({
      path: path.join(base, `${handle}.component.huz`)
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
        } as LocalFileProps,
        null,
        "  "
      )
    )
  );
}

export interface LocalFileProps {
  path: string;
  controller_id?: string;
  override_params?: {
    [key: string]: string;
  };
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
          default_params: c.default_params,
          default_query: c.default_query,
          default_path: c.default_path,
          description: c.description,
          exported: c.exported,
          methods: c.methods,
          middleware: c.middleware
        } as LocalControllerProps,
        null,
        "  "
      )
    )
  );
}

interface LocalControllerProps {
  id?: string;
  default_path: string;
  description: string;
  exported: boolean;
  default_params?: {
    [key: string]: string;
  };
  default_query?: {
    [key: string]: string;
  };
  methods: string[];
  middleware?: string[];
}

export function isComponentFilename(handle: string, filename: string) {
  return [
    `${handle}.component.huz`,
    `${handle}.component.less`,
    `${handle}.component.json`
  ].includes(filename);
}

export function isControllerFilename(handle: string, filename: string) {
  return [`${handle}.controller.js`, `${handle}.controller.json`].includes(
    filename
  );
}

export function getLocalB2ObjectUri(
  state: B2ExtEntryState,
  type: B2ExtObjectType,
  handle: string
): Uri {
  const uris = state.subFolderUris;
  switch (type) {
    case B2ExtObjectType.Component:
      return uris.component.with({
        path: path.join(uris.component.path, handle)
      });
    case B2ExtObjectType.Style:
      return uris.component.with({
        path: path.join(uris.style.path, handle)
      });
    case B2ExtObjectType.Controller:
      return uris.controller.with({
        path: path.join(uris.controller.path, handle)
      });
  }
}

async function readTextFileOrCreateWithDefault(
  uri: Uri,
  defaultText: string | (() => string) = ""
): Promise<string> {
  try {
    const data = await workspace.fs.readFile(uri);
    return data.toString();
  } catch (e) {
    if (isFileNotFoundError(e)) {
      const enc = new TextEncoder();
      const text =
        typeof defaultText === "string" ? defaultText : defaultText();
      try {
        await workspace.fs.writeFile(uri, enc.encode(text));
      } catch (e) {
        if (!isFileExistsError(e)) {
          throw e;
        }
      }
      return text;
    } else {
      throw e;
    }
  }
}

async function readJsonOrCreateWithDefault<T>(uri: Uri, defaultValue: T) {
  const jsonText = await readTextFileOrCreateWithDefault(uri, () =>
    stringifyJSONStable(defaultValue)
  );
  try {
    const parsed = JSON.parse(jsonText);
    return parsed as T;
  } catch (e) {
    throw new Error(`Parse json '${uri.path}' error: ${e.message}`);
  }
}

export async function buildLocalB2Object(
  ref: B2ExtObjectRef
): Promise<FileEntry | ControllerEntry> {
  const { id, handle } = ref;
  switch (ref.type) {
    case B2ExtObjectType.Component: {
      const [html, less, json] = await Promise.all([
        readTextFileOrCreateWithDefault(
          joinUriPath(ref.uri, `${handle}.component.huz`)
        ),
        readTextFileOrCreateWithDefault(
          joinUriPath(ref.uri, `${handle}.component.less`)
        ),
        readJsonOrCreateWithDefault(
          joinUriPath(ref.uri, `${handle}.component.json`),
          {
            path: ""
          } as LocalFileProps
        )
      ]);
      const entry = {
        ...json,
        id,
        handle,
        type: "huz",
        content: html,
        children: [
          {
            handle: "less",
            type: "less",
            content: less
          }
        ]
      } as FileEntry;
      if (ref.revision) {
        entry.revision = ref.revision;
      }
      return entry;
    }
    case B2ExtObjectType.Style: {
      const less = await readTextFileOrCreateWithDefault(ref.uri);
      const entry = {
        id,
        handle,
        type: "less",
        content: less
      } as FileEntry;
      if (ref.revision) {
        entry.revision = ref.revision;
      }
      return entry;
    }
    case B2ExtObjectType.Controller: {
      const [js, json] = await Promise.all([
        readTextFileOrCreateWithDefault(
          joinUriPath(ref.uri, `${handle}.controller.js`)
        ),
        readJsonOrCreateWithDefault<LocalControllerProps>(
          joinUriPath(ref.uri, `${handle}.controller.json`),
          {
            id: id || undefined,
            default_path: "",
            description: "",
            exported: false,
            methods: ["GET"]
          }
        )
      ]);
      const entry = {
        ...json,
        id: id || undefined,
        handle,
        script: js
      } as ControllerEntry;
      if (ref.revision) {
        entry.revision = ref.revision;
      }
      return entry;
    }
  }
}
