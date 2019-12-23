import {
  Uri,
  window,
  languages,
  ExtensionContext,
  StatusBarItem,
  StatusBarAlignment,
  workspace,
  TextEditor,
  WorkspaceFoldersChangeEvent,
  TextDocument,
  Event,
  TextDocumentWillSaveEvent,
  EventEmitter,
  Disposable
} from "vscode";

import { StatusBar } from "./statusbar";
import { BehaviorSubject } from "rxjs";
import { WorkspaceRegistry, B2ExtDocInfo } from "./workspace";
import { Node } from "./tree-view";
import { B2ExtDocumentLinkProvider } from "./language";

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

  public readonly onDidChangeTreeData: EventEmitter<
    Node | undefined
  > = new EventEmitter();

  public get onDidChangeWorkspaces() {
    return this.connReg.onChange.event;
  }

  subscriptions: {
    dispose(): any;
  }[] = [];

  constructor(private ctx: ExtensionContext, statusBarItem: StatusBarItem) {
    this.statusBar = new StatusBar(statusBarItem);
    this.connReg = new WorkspaceRegistry(this._currentDocument);

    this.subscriptions.push(
      this.connReg.onChange.event(() => {
        this.onDidChangeTreeData.fire();
        this.registerProviders();
      })
    );

    this.subscriptions.push(
      workspace.onDidChangeWorkspaceFolders(this.handleChangeWorkspaceFolders)
    );

    this.subscriptions.push(
      window.onDidChangeActiveTextEditor(this.handleChangeActiveTextEditor)
    );

    this.subscriptions.push(
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
          info.entry && info.entry.name,
          info.ref && info.ref.handle
        );
      } else {
        this.statusBar.hide();
      }
      this._currentDocInfo = info;
    });

    if (workspace.workspaceFolders) {
      this.connReg.add(workspace.workspaceFolders);
    }
    if (window.activeTextEditor) {
      this.handleChangeActiveTextEditor(window.activeTextEditor);
    }
  }

  getAllWorkspaces() {
    return this.connReg.getAllWorkspaces();
  }

  getActiveWorkspace() {
    const all = this.getAllWorkspaces();
    if (all.length === 1) {
      return all[0];
    }

    if (!window.activeTextEditor) {
      return null;
    }

    const folder = workspace.getWorkspaceFolder(
      window.activeTextEditor.document.uri
    );
    return (
      this.getAllWorkspaces().find(w => w.workspaceFolder === folder) || null
    );
  }

  findDocInfo(doc: TextDocument | Uri) {
    return this.connReg.findDocInfo(doc);
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
    if (info && info.entry && info.ref) {
      info.entry.enqueueSave(info.ref);
    }
  };

  dispose() {
    this.subscriptions.forEach(s => s.dispose());
    this.connReg.dispose();
  }

  private _providers: Array<Disposable> = [];
  private registerProviders() {
    this._providers.forEach(p => p.dispose());
    this._providers.length = 0;
    this._providers.push(
      languages.registerDocumentLinkProvider(
        [
          { scheme: "file", language: "huz" },
          { scheme: "file", pattern: "**/*/*.less" }
        ],
        new B2ExtDocumentLinkProvider(this)
      )
    );
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
