import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls.js");
const capacity = { message: "Selected model is at capacity. Please try a different model.", codexErrorInfo: "policyCapacityUnavailable" };
const cleanups: Array<() => void> = [];
function fixture(canRetry = vi.fn(async () => true)) {
  let latest: { id: string; status: string; error?: typeof capacity } = { id: "failed", status: "inProgress" };
  let next = 0;
  const changed = vi.fn();
  const client = { ready: true, call: vi.fn(async (method: string, params: unknown) => {
    if (method === "thread/turns/list") return { data: [latest] };
    if (method === "turn/start") {
      latest = { id: `retry-${++next}`, status: "inProgress" };
      controls.handle({ method: "turn/started", params: { threadId: "id", turn: latest } });
      return { turn: latest, params };
    }
    return {};
  }) };
  const controls = new CodexSessionControls(client, () => [], { changed, canRetry });
  cleanups.push(() => controls.close());
  const emit = (status: string, error = capacity, turnId = latest.id) => {
    latest = { id: turnId, status, ...(status === "failed" ? { error } : {}) };
    controls.handle({ method: status === "inProgress" ? "turn/started" : "turn/completed", params: { threadId: "id", turn: latest } });
  };
  emit("inProgress");
  const starts = () => client.call.mock.calls.filter(([m]) => m === "turn/start");
  return { controls, client, emit, starts, changed };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).forEach(close => close()); vi.useRealTimers(); });

describe("backend-owned capacity recovery", () => {
  it("waits the full 15 seconds, continues once in the same session, and clears the stale error", async () => {
    const f = fixture(); f.emit("failed");
    const retryAt = f.controls.snapshot("id").retryAt;
    expect(retryAt).toBe(Date.now() + 15000);
    // Repeated events or snapshots from multiple views cannot own more timers.
    f.emit("failed"); f.controls.snapshot("id"); f.controls.snapshot("id");
    await vi.advanceTimersByTimeAsync(14999); expect(f.starts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(f.starts()).toHaveLength(1);
    expect(f.starts()[0][1]).toMatchObject({ threadId: "id", input: [{ type: "text", text: "Continue where you left off." }] });
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
  it.each(["unauthorized", "usageLimitExceeded", "contextWindowExceeded", "sandboxError", "badRequest"])("leaves %s errors for the user", async codexErrorInfo => {
    const f = fixture(); f.emit("failed", { message: "Different failure", codexErrorInfo });
    await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(0); expect(f.controls.snapshot("id").retryAt).toBeNull();
  });
  it("does not compete with a native retry, or resume a user interruption", async () => {
    const f = fixture(); f.controls.handle({ method: "error", params: { threadId: "id", turnId: "failed", error: capacity, willRetry: true } });
    await vi.advanceTimersByTimeAsync(60000); expect(f.starts()).toHaveLength(0);
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
  it("does not repeat an ambiguous retry RPC failure", async () => {
    const f = fixture(); f.emit("failed");
    const normal = f.client.call.getMockImplementation()!;
    f.client.call.mockImplementation(async (method, params) => { if (method === "turn/start") throw new Error("connection lost; outcome unknown"); return normal(method, params); });
    await vi.advanceTimersByTimeAsync(75000); expect(f.starts()).toHaveLength(1);
    expect(f.controls.snapshot("id")).toMatchObject({ retryAt: null, error: "connection lost; outcome unknown" });
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
});
