import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionControls } from "../../src/features/office/components/SessionControls";
const snapshot = { connected: true, version: 1, activeTurnId: "turn", items: [], approvals: [] };
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("shared-session composer", () => {
  it("inserts repeated paste-event text even when the clipboard disappears before default paste", async () => {
    const call = vi.fn(async () => ({ ...snapshot, activeTurnId: null, features: { dictation: false, voice: false, prediction: false } }));
    const client = { call }, threadId = "transient-dictation-clipboard";
    const view = render(React.createElement(SessionControls, { client, threadId, onItems: vi.fn() }));
    const input = screen.getByRole("textbox", { name: "Send to session" }) as HTMLTextAreaElement;
    await waitFor(() => expect(input).toBeEnabled());
    const original = Object.getOwnPropertyDescriptor(document, "execCommand");
    const insert = vi.fn((_command: string, _ui: boolean, text: string) => {
      input.setRangeText(text, input.selectionStart, input.selectionEnd, "end"); return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: insert });
    try {
      input.focus();
      for (const text of ["第一段。", " 第二段。", "\n第三段。"])
        expect(fireEvent.paste(input, { clipboardData: { files: [], getData: () => text } })).toBe(false);
      input.setSelectionRange(0, 4);
      fireEvent.paste(input, { clipboardData: { files: [], getData: () => "替换段。" } });
      view.rerender(React.createElement(SessionControls, { client, threadId, onItems: vi.fn() }));
      expect(input).toHaveValue("替换段。 第二段。\n第三段。");
      expect(input.selectionStart).toBe(4); expect(input).toHaveFocus();
      expect(insert).toHaveBeenLastCalledWith("insertText", false, "替换段。");
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
      expect(call).not.toHaveBeenCalledWith("session.send", expect.anything());
    } finally {
      if (original) Object.defineProperty(document, "execCommand", original); else Reflect.deleteProperty(document, "execCommand");
    }
  });
  it("leaves default paste available when native insertion is unavailable", async () => {
    const call = vi.fn(async () => ({ ...snapshot, activeTurnId: null }));
    render(React.createElement(SessionControls, { client: { call }, threadId: "default-paste-fallback", onItems: vi.fn() }));
    const input = screen.getByRole("textbox", { name: "Send to session" });
    await waitFor(() => expect(input).toBeEnabled());
    const original = Object.getOwnPropertyDescriptor(document, "execCommand");
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
    try {
      expect(fireEvent.paste(input, { clipboardData: { files: [], getData: () => "ordinary paste" } })).toBe(true);
      expect(input).toHaveValue("");
    } finally {
      if (original) Object.defineProperty(document, "execCommand", original); else Reflect.deleteProperty(document, "execCommand");
    }
  });
  it("keeps text inserted by an external tool's value write and native input event", async () => {
    const call = vi.fn(async () => ({ ...snapshot, activeTurnId: null, features: { dictation: false, voice: false, prediction: false } }));
    const client = { call }, threadId = "external-value-and-input";
    const view = render(React.createElement(SessionControls, { client, threadId, onItems: vi.fn() }));
    const input = screen.getByRole("textbox", { name: "Send to session" }) as HTMLTextAreaElement;
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.input(input, { target: { value: "第一段。" } });
    // Some external editors write the DOM value before emitting input. React's
    // change tracker can suppress onChange even though a native input occurred.
    input.value += " 第二段。";
    fireEvent.input(input);
    view.rerender(React.createElement(SessionControls, { client, threadId, onItems: vi.fn() }));
    await act(async () => {});
    expect(input).toHaveValue("第一段。 第二段。");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });
  it("keeps one editable target and its draft across repeated external text insertions", async () => {
    const call = vi.fn(async () => ({ ...snapshot, activeTurnId: null, features: { dictation: false, voice: false, prediction: false } }));
    const view = render(React.createElement(SessionControls, { client: { call }, threadId: "external-dictation-target", onItems: vi.fn() }));
    const input = screen.getByRole("textbox", { name: "Send to session" }) as HTMLTextAreaElement;
    await waitFor(() => expect(input).toBeEnabled());
    Object.defineProperty(input, "clientWidth", { value: 600 });
    const extraInputs: HTMLTextAreaElement[] = [];
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLTextAreaElement && !node.disabled && !node.readOnly) extraInputs.push(node);
      }
    });
    observer.observe(view.container, { childList: true, subtree: true });
    try {
      input.focus();
      for (const value of ["第一段。", "第一段。 第二段。", "第一段。 第二段。 第三段。\n"]) {
        fireEvent.input(input, { target: { value } });
        await act(async () => {});
        expect(screen.getByRole("textbox", { name: "Send to session" })).toBe(input);
        expect(input).toHaveValue(value); expect(input).toHaveFocus();
      }
      expect(extraInputs).toEqual([]);
      expect(call).not.toHaveBeenCalledWith("session.send", expect.anything());
    } finally { observer.disconnect(); }
  });
  it("shows Play for an empty interrupted task and continues the same conversation once", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise(r => { resolve = r; });
    const call = vi.fn((method: string) => method === "session.continue" ? pending : Promise.resolve({ ...snapshot, activeTurnId: null, turnStatus: "interrupted" }));
    render(React.createElement(SessionControls, { client: { call }, threadId: "interrupted-play", onItems: vi.fn() }));
    const play = await screen.findByRole("button", { name: "Continue interrupted task" });
    expect(play.querySelector("svg")).not.toBeNull();
    fireEvent.click(play); fireEvent.click(play);
    expect(call.mock.calls.filter(([method]) => method === "session.continue")).toHaveLength(1);
    expect(call).toHaveBeenCalledWith("session.continue", { threadId: "interrupted-play", requestId: expect.any(String) });
    await act(async () => resolve({ status: "started" }));
  });
  it("keeps Send when an interrupted task has a typed follow-up", async () => {
    const call = vi.fn<(method: string) => Promise<unknown>>(async () => ({ ...snapshot, activeTurnId: null, turnStatus: "interrupted" }));
    render(React.createElement(SessionControls, { client: { call }, threadId: "interrupted-draft", onItems: vi.fn() }));
    await screen.findByRole("button", { name: "Continue interrupted task" });
    fireEvent.change(screen.getByLabelText("Send to session"), { target: { value: "Use this new direction" } });
    const send = screen.getByRole("button", { name: "Send" });
    send.focus(); fireEvent.click(send);
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "interrupted-draft", message: "Use this new direction" })));
    expect(call.mock.calls.some(([method]) => method === "session.continue")).toBe(false);
    await waitFor(() => expect(screen.getByLabelText("Send to session")).toHaveFocus());
  });
  it("keeps unavailable Codex speech buttons disabled while text chat remains usable", async () => {
    const call = vi.fn().mockResolvedValue({ ...snapshot, activeTurnId: null,
      features: { dictation: false, voice: false, prediction: false } });
    render(React.createElement(SessionControls, { client: { call }, threadId: "no-speech", onItems: vi.fn() }));
    const dictation = await screen.findByRole("button", { name: "Dictation" });
    const voice = screen.getByRole("button", { name: "Voice chat" });
    expect(dictation).toBeDisabled();
    expect(voice).toBeDisabled();
    fireEvent.click(dictation);
    fireEvent.click(voice);
    expect(call.mock.calls.map(([method]) => method)).toEqual(["session.attach"]);
    const input = screen.getByLabelText("Send to session");
    expect(input).not.toBeDisabled();
    fireEvent.change(input, { target: { value: "Text still works" } });
    expect(input).toHaveValue("Text still works");
  });
  it("shows a failed connection honestly and enables the same composer after reconnecting", async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error("Required MCP unavailable")).mockResolvedValue(snapshot);
    render(React.createElement(SessionControls, { client: { call }, threadId: "cold-original", onItems: vi.fn() }));
    await screen.findByText("Codex unavailable");
    expect(screen.queryByText("Connecting to Codex…")).toBeNull();
    expect((screen.getByLabelText("Send to session") as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect((screen.getByLabelText("Send to session") as HTMLTextAreaElement).disabled).toBe(false));
    expect(screen.queryByText("Required MCP unavailable")).toBeNull();
    expect(call.mock.calls.map(([method]) => method)).toEqual(["session.attach", "session.attach"]);
  });
  it("receives token appends directly over its subscription without live reads or polling", async () => {
    let listener!: (event: { event: string; payload?: unknown }) => void;
    const onItems = vi.fn();
    const call = vi.fn<(method: string, params: unknown) => Promise<{ subscribed: boolean }>>(async () => ({ subscribed: true }));
    const unsubscribe = vi.fn();
    const onEvent = vi.fn(handler => { listener = handler; return unsubscribe; });
    const view = render(React.createElement(SessionControls, { client: { call, onEvent }, threadId: "original", onItems }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    const params = call.mock.calls[0][1] as { subscriptionId: string };
    expect(call.mock.calls[0][0]).toBe("session.subscribe");
    const push = (version: number, items: unknown[], extra = {}) => listener({ event: "session.stream", payload: { ...snapshot, threadId: "original", subscriptionId: params.subscriptionId, version, items, ...extra } });
    await act(async () => push(1, [{ id: "m", role: "assistant", content: "Hello", version: 1 }]));
    await act(async () => push(2, [{ id: "m", role: "assistant", append: " world", baseVersion: 1, version: 2 }]));
    expect(onItems).toHaveBeenLastCalledWith([expect.objectContaining({ content: "Hello world", version: 2 })]);
    await act(async () => push(3, [{ id: "m", role: "assistant", content: "Final", status: "completed", version: 3 }]));
    expect(onItems).toHaveBeenLastCalledWith([expect.objectContaining({ content: "Final", status: "completed" })]);
    await act(async () => push(4, [], { threadId: "other" }));
    await act(async () => listener({ event: "session.updated", payload: { threadId: "original" } }));
    expect(onItems).toHaveBeenCalledTimes(3); expect(call).toHaveBeenCalledTimes(1);
    vi.useFakeTimers(); await act(async () => vi.advanceTimersByTime(60000)); vi.useRealTimers();
    expect(call).toHaveBeenCalledTimes(1);
    view.unmount(); expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenLastCalledWith("session.unsubscribe", { threadId: "original", subscriptionId: params.subscriptionId });
  });
  it("resubscribes on reconnection and ignores frames from a replaced subscription", async () => {
    let listener!: (event: { event: string; payload?: unknown }) => void;
    let status!: (value: "connected" | "disconnected") => void;
    const call = vi.fn<(method: string, params: unknown) => Promise<{ subscribed: boolean }>>(async () => ({ subscribed: true })), onItems = vi.fn();
    const client = { call, onEvent: (h: typeof listener) => { listener = h; return () => {}; }, onStatus: (h: typeof status) => { status = h; h("connected"); return () => {}; } };
    render(React.createElement(SessionControls, { client, threadId: "original", onItems }));
    await act(async () => {}); const first = (call.mock.calls[0][1] as { subscriptionId: string }).subscriptionId;
    await act(async () => status("disconnected")); await act(async () => status("connected"));
    const second = (call.mock.calls[1][1] as { subscriptionId: string }).subscriptionId;
    expect(second).not.toBe(first);
    await act(async () => listener({ event: "session.stream", payload: { ...snapshot, threadId: "original", subscriptionId: first, items: [{ id: "stale", content: "stale" }] } }));
    expect(onItems).not.toHaveBeenCalled();
    await act(async () => listener({ event: "session.stream", payload: { ...snapshot, version: 0, threadId: "original", subscriptionId: second } }));
    expect((screen.getByLabelText("Send to session") as HTMLTextAreaElement).disabled).toBe(false);
  });
  it("resynchronizes a missing append base with one new subscription instead of guessing or pulling", async () => {
    let listener!: (event: { event: string; payload?: unknown }) => void;
    const call = vi.fn<(method: string, params: unknown) => Promise<{ subscribed: boolean }>>(async () => ({ subscribed: true })), onItems = vi.fn();
    render(React.createElement(SessionControls, { client: { call, onEvent: h => { listener = h; return () => {}; } }, threadId: "original", onItems }));
    await act(async () => {});const id = (call.mock.calls[0][1] as { subscriptionId: string }).subscriptionId;
    await act(async () => listener({ event: "session.stream", payload: { ...snapshot, threadId: "original", subscriptionId: id, items: [{ id: "missing", append: "tail", baseVersion: 1, version: 2 }] } }));
    expect(onItems).not.toHaveBeenCalled(); expect(call.mock.calls.map(([method]) => method)).toEqual(["session.subscribe", "session.subscribe"]);
  });
  it("updates model and access labels from the native stream without polling or repeated catalog reads", async () => {
    let listener!: (event: { event: string; payload?: unknown }) => void, subscriptionId = "";
    const choices = { models: [{ id: "a", name: "Native A", efforts: ["high"], defaultEffort: "high" }, { id: "b", name: "Native B", efforts: ["high"], defaultEffort: "high" }], accessModes: [{ id: ":workspace", name: "Default permissions", allowed: true }, { id: ":danger-full-access", name: "Full access", allowed: true }] };
    const call = vi.fn(async (method: string, params: unknown) => {
      if (method === "session.subscribe") subscriptionId = (params as { subscriptionId: string }).subscriptionId;
      return method === "session.settings.choices" ? choices : { subscribed: true };
    });
    const client = { call, onEvent: (h: typeof listener) => { listener = h; return () => {}; } };
    render(React.createElement(SessionControls, { client, threadId: "original", onItems: vi.fn() }));
    await act(async () => {});
    const push = (version: number, model: string, accessMode: string) => listener({ event: "session.stream", payload: { ...snapshot, version, threadId: "original", subscriptionId, settings: { model, effort: "high", accessMode } } });
    await act(async () => push(1, "a", ":workspace"));
    expect(screen.getByRole("button", { name: "Model settings" }).textContent).toContain("Native A");
    await act(async () => push(2, "b", ":danger-full-access"));
    expect(screen.getByRole("button", { name: "Model settings" }).textContent).toContain("Native B");
    expect((screen.getByLabelText("Select access mode") as HTMLSelectElement).value).toBe(":danger-full-access");
    expect(call.mock.calls.map(([method]) => method)).toEqual(["session.subscribe", "session.settings.choices"]);
  });
  it("sends to the original thread once while a submission is pending", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise(r => { resolve = r; });
    const call = vi.fn((method: string) => method === "session.send" ? pending : Promise.resolve(snapshot));
    render(React.createElement(SessionControls, { client: { call }, threadId: "original", onItems: vi.fn() }));
    const input = screen.getByLabelText("Send to session");
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "hello" } });
    const button = screen.getByRole("button", { name: "Steer" });
    button.focus();
    fireEvent.click(button); fireEvent.click(button);
    expect(call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(1);
    expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "original", message: "hello", requestId: expect.any(String) }));
    await act(async () => resolve({ status: "steered" }));
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(input).toHaveFocus();
  });
  it("uses the exact cancel decision offered by the original server", async () => {
    const call = vi.fn(async () => ({ ...snapshot, approvals: [{ requestId: "approval", method: "item/commandExecution/requestApproval", params: { command: "echo fixture" }, decisions: ["accept", "cancel"], supported: true }] }));
    render(React.createElement(SessionControls, { client: { call }, threadId: "original", onItems: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel turn" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.approval.reply", { threadId: "original", requestId: "approval", decision: "cancel" }));
  });
  it("stops the original thread and leaves uncertain send text available for reconciliation", async () => {
    const call = vi.fn(async (method: string) => { if (method === "session.send") throw new Error("结果未确认"); return snapshot; });
    render(React.createElement(SessionControls, { client: { call }, threadId: "original", onItems: vi.fn() }));
    const stop = await screen.findByRole("button", { name: "Stop" });
    expect(stop.textContent).toBe("");
    expect(stop.querySelector("svg")).not.toBeNull();
    fireEvent.click(stop);
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.stop", { threadId: "original" }));
    const input = screen.getByLabelText("Send to session");
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: "keep draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await screen.findByRole("alert");
    expect((input as HTMLTextAreaElement).value).toBe("keep draft");
  });
});

