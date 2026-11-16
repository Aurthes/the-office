import { STAR_SYSTEMS, type StarSystemId } from "@/features/ring-ship/galaxy";
export type MusicProvider = "local" | "netease";
export type ExperiencePreference = {
  music?: { provider?: MusicProvider; lastTrack?: { provider: MusicProvider; id: string } | null; volume?: number };
  galaxy?: StarSystemId;
};
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const provider = (v: unknown): v is MusicProvider => v === "local" || v === "netease";
export function normalizeExperience(raw: unknown): ExperiencePreference {
  if (!record(raw)) return {};
  const value: ExperiencePreference = {};
  if (typeof raw.galaxy === "string" && STAR_SYSTEMS.some(s => s.id === raw.galaxy)) value.galaxy = raw.galaxy as StarSystemId;
  if (record(raw.music)) {
    const music: NonNullable<ExperiencePreference["music"]> = {};
    if (provider(raw.music.provider)) music.provider = raw.music.provider;
    if (typeof raw.music.volume === "number" && Number.isFinite(raw.music.volume) && raw.music.volume >= 0 && raw.music.volume <= 1) music.volume = raw.music.volume;
    const track = raw.music.lastTrack;
    if (track === null) music.lastTrack = null;
    else if (record(track) && provider(track.provider) && typeof track.id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(track.id)) music.lastTrack = { provider: track.provider, id: track.id };
    if (Object.keys(music).length) value.music = music;
  }
  return value;
}
export function mergeExperience(current: ExperiencePreference | undefined, patch: unknown, missingOnly = false): ExperiencePreference {
  const next = normalizeExperience(patch), value = { ...normalizeExperience(current) };
  if (next.galaxy !== undefined && (!missingOnly || value.galaxy === undefined)) value.galaxy = next.galaxy;
  if (next.music) {
    value.music = { ...value.music };
    for (const key of ["provider", "volume", "lastTrack"] as const) {
      if (next.music[key] !== undefined && (!missingOnly || value.music[key] === undefined)) Object.assign(value.music, { [key]: next.music[key] });
    }
  }
  return value;
}
