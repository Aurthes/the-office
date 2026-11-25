// @vitest-environment node
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { nativeRetryMetadata, modelErrorDetails, supportedNativeRetryVersion } = createRequire(import.meta.url)("../../server/codex-native-retry");
const { nativeScopeLogReader } = createRequire(import.meta.url)("../../server/codex-scope-metadata");
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls");
let controls: InstanceType<typeof CodexSessionControls>;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-25T12:00:00Z")); controls = new CodexSessionControls({ ready: true, call: vi.fn() }, () => [], { nativeGeneration: "child-1" }); });
afterEach(() => { controls.close(); vi.useRealTimers(); });
const raw = (turn = "turn-a", extra = {}) => ({ timestamp: new Date().toISOString(), level: "WARN", target: "codex_core::responses_retry", fields: { turn_id: turn, retries: 1, max_retries: 5, sampling_error: "Selected model is at capacity. Please try a different model", ...extra }, span: { prompt: "PRIVATE" }, arguments: "PRIVATE" });
const start = (id = "a", turn = "turn-a") => controls.handle({ method: "turn/started", params: { threadId: id, turn: { id: turn } } });
const retry = (turn = "turn-a", extra = {}) => nativeRetryMetadata(raw(turn, extra), "child-1");
it("projects the observed 0.166/0.172 schema, never arbitrary WARN, body or code; ignores unsupported versions", () => {
 expect(supportedNativeRetryVersion("0.166.0")).toBe(true); expect(supportedNativeRetryVersion("0.172.0")).toBe(true); expect(supportedNativeRetryVersion("0.173.0")).toBe(false);
 const value = retry(); expect(value).toMatchObject({ generation: "child-1", turnId: "turn-a", attempt: 1, maxAttempts: 5 }); expect(JSON.stringify(value)).not.toContain("PRIVATE");
 for (const log of [{ ...raw(), level: "INFO" }, { ...raw(), target: "other" }, raw("", {}), raw("turn-a", { retries: true }), raw("turn-a", { retries: 6 }), raw("turn-a", { sampling_error: { body: "PRIVATE" } })]) expect(nativeRetryMetadata(log, "child-1")).toBeNull();
 expect(modelErrorDetails('HTTP 429; response body: {"private":"PRIVATE"}')).toBe("HTTP 429;");
 expect(nativeRetryMetadata(raw("turn-a", { sampling_error: '{"private":"PRIVATE"}' }), "child-1")).toMatchObject({ reason: "Native retry reason is unavailable", attempt: 1 });
 expect(modelErrorDetails('{"private":"PRIVATE"}')).toBeNull(); expect(modelErrorDetails('Bearer token-secret https://example.invalid/?secret')).toBe("[redacted] [URL]");
});
it("uses the real bounded reader and controls without scheduling any Continue or guessing cause/code/time", () => {
 start(); const errors: string[] = []; const reader = nativeScopeLogReader({ generation: "child-1", onRetry: (d: unknown) => controls.nativeRetry(d), writeError: (e: string) => errors.push(e) });
 const bytes = Buffer.from(JSON.stringify(raw("turn-a", { message: "native retry" })) + "\n"); for (let i = 0; i < bytes.length; i += 7) reader.feed(bytes.subarray(i, i + 7));
 expect(controls.snapshot("a")).toMatchObject({ activeTurnId: "turn-a", retryAt: null, modelRecovery: { attempt: 1, maxAttempts: 5, additionalDetails: expect.stringContaining("capacity"), nextRetryAt: null, code: null, source: "native-diagnostic" } });
 expect(errors).toEqual(["[WARN] native retry\n"]); expect(vi.getTimerCount()).toBe(0); expect(controls.client.call).not.toHaveBeenCalled();
});
it("joins exact complete turn and generation, distinguishes concurrent sessions and fails closed on ambiguity", () => {
 start(); start("b", "turn-b"); expect(controls.nativeRetry(retry("turn-a"))).toBe("a"); expect(controls.snapshot("b").modelRecovery).toBeNull();
 expect(controls.nativeRetry({ ...retry("turn-b"), generation: "old-child" })).toBeNull(); expect(controls.nativeRetry(retry("turn"))).toBeNull();
 start("duplicate", "turn-b"); expect(controls.nativeRetry(retry("turn-b"))).toBeNull(); expect(controls.snapshot("b").modelRecovery).toBeNull();
});
it("bounds cross-fd identity buffering and never assigns expired/unmatched logs to recently active threads", () => {
 expect(controls.nativeRetry(retry())).toBeNull(); expect(controls.states.size).toBe(0); start(); expect(controls.snapshot("a").modelRecovery?.attempt).toBe(1);
 const old = retry("expired"); controls.nativeRetry(old); vi.advanceTimersByTime(1001); start("expired-office", "expired"); expect(controls.snapshot("expired-office").modelRecovery).toBeNull();
 for (let i = 0; i < 40; i++) controls.nativeRetry(retry("unknown-" + i)); expect(controls.pendingNativeRetries.size).toBe(32);
});
it("keeps Stop protection common to diagnostics and public errors, and rejects completion/rewind/old-turn/closed-child events", () => {
 start(); controls.saveRecovery("a", { stopped: true }); expect(controls.nativeRetry(retry())).toBeNull();
 controls.handle({ method: "error", params: { threadId: "a", turnId: "turn-a", willRetry: true, error: { message: "late" } } }); expect(controls.snapshot("a").modelRecovery).toBeNull();
 controls.saveRecovery("a", { stopped: false }); controls.handle({ method: "turn/completed", params: { threadId: "a", turn: { id: "turn-a", status: "completed" } } }); expect(controls.nativeRetry(retry())).toBeNull();
 start("a", "new-turn"); expect(controls.nativeRetry(retry())).toBeNull(); controls.handle({ method: "thread/reverted", params: { threadId: "a" } }); expect(controls.nativeRetry(retry("new-turn"))).toBeNull(); controls.close(); expect(controls.nativeRetry(retry())).toBeNull();
});
it("does not let late stderr undo actual model progress, but permits the next real request's fresh retry in the same turn", () => {
 start(); const old = retry(); controls.nativeRetry(old); vi.advanceTimersByTime(10);
 controls.handle({ method: "item/agentMessage/delta", params: { threadId: "a", turnId: "turn-a", itemId: "one", delta: "recovered" } }); expect(controls.snapshot("a").modelRecovery?.phase).toBe("retry_observed");
 expect(controls.nativeRetry(old)).toBeNull(); vi.advanceTimersByTime(20); expect(controls.nativeRetry(retry())).toBe("a"); expect(controls.snapshot("a").modelRecovery?.attempt).toBe(1);
});
it("merges public additionalDetails with native counts, does not derive quota from HTTP429 and revalidates persisted generations", () => {
 start(); controls.nativeRetry(retry("turn-a", { sampling_error: "HTTP 429 Too Many Requests" }));
 controls.handle({ method: "error", params: { threadId: "a", turnId: "turn-a", willRetry: true, error: { message: "Reconnecting... 1/5", additionalDetails: "Actual provider reason", codexErrorInfo: "responseStreamDisconnected" } } });
 expect(controls.snapshot("a").modelRecovery).toMatchObject({ additionalDetails: "Actual provider reason", attempt: 1, maxAttempts: 5, code: "responseStreamDisconnected", phase: "retrying" });
 const restarted = new CodexSessionControls({ ready: true }, () => [], { nativeGeneration: "child-2", recovery: { read: () => ({ modelIssue: { ...controls.snapshot("a").modelRecovery, source: "native-diagnostic" } }) } });
 expect(restarted.snapshot("a").modelRecovery).toBeNull(); expect(restarted.nativeRetry(retry())).toBeNull(); restarted.close();
});
it("deduplicates a repeated diagnostic, allows retry attempts to reset on a later sampling request and does not lose original error relay", () => {
 start(); const value = retry(); controls.nativeRetry(value); const version = controls.snapshot("a").version; controls.nativeRetry(value); expect(controls.snapshot("a").version).toBe(version);
 vi.advanceTimersByTime(20); controls.nativeRetry(retry("turn-a", { retries: 2 })); vi.advanceTimersByTime(20); controls.nativeRetry(retry()); expect(controls.snapshot("a").modelRecovery.attempt).toBe(1);
 let relay = ""; const reader = nativeScopeLogReader({ generation: "child-1", onRetry: () => { throw Error("observer"); }, writeError: (s: string) => { relay += s; } }); reader.feed(Buffer.from(JSON.stringify(raw("turn-a", { message: "still relayed" })) + "\n")); expect(relay).toBe("[WARN] still relayed\n");
});

