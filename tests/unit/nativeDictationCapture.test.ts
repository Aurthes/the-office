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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("browser recording to native dictation", () => {
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
