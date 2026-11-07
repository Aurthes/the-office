import React from "react";
import { createRequire } from "node:module";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionControls } from "../../src/features/office/components/SessionControls";
import { ExistingSessionPanel } from "../../src/features/office/components/ExistingSessionPanel";
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls.js");
const { CodexSessionStream } = createRequire(import.meta.url)("../../server/codex-session-stream.js");
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const textItem = (id: string, text: string) => ({ type: "item", turnId: "stopped", item: { id, type: "userMessage", clientId: id, content: [{ type: "text", text }] } });
function nativeFixture() {
  let turns = [{ id: "stopped", status: "interrupted" }];
  let entries: object[] = [{ type: "turnStarted", turnId: "stopped" }, textItem("initial", "Original question"), textItem("steer-a", "First steer"), textItem("steer-b", "Second steer")];
  const history = { read: () => "0", reset: vi.fn(), refused: vi.fn() };
  const client = { ready: true, call: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method: string) => {
    if (method === "thread/turns/list") return { data: turns };
    if (method === "thread/timeline/list") return { data: entries, nextCursor: null };
    if (method === "thread/revert") { turns = []; entries = []; return { thread: { turns: [] }, turnsBackwardsCursor: "retained" }; }
    if (method === "turn/start") { turns = [{ id: "edited", status: "inProgress" }]; return { turn: { id: "edited" } }; }
    return {};
  }) };
  const controls = new CodexSessionControls(client, () => [], { history, changed: vi.fn() });
  return { client, controls, history, replace: (next: object[]) => { entries = next; }, turn: (status: string, id = "stopped") => { turns = [{ id, status }]; } };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("native whole-turn edit", () => {
  it("prepares all raw inputs in native order, including backward pages, without rewinding", async () => {
    const { client, controls } = nativeFixture();
    const original = client.call.getMockImplementation()!;
    client.call.mockImplementation(async (method: string, ...args: unknown[]) => {
      if (method === "thread/timeline/list") return (args[0] as { cursor?: string }).cursor
        ? { data: [{ type: "turnStarted", turnId: "stopped" }, textItem("initial", "Original question")], nextCursor: null }
        : { data: [textItem("steer-a", "First steer"), textItem("steer-b", "Second steer")], nextCursor: "older" };
      return original(method);
    });
    const edit = await controls.prepareEdit("id");
    expect(edit).toMatchObject({ turnId: "stopped", inputCount: 3, text: "Original question\n\nFirst steer\n\nSecond steer" });
    expect(client.call.mock.calls.some(([m]) => m === "thread/revert" || m === "turn/start")).toBe(false);
    expect(controls.state("id").recovery.stopped).toBe(true);
  });
  it("rechecks the tip, then reverts and starts exactly one edited input with a fresh identity", async () => {
    const { client, controls, history } = nativeFixture();
    const edit = await controls.prepareEdit("id"); client.call.mockClear();
    expect(await controls.commitEdit("id", { token: edit.token, message: "Edited text", requestId: "fresh-edit" })).toMatchObject({ status: "edited" });
    expect(client.call.mock.calls.map(([m]) => m)).toEqual(["thread/turns/list", "thread/timeline/list", "thread/revert", "thread/turns/list", "turn/start"]);
    expect(client.call).toHaveBeenCalledWith("thread/revert", { threadId: "id", beforeTurnId: "stopped" });
    expect(client.call).toHaveBeenCalledWith("turn/start", expect.objectContaining({ clientUserMessageId: "fresh-edit", input: [{ type: "text", text: "Edited text" }] }));
    expect(history.reset).toHaveBeenCalledTimes(2);
    expect(controls.snapshot("id").historyEpoch).not.toBe("0");
    // Late native notifications cannot revive the removed turn or its retry.
    controls.handle({ method: "item/completed", params: { threadId: "id", turnId: "stopped", item: { id: "old", type: "agentMessage", text: "deleted" } } });
    expect(controls.snapshot("id").items).toEqual([]); controls.close();
  });
  it.each(["inProgress", "completed", "failed"])("requires a real interrupted terminal state, not a stop acknowledgement (%s)", async status => {
    const { controls, turn } = nativeFixture(); turn(status);
    await expect(controls.prepareEdit("id")).rejects.toThrow("stopped"); controls.close();
  });
  it("refuses a changed steer or a new native tip without truncating anything", async () => {
    const { client, controls, replace, turn } = nativeFixture();
    const edit = await controls.prepareEdit("id");
    replace([{ type: "turnStarted", turnId: "stopped" }, textItem("new-steer", "Newer input")]);
    await expect(controls.commitEdit("id", { token: edit.token, message: "edit", requestId: "stale" })).rejects.toThrow("changed");
    turn("inProgress", "new-turn");
    await expect(controls.commitEdit("id", { token: edit.token, message: "edit", requestId: "stale-2" })).rejects.toThrow("stopped");
    expect(client.call.mock.calls.some(([m]) => m === "thread/revert")).toBe(false); controls.close();
  });
  it("guards only the committing thread, including sends already preparing", async () => {
    const { client, controls } = nativeFixture(); const edit = await controls.prepareEdit("id");
    const hold = deferred(), original = client.call.getMockImplementation()!;
    client.call.mockImplementation(async (method: string) => method === "thread/revert" ? hold.promise : original(method));
    const commit = controls.commitEdit("id", { token: edit.token, message: "edit", requestId: "commit" });
    await waitFor(() => expect(client.call).toHaveBeenCalledWith("thread/revert", expect.anything()));
    await expect(controls.send("id", "competing input", "race")).rejects.toThrow("committed");
    await controls.send("other", "unrelated", "other-send");
    hold.resolve({}); await commit;
    controls.state("id").pendingSends++;
    await expect(controls.prepareEdit("id")).rejects.toThrow("pending input"); controls.close();
  });
  it.each(["# Files mentioned by the user:\n\n## My request for Codex:\ntext", "[@worker](thread://id)", "@\"/some/file\"", "<realtime_delegation><input>voice</input></realtime_delegation>"])("refuses unrecoverable rich/voice wrappers: %s", async text => {
    const { controls, replace } = nativeFixture(); replace([{ type: "turnStarted", turnId: "stopped" }, textItem("rich", text)]);
    await expect(controls.prepareEdit("id")).rejects.toThrow("ordinary text"); controls.close();
  });
  it("refuses local images and incomplete raw input without using display text", async () => {
    const { controls, replace } = nativeFixture();
    replace([{ type: "turnStarted", turnId: "stopped" }, { type: "item", turnId: "stopped", item: { id: "image", type: "userMessage", content: [{ type: "localImage", path: "/image" }] } }]);
    await expect(controls.prepareEdit("id")).rejects.toThrow("ordinary text");
    replace([textItem("missing-boundary", "text")]);
    await expect(controls.prepareEdit("id")).rejects.toThrow("full interrupted turn"); controls.close();
  });
  it.each([false, true])("keeps text and never sends after an unknown rewind (native completed=%s)", async completed => {
    const { client, controls, turn } = nativeFixture(); const edit = await controls.prepareEdit("id"), original = client.call.getMockImplementation()!;
    client.call.mockImplementation(async (method: string) => { if (method === "thread/revert") { if (completed) turn("completed", "earlier"); throw new Error("timeout"); } return original(method); });
    expect(await controls.commitEdit("id", { token: edit.token, message: "keep this", requestId: "unknown" })).toMatchObject({ status: "revert_unknown", message: expect.stringContaining("not sent") });
    expect(client.call.mock.calls.filter(([m]) => m === "thread/revert")).toHaveLength(1);
    expect(client.call.mock.calls.some(([m]) => m === "turn/start")).toBe(false); controls.close();
  });
  it.each(["ephemeral threads do not support thread/revert", "legacy history unsupported"])("reports an explicit native refusal without resending: %s", async error => {
    const { client, controls } = nativeFixture(); const edit = await controls.prepareEdit("id"), original = client.call.getMockImplementation()!;
    client.call.mockImplementation(async (method: string) => { if (method === "thread/revert") throw Object.assign(new Error(error), { code: -32600 }); return original(method); });
    expect(await controls.commitEdit("id", { token: edit.token, message: "text", requestId: "refused" })).toMatchObject({ status: "revert_failed", message: expect.stringContaining(error) });
    expect(client.call.mock.calls.some(([m]) => m === "turn/start")).toBe(false); controls.close();
  });
  it("reports partial success after a successful rewind and a failed new send", async () => {
    const { client, controls } = nativeFixture(); const edit = await controls.prepareEdit("id"), original = client.call.getMockImplementation()!;
    client.call.mockImplementation(async (method: string) => { if (method === "turn/start") throw new Error("disconnected"); return original(method); });
    expect(await controls.commitEdit("id", { token: edit.token, message: "retain", requestId: "partial" })).toMatchObject({ status: "send_unknown", message: expect.stringContaining("History was rewound") });
    expect(controls.state("id").recovery.stopped).toBe(true); expect(controls.state("id").retry).toBeFalsy(); controls.close();
  });
  it("clears stream append baselines on a history epoch change", async () => {
    vi.useFakeTimers(); const { controls } = nativeFixture(); const stream = new CodexSessionStream(controls);
    const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() };
    const emit = (text: string) => controls.handle({ method: "item/started", params: { threadId: "id", turnId: "new", item: { id: "m", type: "agentMessage", text } } });
    emit("before"); await stream.subscribe(ws, "id", "sub"); await vi.runAllTimersAsync();
    controls.resetHistory("id", "stopped"); emit("before plus"); stream.changed("id"); await vi.runAllTimersAsync();
    const next = JSON.parse(ws.send.mock.calls.at(-1)![0]).payload;
    expect(next.historyEpoch).not.toBe("0"); expect(next.items[0].content).toBe("before plus"); expect(next.items[0].append).toBeUndefined();
    stream.disconnected(ws); controls.close();
  });
});

