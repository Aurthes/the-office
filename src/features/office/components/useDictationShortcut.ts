"use client";
import { useEffect, useRef, type RefObject } from "react";

const HOLD_MS = 250;
type Options = {
  input: RefObject<HTMLTextAreaElement | null>;
  enabled: boolean;
  phase: string;
  start: () => unknown;
  stop: (send: boolean) => unknown;
  discard: () => void;
};

// A lone Option tap toggles recording; a hold records until release.
export function useDictationShortcut(options: Options) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  useEffect(() => {
    if (!/Mac/.test(navigator.platform)) return;
    let press: { code: string; wasRecording: boolean; started: boolean; timer?: ReturnType<typeof setTimeout> } | null = null;
    const recording = () => ["starting", "recording"].includes(latest.current.phase);
    const visible = () => !document.hidden && Boolean(latest.current.input.current?.getClientRects().length);
    const reset = () => { if (press) clearTimeout(press.timer); press = null; };
    const consume = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const keydown = (event: KeyboardEvent) => {
      if (!visible() || event.isComposing) return;
      if (event.key === "Escape" && (press || recording() || latest.current.phase === "transcribing")) {
        consume(event); reset(); latest.current.discard(); return;
      }
      const field = event.target instanceof Element ? event.target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']") : null;
      if (field && field !== latest.current.input.current) return;
      if (event.key === "Enter" && recording() && !press && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        consume(event); void latest.current.stop(true); return;
      }
      if (event.key !== "Alt") {
        const started = press?.started; reset();
        if (started) latest.current.discard();
        return; // Leave Option combinations to the browser/editor.
      }
      if (event.repeat || press || event.ctrlKey || event.metaKey || event.shiftKey || (!recording() && (!latest.current.enabled || latest.current.phase === "transcribing"))) return;
      event.preventDefault();
      const current = { code: event.code, wasRecording: recording(), started: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      press = current;
      if (!current.wasRecording) current.timer = setTimeout(() => {
        if (press !== current || !visible() || !latest.current.enabled) { reset(); return; }
        current.started = true; void latest.current.start();
      }, HOLD_MS);
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key !== "Alt" || !press || event.code !== press.code) return;
      const current = press; reset(); event.preventDefault();
      if (!visible()) return;
      if (current.wasRecording || current.started) void latest.current.stop(false);
      else if (latest.current.enabled) void latest.current.start();
    };
    const blur = () => { const started = press?.started; reset(); if (started) void latest.current.stop(false); };
    const hidden = () => { if (document.hidden) blur(); };
    window.addEventListener("keydown", keydown, true); window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", blur); document.addEventListener("visibilitychange", hidden);
    return () => {
      reset(); window.removeEventListener("keydown", keydown, true); window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", blur); document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
}
