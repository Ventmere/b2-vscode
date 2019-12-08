// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { init } from "./b2";

import { onPullCommand } from "./commands/pull";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("B2 activated.");

  const ctx = init(context);

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable = vscode.commands.registerCommand("ventmere-b2.init", () => {
    console.log("wf;", vscode.window.activeTextEditor!.document.uri);
  });
  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.commands.registerCommand("ventmere-b2.pull", onPullCommand(ctx))
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}
