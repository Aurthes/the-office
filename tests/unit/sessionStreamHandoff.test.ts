import React from "react";
import { createRequire } from "node:module";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RetainedSessionPanels } from "../../src/features/office/components/RetainedSessionPanels";
import { ExistingSessionPanel } from "../../src/features/office/components/ExistingSessionPanel";
import type { LiveSessionItem, SessionClient } from "../../src/features/office/components/SessionControls";

const { CodexSessionStream } = createRequire(import.meta.url)("../../server/codex-session-stream.js");
afterEach(cleanup);

function setup() {
  const events = new Set<(event: { event: string; payload?: unknown }) => void>();
  const statuses = new Set<(status: "connected" | "disconnected") => void>();
  const gaps = new Set<(gap: { expected: number; received: number }) => void>();
  const states = new Map(["A", "B"].map(id => [id, { version: 1, activeTurnId: null as string | null, items: [] as LiveSessionItem[] }]));
  const histories = new Map(["A", "B"].map(id => [id, [message(`${id}-older`), message(`${id}-latest`)]]));
  const native = {
    attach: vi.fn(async () => {}),
    snapshot: (id: string) => ({ ...states.get(id), connected: true, approvals: [], features: { prediction: false, voice: false, dictation: false } }),
  };
  const ws = { readyState: 1, bufferedAmount: 0, send: (raw: string) => events.forEach(handler => handler(JSON.parse(raw))), close: vi.fn() };
  const stream = new CodexSessionStream(native, { delay: 0 });
  const call = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
    const p = params as { threadId: string; subscriptionId: string; cursor?: string; message?: string; requestId?: string };
    if (method === "session.subscribe") return stream.subscribe(ws, p.threadId, p.subscriptionId);
    if (method === "session.unsubscribe") return stream.unsubscribe(ws, p.subscriptionId);
    if (method === "session.inspect") return { id: p.threadId, name: p.threadId, workspace: "/repo", project: "Project", controlsAvailable: true };
    if (method === "session.history") {
      const all = histories.get(p.threadId)!;
      const end = p.cursor ? Number(p.cursor) : all.length, start = Math.max(0, end - 2);
      return { threadId: p.threadId, messages: all.slice(start, end), nextCursor: start ? String(start) : null };
    }
    if (method === "session.send") {
      change(p.threadId, [{ ...message(p.message!, "user"), clientId: p.requestId }], "working");
      return { status: "started" };
    }
    return {};
  });
  const client: SessionClient = {
    call,
    onEvent: (handler: (event: { event: string; payload?: unknown }) => void) => { events.add(handler); return () => { events.delete(handler); }; },
    onStatus: handler => { statuses.add(handler); handler("connected"); return () => { statuses.delete(handler); }; },
    onGap: handler => { gaps.add(handler); return () => { gaps.delete(handler); }; },
  };
  function change(id: string, items: LiveSessionItem[], activeTurnId: string | null) {
    histories.get(id)!.push(...items);
    const state = states.get(id)!; state.items = items; state.activeTurnId = activeTurnId; state.version++;
    stream.changed(id);
  }
  const panel = (activeId: string | null) => React.createElement(RetainedSessionPanels, { activeId, sessionIds: ["A", "B"],
    renderPanel: (threadId, state) => React.createElement(ExistingSessionPanel, { client, threadId, ...state }) });
  return { panel, call, stream, ws, states, histories, change, statuses, gaps, native };
}
const message = (id: string, role = "assistant"): LiveSessionItem => ({ id, role, content: id, status: "completed" });

