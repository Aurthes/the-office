// @vitest-environment node
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls");
const { nativeScopeLogReader, rateLimitRetry } = createRequire(import.meta.url)("../../server/codex-scope-metadata");

const message = "exceeded retry limit, last status: 429 Too Many Requests";
const error = { message, codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 429 } } };
const log = () => ({ level: "WARN", target: "codex_core::responses_retry", fields: {
  message: "stream disconnected - retrying sampling request (1/5 in 600s)...",
  turn_id: "turn-a", retries: 1, max_retries: 5, sampling_error: message,
} });
const cleanups: Array<() => void> = [];
function setup() {
  const latest = new Map<string, { id: string; status: string }>();
  const persisted = new Map<string, unknown>();
  let next = 0;
  const client = { ready: true, call: vi.fn(async (method: string, params: { threadId: string; turnId?: string }) => {
    if (method === "thread/turns/list") return { data: latest.has(params.threadId) ? [latest.get(params.threadId)] : [] };
    if (method === "turn/start") {
      const turn = { id: `next-${++next}`, status: "inProgress" };
      emit(params.threadId, turn.id, turn.status);
      return { turn };
    }
    return {};
  }) };
  const recovery = { read: (id: string) => persisted.get(id), write: (id: string, value: unknown) => persisted.set(id, value) };
  const controls = new CodexSessionControls(client, () => [], { recovery });
  cleanups.push(() => controls.close());
  function emit(threadId: string, turnId: string, status = "inProgress") {
    const turn = { id: turnId, status }; latest.set(threadId, turn);
    controls.handle({ method: status === "inProgress" ? "turn/started" : "turn/completed", params: { threadId, turn } });
  }
  const hint = (turnId = "turn-a") => controls.nativeRateLimitRetry({ turnId, message });
  const interrupts = () => client.call.mock.calls.filter(([method]) => method === "turn/interrupt");
  const starts = () => client.call.mock.calls.filter(([method]) => method === "turn/start");
  return { client, controls, recovery, emit, hint, interrupts, starts };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).forEach(close => close()); vi.useRealTimers(); });

describe("429 retry log recognition", () => {
  it("recognizes a split native warning while retaining the ordinary log relay", () => {
    const detected: unknown[] = [], warnings: string[] = [];
    const reader = nativeScopeLogReader({ onMetadata: () => {}, onRateLimitRetry: (value: unknown) => detected.push(value), writeError: (value: string) => warnings.push(value) });
    const bytes = Buffer.from(JSON.stringify(log()) + "\n");
    reader.feed(bytes.subarray(0, 51)); reader.feed(bytes.subarray(51));
    expect(detected).toEqual([{ turnId: "turn-a", message }]);
    expect(warnings).toHaveLength(1);
  });
  it("rejects echoed text, other errors, missing identity and malformed fields", () => {
    for (const value of [null, {}, { ...log(), target: "tool_output" }, { ...log(), level: "INFO" },
      { ...log(), fields: { ...log().fields, sampling_error: "unexpected status 503" } },
      { ...log(), fields: { ...log().fields, turn_id: null } },
      { ...log(), fields: { ...log().fields, message: 1 } }]) expect(rateLimitRetry(value)).toBeNull();
  });
});

describe("Office intervention in a native 429 retry", () => {
  it("interrupts only the matching active turn and coalesces log and public error signals", async () => {
    const f = setup(); f.emit("a", "turn-a"); f.emit("b", "turn-b");
    f.hint(); f.hint();
    f.controls.handle({ method: "error", params: { threadId: "a", turnId: "turn-a", error, willRetry: true } });
    expect(f.interrupts()).toEqual([["turn/interrupt", { threadId: "a", turnId: "turn-a" }]]);
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.starts()).toHaveLength(0);
    expect(f.controls.snapshot("b").activeTurnId).toBe("turn-b");
  });
  it("handles stderr arriving before the stdout lifecycle event", () => {
    const f = setup(); f.hint(); expect(f.interrupts()).toHaveLength(0);
    f.emit("a", "turn-a"); expect(f.interrupts()).toHaveLength(1);
  });
  it("ignores old or expired turn hints", async () => {
    const f = setup(); f.emit("a", "new-turn"); f.hint();
    expect(f.interrupts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(15001);
    f.emit("b", "turn-a"); expect(f.interrupts()).toHaveLength(0);
  });
  it("retains the 429 cause across native interruption, refresh and restart, then uses the existing 15-second retry", async () => {
    const f = setup(); f.emit("a", "turn-a"); f.hint(); f.emit("a", "turn-a", "interrupted");
    expect(f.controls.snapshot("a")).toMatchObject({ error: message, retryStopped: false, retryAt: Date.now() + 15000,
      modelRecovery: { phase: "rate_limited", message, willRetry: false, interruptedByOffice: true } });
    await f.controls.refreshTurn("a"); expect(f.controls.snapshot("a").error).toBe(message);
    const restored = new CodexSessionControls(f.client, () => [], { recovery: f.recovery });
    cleanups.push(() => restored.close());
    await restored.refreshTurn("a"); expect(restored.snapshot("a").error).toBe(message);
    await vi.advanceTimersByTimeAsync(14999); expect(f.starts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(f.starts()).toHaveLength(1);
    expect(f.controls.snapshot("a")).toMatchObject({ activeTurnId: "next-1", error: null, modelRecovery: null });
  });
  it("intervenes on a public typed 429 but leaves other retryable faults and terminal errors to their existing handling", () => {
    const f = setup(); f.emit("a", "turn-a");
    for (const [failure, willRetry] of [[error, false], [{ ...error, codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 503 } } }, true],
      [{ message: "429 in unrelated prose", codexErrorInfo: "other" }, true]]) {
      f.controls.handle({ method: "error", params: { threadId: "a", turnId: "turn-a", error: failure, willRetry } });
    }
    expect(f.interrupts()).toHaveLength(0);
    f.controls.handle({ method: "error", params: { threadId: "a", turnId: "turn-a", error, willRetry: true } });
    expect(f.interrupts()).toHaveLength(1);
  });
  it("respects a user's Stop during the intervention", async () => {
    const f = setup(); f.emit("a", "turn-a"); f.hint();
    await f.controls.stop("a"); f.emit("a", "turn-a", "interrupted");
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.starts()).toHaveLength(0); expect(f.controls.snapshot("a").retryStopped).toBe(true);
  });
  it("reports cancellation failure without declaring the turn finished or starting another attempt", async () => {
    const f = setup(); f.emit("a", "turn-a");
    f.client.call.mockRejectedValueOnce(new Error("request timeout")); f.hint();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controls.snapshot("a")).toMatchObject({ activeTurnId: "turn-a", retryAt: null, error: "Could not stop Codex's 429 retry: request timeout" });
    expect(f.starts()).toHaveLength(0);
  });
  it("does not let a late cancellation failure overwrite a newer turn", async () => {
    const f = setup(); f.emit("a", "turn-a");
    let reject!: (error: Error) => void;
    f.client.call.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; }));
    f.hint(); f.emit("a", "new-turn"); reject(new Error("late timeout"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controls.snapshot("a")).toMatchObject({ activeTurnId: "new-turn", error: null, modelRecovery: null });
  });
});
