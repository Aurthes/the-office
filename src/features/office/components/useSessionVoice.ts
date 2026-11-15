"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { callTimeline, mergeCallTimeline, type VoiceCaption } from "./voiceTranscript";
import type { LiveSessionItem, SessionClient } from "./SessionControls";
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
  const [captions, setCaptions] = useState<VoiceCaption[]>([]);
  const call = useRef<{ voiceId: string; threadId: string; nativeId?: string; boundaryId?: string; history: LiveSessionItem[]; reread?: boolean; refreshPending?: boolean } | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [boundaryId, setBoundaryId] = useState<string | null>(null);
  const [nativeCallId, setNativeCallId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [outputVolume, setOutputVolume] = useState(1);
  const volume = useRef(1);
  const [transcriptCursor, setTranscriptCursor] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState("");
  const reading = useRef<object | null>(null);
  const readAgain = useRef<(() => Promise<void>) | null>(null);
  const [closedVoiceId, setClosedVoiceId] = useState<string | null>(null);
  const setVolume = useCallback((value: number) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    volume.current = value; setOutputVolume(value);
    if (connection.current) connection.current.audio.volume = value;
  }, []);
  const loadTranscript = useCallback(async (cursor?: string) => {
    const target = call.current;
    if (!target?.nativeId) return;
    if (reading.current === target) { if (!cursor) target.reread = true; return; }
    reading.current = target; setTranscriptLoading(true); setTranscriptError("");
    try {
      const result = await client.call("session.history", { threadId: target.threadId, ...(cursor ? { cursor } : {}) }) as { threadId: string; messages: LiveSessionItem[]; nextCursor: string | null };
      if (call.current !== target || result.threadId !== target.threadId) return;
      const records = result.messages.filter(item => item.source === "voice" && item.voiceCallId === target.nativeId);
      target.history = [...new Map([...(cursor ? records : []), ...target.history, ...(!cursor ? records : [])].map(item => [item.id, item])).values()];
      const lines = target.boundaryId ? callTimeline(target.history, target.nativeId, target.boundaryId) : [];
      // Without a canonical boundary, only identities already delivered to this
      // browser call are safe. Never scoop up all records with a reused ID.
      if (!target.boundaryId) setTranscriptError("Call boundary unavailable. Showing received dialogue only.");
      setCaptions(previous => mergeCallTimeline(previous, lines, Boolean(cursor)));
      if (target.boundaryId) {
        const start = target.history.findIndex(item => item.source === "voice" && item.voiceItemId === target.boundaryId && item.voiceBoundary === "started");
        if (start >= 0 && target.history.slice(start + 1).find(item => item.source === "voice" && item.voiceCallId === target.nativeId && item.voiceBoundary)?.voiceBoundary === "closed") setClosedVoiceId(target.voiceId);
      }
      setTranscriptCursor(result.nextCursor);
    } catch { if (call.current === target) setTranscriptError("Could not load the call transcript. Retry."); }
    finally { if (reading.current === target) reading.current = null; if (call.current === target) { setTranscriptLoading(false); if (target.reread) { target.reread = false; void readAgain.current?.(); } } }
  }, [client]);
  useEffect(() => { readAgain.current = loadTranscript; return () => { readAgain.current = null; }; }, [loadTranscript]);
  useEffect(() => client.onEvent?.(event => {
    const target = call.current;
    if (!target || event.event !== "session.voice") return;
    const value = event.payload as { threadId?: string; voiceId?: string; method?: string; params?: { realtimeSessionId?: string; item?: { type?: string; id: string; realtimeSessionId: string; role: string; text: string } } };
    if (value.threadId !== target.threadId || value.voiceId !== target.voiceId) return;
    if (value.method === "thread/realtime/started" && value.params?.realtimeSessionId && (!target.boundaryId || value.params.realtimeSessionId === target.nativeId)) {
      target.nativeId = value.params.realtimeSessionId; setNativeCallId(target.nativeId);
    }
    const item = value.params?.item;
    if (value.method === "thread/realtime/transcript/refresh") { if (target.boundaryId) void loadTranscript(); else target.refreshPending = true; return; }
    if (value.method === "thread/realtime/item/completed" && item?.type === "realtimeSessionStarted") {
      target.nativeId = item.realtimeSessionId; target.boundaryId = item.id;
      setNativeCallId(target.nativeId); setBoundaryId(item.id);
      if (target.refreshPending) { target.refreshPending = false; void loadTranscript(); }
    }
    if (value.method === "thread/realtime/item/completed" && item?.type === "transcriptSegment" && (!target.nativeId || item.realtimeSessionId === target.nativeId)) {
      if (!target.nativeId) { target.nativeId = item.realtimeSessionId; setNativeCallId(target.nativeId); }
      setCaptions(previous => mergeCallTimeline(previous, [{ id: item.id, role: item.role, text: item.text, committed: true }]));
    }
  }), [client, loadTranscript]);
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
    if (notify) void client.call("session.voice.stop", { threadId: session.threadId, voiceId: session.id }).then(() => loadTranscript()).catch(() => {});
    else void loadTranscript();
  }, [client, loadTranscript]);
  useEffect(() => {
    const session = connection.current;
    if (session && closedVoiceId === session.id) finish(session, false);
  }, [closedVoiceId, finish]);
  const stop = useCallback(() => { if (connection.current) finish(connection.current); }, [finish]);
  useEffect(() => {
    window.addEventListener("pagehide", stop);
    return () => { window.removeEventListener("pagehide", stop); call.current = null; stop(); };
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
    call.current = null; setVoiceId(null); setVisible(false);
    setThreadId(targetThreadId); setError(""); setCaptions([]); setMuted(false); setTranscriptCursor(null); setTranscriptError(""); setTranscriptLoading(false); setNativeCallId(null); setBoundaryId(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") { setError("This browser does not support live voice. Use Chrome or Safari over HTTPS."); return; }
    let session: VoiceConnection;
    try { session = { id: crypto.randomUUID(), threadId: targetThreadId, muted: false, abort: new AbortController(), pc: new RTCPeerConnection(), audio: new Audio() }; }
    catch { setError("Could not create a voice connection. Check WebRTC settings or use Chrome or Safari."); return; }
    connection.current = session; call.current = { voiceId: session.id, threadId: targetThreadId, history: [] }; setVoiceId(session.id); setVisible(true); setStatus("connecting");
    session.audio.volume = volume.current;
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
    // Keep the native WebRTC data channel open for transport. Captions have
    // one authority: committed native timeline items, never Peer turn/item IDs.
    session.pc.createDataChannel("oai-events");
    session.unsubscribe = client.onEvent?.(event => {
      const value = event.payload as { threadId?: string; voiceId?: string; method?: string; params?: { sdp?: string; role?: string; text?: string; message?: string; reason?: string } };
      if (event.event !== "session.voice" || value?.threadId !== session.threadId || value.voiceId !== session.id || connection.current !== session) return;
      const params = value.params || {};
      if (value.method === "thread/realtime/sdp" && params.sdp) void session.pc.setRemoteDescription({ type: "answer", sdp: params.sdp }).catch(() => finish(session, true, "Voice negotiation failed. Please retry."));
      // Flat native transcript/done has no call/item identity. Dialogue comes
      // from exact committed native items instead.
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
  return { threadId, voiceId, nativeCallId, boundaryId, visible, dismissTranscript: () => setVisible(false), outputVolume, setVolume, transcriptCursor, transcriptLoading, transcriptError, loadTranscript, status, error, captions, playbackBlocked, muted, settings, updateSettings, toggleMute, start, stop, play };
}
export type SessionVoiceController = ReturnType<typeof useSessionVoice>;
