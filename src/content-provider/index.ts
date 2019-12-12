import {
  TextDocumentContentProvider,
  Uri,
  CancellationToken,
  ProviderResult,
  window
} from "vscode";
import { B2ExtContext } from "../b2";
import { B2ExtWorkspace } from "../b2/workspace";

export class B2ExtContentProvider implements TextDocumentContentProvider {
  constructor(private ctx: B2ExtContext) {}

  provideTextDocumentContent(
    uri: Uri,
    token: CancellationToken
  ): ProviderResult<string> {
    const w = this.ctx.getActiveWorkspace();

    if (!w) {
      window.showWarningMessage("No active workspace.");
      return;
    }

    switch (uri.path) {
      case "modules.json":
        return JSON.stringify(w.app.modules, null, "  ");
      case "providers.json":
        return w.app.archive.inspect().then(v => JSON.stringify(v, null, "  "));
    }
  }
}
