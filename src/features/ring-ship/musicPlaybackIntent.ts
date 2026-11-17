"use client";
import { useCallback, useEffect, useRef } from "react";
import type { MusicProvider } from "@/lib/studio/experience";

const KEY = "claw3d:music:reload-intent";
type PlaybackIntent = { provider: MusicProvider; id: string };
export function reloadPlaybackIntent(): PlaybackIntent | null {
  try {
    if (typeof window === "undefined" || (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type !== "reload") return null;
    const value = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if ((value?.provider === "local" || value?.provider === "netease") && typeof value.id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value.id)) return { provider: value.provider, id: value.id };
  } catch { /* Storage/navigation timing may be unavailable; stay paused. */ }
  return null;
}
export function clearPlaybackIntent() { try { sessionStorage.removeItem(KEY); } catch {} }

// This tab's successful playback only. Never added to the shared server profile.
export function usePlaybackRecorder(provider: MusicProvider, enabled = false) {
  const closing = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    closing.current = false;
    const close = () => { closing.current = true; }, show = () => { closing.current = false; };
    window.addEventListener("pagehide", close); window.addEventListener("pageshow", show);
    return () => { closing.current = true; window.removeEventListener("pagehide", close); window.removeEventListener("pageshow", show); };
  }, [enabled]);
  return useCallback((id: string | null) => {
    if (!enabled || closing.current) return;
    try { if (id) sessionStorage.setItem(KEY, JSON.stringify({ provider, id })); else clearPlaybackIntent(); } catch {}
  }, [provider, enabled]);
}
