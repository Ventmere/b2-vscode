import { Mutex } from "async-mutex";
import { Uri, WorkspaceFolder } from "vscode";
import { B2, B2Entry, FileEntry, ControllerEntry } from "b2-sdk";
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
  LocalFileProps,
  buildLocalB2Object
} from "./fs";
import * as _ from "lodash";
import { SaveQueue } from "./save";
import { getControllerChecksum, getFileChecksum } from "./checksum";

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

  async updateLocalMapsForRename(
    type: B2ExtObjectType,
    id: string,
    handle: string,
    revision: string,
    newHandle: string
  ) {
    const tasks = [
      this.updateLocalMap(LocalDataMapKey.Revision, {
        [id]: revision
      }),
      this.updateLocalMap(LocalDataMapKey.Handle, map => {
        delete map[getLocalHandleMapKey(type, handle)];
        map[getLocalHandleMapKey(type, newHandle)] = id;
        return map;
      })
    ];

    await Promise.all(tasks);
  }

  async updateLocalMapsForDelete(
    type: B2ExtObjectType,
    id: string,
    handle: string
  ) {
    const tasks = [
      this.updateLocalMap(LocalDataMapKey.Checksum, map => {
        delete map[id];
        return map;
      }),
      this.updateLocalMap(LocalDataMapKey.Revision, map => {
        delete map[id];
        return map;
      }),
      this.updateLocalMap(LocalDataMapKey.Handle, map => {
        delete map[getLocalHandleMapKey(type, handle)];
        return map;
      })
    ];

    await Promise.all(tasks);
  }

  getHandles(type: B2ExtObjectType): string[] {
    const map = this.localMaps.get(LocalDataMapKey.Handle) || {};
    const handles = [];
    for (let key of Object.keys(map)) {
      const p = `${type}|`;
      if (key.startsWith(p)) {
        handles.push(key.slice(p.length));
      }
    }
    return handles;
  }

  getComponentHandles(): string[] {
    return this.getHandles(B2ExtObjectType.Component);
  }

  getControllerHandles(): string[] {
    return this.getHandles(B2ExtObjectType.Controller);
  }

  getStyleHandles(): string[] {
    return this.getHandles(B2ExtObjectType.Style);
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
    map: LocalDataMap | ((map: LocalDataMap) => LocalDataMap),
    replace: boolean = false
  ) {
    if (typeof map === "function") {
      map = map(this.localMaps.get(key) || {});
    }

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
      for (let [handle, id] of Object.entries(map)) {
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

  getHandleById(id: string): string | null {
    const handleRes = this.idToHandleLookup.get(id);
    if (!handleRes) {
      return null;
    }

    return handleRes.handle;
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

  async renameObject(ref: B2ExtObjectRef, newHandle: string) {
    const { id, type, handle, uri } = ref;
    if (!id) {
      throw new Error(`Cannot find B2 object id.`);
    }

    if (this.getHandleId(type, newHandle)) {
      throw new Error(`Object exists: ${newHandle}`);
    }

    const subFolders = this.subFolderUris;
    let folder: Uri;
    let op;
    switch (type) {
      case B2ExtObjectType.Component:
        folder = subFolders.component;
        op = async () => {
          const file = await buildLocalB2Object(ref);
          file.handle = newHandle;
          const { revision } = await this.entry.file.update(file as FileEntry);
          await vscode.workspace.fs.rename(
            joinUriPath(uri, `${handle}.component.huz`),
            joinUriPath(uri, `${newHandle}.component.huz`)
          );
          await vscode.workspace.fs.rename(
            joinUriPath(uri, `${handle}.component.less`),
            joinUriPath(uri, `${newHandle}.component.less`)
          );
          await vscode.workspace.fs.rename(
            joinUriPath(uri, `${handle}.component.json`),
            joinUriPath(uri, `${newHandle}.component.json`)
          );
          await vscode.workspace.fs.rename(uri, joinUriPath(folder, newHandle));
          return revision!;
        };
        break;
      case B2ExtObjectType.Style:
        folder = subFolders.style;
        op = async () => {
          const file = await buildLocalB2Object(ref);
          file.handle = newHandle;
          const { revision } = await this.entry.file.update(file as FileEntry);
          await vscode.workspace.fs.rename(uri, joinUriPath(folder, newHandle));
          return revision!;
        };
        break;
      case B2ExtObjectType.Controller:
        folder = subFolders.controller;
        op = async () => {
          const controller = await buildLocalB2Object(ref);
          controller.handle = newHandle;
          const { revision } = await this.entry.controller.update(
            controller as ControllerEntry
          );
          await vscode.workspace.fs.rename(
            joinUriPath(uri, `${handle}.controller.js`),
            joinUriPath(uri, `${newHandle}.controller.js`)
          );
          await vscode.workspace.fs.rename(
            joinUriPath(uri, `${handle}.controller.json`),
            joinUriPath(uri, `${newHandle}.controller.json`)
          );
          await vscode.workspace.fs.rename(uri, joinUriPath(folder, newHandle));
          return revision!;
        };
        break;
    }
    await this.updateLocalMapsForRename(
      type,
      id,
      newHandle,
      await op(),
      newHandle
    );
  }

  async cloneObject(ref: B2ExtObjectRef, newHandle: string) {
    const { id, type, handle, uri } = ref;
    if (!id) {
      throw new Error(`Cannot find B2 object id.`);
    }

    if (this.getHandleId(type, newHandle)) {
      throw new Error(`Object exists: ${newHandle}`);
    }

    const subFolders = this.subFolderUris;
    let folder: Uri;
    let op;
    switch (type) {
      case B2ExtObjectType.Component:
        folder = subFolders.component;
        op = async () => {
          const file = await buildLocalB2Object(ref);
          file.handle = newHandle;
          const entry = await this.entry.file.create(file as FileEntry);
          await vscode.workspace.fs.copy(
            joinUriPath(uri, `${handle}.component.huz`),
            joinUriPath(folder, newHandle, `${newHandle}.component.huz`)
          );
          await vscode.workspace.fs.copy(
            joinUriPath(uri, `${handle}.component.less`),
            joinUriPath(folder, newHandle, `${newHandle}.component.less`)
          );
          const json =
            (await this.loadJSON<{ path?: string }>(
              joinUriPath(folder, handle, `${handle}.component.json`)
            )) || {};
          json.path = "";
          const enc = new TextEncoder();
          await vscode.workspace.fs.writeFile(
            joinUriPath(folder, newHandle, `${newHandle}.component.json`),
            enc.encode(stringifyJSONStable(json))
          );
          return [entry.id!, entry.revision!, getFileChecksum(entry)];
        };
        break;
      case B2ExtObjectType.Style:
        folder = subFolders.style;
        op = async () => {
          const file = await buildLocalB2Object(ref);
          file.handle = newHandle;
          const entry = await this.entry.file.create(file as FileEntry);
          await vscode.workspace.fs.copy(uri, joinUriPath(folder, newHandle));
          return [entry.id!, entry.revision!, getFileChecksum(entry)];
        };
        break;
      case B2ExtObjectType.Controller:
        folder = subFolders.controller;
        op = async () => {
          const controller = await buildLocalB2Object(ref);
          controller.handle = newHandle;
          const entry = await this.entry.controller.create(
            controller as ControllerEntry
          );
          await vscode.workspace.fs.copy(
            joinUriPath(uri, `${handle}.controller.js`),
            joinUriPath(folder, newHandle, `${newHandle}.controller.js`)
          );
          await vscode.workspace.fs.copy(
            joinUriPath(uri, `${handle}.controller.json`),
            joinUriPath(folder, newHandle, `${newHandle}.controller.json`)
          );
          return [entry.id!, entry.revision!, getControllerChecksum(entry)];
        };
        break;
    }
    const [newId, revision, checksum] = await op();
    await this.updateLocalMapsForSave(
      type,
      newId,
      newHandle,
      revision,
      checksum
    );
  }

  async deleteObject(ref: B2ExtObjectRef) {
    const { id, type, handle } = ref;
    if (!id) {
      throw new Error(`Cannot find B2 object id.`);
    }

    const subFolders = this.subFolderUris;
    let folder;
    let op;
    switch (type) {
      case B2ExtObjectType.Component:
        folder = subFolders.component;
        op = () => this.entry.file.delete(id);
        break;
      case B2ExtObjectType.Style:
        folder = subFolders.component;
        op = () => this.entry.file.delete(id);
        break;
      case B2ExtObjectType.Controller:
        folder = subFolders.component;
        op = () => this.entry.controller.delete(id);
        break;
    }

    await vscode.workspace.fs.delete(joinUriPath(folder, handle), {
      recursive: true
    });
    await this.updateLocalMapsForDelete(type, id, handle);
    await op();
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
