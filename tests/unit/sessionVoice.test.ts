import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionVoice, type SessionVoiceController } from "../../src/features/office/components/useSessionVoice";
import { SessionControls, type SessionClient } from "../../src/features/office/components/SessionControls";
import { SessionVoiceCall, SessionVoiceSettings } from "../../src/features/office/components/SessionVoice";

class Peer {
  static all: Peer[] = [];
  connectionState = "new";
  ontrack: unknown;
  onconnectionstatechange?: () => void;
  channel = { onmessage: null as ((event: { data: string }) => void) | null };
  close = vi.fn(); addTrack = vi.fn(); setRemoteDescription = vi.fn(async () => {});
  constructor() { Peer.all.push(this); }
  createDataChannel() { return this.channel; }
  async createOffer() { return { sdp: "v=0" }; }
  async setLocalDescription() {}
  message(value: unknown) { this.channel.onmessage?.({ data: JSON.stringify(value) }); }
}
const track = () => ({ enabled: true, stop: vi.fn() });
let microphone: ReturnType<typeof track>;
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear(); Peer.all = []; microphone = track();
  getUserMedia = vi.fn(async () => ({ getTracks: () => [microphone], getAudioTracks: () => [microphone] }));
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal("Audio", class { autoplay = false; srcObject = null; setAttribute() {} pause = vi.fn(); play = vi.fn(async () => {}); });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
});
afterEach(() => { cleanup(); delete window.OfficeAndroid; vi.unstubAllGlobals(); });
const makeClient = () => {
  const handlers = new Set<(event: { event: string; payload?: unknown }) => void>();
  const call = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async method => method === "session.voice.options" ? { voices: ["juniper", "cove"] } : { connected: true, version: 1, items: [], approvals: [], features: { voice: true, prediction: false } });
  const client: SessionClient = { call, onEvent: handler => { handlers.add(handler); return () => { handlers.delete(handler); }; } };
  return { client, call, push: (payload: unknown) => handlers.forEach(h => h({ event: "session.voice", payload })) };
};