it("hands the real single-socket stream back to a cached session and shows submitted messages and turn state", async () => {
  const { panel, call, stream, ws, change, statuses, gaps } = setup();
  const view = render(panel("A")); await screen.findByText("A-latest");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Send to session" })).toBeEnabled());
  const original = within(screen.getByRole("region", { name: "Codex session" })).getByLabelText("Session history");
  view.rerender(panel("B")); await screen.findByRole("heading", { name: "B" });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Send to session" })).toBeEnabled());
  expect(stream.subscriptions.get(ws).threadId).toBe("B");
  await act(async () => change("A", [message("hidden prompt", "user")], "hidden-turn"));
  view.rerender(panel("A"));
  await screen.findByText("hidden prompt");
  expect(within(screen.getByRole("region", { name: "Codex session" })).getByLabelText("Session history")).toBe(original);
  expect(screen.getByText("Codex is working…")).toBeInTheDocument();
  expect(stream.subscriptions.get(ws).threadId).toBe("A");
  await act(async () => change("A", [], null));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
  fireEvent.change(screen.getByRole("textbox", { name: "Send to session" }), { target: { value: "visible prompt" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("visible prompt");
  expect(screen.getByText("Codex is working…")).toBeInTheDocument();
  // Background panels must not steal the stream when the tab wakes or the
  // transport reconnects/reports a gap. Closing chat releases just the stream.
  for (const trigger of [
    () => document.dispatchEvent(new Event("visibilitychange")),
    () => { statuses.forEach(handler => handler("disconnected")); stream.disconnected(ws); statuses.forEach(handler => handler("connected")); },
    () => gaps.forEach(handler => handler({ expected: 1, received: 3 })),
  ]) {
    call.mockClear(); await act(async () => { trigger(); });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Send to session" })).toBeEnabled());
    expect(call.mock.calls.filter(([method]) => method === "session.subscribe").map(([, p]) => (p as { threadId: string }).threadId)).toEqual(["A"]);
    expect(stream.subscriptions.get(ws).threadId).toBe("A");
  }
  view.rerender(panel(null)); expect(stream.subscriptions.size).toBe(0);
  view.rerender(panel("A")); await screen.findByText("visible prompt");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Send to session" })).toBeEnabled());
  expect(stream.subscriptions.get(ws).threadId).toBe("A");
});

it("fills a multi-page missed gap in order while preserving older history, cursor and reading position", async () => {
  const { panel, call, stream, ws, histories, change } = setup();
  histories.set("A", Array.from({ length: 6 }, (_, index) => message(`A-${index}`)));
  const view = render(panel("A")); await screen.findByText("A-5");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Send to session" })).toBeEnabled());
  const original = within(screen.getByRole("region", { name: "Codex session" })).getByLabelText("Session history");
  Object.defineProperty(original, "scrollHeight", { value: 1200 }); Object.defineProperty(original, "clientHeight", { value: 400 });
  fireEvent.click(screen.getByRole("button", { name: /Load older messages/ })); await screen.findByText("A-2");
  original.scrollTop = 350; fireEvent.scroll(original);
  view.rerender(panel("B")); await screen.findByRole("heading", { name: "B" });
  await act(async () => change("A", Array.from({ length: 5 }, (_, index) => message(`new-${index}`, index % 2 ? "assistant" : "user")), "hidden-turn"));
  // Even a cold/empty stream cache must catch up from persistent history.
  stream.disconnected(ws); const state = stream.controls.snapshot("A");
  stream.controls.snapshot = (id: string) => id === "A" ? { ...state, items: [] } : { connected: true, version: 1, activeTurnId: null, items: [], approvals: [] };
  call.mockClear(); view.rerender(panel("A")); await screen.findByText("new-4");
  expect(within(screen.getByRole("region", { name: "Codex session" })).getByLabelText("Session history")).toBe(original); expect(original.scrollTop).toBe(350);
  expect(screen.getAllByRole("article").map(article => article.dataset.messageId)).toEqual(["A-2", "A-3", "A-4", "A-5", "new-0", "new-1", "new-2", "new-3", "new-4"]);
  expect(call.mock.calls.filter(([method]) => method === "session.history").map(([, p]) => (p as { cursor?: string }).cursor)).toEqual([undefined, "9", "7"]);
  fireEvent.click(screen.getByRole("button", { name: /Load older messages/ })); await screen.findByText("A-0");
  expect(call).toHaveBeenLastCalledWith("session.history", { threadId: "A", cursor: "2" });
});

it("does not let a slow abandoned attachment replace the currently visible conversation", async () => {
  const { panel, native, stream, ws } = setup();
  let finish!: () => void;
  native.attach.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(panel("A")); await screen.findByRole("heading", { name: "A" });
  view.rerender(panel("B")); await waitFor(() => expect(screen.getByRole("textbox", { name: "Send to session" })).toBeEnabled());
  await act(async () => finish());
  expect(stream.subscriptions.get(ws).threadId).toBe("B");
  view.rerender(panel("A")); await waitFor(() => expect(screen.getByRole("textbox", { name: "Send to session" })).toBeEnabled());
  expect(stream.subscriptions.get(ws).threadId).toBe("A");
});
