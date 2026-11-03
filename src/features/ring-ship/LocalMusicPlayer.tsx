"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play, SkipForward } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { MusicMiniPlayer, type MusicPlayerProps } from "./MusicMiniPlayer";
import { shuffledSongs } from "./musicQueue";

const API = "/api/music/local", LAST_TRACK = "claw3d:music:local:last-track", MODE_KEY = "claw3d:music:local:mode";
type PlaybackMode = "sequence" | "shuffle" | "repeat-one";
function savedMode(): PlaybackMode {
  try { const value = localStorage.getItem(MODE_KEY); if (value === "sequence" || value === "repeat-one") return value; } catch {}
  return "shuffle";
}
type Song = { id: string; name: string; artists: string; album: string; revision?: string };
function mix(songs: Song[], previousId?: string) {
  try { previousId ||= localStorage.getItem(LAST_TRACK) || undefined; } catch { /* Private browsing still plays music. */ }
  return shuffledSongs(songs, previousId);
}

export function LocalMusicPlayer({ autoPlay, controlsTarget, minimized, onOpen, onStop }: MusicPlayerProps) {
  const t = useUiText(), audio = useRef<HTMLAudioElement>(null);
  const [mode, setMode] = useState<PlaybackMode>(savedMode), modeRef = useRef(mode);
  const queue = useRef<Song[]>([]), wantsPlayback = useRef(autoPlay), switching = useRef(false);
  const [songs, setSongs] = useState<Song[] | null>(null), [selected, setSelected] = useState<Song | null>(null);
  const [name, setName] = useState("Local music"), [error, setError] = useState("");
  const [playing, setPlaying] = useState(false), [playHint, setPlayHint] = useState(false), [volume, setVolume] = useState(1);
  const [buffering, setBuffering] = useState(false);
  useEffect(() => {
    const controller = new AbortController(), element = audio.current;
    void fetch(API, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const library = await response.json(); if (!response.ok) throw new Error(library.error || "Local music is unavailable. Please retry.");
      if (controller.signal.aborted) return;
      setName(library.name); setSongs(library.songs); queue.current = modeRef.current === "shuffle" ? mix(library.songs) : [...library.songs];
      if (wantsPlayback.current && queue.current.length) { switching.current = true; setBuffering(true); setSelected(queue.current[0]); }
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setSongs([]); } });
    return () => { controller.abort(); wantsPlayback.current = false; element?.pause(); element?.removeAttribute("src"); element?.load(); };
  }, []);
  const resume = () => { wantsPlayback.current = true; setBuffering(true); void audio.current?.play().catch(cause => { if (cause.name !== "AbortError" && wantsPlayback.current) setPlayHint(true); }); };
  useEffect(() => {
    const element = audio.current;
    if (!selected || !element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (!wantsPlayback.current || !element.paused || timer !== undefined) return;
      const play = () => { if (wantsPlayback.current) void element.play().catch(cause => { if (cause.name !== "AbortError" && wantsPlayback.current) setPlayHint(true); }); };
      // Demuxers read ahead of audible sound. Give incomplete streams a short
      // download reserve; waiting on buffered alone can deadlock limited preload.
      const ahead = element.buffered.length ? element.buffered.end(0) - element.currentTime : 0;
      if (ahead >= Math.min(10, element.duration - element.currentTime)) play();
      else timer = setTimeout(play, 2000);
    };
    element.addEventListener("canplay", start);
    if (element.readyState >= 3) start();
    return () => { clearTimeout(timer); element.removeEventListener("canplay", start); };
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
    wantsPlayback.current = true; switching.current = true; setBuffering(true); setError(""); setPlayHint(false);
    if (song.id === selected?.id && audio.current) { audio.current.currentTime = 0; resume(); }
    else setSelected(song);
  };
  const next = () => {
    if (!queue.current.length) return;
    let index = queue.current.findIndex(song => song.id === selected?.id) + 1;
    if (index >= queue.current.length) { queue.current = mode === "shuffle" ? mix(songs || [], selected?.id) : [...(songs || [])]; index = 0; }
    if (queue.current[index]) play(queue.current[index]);
  };
  const changeMode = (value: PlaybackMode) => {
    modeRef.current = value; setMode(value);
    queue.current = value === "shuffle" ? mix(songs || [], selected?.id) : [...(songs || [])];
    try { localStorage.setItem(MODE_KEY, value); } catch {}
  };
  const pause = () => { wantsPlayback.current = false; setBuffering(false); setPlayHint(false); audio.current?.pause(); };
  return <><section className="music-netease-player" aria-label={t("Local music")}>
    {error ? <p className="music-notice" role="alert">{t(error)}</p> : null}
    <div className="music-discovery"><strong>{name}</strong><p>{t("Local library · No sign-in needed")}</p>
      <div className="music-discovery-actions" style={{ marginTop: 12 }} role="group" aria-label={t("Playback mode")}>
        {([["sequence", "Repeat all"], ["shuffle", "Random Mix"], ["repeat-one", "Repeat one"]] as const).map(([value, label]) => <button key={value} type="button" className="music-action" aria-pressed={mode === value} onClick={() => changeMode(value)}>{t(label)}</button>)}
      </div>
      <button type="button" className="music-action" disabled={!songs?.length} onClick={() => { const first = mode === "repeat-one" ? selected || queue.current[0] : queue.current[0]; if (first) play(first); }}><Play size={15} />{t("Play music")}</button>
    </div>
    <div className="music-results">{songs === null ? <p className="music-empty" role="status">{t("Loading local music…")}</p> : songs.length === 0 ? <p className="music-empty">{t("No local tracks installed.")}</p> : <ul>{songs.map(song => <li key={song.id}>
      <button type="button" className="music-song" data-selected={selected?.id === song.id} aria-label={t("Play {song}", { song: song.name })} onClick={() => play(song)}><Play size={16} /><span><strong>{song.name}</strong><small>{[song.artists, song.album].filter(Boolean).join(" · ")}</small></span></button>
    </li>)}</ul>}</div>
    <footer className="music-now-playing" hidden={!selected}>
      <div className="music-track-heading"><div><strong>{selected?.name}</strong><small>{selected?.artists}</small></div><button type="button" className="music-icon-button" aria-label={t("Next track")} onClick={next}><SkipForward size={18} /></button></div>
      <audio ref={audio} controls loop={mode === "repeat-one"} preload="auto" src={selected ? API + "?id=" + encodeURIComponent(selected.id) + (selected.revision ? "&v=" + encodeURIComponent(selected.revision) : "") : undefined} aria-label={t("Music playback")}
        onLoadStart={() => setBuffering(wantsPlayback.current)}
        onPlaying={() => setBuffering(false)} onWaiting={() => setBuffering(wantsPlayback.current)}
        onLoadedMetadata={() => { switching.current = false; }}
        onPlay={() => { switching.current = false; wantsPlayback.current = true; setPlaying(true); setPlayHint(false); if (selected) { try { localStorage.setItem(LAST_TRACK, selected.id); } catch {} } }}
        onPause={() => { setPlaying(false); if (!switching.current && !audio.current?.ended) { wantsPlayback.current = false; setBuffering(false); } }}
        onEnded={() => { setPlaying(false); if (wantsPlayback.current && mode !== "repeat-one") next(); }}
        onVolumeChange={() => { if (audio.current) setVolume(audio.current.muted ? 0 : audio.current.volume); }}
        onError={() => { wantsPlayback.current = false; switching.current = false; setBuffering(false); setPlaying(false); setError("This track could not be played. Try another track."); }} />
      {buffering && !playHint ? <p role="status">{t("Buffering music…")}</p> : null}
      {playHint ? <p role="status">{t("Press play to start listening.")}</p> : null}
    </footer>
  </section>{controlsTarget && minimized && selected ? createPortal(<MusicMiniPlayer title={selected.name} subtitle={buffering ? t("Buffering music…") : selected.artists} playing={playing} playHint={playHint} volume={volume} onOpen={onOpen}
    onTogglePlay={() => { if (audio.current?.paused) resume(); else pause(); }} onNext={next}
    onVolumeChange={value => { if (audio.current) { audio.current.volume = value; audio.current.muted = false; } setVolume(value); }}
    onStop={() => { wantsPlayback.current = false; onStop(); }} />, controlsTarget) : null}</>;
}
