import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { joinUriPath, isFileNotFoundError } from "../b2/utils";

export function onUpgrade(ctx: B2ExtContext) {
  return async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Upgrading files",
        cancellable: false
      },
      async p => {
        for (let w of ctx.getAllWorkspaces()) {
          for (let e of w.entries) {
            const { component } = e.subFolderUris;
            for (let handle of e.getComponentHandles()) {
              p.report({
                message: `${w.app.name}: ${handle}`
              });
              const from = joinUriPath(
                component,
                handle,
                `${handle}.component.html`
              );
              try {
                await vscode.workspace.fs.stat(from);
                await vscode.workspace.fs.rename(
                  from,
                  joinUriPath(component, handle, `${handle}.component.huz`)
                );
              } catch (e) {
                if (!isFileNotFoundError(e)) {
                  throw e;
                }
              }
            }
          }
        }
      }
    );

    vscode.window.showInformationMessage("B2 files upgraded.");
  };
}
