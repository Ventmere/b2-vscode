import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { B2ExtObjectType } from "../b2/state";
import { sleep } from "../b2/utils";

export function onRenameObject(ctx: B2ExtContext) {
  return async (editor: vscode.TextEditor) => {
    if (editor.document.isDirty) {
      vscode.window.showWarningMessage(`Save file before rename.`, {
        modal: true
      });
      return;
    }

    const info = ctx.findDocInfo(editor.document.uri);
    if (!info || !info.entry || !info.ref) {
      vscode.window.showErrorMessage(
        `Use this command when you opened a B2 source code file.`,
        { modal: true }
      );
      return;
    }

    const { entry, ref } = info;
    const { type, handle } = info.ref;
    let msg: string;

    const newHandle = await vscode.window.showInputBox({
      prompt: "Enter the new name",
      value: handle,
      placeHolder: handle
    });

    if (!newHandle || newHandle === handle) {
      return;
    }

    if (type === B2ExtObjectType.Component) {
      msg = `Are you sure you want to rename component '${handle}' to '${newHandle}'?`;
    } else if (type === B2ExtObjectType.Controller) {
      msg = `Are you sure you want to rename controller '${handle}' to '${newHandle}'?`;
    } else if (type === B2ExtObjectType.Style) {
      msg = `Are you sure you want to rename file '${handle}'? to '${newHandle}'`;
    } else {
      throw new Error(`Unknown object type`);
    }

    const res = await vscode.window.showWarningMessage(
      msg,
      {
        modal: true
      },
      "Rename"
    );

    if (res === "Rename") {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Renaming" },
          async () => {
            await entry.renameObject(ref, newHandle);
          }
        );
        vscode.window.showInformationMessage("B2 object renamed.");
      } catch (e) {
        vscode.window.showErrorMessage("Rename failed:\n" + e.message, {
          modal: true
        });
      }
    }
  };
}

export function onCloneObject(ctx: B2ExtContext) {
  return async (editor: vscode.TextEditor) => {
    if (editor.document.isDirty) {
      vscode.window.showWarningMessage(`Save file before clone.`, {
        modal: true
      });
      return;
    }
    const info = ctx.findDocInfo(editor.document.uri);
    if (!info || !info.entry || !info.ref) {
      vscode.window.showErrorMessage(
        `Use this command when you opened a B2 source code file.`,
        { modal: true }
      );
      return;
    }

    const { entry, ref } = info;
    const { type, handle } = info.ref;
    let msg: string;

    const newHandle = await vscode.window.showInputBox({
      prompt: "Enter the new name",
      value: handle + "-clone",
      placeHolder: handle + "-clone"
    });

    if (!newHandle || newHandle === handle) {
      return;
    }

    if (type === B2ExtObjectType.Component) {
      msg = `Are you sure you want to clone component '${handle}' to '${newHandle}'?`;
    } else if (type === B2ExtObjectType.Controller) {
      msg = `Are you sure you want to clone controller '${handle}' to '${newHandle}'?`;
    } else if (type === B2ExtObjectType.Style) {
      msg = `Are you sure you want to clone file '${handle}'? to '${newHandle}'`;
    } else {
      throw new Error(`Unknown object type`);
    }

    const res = await vscode.window.showWarningMessage(
      msg,
      {
        modal: true
      },
      "Clone"
    );

    if (res === "Clone") {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Cloning" },
          async () => {
            await entry.cloneObject(ref, newHandle);
          }
        );
        vscode.window.showInformationMessage("B2 object cloned.");
      } catch (e) {
        vscode.window.showErrorMessage("Clone failed:\n" + e.message, {
          modal: true
        });
      }
    }
  };
}

export function onDeleteObject(ctx: B2ExtContext) {
  return async (editor: vscode.TextEditor) => {
    const info = ctx.findDocInfo(editor.document.uri);
    if (!info || !info.entry || !info.ref) {
      vscode.window.showErrorMessage(
        `Use this command when you opened a B2 source code file.`,
        { modal: true }
      );
      return;
    }

    const { entry, ref } = info;
    const { type, handle } = info.ref;
    let msg: string;

    if (type === B2ExtObjectType.Component) {
      msg = `Are you sure you want to delete component '${handle}'?\nYou CANNOT restore these files.`;
    } else if (type === B2ExtObjectType.Controller) {
      msg = `Are you sure you want to delete controller '${handle}'?\nYou CANNOT restore these files.`;
    } else if (type === B2ExtObjectType.Style) {
      msg = `Are you sure you want to delete file '${handle}'?\nYou CANNOT restore this file.`;
    } else {
      throw new Error(`Unknown object type`);
    }

    const res = await vscode.window.showWarningMessage(
      msg,
      {
        modal: true
      },
      "Permanently Delete"
    );

    if (res === "Permanently Delete") {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Deleting" },
          async () => {
            await entry.deleteObject(ref);
          }
        );
        vscode.window.showInformationMessage("B2 object deleted.");
      } catch (e) {
        vscode.window.showErrorMessage("Delete failed:\n" + e.message, {
          modal: true
        });
      }
    }
  };
}
