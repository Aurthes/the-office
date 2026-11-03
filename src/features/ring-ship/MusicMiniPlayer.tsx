"use client";
import { useState } from "react";
import { Pause, Play, SkipForward, Square, Volume2 } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";

export type MusicPlayerProps = {
  autoPlay: boolean; scene: string; sceneName: string; controlsTarget: HTMLElement | null;
  minimized: boolean; onOpen: () => void; onStop: () => void;
};

export function MusicMiniPlayer({ title, subtitle, playing, loading = false, playHint, volume, onOpen, onTogglePlay, onNext, onVolumeChange, onStop }: {
  title: string; subtitle: string; playing: boolean; loading?: boolean; playHint: boolean; volume: number;
  onOpen: () => void; onTogglePlay: () => void; onNext: () => void; onVolumeChange: (value: number) => void; onStop: () => void;
}) {
  const t = useUiText(), [volumeOpen, setVolumeOpen] = useState(false);
  return <section className="music-mini" aria-label={t("Background music")}>
    <button type="button" className="music-mini-track" onClick={onOpen} aria-label={t("Open music player")} title={t("Open music player")}>
      <span><strong>{title}</strong><small role={playHint ? "status" : undefined}>{playHint ? t("Tap to start music") : subtitle}</small></span>
    </button>
    <button type="button" className="music-mini-button" aria-label={t(playing ? "Pause music" : "Resume music")} onClick={onTogglePlay}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
    <button type="button" className="music-mini-button music-mini-next" aria-label={t("Next track")} disabled={loading} onClick={onNext}><SkipForward size={16} /></button>
    <div className="music-mini-volume">
      <button type="button" className="music-mini-button" aria-label={t("Music volume")} aria-expanded={volumeOpen} onClick={() => setVolumeOpen(value => !value)}><Volume2 size={16} /></button>
      {volumeOpen ? <label className="music-mini-volume-popover"><input type="range" aria-label={t("Music volume")} min="0" max="1" step="0.01" value={volume} onChange={event => onVolumeChange(Number(event.target.value))} /></label> : null}
    </div>
    <button type="button" className="music-mini-button" aria-label={t("Stop music")} onClick={onStop}><Square size={15} /></button>
  </section>;
}
