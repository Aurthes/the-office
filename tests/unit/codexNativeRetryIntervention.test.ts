// @vitest-environment node
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls");
const { nativeScopeLogReader } = createRequire(import.meta.url)("../../server/codex-scope-metadata");
const { nativeRetryMetadata } = createRequire(import.meta.url)("../../server/codex-native-retry");

const message = "exceeded retry limit, last status: 429 Too Many Requests";
const error = { message, codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 429 } } };
const log = () => ({ timestamp: new Date().toISOString(), level: "WARN", target: "codex_core::responses_retry", fields: {
  message: "stream disconnected - retrying sampling request (1/5 in 600s)...",
  turn_id: "turn-a", retries: 1, max_retries: 5, sampling_error: message,
} });
const retryCases = [
  { label: "capacity", warning: () => ({ ...log(), fields: { ...log().fields, sampling_error: "Selected model is at capacity. Please try a different model." } }) },
  { label: "HTTP 503", warning: () => ({ ...log(), fields: { ...log().fields, sampling_error: "exceeded retry limit, last status: 503 Service Unavailable" } }) },
  { label: "short stream reconnection", warning: () => ({ ...log(), fields: { ...log().fields, sampling_error: "stream disconnected before completion: websocket closed by server before response.completed" } }) },
  { label: "connection retry without a budget", warning: () => ({ ...log(), fields: { turn_id: "turn-a", message: "stream connection failed; waiting to retry", error: "Connection failed: connection reset", retry_delay: "5s" } }) },
  { label: "remote compaction retry", warning: () => ({ ...log(), fields: { turn_id: "turn-a", retries: 1, max_retries: 5, message: "remote compaction v2 stream failed; retrying request after delay", compact_error: "request timed out" } }) },
];
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
  const controls = new CodexSessionControls(client, () => [], { recovery, nativeGeneration: "generation" });
  cleanups.push(() => controls.close());
  function emit(threadId: string, turnId: string, status = "inProgress") {
    const turn = { id: turnId, status }; latest.set(threadId, turn);
    controls.handle({ method: status === "inProgress" ? "turn/started" : "turn/completed", params: { threadId, turn } });
  }
  const hint = (turnId = "turn-a") => {
    const value = log(); value.fields.turn_id = turnId;
    controls.nativeRetry(nativeRetryMetadata(value, "generation"));
  };
  const interrupts = () => client.call.mock.calls.filter(([method]) => method === "turn/interrupt");
  const starts = () => client.call.mock.calls.filter(([method]) => method === "turn/start");
  return { client, controls, recovery, emit, hint, interrupts, starts };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).forEach(close => close()); vi.useRealTimers(); });

describe("native retry log recognition", () => {
  it("recognizes a split native warning while retaining the ordinary log relay", () => {
    const detected: unknown[] = [], warnings: string[] = [];
    const reader = nativeScopeLogReader({ generation: "generation", onMetadata: () => {}, onRetry: (value: unknown) => detected.push(value), writeError: (value: string) => warnings.push(value) });
    const bytes = Buffer.from(JSON.stringify(log()) + "\n");
    reader.feed(bytes.subarray(0, 51)); reader.feed(bytes.subarray(51));
    expect(detected).toEqual([expect.objectContaining({ turnId: "turn-a", reason: message })]);
    expect(warnings).toHaveLength(1);
  });
  it("rejects echoed text, other errors, missing identity and malformed fields", () => {
    for (const value of [null, {}, { ...log(), target: "tool_output" }, { ...log(), level: "INFO" },
      { ...log(), timestamp: "invalid" },
      { ...log(), fields: { ...log().fields, turn_id: null } },
      { ...log(), fields: { ...log().fields, sampling_error: 1 } }]) expect(nativeRetryMetadata(value, "generation")).toBeNull();
  });
  it("recognizes all supported branches without inventing connection retry counts", () => {
    for (const { warning } of retryCases) expect(nativeRetryMetadata(warning(), "generation")).toMatchObject({ turnId: "turn-a" });
    expect(nativeRetryMetadata(retryCases[3].warning(), "generation")).toMatchObject({ kind: "connection", attempt: null, maxAttempts: null });
    expect(nativeRetryMetadata(retryCases[4].warning(), "generation")).toMatchObject({ kind: "compaction", attempt: 1, maxAttempts: 5 });
    for (const fields of [
      { turn_id: "turn-a", message: "stream connection failed; waiting to retry", error: "failed", retry_delay: 5 },
      { turn_id: "turn-a", message: "stream connection failed", error: "failed", retry_delay: "5s" },
      { turn_id: "turn-a", message: "stream connection failed; waiting to retry", error: { private: true }, retry_delay: "5s" },
      { ...log().fields, compact_error: "ambiguous" },
      { turn_id: "turn-a", retries: 1, max_retries: 5, message: "not a retry", compact_error: "timeout" },
    ]) expect(nativeRetryMetadata({ ...log(), fields }, "generation")).toBeNull();
  });
});

