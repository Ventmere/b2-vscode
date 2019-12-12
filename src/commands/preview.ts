import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { buildLocalB2Object } from "../b2/fs";
import { FileEntry } from "b2-sdk";
import * as path from "path";

export function onPreview(ctx: B2ExtContext) {
  return async (editor: vscode.TextEditor) => {
    const info = ctx.findDocInfo(editor.document.uri);
    if (!info || !info.entry || !info.ref) {
      return;
    }

    const file = (await buildLocalB2Object(info.ref)) as FileEntry;
    let url = info.entry.entry.path;
    if (file.path) {
      url = path.join(url, file.path);
    } else {
      url = path.join(url, "__b2/page/render", file.handle!);
    }
    url = info.workspace.app.publicURL + url;

    vscode.env.openExternal(vscode.Uri.parse(url));
  };
}
