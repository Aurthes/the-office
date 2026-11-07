import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExistingSessionPanel } from "@/features/office/components/ExistingSessionPanel";
import type { LiveSessionItem } from "@/features/office/components/SessionControls";

function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let serial = 0;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function fixture(initialRead?: ReturnType<typeof deferred>) {
  const threadId = `send-feedback-${++serial}`;
  const events = new Set<(event: { event: string; payload: unknown }) => void>();
  const statuses = new Set<(status: "connected" | "connecting" | "disconnected") => void>();
  const sends: { gate: ReturnType<typeof deferred>; params: { requestId: string; message: string; attachments: string[] } }[] = [];
  const history: LiveSessionItem[] = [{ id: "earlier", role: "user", content: "Earlier message" }];
  let subscriptionId = "", version = 0, reads = 0;
  const call = vi.fn(async (method: string, params: unknown) => {
    const p = params as { threadId: string; subscriptionId: string };
    if (method === "session.inspect") return { id: p.threadId, name: "Fixture", workspace: "/fixture", project: "Fixture", status: "running", controlsAvailable: true };
    if (method === "session.history") {
      if (++reads === 1 && initialRead) return initialRead.promise;
      return { threadId: p.threadId, messages: [...history], nextCursor: null };
    }
    if (method === "session.subscribe") subscriptionId = p.subscriptionId;
    if (method === "session.send") { const gate = deferred(); sends.push({ gate, params: params as typeof sends[number]["params"] }); return gate.promise; }
    return {};
  });
  const client = { call, onEvent: (cb: typeof events extends Set<infer T> ? T : never) => { events.add(cb); return () => { events.delete(cb); }; },
    onStatus: (cb: typeof statuses extends Set<infer T> ? T : never) => { statuses.add(cb); return () => { statuses.delete(cb); }; } };
  const props = { client, threadId };
  const view = render(React.createElement(ExistingSessionPanel, props));
  await waitFor(() => expect(subscriptionId).not.toBe(""));
  const push = async (items: LiveSessionItem[] = []) => act(async () => events.forEach(cb => cb({ event: "session.stream", payload: {
    threadId, subscriptionId, version: version++, connected: true, activeTurnId: "turn", turnStatus: "inProgress", approvals: [], items,
    features: { prediction: false, dictation: false, voice: false },
  } })));
  await push();
  const input = screen.getByRole("textbox", { name: "Send to session" });
  await waitFor(() => expect(input).toBeEnabled());
  const send = (text = "Same message") => { fireEvent.change(input, { target: { value: text } }); fireEvent.click(screen.getByRole("button", { name: "Steer" })); };
  const canonical = (index: number): LiveSessionItem => ({ id: `canonical-${index}`, clientId: sends[index].params.requestId, turnId: "turn", role: "user", content: sends[index].params.message });
  const reconnect = async () => { const old = subscriptionId; await act(async () => statuses.forEach(cb => cb("connected"))); await waitFor(() => expect(subscriptionId).not.toBe(old)); version = 0; await push(); };
  return { view, props, call, threadId, sends, history, input, send, canonical, push, statuses, reconnect };
}

