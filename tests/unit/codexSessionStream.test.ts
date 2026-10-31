import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls.js");
const { CodexSessionStream } = createRequire(import.meta.url)("../../server/codex-session-stream.js");
const setup = () => {
  const client = { ready: true, call: vi.fn(async (method: string) => ({ data: method === "thread/loaded/list" ? ["a", "b"] : [] })) };
  const controls = new CodexSessionControls(client), stream = new CodexSessionStream(controls);
  const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() };
  const frames = () => ws.send.mock.calls.map(([raw]) => JSON.parse(raw).payload);
  const emit = (method: string, params: object) => { controls.handle({ method, params }); stream.changed((params as { threadId: string }).threadId); };
  return { client, controls, stream, ws, frames, emit };
};
afterEach(() => vi.useRealTimers());
describe("push-based original-session stream", () => {
  it("pushes bootstrap, compact appends and authoritative completion without client reads", async () => {
    vi.useFakeTimers(); const { client, stream, ws, frames, emit } = setup();
    emit("item/started", { threadId: "a", turnId: "t", item: { id: "m", type: "agentMessage", phase: "final_answer", text: "x".repeat(32000) } });
    expect(await stream.subscribe(ws, "a", "subscription")).toEqual({ subscribed: true, subscriptionId: "subscription" });
    await vi.runAllTimersAsync(); const first = frames().at(-1); expect(first.items[0].content).toHaveLength(32000);
    emit("item/agentMessage/delta", { threadId: "a", turnId: "t", itemId: "m", delta: " flowing" });
    await vi.runAllTimersAsync(); const append = frames().at(-1);
    expect(append.items[0]).toMatchObject({ append: " flowing", baseVersion: first.items[0].version });
    expect(append.items[0].content).toBeUndefined(); expect(JSON.stringify(append).length).toBeLessThan(1000);
    emit("item/completed", { threadId: "a", turnId: "t", item: { id: "m", type: "agentMessage", phase: "final_answer", text: "short final" } });
    await vi.runAllTimersAsync(); expect(frames().at(-1).items[0]).toMatchObject({ content: "short final", status: "completed" });
    expect(frames().at(-1).items[0].append).toBeUndefined();
    expect(client.call.mock.calls.map(([method]) => method)).toEqual(["thread/resume", "thread/turns/list"]); // attach only; streaming does no native history reads
  });
  it("drains bounded bootstrap chunks on the server, retaining every version", async () => {
    vi.useFakeTimers(); const { stream, ws, frames, emit } = setup();
    for (let i = 0; i < 30; i++) emit("item/completed", { threadId: "a", turnId: "t", item: { id: String(i), type: "agentMessage", text: "x".repeat(32000) } });
    await stream.subscribe(ws, "a", "subscription"); await vi.runAllTimersAsync();
    expect(frames().flatMap(frame => frame.items.map((item: { id: string }) => item.id))).toEqual(Array.from({ length: 30 }, (_, i) => `t:${i}`));
    for (const [raw] of ws.send.mock.calls) expect(Buffer.byteLength(raw)).toBeLessThan(256 * 1024);
    expect(frames().at(-1).hasMore).toBe(false);
  });
  it("isolates threads and releases replaced subscriptions without stale cleanup removing the new one", async () => {
    vi.useFakeTimers(); const { stream, ws, frames, emit } = setup();
    await stream.subscribe(ws, "a", "old"); await vi.runAllTimersAsync();
    await stream.subscribe(ws, "b", "new"); stream.unsubscribe(ws, "old"); await vi.runAllTimersAsync(); ws.send.mockClear();
    emit("item/completed", { threadId: "a", turnId: "t", item: { id: "private", type: "agentMessage", text: "other thread" } });
    await vi.runAllTimersAsync(); expect(frames()).toEqual([]);
    emit("turn/started", { threadId: "b", turn: { id: "active" } });
    await vi.runAllTimersAsync(); expect(frames().at(-1)).toMatchObject({ threadId: "b", subscriptionId: "new", activeTurnId: "active" });
    stream.disconnected(ws); emit("turn/completed", { threadId: "b", turn: { id: "active", status: "completed" } });
    await vi.runAllTimersAsync(); expect(frames()).toHaveLength(1);
  });
  it("captures updates during attachment and cannot revive a superseded pending subscription", async () => {
    vi.useFakeTimers();const { controls, stream, ws, frames, emit } = setup();
    let finish!: () => void; const delayed = new Promise<void>(r => { finish = r; });
    controls.attach = vi.fn((id: string) => id === "a" ? delayed : Promise.resolve());
    const first = stream.subscribe(ws, "a", "old");
    emit("item/completed", { threadId: "a", turnId: "t", item: { id: "m", type: "agentMessage", text: "during attach" } });
    await stream.subscribe(ws, "b", "new");finish(); await first; await vi.runAllTimersAsync();
    expect(frames().map(frame => frame.subscriptionId)).toEqual(["new"]);
    await stream.subscribe(ws, "a", "recover"); await vi.runAllTimersAsync();
    expect(frames().at(-1).items[0].content).toBe("during attach");
  });
  it("closes an overloaded consumer for explicit resync instead of silently dropping updates", async () => {
    vi.useFakeTimers();const { stream, ws } = setup(); ws.bufferedAmount = 1024 * 1024;
    await stream.subscribe(ws, "a", "subscription");await vi.runAllTimersAsync();
    expect(ws.close).toHaveBeenCalledWith(1013, expect.any(String));expect(stream.subscriptions.size).toBe(0);expect(ws.send).not.toHaveBeenCalled();
  });
});
