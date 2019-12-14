import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { B2ExtObjectType } from "../b2/state";

export function onInsertControllerId(ctx: B2ExtContext) {
  return async (
    editor: vscode.TextEditor,
    e: vscode.TextEditorEdit,
    pos?: number,
    len?: number
  ) => {
    const info = ctx.findDocInfo(editor.document.uri);
    if (!info || !info.entry) {
      return;
    }

    const handle = await vscode.window.showQuickPick(
      info.entry.getControllerHandles(),
      {
        placeHolder: "Select a controller to insert id"
      }
    );

    if (!handle) {
      return;
    }

    const id = info.entry.getHandleId(B2ExtObjectType.Controller, handle);

    if (!id) {
      throw new Error(`Controller id was not found: ${handle}`);
    }

    editor.edit(b =>
      b.replace(
        pos
          ? new vscode.Range(
              editor.document.positionAt(pos),
              editor.document.positionAt(pos + (len || 0))
            )
          : editor.selection,
        id
      )
    );
  };
}
