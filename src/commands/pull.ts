import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { B2ExtWorkspace } from "../b2/workspace";
import * as _ from "lodash";
import { exportFiles, hasUncommitedLocalChanges } from "../b2/fs";

export function onPullCommand(ctx: B2ExtContext) {
  let busy = false;
  return async () => {
    if (busy) {
      vscode.window.showWarningMessage("Pull is running.");
      return;
    }

    busy = true;

    try {
      const info = ctx.currentDocInfo;
      let options;
      if (!info) {
        options = ctx.getAllWorkspaces().map(getOption);
      } else {
        options = [getOption(info.workspace)];
      }

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: `Which site do you want to pull?`
      });

      if (!selected) {
        busy = false;
        return;
      }

      const workspace = selected.workspace;

      const hasUncommited = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Checking git status...`,
          cancellable: false
        },
        async () => {
          return hasUncommitedLocalChanges(workspace.workspaceFolder.uri);
        }
      );

      if (hasUncommited) {
        vscode.window.showErrorMessage(
          "Commit all local changes before you can pull B2."
        );
        busy = false;
        return;
      }

      for (let e of workspace.entries) {
        await exportFiles(e);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Pull failed: ${e.message}`);
      console.error(e.stack);
    }

    busy = false;
  };
}

function getOption(workspace: B2ExtWorkspace) {
  const { app } = workspace;
  return {
    label: `${app.name}`,
    description: `${app.entries.length} entries`,
    detail: app.entries.map(e => e.name).join(", "),
    workspace
  };
}
