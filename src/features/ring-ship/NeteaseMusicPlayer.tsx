"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, Play, Search } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";

const API = "/api/music/netease";
type Connection = { configured: boolean; authorized: boolean };
type Song = { id: string; name: string; artists: string; album: string; playable: boolean };
type Track = { url: string; preview: { start: number; end: number } | null };
type Login = { state: string; url: string; qrCode: string; expiresAt: number };
async function request<T>(url: string, signal: AbortSignal, method = "GET"): Promise<T> {
  const response = await fetch(url, { method, signal, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "Music service is unavailable. Please retry."), { code: result.code });
  return result;
}

export function NeteaseMusicPlayer() {
  const t = useUiText();
  const audio = useRef<HTMLAudioElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [selected, setSelected] = useState<Song | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [login, setLogin] = useState<Login | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playHint, setPlayHint] = useState(false);
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
    return () => { activeRequest.current?.abort(); element?.pause(); element?.removeAttribute("src"); element?.load(); };
  }, []);
  useEffect(() => {
    if (!track || !audio.current) return;
    void audio.current.play().catch(() => setPlayHint(true));
  }, [track]);
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
    void perform(async signal => { const result = await request<{ songs: Song[] }>(API + "?action=search&query=" + encodeURIComponent(query.trim()), signal); setSongs(result.songs); });
  };
  const play = (song: Song) => void perform(async signal => {
    const result = await request<Track>(API + "?action=track&id=" + encodeURIComponent(song.id), signal);
    setPlayHint(false); setSelected(song); setTrack(result);
  });
  const signIn = () => void perform(async signal => setLogin(await request<Login>(API, signal, "POST")));
  const keepPreviewRange = () => {
    const element = audio.current, preview = track?.preview;
    if (!element || !preview) return;
    if (element.currentTime < preview.start || element.currentTime > preview.end) element.currentTime = preview.start;
  };

  return <section className="music-netease-player" aria-label={t("NetEase Cloud Music")} aria-busy={busy}>
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
        <form className="music-search" onSubmit={search}>
          <label className="sr-only" htmlFor="netease-search">{t("Search songs or artists")}</label>
          <input id="netease-search" type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search songs or artists")} />
          <button type="submit" className="music-action" disabled={busy || !query.trim()}><Search size={16} />{t("Search")}</button>
        </form>
        <div className="music-results">
          {songs === null ? <p className="music-empty">{t("Find a song to set the mood.")}</p> : songs.length === 0 ? <p className="music-empty">{t("No songs found.")}</p> : <ul>
            {songs.map(song => <li key={song.id}><button type="button" className="music-song" data-selected={selected?.id === song.id} disabled={busy || !song.playable} aria-label={t("Play {song}", { song: song.name })} onClick={() => play(song)}>
              <Play size={16} aria-hidden="true" /><span><strong>{song.name}</strong><small>{[song.artists, song.album].filter(Boolean).join(" · ")}</small></span>
              {!song.playable ? <small>{t("Unavailable")}</small> : null}
            </button></li>)}
          </ul>}
        </div>
      </>}
    <footer className="music-now-playing" hidden={!track}>
      <div><strong>{selected?.name}</strong><small>{selected?.artists}{track?.preview ? " · " + t("Preview · {seconds}s", { seconds: track.preview.end - track.preview.start }) : ""}</small></div>
      <audio ref={audio} controls preload="metadata" src={track?.url} aria-label={t("Music playback")}
        onLoadedMetadata={keepPreviewRange} onSeeking={keepPreviewRange}
        onPlay={() => { setPlayHint(false); if (track?.preview && audio.current && audio.current.currentTime >= track.preview.end) audio.current.currentTime = track.preview.start; }}
        onTimeUpdate={() => { if (track?.preview && audio.current && audio.current.currentTime >= track.preview.end) audio.current.pause(); }}
        onError={() => { if (track) setError("This song could not be played. Select it again to retry."); }} />
      {playHint ? <p role="status">{t("Press play to start listening.")}</p> : null}
    </footer>
  </section>;
}
