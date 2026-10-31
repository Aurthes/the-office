import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { CodexComposerPredictions } = require("../../server/codex-composer-predictions");

function setup(config = {}, sample = {}) {
  const client = {
    ready: true,
    call: vi.fn(async (_method: string, _params?: unknown) => ({ data: [{ id: "done", status: "completed" }] })),
    sampleThread: vi.fn(async () => ({ sourceTurnId: "done", text: JSON.stringify({ suggestion: "Run the tests" }), ...sample })),
  };
  const readConfig = vi.fn(async () => ({ is_enabled: true, prompt: "Native account prompt", prediction_reasoning_effort: "high", ...config }));
  const service = new CodexComposerPredictions(client, { readConfig, account: async () => ({ accountId: "owner", token: "server-only" }), random: () => 0 });
  return { service, client, readConfig };
}
const context = { model: "gpt-6.1-sol", modelProvider: "openai", planMode: false };
describe("native composer predictions", () => {
  it("samples the completed original context once, without executing a normal turn or exposing configuration", async () => {
    const { service, client } = setup();
    const [a, b] = await Promise.all([service.request({ id: "original" }, context), service.request({ id: "original" }, context)]);
    expect(a).toEqual({ text: "Run the tests", sourceTurnId: "done" }); expect(b).toEqual(a);
    expect(client.sampleThread).toHaveBeenCalledTimes(1);
    expect(client.sampleThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: "original", expectedTurnId: "done", disableMcp: true, turnTrigger: "composer_predictions", threadSource: "composer_predictions", effort: "high" }));
    expect(client.call.mock.calls.every(([method]) => method === "thread/turns/list")).toBe(true);
  });
  it("respects account opt-out, unsupported models, sampling eligibility, plan mode and active turns", async () => {
    for (const config of [{ is_enabled: false }, { unsupported_models: [context.model] }, { catch_up_sample_rate: 0 }]) {
      const { service, client } = setup(config);
      expect(await service.request({ id: "original" }, context)).toBeNull(); expect(client.sampleThread).not.toHaveBeenCalled();
    }
    const { service, client } = setup();
    expect(await service.request({ id: "original" }, { ...context, planMode: true })).toBeNull();
    expect(await service.request({ id: "original" }, { ...context, modelProvider: "other" })).toBeNull();
    client.call.mockResolvedValue({ data: [{ id: "working", status: "inProgress" }] });
    expect(await service.request({ id: "original" }, context)).toBeNull(); expect(client.sampleThread).not.toHaveBeenCalled();
  });
  it("discards stale, malformed, empty and failed predictions without a fallback agent turn", async () => {
    for (const sample of [{ sourceTurnId: "older" }, { text: "not json" }, { text: '{"suggestion":null}' }]) {
      expect(await setup({}, sample).service.request({ id: "original" }, context)).toBeNull();
    }
    const { service, client } = setup(); client.sampleThread.mockRejectedValue(new Error("unsupported native method"));
    expect(await service.request({ id: "original" }, context)).toBeNull();
  });
  it("bounds simultaneous speculative generations", async () => {
    const { service, client } = setup(); const resolvers: ((value: { sourceTurnId: string; text: string }) => void)[] = [];
    client.sampleThread.mockImplementation(() => new Promise(r => { resolvers.push(r); }));
    const a = service.request({ id: "a" }, context), b = service.request({ id: "b" }, context);
    await vi.waitFor(() => expect(client.sampleThread).toHaveBeenCalledTimes(2));
    expect(await service.request({ id: "c" }, context)).toBeNull();
    resolvers.forEach(resolve => resolve({ sourceTurnId: "done", text: '{"suggestion":null}' }));
    await Promise.all([a, b]);
  });
});
