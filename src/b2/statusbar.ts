import { StatusBarItem, ThemeColor } from "vscode";

export class StatusBar {
  constructor(private item: StatusBarItem) {
    item.text = "B2";
  }

  private setErrorColor() {
    this.item.color = new ThemeColor("errorForeground");
  }

  setText(text: string) {
    this.item.text = `${text}`;
  }

  setPath(app: string, entry?: string, handle?: string) {
    this.setText(
      [app, entry, handle].filter(v => !!v).join(" $(chevron-right) ")
    );
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
