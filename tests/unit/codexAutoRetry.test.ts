import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls.js");
const capacity = { message: "Selected model is at capacity. Please try a different model.", codexErrorInfo: "policyCapacityUnavailable" };
const cleanups: Array<() => void> = [];
function fixture(canRetry = vi.fn(async () => true)) {
  let latest: { id: string; status: string; error?: typeof capacity } = { id: "failed", status: "inProgress" };
  let next = 0;
  const changed = vi.fn();
  const client = { ready: true, call: vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method, params) => {
    if (method === "thread/turns/list") return { data: [latest] };
    if (method === "turn/start") {
      latest = { id: `retry-${++next}`, status: "inProgress" };
      controls.handle({ method: "turn/started", params: { threadId: "id", turn: latest } });
      return { turn: latest, params };
    }
    return {};
  }) };
  let persisted = { attempts: 0, stopped: false };
  const options = { changed, canRetry, recovery: { read: () => persisted, write: (_id: string, value: typeof persisted) => { persisted = value; } } };
  let controls = new CodexSessionControls(client, () => [], options);
  const register = (value: typeof controls) => { cleanups.push(() => value.close()); return value; };
  register(controls);
  const restart = () => { controls.close(); controls = register(new CodexSessionControls(client, () => [], options)); return controls; };
  const emit = (status: string, error = capacity, turnId = latest.id) => {
    latest = { id: turnId, status, ...(status === "failed" ? { error } : {}) };
    controls.handle({ method: status === "inProgress" ? "turn/started" : "turn/completed", params: { threadId: "id", turn: latest } });
  };
  emit("inProgress");
  const starts = () => client.call.mock.calls.filter(([m]) => m === "turn/start");
  return { get controls() { return controls; }, client, emit, starts, changed, restart, setLatest: (turn: typeof latest) => { latest = turn; } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).forEach(close => close()); vi.useRealTimers(); });

