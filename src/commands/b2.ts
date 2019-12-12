import { B2ExtContext } from "../b2";
import * as vscode from "vscode";

export function onShowAppConfig(ctx: B2ExtContext) {
  return async () => {
    let e = await vscode.window.showTextDocument(
      vscode.Uri.parse("ventmere-b2:modules.json"),
      {
        preview: true,
        viewColumn: vscode.ViewColumn.One
      }
    );
    e = await vscode.window.showTextDocument(
      vscode.Uri.parse("ventmere-b2:providers.json"),
      {
        preview: true,
        viewColumn: vscode.ViewColumn.Two
      }
    );
  };
}
