import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
const { CodexSessionPredictions } = createRequire(import.meta.url)("../../server/codex-session-predictions.js");
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv("OPENAI_API_KEY", "");
  const state = { lastTurnId: "turn-1", activeTurnId: null as string | null, turnStatus: "completed" };
  const row = { codexThreadId: "native-source", settings: { model: "gpt-6.1-sol", effort: "xhigh" } };
  const fork = vi.fn(async () => ({ thread: { id: "temporary-fork" }, model: "gpt-6-luna" }));
  const sample = vi.fn<() => Promise<{ text: string | null; sourceTurnId: string }>>(async () => ({ text: "  检查报告链接  ", sourceTurnId: "turn-1" }));
  const remove = vi.fn(async () => ({}));
  const native = { call: vi.fn(async (method: string) => {
    if (method === "thread/fork") return fork();
    if (method === "thread/sample") return sample();
    if (method === "thread/delete") return remove();
    throw new Error("Unexpected native method: " + method);
  }) };
  const store = { get: vi.fn(() => row), isBusy: vi.fn(() => false), client: native };
  const controls = { attach: vi.fn(async () => {}), refreshTurn: vi.fn(async () => {}), state: vi.fn(() => state) };
  return { row, state, native, fork, sample, remove, store, controls, predictions: new CodexSessionPredictions(store, controls) };
}
it("samples Luna low on a disposable copy, deletes it, and leaves the main session's Sol xhigh settings unchanged", async () => {
  const f = fixture();
  expect(await f.predictions.suggest("office-thread")).toEqual({ text: "检查报告链接", sourceTurnId: "turn-1" });
  expect(f.native.call.mock.calls).toEqual([
    ["thread/fork", { threadId: "native-source", lastTurnId: "turn-1", model: "gpt-6-luna", excludeTurns: true, deferGoalContinuation: true, config: { model_reasoning_effort: "low", thread_unload_delay_secs: 0 } }],
    ["thread/sample", { threadId: "temporary-fork", expectedTurnId: "turn-1", disableMcp: true, effort: "low", prompt: expect.stringContaining("Do not answer it, execute work, or use tools") }],
    ["thread/delete", { threadId: "temporary-fork" }],
  ]);
  expect(f.row.settings).toEqual({ model: "gpt-6.1-sol", effort: "xhigh" });
});
it("shares the pending fork/sample and reuses its result when the same completed chat is reopened", async () => {
  const f = fixture(); let resolve!: (value: { text: string; sourceTurnId: string }) => void;
  f.sample.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const a = f.predictions.suggest("office-thread"), b = f.predictions.suggest("office-thread");
  await vi.waitFor(() => expect(f.sample).toHaveBeenCalledOnce());
  expect(f.fork).toHaveBeenCalledOnce(); expect(f.remove).not.toHaveBeenCalled();
  resolve({ text: "Next", sourceTurnId: "turn-1" });
  expect(await Promise.all([a, b])).toEqual([{ text: "Next", sourceTurnId: "turn-1" }, { text: "Next", sourceTurnId: "turn-1" }]);
  await f.predictions.suggest("office-thread");
  expect(f.fork).toHaveBeenCalledOnce(); expect(f.sample).toHaveBeenCalledOnce(); expect(f.remove).toHaveBeenCalledOnce();
});
it("discards and cleans up an in-flight suggestion after a real turn starts, then samples the next completed turn", async () => {
  const f = fixture(); let resolve!: (value: { text: string; sourceTurnId: string }) => void;
  f.sample.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = f.predictions.suggest("office-thread"); await vi.waitFor(() => expect(f.sample).toHaveBeenCalledOnce());
  f.state.lastTurnId = "turn-2"; f.state.activeTurnId = "turn-2"; f.state.turnStatus = "inProgress";
  resolve({ text: "Old", sourceTurnId: "turn-1" }); expect(await pending).toBeNull(); expect(f.remove).toHaveBeenCalledOnce();
  f.state.activeTurnId = null; f.state.turnStatus = "completed"; f.sample.mockResolvedValueOnce({ text: "New", sourceTurnId: "turn-2" });
  expect(await f.predictions.suggest("office-thread")).toEqual({ text: "New", sourceTurnId: "turn-2" });
  expect(f.native.call).toHaveBeenCalledWith("thread/fork", expect.objectContaining({ lastTurnId: "turn-2" }));
  expect(f.remove).toHaveBeenCalledTimes(2);
});
it.each(["inProgress", "failed", "interrupted"])("does not fork %s turns", async status => {
  const f = fixture(); f.state.turnStatus = status;
  expect(await f.predictions.suggest("office-thread")).toBeNull(); expect(f.native.call).not.toHaveBeenCalled();
});
it("does not create a Codex thread for an empty or busy Office chat", async () => {
  const f = fixture(); f.store.get.mockReturnValueOnce({ ...f.row, codexThreadId: "" });
  expect(await f.predictions.suggest("office-thread")).toBeNull(); expect(f.controls.attach).not.toHaveBeenCalled();
  f.store.isBusy.mockReturnValueOnce(true); expect(await f.predictions.suggest("office-thread")).toBeNull(); expect(f.native.call).not.toHaveBeenCalled();
});
it("does not fork when another operation becomes busy during attachment", async () => {
  const f = fixture(); f.controls.refreshTurn.mockImplementationOnce(async () => { f.store.isBusy.mockReturnValue(true); });
  expect(await f.predictions.suggest("office-thread")).toBeNull(); expect(f.native.call).not.toHaveBeenCalled();
});
it.each([{ text: null, sourceTurnId: "turn-1" }, { text: " ", sourceTurnId: "turn-1" }, { text: "x".repeat(1001), sourceTurnId: "turn-1" }, { text: "Stale", sourceTurnId: "other" }])("deletes the copy even when sampling produces no usable suggestion", async result => {
  const f = fixture(); f.sample.mockResolvedValueOnce(result);
  expect(await f.predictions.suggest("office-thread")).toBeNull(); expect(f.remove).toHaveBeenCalledOnce();
});
it("deletes the copy on a sampler error and does not repeatedly bill the same failed suggestion", async () => {
  const f = fixture(); f.sample.mockRejectedValueOnce(new Error("Unavailable"));
  expect(await f.predictions.suggest("office-thread")).toBeNull(); expect(await f.predictions.suggest("office-thread")).toBeNull();
  expect(f.fork).toHaveBeenCalledOnce(); expect(f.sample).toHaveBeenCalledOnce(); expect(f.remove).toHaveBeenCalledOnce();
});
it("never samples or deletes the source when a fork response incorrectly returns its ID", async () => {
  const f = fixture(); f.fork.mockResolvedValueOnce({ thread: { id: "native-source" }, model: "gpt-6-luna" });
  expect(await f.predictions.suggest("office-thread")).toBeNull(); expect(f.sample).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
});
it("cleans up a fork without sampling when the requested model was not applied", async () => {
  const f = fixture(); f.fork.mockResolvedValueOnce({ thread: { id: "temporary-fork" }, model: "gpt-6.1-sol" });
  expect(await f.predictions.suggest("office-thread")).toBeNull(); expect(f.sample).not.toHaveBeenCalled(); expect(f.remove).toHaveBeenCalledOnce();
});
it.each(["busy", "new-turn"])("cleans up without sampling when the source becomes %s during forking", async reason => {
  const f = fixture(); f.fork.mockImplementationOnce(async () => {
    if (reason === "busy") f.store.isBusy.mockReturnValue(true); else f.state.lastTurnId = "turn-2";
    return { thread: { id: "temporary-fork" }, model: "gpt-6-luna" };
  });
  expect(await f.predictions.suggest("office-thread")).toBeNull(); expect(f.sample).not.toHaveBeenCalled(); expect(f.remove).toHaveBeenCalledOnce();
});
it("contains fork and cleanup failures without retrying or touching the source", async () => {
  const f = fixture(); f.fork.mockRejectedValueOnce(new Error("Fork failed"));
  expect(await f.predictions.suggest("office-thread")).toBeNull(); expect(f.remove).not.toHaveBeenCalled();
  f.state.lastTurnId = "turn-2"; f.sample.mockResolvedValueOnce({ text: "Next", sourceTurnId: "turn-2" }); f.remove.mockRejectedValueOnce(new Error("Delete failed"));
  expect(await f.predictions.suggest("office-thread")).toBeNull();
  expect(f.native.call).toHaveBeenLastCalledWith("thread/delete", { threadId: "temporary-fork" });
  expect(f.row).toEqual({ codexThreadId: "native-source", settings: { model: "gpt-6.1-sol", effort: "xhigh" } });
});
