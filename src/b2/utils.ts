import {
  FileSystemError,
  Uri,
  workspace,
  TextDocument,
  Position,
  Range
} from "vscode";
import stringify = require("json-stable-stringify");
import * as path from "path";

export async function sleep(ms: number) {
  return new Promise(res => setTimeout(() => res(), ms));
}

// ¯\_(ツ)_/¯
// https://github.com/microsoft/vscode/blob/4ae9ec03b7579db5061b68aab76334d4ec3fbafd/src/vs/platform/files/common/files.ts#L307
// https://github.com/microsoft/vscode/blob/4ae9ec03b7579db5061b68aab76334d4ec3fbafd/src/vs/platform/files/common/files.ts#L341
export function isFileNotFoundError(err: FileSystemError) {
  return err.name === "EntryNotFound (FileSystemError)";
}
export function isFileExistsError(err: FileSystemError) {
  return err.name === "EntryExists (FileSystemError)";
}

export async function createDirectoryIfNotExists(uri: Uri) {
  try {
    await workspace.fs.createDirectory(uri);
  } catch (e) {
    if (!isFileExistsError(e)) {
      throw e;
    }
  }
}

export function stringifyJSONStable<T>(v: T) {
  return stringify(v, {
    space: 2
  });
}

export function joinUriPath(uri: Uri, ...paths: string[]) {
  return uri.with({
    path: path.join(uri.path, ...paths)
  });
}

export function searchAll<T>(
  str: string,
  re: RegExp,
  extract: (index: number, length: number, captures: string[]) => T
): T[] {
  re.lastIndex = 0;
  const result = [];
  let match;
  while ((match = re.exec(str)) != null) {
    result.push(extract(match.index, match[0].length, match.slice(1)));
  }
  re.lastIndex = 0;
  return result;
}

export function getDocumentLineBeforePosition(
  document: TextDocument,
  position: Position
) {
  return document.getText(
    new Range(
      position.with({
        character: 0
      }),
      position
    )
  );
}
