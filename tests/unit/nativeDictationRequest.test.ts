import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeDictationRequest } from "@/features/office/components/nativeDictationRequest";
import type { SessionClient } from "@/features/office/components/SessionControls";
const params = { threadId: "thread", id: "recording", sequence: 4 };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function channel() {
  let listener!: (event: { event: string; payload?: unknown }) => void;
  const unsubscribe = vi.fn(), call = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({ pending: true }));
  const client: SessionClient = { call, onEvent: handler => { listener = handler; return unsubscribe; } };
  const push = (extra = {}) => listener({ event: "session.dictation", payload: { ...params, operation: "finish", result: { text: "complete words" }, ...extra } });
  return { client, call, push, unsubscribe };
}
describe("native dictation completion push", () => {
  it("accepts a result after the ordinary RPC deadline and ignores another recording's result", async () => {
    const h = channel(); let settled = false;
    const result = nativeDictationRequest<{ text: string }>(h.client, "finish", params).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(25000);
    h.push({ id: "other" }); h.push({ threadId: "other" }); h.push({ operation: "start" });
    await Promise.resolve(); expect(settled).toBe(false);
    h.push(); expect(await result).toEqual({ text: "complete words" });
    expect(h.call).toHaveBeenCalledExactlyOnceWith("session.dictation.finish", { ...params, asyncResult: true });
    expect(h.unsubscribe).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("handles an immediate pushed result before its RPC acknowledgement", async () => {
    const h = channel(); const result = nativeDictationRequest(h.client, "finish", params);
    h.push(); expect(await result).toEqual({ text: "complete words" });
  });
  it("cancels only its wait, removes the listener and ignores a late result", async () => {
    const h = channel(), controller = new AbortController();
    const result = nativeDictationRequest(h.client, "finish", params, controller.signal);
    const rejected = expect(result).rejects.toThrow("cancelled");
    controller.abort(); await rejected; h.push();
    expect(h.unsubscribe).toHaveBeenCalledOnce(); expect(h.call).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds the longer wait and exposes which stage timed out", async () => {
    const h = channel(); const result = nativeDictationRequest(h.client, "start", params);
    const rejected = expect(result).rejects.toThrow("preparation timed out");
    await vi.advanceTimersByTimeAsync(60000); await rejected;
    expect(h.unsubscribe).toHaveBeenCalledOnce(); expect(h.call).toHaveBeenCalledOnce();
  });
  it("surfaces recognition errors and accepts legacy immediate responses", async () => {
    const h = channel(); const result = nativeDictationRequest(h.client, "finish", params);
    const rejected = expect(result).rejects.toThrow("recognition failed"); h.push({ error: "recognition failed" }); await rejected;
    h.call.mockResolvedValueOnce({ text: "legacy" });
    expect(await nativeDictationRequest(h.client, "finish", params)).toEqual({ text: "legacy" });
  });
});
