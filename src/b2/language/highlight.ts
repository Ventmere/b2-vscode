import {
  TextDocument,
  Position,
  CancellationToken,
  ProviderResult,
  DocumentHighlight
} from "vscode";

export class HuzHighlightProvider {
  provideDocumentHighlights(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<DocumentHighlight[]> {
    console.log("highlight", position);
    return [];
  }
}
