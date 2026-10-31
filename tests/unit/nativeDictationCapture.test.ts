import React from "react";
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionControls } from "../../src/features/office/components/SessionControls";
import { useNativeDictation } from "../../src/features/office/components/useNativeDictation";
import { DICTATION_SHORTCUT_KEY } from "../../src/features/office/components/dictationShortcutSettings";
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
  vi.stubGlobal("navigator", { get platform() { return "MacIntel"; }, mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  return stream;
}
afterEach(() => { cleanup(); localStorage.removeItem(DICTATION_SHORTCUT_KEY); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.restoreAllMocks(); });
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
    let stopping!: Promise<string | undefined>; act(() => { stopping = result.current.stop(); });
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
    let stopping!: Promise<string | undefined>; act(() => { stopping = result.current.stop(); });
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
    let stopping!: Promise<string | undefined>; act(() => { stopping = result.current.stop(); });
    await waitFor(() => expect(result.current.phase).toBe("transcribing")); expect(inserted).not.toHaveBeenCalled();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("threadId=capture-one"); expect((init.body as Blob).type).toBe("audio/wav"); expect((init.body as Blob).size).toBe(6444);
    await act(async () => { finish({ ok: true, json: async () => ({ text: "native transcript" }) }); await stopping; });
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
  it("can discard while permission is pending without a late permission failure breaking the next recording", async () => {
    const stream = microphone();
    let denied!: (error: Error) => void;
    const getUserMedia = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { denied = reject; })).mockResolvedValue(stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const call = vi.fn(async () => ({ accepted: true }));
    const { result } = renderHook(() => useNativeDictation("discard-permission", "draft", vi.fn(), { call }));
    let first!: Promise<void>; act(() => { first = result.current.start(); });
    act(() => result.current.discard()); expect(result.current.phase).toBe("idle");
    await act(async () => result.current.start()); expect(result.current.phase).toBe("recording");
    await act(async () => { denied(new Error("old permission failed")); await first; });
    expect(result.current.phase).toBe("recording");
    act(() => result.current.discard()); expect(result.current.phase).toBe("idle");
  });
  it("discards during the last worklet flush without restoring a clip or transcribing", async () => {
    microphone(); const inserted = vi.fn(), call = vi.fn(async () => ({ accepted: true }));
    const { result } = renderHook(() => useNativeDictation("discard-flush", "draft", inserted, { call }));
    await act(async () => result.current.start());
    act(() => port.onmessage?.({ data: { pcm: new Int16Array(3200) } }));
    port.postMessage = vi.fn();
    let stopping!: Promise<string | undefined>; act(() => { stopping = result.current.stop(); });
    await act(async () => { result.current.discard(); await stopping; });
    expect(result.current.phase).toBe("idle"); expect(result.current.clip).toBeNull();
    expect(inserted).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalledWith("session.dictation.finish", expect.anything());
  });
  it("discard aborts fallback recognition and ignores even a late successful response", async () => {
    microphone(); const inserted = vi.fn(); let complete!: (value: unknown) => void;
    const fetcher = vi.fn(() => new Promise(resolve => { complete = resolve; })); vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useNativeDictation("discard-upload", "draft", inserted));
    await act(async () => result.current.start());
    act(() => port.onmessage?.({ data: { pcm: new Int16Array(3200) } }));
    let stopping!: Promise<string | undefined>; act(() => { stopping = result.current.stop(); });
    await waitFor(() => expect(complete).toBeTypeOf("function"));
    act(() => result.current.discard());
    await act(async () => { complete({ ok: true, json: async () => ({ text: "late" }) }); await stopping; });
    expect(result.current.phase).toBe("idle"); expect(result.current.clip).toBeNull(); expect(inserted).not.toHaveBeenCalled();
  });

  it("retries retained audio on the existing authenticated channel without an HTTP upload", async () => {
    microphone(); vi.stubGlobal("Blob", NodeBlob);
    const inserted = vi.fn(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    let first = true;
    const call = vi.fn(async (method: string) => {
      if (method === "session.dictation.finish") { if (first) { first = false; throw new Error("temporary native failure"); } return { text: "recovered words" }; }
      return { accepted: true };
    });
    const view = renderHook(() => useNativeDictation("retry-native-channel", "original draft", inserted, { call }));
    await act(async () => view.result.current.start());
    const pcm = new Int16Array(3200).fill(1234);
    act(() => port.onmessage?.({ data: { pcm } }));
    await act(async () => view.result.current.stop());
    expect(view.result.current.phase).toBe("error"); const clip = view.result.current.clip!.blob;
    call.mockClear();
    await act(async () => view.result.current.retry());
    expect(fetcher).not.toHaveBeenCalled(); expect(inserted).toHaveBeenCalledExactlyOnceWith("original draft recovered words");
    expect(view.result.current.clip!.blob).toBe(clip);
    expect(call).toHaveBeenCalledWith("session.dictation.append", expect.objectContaining({ threadId: "retry-native-channel", sequence: 0 }));
    expect(call).toHaveBeenCalledWith("session.dictation.finish", expect.objectContaining({ threadId: "retry-native-channel", sequence: 1 }));
    expect(view.result.current.transcriptionTime?.retry).toBe(true);
    act(() => view.result.current.clear());
  });
  it("can discard a replay while its audio acknowledgement is still pending", async () => {
    microphone(); vi.stubGlobal("Blob", NodeBlob); const inserted = vi.fn(); let retrying = false, acknowledge!: (value: unknown) => void;
    const call = vi.fn(async (method: string) => {
      if (retrying && method === "session.dictation.append") return new Promise(resolve => { acknowledge = resolve; });
      if (method === "session.dictation.finish") throw new Error("temporary native failure");
      return { accepted: true };
    });
    const view = renderHook(() => useNativeDictation("cancel-retry-channel", "draft", inserted, { call }));
    await act(async () => view.result.current.start());
    act(() => port.onmessage?.({ data: { pcm: new Int16Array(3200) } }));
    await act(async () => view.result.current.stop()); retrying = true; call.mockClear();
    let retry!: Promise<string | undefined> | null; act(() => { retry = view.result.current.retry(); });
    await waitFor(() => expect(acknowledge).toBeTypeOf("function"));
    act(() => view.result.current.discard());
    await act(async () => { acknowledge({ accepted: true }); await retry; });
    expect(view.result.current.phase).toBe("idle"); expect(view.result.current.clip).toBeNull(); expect(inserted).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalledWith("session.dictation.finish", expect.anything());
  });
  it.each([
    [502, "text/html", "Transcription service returned an invalid response. Recording kept; please retry."],
    [200, "text/html", "Transcription service returned an invalid response. Recording kept; please retry."],
    [502, "application/json", "Transcription service returned an invalid response. Recording kept; please retry."],
    [401, "text/html", "Sign in again before retrying transcription. Recording kept."],
  ])("keeps audio and reports a useful error for HTTP %s %s", async (status, type, message) => {
    microphone(); const inserted = vi.fn(), warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const json = vi.fn(async () => { throw new SyntaxError("Unexpected token '<'"); });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status === 200, status, headers: new Headers({ "Content-Type": type }), json })));
    const view = renderHook(() => useNativeDictation("html-response-" + status, "draft", inserted));
    await act(async () => view.result.current.start());
    act(() => port.onmessage?.({ data: { pcm: new Int16Array(3200) } }));
    await act(async () => view.result.current.stop());
    expect(view.result.current.phase).toBe("error"); expect(view.result.current.error).toBe(message);
    expect(view.result.current.clip!.seconds).toBe(0.2); expect(inserted).not.toHaveBeenCalled();
    if (/json/i.test(type)) expect(json).toHaveBeenCalledOnce(); else expect(json).not.toHaveBeenCalled();
    act(() => view.result.current.clear()); warn.mockRestore();
  });

});

