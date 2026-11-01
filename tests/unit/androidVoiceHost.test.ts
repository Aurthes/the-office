import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareAndroidVoice } from "../../src/features/office/components/androidVoiceHost";
afterEach(() => { delete window.OfficeAndroid; vi.useRealTimers(); });
function host() {
  const postMessage = vi.fn();
  window.OfficeAndroid = { postMessage, onmessage: null };
  return { postMessage, push: (value: unknown) => window.OfficeAndroid?.onmessage?.({ data: JSON.stringify(value) }) };
}
describe("Android voice foreground lease", () => {
  it("leaves ordinary browser calls independent of the wrapper", async () => {
    expect(await prepareAndroidVoice("id", "thread", vi.fn(), new AbortController().signal)).toBeUndefined();
  });
  it("waits for Android readiness, binds notification controls to the same call, and releases once", async () => {
    const native = host(), onCommand = vi.fn();
    const pending = prepareAndroidVoice("original", "thread", onCommand, new AbortController().signal);
    expect(JSON.parse(native.postMessage.mock.calls[0][0])).toEqual({ type: "voice.prepare", id: "original", threadId: "thread" });
    native.push({ type: "voice.prepared", id: "original" });
    const lease = (await pending)!;
    lease.update("connected", true);
    expect(JSON.parse(native.postMessage.mock.calls[1][0])).toEqual({ type: "voice.state", id: "original", status: "connected", muted: true });
    native.push({ type: "voice.command", id: "other", command: "stop" });
    expect(onCommand).not.toHaveBeenCalled();
    native.push({ type: "voice.command", id: "original", command: "toggleMute" });
    expect(onCommand).toHaveBeenCalledWith("toggleMute");
    lease.release(); lease.release();
    expect(native.postMessage.mock.calls.filter(([text]) => JSON.parse(text).type === "voice.release")).toHaveLength(1);
    expect(window.OfficeAndroid!.onmessage).toBeNull();
  });
  it("cancels permission preparation immediately and ignores late replies", async () => {
    const native = host(), controller = new AbortController();
    const pending = prepareAndroidVoice("original", "thread", vi.fn(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(JSON.parse(native.postMessage.mock.calls.at(-1)![0])).toEqual({ type: "voice.release", id: "original" });
    native.push({ type: "voice.prepared", id: "original" });
    expect(window.OfficeAndroid!.onmessage).toBeNull();
  });
  it("reports native failure and cleans up a timed-out preparation", async () => {
    const native = host();
    const denied = prepareAndroidVoice("first", "thread", vi.fn(), new AbortController().signal);
    native.push({ type: "voice.prepared", id: "first", error: "Microphone denied" });
    await expect(denied).rejects.toThrow("Microphone denied");
    vi.useFakeTimers();
    const timeout = prepareAndroidVoice("second", "thread", vi.fn(), new AbortController().signal);
    const rejected = expect(timeout).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(65000); await rejected;
    expect(JSON.parse(native.postMessage.mock.calls.at(-1)![0])).toEqual({ type: "voice.release", id: "second" });
  });
});
