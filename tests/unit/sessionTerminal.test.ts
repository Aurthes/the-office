import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionTerminal } from "@/features/office/components/SessionTerminal";
import { RetainedSessionPanels } from "@/features/office/components/RetainedSessionPanels";
import type { SessionClient } from "@/features/office/components/SessionControls";

const output = vi.hoisted(() => ({ reset: vi.fn(), write: vi.fn() }));

vi.mock("@xterm/xterm", () => ({ Terminal: class {
  textarea = document.createElement("textarea");
  cols = 80;
  rows = 24;
  options = {};
  open(host: HTMLElement) { host.append(this.textarea); }
  focus() { this.textarea.focus(); }
  loadAddon() {}
  reset = output.reset;
  write = output.write;
  onData() { return { dispose() {} }; }
  onBinary() { return { dispose() {} }; }
  dispose() { this.textarea.remove(); }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));

beforeEach(() => {
  output.reset.mockClear(); output.write.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

it("retains xterm while handing output subscriptions to the active session, including reconnect and hidden eviction", async () => {
  let owner: string | null = null;
  let textA = "old";
  const statuses = new Set<(status: "connected" | "disconnected") => void>();
  const call = vi.fn(async (method: string, params: unknown) => {
    const { threadId } = params as { threadId: string };
    if (method === "session.terminal.unsubscribe") { owner = null; return {}; }
    if (method === "session.terminal.subscribe") {
      owner = threadId;
      const text = threadId === "A" ? textA : "old";
      return { handle: threadId, running: true, exitCode: null, offset: text.length, dataBase64: btoa(text) };
    }
    return {};
  });
  const client: SessionClient = { call, onStatus: handler => { statuses.add(handler); handler("connected"); return () => { statuses.delete(handler); }; } };
  const panel = (activeId: string, sessionIds = ["A", "B"]) => createElement(RetainedSessionPanels, { activeId, sessionIds,
    renderPanel: (threadId, state) => createElement(SessionTerminal, { client, threadId, active: state.active }) });
  const view = render(panel("A")); await waitFor(() => expect(screen.getByRole("button", { name: "Tab" })).toBeEnabled());
  const input = screen.getByRole("textbox", { name: "Terminal input" }); expect(owner).toBe("A");
  view.rerender(panel("B")); await waitFor(() => expect(screen.getByRole("button", { name: "Tab" })).toBeEnabled());
  expect(owner).toBe("B"); expect(output.reset).toHaveBeenCalledTimes(2);
  view.rerender(panel("A")); await waitFor(() => expect(screen.getByRole("button", { name: "Tab" })).toBeEnabled());
  expect(owner).toBe("A"); expect(screen.getByRole("textbox", { name: "Terminal input" })).toBe(input);
  expect(output.reset).toHaveBeenCalledTimes(2); // Unchanged output keeps viewport/selection.
  view.rerender(panel("B")); await waitFor(() => expect(owner).toBe("B"));
  textA = "oldmissed"; output.write.mockClear();
  view.rerender(panel("A")); await waitFor(() => expect(screen.getByRole("button", { name: "Tab" })).toBeEnabled());
  expect(output.write).toHaveBeenCalledTimes(1);
  expect(Array.from(output.write.mock.calls[0][0])).toEqual(Array.from(new TextEncoder().encode("missed")));
  expect(output.reset).toHaveBeenCalledTimes(2);
  call.mockClear();
  await act(async () => { statuses.forEach(handler => handler("disconnected")); owner = null; statuses.forEach(handler => handler("connected")); });
  expect(owner).toBe("A");
  expect(call.mock.calls.filter(([method]) => method === "session.terminal.subscribe")).toHaveLength(1);
  call.mockClear(); view.rerender(panel("A", ["A"]));
  expect(owner).toBe("A"); expect(call).not.toHaveBeenCalledWith("session.terminal.unsubscribe", { threadId: "B" });
  view.unmount(); expect(owner).toBeNull();
});

it("reclaims the output stream after returning while an old subscription response is still pending", async () => {
  let owner: string | null = null, finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; }); let delayed = true;
  const client = { call: vi.fn(async (method: string, params: unknown) => {
    const { threadId } = params as { threadId: string };
    if (method === "session.terminal.unsubscribe") { owner = null; return {}; }
    if (method === "session.terminal.subscribe") {
      owner = threadId;
      if (threadId === "A" && delayed) { delayed = false; await pending; }
      return { handle: threadId, running: true, offset: 0, dataBase64: "", exitCode: null };
    }
    return {};
  }) };
  const panel = (activeId: string) => createElement(RetainedSessionPanels, { activeId, sessionIds: ["A", "B"],
    renderPanel: (threadId, state) => createElement(SessionTerminal, { client, threadId, active: state.active }) });
  const view = render(panel("A")); await waitFor(() => expect(owner).toBe("A"));
  view.rerender(panel("B")); await waitFor(() => expect(owner).toBe("B"));
  view.rerender(panel("A")); await act(async () => finish());
  await waitFor(() => expect(screen.getByRole("button", { name: "Tab" })).toBeEnabled());
  expect(owner).toBe("A");
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

it("retries the connection without reloading when the terminal code loaded successfully", async () => {
  const snapshot = { handle: "probe", running: true, exitCode: null, offset: 0, dataBase64: "" };
  const client = { call: vi.fn().mockRejectedValueOnce(new Error("Connection unavailable")).mockResolvedValue(snapshot) };
  render(createElement(SessionTerminal, { client, threadId: "server-a" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection unavailable");
  expect(screen.queryByRole("button", { name: "Reload page" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Tab" })).toBeEnabled());
  expect(client.call).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});