describe("dictation composer shortcuts", () => {
  async function composer(id: string, finish: () => Promise<unknown>) {
    microphone();
    localStorage.setItem(DICTATION_SHORTCUT_KEY, "option");
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    vi.spyOn(HTMLTextAreaElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    const call = vi.fn(async (method: string) => method === "session.dictation.finish" ? finish() :
      method === "session.attach" ? { connected: true, version: 1, activeTurnId: null, items: [], approvals: [] } : { accepted: true });
    render(React.createElement(SessionControls, { client: { call }, threadId: id, onItems: vi.fn() }));
    const input = screen.getByLabelText("Send to session") as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: "existing draft" } });
    fireEvent.keyDown(input, { key: "Alt", code: "AltLeft", altKey: true });
    fireEvent.keyUp(input, { key: "Alt", code: "AltLeft" });
    await screen.findByRole("button", { name: "Stop recording and transcribe" });
    await act(async () => {});
    act(() => port.onmessage?.({ data: { pcm: new Int16Array(3200) } }));
    return { call, input };
  }
  it("Enter waits for the transcript, then sends the combined draft to the same session once", async () => {
    let finish!: (value: unknown) => void;
    const h = await composer("enter-send", () => new Promise(resolve => { finish = resolve; }));
    fireEvent.keyDown(window, { key: "Enter" }); fireEvent.keyDown(window, { key: "Enter", repeat: true });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(h.call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(0);
    await act(async () => finish({ text: "spoken words" }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "enter-send", message: "existing draft spoken words", requestId: expect.any(String) })));
    expect(h.call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(1);
    expect(h.input.value).toBe("");
  });
  it("shows compact recording controls and enables Send with no typed draft", async () => {
    let finish!: (value: unknown) => void;
    const h = await composer("button-send", () => new Promise(resolve => { finish = resolve; }));
    expect(screen.getByRole("button", { name: "Cancel recording" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Add attachments" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Voice chat" })).toBeNull();
    expect(screen.getByText("Recording · 0:00")).toBeTruthy();
    fireEvent.change(h.input, { target: { value: "" } });
    const send = screen.getByRole("button", { name: "Transcribe and send" }); expect(send).toBeEnabled();
    fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(h.call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(0);
    await act(async () => finish({ text: "spoken words" }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "button-send", message: "spoken words" })));
    expect(h.call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(1);
  });
  it("X cancels recording, restores the normal buttons and leaves the draft intact", async () => {
    const h = await composer("button-cancel", async () => ({ text: "must not appear" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
    await screen.findByRole("button", { name: "Add attachments" });
    expect(screen.getByRole("button", { name: "Voice chat" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel recording" })).toBeNull();
    expect(h.input.value).toBe("existing draft"); expect(stopTrack).toHaveBeenCalledOnce();
    expect(h.call.mock.calls.filter(([method]) => ["session.send", "session.dictation.finish"].includes(method))).toHaveLength(0);
  });
  it("X stays available during transcription and prevents a late result from sending", async () => {
    let finish!: (value: unknown) => void;
    const h = await composer("button-cancel-transcription", () => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Transcribe and send" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
    await act(async () => finish({ text: "must not appear" }));
    expect(h.input.value).toBe("existing draft");
    expect(h.call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(0);
  });
  it("the microphone restores draft focus after transcription so Enter can send", async () => {
    let finish!: (value: unknown) => void;
    const h = await composer("button-stop-draft", () => new Promise(resolve => { finish = resolve; }));
    const stop = screen.getByRole("button", { name: "Stop recording and transcribe" });
    act(() => stop.focus());
    fireEvent.click(stop);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(h.input).toBeDisabled(); expect(h.input).not.toHaveFocus();
    await act(async () => finish({ text: "spoken words" }));
    await waitFor(() => expect(h.input).toHaveFocus());
    expect(h.input.value).toBe("existing draft spoken words");
    expect(h.input.selectionStart).toBe(h.input.value.length);
    expect(h.input.selectionEnd).toBe(h.input.value.length);
    expect(h.call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(0);
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    await waitFor(() => expect(h.call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "button-stop-draft", message: "existing draft spoken words" })));
    expect(h.call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(1);
  });
  it("a second Option tap inserts text without sending", async () => {
    const h = await composer("tap-stop", async () => ({ text: "spoken words" }));
    fireEvent.keyDown(window, { key: "Alt", code: "AltLeft", altKey: true }); fireEvent.keyUp(window, { key: "Alt", code: "AltLeft" });
    await waitFor(() => expect(h.input.value).toBe("existing draft spoken words"));
    expect(h.input).toHaveFocus();
    expect(h.call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear recording" }));
  });
  it("Esc releases the microphone, cancels the attempt and preserves the existing draft", async () => {
    const h = await composer("escape-recording", async () => ({ text: "must not appear" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await screen.findByRole("button", { name: "Dictation" });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(h.call).toHaveBeenCalledWith("session.dictation.cancel", expect.anything());
    expect(h.call.mock.calls.filter(([method]) => ["session.dictation.finish", "session.send"].includes(method))).toHaveLength(0);
    expect(h.input.value).toBe("existing draft"); expect(screen.queryByText(/Recording:.*Kept/)).toBeNull();
  });
  it("Esc during Enter transcription rejects the late result and prevents sending", async () => {
    let finish!: (value: unknown) => void;
    const h = await composer("escape-transcribing", () => new Promise(resolve => { finish = resolve; }));
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => finish({ text: "must not appear" }));
    expect(h.input.value).toBe("existing draft");
    expect(h.call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(0);
    expect(screen.queryByText(/Recording:.*Kept/)).toBeNull();
  });
  it("a failed Enter transcription keeps audio for retry without sending", async () => {
    const h = await composer("enter-failed", async () => { throw new Error("recognition failed"); });
    fireEvent.keyDown(window, { key: "Enter" });
    await screen.findByText("recognition failed");
    expect(h.input.value).toBe("existing draft"); expect(h.call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Retry transcription" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear recording" }));
  });
});
