import {
  DocumentLinkProvider,
  TextDocument,
  CancellationToken,
  ProviderResult,
  DocumentLink,
  Range,
  Uri,
  HoverProvider
} from "vscode";
import { B2ExtContext } from "..";
import * as path from "path";
import { ResolveLinkTarget } from "../../commands/resolve-link";
import { searchAll } from "../utils";
import { B2ExtObjectType } from "../state";

const R_PARTIAL_LINK = /(?<={{\s*[<>]\s*)([:a-zA-Z0-9_\-]+)(?=\s*?}})/g;
const R_HUZ_LINK = /(?<=")(page|asset):\/\/([\-a-zA-Z0-9@:%._+~#=\/ ]+)(?=")/g;
const R_CSS_IMPORT = /(?<=@import\s+")([a-zA-Z0-9\-_\.]+)"/g;

export class B2ExtDocumentLinkProvider implements DocumentLinkProvider {
  constructor(private ctx: B2ExtContext) {}

  provideDocumentLinks(
    document: TextDocument,
    token: CancellationToken
  ): ProviderResult<DocumentLink[]> {
    const info = this.ctx.findDocInfo(document.uri);
    if (!info || !info.entry || !info.ref) {
      return;
    }

    const content = document.getText();
    const result: DocumentLink[] = [];

    const ext = path.extname(document.uri.path);
    if (ext === ".huz") {
      searchAll(content, R_PARTIAL_LINK, (i, l, c) => {
        const [path] = c;

        let target = Uri.parse(
          `command:ventmere-b2.resolve-link?${encodeURIComponent(
            JSON.stringify({
              documentUri: document.uri,
              type: "component",
              path
            } as ResolveLinkTarget)
          )}`
        );

        result.push({
          range: new Range(document.positionAt(i), document.positionAt(i + l)),
          target
        });
      });

      searchAll(content, R_HUZ_LINK, (i, l, c) => {
        const scheme = c[0];
        let path = c[1];

        let type;

        if (scheme === "page") {
          type = "component";
          const p = path.search("/");
          if (p !== -1) {
            path = path.slice(0, p);
          }
        } else if (scheme === "asset") {
          type = "asset";
          path = `asset://${path}`;
        }

        let target = Uri.parse(
          `command:ventmere-b2.resolve-link?${encodeURIComponent(
            JSON.stringify({
              documentUri: document.uri,
              type,
              path
            } as ResolveLinkTarget)
          )}`
        );

        result.push({
          range: new Range(document.positionAt(i), document.positionAt(i + l)),
          target
        });
      });
    } else if (ext === ".less") {
      searchAll(content, R_CSS_IMPORT, (i, l, c) => {
        const [path] = c;

        let target = Uri.parse(
          `command:ventmere-b2.resolve-link?${encodeURIComponent(
            JSON.stringify({
              documentUri: document.uri,
              type: "style",
              path
            } as ResolveLinkTarget)
          )}`
        );

        result.push({
          range: new Range(document.positionAt(i), document.positionAt(i + l)),
          target
        });
      });
    }

    return result;
  }
}