it("uses canonical history after all bootstrap chunks and emits only subsequent live changes", async () => {
  let listener!: (event: { event: string; payload?: unknown }) => void, subscriptionId = "";
  const onItems = vi.fn(), onHistorySync = vi.fn();
  const call = vi.fn(async (method: string, params: unknown) => {
    if (method === "session.subscribe") subscriptionId = (params as { subscriptionId: string }).subscriptionId;
    return { subscribed: true };
  });
  render(React.createElement(SessionControls, { client: { call, onEvent: h => { listener = h; return () => {}; } }, threadId: "bootstrap-history", onItems, onHistorySync }));
  await act(async () => {});
  const push = (version: number, hasMore: boolean, content: string) => listener({ event: "session.stream", payload: { ...snapshot, version, hasMore, threadId: "bootstrap-history", subscriptionId, items: [{ id: String(version), role: "assistant", content, version }] } });
  await act(async () => push(1, true, "old cached answer"));
  expect(onItems).not.toHaveBeenCalled(); expect(onHistorySync).not.toHaveBeenCalled();
  await act(async () => push(2, false, "another cached answer"));
  expect(onItems).not.toHaveBeenCalled(); expect(onHistorySync).toHaveBeenCalledTimes(1);
  await act(async () => push(3, false, "genuinely new answer"));
  expect(onItems).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ content: "genuinely new answer" })]);
  expect(onHistorySync).toHaveBeenCalledTimes(1);
});
