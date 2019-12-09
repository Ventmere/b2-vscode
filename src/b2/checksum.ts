import { createHash } from "crypto";
import { FileEntry, ControllerEntry } from "b2-sdk";
import * as stableStringify from "json-stable-stringify";
import * as _ from "lodash";

function md5(items: any[]) {
  const hasher = createHash("md5");
  for (let item of items) {
    hasher.update(item ? String(item) : "");
  }
  return hasher.digest("base64");
}

const HUZ_OPTION_KEYS: Array<keyof FileEntry> = [
  "path",
  "controller_id",
  "override_params"
];

export function getFileChecksum(file: FileEntry) {
  let items;
  switch (file.type) {
    case "huz": {
      const template = file.content;
      const less = file.children!.find(c => c.type === "less");
      const options = _.pick(file, HUZ_OPTION_KEYS);
      items = [template, less, stableStringify(options)];
      break;
    }
    case "less": {
      items = [file.content];
      break;
    }
    default:
      throw new Error(`Unknown B2 file type: ${file.type}`);
  }
  return md5(items);
}

const CONTROLLER_OPTION_KEYS: Array<keyof ControllerEntry> = [
  "default_params",
  "default_query",
  "default_path",
  "description",
  "exported",
  "middleware",
  "methods",
  "script"
];

export function getControllerChecksum(controller: ControllerEntry) {
  return md5([
    controller.script,
    stableStringify(_.pick(controller, CONTROLLER_OPTION_KEYS))
  ]);
}
