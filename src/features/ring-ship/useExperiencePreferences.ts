"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mergeExperience, normalizeExperience, type ExperiencePreference } from "@/lib/studio/experience";
import type { StudioSettingsCoordinator } from "@/lib/studio/coordinator";
export type ExperienceController = { value: ExperiencePreference; ready: boolean; error: string; patch: (value: ExperiencePreference) => void; retry: () => void };
export function legacyExperience(namespace: string, saved: ExperiencePreference = {}): ExperiencePreference {
  try {
    const provider = localStorage.getItem("claw3d:music:provider");
    const galaxy = localStorage.getItem(`claw3d:star-system:${namespace}`);
    const selected = saved.music?.provider || provider;
    const scene = saved.galaxy || galaxy || "deep-space";
    const id = selected === "local" ? localStorage.getItem("claw3d:music:local:last-track") : selected === "netease" ? localStorage.getItem(`claw3d:music:last-scene-track:${scene}`) : null;
    return normalizeExperience({ ...(galaxy ? { galaxy } : {}), music: { ...(provider ? { provider } : {}), ...(id && selected ? { lastTrack: { provider: selected, id } } : {}) } });
  } catch { return {}; }
}
export function useExperiencePreferences(coordinator: StudioSettingsCoordinator, enabled: boolean): ExperienceController {
  const [state, setState] = useState({ value: {} as ExperiencePreference, ready: !enabled, error: "" });
  const alive = useRef(false), serverReady = useRef(false), pending = useRef<ExperiencePreference>({}), writing = useRef(false), loading = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(async () => {
    if (!serverReady.current || writing.current) return;
    writing.current = true;
    try {
      while (Object.keys(pending.current).length && serverReady.current) {
        const sent = pending.current;
        await coordinator.applyPatchNow({ experience: sent });
        const remaining = { ...pending.current, ...(pending.current.music ? { music: { ...pending.current.music } } : {}) };
        if (sent.galaxy !== undefined && remaining.galaxy === sent.galaxy) delete remaining.galaxy;
        for (const key of ["provider", "volume", "lastTrack"] as const) if (sent.music?.[key] !== undefined && JSON.stringify(remaining.music?.[key]) === JSON.stringify(sent.music[key])) delete remaining.music?.[key];
        if (remaining.music && !Object.keys(remaining.music).length) delete remaining.music;
        pending.current = remaining;
      }
      if (alive.current) setState(s => ({ ...s, error: "" }));
    } catch { serverReady.current = false; if (alive.current) setState(s => ({ ...s, error: "Preferences could not sync. Your changes stay in this tab." })); }
    finally { writing.current = false; }
  }, [coordinator]);
  const load = useCallback(async () => {
    const generation = ++loading.current;
    try {
      let settings = await coordinator.loadSettings({ force: true });
      if (!settings || !alive.current || generation !== loading.current) return;
      const legacy = legacyExperience(settings.activeFloorId, settings.experience);
      if (settings.experience?.galaxy !== undefined) delete legacy.galaxy;
      if (legacy.music) for (const key of ["provider", "volume", "lastTrack"] as const) if (settings.experience?.music?.[key] !== undefined) delete legacy.music[key];
      if (legacy.music && !Object.keys(legacy.music).length) delete legacy.music;
      if (Object.keys(legacy).length) {
        await coordinator.applyPatchNow({ experienceSeed: legacy });
        settings = await coordinator.loadSettings({ force: true });
      }
      if (!alive.current || !settings || generation !== loading.current) return;
      serverReady.current = true;
      setState({ value: mergeExperience(settings.experience, pending.current), ready: true, error: "" });
      await save();
    } catch {
      if (alive.current && generation === loading.current) setState(s => ({ value: mergeExperience(mergeExperience(legacyExperience("lobby"), s.value), pending.current), ready: true, error: "Preferences could not load. Using this tab's choices." }));
    }
  }, [coordinator, save]);
  useEffect(() => { alive.current = true; if (enabled) void load(); return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); void save(); }; }, [enabled, load, save]);
  const patch = useCallback((value: ExperiencePreference) => {
    const clean = normalizeExperience(value); pending.current = mergeExperience(pending.current, clean); 
    setState(s => ({ ...s, value: mergeExperience(s.value, clean) }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void save(); }, 350);
  }, [save]);
  return { ...state, patch, retry: () => { void load(); } };
}
