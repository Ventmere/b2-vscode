import {
  Uri,
  window,
  ExtensionContext,
  StatusBarItem,
  StatusBarAlignment,
  workspace,
  TextEditor,
  WorkspaceFoldersChangeEvent,
  TextDocument
} from "vscode";

import { StatusBar } from "./statusbar";
import { BehaviorSubject } from "rxjs";
import { ConnRegistry, B2ExtCurrentEntry } from "./conn";

export class B2ExtContext {
  private statusBar: StatusBar;
  private connReg: ConnRegistry;

  private _currentDocument = new BehaviorSubject<TextDocument | null>(null);
  get currentDocument$() {
    return this._currentDocument;
  }

  private _currentEntry: B2ExtCurrentEntry | null = null;
  get currentEntry() {
    return this._currentEntry;
  }

  constructor(private ctx: ExtensionContext, statusBarItem: StatusBarItem) {
    this.statusBar = new StatusBar(statusBarItem);
    this.connReg = new ConnRegistry(this._currentDocument);

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

    this.connReg.currentEntry$.subscribe(e => {
      if (e) {
        this.statusBar.setPath(e.app.name, e.entryName);
      } else {
        this.statusBar.hide();
      }
      this._currentEntry = e;
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
