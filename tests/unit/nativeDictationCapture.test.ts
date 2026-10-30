import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNativeDictation } from "../../src/features/office/components/useNativeDictation";
let port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: (value: unknown) => void };
const stopTrack = vi.fn();
function microphone() {
  class Context {
    state = "running"; destination = {}; onstatechange?: () => void;
    resume = async () => {}; close = async () => { this.state = "closed"; };
    audioWorklet = { addModule: vi.fn(async () => {}) };
    createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  }
  class Worklet {
    port = { onmessage: null as typeof port.onmessage, postMessage: () => { this.port.onmessage?.({ data: { stopped: true } }); } };
    constructor() { port = this.port; }
    connect = vi.fn(); disconnect = vi.fn();
  }
  const stream = { getTracks: () => [{ stop: stopTrack, addEventListener: vi.fn() }] };
  vi.stubGlobal("AudioContext", Context); vi.stubGlobal("AudioWorkletNode", Worklet);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  return stream;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.restoreAllMocks(); });
describe("browser recording to native dictation", () => {
  it("flushes without waiting for the last audio ACK, but checks it before inserting text", async () => {
    microphone(); const inserted = vi.fn(); const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    let acknowledge!: (value: unknown) => void, complete!: (value: unknown) => void;
    const call = vi.fn(async (method: string) => {
      if (method === "session.dictation.append") return new Promise(resolve => { acknowledge = resolve; });
      if (method === "session.dictation.finish") return new Promise(resolve => { complete = resolve; });
      return { started: true };
    });
    const { result } = renderHook(() => useNativeDictation("capture-ack", "", inserted, { call }));
    await act(async () => result.current.start()); act(() => port.onmessage?.({ data: { pcm: new Int16Array(3200) } }));
    let stopping!: Promise<void>; act(() => { stopping = result.current.stop(); });
    await waitFor(() => expect(complete).toBeTypeOf("function"));
    await act(async () => complete({ text: "native final" })); expect(inserted).not.toHaveBeenCalled();
    clock.mockReturnValue(1800);
    await act(async () => { acknowledge({ accepted: true }); await stopping; });
    expect(inserted).toHaveBeenCalledExactlyOnceWith("native final");
    expect(result.current.clip!.seconds).toBe(0.2);
    expect(result.current.transcriptionTime).toEqual({ seconds: 0.8, retry: false });
    act(() => result.current.clear());
  });
  it("prepares native transport during microphone permission and cancels when permission fails", async () => {
    microphone(); let denied!: (error: Error) => void;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise((_resolve, reject) => { denied = reject; }) } });
    const call = vi.fn(async () => ({ started: true }));
    const { result } = renderHook(() => useNativeDictation("capture-denied", "", vi.fn(), { call }));
    let starting!: Promise<void>; act(() => { starting = result.current.start(); });
    expect(call).toHaveBeenCalledWith("session.dictation.start", expect.anything());
    await act(async () => { denied(new Error("NotAllowedError")); await starting; });
    expect(call).toHaveBeenCalledWith("session.dictation.cancel", expect.anything());
    expect(result.current.phase).toBe("error");
  });
  it("cancels native preparation when leaving with microphone permission still pending", async () => {
    const stream = microphone(); let granted!: (value: unknown) => void;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise(resolve => { granted = resolve; }) } });
    const call = vi.fn(async () => ({ started: true }));
    const view = renderHook(() => useNativeDictation("capture-pending-leave", "", vi.fn(), { call }));
    let starting!: Promise<void>; act(() => { starting = view.result.current.start(); });
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(call).toHaveBeenCalledWith("session.dictation.cancel", expect.anything());
    await act(async () => { granted(stream); await starting; });
    expect(stopTrack).toHaveBeenCalledOnce();
  });
  it("streams during capture and inserts only the completed native transcript after stop", async () => {
    microphone(); const inserted = vi.fn(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    let complete!: (value: unknown) => void;
    const call = vi.fn(async (method: string) => method === "session.dictation.finish" ? new Promise(resolve => { complete = resolve; }) : { accepted: true });
    const { result } = renderHook(() => useNativeDictation("capture-stream", "draft", inserted, { call }));
    await act(async () => result.current.start());
    act(() => port.onmessage?.({ data: { pcm: new Int16Array(3200) } }));
    expect(call).toHaveBeenCalledWith("session.dictation.append", expect.objectContaining({ sequence: 0, threadId: "capture-stream" }));
    expect(inserted).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    let stopping!: Promise<void>; act(() => { stopping = result.current.stop(); });
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.dictation.finish", expect.objectContaining({ sequence: 1 })));
    expect(inserted).not.toHaveBeenCalled();
    await act(async () => { complete({ text: "native final" }); await stopping; });
    expect(inserted).toHaveBeenCalledExactlyOnceWith("draft native final");
    expect(fetcher).not.toHaveBeenCalled(); act(() => result.current.clear());
  });
  it("captures locally and inserts text only after stop and native completion", async () => {
    microphone(); const inserted = vi.fn(); let finish!: (response: unknown) => void;
    const fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useNativeDictation("capture-one", "prefix", inserted));
    await act(async () => result.current.start());
    act(() => port.onmessage?.({ data: { pcm: new Int16Array(3200) } }));
    expect(result.current.phase).toBe("recording"); expect(fetcher).not.toHaveBeenCalled(); expect(inserted).not.toHaveBeenCalled();
    await act(async () => result.current.stop());
    expect(result.current.phase).toBe("transcribing"); expect(inserted).not.toHaveBeenCalled();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("threadId=capture-one"); expect((init.body as Blob).type).toBe("audio/wav"); expect((init.body as Blob).size).toBe(6444);
    await act(async () => finish({ ok: true, json: async () => ({ text: "native transcript" }) }));
    expect(inserted).toHaveBeenCalledWith("prefix native transcript"); expect(stopTrack).toHaveBeenCalledOnce();
    act(() => result.current.clear());
  });
  it("keeps the same recording after failure for retry and chat-switch recovery", async () => {
    microphone(); const inserted = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: "temporary failure" }) }).mockResolvedValue({ ok: true, json: async () => ({ text: "recovered" }) }); vi.stubGlobal("fetch", fetcher);
    const first = renderHook(() => useNativeDictation("capture-retry", "", inserted));
    await act(async () => first.result.current.start()); act(() => port.onmessage?.({ data: { pcm: new Int16Array(3200) } }));
    await act(async () => first.result.current.stop()); await waitFor(() => expect(first.result.current.phase).toBe("error"));
    const blob = first.result.current.clip!.blob; expect(inserted).not.toHaveBeenCalled(); first.unmount();
    const second = renderHook(() => useNativeDictation("capture-retry", "", inserted));
    expect(second.result.current.clip!.blob).toBe(blob);
    await act(async () => second.result.current.retry());
    expect(fetcher.mock.calls[1][1].body).toBe(blob); expect(inserted).toHaveBeenCalledWith("recovered");
    act(() => second.result.current.clear());
  });
  it("releases a microphone permission request that resolves after leaving the chat", async () => {
    const stream = microphone(); let granted!: (value: unknown) => void;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise(resolve => { granted = resolve; }) } });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const view = renderHook(() => useNativeDictation("capture-leave", "", vi.fn()));
    let starting!: Promise<void>; act(() => { starting = view.result.current.start(); }); view.unmount();
    await act(async () => { granted(stream); await starting; });
    expect(stopTrack).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
  });
});