it.each(["before", "after"])("shows immediately and reconciles canonical arriving %s the send ACK", async order => {
  const f = await fixture(); f.send("Visible immediately");
  expect(screen.getByText("Visible immediately", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByText("Waiting for receipt…")).toBeInTheDocument();
  expect(f.sends).toHaveLength(1);
  const canonical = f.canonical(0);
  if (order === "before") await f.push([canonical]);
  await act(async () => f.sends[0].gate.resolve({ status: "steered", turnId: "turn" }));
  if (order === "after") {
    expect(screen.getByText("Accepted · Waiting for message history")).toBeInTheDocument();
    await f.push([canonical]);
  }
  expect(screen.getAllByText("Visible immediately", { selector: "p" })).toHaveLength(1);
  expect(screen.queryByText(/Waiting for receipt|Waiting for message history/)).toBeNull();
  await f.push([canonical]);
  expect(screen.getAllByText("Visible immediately", { selector: "p" })).toHaveLength(1);
  expect(f.input).toHaveValue("");
});

it("reconciles a missing live notification through history after ACK", async () => {
  const f = await fixture(); f.send(); f.history.push(f.canonical(0));
  await act(async () => f.sends[0].gate.resolve({ status: "steered" }));
  await waitFor(() => expect(screen.queryByText(/Waiting for message history/)).toBeNull());
  expect(screen.getAllByText("Same message", { selector: "p" })).toHaveLength(1);
});

it("keeps one canonical message when history catches up before the send ACK", async () => {
  const f = await fixture(); f.send(); f.history.push(f.canonical(0));
  await f.reconnect();
  await waitFor(() => expect(screen.queryByText("Waiting for receipt…")).toBeNull());
  await act(async () => f.sends[0].gate.resolve({ status: "steered" }));
  expect(screen.getAllByText("Same message", { selector: "p" })).toHaveLength(1);
  expect(screen.queryByText(/Waiting for message history/)).toBeNull();
});

it("keeps consecutive identical sends distinct and never matches someone else's identical input", async () => {
  const f = await fixture(); f.send();
  await act(async () => f.sends[0].gate.resolve({ status: "steered" }));
  f.send();
  expect(f.sends[0].params.requestId).not.toBe(f.sends[1].params.requestId);
  await f.push([{ id: "external", clientId: "other-client", role: "user", turnId: "turn", content: "Same message" }, { id: "legacy", role: "user", content: "Same message" }]);
  expect(screen.getAllByText("Same message", { selector: "p" })).toHaveLength(4);
  await f.push([f.canonical(1), f.canonical(0)]);
  await act(async () => f.sends[1].gate.resolve({ status: "steered" }));
  expect(screen.getAllByText("Same message", { selector: "p" })).toHaveLength(4);
  expect(screen.queryByText(/Waiting for receipt|Waiting for message history/)).toBeNull();
});

it.each(["Gateway request timed out; result may be unknown", "Gateway closed; pending operations were not retried"])("retains uncertain delivery and recovers from late canonical history after %s", async message => {
  const f = await fixture(); f.send();
  await act(async () => f.sends[0].gate.reject(new Error(message)));
  expect(screen.getByText(/Delivery not confirmed/)).toBeInTheDocument();
  expect(f.input).toHaveValue("Same message");
  expect(f.sends).toHaveLength(1);
  await f.reconnect(); // Stale history must keep the local message.
  expect(screen.getByText(/Delivery not confirmed/)).toBeInTheDocument();
  f.history.push(f.canonical(0));
  await f.reconnect();
  await waitFor(() => expect(screen.queryByText(/Delivery not confirmed/)).toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getAllByText("Same message", { selector: "p" })).toHaveLength(1);
  expect(f.sends).toHaveLength(1);
});

it.each(["timeout", "refusal"])("does not show a contradictory %s error when canonical receipt precedes the failed RPC", async kind => {
  const f = await fixture(); f.send();
  await f.push([f.canonical(0)]);
  const error = kind === "timeout" ? new Error("Gateway request timed out") : Object.assign(new Error("Invalid request"), { code: "INVALID_REQUEST" });
  await act(async () => f.sends[0].gate.reject(error));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getAllByText("Same message", { selector: "p" })).toHaveLength(1);
  expect(f.sends).toHaveLength(1);
  expect(f.input).toHaveValue("Same message"); // Never erase a preserved draft on an uncertain RPC.
});

it("marks explicit refusal and retains the exact body and attachment for a deliberate retry", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ref: "fixture-upload" }) })));
  const f = await fixture();
  fireEvent.change(f.view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["fixture"], "evidence.txt")] } });
  fireEvent.change(f.input, { target: { value: "Retain this body" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Steer" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Steer" }));
  await act(async () => f.sends[0].gate.reject(Object.assign(new Error("Invalid request"), { code: "INVALID_REQUEST" })));
  expect(screen.getByText(/Message rejected · Draft and attachments kept/)).toBeInTheDocument();
  expect(f.input).toHaveValue("Retain this body");
  expect(within(screen.getByLabelText("Session history")).getByText("evidence.txt")).toBeInTheDocument();
  expect(f.sends).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Steer" }));
  expect(f.sends[1].params.attachments).toEqual(["fixture-upload"]);
  expect(f.sends[1].params.message).toBe("Retain this body");
  await act(async () => f.sends[1].gate.reject(Object.assign(new Error("Invalid request"), { code: "INVALID_REQUEST" })));
});

it("keeps attachment-only pending bubbles visible", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ref: "fixture-upload" }) })));
  const f = await fixture();
  fireEvent.change(f.view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["fixture"], "only.txt")] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Steer" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Steer" }));
  expect(within(screen.getByLabelText("Session history")).getByText("only.txt")).toBeInTheDocument();
  expect(screen.getByText("Waiting for receipt…")).toBeInTheDocument();
  await act(async () => f.sends[0].gate.reject(new Error("Connection closed")));
});

it("keeps pending input across a concurrent first history read and cached hidden/reopen navigation", async () => {
  const read = deferred(), f = await fixture(read); f.send();
  await act(async () => read.resolve({ threadId: f.threadId, messages: f.history, nextCursor: null }));
  expect(screen.getByText("Same message", { selector: "p" })).toBeInTheDocument();
  f.view.rerender(React.createElement(ExistingSessionPanel, { ...f.props, active: false }));
  await act(async () => f.sends[0].gate.resolve({ status: "steered" }));
  expect(screen.getByText(/Accepted · Waiting for message history/)).toBeInTheDocument();
  f.history.push(f.canonical(0));
  f.view.rerender(React.createElement(ExistingSessionPanel, f.props));
  await f.push();
  await waitFor(() => expect(screen.queryByText(/Waiting for message history/)).toBeNull());
  expect(screen.getAllByText("Same message", { selector: "p" })).toHaveLength(1);
});

it("does not let an old send callback inject its message into another thread", async () => {
  const f = await fixture(); f.send("Old thread message");
  f.view.rerender(React.createElement(ExistingSessionPanel, { ...f.props, threadId: "different-thread" }));
  await act(async () => f.sends[0].gate.resolve({ status: "steered" }));
  expect(screen.queryByText("Old thread message", { selector: "p" })).toBeNull();
});
