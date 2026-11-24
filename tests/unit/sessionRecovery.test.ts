import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionControls, type SessionClient } from "../../src/features/office/components/SessionControls";
import { recoveryLabel } from "../../src/features/office/components/SessionRecovery";
import { SessionTranscript } from "../../src/features/office/components/SessionTranscript";
afterEach(() => { cleanup(); vi.useRealTimers(); });
const modelRecovery = { layer: "model" as const, turnId: "current", phase: "reconnecting" as const, message: "Connection failed", code: "responseStreamConnectionFailed", willRetry: true, attempt: null, maxAttempts: null, nextRetryAt: null };
function fixture(threadId = "faulty") {
  let subscriptionId = "", version = 0, currentThread = threadId;
  const events = new Set<(event: { event: string; payload?: unknown }) => void>();
  const statuses = new Set<(status: "connected" | "connecting" | "disconnected") => void>();
  const call = vi.fn(async (method: string, params: unknown) => {
    if (method === "session.subscribe") { const p = params as { subscriptionId: string; threadId: string }; subscriptionId = p.subscriptionId; currentThread = p.threadId; }
    return {};
  });
  const client: SessionClient = { call, onEvent: handler => { events.add(handler); return () => { events.delete(handler); }; }, onStatus: handler => { statuses.add(handler); return () => { statuses.delete(handler); }; } };
  const props = { client, threadId, onItems: vi.fn(), onRecoveryChange: vi.fn(), onActiveTurnChange: vi.fn() };
  const view = render(React.createElement(SessionControls, props));
  const push = (extra = {}, scope = { threadId: currentThread, subscriptionId }) => events.forEach(handler => handler({ event: "session.stream", payload: { connected: true, version: ++version, activeTurnId: "current", turnStatus: "inProgress", items: [], approvals: [], features: { prediction: false, voice: false, dictation: false }, ...extra, ...scope } }));
  return { props, view, call, push, statuses, scope: () => ({ threadId: currentThread, subscriptionId }) };
}
it("replaces Working on native failure, preserves Stop and draft, and only a recovery snapshot clears it", async () => {
  const f = fixture(); await act(async () => f.push());
  expect(screen.getByText("Codex is working…")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Send to session" }), { target: { value: "Keep my draft" } });
  await act(async () => f.push({ modelRecovery }));
  expect(screen.queryByText("Codex is working…")).toBeNull();
  expect(screen.getByText("Native retry count and next retry time are not available.")).toBeInTheDocument();
  expect(f.props.onActiveTurnChange).toHaveBeenLastCalledWith("current");
  expect(f.props.onRecoveryChange).toHaveBeenLastCalledWith("Model connection problem · Reconnecting…");
  expect(screen.getByRole("textbox", { name: "Send to session" })).toHaveValue("Keep my draft");
  fireEvent.change(screen.getByRole("textbox", { name: "Send to session" }), { target: { value: "" } });
  expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
  expect(f.call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
  await act(async () => f.push({ modelRecovery: null }));
  expect(screen.getByText("Codex is working…")).toBeInTheDocument();
});
it("shows true outer countdown and bounded attempt without a second request timer", async () => {
  vi.useFakeTimers(); const f = fixture("outer");
  await act(async () => f.push({ activeTurnId: null, turnStatus: "failed", modelRecovery, retryAt: Date.now() + 15000, retryAttempt: 2, retryMaxAttempts: 3 }));
  expect(screen.getByText(/Attempt 2 of 3/)).toBeInTheDocument();
  expect(screen.queryByText("Codex is working…")).toBeNull();
  await act(async () => vi.advanceTimersByTime(4000));
  expect(screen.getByText(/Retrying in 11 seconds/)).toBeInTheDocument();
  expect(f.call.mock.calls.map(([method]) => method)).toEqual(["session.subscribe"]);
});
it("distinguishes browser/Office disconnection and ignores stale snapshots when switching/reconnecting", async () => {
  const f = fixture("first"); await act(async () => f.push({ modelRecovery })); const old = f.scope();
  await act(async () => f.statuses.forEach(handler => handler("disconnected")));
  expect(screen.getByText("Browser → Office disconnected. Reconnecting…")).toBeInTheDocument();
  expect(screen.queryByText("Codex is working…")).toBeNull();
  f.view.rerender(React.createElement(SessionControls, { ...f.props, threadId: "second" }));
  await waitFor(() => expect(f.scope().threadId).toBe("second"));
  await act(async () => { f.push({ modelRecovery }, old); f.push({ modelRecovery: null }); });
  expect(screen.queryByText("Connection failed")).toBeNull();
  expect(screen.getByText("Codex is working…")).toBeInTheDocument();
});
it("does not call access/limit errors normal connection recovery and keeps explicit Stop visible", () => {
  expect(recoveryLabel({ modelRecovery: { ...modelRecovery, phase: "action_required" } })).toMatch(/Sign-in/);
  expect(recoveryLabel({ modelRecovery: { ...modelRecovery, phase: "rate_limited" } })).toMatch(/Rate or usage/);
  expect(recoveryLabel({ modelRecovery, retryStopped: true })).toBe("Model · Recovery stopped");
});
it("adds the same recovery label to current work process while retaining canonical turn identity", () => {
  render(React.createElement(SessionTranscript, { activeTurnId: "current", recoveryStatus: "Model connection problem · Reconnecting…", messages: [{ id: "current:item", turnId: "current", role: "assistant", phase: "commentary", content: "Work already done" }] }));
  expect(screen.getByText("Model connection problem · Reconnecting…")).toBeInTheDocument();
  expect(screen.getByText("Work already done")).toBeInTheDocument();
});
