import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionControls } from "../../src/features/office/components/SessionControls";
const snapshot = { connected: true, version: 1, activeTurnId: null, items: [], approvals: [], features: { composer: true, chatReferences: true, dictation: false, voice: false, prediction: false } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function edit(input: HTMLElement, value: string, start = (input as HTMLTextAreaElement).value.length, end = start, caret = value.length) {
  (input as HTMLTextAreaElement).setSelectionRange(start, end); fireEvent.select(input);
  fireEvent.change(input, { target: { value, selectionStart: caret, selectionEnd: caret } });
}
function fixture(id: string, extra = {}, props: Partial<React.ComponentProps<typeof SessionControls>> = {}) {
  const call = vi.fn(async (method: string, params: unknown) => {
    const p = params as { kind?: string; query?: string };
    if (method === "session.send") return { status: "started", turnId: "fixture-turn" };
    if (method === "session.composer.options") return { options: (p.kind === "command" ? [{ kind: "command", id: "compact", name: "/compact", description: "Compact context" }] : p.kind === "task" ? [37, 38].map(i => ({ kind: "task", id: `12345678-1234-4234-8234-${String(i).padStart(12, "0")}`, name: `T${i} Same title`, description: "Project" })) : [{ kind: "chat", id: "target", name: "Target worker", description: "Project" }]).filter(item => item.name.includes(p.query || "")) };
    return { ...snapshot, ...extra };
  });
  render(React.createElement(SessionControls, { client: { call }, threadId: id, onItems: vi.fn(), ...props }));
  return call;
}
describe("native composer menu", () => {
  it("opens literal @task search and sends the selected UUID without creating or starting any task", async () => {
    const call = fixture("composer-task-selection");
    const input = screen.getByLabelText("Send to session"); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "@task T37" } });
    fireEvent.click(await screen.findByRole("option", { name: /T37 Same title/ }));
    expect(call).toHaveBeenCalledWith("session.composer.options", { threadId: "composer-task-selection", kind: "task", query: "T37" });
    expect(input).toHaveValue("@T37 Same title ");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ references: [{ kind: "task", id: "12345678-1234-4234-8234-000000000037", name: "T37 Same title", start: 0, end: 15 }] })));
    expect(call.mock.calls.some(([method]) => method.startsWith("todo."))).toBe(false);
  });
  it("switches task and chat categories and preserves task identities through rich copy/paste", async () => {
    const call = fixture("composer-task-clipboard");
    const input = screen.getByLabelText("Send to session") as HTMLTextAreaElement; await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "@task" } }); await screen.findAllByRole("option");
    fireEvent.click(screen.getByRole("button", { name: "Workers / chats" }));
    expect(await screen.findByRole("option", { name: /Target worker/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    fireEvent.click(await screen.findByRole("option", { name: /T38 Same title/ }));
    input.focus(); input.setSelectionRange(0, 15); fireEvent.select(input);
    const values = new Map<string, string>();
    const clipboardData = { files: [], setData: (type: string, value: string) => values.set(type, value), getData: (type: string) => values.get(type) || "" };
    fireEvent.copy(input, { clipboardData });
    expect(values.get("text/plain")).toBe("@T38 Same title"); expect(values.get("text/react-mentions")).toContain("office-ref:");
    input.setSelectionRange(16, 16); fireEvent.select(input); fireEvent.paste(input, { clipboardData });
    expect(input).toHaveValue("@T38 Same title @T38 Same title");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ references: [
      expect.objectContaining({ kind: "task", id: "12345678-1234-4234-8234-000000000038", start: 0, end: 15 }),
      expect.objectContaining({ kind: "task", id: "12345678-1234-4234-8234-000000000038", start: 16, end: 31 }),
    ] })));
  });
  it("opens an empty menu immediately and still debounces changing search text", async () => {
    const call = fixture("composer-menu-latency");
    const input = screen.getByLabelText("Send to session"); await waitFor(() => expect(input).toBeEnabled());
    vi.useFakeTimers(); call.mockClear();
    fireEvent.change(input, { target: { value: "/" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(call).toHaveBeenCalledWith("session.composer.options", { threadId: "composer-menu-latency", kind: "command", query: "" });
    call.mockClear(); fireEvent.change(input, { target: { value: "/c" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(79); });
    expect(call).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "/co" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(79); });
    expect(call).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(call).toHaveBeenCalledExactlyOnceWith("session.composer.options", { threadId: "composer-menu-latency", kind: "command", query: "co" });
  });
  it("routes slash fork through the cloning scene owner without a duplicate RPC or model message", async () => {
    const onFork=vi.fn(),call=fixture("source",{}, {onFork});
    const input=screen.getByLabelText("Send to session");await waitFor(()=>expect(input).toBeEnabled());
    fireEvent.change(input,{target:{value:"/fork New explorer"}});fireEvent.keyDown(input,{key:"Enter"});
    await waitFor(()=>expect(onFork).toHaveBeenCalledWith("New explorer"));
    expect(call.mock.calls.some(([method])=>["session.fork","session.send"].includes(method))).toBe(false);
    expect(input).toHaveValue("");
  });
  it("executes compact through its RPC on selection, never as a model prompt", async () => {
    const call = fixture("native-compact");
    const input = screen.getByLabelText("Send to session"); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "/comp" } });
    fireEvent.click(await screen.findByRole("option", { name: /\/compact/ }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.compact", expect.objectContaining({ threadId: "native-compact", requestId: expect.any(String) })));
    expect(call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
    await waitFor(() => expect(input).toHaveValue(""));
  });
  it("keeps unsupported slash commands out of the model conversation", async () => {
    const call = fixture("unknown-native-command");
    const input = screen.getByLabelText("Send to session"); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "/not-a-command" } }); fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Unsupported command. Type / to see available commands.")).toBeVisible();
    expect(input).toHaveValue("/not-a-command");
    expect(call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
  });
  it("selects an Office chat as a reference and submits its identity with the user message", async () => {
    const call = fixture("native-chat-reference");
    const input = screen.getByLabelText("Send to session"); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "@Target" } });
    fireEvent.click(await screen.findByRole("option", { name: /Target worker/ }));
    expect(input).toHaveValue("@Target worker ");
    expect(screen.queryByLabelText("Message references")).toBeNull();
    edit(input, "@Target worker Summarize it");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ message: "@Target worker Summarize it", references: [{ kind: "chat", id: "target", name: "Target worker", start: 0, end: 14 }] })));
    await waitFor(() => expect(input).toHaveValue(""));
  });
  it("shows the older-thread limit without pretending to attach a working reference", async () => {
    const call = fixture("legacy-native-reference", { features: { ...snapshot.features, chatReferences: false } });
    const input = screen.getByLabelText("Send to session"); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "@Target" } });
    const option = await screen.findByRole("option", { name: /Target worker/ }); fireEvent.click(option);
    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/This older chat has no Office reference tools/)).toBeVisible();
    expect(screen.queryByLabelText("Message references")).toBeNull();
    expect(call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
  });
  it("does not submit while composing with an IME, and Escape dismisses the menu", async () => {
    const call = fixture("native-composer-ime");
    const input = screen.getByLabelText("Send to session"); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "/comp" } }); await screen.findByRole("option");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(call.mock.calls.some(([method]) => method === "session.compact" || method === "session.send")).toBe(false);
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Codex commands")).toBeNull());
  });
  it("keeps selected references and the draft after a failed send", async () => {
    const call = fixture("native-composer-failed-send");
    const original = call.getMockImplementation()!;
    call.mockImplementation(async (method, params) => { if (method === "session.send") throw new Error("Temporary send failure"); return original(method, params); });
    const input = screen.getByLabelText("Send to session"); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "@Target" } }); fireEvent.click(await screen.findByRole("option"));
    edit(input, "@Target worker Keep my draft"); fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Temporary send failure");
    expect(input).toHaveValue("@Target worker Keep my draft");
    expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ references: [expect.objectContaining({ id: "target", start: 0, end: 14 })] }));
  });
  it("inserts at the caret without moving the suffix, and keeps repeated occurrences", async () => {
    const call = fixture("inline-middle-repeated");
    const input = screen.getByLabelText("Send to session") as HTMLTextAreaElement;
    await waitFor(() => expect(input).toBeEnabled());
    edit(input, "Use @Target then compare");
    input.setSelectionRange(11, 11); fireEvent.select(input);
    fireEvent.click(await screen.findByRole("option"));
    expect(input).toHaveValue("Use @Target worker then compare");
    expect(input.selectionStart).toBe(18);
    edit(input, input.value + " @Target");
    fireEvent.click(await screen.findByRole("option"));
    expect(input).toHaveValue("Use @Target worker then compare @Target worker ");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({
      message: "Use @Target worker then compare @Target worker ",
      references: [
        { kind: "chat", id: "target", name: "Target worker", start: 4, end: 18 },
        { kind: "chat", id: "target", name: "Target worker", start: 32, end: 46 },
      ],
    })));
  });
  it("removes the identity when its inline text is deleted", async () => {
    const call = fixture("inline-delete");
    const input = screen.getByLabelText("Send to session") as HTMLTextAreaElement;
    await waitFor(() => expect(input).toBeEnabled());
    edit(input, "@Target"); fireEvent.click(await screen.findByRole("option"));
    edit(input, "Replacement", 0, input.value.length);
    expect(input).toHaveValue("Replacement");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ message: "Replacement", references: [] })));
  });
  it("copies and pastes an inline reference with its identity and position", async () => {
    const call = fixture("inline-clipboard");
    const input = screen.getByLabelText("Send to session") as HTMLTextAreaElement;
    await waitFor(() => expect(input).toBeEnabled());
    edit(input, "@Target"); fireEvent.click(await screen.findByRole("option"));
    input.focus(); input.setSelectionRange(0, 14); fireEvent.select(input);
    const values = new Map<string, string>();
    const clipboardData = { files: [], setData: (type: string, value: string) => values.set(type, value), getData: (type: string) => values.get(type) || "" };
    fireEvent.copy(input, { clipboardData });
    expect(values.get("text/plain")).toBe("@Target worker");
    expect(values.get("text/react-mentions")).toContain("office-ref:");
    input.setSelectionRange(15, 15); fireEvent.select(input);
    fireEvent.paste(input, { clipboardData });
    expect(input).toHaveValue("@Target worker @Target worker");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ references: [
      expect.objectContaining({ id: "target", start: 0, end: 14 }),
      expect.objectContaining({ id: "target", start: 15, end: 29 }),
    ] })));
  });
  it("keeps mobile keyboards closed after a native command completes", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const call = fixture("native-composer-touch");
    const input = screen.getByLabelText("Send to session"); await waitFor(() => expect(input).toBeEnabled());
    expect(input).not.toHaveFocus(); fireEvent.change(input, { target: { value: "/compact" } });
    const send = screen.getByRole("button", { name: "Send" }); send.focus(); fireEvent.click(send);
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.compact", expect.anything()));
    await act(async () => {}); expect(input).not.toHaveFocus();
  });
});