describe("voice lifetime and original session ownership", () => {
  it("keeps the same call and captions while keyed chat panels switch, and mutes without hanging up", async () => {
    const { client, call, push } = makeClient();
    let current!: SessionVoiceController;
    const onItems = vi.fn();
    function Office({ selected }: { selected: string }) {
      const voice = useSessionVoice(client);
      React.useEffect(() => { current = voice; });
      return React.createElement(React.Fragment, null,
        React.createElement(SessionControls, { key: selected, client, threadId: selected, onItems, voice }),
        voice.status !== "off" && voice.threadId !== selected ? React.createElement(SessionVoiceCall, { voice, owner: "Original worker", onReturn: () => {} }) : null,
      );
    }
    const view = render(React.createElement(Office, { selected: "original" }));
    const subscribe = call.mock.calls.find(([method]) => method === "session.subscribe");
    expect(subscribe).toBeDefined();
    // Starting via the shared controller isolates call lifetime from chat readiness.
    await act(async () => current.start("original"));
    const first = Peer.all[0];
    await act(async () => { first.connectionState = "connected"; first.onconnectionstatechange?.(); first.message({ type: "turn.created", turn: { role: "user", transcript: "Only" } }); first.message({ type: "turn.done", turn: { role: "user", transcript: "The entire spoken sentence" } }); });
    expect(screen.queryByText("Only")).toBeNull();
    expect(screen.getByText("The entire spoken sentence")).toBeTruthy();
    const voiceId = (call.mock.calls.find(([method]) => method === "session.voice.start")?.[1] as { voiceId: string }).voiceId;
    view.rerender(React.createElement(Office, { selected: "other" }));
    expect(Peer.all).toHaveLength(1); expect(first.close).not.toHaveBeenCalled();
    expect(microphone.stop).not.toHaveBeenCalled();
    expect(screen.getByText(/Original worker/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mute microphone" }));
    expect(microphone.enabled).toBe(false);
    expect(call.mock.calls.some(([method]) => method === "session.voice.stop")).toBe(false);
    await act(async () => push({ threadId: "other", voiceId, method: "thread/realtime/sdp", params: { sdp: "wrong" } }));
    expect(first.setRemoteDescription).not.toHaveBeenCalled();
    await act(async () => push({ threadId: "original", voiceId, method: "thread/realtime/sdp", params: { sdp: "answer" } }));
    expect(first.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer" });
    view.rerender(React.createElement(Office, { selected: "original" }));
    expect(screen.getByText("The entire spoken sentence")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unmute microphone" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Unmute microphone" }));
    expect(microphone.enabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(first.close).toHaveBeenCalledTimes(1); expect(microphone.stop).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenLastCalledWith("session.voice.stop", { threadId: "original", voiceId });
  });
  it("waits for the Android foreground service and handles notification mute and hangup on the original session", async () => {
    const { client, call } = makeClient();
    const postMessage = vi.fn();
    window.OfficeAndroid = { postMessage, onmessage: null };
    const { result } = renderHook(() => useSessionVoice(client));
    let starting!: Promise<void>;
    act(() => { starting = result.current.start("original"); });
    expect(getUserMedia).not.toHaveBeenCalled();
    const request = JSON.parse(postMessage.mock.calls[0][0]);
    expect(request).toMatchObject({ type: "voice.prepare", threadId: "original" });
    await act(async () => { window.OfficeAndroid!.onmessage?.({ data: JSON.stringify({ type: "voice.prepared", id: request.id }) }); await starting; });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    act(() => window.OfficeAndroid!.onmessage?.({ data: JSON.stringify({ type: "voice.command", id: request.id, command: "toggleMute" }) }));
    expect(microphone.enabled).toBe(false);
    act(() => window.OfficeAndroid!.onmessage?.({ data: JSON.stringify({ type: "voice.command", id: request.id, command: "stop" }) }));
    expect(result.current.status).toBe("off");
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(call).toHaveBeenLastCalledWith("session.voice.stop", { threadId: "original", voiceId: request.id });
    expect(postMessage.mock.calls.map(([text]) => JSON.parse(text).type)).toContain("voice.release");
  });
  it("applies mute while microphone permission is pending and releases late tracks after hangup", async () => {
    const { client, call } = makeClient();
    let accept!: (value: unknown) => void;
    getUserMedia.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    const { result } = renderHook(() => useSessionVoice(client));
    let pending!: Promise<void>;
    act(() => { pending = result.current.start("owner"); });
    act(() => result.current.toggleMute());
    await act(async () => { accept({ getTracks: () => [microphone], getAudioTracks: () => [microphone] }); await pending; });
    expect(microphone.enabled).toBe(false);
    act(() => result.current.stop());
    getUserMedia.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    act(() => { pending = result.current.start("second"); });
    act(() => result.current.stop());
    const late = track();
    await act(async () => { accept({ getTracks: () => [late], getAudioTracks: () => [late] }); await pending; });
    expect(late.stop).toHaveBeenCalledTimes(1);
    expect(call.mock.calls.filter(([method]) => method === "session.voice.start")).toHaveLength(1);
  });
  it("bounds captions, keeps roles distinct, prevents a second call and cleans up on page exit", async () => {
    const { client, call } = makeClient();
    const { result } = renderHook(() => useSessionVoice(client));
    await act(async () => result.current.start("owner"));
    await act(async () => result.current.start("other"));
    act(() => {
      for (let i = 0; i < 8; i++) Peer.all[0].message({ type: "turn.done", turn: { role: "user", transcript: String(i) } });
      Peer.all[0].message({ type: "turn.done", turn: { role: "assistant", transcript: "7" } });
    });
    expect(result.current.captions).toHaveLength(4);
    expect(result.current.captions.slice(-2).map(c => c.role)).toEqual(["user", "assistant"]);
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(result.current.status).toBe("off");
    expect(call.mock.calls.filter(([method]) => method === "session.voice.start")).toHaveLength(1);
    expect(call).toHaveBeenLastCalledWith("session.voice.stop", expect.objectContaining({ threadId: "owner" }));
  });
  it("saves supported settings for the next call and sends the chosen native voice", async () => {
    const { client, call } = makeClient();
    let current!: SessionVoiceController;
    function Settings() { const voice = useSessionVoice(client); React.useEffect(() => { current = voice; }); return React.createElement(SessionVoiceSettings, { client, voice, onClose: () => {} }); }
    render(React.createElement(Settings));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Select voice" })).not.toBeDisabled());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cove" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Noise suppression" }));
    await act(async () => current.start("owner"));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
    expect(call).toHaveBeenCalledWith("session.voice.start", expect.objectContaining({ threadId: "owner", voice: "cove" }));
    expect(JSON.parse(localStorage.getItem("claw3d:voice-settings") || "{}")).toMatchObject({ voice: "cove", noiseSuppression: false });
  });
});
