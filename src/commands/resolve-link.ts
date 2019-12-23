import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import { B2ExtWorkspace } from "../b2/workspace";
import * as _ from "lodash";
import { joinUriPath } from "../b2/utils";
import { getLocalB2ObjectUri } from "../b2/fs";
import { B2ExtObjectType, B2ExtEntryState } from "../b2/state";
import { getB2AssetAbsoluteURL } from "../b2/asset";

export interface ResolveLinkTarget {
  documentUri: vscode.Uri;
  type: "component" | "style" | "controller" | "asset";
  path: string;
}

export function onResolveLinkCommand(ctx: B2ExtContext) {
  return async (target: ResolveLinkTarget) => {
    const info = ctx.findDocInfo(target.documentUri);
    if (!info || !info.entry) {
      return;
    }

    switch (target.type) {
      case "component":
      case "style":
      case "controller": {
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

        if (target.type === "component") {
          const folderUri = getLocalB2ObjectUri(
            entry,
            B2ExtObjectType.Component,
            path
          );

          const htmlDoc = await vscode.workspace.openTextDocument(
            joinUriPath(folderUri, `${path}.component.huz`)
          );
          vscode.window.showTextDocument(htmlDoc, vscode.ViewColumn.One);
          const lessDoc = await vscode.workspace.openTextDocument(
            joinUriPath(folderUri, `${path}.component.less`)
          );
          vscode.window.showTextDocument(lessDoc, vscode.ViewColumn.Two);
        } else if (target.type === "style") {
          const uri = getLocalB2ObjectUri(entry, B2ExtObjectType.Style, path);
          vscode.window.showTextDocument(uri);
        } else if (target.type === "controller") {
          const uri = getLocalB2ObjectUri(
            entry,
            B2ExtObjectType.Controller,
            path
          );
          vscode.window.showTextDocument(
            joinUriPath(uri, `${path}.controller.js`)
          );
        }
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

export function resolveLocalUri(
  workspace: B2ExtWorkspace,
  entry: B2ExtEntryState,
  type: B2ExtObjectType,
  handle: string
) {
  if (handle.includes(":")) {
    const pageModuleId = handle.slice(0, handle.search(":"));
    const refEntry = workspace.appConfig.getEntryByPageModuleId(pageModuleId);
    if (!refEntry) {
      return;
    }
    entry = refEntry;
    handle = handle.slice(pageModuleId.length + 1);
  }
  return {
    handle,
    uri: getLocalB2ObjectUri(entry, type, handle)
  };
}
