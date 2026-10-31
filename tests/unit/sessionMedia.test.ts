import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionControls } from "../../src/features/office/components/SessionControls";
import { useSessionVoice } from "../../src/features/office/components/useSessionVoice";
const snapshot = { connected: true, version: 1, activeTurnId: null, items: [], approvals: [] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("web composer media", () => {
  it.each([true, false])("keeps only the latest voice disconnect deadline (recovers: %s)", async recover => {
    vi.useFakeTimers();
    const stopTrack = vi.fn(), close = vi.fn();
    const peers: Peer[] = [];
    class Peer {
      constructor() { peers.push(this); }
      connectionState = "new"; onconnectionstatechange?: () => void;
      createDataChannel = () => ({}); addTrack = vi.fn();
      createOffer = async () => ({ sdp: "v=0" }); setLocalDescription = async () => {}; close = close;
    }
    class Audio { setAttribute = vi.fn(); pause = vi.fn(); }
    vi.stubGlobal("RTCPeerConnection", Peer); vi.stubGlobal("Audio", Audio);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) } });
    const call = vi.fn(async () => ({})), client = { call };
    const { result } = renderHook(() => useSessionVoice(client, "voice-timer"));
    await act(async () => result.current.start());
    const change = (state: string) => act(() => { peers[0].connectionState = state; peers[0].onconnectionstatechange?.(); });
    change("connected"); change("disconnected");
    act(() => vi.advanceTimersByTime(5000));
    change("connecting"); change("disconnected");
    act(() => vi.advanceTimersByTime(4000));
    expect(close).not.toHaveBeenCalled();
    if (recover) change("connected");
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.status).toBe(recover ? "connected" : "off");
    expect(close).toHaveBeenCalledTimes(recover ? 0 : 1);
    expect(stopTrack).toHaveBeenCalledTimes(recover ? 0 : 1);
  });
  it("keeps a per-conversation draft and uploaded attachments across closing and reopening", async () => {
    const call = vi.fn(async () => snapshot), client = { call }, onItems = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ref: "kept-ref" }) })));
    const first = render(React.createElement(SessionControls, { client, threadId: "draft-camera", onItems }));
    const input = screen.getByLabelText("Send to session"); await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "keep my draft" } });
    fireEvent.change(screen.getByLabelText("Choose attachments"), { target: { files: [new File(["hello"], "kept.md")] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled());
    first.unmount();
    const other = render(React.createElement(SessionControls, { client, threadId: "another-camera", onItems }));
    expect(screen.getByLabelText("Send to session")).toHaveValue(""); other.unmount();
    render(React.createElement(SessionControls, { client, threadId: "draft-camera", onItems }));
    expect(screen.getByLabelText("Send to session")).toHaveValue("keep my draft");
    expect(screen.getByLabelText("Remove attachment kept.md")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "draft-camera", message: "keep my draft", attachments: ["kept-ref"] })));
    await waitFor(() => expect(screen.getByLabelText("Send to session")).toHaveValue(""));
  });
  it("uploads before sending, allows attachment-only messages, and keeps failed-send attachments", async () => {
    const call = vi.fn(async (method: string) => { if (method === "session.send") throw new Error("not confirmed"); return snapshot; });
    let complete!: (value: unknown) => void;
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() => new Promise(resolve => { complete = resolve; })); vi.stubGlobal("fetch", fetcher);
    render(React.createElement(SessionControls, { client: { call }, threadId: "original", onItems: vi.fn() }));
    await waitFor(() => expect((screen.getByLabelText("Send to session") as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Choose attachments"), { target: { files: [new File(["hello"], "note.md")] } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetcher.mock.calls[0][0]).toContain("threadId=original");
    await act(async () => complete({ ok: true, json: async () => ({ ref: "signed-upload" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ message: "", attachments: ["signed-upload"], threadId: "original" })));
    expect(screen.getByLabelText("Remove attachment note.md")).toBeTruthy();
  });
  it("leaves native Option dictation alone and never starts browser recognition", async () => {
    const recognition = vi.fn(); vi.stubGlobal("webkitSpeechRecognition", recognition); vi.stubGlobal("SpeechRecognition", recognition);
    const call = vi.fn(async (_method: string) => snapshot);
    render(React.createElement(SessionControls, { client: { call }, threadId: "chosen-thread", onItems: vi.fn() }));
    const input = screen.getByLabelText("Send to session") as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(screen.getByRole("button", { name: "Native dictation" })).not.toBeDisabled();
    const down = new KeyboardEvent("keydown", { key: "Alt", code: "AltRight", location: 2, altKey: true, bubbles: true, cancelable: true });
    const up = new KeyboardEvent("keyup", { key: "Alt", code: "AltRight", location: 2, bubbles: true, cancelable: true });
    fireEvent(window, down); fireEvent(window, up);
    expect(down.defaultPrevented).toBe(false); expect(up.defaultPrevented).toBe(false);
    expect(recognition).not.toHaveBeenCalled();
    // Native desktop dictation inserts into the normal focused text field.
    fireEvent.change(input, { target: { value: "Native dictation填入的草稿" } });
    expect(call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "chosen-thread", message: "Native dictation填入的草稿" })));
  });
  it("connects native WebRTC, then releases microphone, audio and ownership on chat exit", async () => {
    let eventHandler!: (event: { event: string; payload: unknown }) => void;
    const stopTrack = vi.fn(), close = vi.fn(), setRemoteDescription = vi.fn(async () => {});
    class Peer { connectionState = "new"; onconnectionstatechange?: () => void; ontrack?: () => void; createDataChannel = () => ({}); addTrack = vi.fn(); createOffer = async () => ({ type: "offer", sdp: "v=0\n" }); setLocalDescription = async () => {}; setRemoteDescription = setRemoteDescription; close = close; }
    class Audio { autoplay = false; srcObject: unknown; setAttribute = vi.fn(); play = async () => {}; pause = vi.fn(); }
    vi.stubGlobal("RTCPeerConnection", Peer); vi.stubGlobal("Audio", Audio);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } });
    const call = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async () => ({})); const unsubscribe = vi.fn();
    const client = { call, onEvent: (handler: typeof eventHandler) => { eventHandler = handler; return unsubscribe; } };
    const { result, unmount } = renderHook(() => useSessionVoice(client, "original"));
    await act(async () => result.current.start());
    const start = call.mock.calls.find(([method]) => method === "session.voice.start")!;
    expect(start[1]).toMatchObject({ threadId: "original", sdp: "v=0\n" });
    const voiceId = (start[1] as { voiceId: string }).voiceId;
    await act(async () => eventHandler({ event: "session.voice", payload: { threadId: "original", voiceId, method: "thread/realtime/sdp", params: { sdp: "answer" } } }));
    expect(setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer" });
    unmount(); expect(stopTrack).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledOnce();
    expect(call).toHaveBeenLastCalledWith("session.voice.stop", { threadId: "original", voiceId });
  });
  it("shows native voice startup errors and releases its generated audio track", async () => {
    let listener!: (event: { event: string; payload: unknown }) => void;
    const stopTrack = vi.fn();
    class Peer { close = vi.fn(); createDataChannel = () => ({}); addTrack = vi.fn(); createOffer = async () => ({ sdp: "v=0" }); setLocalDescription = async () => {}; }
    class Audio { setAttribute = vi.fn(); pause = vi.fn(); }
    vi.stubGlobal("RTCPeerConnection", Peer); vi.stubGlobal("Audio", Audio);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) } });
    const call = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async () => ({}));
    const client = { call, onEvent: (handler: typeof listener) => { listener = handler; return () => {}; } };
    const { result } = renderHook(() => useSessionVoice(client, "original"));
    await act(async () => result.current.start());
    const request = call.mock.calls.find(([method]) => method === "session.voice.start")![1] as { voiceId: string };
    await act(async () => listener({ event: "session.voice", payload: { threadId: "original", voiceId: request.voiceId, method: "thread/realtime/error", params: { message: "account voice limit" } } }));
    expect(result.current.error).toBe("account voice limit"); expect(result.current.status).toBe("off"); expect(stopTrack).toHaveBeenCalledOnce();
  });
});
