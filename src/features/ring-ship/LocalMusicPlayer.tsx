"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play, SkipForward } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { MusicMiniPlayer, type MusicPlayerProps } from "./MusicMiniPlayer";
import { shuffledSongs } from "./musicQueue";

const API = "/api/music/local", LAST_TRACK = "claw3d:music:local:last-track";
type Song = { id: string; name: string; artists: string; album: string };
function mix(songs: Song[], previousId?: string) {
  try { previousId ||= localStorage.getItem(LAST_TRACK) || undefined; } catch { /* Private browsing still plays music. */ }
  return shuffledSongs(songs, previousId);
}

export function LocalMusicPlayer({ autoPlay, controlsTarget, minimized, onOpen, onStop }: MusicPlayerProps) {
  const t = useUiText(), audio = useRef<HTMLAudioElement>(null);
  const queue = useRef<Song[]>([]), wantsPlayback = useRef(autoPlay), switching = useRef(false);
  const [songs, setSongs] = useState<Song[] | null>(null), [selected, setSelected] = useState<Song | null>(null);
  const [name, setName] = useState("Local music"), [error, setError] = useState("");
  const [playing, setPlaying] = useState(false), [playHint, setPlayHint] = useState(false), [volume, setVolume] = useState(1);
  useEffect(() => {
    const controller = new AbortController(), element = audio.current;
    void fetch(API, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const library = await response.json(); if (!response.ok) throw new Error(library.error || "Local music is unavailable. Please retry.");
      if (controller.signal.aborted) return;
      setName(library.name); setSongs(library.songs); queue.current = mix(library.songs);
      if (wantsPlayback.current && queue.current.length) { switching.current = true; setSelected(queue.current[0]); }
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setSongs([]); } });
    return () => { controller.abort(); wantsPlayback.current = false; element?.pause(); element?.removeAttribute("src"); element?.load(); };
  }, []);
  const resume = () => { wantsPlayback.current = true; void audio.current?.play().catch(cause => { if (cause.name !== "AbortError" && wantsPlayback.current) setPlayHint(true); }); };
  useEffect(() => {
    if (selected && wantsPlayback.current) void audio.current?.play().catch(cause => { if (cause.name !== "AbortError" && wantsPlayback.current) setPlayHint(true); });
  }, [selected]);
  useEffect(() => {
    if (!playHint) return;
    const retry = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".music-mini, .music-dialog")) return;
      if (wantsPlayback.current && audio.current?.paused) void audio.current.play().catch(() => {});
    };
    document.addEventListener("click", retry); document.addEventListener("keydown", retry);
    return () => { document.removeEventListener("click", retry); document.removeEventListener("keydown", retry); };
  }, [playHint]);
  const play = (song: Song) => {
    wantsPlayback.current = true; switching.current = true; setError(""); setPlayHint(false);
    if (song.id === selected?.id && audio.current) { audio.current.currentTime = 0; resume(); }
    else setSelected(song);
  };
  const next = () => {
    if (!queue.current.length) return;
    let index = queue.current.findIndex(song => song.id === selected?.id) + 1;
    if (index >= queue.current.length) { queue.current = mix(songs || [], selected?.id); index = 0; }
    if (queue.current[index]) play(queue.current[index]);
  };
  const pause = () => { wantsPlayback.current = false; setPlayHint(false); audio.current?.pause(); };
  return <><section className="music-netease-player" aria-label={t("Local music")}>
    {error ? <p className="music-notice" role="alert">{t(error)}</p> : null}
    <div className="music-discovery"><strong>{name}</strong><p>{t("Local library · No sign-in needed")}</p>
      <button type="button" className="music-action" disabled={!songs?.length} onClick={() => { const first = queue.current[0]; if (first) play(first); }}><Play size={15} />{t("Play mix")}</button>
    </div>
    <div className="music-results">{songs === null ? <p className="music-empty" role="status">{t("Loading local music…")}</p> : songs.length === 0 ? <p className="music-empty">{t("No local tracks installed.")}</p> : <ul>{songs.map(song => <li key={song.id}>
      <button type="button" className="music-song" data-selected={selected?.id === song.id} aria-label={t("Play {song}", { song: song.name })} onClick={() => play(song)}><Play size={16} /><span><strong>{song.name}</strong><small>{[song.artists, song.album].filter(Boolean).join(" · ")}</small></span></button>
    </li>)}</ul>}</div>
    <footer className="music-now-playing" hidden={!selected}>
      <div className="music-track-heading"><div><strong>{selected?.name}</strong><small>{selected?.artists}</small></div><button type="button" className="music-icon-button" aria-label={t("Next track")} onClick={next}><SkipForward size={18} /></button></div>
      <audio ref={audio} controls preload="metadata" src={selected ? API + "?id=" + encodeURIComponent(selected.id) : undefined} aria-label={t("Music playback")}
        onLoadedMetadata={() => { switching.current = false; }}
        onPlay={() => { switching.current = false; wantsPlayback.current = true; setPlaying(true); setPlayHint(false); if (selected) { try { localStorage.setItem(LAST_TRACK, selected.id); } catch {} } }}
        onPause={() => { setPlaying(false); if (!switching.current && !audio.current?.ended) wantsPlayback.current = false; }}
        onEnded={() => { setPlaying(false); if (wantsPlayback.current) next(); }}
        onVolumeChange={() => { if (audio.current) setVolume(audio.current.muted ? 0 : audio.current.volume); }}
        onError={() => { wantsPlayback.current = false; switching.current = false; setPlaying(false); setError("This track could not be played. Try another track."); }} />
      {playHint ? <p role="status">{t("Press play to start listening.")}</p> : null}
    </footer>
  </section>{controlsTarget && minimized && selected ? createPortal(<MusicMiniPlayer title={selected.name} subtitle={selected.artists} playing={playing} playHint={playHint} volume={volume} onOpen={onOpen}
    onTogglePlay={() => { if (audio.current?.paused) resume(); else pause(); }} onNext={next}
    onVolumeChange={value => { if (audio.current) { audio.current.volume = value; audio.current.muted = false; } setVolume(value); }}
    onStop={() => { wantsPlayback.current = false; onStop(); }} />, controlsTarget) : null}</>;
}
