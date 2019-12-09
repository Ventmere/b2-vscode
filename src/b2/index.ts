import {
  Uri,
  window,
  ExtensionContext,
  StatusBarItem,
  StatusBarAlignment,
  workspace,
  TextEditor,
  WorkspaceFoldersChangeEvent,
  TextDocument,
  Event,
  TextDocumentWillSaveEvent
} from "vscode";

import { StatusBar } from "./statusbar";
import { BehaviorSubject } from "rxjs";
import { WorkspaceRegistry, B2ExtDocInfo } from "./workspace";

export class B2ExtContext {
  private statusBar: StatusBar;
  private connReg: WorkspaceRegistry;

  private _currentDocument = new BehaviorSubject<TextDocument | null>(null);
  get currentDocument$() {
    return this._currentDocument;
  }

  private _currentDocInfo: B2ExtDocInfo | null = null;
  get currentDocInfo() {
    return this._currentDocInfo;
  }

  constructor(private ctx: ExtensionContext, statusBarItem: StatusBarItem) {
    this.statusBar = new StatusBar(statusBarItem);
    this.connReg = new WorkspaceRegistry(this._currentDocument);

    ctx.subscriptions.push(
      workspace.onDidChangeWorkspaceFolders(this.handleChangeWorkspaceFolders)
    );

    if (workspace.workspaceFolders) {
      this.handleChangeWorkspaceFolders({
        added: workspace.workspaceFolders,
        removed: []
      });
    }

    ctx.subscriptions.push(
      window.onDidChangeActiveTextEditor(this.handleChangeActiveTextEditor)
    );

    if (window.activeTextEditor) {
      this.handleChangeActiveTextEditor(window.activeTextEditor);
    }

    ctx.subscriptions.push(
      workspace.onDidSaveTextDocument(this.handleDidSaveTextDocument)
    );

    this.connReg.currentDocInfo$.subscribe(info => {
      if (info) {
        console.log(
          info.workspace.app.name,
          info.entry && info.entry.name,
          info.ref
        );
        this.statusBar.setPath(
          info.workspace.app.name,
          info.entry && info.entry.name
        );
      } else {
        this.statusBar.hide();
      }
      this._currentDocInfo = info;
    });
  }

  getAllWorkspaces() {
    return this.connReg.getAllWorkspaces();
  }

  handleChangeWorkspaceFolders = (e: WorkspaceFoldersChangeEvent) => {
    if (e.added.length) {
      this.connReg.add(e.added);
    }
    if (e.removed.length) {
      this.connReg.remove(e.removed);
    }
  };

  handleChangeActiveTextEditor = (e?: TextEditor) => {
    if (e) {
      this._currentDocument.next(e.document);
    } else {
      this._currentDocument.next(null);
    }
  };

  handleDidSaveTextDocument = (doc: TextDocument) => {
    const info = this.connReg.findDocInfo(doc);
    if (info && info.ref) {
      window.showInformationMessage(`Saving ${info.ref.handle}`);
    }
  };

  dispose() {
    this.connReg.dispose();
  }
}

export function init(ctx: ExtensionContext) {
  const statusBarItem = window.createStatusBarItem(
    StatusBarAlignment.Left,
    100
  );

  statusBarItem.show();
  ctx.subscriptions.push(statusBarItem);

  return new B2ExtContext(ctx, statusBarItem);
}
