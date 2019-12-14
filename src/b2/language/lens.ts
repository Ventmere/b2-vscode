import {
  CodeLensProvider,
  EventEmitter,
  TextDocument,
  CancellationToken,
  ProviderResult,
  CodeLens,
  Range,
  Position,
  Disposable
} from "vscode";
import { B2ExtContext } from "..";
import { B2ExtObjectType } from "../state";
import { ResolveLinkTarget } from "../../commands/resolve-link";

export class B2ExtCodeLensProvider implements CodeLensProvider {
  private _onDidChangeCodeLenses = new EventEmitter<void>();
  subscriptions: Disposable[] = [];

  constructor(private ctx: B2ExtContext) {
    this.subscriptions.push(
      ctx.onDidChangeWorkspaces(() => {
        this._onDidChangeCodeLenses.fire();
      })
    );
  }

  dispose() {
    this.subscriptions.forEach(s => s.dispose());
  }

  get onDidChangeCodeLenses() {
    return this._onDidChangeCodeLenses.event;
  }

  provideCodeLenses(
    document: TextDocument,
    token: CancellationToken
  ): ProviderResult<CodeLens[]> {
    const info = this.ctx.findDocInfo(document.uri);
    if (!info || !info.entry || !info.ref) {
      return;
    }

    if (info.ref.type === B2ExtObjectType.Controller) {
      return [
        new CodeLens(new Range(new Position(0, 1), new Position(0, 2)), {
          title: "Run Controller",
          command: "ventmere-b2.run-controller"
        })
      ];
    } else if (info.ref.type === B2ExtObjectType.Component) {
      const r = /"(controller_id"\s*:\s*")([a-f0-9\-]*)"/g;
      const match = r.exec(document.getText());
      if (match) {
        const range = new Range(
          document.positionAt(match.index),
          document.positionAt(match.index + match[0].length)
        );
        const id = match[2];
        if (id) {
          const handle = info.entry.getHandleById(id);
          if (handle) {
            return [
              new CodeLens(range, {
                title: `Controller: ${handle}`,
                tooltip: "Click to select controller",
                command: "ventmere-b2.insert-controller-id",
                arguments: [match.index + match[1].length + 1, id.length]
              }),
              new CodeLens(range, {
                title: `Open Controller`,
                command: "ventmere-b2.resolve-link",
                arguments: [
                  {
                    type: "controller",
                    path: handle,
                    documentUri: document.uri
                  } as ResolveLinkTarget
                ]
              })
            ];
          } else {
            return [
              new CodeLens(range, {
                title: `Unknown Controller ID`,
                tooltip: "Click to select controller",
                command: "ventmere-b2.insert-controller-id",
                arguments: [match.index + match[1].length + 1, id.length]
              })
            ];
          }
        } else {
          return [
            new CodeLens(range, {
              title: "Select Controller",
              command: "ventmere-b2.insert-controller-id",
              arguments: [match.index + match[1].length + 1]
            })
          ];
        }
      } else {
        return [];
      }
    } else {
      return [];
    }
  }
}