describe("Office intervention in native retries", () => {
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
  it("keeps a stale same-turn warning as diagnostics without interrupting recovered work", () => {
    const f = setup(); f.emit("a", "turn-a");
    const value = log(); value.timestamp = new Date(Date.now() - 5000).toISOString();
    f.controls.nativeRetry(nativeRetryMetadata(value, "generation"));
    expect(f.interrupts()).toHaveLength(0);
    expect(f.controls.snapshot("a").activeTurnId).toBe("turn-a");
  });
  it.each(retryCases)("interrupts $label and leaves retry scheduling with Office", async ({ warning }) => {
    const f = setup(); f.emit("a", "turn-a");
    const value = warning();
    f.controls.nativeRetry(nativeRetryMetadata(value, "generation"));
    expect(f.interrupts()).toEqual([["turn/interrupt", { threadId: "a", turnId: "turn-a" }]]);
    expect(f.controls.snapshot("a").retryAt).toBeNull();
    f.emit("a", "turn-a", "interrupted");
    expect(f.controls.snapshot("a")).toMatchObject({ retryStopped: false, retryAt: Date.now() + 15000,
      modelRecovery: { interruptedByOffice: true, willRetry: false } });
    await vi.advanceTimersByTimeAsync(15000);
    expect(f.starts()).toHaveLength(1);
  });
  it("retains the 429 cause across native interruption, refresh and restart, then uses the existing 15-second retry", async () => {
    const f = setup(); f.emit("a", "turn-a"); f.hint(); f.emit("a", "turn-a", "interrupted");
    expect(f.controls.snapshot("a")).toMatchObject({ error: message, retryStopped: false, retryAt: Date.now() + 15000,
      modelRecovery: { phase: "rate_limited", message, willRetry: false, interruptedByOffice: true } });
    await f.controls.refreshTurn("a"); expect(f.controls.snapshot("a").error).toBe(message);
    const restored = new CodexSessionControls(f.client, () => [], { recovery: f.recovery, nativeGeneration: "generation" });
    cleanups.push(() => restored.close());
    await restored.refreshTurn("a"); expect(restored.snapshot("a").error).toBe(message);
    await vi.advanceTimersByTimeAsync(14999); expect(f.starts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(f.starts()).toHaveLength(1);
    expect(f.controls.snapshot("a")).toMatchObject({ activeTurnId: "next-1", error: null, modelRecovery: null });
  });
  it("intervenes on every public retry signal without depending on the error code or prose", () => {
    for (const failure of [error, { ...error, codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 503 } } },
      { message: "Selected model is at capacity", codexErrorInfo: "serverOverloaded" },
      { message: "Reconnecting...", codexErrorInfo: "other" }]) {
      const f = setup(); f.emit("a", "turn-a");
      f.controls.handle({ method: "error", params: { threadId: "a", turnId: "turn-a", error: failure, willRetry: true } });
      expect(f.interrupts()).toHaveLength(1);
    }
  });
  it("does not interrupt terminal public errors or infer retry intent from their text", () => {
    const f = setup(); f.emit("a", "turn-a");
    for (const willRetry of [false, undefined, "true"]) {
      f.controls.handle({ method: "error", params: { threadId: "a", turnId: "turn-a", error, willRetry } });
    }
    expect(f.interrupts()).toHaveLength(0);
  });
  it("respects a user's Stop during the intervention", async () => {
    const f = setup(); f.emit("a", "turn-a"); f.hint();
    await f.controls.stop("a"); f.emit("a", "turn-a", "interrupted");
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.starts()).toHaveLength(0); expect(f.controls.snapshot("a").retryStopped).toBe(true);
  });
  it("keeps the three-attempt Office budget across different native retry causes", async () => {
    const f = setup(); f.emit("a", "turn-a");
    for (let attempt = 0; attempt < 4; attempt++) {
      const turnId = f.controls.snapshot("a").activeTurnId;
      const warning = retryCases[attempt].warning(); warning.fields.turn_id = turnId;
      f.controls.nativeRetry(nativeRetryMetadata(warning, "generation"));
      f.emit("a", turnId, "interrupted");
      expect(f.controls.snapshot("a").retryStopped).toBe(false);
      expect(f.controls.snapshot("a").retryAt).toBe(attempt < 3 ? Date.now() + 15000 : null);
      await vi.advanceTimersByTimeAsync(15000);
    }
    expect(f.starts()).toHaveLength(3);
    expect(f.controls.snapshot("a")).toMatchObject({ retryExhausted: true, retryAt: null, retryAttempt: 3 });
  });
  it("reports cancellation failure without declaring the turn finished or starting another attempt", async () => {
    const f = setup(); f.emit("a", "turn-a");
    f.client.call.mockRejectedValueOnce(new Error("request timeout")); f.hint();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controls.snapshot("a")).toMatchObject({ activeTurnId: "turn-a", retryAt: null, error: "Could not stop Codex's internal retry: request timeout" });
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
