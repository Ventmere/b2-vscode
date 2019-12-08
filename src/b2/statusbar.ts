import { StatusBarItem, ThemeColor } from "vscode";

export class StatusBar {
  constructor(private item: StatusBarItem) {
    item.text = "B2";
  }

  private setErrorColor() {
    this.item.color = new ThemeColor("errorForeground");
  }

  setText(text: string) {
    this.item.text = `B2: ${text}`;
  }

  setPath(app: string, entry: string | null) {
    if (entry) {
      this.setText(`${app} / ${entry}`);
    } else {
      this.setText(app);
    }
    this.item.show();
  }

  hide() {
    this.item.hide();
  }

  setErrorMessage(msg: string) {
    this.setErrorColor();
    this.setText(msg);
  }
}
