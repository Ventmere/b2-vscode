import * as vscode from "vscode";
import * as path from "path";

const CONFIG_FILENAME = "b2config.json";

export interface B2Config {
  endpoint: string;
  token: string;
}

export async function loadConfigFile(root: vscode.Uri): Promise<B2Config> {
  const filePath = root.with({ path: path.join(root.fsPath, CONFIG_FILENAME) });
  const data = await vscode.workspace.fs.readFile(filePath);
  const config: B2Config = JSON.parse(data.toString());
  if (!config.endpoint || !config.token) {
    throw new Error(`B2: Invalid config file.`);
  }
  return config;
}
