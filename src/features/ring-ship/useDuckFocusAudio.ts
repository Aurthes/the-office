"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OfficeAgent } from "@/features/retro-office/core/types";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";

const ATTENTION_PRIORITY = { review: 1, waiting: 2, error: 3 };
type AttentionGroup = keyof typeof ATTENTION_PRIORITY;
type ClipGroup = "focus" | AttentionGroup;
type Clip = { id: string; base64: string; group?: ClipGroup };
type AttentionAgent = Pick<OfficeAgent, "id" | "status" | "needsInput" | "needsReview">;
const NO_AGENTS: readonly AttentionAgent[] = [];

// A quiet pause after each finished call, independent of roster/status refreshes.
export const DUCK_CALL_MIN_MS = 12_000;
export const DUCK_CALL_MAX_MS = 25_000;

export function useDuckFocusAudio(focusedId: string | null, agents: readonly AttentionAgent[] = NO_AGENTS) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [muted, setMuted] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const buffers = useRef(new Map<string, Promise<AudioBuffer>>());
  const lastClip = useRef("");
  const previousActivity = useRef<Map<string, string> | null>(null);
  const notify = useRef<((group: AttentionGroup) => void) | null>(null);

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
    if (muted || !unlocked || !clips.length || !engine || !output) return;
    let cancelled = false;
    let notifying = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let source: AudioBufferSourceNode | null = null;
    const silence = () => {
      generation++;
      notifying = false;
      clearTimeout(timer); timer = undefined;
      if (source) { source.onended = null; source.stop(); source.disconnect(); source = null; }
    };
    const schedule = () => {
      if (focusedId && !cancelled && !document.hidden) timer = setTimeout(() => { void play(); }, DUCK_CALL_MIN_MS + Math.random() * (DUCK_CALL_MAX_MS - DUCK_CALL_MIN_MS));
    };
    const play = async (group: ClipGroup = "focus") => {
      const attention = group !== "focus";
      if (cancelled || (!attention && document.hidden)) return;
      const pool = clips.filter(clip => (clip.group ?? "focus") === group);
      if (!pool.length) return;
      notifying = attention;
      const request = ++generation;
      const choices = pool.length > 1 ? pool.filter(clip => clip.id !== lastClip.current) : pool;
      const clip = choices[Math.floor(Math.random() * choices.length)];
      try {
        await engine.resume();
        if (cancelled || request !== generation || (!attention && document.hidden)) return;
        if (!buffers.current.has(clip.id)) {
          const bytes = Uint8Array.from(atob(clip.base64), char => char.charCodeAt(0));
          buffers.current.set(clip.id, engine.decodeAudioData(bytes.buffer));
        }
        const buffer = await buffers.current.get(clip.id)!;
        // Focus may have changed while this clip was being decoded.
        if (cancelled || request !== generation || (!attention && document.hidden)) return;
        if (engine.state !== "running") { notifying = false; return; }
        const node = engine.createBufferSource(); node.buffer = buffer; node.connect(output);
        source = node; lastClip.current = clip.id;
        node.onended = () => { node.disconnect(); source = null; notifying = false; schedule(); };
        node.start();
      } catch { if (request === generation) { notifying = false; schedule(); } }
    };
    // Attention calls work without a selected character, including in a
    // background tab. They share the player so calls never overlap.
    const attention = (group: AttentionGroup) => {
      if (!clips.some(clip => clip.group === group)) return;
      silence(); void play(group);
    };
    notify.current = attention;
    const visibility = () => { if (!notifying) { silence(); if (!document.hidden) schedule(); } };
    document.addEventListener("visibilitychange", visibility);
    if (focusedId) void play();
    return () => { cancelled = true; if (notify.current === attention) notify.current = null; silence(); document.removeEventListener("visibilitychange", visibility); };
  }, [focusedId, muted, unlocked, clips]);

  useEffect(() => {
    // Wait for the first populated roster; loading and reconnecting must not
    // turn old yellow markers into new notifications.
    if (!agents.length) return;
    const previous = previousActivity.current, next = new Map<string, string>();
    let changed: AttentionGroup | null = null;
    for (const agent of agents) {
      const kind = getAgentActivity(agent).kind;
      next.set(agent.id, kind);
      if (previous && previous.get(agent.id) !== kind && (kind === "waiting" || kind === "review" || kind === "error")) {
        // One call per roster update; an error must not be masked by a result.
        if (!changed || ATTENTION_PRIORITY[kind] > ATTENTION_PRIORITY[changed]) changed = kind;
      }
    }
    previousActivity.current = next;
    if (changed) notify.current?.(changed);
  }, [agents]);

  return { available: clips.length > 0, muted, toggleMuted: useCallback(() => setMuted(value => !value), []) };
}
