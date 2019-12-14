import {
  CompletionItemProvider,
  TextDocument,
  Position,
  ProviderResult,
  CompletionItem,
  CompletionList,
  CompletionContext,
  CancellationToken,
  Range,
  CompletionItemKind,
  TextEdit,
  CompletionTriggerKind
} from "vscode";
import { B2ExtContext } from "..";
import { B2ExtObjectType } from "../state";
import { getDocumentLineBeforePosition } from "../utils";
import { B2ExtWorkspace } from "../workspace";
import { extname } from "path";

function getModuleIdCompletionItems(
  document: TextDocument,
  position: Position,
  workspace: B2ExtWorkspace
): CompletionItem[] {
  return workspace.appConfig.pageModuleIds.map(id => {
    const item = new CompletionItem(`${id}`, CompletionItemKind.Folder);
    return item;
  });
}

export class B2ExtCompletionProvider implements CompletionItemProvider {
  constructor(private ctx: B2ExtContext) {}

  provideCompletionItems(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context: CompletionContext
  ): ProviderResult<CompletionItem[] | CompletionList> {
    const info = this.ctx.findDocInfo(document.uri);
    if (!info || !info.entry || !info.ref) {
      return;
    }

    const type = info.ref.type;

    if (type !== B2ExtObjectType.Component && type !== B2ExtObjectType.Style) {
      return;
    }

    // cross entry handle
    if (context.triggerCharacter === ":") {
      // {{>lib:
      // @import "lib:
      const r = /(?:{{\s*[<>]\s*|@import\s+")(\w+):$/;
      const line = getDocumentLineBeforePosition(document, position);
      const match = r.exec(line);
      if (!match) {
        return;
      }
      const moduleId = match[1];
      const entry = info.workspace.appConfig.getEntryByPageModuleId(moduleId);
      if (!entry) {
        return;
      }
      if (type === B2ExtObjectType.Component) {
        return entry
          .getComponentHandles()
          .map(handle => new CompletionItem(handle, CompletionItemKind.File));
      } else if (type === B2ExtObjectType.Style) {
        return entry
          .getStyleHandles()
          .map(handle => new CompletionItem(handle, CompletionItemKind.File));
      } else {
        return;
      }
    }

    const ext = extname(document.uri.path);

    if (type === B2ExtObjectType.Component && ext === ".huz") {
      // partial name
      if (
        context.triggerCharacter === "<" ||
        context.triggerCharacter === ">" ||
        context.triggerCharacter === "/"
      ) {
        const r = /{{\s*[<>]|"\s*page:\/\/$/;
        const line = getDocumentLineBeforePosition(document, position);
        if (!r.test(line)) {
          return;
        }
        return [
          ...info.entry
            .getComponentHandles()
            .map(handle => new CompletionItem(handle, CompletionItemKind.File)),
          ...getModuleIdCompletionItems(document, position, info.workspace)
        ];
      }
    } else if (
      (type === B2ExtObjectType.Component && ext === ".less") ||
      type === B2ExtObjectType.Style
    ) {
      // less name
      if (context.triggerCharacter !== '"') {
        return;
      }

      const r = /@import\s+"$/;
      const line = getDocumentLineBeforePosition(document, position);
      if (!r.test(line)) {
        return;
      }

      return [
        ...info.entry
          .getStyleHandles()
          .map(handle => new CompletionItem(handle, CompletionItemKind.File)),
        ...getModuleIdCompletionItems(document, position, info.workspace)
      ];
    }
  }
}
