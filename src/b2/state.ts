import { Mutex } from "async-mutex";
import { Uri, WorkspaceFolder } from "vscode";
import { B2, B2Entry } from "b2-sdk";
import * as path from "path";
import * as vscode from "vscode";
import { TextEncoder } from "util";
import {
  isFileNotFoundError,
  createDirectoryIfNotExists,
  stringifyJSONStable,
  joinUriPath
} from "./utils";
import {
  isComponentFilename,
  getLocalB2ObjectUri,
  isControllerFilename,
  LocalFileProps
} from "./fs";
import * as _ from "lodash";
import { SaveQueue } from "./save";

export class B2ExtEntryState {
  private mutex: Mutex = new Mutex();
  private localMaps: Map<LocalDataMapKey, LocalDataMap> = new Map();
  private idToHandleLookup: Map<
    string,
    {
      type: B2ExtObjectType;
      handle: string;
    }
  > = new Map();
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
  private saveQueue: SaveQueue;

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
    this.saveQueue = new SaveQueue(this);
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
    this.refreshHandleLookupTable();
  }

  async reloadMetadata() {
    const release = await this.mutex.acquire();
    try {
      const entries = await Promise.all(
        Object.values(LocalDataMapKey).map(key => {
          return this.loadLocalJSON<LocalDataMap>(key).then(
            map => [key, map || {}] as [LocalDataMapKey, LocalDataMap]
          );
        })
      );
      this.localMaps = new Map(entries);
      this.refreshHandleLookupTable();
    } catch (e) {
      throw e;
    } finally {
      release();
    }
  }

  async updateLocalMapsForSave(
    type: B2ExtObjectType,
    id: string,
    handle: string,
    revision: string,
    checksum: string
  ) {
    let isNew = !this.getHandleId(type, handle);
    const tasks = [
      this.updateLocalMap(LocalDataMapKey.Checksum, {
        [id!]: checksum
      }),
      this.updateLocalMap(LocalDataMapKey.Revision, {
        [id!]: revision!
      }),
      isNew
        ? this.updateLocalMap(LocalDataMapKey.Handle, {
            [getLocalHandleMapKey(type, handle)]: id!
          })
        : Promise.resolve()
    ];

    await Promise.all(tasks);
  }

  async getPageInfos(): Promise<Array<PageInfo>> {
    const map = this.localMaps.get(LocalDataMapKey.Handle) || {};
    const handles = [];
    for (let [key, id] of Object.entries(map)) {
      const p = `${B2ExtObjectType.Component}|`;
      if (key.startsWith(p)) {
        handles.push([key.slice(p.length), id]);
      }
    }
    const { component } = this.subFolderUris;
    const results: PageInfo[] = [];
    await Promise.all(
      handles.map(async ([handle, id]) => {
        const props = await this.loadJSON<LocalFileProps>(
          joinUriPath(component, handle, `${handle}.component.json`)
        );
        if (props && props.path) {
          results.push({
            ...props,
            handle,
            id
          });
        }
      })
    );
    return results;
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
      if (key === LocalDataMapKey.Handle) {
        this.refreshHandleLookupTable();
      }
    } catch (e) {
      throw e;
    } finally {
      release();
    }
  }

  private refreshHandleLookupTable() {
    this.idToHandleLookup.clear();
    const map = this.localMaps.get(LocalDataMapKey.Handle);
    if (map) {
      for (let [id, handle] of Object.entries(map)) {
        const [t, h] = handle.split("|");
        const type = parseInt(t, 10);
        if (type) {
          this.idToHandleLookup.set(id, {
            type: type as B2ExtObjectType,
            handle: h
          });
        }
      }
    }
  }

  resolveRefById(id: string): B2ExtObjectRef | null {
    const handleRes = this.idToHandleLookup.get(id);
    if (!handleRes) {
      return null;
    }

    return {
      type: handleRes.type,
      id,
      handle: handleRes.handle,
      revision: id ? this.getRevision(id) : null,
      checksum: id ? this.getChecksum(id) : null,
      uri: getLocalB2ObjectUri(this, handleRes.type, handleRes.handle)
    };
  }

  resolveRefByPath(entryPath: string): B2ExtObjectRef | null {
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
              const id = this.getHandleId(B2ExtObjectType.Component, handle);
              return {
                type: B2ExtObjectType.Component,
                id,
                handle,
                revision: id ? this.getRevision(id) : null,
                checksum: id ? this.getChecksum(id) : null,
                uri: getLocalB2ObjectUri(
                  this,
                  B2ExtObjectType.Component,
                  handle
                )
              };
            }
          }
        }
        case "controllers": {
          if (rest.length === 2) {
            const [handle, filename] = rest;
            if (isControllerFilename(handle, filename)) {
              const id = this.getHandleId(B2ExtObjectType.Controller, handle);
              return {
                type: B2ExtObjectType.Controller,
                id,
                handle,
                revision: id ? this.getRevision(id) : null,
                checksum: id ? this.getChecksum(id) : null,
                uri: getLocalB2ObjectUri(
                  this,
                  B2ExtObjectType.Controller,
                  handle
                )
              };
            }
          }
        }
        case "styles": {
          if (rest.length === 1) {
            const handle = rest[0];
            const id = this.getHandleId(B2ExtObjectType.Style, handle);
            return {
              type: B2ExtObjectType.Style,
              id,
              handle,
              revision: id ? this.getRevision(id) : null,
              checksum: id ? this.getChecksum(id) : null,
              uri: getLocalB2ObjectUri(this, B2ExtObjectType.Style, handle)
            };
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

  enqueueSave(ref: B2ExtObjectRef) {
    this.saveQueue.enqueue(ref);
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

    // for (let uri of Object.values(map)) {
    //   await createDirectoryIfNotExists(uri);
    // }
    return map;
  }

  private async loadJSON<T>(fileUri: Uri): Promise<T | null> {
    try {
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

  private async loadLocalJSON<T>(filename: string): Promise<T | null> {
    const { local } = this.subFolderUris;
    const fileUri = local.with({
      path: path.join(local.path, filename)
    });
    return this.loadJSON(fileUri);
  }

  private async saveLocalJSON<T>(filename: string, data: T) {
    const { local } = this.subFolderUris;
    const enc = new TextEncoder();
    const fileUri = local.with({
      path: path.join(local.path, filename)
    });
    await vscode.workspace.fs.writeFile(
      fileUri,
      enc.encode(stringifyJSONStable(data))
    );
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
  Component = 1,
  Style = 2,
  Controller = 3
}

export interface B2ExtObjectRef {
  type: B2ExtObjectType;
  handle: string;
  uri: Uri;
  id: string | null;
  revision: string | null;
  checksum: string | null;
}

export function getLocalHandleMapKey(type: B2ExtObjectType, handle: string) {
  return `${type}|${handle}`;
}

export interface PageInfo {
  handle: string;
  id: string;
  path: string;
  override_params?: { [key: string]: string };
  controller_id?: string;
}
