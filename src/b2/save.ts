import {
  B2ExtEntryState,
  B2ExtObjectRef,
  B2ExtObjectType,
  LocalDataMapKey
} from "./state";
import { window } from "vscode";
import { buildLocalB2Object } from "./fs";
import { FileEntry, ControllerEntry } from "b2-sdk";
import { getControllerChecksum, getFileChecksum } from "./checksum";

interface Node {
  ref: B2ExtObjectRef;
}

export class SaveQueue {
  queue: Node[] = [];
  draining = false;
  requested = false;

  constructor(private entryState: B2ExtEntryState) {}

  enqueue(ref: B2ExtObjectRef) {
    this.queue.push({ ref });
    this.drain();
  }

  private drain() {
    if (this.draining) {
      this.requested = true;
      return;
    }

    this.draining = true;
    const nodes = this.queue.slice();
    this.queue.length = 0;
    ~(async () => {
      for (let node of nodes) {
        try {
          await this.save(node.ref);
          window.showInformationMessage(`Saved to B2: ${node.ref.handle}`);
        } catch (e) {
          window.showErrorMessage(
            `Save to B2 failed:\n${node.ref.handle}: ${e.message}`,
            {
              modal: true
            }
          );
        }
      }
    })().then(() => {
      this.draining = false;
      if (this.requested) {
        this.requested = false;
        this.drain();
      }
    });
  }

  async save(ref: B2ExtObjectRef) {
    const obj = await buildLocalB2Object(ref);
    const isNew = !ref.id;
    console.log("saving", ref.handle, obj);
    switch (ref.type) {
      case B2ExtObjectType.Component:
      case B2ExtObjectType.Style: {
        let res;
        if (isNew) {
          res = await this.entryState.entry.file.create(obj as FileEntry);
        } else {
          res = await this.entryState.entry.file.update(obj as FileEntry);
        }
        await this.uploadLocal(ref.type, res);
        break;
      }
      case B2ExtObjectType.Controller: {
        let res;
        if (isNew) {
          res = await this.entryState.entry.controller.create(
            obj as ControllerEntry
          );
        } else {
          res = await this.entryState.entry.controller.update(
            obj as ControllerEntry
          );
        }
        await this.uploadLocal(ref.type, res);
        break;
      }
    }
  }

  private async uploadLocal(
    type: B2ExtObjectType,
    updated: FileEntry | ControllerEntry
  ) {
    const { id, handle, revision } = updated;
    let checksum;

    switch (type) {
      case B2ExtObjectType.Component:
      case B2ExtObjectType.Style:
        checksum = getFileChecksum(updated as FileEntry);
        break;
      case B2ExtObjectType.Controller:
        checksum = getControllerChecksum(updated as ControllerEntry);
        break;
      default:
        throw new Error(`Unknown type: ${type}`);
    }

    await this.entryState.updateLocalMapsForSave(
      type,
      id!,
      handle!,
      revision!,
      checksum
    );
  }
}
