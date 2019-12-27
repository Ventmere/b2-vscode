import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { B2ExtObjectType } from "../b2/state";
import * as t from "b2-translate-utils";
import { resolveLocalUri } from "./resolve-link";
import { joinUriPath } from "../b2/utils";

export function onTagContent(ctx: B2ExtContext) {
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

    let main;
    try {
      main = t.parse(editor.document.getText());
    } catch (e) {
      return vscode.window.showErrorMessage(
        `Parse ${info.ref.handle}: ${e.message}`
      );
    }
    const selected = await vscode.window.showQuickPick(main.handles, {
      canPickMany: true,
      placeHolder: "Select referenced components you want to tag"
    });
    if (!selected || !selected.length) {
      return;
    }

    const res = await vscode.window.showWarningMessage(
      `Are you sure you want to change these components: \n${[
        ...selected,
        info.ref.handle
      ].join("\n")}`,
      {
        modal: true
      },
      "Yes"
    );

    if (res !== "Yes") {
      return;
    }

    // main file
    try {
      const r = t.parseTags(main);
      const content = t.applyTags(r);
      replaceEditorContent(editor, content);
    } catch (e) {
      return vscode.window.showErrorMessage(
        `Tag ${info.ref.handle}: ${e.message}`
      );
    }

    for (let h of selected) {
      const r = resolveLocalUri(
        info.workspace,
        info.entry,
        B2ExtObjectType.Component,
        h
      );
      if (!r || !r.uri) {
        continue;
      }
      const editor = await vscode.window.showTextDocument(
        joinUriPath(r.uri, `${r.handle}.component.huz`),
        {
          viewColumn: vscode.ViewColumn.Active
        }
      );
      try {
        const p = t.parse(editor.document.getText());
        const r = t.parseTags(p);
        const content = t.applyTags(r);
        replaceEditorContent(editor, content);
      } catch (e) {
        return vscode.window.showErrorMessage(`Tag ${h}: ${e.message}`);
      }
    }
  };
}

function replaceEditorContent(editor: vscode.TextEditor, content: string) {
  const range = new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(
      editor.document.lineCount,
      editor.document.lineAt(editor.document.lineCount - 1).range.end.character
    )
  );
  editor.edit(b => b.replace(range, content));
}