const snapshot = { connected: true, historyEpoch: "0", version: 1, activeTurnId: null, turnStatus: "interrupted", items: [], approvals: [], features: { dictation: false, voice: false, prediction: false } };
describe("interrupted-turn editor", () => {
  it("cancel restores an existing draft and sends no rewind; confirmed resend restores it too", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "session.edit.prepare") return { token: "token", turnId: "turn", text: "Original\n\nSteer", inputCount: 2 };
      if (method === "session.edit.commit") return { status: "edited" };
      return snapshot;
    });
    const onHistorySync = vi.fn(), onSendState = vi.fn();
    render(React.createElement(SessionControls, { client: { call }, threadId: "edit-cancel", onItems: vi.fn(), onHistorySync, onSendState }));
    const input = screen.getByRole("textbox", { name: "Send to session" }); await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "Unsent draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit interrupted turn" }));
    await waitFor(() => expect(input).toHaveValue("Original\n\nSteer"));
    expect(screen.getByText(/File and code changes remain/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Add attachments" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(input).toHaveValue("Unsent draft"); expect(call.mock.calls.some(([m]) => m === "session.edit.commit")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit interrupted turn" }));
    await screen.findByRole("button", { name: "Confirm resend" });
    fireEvent.change(input, { target: { value: "Edited combined text" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm resend" }));
    await waitFor(() => expect(input).toHaveValue("Unsent draft"));
    expect(call).toHaveBeenCalledWith("session.edit.commit", expect.objectContaining({ token: "token", message: "Edited combined text", requestId: expect.any(String) }));
    expect(onSendState).toHaveBeenCalledWith("edit-cancel", expect.objectContaining({ delivery: "accepted", content: "Edited combined text" }));
    expect(onHistorySync).toHaveBeenCalled();
  });
  it.each(["revert_unknown", "send_unknown"])("keeps the edited text and disables repeated destructive commits after %s", async status => {
    const call = vi.fn(async (method: string) => method === "session.edit.prepare" ? { token: "token", turnId: "turn", text: "Text to keep", inputCount: 1 }
      : method === "session.edit.commit" ? { status, message: "Check conversation; text kept" } : snapshot);
    render(React.createElement(SessionControls, { client: { call }, threadId: `edit-${status}`, onItems: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit interrupted turn" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm resend" }));
    await screen.findByText("Check conversation; text kept");
    expect(screen.getByRole("textbox")).toHaveValue("Text to keep"); expect(screen.getByRole("button", { name: "Confirm resend" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(call.mock.calls.filter(([m]) => m === "session.edit.commit")).toHaveLength(1);
  });
});

function eventsFixture() {
  const handlers = new Set<(event: { event: string; payload?: unknown }) => void>();
  return { emit: (event: string, payload: unknown) => handlers.forEach(handler => handler({ event, payload })),
    onEvent: (handler: (event: { event: string; payload?: unknown }) => void) => { handlers.add(handler); return () => { handlers.delete(handler); }; } };
}
it.each([true, false])("replaces cached history and rejects late old pages after a reset (visible=%s)", async active => {
  const events = eventsFixture(), late = deferred(); let epoch = "old", reads = 0;
  const call = vi.fn(async (method: string, params: unknown) => {
    if (method === "session.inspect") return { id: "cache-reset", name: "Reset", workspace: "/repo", project: "P", status: "idle" };
    if (method === "session.history") {
      reads++;
      if ((params as { cursor?: string }).cursor === "old-cursor") return late.promise;
      return { threadId: "cache-reset", historyEpoch: epoch, nextCursor: epoch === "old" ? "old-cursor" : null,
        messages: [{ id: epoch, role: "user", content: epoch === "old" ? "Deleted input" : "Retained input" }] };
    }
    return {};
  });
  render(React.createElement(ExistingSessionPanel, { client: { call, onEvent: events.onEvent }, threadId: "cache-reset", active }));
  await screen.findByText("Deleted input"); fireEvent.click(screen.getByRole("button", { name: "↑ Load older messages" }));
  epoch = "new";
  await act(async () => events.emit("session.historyReset", { threadId: "cache-reset", historyEpoch: "new" }));
  await screen.findByText("Retained input"); expect(screen.queryByText("Deleted input")).toBeNull();
  await act(async () => late.resolve({ threadId: "cache-reset", historyEpoch: "old", nextCursor: "old-cursor", messages: [{ id: "zombie", role: "user", content: "Zombie page" }] }));
  expect(screen.queryByText("Zombie page")).toBeNull(); expect(screen.queryByText("Deleted input")).toBeNull();
  expect(screen.queryByRole("button", { name: "↑ Load older messages" })).toBeNull(); expect(reads).toBe(3);
});
it("catches a missed reset generation on reconnect without retaining unmatched deleted messages", async () => {
  const events = eventsFixture(); let epoch = "old";
  let status: (status: "connected" | "disconnected") => void = () => {};
  const call = vi.fn(async (method: string) => method === "session.inspect" ? { id: "reconnect-edit", name: "Reconnect", workspace: "/repo", project: "P", status: "idle" }
    : { threadId: "reconnect-edit", historyEpoch: epoch, nextCursor: null, messages: [{ id: epoch, role: "user", content: epoch === "old" ? "Removed while offline" : "Canonical history" }] });
  render(React.createElement(ExistingSessionPanel, { client: { call, onEvent: events.onEvent, onStatus: handler => { status = handler; return () => {}; } }, threadId: "reconnect-edit", active: false }));
  await screen.findByText("Removed while offline");
  await act(async () => status("disconnected")); epoch = "new";
  await act(async () => status("connected"));
  await screen.findByText("Canonical history"); expect(screen.queryByText("Removed while offline")).toBeNull();
});
it("ignores a late old send receipt after that history was reset", async () => {
  const events = eventsFixture(), receipt = deferred(); let epoch = "old", subscriptionId = "";
  const call = vi.fn(async (method: string, params: unknown) => {
    if (method === "session.inspect") return { id: "late-receipt", name: "Receipt", workspace: "/repo", project: "P", status: "idle", controlsAvailable: true };
    if (method === "session.subscribe") subscriptionId = (params as { subscriptionId: string }).subscriptionId;
    if (method === "session.history") return { threadId: "late-receipt", historyEpoch: epoch, nextCursor: null, messages: [{ id: "retained", role: "user", content: "Earlier retained input" }] };
    if (method === "session.send") return receipt.promise;
    return {};
  });
  render(React.createElement(ExistingSessionPanel, { client: { call, onEvent: events.onEvent }, threadId: "late-receipt" }));
  await screen.findByText("Earlier retained input"); await waitFor(() => expect(subscriptionId).not.toBe(""));
  await act(async () => events.emit("session.stream", { ...snapshot, threadId: "late-receipt", subscriptionId, historyEpoch: epoch }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Removed pending input" } }); fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Removed pending input", { selector: "p" }); epoch = "new";
  await act(async () => events.emit("session.historyReset", { threadId: "late-receipt", historyEpoch: epoch }));
  await waitFor(() => expect(screen.queryByText("Removed pending input", { selector: "p" })).toBeNull());
  await act(async () => receipt.resolve({ status: "started" }));
  expect(screen.queryByText("Removed pending input", { selector: "p" })).toBeNull();
});
it("refuses a reused send identity before destructive native rewind", async () => {
  const { controls, client } = nativeFixture(); const edit = await controls.prepareEdit("id");
  controls.sends.set("old-id", { id: "id", result: {} });
  await expect(controls.commitEdit("id", { token: edit.token, message: "edit", requestId: "old-id" })).rejects.toThrow("fresh send identity");
  expect(client.call.mock.calls.some(([m]) => m === "thread/revert")).toBe(false); controls.close();
});
it("blocks ordinary send, Play and automatic retry while a timed-out revert can still arrive; unlocks on native reverted event", async () => {
  const { client, controls, turn } = nativeFixture(); const edit = await controls.prepareEdit("id"), original = client.call.getMockImplementation()!;
  client.call.mockImplementation(async (method: string) => { if (method === "thread/revert") throw Object.assign(new Error("pipe closed"), { code: "EPIPE" }); return original(method); });
  expect(await controls.commitEdit("id", { token: edit.token, message: "edit", requestId: "uncertain-revert" })).toMatchObject({ status: "revert_unknown" });
  await expect(controls.send("id", "new ordinary input", "new-ordinary")).rejects.toThrow("No new input was sent");
  await expect(controls.send("id", "Continue where you left off.", "new-play", [], { resumeInterrupted: true })).rejects.toThrow("No new input was sent");
  expect(await controls.send("id", "retry", "auto", [], { automaticRetry: {} })).toEqual({ status: "cancelled" });
  expect(client.call.mock.calls.some(([method]) => method === "turn/start" || method === "turn/steer")).toBe(false);
  expect(controls.state("id").editUncertain).toBeTruthy();
  turn("completed", "earlier"); controls.handle({ method: "thread/reverted", params: { threadId: "id" } });
  await controls.send("id", "new input after proof", "after-proof");
  expect(client.call.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1); controls.close();
});
it("does not treat a changed tip as proof; pages the authoritative turns until deletion is proven", async () => {
  const { client, controls, turn } = nativeFixture(); const edit = await controls.prepareEdit("id"), original = client.call.getMockImplementation()!;
  let targetDeleted = false;
  client.call.mockImplementation(async (method: string, params: unknown) => {
    if (method === "thread/revert") throw new Error("timeout");
    if (method === "thread/turns/list" && (params as { limit: number }).limit === 100) {
      if ((params as { cursor?: string }).cursor) return { data: targetDeleted ? [{ id: "earlier", status: "completed" }] : [{ id: "stopped", status: "interrupted" }], nextCursor: null };
      return { data: [{ id: "new-tip", status: "completed" }], nextCursor: "older-turns" };
    }
    return original(method);
  });
  await controls.commitEdit("id", { token: edit.token, message: "edit", requestId: "pagination-reconcile" });
  await expect(controls.send("id", "must wait", "wait-send")).rejects.toThrow("unconfirmed");
  expect(client.call.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
  targetDeleted = true; turn("completed", "new-tip");
  await controls.send("id", "after complete read", "proven-send");
  expect(client.call.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1); controls.close();
});
it("accepts the native reverted event as proof even when it precedes a lost RPC receipt", async () => {
  const { client, controls } = nativeFixture(); const edit = await controls.prepareEdit("id"), original = client.call.getMockImplementation()!;
  client.call.mockImplementation(async (method: string) => {
    if (method === "thread/revert") { controls.handle({ method: "thread/reverted", params: { threadId: "id" } }); throw new Error("receipt lost"); }
    return original(method);
  });
  const result = await controls.commitEdit("id", { token: edit.token, message: "edit", requestId: "lost-after-event" });
  expect(result).toMatchObject({ status: "revert_unknown", message: expect.stringContaining("History was rewound") });
  expect(controls.state("id").editUncertain).toBeFalsy();
  expect(client.call.mock.calls.some(([method]) => method === "turn/start")).toBe(false); controls.close();
});
it("shows edit progress immediately while the destructive commit RPC is still pending", async () => {
  const pending = deferred();
  const call = vi.fn(async (method: string) => method === "session.edit.prepare" ? { token: "token", turnId: "turn", text: "Edited text", inputCount: 1 }
    : method === "session.edit.commit" ? pending.promise : snapshot);
  render(React.createElement(SessionControls, { client: { call }, threadId: "immediate-edit-feedback", onItems: vi.fn() }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit interrupted turn" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm resend" }));
  expect(screen.getByText("Rewinding the turn and waiting for receipt…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  await act(async () => pending.resolve({ status: "send_unknown", message: "History rewound; keep text" }));
  expect(screen.queryByText("Rewinding the turn and waiting for receipt…")).toBeNull();
  expect(screen.getByRole("textbox")).toHaveValue("Edited text");
});
