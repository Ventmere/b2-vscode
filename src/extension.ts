// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { init, B2ExtContext } from "./b2";
import { B2DocumentLinkProvider } from "./b2/language";

import { onPullCommand } from "./commands/pull";
import { onReloadCommand } from "./commands/reload";
import { onResolveLinkCommand } from "./commands/resolve-link";
import { onShowAppConfig } from "./commands/b2";
import { onUploadAsset } from "./commands/upload";
import { B2ExtContentProvider } from "./content-provider";
import { B2ExtTreeDataProvider } from "./b2/tree-view";
import { onPreview } from "./commands/preview";

const COMMANDS = {
  "ventmere-b2.pull": onPullCommand,
  "ventmere-b2.reload": onReloadCommand,
  "ventmere-b2.resolve-link": onResolveLinkCommand,
  "ventmere-b2.show-app-config": onShowAppConfig
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("B2 activating.");
  const ctx = init(context);

  for (let [key, fn] of Object.entries(COMMANDS)) {
    console.log(`registerCommand: ${key}`);
    context.subscriptions.push(vscode.commands.registerCommand(key, fn(ctx)));
  }

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      "ventmere-b2.upload-asset",
      onUploadAsset(ctx)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      "ventmere-b2.preview",
      onPreview(ctx)
    )
  );

  const treeDataProvider = new B2ExtTreeDataProvider(ctx);
  vscode.window.registerTreeDataProvider("b2Pages", treeDataProvider);

  // context.subscriptions.push(
  //   vscode.languages.registerHoverProvider("huz", {
  //     provideHover(document, position, token) {
  //       return new vscode.Hover(
  //         new vscode.MarkdownString(
  //           `![](https://cdn.ventmere.com/edifier-dev/uploads/2015-8/b7_web_01_a618d011-15b2-48a8-8468-cc7c98c20885.jpg)`
  //         )
  //       );
  //     }
  //   })
  // );

  // vscode.languages.registerDocumentHighlightProvider(
  //   "huz",
  //   new HuzHighlightProvider()
  // );

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "ventmere-b2",
      new B2ExtContentProvider(ctx)
    )
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      [
        { scheme: "file", language: "huz" },
        { scheme: "file", language: "less" }
      ],
      new B2DocumentLinkProvider(ctx)
    )
  );

  context.subscriptions.push(ctx);
}

// this method is called when your extension is deactivated
export function deactivate() {}
