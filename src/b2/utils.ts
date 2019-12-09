import { FileSystemError, Uri, workspace } from "vscode";

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
