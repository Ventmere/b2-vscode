import {
  TreeDataProvider,
  TreeItem,
  Command,
  TreeItemCollapsibleState,
  Event,
  ProviderResult,
  Uri
} from "vscode";
import { B2ExtContext } from ".";
import { B2 } from "b2-sdk";
import { B2ExtEntryState } from "./state";
import { B2ExtWorkspace } from "./workspace";
import { ResolveLinkTarget } from "../commands/resolve-link";
import { joinUriPath } from "./utils";

export class B2ExtTreeDataProvider implements TreeDataProvider<Node> {
  readonly onDidChangeTreeData: Event<Node | undefined>;
  constructor(private ctx: B2ExtContext) {
    this.onDidChangeTreeData = ctx.onDidChangeTreeData.event;
  }

  getTreeItem(element: Node): TreeItem | Thenable<TreeItem> {
    return element;
  }
  getChildren(element?: Node): ProviderResult<Node[]> {
    if (!element) {
      return this.ctx.getAllWorkspaces().map(workspace => {
        return new Node(
          {
            kind: Kind.App,
            workspace
          },
          TreeItemCollapsibleState.Expanded
        );
      });
    } else {
      const { type } = element;
      switch (type.kind) {
        case Kind.App:
          return type.workspace.entries.map(entry => {
            return new Node(
              {
                kind: Kind.Entry,
                workspace: type.workspace,
                entry
              },
              TreeItemCollapsibleState.Collapsed
            );
          });
        case Kind.Entry:
          return type.entry.getPageInfos().then(pages =>
            pages.map(page => {
              return new Node(
                {
                  kind: Kind.Page,
                  workspace: type.workspace,
                  entry: type.entry,
                  path: page.path,
                  handle: page.handle
                },
                TreeItemCollapsibleState.None
              );
            })
          );
        case Kind.Page:
          return [];
      }
    }
  }
}

enum Kind {
  App,
  Entry,
  Page
}

type NodeType = App | Entry | Page;

interface App {
  kind: Kind.App;
  workspace: B2ExtWorkspace;
}

interface Entry {
  kind: Kind.Entry;
  workspace: B2ExtWorkspace;
  entry: B2ExtEntryState;
}

interface Page {
  kind: Kind.Page;
  workspace: B2ExtWorkspace;
  entry: B2ExtEntryState;
  handle: string;
  path: string;
}

export class Node extends TreeItem {
  constructor(
    public readonly type: NodeType,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(getLabel(type), collapsibleState);
  }

  get id() {
    switch (this.type.kind) {
      case Kind.App:
        return this.type.workspace.app.publicURL;
      case Kind.Entry:
        return `${this.type.workspace.app.publicURL}|${this.type.entry.entry.path}`;
      case Kind.Page:
        return `${this.type.workspace.app.publicURL}|${this.type.entry.entry.path}|${this.type.entry.entry.path}|${this.type.handle}`;
    }
  }

  // get tooltip(): string {
  //   return `tooltip`;
  // }

  get description(): string {
    switch (this.type.kind) {
      case Kind.App:
        return this.type.workspace.app.publicURL;
      case Kind.Entry:
        return this.type.entry.entry.path;
      case Kind.Page:
        return this.type.path;
    }
  }

  get command(): Command | undefined {
    if (this.type.kind === Kind.Page) {
      return {
        title: "Open",
        command: "ventmere-b2.resolve-link",
        arguments: [
          {
            documentUri: joinUriPath(
              this.type.workspace.workspaceFolder.uri,
              this.type.entry.entryLocalPath
            ),
            type: "component",
            path: this.type.handle
          } as ResolveLinkTarget
        ]
      };
    }
  }

  contextValue = "page";
}

function getLabel(type: NodeType) {
  switch (type.kind) {
    case Kind.App: {
      return type.workspace.app.name;
    }
    case Kind.Entry: {
      return type.entry.name;
    }
    case Kind.Page: {
      return type.handle;
    }
  }
}
