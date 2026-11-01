import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionTerminal } from "@/features/office/components/SessionTerminal";

vi.mock("@xterm/xterm", () => ({ Terminal: class {
  textarea = document.createElement("textarea");
  cols = 80;
  rows = 24;
  options = {};
  open(host: HTMLElement) { host.append(this.textarea); }
  focus() { this.textarea.focus(); }
  loadAddon() {}
  reset() {}
  write() {}
  onData() { return { dispose() {} }; }
  onBinary() { return { dispose() {} }; }
  dispose() { this.textarea.remove(); }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([["Tab", "\t"], ["Esc", "\x1b"], ["Ctrl C", "\x03"]])(
  "returns focus to terminal input after tapping %s so the next paste reaches the terminal",
  async (label, value) => {
    const snapshot = { handle: "probe", running: true, exitCode: null, offset: 0, dataBase64: "" };
    const client = { call: vi.fn(async (method: string) => method === "session.terminal.subscribe" ? snapshot : {}) };
    render(createElement(SessionTerminal, { client, threadId: "probe-thread" }));
    const button = screen.getByRole("button", { name: label });
    await waitFor(() => expect(button).not.toBeDisabled());
    button.focus();
    fireEvent.click(button);
    expect(client.call).toHaveBeenCalledWith("session.terminal.write", { threadId: "probe-thread", handle: "probe", dataBase64: btoa(value) });
    expect(screen.getByRole("textbox", { name: "Terminal input" })).toHaveFocus();
  },
);
