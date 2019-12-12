import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { B2ExtWorkspace } from "../b2/workspace";
import * as _ from "lodash";
import { exportFiles, hasUncommitedLocalChanges } from "../b2/fs";

export function onReloadCommand(ctx: B2ExtContext) {
  let busy = false;
  return async () => {
    if (busy) {
      vscode.window.showWarningMessage("Reload is running.");
      return;
    }

    busy = true;

    try {
      const info = ctx.currentDocInfo;

      // reload all workspaces
      if (!info) {
        const workspaces = ctx.getAllWorkspaces();
        if (!workspaces.length) {
          await vscode.window.showWarningMessage(`No active B2 workspace.`);
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            cancellable: false,
            title: "Reloading"
          },
          async p => {
            for (let w of workspaces) {
              await reloadWorkspace(p, w);
            }
          }
        );
      } else {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            cancellable: false,
            title: "Reloading"
          },
          async p => {
            await reloadWorkspace(p, info.workspace);
          }
        );
      }
      ctx.onDidChangeTreeData.fire();
    } catch (e) {
      vscode.window.showErrorMessage(`Reload failed: ${e.message}`);
      console.error(e.stack);
    } finally {
      busy = false;
    }
  };
}

async function reloadWorkspace(p: vscode.Progress<unknown>, w: B2ExtWorkspace) {
  p.report({
    message: w.app.name
  });
  for (let e of w.entries) {
    try {
      await e.reloadMetadata();
    } catch (e) {
      vscode.window.showErrorMessage(
        `Reload entry '${w.app.name} / ${e.name}' failed': ${e.message}`
      );
    }
  }
}
