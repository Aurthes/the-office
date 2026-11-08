import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
const { CodexSessionPredictions } = createRequire(import.meta.url)("../../server/codex-session-predictions.js");
afterEach(() => vi.unstubAllEnvs());
function fixture(telemetry: { sample?: (value: unknown) => unknown; unavailable?: () => unknown } = {}) {
  vi.stubEnv("OPENAI_API_KEY", "");
  const state = { lastTurnId: "turn-1", activeTurnId: null as string | null, turnStatus: "completed" };
  const store = { get: vi.fn(() => ({ codexThreadId: "native-thread" })), isBusy: vi.fn(() => false), call: vi.fn(async () => ({ text: "  检查报告链接  ", sourceTurnId: "turn-1" })) };
  const controls = { attach: vi.fn(async () => {}), refreshTurn: vi.fn(async () => {}), state: vi.fn(() => state) };
  return { state, store, controls, predictions: new CodexSessionPredictions(store, controls, telemetry) };
}
it("uses the logged-in Codex sampler on the last completed Office turn, with no API key or new turn", async () => {
  const f = fixture();
  expect(await f.predictions.suggest("office-thread")).toEqual({ text: "检查报告链接", sourceTurnId: "turn-1" });
  expect(f.store.call).toHaveBeenCalledExactlyOnceWith("thread/sample", { threadId: "office-thread", expectedTurnId: "turn-1", disableMcp: true, effort: "low", prompt: expect.stringContaining("Do not answer it, execute work, or use tools") });
  expect(f.controls.attach).toHaveBeenCalledWith("office-thread");
});
it("shares a pending sample and caches the result when the same completed chat is reopened", async () => {
  const f = fixture(); let resolve!: (value: { text: string; sourceTurnId: string }) => void;
  f.store.call.mockImplementation(() => new Promise(r => { resolve = r; }));
  const a=f.predictions.suggest("office-thread"), b=f.predictions.suggest("office-thread");
  await vi.waitFor(() => expect(f.store.call).toHaveBeenCalledTimes(1));
  resolve({ text: "Next", sourceTurnId: "turn-1" });
  expect(await Promise.all([a,b])).toEqual([{text:"Next",sourceTurnId:"turn-1"},{text:"Next",sourceTurnId:"turn-1"}]);
  await f.predictions.suggest("office-thread"); expect(f.store.call).toHaveBeenCalledTimes(1);
});
it("discards an in-flight sample after a real turn starts, and samples again after it completes", async () => {
  const f=fixture(); let resolve!: (value: {text:string;sourceTurnId:string}) => void;
  f.store.call.mockImplementationOnce(() => new Promise(r => {resolve=r;}));
  const pending=f.predictions.suggest("office-thread"); await vi.waitFor(() => expect(f.store.call).toHaveBeenCalledOnce());
  f.state.lastTurnId="turn-2";f.state.activeTurnId="turn-2";f.state.turnStatus="inProgress";
  resolve({text:"Old",sourceTurnId:"turn-1"}); expect(await pending).toBeNull();
  f.state.activeTurnId=null;f.state.turnStatus="completed";f.store.call.mockResolvedValueOnce({text:"New",sourceTurnId:"turn-2"});
  expect(await f.predictions.suggest("office-thread")).toEqual({text:"New",sourceTurnId:"turn-2"});
  expect(f.store.call).toHaveBeenLastCalledWith("thread/sample",expect.objectContaining({expectedTurnId:"turn-2"}));
});
it.each(["inProgress","failed","interrupted"])("does not sample %s turns", async status => {
  const f=fixture();f.state.turnStatus=status;
  expect(await f.predictions.suggest("office-thread")).toBeNull();expect(f.store.call).not.toHaveBeenCalled();
});
it("does not create a Codex thread for an empty Office chat or sample a busy chat", async () => {
  const f=fixture();f.store.get.mockReturnValueOnce({codexThreadId: ""});
  expect(await f.predictions.suggest("office-thread")).toBeNull();expect(f.controls.attach).not.toHaveBeenCalled();
  f.store.isBusy.mockReturnValueOnce(true);expect(await f.predictions.suggest("office-thread")).toBeNull();expect(f.store.call).not.toHaveBeenCalled();
});
it("does not sample when another operation becomes busy during attachment", async () => {
  const f = fixture();
  f.controls.refreshTurn.mockImplementationOnce(async () => { f.store.isBusy.mockReturnValue(true); });
  expect(await f.predictions.suggest("office-thread")).toBeNull();
  expect(f.store.call).not.toHaveBeenCalled();
});
it.each([{text:null,sourceTurnId:"turn-1"},{text:" ",sourceTurnId:"turn-1"},{text:"x".repeat(1001),sourceTurnId:"turn-1"},{text:"Stale",sourceTurnId:"other"}])("ignores empty, tool-only or mismatched sampler results", async result => {
  const f=fixture();f.store.call.mockResolvedValueOnce(result as never);expect(await f.predictions.suggest("office-thread")).toBeNull();
});
it("contains sampler errors and does not repeatedly bill the same failed suggestion", async () => {
  const f=fixture();f.store.call.mockRejectedValueOnce(new Error("Not supported by provider"));
  expect(await f.predictions.suggest("office-thread")).toBeNull();expect(await f.predictions.suggest("office-thread")).toBeNull();expect(f.store.call).toHaveBeenCalledOnce();
});
it("meters one native cache miss before empty/stale filtering, without suggestion text or duplicate waiters", async () => {
  const sample = vi.fn(), f = fixture({ sample });
  const value = { text: null, responseId: "resp", sourceTurnId: "turn-1", inputTokens: 100, cachedInputTokens: 60, outputTokens: 10 };
  let resolve!: (result: typeof value) => void;
  f.store.call.mockImplementationOnce(() => new Promise<typeof value>(r => { resolve = r; }) as never);
  const a = f.predictions.suggest("office-thread"), b = f.predictions.suggest("office-thread");
  await vi.waitFor(() => expect(f.store.call).toHaveBeenCalledOnce()); f.state.activeTurnId = "new"; resolve(value);
  expect(await Promise.all([a, b])).toEqual([null, null]); expect(sample).toHaveBeenCalledExactlyOnceWith({ officeAgentId: "office-thread", contextNativeThreadId: "native-thread", responseId: "resp", sourceTurnId: "turn-1", inputTokens: 100, cachedInputTokens: 60, outputTokens: 10 });
  f.state.activeTurnId = null; await f.predictions.suggest("office-thread"); expect(sample).toHaveBeenCalledOnce();
});
it("contains thrown/rejected/slow metering callbacks and records native error gaps once without retry", async () => {
  for (const sample of [() => { throw new Error("meter"); }, () => Promise.reject(new Error("meter")), () => new Promise(() => {})]) {
    const f = fixture({ sample }); expect(await f.predictions.suggest("id")).toMatchObject({ text: "检查报告链接" });
  }
  const unavailable = vi.fn(() => { throw new Error("meter"); }), f = fixture({ unavailable });
  f.store.call.mockRejectedValueOnce(new Error("source changed after sample"));
  expect(await f.predictions.suggest("id")).toBeNull(); expect(await f.predictions.suggest("id")).toBeNull(); expect(unavailable).toHaveBeenCalledOnce(); expect(f.store.call).toHaveBeenCalledOnce();
});
it("records new sampler response IDs after cache restart, even for the same source turn", async () => {
  const sample = vi.fn(), f = fixture({ sample });
  f.store.call.mockResolvedValueOnce({ text: "one", sourceTurnId: "turn-1", responseId: "resp-one", inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 } as never);
  await f.predictions.suggest("id");
  const restarted = new CodexSessionPredictions(f.store, f.controls, { sample });
  f.store.call.mockResolvedValueOnce({ text: "two", sourceTurnId: "turn-1", responseId: "resp-two", inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 } as never);
  await restarted.suggest("id"); expect(sample.mock.calls.map(([value]) => value.responseId)).toEqual(["resp-one", "resp-two"]);
});
