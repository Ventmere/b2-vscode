import { Mutex } from "async-mutex";
import { Uri, WorkspaceFolder } from "vscode";
import { B2, B2Entry } from "b2-sdk";
import * as path from "path";
import * as vscode from "vscode";
import { TextEncoder } from "util";
import { isFileNotFoundError, createDirectoryIfNotExists } from "./utils";
import { isComponentFilename } from "./fs";
import stringify = require("json-stable-stringify");
import * as _ from "lodash";

export class B2ExtEntryState {
  private mutex: Mutex = new Mutex();
  private localMaps: Map<LocalDataMapKey, LocalDataMap> = new Map();
  private entryFolderUri: Uri;
  private _subFolderUris?: {
    component: Uri;
    controller: Uri;
    style: Uri;
    local: Uri;
  };
  get subFolderUris() {
    if (!this._subFolderUris) {
      throw new Error(`not inited`);
    }
    return this._subFolderUris;
  }
  readonly entryLocalPath: string;

  constructor(
    readonly workspaceFolder: WorkspaceFolder,
    readonly app: B2,
    readonly entry: B2Entry
  ) {
    const entryPath = entry.path === "/" ? "__root" : entry.path;
    this.entryLocalPath = entryPath;
    this.entryFolderUri = workspaceFolder.uri.with({
      path: path.join(workspaceFolder.uri.path, ...entryPath.split("/"))
    });
  }

  get name() {
    return this.entry.name;
  }

  async init() {
    this._subFolderUris = await this.initFolders();
    const maps = await Promise.all(
      Object.values(LocalDataMapKey).map(key => {
        return this.loadLocalJSON<LocalDataMap>(key).then(
          map => [key, map || {}] as [LocalDataMapKey, LocalDataMap]
        );
      })
    );
    this.localMaps = new Map(maps);
  }

  async updateLocalMap(
    key: LocalDataMapKey,
    map: LocalDataMap,
    replace: boolean = false
  ) {
    if (_.isEmpty(map) && !replace) {
      return;
    }

    const release = await this.mutex.acquire();
    try {
      if (replace) {
        this.localMaps.set(key, map);
      } else {
        const current = this.localMaps.get(key) || {};
        const entries = Object.entries(map);
        for (let [k, v] of entries) {
          current[k] = v;
        }
        map = current;
      }
      await this.saveLocalJSON(key, map);
    } catch (e) {
      throw e;
    } finally {
      release();
    }
  }

  resolveRef(entryPath: string): B2ExtObjectRef | null {
    const parts = entryPath.split(path.sep);
    if (!entryPath.length) {
      return null;
    }
    if (entryPath.length === 1) {
      return null;
    } else {
      const [folder, ...rest] = parts;
      switch (folder) {
        case "components": {
          if (rest.length === 2) {
            const [handle, filename] = rest;
            if (isComponentFilename(handle, filename)) {
              const id = this.getHandleId(B2ExtObjectType.File, handle);
              return {
                type: B2ExtObjectType.File,
                id,
                handle,
                revision: id ? this.getRevision(id) : null,
                checksum: id ? this.getChecksum(id) : null
              } as B2ExtObjectRef;
            }
          }
        }
        case "controllers": {
          if (rest.length === 2) {
            const [handle, filename] = rest;
            if (isComponentFilename(handle, filename)) {
              const id = this.getHandleId(B2ExtObjectType.Controller, handle);
              return {
                type: B2ExtObjectType.Controller,
                id,
                handle,
                revision: id ? this.getRevision(id) : null,
                checksum: id ? this.getChecksum(id) : null
              } as B2ExtObjectRef;
            }
          }
        }
        case "styles": {
          if (rest.length === 1) {
            const handle = rest[0];
            const id = this.getHandleId(B2ExtObjectType.File, handle);
            return {
              type: B2ExtObjectType.File,
              id,
              handle,
              revision: id ? this.getRevision(id) : null,
              checksum: id ? this.getChecksum(id) : null
            } as B2ExtObjectRef;
          }
        }
      }
      return null;
    }
  }

  getHandleId(type: B2ExtObjectType, handle: string) {
    const map = this.localMaps.get(LocalDataMapKey.Handle);
    if (!map) {
      return null;
    }
    return map[getLocalHandleMapKey(type, handle)] || null;
  }

  getRevision(id: string) {
    const map = this.localMaps.get(LocalDataMapKey.Revision);
    if (!map) {
      return null;
    }
    return map[id] || null;
  }

  getChecksum(id: string) {
    const map = this.localMaps.get(LocalDataMapKey.Checksum);
    if (!map) {
      return null;
    }
    return map[id] || null;
  }

  private async initFolders() {
    const subFolderUri = (p: string) =>
      this.entryFolderUri.with({
        path: path.join(this.entryFolderUri.path, p)
      });
    const map = {
      component: subFolderUri("components"),
      controller: subFolderUri("controllers"),
      style: subFolderUri("styles"),
      local: subFolderUri(".local")
    };

    for (let uri of Object.values(map)) {
      await createDirectoryIfNotExists(uri);
    }
    return map;
  }

  private async loadLocalJSON<T>(filename: string): Promise<T | null> {
    const { local } = this.subFolderUris;
    try {
      const fileUri = local.with({
        path: path.join(local.path, filename)
      });
      const content = await vscode.workspace.fs.readFile(fileUri);
      const map = JSON.parse(content.toString());
      if (map && typeof map === "object") {
        return map;
      } else {
        return null;
      }
    } catch (e) {
      if (isFileNotFoundError(e)) {
        return null;
      } else {
        throw e;
      }
    }
  }

  private async saveLocalJSON<T>(filename: string, data: T) {
    const { local } = this.subFolderUris;
    const enc = new TextEncoder();
    const fileUri = local.with({
      path: path.join(local.path, filename)
    });
    await vscode.workspace.fs.writeFile(fileUri, enc.encode(stringify(data)));
  }
}

export interface LocalDataMap {
  [key: string]: string;
}

export enum LocalDataMapKey {
  Revision = ".revisions.json",
  Checksum = ".checksums.json",
  Handle = ".handles.json"
}

export enum B2ExtObjectType {
  File = 1,
  Controller = 2
}

export interface B2ExtObjectRef {
  type: B2ExtObjectType;
  handle: string;
  id: string | null;
  revision: string | null;
  checksum: string | null;
}

export function getLocalHandleMapKey(type: B2ExtObjectType, handle: string) {
  return `${type}|${handle}`;
}
