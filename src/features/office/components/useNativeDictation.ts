"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";
type Bridge = { id: string; client: SessionClient; ready: Promise<void>; connected: boolean; sent: number; pending: Set<Promise<void>>; error?: Error; cancelled?: boolean };
type Clip = { blob: Blob; seconds: number; base: string };
type Capture = { context: AudioContext; node?: AudioWorkletNode; source?: MediaStreamAudioSourceNode; stream?: MediaStream; frames: Int16Array[]; samples: number; stopped: boolean; discarded?: boolean; flush?: () => void; limit?: ReturnType<typeof setTimeout>; bridge?: Bridge };
// Keep an interrupted recording when switching between chats within this page.
const recordings = new Map<string, Clip>();
export function pcmWav(frames: Int16Array[], samples: number) {
  const bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples * 2, true);
  let offset = 44; for (const frame of frames) for (const sample of frame) { view.setInt16(offset, sample, true); offset += 2; }
  return new Blob([bytes], { type: "audio/wav" });
}
export function useNativeDictation(threadId: string, draft: string, onText: (text: string) => void, client?: SessionClient) {
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "transcribing" | "error">(() => recordings.has(threadId) ? "error" : "idle");
  const [clip, setClip] = useState<Clip | null>(() => recordings.get(threadId) || null);
  const [error, setError] = useState(() => recordings.has(threadId) ? "A recording was kept. Retry transcription or download it." : "");
  const [seconds, setSeconds] = useState(0);
  const [transcriptionTime, setTranscriptionTime] = useState<{ seconds: number; retry: boolean } | null>(null);
  const capture = useRef<Capture | null>(null), request = useRef<AbortController | null>(null);
  const mounted = useRef(true), stopRequested = useRef(false), latest = useRef({ draft, onText, client });
  const finishingBridge = useRef<Bridge | null>(null);
  useEffect(() => { latest.current = { draft, onText, client }; }, [draft, onText, client]);
  const transcribe = useCallback(async (audio: Clip, startedAt = performance.now(), retry = true) => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller; setPhase("transcribing"); setError(""); setTranscriptionTime(null);
    try {
      const result = await fetch("/api/session-dictation?" + new URLSearchParams({ threadId }), { method: "POST", body: audio.blob, headers: { "Content-Type": "audio/wav" }, signal: controller.signal });
      if (result.status === 401 || result.status === 403) throw new Error("Sign in again before retrying transcription. Recording kept.");
      let data: { text?: unknown; error?: string };
      try {
        if (result.headers && !/json/i.test(result.headers.get("Content-Type") || "")) throw new Error("Unexpected response type");
        data = await result.json();
      } catch {
        console.warn("[native-dictation] invalid HTTP response", { status: result.status, redirected: result.redirected, contentType: result.headers?.get("Content-Type") });
        throw new Error("Transcription service returned an invalid response. Recording kept; please retry.");
      }
      if (!result.ok || typeof data.text !== "string" || !data.text.trim()) throw new Error(data.error || "Native dictation returned no text. Recording kept.");
      if (mounted.current && request.current === controller && !controller.signal.aborted) {
        const text = audio.base + (audio.base.trim() ? " " : "") + data.text;
        latest.current.onText(text); setTranscriptionTime({ seconds: (performance.now() - startedAt) / 1000, retry }); setPhase("idle");
        return text;
      }
    } catch (cause) {
      if (mounted.current && request.current === controller) { setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Transcription cancelled. Recording kept."); setPhase("error"); }
    } finally { if (request.current === controller) request.current = null; }
  }, [threadId]);
  const cancelBridge = useCallback((bridge: Bridge) => {
    bridge.cancelled = true;
    void bridge.ready.then(() => bridge.client.call("session.dictation.cancel", { threadId, id: bridge.id })).catch(() => {});
  }, [threadId]);
  const sendFrames = useCallback((current: Pick<Capture, "frames" | "bridge">) => {
    const bridge = current.bridge;
    if (!bridge?.connected || bridge.error || bridge.cancelled) return;
    while (bridge.sent < current.frames.length) {
      if (bridge.pending.size >= 64) { bridge.error = new Error("Dictation network is busy. Recording is kept locally."); break; }
      const frame = current.frames[bridge.sent], sequence = bridge.sent++;
      const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
      const pending = bridge.client.call("session.dictation.append", { threadId, id: bridge.id, sequence, audio: btoa(String.fromCharCode(...bytes)) }).then(() => {}, cause => {
        bridge.error = cause instanceof Error ? cause : new Error("Native dictation disconnected. Recording is kept locally.");
        if (mounted.current && capture.current === current) setError("Native connection interrupted. Continue recording; retry transcription after stopping.");
      });
      bridge.pending.add(pending); void pending.then(() => bridge.pending.delete(pending));
    }
  }, [threadId]);
  const retryTranscription = useCallback(async (audio: Clip) => {
    const client = latest.current.client;
    if (!client) return transcribe(audio);
    if (capture.current || request.current || finishingBridge.current) return;
    const startedAt = performance.now();
    const bridge: Bridge = { id: crypto.randomUUID(), client, connected: false, sent: 0, pending: new Set(), ready: Promise.resolve() };
    finishingBridge.current = bridge; setPhase("transcribing"); setError(""); setTranscriptionTime(null);
    try {
      bridge.ready = client.call("session.dictation.start", { threadId, id: bridge.id }).then(() => { bridge.connected = true; });
      await bridge.ready;
      const buffer = await audio.blob.arrayBuffer();
      // Retained clips are our own PCM WAVs. Reuse the authenticated live channel
      // and replay at audio speed, overlapping acknowledgements with each chunk.
      const replay = { frames: [] as Int16Array[], bridge };
      for (let offset = 44; offset < buffer.byteLength; offset += 16000) {
        if (bridge.cancelled) throw new Error("Transcription cancelled. Recording kept.");
        const bytes = Math.min(16000, buffer.byteLength - offset);
        replay.frames.push(new Int16Array(buffer, offset, bytes / 2)); sendFrames(replay);
        if (bridge.error) throw bridge.error;
        await new Promise(resolve => setTimeout(resolve, bytes / 32));
      }
      if (bridge.cancelled) throw new Error("Transcription cancelled. Recording kept.");
      const [result] = await Promise.all([
        client.call("session.dictation.finish", { threadId, id: bridge.id, sequence: bridge.sent }) as Promise<{ text?: string }>,
        Promise.all([...bridge.pending]),
      ]);
      if (bridge.error) throw bridge.error;
      if (!result.text?.trim()) throw new Error("Native dictation returned incomplete text. Recording kept.");
      if (!bridge.cancelled && mounted.current && finishingBridge.current === bridge) {
        latest.current.onText(audio.base + (audio.base.trim() ? " " : "") + result.text);
        setTranscriptionTime({ seconds: (performance.now() - startedAt) / 1000, retry: true }); setPhase("idle");
      }
    } catch (cause) {
      cancelBridge(bridge);
      if (mounted.current && finishingBridge.current === bridge) {
        setError(cause instanceof Error ? cause.message : "Native dictation interrupted. Recording kept."); setPhase("error");
      }
    } finally { if (finishingBridge.current === bridge) finishingBridge.current = null; }
  }, [cancelBridge, sendFrames, threadId, transcribe]);
  const finishCapture = useCallback(async (run = true) => {
    const stoppedAt = performance.now();
    stopRequested.current = true;
    const current = capture.current;
    if (!current || current.stopped) return;
    if (!current.stream) { if (current.bridge) cancelBridge(current.bridge); return; }
    current.stopped = true; clearTimeout(current.limit);
    if (current.node) await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 500);
      current.flush = () => { clearTimeout(timeout); resolve(); }; current.node!.port.postMessage("stop");
    });
    current.stream.getTracks().forEach(track => track.stop()); current.source?.disconnect(); current.node?.disconnect();
    await current.context.close().catch(() => {});
    if (current.discarded) return;
    if (capture.current === current) capture.current = null;
    if (!current.samples) { if (current.bridge) cancelBridge(current.bridge); if (mounted.current) { setError("No audio recorded. Check the microphone and retry."); setPhase("error"); } return; }
    const audio = { blob: pcmWav(current.frames, current.samples), seconds: current.samples / 16000, base: latest.current.draft };
    recordings.set(threadId, audio);
    if (!mounted.current || !run) {
      if (current.bridge) cancelBridge(current.bridge);
      if (mounted.current) { setClip(audio); setSeconds(audio.seconds); setPhase("error"); setError("Recording stopped and kept. Retry transcription or download it."); }
      return;
    }
    setClip(audio); setSeconds(audio.seconds);
    if (!current.bridge) return transcribe(audio, stoppedAt, false);
    const bridge = current.bridge; finishingBridge.current = bridge; setPhase("transcribing"); setError("");
    try {
      await bridge.ready;
      if (bridge.cancelled) throw new Error("Transcription cancelled. Recording kept.");
      sendFrames(current);
      if (bridge.error) throw bridge.error;
      // The gateway processes ordered WebSocket frames. Flush immediately after
      // the final audio frame instead of paying another round trip for its ACK.
      const [result] = await Promise.all([
        bridge.client.call("session.dictation.finish", { threadId, id: bridge.id, sequence: bridge.sent }) as Promise<{ text?: string }>,
        Promise.all([...bridge.pending]),
      ]);
      if (bridge.error) throw bridge.error;
      if (!result.text?.trim()) throw new Error("Native dictation returned incomplete text. Recording kept.");
      if (bridge.cancelled) throw new Error("Transcription cancelled. Recording kept.");
      if (mounted.current && finishingBridge.current === bridge) {
        const text = audio.base + (audio.base.trim() ? " " : "") + result.text;
        latest.current.onText(text); setTranscriptionTime({ seconds: (performance.now() - stoppedAt) / 1000, retry: false }); setPhase("idle");
        return text;
      }
    } catch (cause) {
      cancelBridge(bridge);
      if (mounted.current && finishingBridge.current === bridge) { setError(cause instanceof Error ? cause.message : "Native dictation interrupted. Recording kept."); setPhase("error"); }
    } finally { if (finishingBridge.current === bridge) finishingBridge.current = null; }
  }, [threadId, transcribe, sendFrames, cancelBridge]);
  const start = useCallback(async () => {
    if (capture.current || request.current || finishingBridge.current) return;
    stopRequested.current = false; setError(""); setPhase("starting"); setSeconds(0); setTranscriptionTime(null);
    let attempted: Capture | undefined;
    try {
      // Resume from the button gesture, before awaiting a mobile permission prompt.
      const context = new AudioContext();
      const current: Capture = { context, frames: [], samples: 0, stopped: false }; attempted = current; capture.current = current;
      const resume = context.resume();
      // Native preparation overlaps microphone permission and worklet setup.
      if (latest.current.client) {
        const bridge: Bridge = { id: crypto.randomUUID(), client: latest.current.client, connected: false, sent: 0, pending: new Set(), ready: Promise.resolve() };
        current.bridge = bridge;
        bridge.ready = bridge.client.call("session.dictation.start", { threadId, id: bridge.id }).then(() => {
          bridge.connected = true; sendFrames(current);
        }).catch(cause => { bridge.error = cause instanceof Error ? cause : new Error("Native dictation connection failed"); if (mounted.current && capture.current === current) setError("Native connection unavailable. Recording is kept locally; retry after stopping."); });
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); current.stream = stream;
      await resume;
      if (!mounted.current || stopRequested.current || capture.current !== current) { current.stopped = true; if (current.bridge) cancelBridge(current.bridge); stream.getTracks().forEach(track => track.stop()); await context.close().catch(() => {}); if (capture.current === current) { capture.current = null; if (mounted.current) setPhase("idle"); } return; }
      await context.audioWorklet.addModule("/audio/native-dictation-recorder.js");
      if (!mounted.current || stopRequested.current || capture.current !== current) { current.stopped = true; if (current.bridge) cancelBridge(current.bridge); stream.getTracks().forEach(track => track.stop()); await context.close().catch(() => {}); if (capture.current === current) { capture.current = null; if (mounted.current) setPhase("idle"); } return; }
      const node = new AudioWorkletNode(context, "native-dictation-recorder"); current.node = node;
      node.onprocessorerror = () => { if (!current.stopped) void finishCapture(false); };
      context.onstatechange = () => { if (!current.stopped && context.state !== "running") void finishCapture(false); };
      node.port.onmessage = event => {
        if (current.discarded) return;
        if (event.data.stopped) { current.flush?.(); return; }
        if (!(event.data.pcm instanceof Int16Array)) return;
        const pcm = event.data.pcm as Int16Array;
        if (current.samples + pcm.length > 16000 * 600) { void finishCapture(false); return; }
        current.frames.push(pcm); current.samples += pcm.length; sendFrames(current);
        if (mounted.current) setSeconds(current.samples / 16000);
      };
      current.source = context.createMediaStreamSource(stream); current.source.connect(node); node.connect(context.destination);
      stream.getTracks().forEach(track => track.addEventListener("ended", () => { if (!current.stopped) void finishCapture(false); }, { once: true }));
      current.limit = setTimeout(() => { void finishCapture(false); }, 600000);
      if (stopRequested.current) { void finishCapture(); return; }
      if (mounted.current) setPhase("recording");
    } catch {
      const current = attempted, owned = current && capture.current === current;
      if (owned) capture.current = null;
      if (current?.bridge) cancelBridge(current.bridge);
      current?.stream?.getTracks().forEach(track => track.stop()); void current?.context.close().catch(() => {});
      if (mounted.current && (owned || !current)) { setError("Could not start recording. Allow microphone access and use HTTPS."); setPhase("error"); }
    }
  }, [finishCapture, sendFrames, threadId, cancelBridge]);
  const clear = useCallback(() => { recordings.delete(threadId); setClip(null); setError(""); setPhase("idle"); setTranscriptionTime(null); }, [threadId]);
  const discard = useCallback(() => {
    stopRequested.current = true;
    const current = capture.current; capture.current = null;
    if (current) {
      current.discarded = true; current.stopped = true; clearTimeout(current.limit); current.flush?.();
      if (current.bridge) cancelBridge(current.bridge);
      current.stream?.getTracks().forEach(track => track.stop()); current.source?.disconnect(); current.node?.disconnect();
      void current.context.close().catch(() => {});
    }
    request.current?.abort(); request.current = null;
    if (finishingBridge.current) cancelBridge(finishingBridge.current);
    finishingBridge.current = null; clear(); setSeconds(0);
  }, [cancelBridge, clear]);
  const download = useCallback(() => {
    if (!clip) return;
    const url = URL.createObjectURL(clip.blob), link = document.createElement("a"); link.href = url; link.download = "codex-dictation.wav"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [clip]);
  useEffect(() => {
    mounted.current = true;
    const leave = (event: BeforeUnloadEvent) => { if (capture.current || recordings.has(threadId)) { event.preventDefault(); event.returnValue = ""; } };
    const hidden = () => { if (document.hidden && capture.current) void finishCapture(false); };
    window.addEventListener("beforeunload", leave); document.addEventListener("visibilitychange", hidden);
    return () => { mounted.current = false; request.current?.abort(); if (finishingBridge.current) cancelBridge(finishingBridge.current); void finishCapture(false); window.removeEventListener("beforeunload", leave); document.removeEventListener("visibilitychange", hidden); };
  }, [threadId, finishCapture, cancelBridge]);
  return { phase, clip, error, seconds, transcriptionTime, start, stop: () => finishCapture(), retry: () => clip && retryTranscription({ ...clip, base: latest.current.draft }), cancel: () => { request.current?.abort(); if (finishingBridge.current) cancelBridge(finishingBridge.current); }, discard, clear, download, busy: ["starting", "recording", "transcribing"].includes(phase) };
}
