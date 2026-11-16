"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { useUiLanguage, useUiText } from "@/lib/i18n/ui-language";
import type { SessionClient } from "./SessionControls";

type Preview = { voice: string; url: string; language: string | null };
type Catalog = { source: "openai-prerecorded"; language: "en" | "zh"; previews: Preview[]; unavailable: string[] };
function validURL(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "persistent.oaistatic.com" && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/voice\/previews\/[a-z0-9._-]+\.m4a$/.test(url.pathname);
  } catch { return false; }
}
export function VoicePreviews({ client, voices }: { client: SessionClient; voices: string[] }) {
  const t = useUiText(), { language: uiLanguage } = useUiLanguage();
  const language = uiLanguage === "zh-CN" ? "zh" : "en";
  const [catalog, setCatalog] = useState<Catalog | null>(null), [catalogError, setCatalogError] = useState(false), [reload, setReload] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null), [failure, setFailure] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), generation = useRef(0);
  const release = useCallback(() => {
    generation.current++;
    if (audio.current) { audio.current.onended = null; audio.current.onerror = null; audio.current.pause(); audio.current.removeAttribute("src"); audio.current.load(); }
  }, []);
  const stop = useCallback(() => { release(); setPlaying(null); }, [release]);
  useEffect(() => {
    let disposed = false;
    void client.call("session.voice.previews", { language }).then(value => {
      if (disposed) return;
      const data = value as Catalog;
      if (data?.source !== "openai-prerecorded" || data.language !== language || !Array.isArray(data.previews) || !Array.isArray(data.unavailable)) throw new Error("Invalid catalog");
      setCatalog({ ...data, previews: data.previews.filter(item => voices.includes(item.voice) && (item.language === null || typeof item.language === "string" && /^[a-z]{2}(?:-[A-Za-z]{2})?$/.test(item.language)) && typeof item.url === "string" && validURL(item.url)) });
    }).catch(() => { if (!disposed) setCatalogError(true); });
    return () => { disposed = true; release(); };
  }, [client, language, reload, voices, release]);
  const retry = useCallback(() => { stop(); setCatalog(null); setCatalogError(false); setFailure(null); setReload(value => value + 1); }, [stop]);

  const play = async (item: Preview) => {
    if (playing === item.voice) { stop(); return; }
    release(); const token = generation.current;
    setFailure(null); setPlaying(item.voice);
    const failed = () => { if (generation.current !== token) return; release(); setPlaying(null); setFailure(item.voice); };
    try {
      const element = audio.current ||= new Audio();
      element.preload = "none"; element.crossOrigin = "anonymous"; element.src = item.url;
      element.onended = () => { if (generation.current === token) { release(); setPlaying(null); } };
      element.onerror = failed;
      await element.play();
    } catch { failed(); }

  };
  // Language changes replace this keyed view; no old request/play callback can
  // overwrite the new catalog or stop the separately owned live call audio.
  return <div className="mt-4 border-t border-white/10 pt-3">
    <h4 className="font-semibold text-cyan-100">{t("Voice previews")}</h4>
    <p className="mt-1 text-[11px] text-white/60">{t(language === "zh" ? "Official prerecorded samples · Chinese requested" : "Official prerecorded samples · English requested")}</p>
    <p className="mt-1 text-[11px] text-white/60">{t("Previews do not change your selected voice. Default has no specific sample.")}</p>
    {catalogError ? <p role="status" className="mt-2 text-amber-100">{t("Official voice previews are temporarily unavailable.")} <button type="button" onClick={retry} className="underline">{t("Retry")}</button></p> : !catalog ? <p role="status" className="mt-2 text-white/60">{t("Loading voice previews…")}</p> : <ul className="mt-2 space-y-1">{voices.map(voice => {
      const item = catalog.previews.find(preview => preview.voice === voice);
      return <li key={voice} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg bg-black/10 px-2 py-1"><span className="capitalize">{voice}{item && item.language !== language ? <small className="ml-2 normal-case text-white/50">{item.language ? t("Sample language label: {language}", { language: item.language }) : t("Sample language not specified")}</small> : null}</span><div className="flex items-center gap-2">
        {failure === voice ? <span role="status" className="text-[11px] text-amber-100">{t("Preview could not play. Retry.")}</span> : null}
        {item ? <button type="button" aria-label={t(playing === voice ? "Stop preview: {voice}" : "Preview: {voice}", { voice })} aria-pressed={playing === voice} onClick={() => void play(item)} className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-cyan-100">{playing === voice ? <Square size={14} /> : <Play size={14} />}{t(playing === voice ? "Stop" : "Listen")}</button> : <span className="text-[11px] text-white/50">{t("No official preview available")}</span>}
      </div></li>;
    })}</ul>}
  </div>;
}
