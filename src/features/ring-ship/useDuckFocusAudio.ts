"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Clip = { id: string; base64: string };

// A quiet pause after each finished call, independent of roster/status refreshes.
export const DUCK_CALL_MIN_MS = 12_000;
export const DUCK_CALL_MAX_MS = 25_000;

export function useDuckFocusAudio(focusedId: string | null) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [muted, setMuted] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const buffers = useRef(new Map<string, Promise<AudioBuffer>>());
  const lastClip = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    const decoded = buffers.current;
    void fetch("/api/office/character-audio", { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(bank => { if (!controller.signal.aborted && Array.isArray(bank?.clips)) setClips(bank.clips); })
      .catch(() => {});
    // Browsers require a real click/key before sound. Unlock synchronously in
    // that gesture, including when it is the very first character selection.
    const unlock = () => {
      if (controller.signal.aborted) return;
      const AudioEngine = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioEngine) return;
      try {
        if (!context.current) {
          context.current = new AudioEngine();
          gain.current = context.current.createGain();
          gain.current.gain.value = .5;
          gain.current.connect(context.current.destination);
        }
        void context.current.resume().then(() => { if (!controller.signal.aborted) setUnlocked(true); }).catch(() => {});
      } catch { /* Audio hardware may be unavailable; keep the office usable. */ }
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      controller.abort();
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      gain.current?.disconnect();
      void context.current?.close().catch(() => {});
      context.current = null; gain.current = null; decoded.clear();
    };
  }, []);

  useEffect(() => {
    const engine = context.current, output = gain.current;
    if (!focusedId || muted || !unlocked || !clips.length || !engine || !output) return;
    let cancelled = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let source: AudioBufferSourceNode | null = null;
    const silence = () => {
      generation++;
      clearTimeout(timer); timer = undefined;
      if (source) { source.onended = null; source.stop(); source.disconnect(); source = null; }
    };
    const schedule = () => {
      if (!cancelled && !document.hidden) timer = setTimeout(() => { void play(); }, DUCK_CALL_MIN_MS + Math.random() * (DUCK_CALL_MAX_MS - DUCK_CALL_MIN_MS));
    };
    const play = async () => {
      if (cancelled || document.hidden) return;
      const request = ++generation;
      const choices = clips.length > 1 ? clips.filter(clip => clip.id !== lastClip.current) : clips;
      const clip = choices[Math.floor(Math.random() * choices.length)];
      try {
        await engine.resume();
        if (cancelled || request !== generation || document.hidden) return;
        if (!buffers.current.has(clip.id)) {
          const bytes = Uint8Array.from(atob(clip.base64), char => char.charCodeAt(0));
          buffers.current.set(clip.id, engine.decodeAudioData(bytes.buffer));
        }
        const buffer = await buffers.current.get(clip.id)!;
        // Focus may have changed while this clip was being decoded.
        if (cancelled || request !== generation || document.hidden || engine.state !== "running") return;
        const node = engine.createBufferSource(); node.buffer = buffer; node.connect(output);
        source = node; lastClip.current = clip.id;
        node.onended = () => { node.disconnect(); source = null; schedule(); };
        node.start();
      } catch { if (request === generation) schedule(); }
    };
    const visibility = () => { silence(); if (!document.hidden) schedule(); };
    document.addEventListener("visibilitychange", visibility);
    void play();
    return () => { cancelled = true; silence(); document.removeEventListener("visibilitychange", visibility); };
  }, [focusedId, muted, unlocked, clips]);

  return { available: clips.length > 0, muted, toggleMuted: useCallback(() => setMuted(value => !value), []) };
}
