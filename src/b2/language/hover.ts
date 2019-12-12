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

const R_PARTIAL_LINK = /(?<={{\s*[<>]\s*)([:a-zA-Z0-9_\-]+)(?=\s*?}})/g;
const R_HUZ_LINK = /(?<=")(page|asset):\/\/([\-a-zA-Z0-9@:%._+~#=\/]+)(?=")/g;

export class B2DocumentLinkProvider implements DocumentLinkProvider {
  constructor(private ctx: B2ExtContext) {}

  provideDocumentLinks(
    document: TextDocument,
    token: CancellationToken
  ): ProviderResult<DocumentLink[]> {
    const content = document.getText();
    const result: DocumentLink[] = [];

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

      console.log(c);
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

    return result;
  }
}

function searchAll<T>(
  str: string,
  re: RegExp,
  extract: (index: number, length: number, captures: string[]) => T
): T[] {
  re.lastIndex = 0;
  const result = [];
  let match;
  while ((match = re.exec(str)) != null) {
    result.push(extract(match.index, match[0].length, match.slice(1)));
  }
  re.lastIndex = 0;
  return result;
}
