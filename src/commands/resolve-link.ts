import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { B2ExtWorkspace } from "../b2/workspace";
import * as _ from "lodash";
import { joinUriPath } from "../b2/utils";
import { getLocalB2ObjectUri } from "../b2/fs";
import { B2ExtObjectType } from "../b2/state";
import { getB2AssetAbsoluteURL } from "../b2/asset";

export interface ResolveLinkTarget {
  documentUri: vscode.Uri;
  type: "component" | "controller" | "asset";
  path: string;
}

export function onResolveLinkCommand(ctx: B2ExtContext) {
  return async (target: ResolveLinkTarget) => {
    console.log(target);
    const info = ctx.findDocInfo(target.documentUri);
    if (!info || !info.entry) {
      return;
    }

    switch (target.type) {
      case "component": {
        let entry = info.entry;
        let { path } = target;
        if (path.includes(":")) {
          const pageModuleId = path.slice(0, path.search(":"));
          const refEntry = info.workspace.appConfig.getEntryByPageModuleId(
            pageModuleId
          );
          if (!refEntry) {
            vscode.window.showWarningMessage(
              `Unknown partial namespace: '${pageModuleId}'`
            );
            return;
          }
          entry = refEntry;
          path = path.slice(pageModuleId.length + 1);
        }

        console.log(`resolve-link: entry = ${entry.entryLocalPath}`);

        const folderUri = getLocalB2ObjectUri(
          entry,
          B2ExtObjectType.Component,
          path
        );

        const htmlDoc = await vscode.workspace.openTextDocument(
          joinUriPath(folderUri, `${path}.component.html`)
        );
        vscode.window.showTextDocument(htmlDoc, vscode.ViewColumn.One);
        const lessDoc = await vscode.workspace.openTextDocument(
          joinUriPath(folderUri, `${path}.component.less`)
        );
        vscode.window.showTextDocument(lessDoc, vscode.ViewColumn.Two);
        break;
      }

      case "asset": {
        const base = info.workspace.appConfig.getAssetBaseUrlByEntryLocalPath(
          info.entry.entryLocalPath
        );
        if (base) {
          const url = getB2AssetAbsoluteURL(base, target.path);
          if (url) {
            vscode.env.openExternal(vscode.Uri.parse(url));
          }
        }
        break;
      }
    }
  };
}
