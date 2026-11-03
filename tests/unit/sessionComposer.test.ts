import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionControls } from "../../src/features/office/components/SessionControls";
const snapshot = { connected: true, version: 1, activeTurnId: null, items: [], approvals: [], features: { composer: true, chatReferences: true, dictation: false, voice: false, prediction: false } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fixture(id: string, extra = {}, props: Partial<React.ComponentProps<typeof SessionControls>> = {}) {
  const call = vi.fn(async (method: string, params: unknown) => {
    const p = params as { kind?: string; query?: string };
    if (method === "session.composer.options") return { options: (p.kind === "command" ? [{ kind: "command", id: "compact", name: "/compact", description: "Compact context" }] : [{ kind: "chat", id: "target", name: "Target worker", description: "Project" }]).filter(item => item.name.includes(p.query || "")) };
    return { ...snapshot, ...extra };
  });
  render(React.createElement(SessionControls, { client: { call }, threadId: id, onItems: vi.fn(), ...props }));
  return call;
}
describe("native composer menu", () => {
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
    expect(screen.getByLabelText("Message references")).toHaveTextContent("@Target worker");
    fireEvent.change(input, { target: { value: "Summarize it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ message: "Summarize it", references: [{ kind: "chat", id: "target", name: "Target worker" }] })));
    await waitFor(() => expect(screen.queryByLabelText("Message references")).toBeNull());
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
    fireEvent.change(input, { target: { value: "Keep my draft" } }); fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Temporary send failure");
    expect(input).toHaveValue("Keep my draft"); expect(screen.getByLabelText("Message references")).toHaveTextContent("Target worker");
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
