import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionControls } from "../../src/features/office/components/SessionControls";
afterEach(cleanup);
const snapshot = { connected: true, version: 1, activeTurnId: null, turnStatus: "completed", items: [], approvals: [] };
function mount(id: string, sendError = false) {
  const call = vi.fn(async (method: string) => {
    if (method === "session.prediction") return { text: "Run the tests", sourceTurnId: "done" };
    if (method === "session.send" && sendError) throw new Error("Send failed");
    return snapshot;
  });
  render(React.createElement(SessionControls, { client: { call }, threadId: id, onItems: vi.fn() }));
  return call;
}
describe("composer prediction interaction", () => {
  it("renders grey placeholder text and Tab accepts an editable draft without sending", async () => {
    const call = mount("prediction-tab");
    const input = await screen.findByPlaceholderText("Run the tests") as HTMLTextAreaElement;
    expect(input.value).toBe(""); fireEvent.keyDown(input, { key: "Tab" });
    expect(input.value).toBe("Run the tests");
    expect(call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
  });
  it("Send and Enter can explicitly submit the displayed suggestion", async () => {
    const call = mount("prediction-send");
    await screen.findByPlaceholderText("Run the tests"); fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "prediction-send", message: "Run the tests" })));
    cleanup(); const enter = mount("prediction-enter");
    fireEvent.keyDown(await screen.findByPlaceholderText("Run the tests"), { key: "Enter" });
    await waitFor(() => expect(enter).toHaveBeenCalledWith("session.send", expect.objectContaining({ message: "Run the tests" })));
  });
  it("preserves the user's own typing and a failed suggestion submission", async () => {
    const call = mount("prediction-custom");
    const input = await screen.findByPlaceholderText("Run the tests"); fireEvent.change(input, { target: { value: "My own prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ message: "My own prompt" })));
    cleanup(); mount("prediction-failed", true);
    await screen.findByPlaceholderText("Run the tests"); fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Send failed"); expect((screen.getByLabelText("Send to session") as HTMLTextAreaElement).value).toBe("Run the tests");
  });
  it("does not accept a composing/modified Tab and Escape dismisses the suggestion", async () => {
    const call = mount("prediction-keys"); const input = await screen.findByPlaceholderText("Run the tests") as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true }); expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "Tab", isComposing: true }); expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "Escape" }); expect(screen.queryByPlaceholderText("Run the tests")).toBeNull();
    expect(call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
  });
  it("ignores an old prediction if another turn starts while it is being generated", async () => {
    const listeners = new Set<(event: { event: string; payload: unknown }) => void>();
    const push = (payload: unknown) => listeners.forEach(listener => listener({ event: "session.stream", payload }));
    let resolve!: (value: unknown) => void, subscriptionId = "";
    const call = vi.fn(async (method: string, params: unknown) => {
      if (method === "session.subscribe") subscriptionId = (params as { subscriptionId: string }).subscriptionId;
      if (method === "session.prediction") return new Promise(r => { resolve = r; });
      return {};
    });
    render(React.createElement(SessionControls, { client: { call, onEvent: h => { listeners.add(h); return () => { listeners.delete(h); }; } }, threadId: "prediction-stale", onItems: vi.fn() }));
    await act(async () => push({ ...snapshot, threadId: "prediction-stale", subscriptionId }));
    await act(async () => push({ ...snapshot, version: 2, activeTurnId: "new", turnStatus: "inProgress", threadId: "prediction-stale", subscriptionId }));
    await act(async () => resolve({ text: "Stale prediction" })); expect(screen.queryByPlaceholderText("Stale prediction")).toBeNull();
  });
  it("receives a completed-turn prediction by push while the composer stays usable", async () => {
    const listeners = new Set<(event: { event: string; payload?: unknown }) => void>();
    let subscriptionId = "", requestId = "";
    const call = vi.fn(async (method: string, params: unknown) => {
      if (method === "session.subscribe") subscriptionId = (params as { subscriptionId: string }).subscriptionId;
      if (method === "session.prediction") requestId = (params as { requestId: string }).requestId;
      return { pending: true };
    });
    const emit = (event: string, payload: unknown) => listeners.forEach(h => h({ event, payload }));
    render(React.createElement(SessionControls, { client: { call, onEvent: h => { listeners.add(h); return () => { listeners.delete(h); }; } }, threadId: "prediction-push", onItems: vi.fn() }));
    await act(async () => emit("session.stream", { ...snapshot, activeTurnId: "working", turnStatus: "inProgress", threadId: "prediction-push", subscriptionId }));
    await act(async () => emit("session.stream", { ...snapshot, version: 2, threadId: "prediction-push", subscriptionId }));
    expect(call).toHaveBeenCalledWith("session.prediction", expect.objectContaining({ generationTrigger: "live", requestId }));
    expect((screen.getByLabelText("Send to session") as HTMLTextAreaElement).disabled).toBe(false);
    await act(async () => emit("session.prediction", { threadId: "prediction-push", requestId: "wrong", prediction: { text: "Wrong" } }));
    expect(screen.queryByPlaceholderText("Wrong")).toBeNull();
    await act(async () => emit("session.prediction", { threadId: "prediction-push", requestId, prediction: { text: "Arrived by push" } }));
    expect(screen.getByPlaceholderText("Arrived by push")).toBeTruthy();
  });
});
