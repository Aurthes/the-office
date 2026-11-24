import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls.js");
const { CodexSessionStream } = createRequire(import.meta.url)("../../server/codex-session-stream.js");
const cleanups: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.useRealTimers(); });
function fixture() {
  let persisted: unknown;
  let turn = { id: "current", status: "inProgress", error: null as unknown };
  const client = { ready: true, call: vi.fn<(method: string) => Promise<unknown>>(async (method: string) => method === "thread/turns/list" ? { data: [turn] } : method === "turn/start" ? { turn: { id: "next", status: "inProgress" } } : {}) };
  const options = { recovery: { read: () => persisted, write: (_id: string, value: unknown) => { persisted = structuredClone(value); } } };
  const make = () => { const controls = new CodexSessionControls(client, () => [], options); cleanups.push(() => controls.close()); return controls; };
  const controls = make();
  controls.handle({ method: "turn/started", params: { threadId: "id", turn } });
  const error = (info: unknown = { responseStreamConnectionFailed: { httpStatusCode: 502 } }, turnId = "current", willRetry = true) => controls.handle({ method: "error", params: { threadId: "id", turnId, willRetry, error: { message: "Connection failed", codexErrorInfo: info } } });
  return { controls, client, error, make, setTurn: (value: typeof turn) => { turn = value; } };
}
it("pushes the real native fault through the real stream without creating any model call or outer timer", async () => {
  const f = fixture(), stream = new CodexSessionStream(f.controls, { delay: 0 });
  const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() }; cleanups.push(() => stream.disconnected(ws));
  await stream.subscribe(ws, "id", "subscription"); await vi.advanceTimersByTimeAsync(1);
  f.error(); stream.changed("id"); await vi.advanceTimersByTimeAsync(1);
  const frame = JSON.parse(ws.send.mock.lastCall![0]);
  expect(frame.payload).toMatchObject({ activeTurnId: "current", retryAt: null, modelRecovery: { turnId: "current", layer: "model", phase: "reconnecting", willRetry: true, attempt: null, maxAttempts: null, nextRetryAt: null } });
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.client.call.mock.calls.map(([method]) => method)).toEqual(["thread/resume", "thread/turns/list"]);
});
it("preserves faults across refresh, reconnect and restart; tools/accounting do not prove model recovery", async () => {
  const f = fixture(); f.error();
  f.controls.handle({ method: "thread/tokenUsage/updated", params: { threadId: "id", tokenUsage: {} } });
  f.controls.handle({ method: "item/completed", params: { threadId: "id", turnId: "current", item: { id: "cmd", type: "commandExecution", command: "true", status: "completed" } } });
  await f.controls.refreshTurn("id"); expect(f.controls.snapshot("id").modelRecovery.phase).toBe("reconnecting");
  const next = f.make(); await next.refreshTurn("id"); expect(next.snapshot("id").modelRecovery.turnId).toBe("current");
  next.handle({ method: "item/agentMessage/delta", params: { threadId: "id", turnId: "current", itemId: "answer", delta: "Progress" } });
  expect(next.snapshot("id").modelRecovery).toBeNull();
  expect(next.snapshot("id").activeTurnId).toBe("current");
});
it("ignores old or unscoped faults and output, keeps repeated same-turn starts faulty, and clears on a real new turn", () => {
  const f = fixture(); f.error();
  f.controls.handle({ method: "turn/started", params: { threadId: "id", turn: { id: "current" } } });
  f.error("unauthorized", "old"); f.error("unauthorized", "");
  f.controls.handle({ method: "item/agentMessage/delta", params: { threadId: "id", turnId: "old", itemId: "answer", delta: "late" } });
  expect(f.controls.snapshot("id").modelRecovery.phase).toBe("reconnecting");
  f.controls.handle({ method: "turn/started", params: { threadId: "id", turn: { id: "new" } } });
  f.error("unauthorized", "current"); expect(f.controls.snapshot("id").modelRecovery).toBeNull();
});
it.each([["unauthorized", "action_required"], [{ httpConnectionFailed: { httpStatusCode: 401 } }, "action_required"], [{ httpConnectionFailed: { httpStatusCode: 403 } }, "action_required"], [{ httpConnectionFailed: { httpStatusCode: 429 } }, "rate_limited"], ["usageLimitExceeded", "rate_limited"]])("retains structured auth/limit information %j without inventing retry timing", (info, phase) => {
  const f = fixture(); f.error(info);
  expect(f.controls.snapshot("id")).toMatchObject({ retryAt: null, modelRecovery: { phase, nextRetryAt: null, attempt: null } });
});
it("Stop cancels only through existing exact turn control and is visible across restart", async () => {
  const f = fixture(); f.error(); await f.controls.stop("id", "current");
  expect(f.client.call).toHaveBeenCalledWith("turn/interrupt", { threadId: "id", turnId: "current" });
  expect(f.controls.snapshot("id")).toMatchObject({ retryStopped: true, retryAt: null, activeTurnId: "current" });
  const next = f.make(); await next.refreshTurn("id"); expect(next.snapshot("id").retryStopped).toBe(true);
});
it("a send with unknown outcome cannot clear a same-turn fault or replay itself", async () => {
  const f = fixture(); f.error(); await f.controls.attach("id");
  f.client.call.mockRejectedValueOnce(new Error("Unknown outcome"));
  await expect(f.controls.send("id", "user input", "uncertain")).rejects.toThrow("Unknown outcome");
  expect(f.controls.snapshot("id").modelRecovery).not.toBeNull();
  await expect(f.controls.send("id", "user input", "uncertain")).rejects.toThrow("未重复发送");
});
it("shows real outer attempt/timestamp only after terminal failure and clears on success", async () => {
  const f = fixture(); f.error();
  f.controls.handle({ method: "turn/completed", params: { threadId: "id", turn: { id: "current", status: "failed", error: { message: "Disconnected" } } } });
  expect(f.controls.snapshot("id")).toMatchObject({ retryAttempt: 1, retryMaxAttempts: 3, retryAt: Date.now() + 15000 });
  f.controls.handle({ method: "turn/started", params: { threadId: "id", turn: { id: "next" } } });
  f.controls.handle({ method: "turn/completed", params: { threadId: "id", turn: { id: "next", status: "completed" } } });
  expect(f.controls.snapshot("id")).toMatchObject({ retryAt: null, retryAttempt: 0, modelRecovery: null });
});
it("healthy long silence without a fault remains active", async () => {
  const f = fixture(); await vi.advanceTimersByTimeAsync(600000);
  expect(f.controls.snapshot("id")).toMatchObject({ activeTurnId: "current", modelRecovery: null, retryAt: null });
  expect(f.client.call).not.toHaveBeenCalled();
});
it("a stale status read cannot erase a newer fault or restore a fault after real output", async () => {
  const f = fixture(); let resolve!: (value: unknown) => void;
  f.client.call.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const read = f.controls.refreshTurn("id"); f.error(); resolve({ data: [{ id: "current", status: "completed" }] }); await read;
  expect(f.controls.snapshot("id")).toMatchObject({ activeTurnId: "current", modelRecovery: { phase: "reconnecting" } });
  f.client.call.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const second = f.controls.refreshTurn("id");
  f.controls.handle({ method: "item/agentMessage/delta", params: { threadId: "id", turnId: "current", itemId: "new", delta: "Recovered" } });
  resolve({ data: [{ id: "current", status: "failed", error: { message: "Stale fault" } }] }); await second;
  expect(f.controls.snapshot("id")).toMatchObject({ activeTurnId: "current", modelRecovery: null });
});
