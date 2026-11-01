"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { prepareAndroidVoice, type AndroidVoiceLease } from "./androidVoiceHost";

export type VoiceSettings = { voice: string; echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };
const defaults: VoiceSettings = { voice: "", echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const settingsKey = "claw3d:voice-settings";
function readSettings(): VoiceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) || "{}");
    return {
      voice: typeof saved.voice === "string" ? saved.voice : "",
      echoCancellation: typeof saved.echoCancellation === "boolean" ? saved.echoCancellation : true,
      noiseSuppression: typeof saved.noiseSuppression === "boolean" ? saved.noiseSuppression : true,
      autoGainControl: typeof saved.autoGainControl === "boolean" ? saved.autoGainControl : true,
    };
  } catch { return defaults; }
}
type VoiceConnection = { id: string; threadId: string; muted: boolean; abort: AbortController; native?: AndroidVoiceLease; pc: RTCPeerConnection; audio: HTMLAudioElement; stream?: MediaStream; unsubscribe?: () => void; unsubscribeStatus?: () => void; timer?: ReturnType<typeof setTimeout> };

// Owned by the Office screen, so changing the selected conversation does not
// dispose the call. Every request stays bound to the originating thread.
export function useSessionVoice(client: SessionClient) {
  const connection = useRef<VoiceConnection | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [status, setStatus] = useState<"off" | "connecting" | "connected">("off");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState<{ role: string; text: string }[]>([]);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [settings, setSettings] = useState(readSettings);
  const updateSettings = (next: VoiceSettings) => {
    setSettings(next);
    try { localStorage.setItem(settingsKey, JSON.stringify(next)); } catch { /* Settings still apply to this tab. */ }
  };
  const finish = useCallback((session: VoiceConnection, notify = true, reason = "") => {
    if (connection.current !== session) return;
    connection.current = null;
    session.abort.abort();
    clearTimeout(session.timer); session.unsubscribe?.(); session.unsubscribeStatus?.();
    session.stream?.getTracks().forEach(track => track.stop());
    session.pc.close(); session.audio.pause(); session.audio.srcObject = null;
    session.native?.release();
    setStatus("off"); setMuted(false); setPlaybackBlocked(false);
    if (reason) setError(reason);
    if (notify) void client.call("session.voice.stop", { threadId: session.threadId, voiceId: session.id }).catch(() => {});
  }, [client]);
  const stop = useCallback(() => { if (connection.current) finish(connection.current); }, [finish]);
  useEffect(() => {
    window.addEventListener("pagehide", stop);
    return () => { window.removeEventListener("pagehide", stop); stop(); };
  }, [stop]);
  const toggleMute = useCallback(() => {
    const session = connection.current;
    if (!session) return;
    session.muted = !session.muted;
    session.stream?.getAudioTracks().forEach(track => { track.enabled = !session.muted; });
    setMuted(session.muted);
  }, []);
  useEffect(() => { connection.current?.native?.update(status, muted); }, [status, muted]);
  const start = useCallback(async (targetThreadId: string) => {
    if (connection.current) return;
    setThreadId(targetThreadId); setError(""); setCaptions([]); setMuted(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") { setError("This browser does not support live voice. Use Chrome or Safari over HTTPS."); return; }
    let session: VoiceConnection;
    try { session = { id: crypto.randomUUID(), threadId: targetThreadId, muted: false, abort: new AbortController(), pc: new RTCPeerConnection(), audio: new Audio() }; }
    catch { setError("Could not create a voice connection. Check WebRTC settings or use Chrome or Safari."); return; }
    connection.current = session; setStatus("connecting");
    const caption = (role: string, text: string) => {
      text = text.trim();
      if (connection.current !== session || !text) return;
      setCaptions(previous => previous.at(-1)?.text === text && previous.at(-1)?.role === role ? previous : [...previous, { role, text: text.slice(0, 2000) }].slice(-4));
    };
    session.audio.autoplay = true; session.audio.setAttribute("playsinline", "");
    session.pc.ontrack = event => {
      if (connection.current !== session) return;
      session.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      void session.audio.play().catch(() => { if (connection.current === session) setPlaybackBlocked(true); });
    };
    session.pc.onconnectionstatechange = () => {
      if (connection.current !== session) return;
      if (session.pc.connectionState === "connected") { clearTimeout(session.timer); setStatus("connected"); }
      if (session.pc.connectionState === "failed") finish(session, true, "Voice network connection failed. Check your connection and retry.");
      if (session.pc.connectionState === "disconnected") {
        clearTimeout(session.timer);
        session.timer = setTimeout(() => finish(session, true, "Voice disconnected. Please reconnect."), 8000);
      }
    };
    const channel = session.pc.createDataChannel("oai-events");
    channel.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "conversation.item.input_audio_transcription.completed") caption("user", message.transcript || "");
        if (["response.audio_transcript.done", "response.output_audio_transcript.done"].includes(message.type)) caption("assistant", message.transcript || "");
        // V3 turn.created carries only an initial fragment; turn.done is final.
        if (message.type === "turn.done") caption(message.turn?.role || "user", message.turn?.transcript || "");
      } catch { /* Ignore media/control messages without transcript text. */ }
    };
    session.unsubscribe = client.onEvent?.(event => {
      const value = event.payload as { threadId?: string; voiceId?: string; method?: string; params?: { sdp?: string; role?: string; text?: string; message?: string; reason?: string } };
      if (event.event !== "session.voice" || value?.threadId !== session.threadId || value.voiceId !== session.id || connection.current !== session) return;
      const params = value.params || {};
      if (value.method === "thread/realtime/sdp" && params.sdp) void session.pc.setRemoteDescription({ type: "answer", sdp: params.sdp }).catch(() => finish(session, true, "Voice negotiation failed. Please retry."));
      if (value.method === "thread/realtime/transcript/done") caption(params.role || "assistant", params.text || "");
      if (value.method === "thread/realtime/error") finish(session, true, params.message?.slice(0, 400) || "Codex voice error. Please retry.");
      if (value.method === "thread/realtime/closed") finish(session, false, params.reason && params.reason !== "requested" ? "Voice ended: " + params.reason.slice(0, 200) : "");
    });
    session.unsubscribeStatus = client.onStatus?.(status => {
      if (status !== "connected") finish(session, false, "Voice disconnected. Please reconnect.");
    });
    try {
      if (window.OfficeAndroid) {
        const native = await prepareAndroidVoice(session.id, session.threadId, command => {
          if (connection.current !== session) return;
          if (command === "stop") finish(session); else if (command === "toggleMute") toggleMute();
        }, session.abort.signal);
        if (connection.current !== session) { native?.release(); return; }
        session.native = native;
        native?.update("connecting", session.muted);
      }
      const { voice, ...audio } = settings;
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      if (connection.current !== session) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream;
      stream.getAudioTracks().forEach(track => { track.enabled = !session.muted; });
      stream.getTracks().forEach(track => session.pc.addTrack(track, stream));
      const offer = await session.pc.createOffer(); await session.pc.setLocalDescription(offer);
      if (connection.current !== session) return;
      session.timer = setTimeout(() => finish(session, true, "Voice connection timed out. Check your connection and retry."), 35000);
      await client.call("session.voice.start", { threadId: session.threadId, voiceId: session.id, sdp: offer.sdp, ...(voice ? { voice } : {}) });
    } catch (cause) {
      finish(session, true, cause instanceof DOMException && cause.name === "NotAllowedError" ? "Allow microphone access for this page, then retry." : cause instanceof Error ? cause.message : "Could not connect voice");
    }
  }, [client, settings, finish, toggleMute]);
  const play = async () => {
    try { await connection.current?.audio.play(); setPlaybackBlocked(false); }
    catch { setError("Audio playback was blocked. Click Play audio again."); }
  };
  return { threadId, status, error, captions, playbackBlocked, muted, settings, updateSettings, toggleMute, start, stop, play };
}
export type SessionVoiceController = ReturnType<typeof useSessionVoice>;