it("binds the new native turn after a start response already changed activeTurnId without inheriting the old progress watermark", () => {
 start(); controls.handle({ method: "item/agentMessage/delta", params: { threadId: "a", turnId: "turn-a", itemId: "old", delta: "done" } });
 const state = controls.state("a"); state.activeTurnId = "next"; state.lastTurnId = "next";
 controls.handle({ method: "turn/started", params: { threadId: "a", turn: { id: "next" } } });
 expect(state.modelOutputObserved).toBe(false); expect(controls.nativeRetry(retry("next"))).toBe("a");
});

it("retains authoritative public error fields regardless of cross-fd order and never resurrects terminal intent", () => {
 start(); controls.handle({ method: "error", params: { threadId: "a", turnId: "turn-a", willRetry: true, error: { message: "public", additionalDetails: "Actual public reason", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 429 } } } } });
 controls.nativeRetry(retry()); expect(controls.snapshot("a").modelRecovery).toMatchObject({ source: "native-error", phase: "rate_limited", code: "httpConnectionFailed", additionalDetails: "Actual public reason", attempt: 1 });
 controls.handle({ method: "error", params: { threadId: "a", turnId: "turn-a", willRetry: false, error: { message: "terminal", codexErrorInfo: "badRequest" } } });
 vi.advanceTimersByTime(20); controls.nativeRetry(retry()); expect(controls.snapshot("a").modelRecovery).toMatchObject({ source: "native-error", message: "terminal", willRetry: false, code: "badRequest" });
 controls.handle({ method: "item/agentMessage/delta", params: { threadId: "a", turnId: "turn-a", itemId: "cleanup", delta: "partial cleanup" } }); expect(controls.snapshot("a").modelRecovery?.willRetry).toBe(false);
});
it("represents both possible fd arrival orders as an observation when progress emission order is unknowable", () => {
 start(); vi.advanceTimersByTime(30); controls.handle({ method: "item/agentMessage/delta", params: { threadId: "a", turnId: "turn-a", itemId: "late-output", delta: "old output read late" } });
 const value = retry(); value.emittedAt = Date.now() - 10; value.timestamp = new Date(value.emittedAt).toISOString();
 expect(controls.nativeRetry(value)).toBe("a"); expect(controls.snapshot("a").modelRecovery).toMatchObject({ phase: "retry_observed", attempt: 1 });
 controls.handle({ method: "turn/completed", params: { threadId: "a", turn: { id: "turn-a", status: "completed" } } }); expect(controls.snapshot("a").modelRecovery).toBeNull();
});
it("preserves exact current-turn faults during an unresolved steer RPC without sending again", async () => {
 let resolve!: (value: unknown) => void;
 const call = vi.fn(async (method: string) => method === "thread/turns/list" ? { data: [{ id: "current", status: "inProgress" }] } : method === "turn/steer" ? new Promise(done => { resolve = done; }) : {});
 const c = new CodexSessionControls({ ready: true, call }, () => [], { nativeGeneration: "child-1" });
 c.handle({ method: "turn/started", params: { threadId: "office", turn: { id: "current" } } });
 const sending = c.send("office", "fixture user input", "fixture-request"); await vi.waitFor(() => expect(call).toHaveBeenCalledWith("turn/steer", expect.anything())); expect(c.state("office").turnStateKnown).toBe(false);
 c.nativeRetry(retry("current")); c.handle({ method: "error", params: { threadId: "office", turnId: "current", willRetry: true, error: { message: "public", additionalDetails: "kept during steer" } } });
 expect(c.snapshot("office").modelRecovery).toMatchObject({ attempt: 1, additionalDetails: "kept during steer" });
 resolve({ turnId: "current" }); await sending; expect(c.snapshot("office").modelRecovery?.additionalDetails).toBe("kept during steer"); expect(call.mock.calls.filter(([m]) => m === "turn/steer")).toHaveLength(1); c.close();
});
