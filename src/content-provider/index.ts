import {
  TextDocumentContentProvider,
  Uri,
  CancellationToken,
  ProviderResult,
  window,
  EventEmitter,
  workspace
} from "vscode";
import { B2ExtContext } from "../b2";
import { B2ExtWorkspace } from "../b2/workspace";

export class B2ExtContentProvider implements TextDocumentContentProvider {
  private documents = new Map<string, string>();

  updateUri(uri: Uri, content: string) {
    const uriString = uri.toString();
    this.documents.set(uriString, content);
    this._onDidChange.fire(uri);
  }

  private _onDidChange = new EventEmitter<Uri>();
  get onDidChange() {
    return this._onDidChange.event;
  }

  private _subscriptions: Array<{
    dispose: () => void;
  }> = [];

  constructor(private ctx: B2ExtContext) {
    this._subscriptions.push(
      workspace.onDidCloseTextDocument(doc =>
        this.documents.delete(doc.uri.toString())
      )
    );
  }

  dispose() {
    this._subscriptions.forEach(s => s.dispose());
  }

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
      default:
        return this.documents.get(uri.toString()) || "Loading...";
    }
  }
}