describe("backend-owned automatic recovery", () => {
  it("waits the full 15 seconds, continues once in the same session, and clears the stale error", async () => {
    const f = fixture(), failedStartedAt = f.controls.snapshot("id").activeTurnStartedAt;
    f.controls.options.usageMetadata = true;
    f.emit("failed");
    expect(f.controls.snapshot("id").activeTurnStartedAt).toBeNull();
    const retryAt = f.controls.snapshot("id").retryAt;
    expect(retryAt).toBe(Date.now() + 15000);
    // Repeated events or snapshots from multiple views cannot own more timers.
    f.emit("failed"); f.controls.snapshot("id"); f.controls.snapshot("id");
    await vi.advanceTimersByTimeAsync(14999); expect(f.starts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(f.starts()).toHaveLength(1);
    expect(f.controls.snapshot("id").activeTurnStartedAt).toBe(failedStartedAt + 15000);
    expect(f.starts()[0][1]).toMatchObject({ threadId: "id", input: [{ type: "text", text: "Continue where you left off." }] });
    expect((f.starts()[0] as unknown[])[2]).toMatchObject({ trigger: "automaticRetry", inheritTurnId: "failed" });
    expect(f.controls.snapshot("id")).toMatchObject({ activeTurnId: "retry-1", error: null, retryAt: null });
    f.emit("completed"); await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(1);
  });
  it("waits another 15 seconds if the retry also ends with capacity exhaustion", async () => {
    const f = fixture(); f.emit("failed"); await vi.advanceTimersByTimeAsync(15000);
    f.emit("failed"); await vi.advanceTimersByTimeAsync(14999); expect(f.starts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(f.starts()).toHaveLength(2);
  });
  it.each(["serverOverloaded", "policyCapacityUnavailable", "other"])("recognizes the capacity error variant %s", async codexErrorInfo => {
    const f = fixture(); f.emit("failed", { ...capacity, codexErrorInfo });
    await vi.advanceTimersByTimeAsync(15000); expect(f.starts()).toHaveLength(1);
  });
  it.each(["unauthorized", "usageLimitExceeded", "contextWindowExceeded", "sandboxError", "badRequest"])("recovers %s errors without a code allowlist", async codexErrorInfo => {
    const f = fixture(); f.emit("failed", { message: "Different failure", codexErrorInfo });
    await vi.advanceTimersByTimeAsync(15000); expect(f.starts()).toHaveLength(1);
  });
  it("does not compete with a native retry, or resume a user interruption", async () => {
    const f = fixture(); f.controls.handle({ method: "error", params: { threadId: "id", turnId: "failed", error: capacity, willRetry: true } });
    await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(0);
    await f.controls.stop("id");
    f.emit("interrupted"); await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(0);
  });
  it("cancels pending recovery on Stop without rearming it when refreshing the failed turn", async () => {
    const f = fixture(); f.emit("failed"); await f.controls.stop("id"); await f.controls.refreshTurn("id");
    await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(0); expect(f.controls.snapshot("id").retryAt).toBeNull();
  });
  it("gives a new user message priority over automatic continuation", async () => {
    const f = fixture(); f.emit("failed"); await f.controls.send("id", "new instructions", "manual");
    await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(1);
    expect(f.starts()[0][1]).toMatchObject({ input: [{ type: "text", text: "new instructions" }] });
  });
  it("cancels even after the timer fires while readiness is still being checked", async () => {
    let ready!: (allowed: boolean) => void;
    const f = fixture(vi.fn(() => new Promise<boolean>(resolve => { ready = resolve; })));
    f.emit("failed"); await vi.advanceTimersByTimeAsync(15000);
    expect(f.controls.snapshot("id").retrying).toBe(true);
    await f.controls.stop("id"); ready(true); await vi.advanceTimersByTimeAsync(0);
    expect(f.starts()).toHaveLength(0);
  });
  it("does not restart an archived, busy, unauthenticated or input-blocked session", async () => {
    const f = fixture(vi.fn(async () => false)); f.emit("failed");
    await vi.advanceTimersByTimeAsync(15000); expect(f.starts()).toHaveLength(0); expect(f.controls.snapshot("id").retryAt).toBeNull();
  });
  it("ignores a late failure from an older turn", async () => {
    const f = fixture(); f.emit("inProgress", capacity, "newer");
    f.controls.handle({ method: "turn/completed", params: { threadId: "id", turn: { id: "older", status: "failed", error: capacity } } });
    await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(0); expect(f.controls.snapshot("id").activeTurnId).toBe("newer");
  });
  it("bounds repeated RPC failures at three attempts", async () => {
    const f = fixture(); f.emit("failed");
    const normal = f.client.call.getMockImplementation()!;
    f.client.call.mockImplementation(async (method, params) => { if (method === "turn/start") throw new Error("connection lost; outcome unknown"); return normal(method, params); });
    await vi.advanceTimersByTimeAsync(75000); expect(f.starts()).toHaveLength(3);
    expect(f.controls.snapshot("id")).toMatchObject({ retryAt: null, retryExhausted: true, error: "connection lost; outcome unknown" });
  });
  it("does not replay historical failures on attach and cancels timers on shutdown", async () => {
    const f = fixture(); f.controls.close();
    const controls = new CodexSessionControls(f.client); cleanups.push(() => controls.close());
    f.emit("failed"); await controls.attach("id"); expect(controls.snapshot("id").retryAt).toBeNull();
    controls.handle({ method: "turn/started", params: { threadId: "id", turn: { id: "fresh" } } });
    controls.handle({ method: "turn/completed", params: { threadId: "id", turn: { id: "fresh", status: "failed", error: capacity } } });
    expect(controls.snapshot("id").retryAt).toBeTruthy();
    controls.handle({ method: "connection/closed" }); await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(0);
  });

  it.each(["failed", "interrupted"])("recovers a stored %s turn at gateway startup without opening its chat", async status => {
    const f = fixture(); f.emit(status);
    const restarted = f.restart(); await restarted.recover("id");
    expect(f.client.call.mock.calls.some(([m]) => m === "thread/resume")).toBe(false);
    await vi.advanceTimersByTimeAsync(15000); expect(f.starts()).toHaveLength(1);
    expect(f.starts()[0][1]).toMatchObject({ threadId: "id", input: [{ type: "text", text: "Continue where you left off." }] });
  });
  it("recovers an unexpected live interruption without a model-capacity error", async () => {
    const f = fixture(); f.emit("interrupted");
    await vi.advanceTimersByTimeAsync(15000); expect(f.starts()).toHaveLength(1);
  });
  it("stops after three automatic attempts even when every retry fails", async () => {
    const f = fixture(); f.emit("failed");
    for (let attempt = 1; attempt <= 3; attempt++) {
      await vi.advanceTimersByTimeAsync(15000); expect(f.starts()).toHaveLength(attempt); f.emit("failed");
    }
    expect(f.controls.snapshot("id")).toMatchObject({ turnStatus: "failed", retryAt: null, retryExhausted: true });
    await vi.advanceTimersByTimeAsync(120000); expect(f.starts()).toHaveLength(3);
  });
  it("preserves the budget when native start notifications arrive after the RPC response", async () => {
    const f = fixture(), normal = f.client.call.getMockImplementation()!; let index = 0;
    f.client.call.mockImplementation(async (method, params) => {
      if (method === "turn/start") {
        const turn = { id: `response-first-${++index}`, status: "inProgress" }; f.setLatest(turn); return { turn, params };
      }
      return normal(method, params);
    });
    f.emit("failed");
    for (let attempt = 1; attempt <= 3; attempt++) {
      await vi.advanceTimersByTimeAsync(15000);
      f.emit("inProgress", capacity, `response-first-${attempt}`); f.emit("failed");
    }
    expect(f.controls.snapshot("id")).toMatchObject({ retryAt: null, retryExhausted: true });
    await f.restart().recover("id"); await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(3);
  });
  it("keeps a native failure that arrives before turn/start returns, including its next retry", async () => {
    const f = fixture(), normal = f.client.call.getMockImplementation()!; let index = 0;
    f.client.call.mockImplementation(async (method, params) => {
      if (method === "turn/start") {
        const id = `immediate-failure-${++index}`;
        f.emit("inProgress", capacity, id); f.emit("failed", capacity, id); return { turn: { id } };
      }
      return normal(method, params);
    });
    f.emit("failed"); await vi.advanceTimersByTimeAsync(60000);
    expect(f.starts()).toHaveLength(3);
    expect(f.controls.snapshot("id")).toMatchObject({ activeTurnId: null, turnStatus: "failed", retryAt: null, retryExhausted: true });
  });
  it("preserves the three-attempt budget through repeated gateway restarts", async () => {
    const f = fixture(); f.emit("failed");
    for (let attempt = 1; attempt <= 3; attempt++) {
      await f.restart().recover("id");
      await vi.advanceTimersByTimeAsync(15000); expect(f.starts()).toHaveLength(attempt); f.emit("failed");
    }
    await f.restart().recover("id"); await vi.advanceTimersByTimeAsync(90000);
    expect(f.starts()).toHaveLength(3); expect(f.controls.snapshot("id").retryExhausted).toBe(true);
  });
  it("keeps explicit Stop stopped across a restart and a repeated native interruption", async () => {
    const f = fixture(); f.emit("failed"); await f.controls.stop("id");
    await f.restart().recover("id"); await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(0);
    f.emit("inProgress", capacity, "running"); await f.controls.stop("id"); f.emit("interrupted");
    await f.restart().recover("id"); await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(0);
  });
  it("does not let a late native start revoke an explicit Stop", async () => {
    const f = fixture(); f.emit("failed"); await f.controls.stop("id");
    f.emit("inProgress", capacity, "late-native-start"); f.emit("interrupted");
    await f.restart().recover("id"); await vi.advanceTimersByTimeAsync(60000);
    expect(f.starts()).toHaveLength(0); expect(f.controls.snapshot("id").retryAt).toBeNull();
  });
  it("resets the budget after a successful turn or an explicit new user message", async () => {
    const f = fixture(); f.emit("failed");
    for (let i = 0; i < 3; i++) { await vi.advanceTimersByTimeAsync(15000); f.emit("failed"); }
    expect(f.controls.snapshot("id").retryExhausted).toBe(true);
    await f.controls.send("id", "new instructions", "new-request"); f.emit("failed");
    await vi.advanceTimersByTimeAsync(15000); expect(f.starts()).toHaveLength(5);
    f.emit("completed");
    f.setLatest({ id: "another-failure", status: "failed", error: capacity }); await f.restart().recover("id");
    await vi.advanceTimersByTimeAsync(15000); expect(f.starts()).toHaveLength(6);
  });
  it("checks an ambiguous RPC outcome instead of duplicating an accepted native turn", async () => {
    const f = fixture(), normal = f.client.call.getMockImplementation()!; f.emit("failed");
    f.client.call.mockImplementation(async (method, params) => {
      if (method === "turn/start") { f.setLatest({ id: "accepted-without-response", status: "inProgress" }); throw new Error("response lost"); }
      return normal(method, params);
    });
    await vi.advanceTimersByTimeAsync(90000);
    expect(f.starts()).toHaveLength(1);
    expect(f.controls.snapshot("id")).toMatchObject({ activeTurnId: "accepted-without-response", retryAt: null });
  });
  it("does not revive work that completed before the retry timer fired", async () => {
    const f = fixture(); f.emit("failed"); f.setLatest({ id: "finished-elsewhere", status: "completed" });
    await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(0);
    expect(f.controls.snapshot("id")).toMatchObject({ turnStatus: "completed", retryAt: null, retryExhausted: false });
  });
  it("interrupts the exact retry turn if Stop arrived while turn/start was in flight", async () => {
    const f = fixture(), normal = f.client.call.getMockImplementation()!;
    let resolve!: (value: { turn: { id: string } }) => void;
    f.client.call.mockImplementation(async (method, params) => method === "turn/start" ? new Promise(done => { resolve = value => done(value); }) : normal(method, params));
    f.emit("failed"); await vi.advanceTimersByTimeAsync(15000);
    await f.controls.stop("id");
    f.emit("inProgress", capacity, "late-retry"); resolve({ turn: { id: "late-retry" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.client.call).toHaveBeenCalledWith("turn/interrupt", { threadId: "id", turnId: "late-retry" });
    f.emit("interrupted"); await f.restart().recover("id"); await vi.advanceTimersByTimeAsync(60000);
    expect(f.starts()).toHaveLength(1);
  });
});
