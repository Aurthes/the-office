import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionControls } from "../../src/features/office/components/SessionControls";
import { useSessionVoice } from "../../src/features/office/components/useSessionVoice";
const snapshot = { connected: true, version: 1, activeTurnId: null, items: [], approvals: [] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("web composer media", () => {
  it("uploads before sending, allows attachment-only messages, and keeps failed-send attachments", async () => {
    const call = vi.fn(async (method: string) => { if (method === "session.send") throw new Error("not confirmed"); return snapshot; });
    let complete!: (value: unknown) => void;
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() => new Promise(resolve => { complete = resolve; })); vi.stubGlobal("fetch", fetcher);
    render(React.createElement(SessionControls, { client: { call }, threadId: "original", onItems: vi.fn() }));
    await waitFor(() => expect((screen.getByLabelText("发送到原会话") as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("选择附件"), { target: { files: [new File(["hello"], "note.md")] } });
    expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetcher.mock.calls[0][0]).toContain("threadId=original");
    await act(async () => complete({ ok: true, json: async () => ({ ref: "signed-upload" }) }));
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ message: "", attachments: ["signed-upload"], threadId: "original" })));
    expect(screen.getByLabelText("移除附件 note.md")).toBeTruthy();
  });
  it("leaves native Option dictation alone and never starts browser recognition", async () => {
    const recognition = vi.fn(); vi.stubGlobal("webkitSpeechRecognition", recognition); vi.stubGlobal("SpeechRecognition", recognition);
    const call = vi.fn(async (_method: string) => snapshot);
    render(React.createElement(SessionControls, { client: { call }, threadId: "chosen-thread", onItems: vi.fn() }));
    const input = screen.getByLabelText("发送到原会话") as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(screen.getByRole("button", { name: "原生听写" })).not.toBeDisabled();
    const down = new KeyboardEvent("keydown", { key: "Alt", code: "AltRight", location: 2, altKey: true, bubbles: true, cancelable: true });
    const up = new KeyboardEvent("keyup", { key: "Alt", code: "AltRight", location: 2, bubbles: true, cancelable: true });
    fireEvent(window, down); fireEvent(window, up);
    expect(down.defaultPrevented).toBe(false); expect(up.defaultPrevented).toBe(false);
    expect(recognition).not.toHaveBeenCalled();
    // Native desktop dictation inserts into the normal focused text field.
    fireEvent.change(input, { target: { value: "原生听写填入的草稿" } });
    expect(call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "chosen-thread", message: "原生听写填入的草稿" })));
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
