"use client";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Pause, Play, RotateCw, Search, SkipForward, Square, Volume2 } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";

const API = "/api/music/netease";
type Connection = { configured: boolean; authorized: boolean };
type Song = { id: string; name: string; artists: string; album: string; playable: boolean };
type Track = { url: string; preview: { start: number; end: number } | null };
type Login = { state: string; url: string; qrCode: string; expiresAt: number };
type Source = "scene" | "daily" | "search";
type Collection = { songs: Song[]; playlists: { id: string; name: string }[] };
type Queue = { songs: Song[]; source: Source; scene: string; batch: number };
async function request<T>(url: string, signal: AbortSignal, method = "GET"): Promise<T> {
  const response = await fetch(url, { method, signal, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "Music service is unavailable. Please retry."), { code: result.code, status: response.status });
  return result;
}

export function NeteaseMusicPlayer({ autoPlay, scene, sceneName, controlsTarget, minimized, onOpen, onStop }: {
  autoPlay: boolean; scene: string; sceneName: string; controlsTarget: HTMLElement | null; minimized: boolean; onOpen: () => void; onStop: () => void;
}) {
  const t = useUiText();
  const audio = useRef<HTMLAudioElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const playRequest = useRef<AbortController | null>(null);
  const queue = useRef<Queue>({ songs: [], source: "scene", scene, batch: 0 });
  const wantsPlayback = useRef(false), switchingTrack = useRef(false);
  const started = useRef(false);
  const failedSongs = useRef(new Set<string>());
  const [connection, setConnection] = useState<Connection | null>(null);
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [playlists, setPlaylists] = useState<Collection["playlists"]>([]);
  const [source, setSource] = useState<Source>("scene");
  const [batch, setBatch] = useState(0);
  const [selected, setSelected] = useState<Song | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [login, setLogin] = useState<Login | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playHint, setPlayHint] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const failed = (cause: unknown) => {
    const failure = cause as { name?: string; message?: string; code?: string };
    if (failure.name === "AbortError") return;
    setError(failure.message || "Music service is unavailable. Please retry.");
    if (failure.code === "AUTH_REQUIRED") setConnection({ configured: true, authorized: false });
  };
  useEffect(() => {
    const controller = new AbortController(); activeRequest.current = controller;
    request<Connection>(API, controller.signal).then(setConnection).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    const element = audio.current;
    return () => { wantsPlayback.current = false; activeRequest.current?.abort(); playRequest.current?.abort(); element?.pause(); element?.removeAttribute("src"); element?.load(); };
  }, []);
  useEffect(() => {
    if (!track || !audio.current || !wantsPlayback.current) return;
    void audio.current.play().catch(cause => { if (cause.name !== "AbortError" && wantsPlayback.current) setPlayHint(true); });
  }, [track]);
  useEffect(() => {
    if (!playHint) return;
    const retry = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".music-mini, .music-dialog")) return;
      if (wantsPlayback.current && audio.current?.paused) void audio.current.play().catch(() => {});
    };
    document.addEventListener("click", retry); document.addEventListener("keydown", retry);
    return () => { document.removeEventListener("click", retry); document.removeEventListener("keydown", retry); };
  }, [playHint]);
  useEffect(() => {
    if (!connection?.authorized || source === "search") return;
    const controller = new AbortController();
    request<Collection>(API + "?action=recommendations&scene=" + encodeURIComponent(scene) + "&source=" + source + "&batch=" + batch, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setSongs(result.songs); setPlaylists(result.playlists); startOnLoad(result.songs); } })
      .catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setSongs([]); if (cause.code === "AUTH_REQUIRED") setConnection({ configured: true, authorized: false }); } });
    return () => controller.abort();
  }, [connection?.authorized, source, scene, batch]);
  useEffect(() => {
    if (!login || !["waiting", "confirm"].includes(login.state)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      request<{ state: string }>(API + "?action=login", controller.signal).then(result => {
        if (result.state === "authorized") { setConnection({ configured: true, authorized: true }); setLogin(null); setError(""); }
        else setLogin(value => value ? { ...value, state: result.state } : null);
      }).catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setLogin(value => value ? { ...value, state: "failed" } : null); } });
    }, 2500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [login]);
  const perform = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (busy) return;
    activeRequest.current?.abort();
    const controller = new AbortController(); activeRequest.current = controller;
    setBusy(true); setError("");
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) failed(cause); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSource("search"); setPlaylists([]);
    void perform(async signal => { const result = await request<{ songs: Song[] }>(API + "?action=search&query=" + encodeURIComponent(query.trim()), signal); setSongs(result.songs); });
  };
  const more = async (current: Queue, signal: AbortSignal): Promise<Queue> => {
    const nextSource = current.source === "daily" ? "daily" : "scene";
    const nextBatch = current.scene === scene ? current.batch + 1 : 0;
    const result = await request<Collection>(API + "?action=recommendations&scene=" + encodeURIComponent(scene) + "&source=" + nextSource + "&batch=" + nextBatch, signal);
    if (source === nextSource) { setSongs(result.songs); setPlaylists(result.playlists); }
    return { songs: [...result.songs.filter(song => song.id !== selected?.id), ...result.songs.filter(song => song.id === selected?.id)], source: nextSource, scene, batch: nextBatch };
  };
  const startAt = async (current: Queue, start: number) => {
    playRequest.current?.abort();
    const controller = new AbortController(); playRequest.current = controller;
    setLoadingTrack(true); setError("");
    try {
      // Try the current queue, then one fresh collection. Never spin on an empty or restricted catalog.
      for (let pass = 0; pass < 2; pass++) {
        for (const song of current.songs.slice(start).filter(item => item.playable && !failedSongs.current.has(item.id))) {
          try {
            const result = await request<Track>(API + "?action=track&id=" + encodeURIComponent(song.id) + (current.source === "scene" ? "&instrumental=1" : ""), controller.signal);
            if (controller.signal.aborted || !wantsPlayback.current) return;
            switchingTrack.current = true; queue.current = current;
            setPlayHint(false); setSelected(song); setTrack(result); return;
          } catch (cause) {
            if (!["TRACK_UNAVAILABLE", "NOT_INSTRUMENTAL"].includes((cause as { code?: string }).code || "")) throw cause;
            failedSongs.current.add(song.id);
          }
        }
        if (pass === 0) { current = await more(current, controller.signal); start = 0; }
      }
      throw new Error("No playable tracks were found. Try another mix.");
    } catch (cause) { if (!controller.signal.aborted) { wantsPlayback.current = false; switchingTrack.current = false; failed(cause); } }
    finally { if (playRequest.current === controller) { playRequest.current = null; setLoadingTrack(false); } }
  };
  const play = (song: Song) => {
    started.current = true; failedSongs.current.clear(); wantsPlayback.current = true;
    const current = { songs: songs || [song], source, scene, batch };
    void startAt(current, Math.max(0, current.songs.findIndex(item => item.id === song.id)));
  };
  const startOnLoad = useEffectEvent((recommendations: Song[]) => {
    if (!autoPlay || started.current || source !== "scene") return;
    const first = recommendations.find(song => song.playable);
    if (!first) return;
    started.current = true; wantsPlayback.current = true;
    void startAt({ songs: recommendations, source, scene, batch }, recommendations.indexOf(first));
  });
  const next = async (manual = false) => {
    if (playRequest.current || (!manual && !wantsPlayback.current)) return;
    wantsPlayback.current = true;
    if (queue.current.source === "scene" && queue.current.scene !== scene) {
      // startAt fetches the new scene before choosing another song.
      await startAt({ ...queue.current, songs: [] }, 0);
    } else await startAt(queue.current, queue.current.songs.findIndex(song => song.id === selected?.id) + 1);
  };
  const pause = () => { wantsPlayback.current = false; setPlayHint(false); playRequest.current?.abort(); audio.current?.pause(); };
  const resume = () => { wantsPlayback.current = true; if (audio.current) void audio.current.play().catch(cause => { if (cause.name !== "AbortError" && wantsPlayback.current) setPlayHint(true); }); };
  const signIn = () => void perform(async signal => setLogin(await request<Login>(API, signal, "POST")));
  const keepPreviewRange = () => {
    const element = audio.current, preview = track?.preview;
    if (!element || !preview) return;
    if (element.currentTime < preview.start || element.currentTime > preview.end) element.currentTime = preview.start;
  };

  return <><section className="music-netease-player" aria-label={t("NetEase Cloud Music")} aria-busy={busy}>
    {error ? <p className="music-notice" role="alert">{t(error)}</p> : null}
    {!connection ? <p className="music-empty" role="status">{t("Connecting to NetEase…")}</p>
      : !connection.configured ? <p className="music-empty">{t("NetEase developer credentials are not configured.")}</p>
      : !connection.authorized ? <div className="music-login">
        <p>{t("Sign in to NetEase to listen.")}</p>
        {login && ["waiting", "confirm"].includes(login.state) ? <>
          {/* This QR is generated by our server, without a third-party image service. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={login.qrCode} width={224} height={224} alt={t("NetEase sign-in QR code")} />
          <p role="status">{t(login.state === "confirm" ? "Confirm sign-in in the NetEase app." : "Scan with the NetEase app, or open the sign-in link on this phone.")}</p>
          <a className="music-action" href={login.url} target="_blank" rel="noopener noreferrer">{t("Authorize in NetEase")}<ExternalLink size={14} /></a>
        </> : <>
          {login?.state === "expired" ? <p role="status">{t("The sign-in code expired. Get a new one.")}</p> : null}
          <button type="button" className="music-action" onClick={signIn} disabled={busy}>{t(busy ? "Connecting…" : "Sign in to NetEase")}</button>
        </>}
      </div> : <>
        <div className="music-discovery">
          <div className="music-discovery-actions">
            <button type="button" className="music-action" aria-pressed={source === "scene"} onClick={() => { setSource("scene"); setSongs(null); setError(""); setBatch(value => value + 1); }}>{t("Scene music")}</button>
            <button type="button" className="music-action" aria-pressed={source === "daily"} onClick={() => { setSource("daily"); setSongs(null); setError(""); setBatch(value => value + 1); }}>{t("Daily recommendations")}</button>
            <button type="button" className="music-action" disabled={!songs?.some(song => song.playable) || loadingTrack} onClick={() => { const first = songs?.find(song => song.playable); if (first) play(first); }}><Play size={15} />{t("Play mix")}</button>
            {source !== "search" ? <button type="button" className="music-icon-button" aria-label={t("Refresh recommendations")} onClick={() => { setSongs(null); setError(""); setBatch(value => value + 1); }}><RotateCw size={16} /></button> : null}
          </div>
          {source === "scene" ? <><strong>{t("Soundtrack for {scene}", { scene: t(sceneName) })}</strong><p>{t("Instrumental · Ambient soundscapes · Continuous playback")}</p></> : null}
          {playlists.length ? <p>{t("From playlists: {names}", { names: playlists.map(list => list.name).join(" · ") })}</p> : null}
        </div>
        <form className="music-search" onSubmit={search}>
          <label className="sr-only" htmlFor="netease-search">{t("Search songs or artists")}</label>
          <input id="netease-search" type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search songs or artists")} />
          <button type="submit" className="music-action" disabled={busy || !query.trim()}><Search size={16} />{t("Search")}</button>
        </form>
        <div className="music-results">
          {songs?.some(song => !song.playable) ? <p className="music-availability">{t("Availability can differ from the NetEase app.")}</p> : null}
          {songs === null ? <p className="music-empty" role="status">{t("Finding music for you…")}</p> : songs.length === 0 ? <p className="music-empty">{t(source === "search" ? "No songs found." : "No playable tracks were found. Try another mix.")}</p> : <ul>
            {songs.map(song => <li key={song.id}><button type="button" className="music-song" data-selected={selected?.id === song.id} disabled={busy || loadingTrack || !song.playable} aria-label={t("Play {song}", { song: song.name })} onClick={() => play(song)}>
              <Play size={16} aria-hidden="true" /><span><strong>{song.name}</strong><small>{[song.artists, song.album].filter(Boolean).join(" · ")}</small></span>
              {!song.playable ? <small>{t("Unavailable here")}</small> : null}
            </button></li>)}
          </ul>}
        </div>
      </>}
    <footer className="music-now-playing" hidden={!track}>
      <div className="music-track-heading"><div><strong>{selected?.name}</strong><small>{selected?.artists}{track?.preview ? " · " + t("Preview · {seconds}s", { seconds: track.preview.end - track.preview.start }) : ""}</small></div><button type="button" className="music-icon-button" aria-label={t("Next track")} disabled={loadingTrack} onClick={() => { void next(true); }}><SkipForward size={18} /></button></div>
      <audio ref={audio} controls preload="metadata" src={track?.url} aria-label={t("Music playback")}
        onLoadedMetadata={() => { switchingTrack.current = false; keepPreviewRange(); }} onSeeking={keepPreviewRange}
        onPlay={() => { switchingTrack.current = false; wantsPlayback.current = true; setPlaying(true); setPlayHint(false); if (track?.preview && audio.current && audio.current.currentTime >= track.preview.end) audio.current.currentTime = track.preview.start; }}
        onPause={() => { setPlaying(false); if (!switchingTrack.current && audio.current && !audio.current.ended) { wantsPlayback.current = false; playRequest.current?.abort(); } }}
        onEnded={() => { setPlaying(false); void next(); }}
        onVolumeChange={() => { if (audio.current) setVolume(audio.current.muted ? 0 : audio.current.volume); }}
        onTimeUpdate={() => { if (track?.preview && audio.current && audio.current.currentTime >= track.preview.end && !switchingTrack.current) { switchingTrack.current = true; audio.current.pause(); void next(); } }}
        onError={() => { setPlaying(false); if (track && selected) { failedSongs.current.add(selected.id); void next(); } }} />
      {playHint ? <p role="status">{t("Press play to start listening.")}</p> : null}
    </footer>
  </section>
    {controlsTarget && minimized && track && selected ? createPortal(<section className="music-mini" aria-label={t("Background music")}>
      <button type="button" className="music-mini-track" onClick={onOpen} aria-label={t("Open music player")} title={t("Open music player")}>
        <span><strong>{selected.name}</strong><small role={playHint ? "status" : undefined}>{playHint ? t("Tap to start music") : selected.artists}</small></span>
      </button>
      <button type="button" className="music-mini-button" aria-label={t(playing ? "Pause music" : "Resume music")} onClick={() => {
        if (!audio.current) return;
        if (audio.current.paused) resume(); else pause();
      }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <button type="button" className="music-mini-button" aria-label={t("Next track")} disabled={loadingTrack} onClick={() => { void next(true); }}><SkipForward size={16} /></button>
      <div className="music-mini-volume">
        <button type="button" className="music-mini-button" aria-label={t("Music volume")} aria-expanded={volumeOpen} onClick={() => setVolumeOpen(value => !value)}><Volume2 size={16} /></button>
        {volumeOpen ? <label className="music-mini-volume-popover"><input type="range" aria-label={t("Music volume")} min="0" max="1" step="0.01" value={volume} onChange={event => {
          const next = Number(event.target.value);
          if (audio.current) { audio.current.volume = next; audio.current.muted = false; }
          setVolume(next);
        }} /></label> : null}
      </div>
      <button type="button" className="music-mini-button" aria-label={t("Stop music")} onClick={() => { wantsPlayback.current = false; onStop(); }}><Square size={15} /></button>
    </section>, controlsTarget) : null}
  </>;
}
