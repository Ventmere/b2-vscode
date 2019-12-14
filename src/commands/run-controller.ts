import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { buildLocalB2Object } from "../b2/fs";
import { FileEntry, ControllerEntry } from "b2-sdk";
import * as path from "path";
import { B2ExtObjectType } from "../b2/state";
import { B2ExtContentProvider } from "../content-provider";
import { ControllerConfig } from "b2-sdk/build/controller";
import { sleep } from "../b2/utils";

export function onRunController(
  ctx: B2ExtContext,
  contentProvider: B2ExtContentProvider
) {
  return async (editor: vscode.TextEditor) => {
    const info = ctx.findDocInfo(editor.document.uri);
    if (!info || !info.entry || !info.ref) {
      return;
    }

    if (info.ref.type !== B2ExtObjectType.Controller) {
      vscode.window.showErrorMessage(`Not a controller file.`);
      return;
    }

    let controller = (await buildLocalB2Object(info.ref)) as ControllerEntry;
    const ext = path.extname(info.ref.uri.path);
    if (ext === "js") {
      controller.script = editor.document.getText();
    } else if (ext === "json") {
      let props;

      try {
        props = JSON.parse(editor.document.getText());
      } catch (e) {
        vscode.window.showErrorMessage(`Parse controller JSON: ${e.message}`);
        return;
      }

      controller = {
        ...controller,
        ...props
      };
    }

    const uri = vscode.Uri.parse(
      `ventmere-b2:controller_run/${info.ref.handle}.json?${encodeURIComponent(
        info.ref.uri.toString()
      )}`
    );

    {
      contentProvider.updateUri(uri, "Running controller...");
      vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.Two,
        preserveFocus: true
      });
    }

    let method = "GET";
    if (controller.methods.length > 1) {
      const verb = await vscode.window.showQuickPick(controller.methods, {
        placeHolder: "Select a HTTP verb"
      });
      if (!verb) {
        return;
      }

      method = verb;
    }

    try {
      const res = await info.entry.entry.controller.run({
        ...controller,
        method
      } as ControllerConfig);
      contentProvider.updateUri(uri, JSON.stringify(res, null, "  "));
      vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.Two,
        preserveFocus: true
      });
    } catch (e) {
      // virtual document change will not render if we fire event too fast
      await sleep(100);
      contentProvider.updateUri(
        uri,
        `Error: \n${JSON.stringify(e, null, "  ")}`
      );
      vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.Two,
        preserveFocus: true
      });
    }
  };
}
