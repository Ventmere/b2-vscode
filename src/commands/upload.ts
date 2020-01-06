import { B2ExtContext } from "../b2";
import * as vscode from "vscode";
import * as shortid from "shortid";
import * as moment from "moment";
import { basename, extname } from "path";
import * as fs from "fs";
import { window } from "rxjs/operators";
import { B2ExtObjectType } from "../b2/state";
import { getB2AssetAbsoluteURL } from "../b2/asset";

export function onUploadAsset(ctx: B2ExtContext) {
  return async (editor: vscode.TextEditor) => {
    const info = ctx.findDocInfo(editor.document.uri);
    if (!info || !info.entry) {
      return;
    }

    const files = await vscode.window.showOpenDialog({
      openLabel: "Select files to upload",
      canSelectMany: true
    });

    if (!files || files.length === 0) {
      return;
    }

    const sel = editor.selection;
    const items = files.map(u => {
      return {
        name: basename(u.fsPath),
        src: u.fsPath,
        uniqueName: getUniqueName(u.fsPath),
        dstFolder: getBasePath()
      };
    });

    const urls = await vscode.window.withProgress(
      {
        title: "Uploading",
        location: vscode.ProgressLocation.Notification,
        cancellable: false
      },
      async (p, c) => {
        const urls = [];
        let asset = info.workspace.app.asset;
        if (info.entry && info.entry.entry.asset) {
          asset = info.entry.entry.asset;
        }
        const pv = 100 / items.length;
        for (let item of items) {
          p.report({
            message: `${item.name}`
          });

          try {
            const uploaded = await asset.upload(item.dstFolder, [
              {
                filename: item.uniqueName,
                content: fs.createReadStream(item.src)
              }
            ]);
            for (let url of uploaded) {
              urls.push(url);
            }
          } catch (e) {
            await vscode.window.showErrorMessage(
              `Upload '${item.name}': ${e.message}`
            );
          }

          p.report({
            increment: pv
          });
        }
        return urls;
      }
    );

    const base = info.workspace.appConfig.getAssetBaseUrlByEntryLocalPath(
      info.entry.entryLocalPath
    );

    let format = base
      ? (v: string) => {
          return getB2AssetAbsoluteURL(base, v);
        }
      : (v: string) => v;
    if (info.ref) {
      if (info.ref.type === B2ExtObjectType.Component) {
        const ext = extname(editor.document.uri.fsPath);
        if (ext === ".html" || ext === ".huz") {
          format = v => `asset:/${v}`;
        } else if (ext === ".less") {
          format = v => `asset-url("${v}")`;
        }
      } else if (info.ref.type === B2ExtObjectType.Style) {
        format = v => `asset-url("${v}")`;
      }
    }

    editor.edit(b => {
      b.replace(sel, urls.map(format).join("\n"));
    });
  };
}

function getBasePath() {
  const date = moment().format("YYYY-MM");
  return `/uploads/${date}`;
}

function getUniqueName(name: string) {
  const uid = shortid.generate();
  const ext = extname(name);
  const base = normalizeName(basename(name, ext));
  return `${base}_${uid}${ext}`;
}

function normalizeName(name: string) {
  return name
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}
