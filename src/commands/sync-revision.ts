import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { B2ExtObjectType } from "../b2/state";
import { getFileChecksum, getControllerChecksum } from "../b2/checksum";
import { exportHuzFile, exportLessFile, exportController } from "../b2/fs";

export function onSyncRevision(ctx: B2ExtContext) {
  return async (editor: vscode.TextEditor) => {
    const info = ctx.findDocInfo(editor.document.uri);
    if (!info || !info.entry || !info.ref) {
      return;
    }

    const { type, id, handle, checksum } = info.ref;

    if (!id) {
      vscode.window.showErrorMessage(`Local object not saved to B2.`);
      return;
    }

    if (type == B2ExtObjectType.Component || type === B2ExtObjectType.Style) {
      const remote = await info.entry.entry.file.getByHandle(handle);

      if (!remote) {
        vscode.window.showErrorMessage(`Local object not found in B2.`);
        return;
      }

      const remoteChecksum = getFileChecksum(remote);
      if (remoteChecksum === checksum) {
        await info.entry.updateLocalMapsForSave(
          B2ExtObjectType.Component,
          id,
          handle,
          remote.revision!,
          checksum
        );
        await vscode.window.showInformationMessage(
          `Object revision synced with B2 successfully.`
        );
      } else {
        const answer = await vscode.window.showWarningMessage(
          `Object checksum mismatch, do you want to override local files?`,
          { modal: true },
          "Overwrite Local Files"
        );
        if (answer === "Overwrite Local Files") {
          if (type === B2ExtObjectType.Component) {
            await exportHuzFile(
              info.entry.subFolderUris.component,
              handle,
              remote
            );
          } else if (type === B2ExtObjectType.Style) {
            await exportLessFile(
              info.entry.subFolderUris.style,
              handle,
              remote
            );
          }
          await info.entry.updateLocalMapsForSave(
            B2ExtObjectType.Component,
            id,
            handle,
            remote.revision!,
            remoteChecksum
          );
          await vscode.window.showInformationMessage(
            `Object synced with B2 successfully.`
          );
        }
      }
    } else if (type === B2ExtObjectType.Controller) {
      const remote = await info.entry.entry.controller.get(id);

      if (!remote) {
        vscode.window.showErrorMessage(`Local object not found in B2.`);
        return;
      }

      const remoteChecksum = getControllerChecksum(remote);
      if (remoteChecksum === checksum) {
        await info.entry.updateLocalMapsForSave(
          B2ExtObjectType.Controller,
          id,
          handle,
          remote.revision!,
          checksum
        );
        await vscode.window.showInformationMessage(
          `Object revision synced with B2 successfully.`
        );
      } else {
        const answer = await vscode.window.showWarningMessage(
          `Object checksum mismatch, do you want to override local files?`,
          { modal: true },
          "Overwrite Local Files"
        );
        if (answer === "Overwrite Local Files") {
          await exportController(
            info.entry.subFolderUris.controller,
            handle,
            remote
          );
          await info.entry.updateLocalMapsForSave(
            B2ExtObjectType.Controller,
            id,
            handle,
            remote.revision!,
            remoteChecksum
          );
          await vscode.window.showInformationMessage(
            `Controller synced with B2 successfully.`
          );
        }
      }
    }
  };
}
