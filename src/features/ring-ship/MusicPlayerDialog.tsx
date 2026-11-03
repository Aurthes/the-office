"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, Disc3, Music2, RotateCw, X } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { NeteaseMusicPlayer } from "./NeteaseMusicPlayer";
import { LocalMusicPlayer } from "./LocalMusicPlayer";
import "./listening-bar.css";

type Provider = "netease" | "local";
export const MUSIC_PROVIDER_KEY = "claw3d:music:provider";
const subscribe = () => () => {};
function savedProvider(): Provider { try { return localStorage.getItem(MUSIC_PROVIDER_KEY) === "local" ? "local" : "netease"; } catch { return "netease"; } }

export function MusicPlayerDialog({ open = true, autoPlay = false, scene = "deep-space", sceneName = "Quiet Anchorage", onOpen, onClose }: { open?: boolean; autoPlay?: boolean; scene?: string; sceneName?: string; onOpen: () => void; onClose: () => void }) {
  const t = useUiText();
  const dialog = useRef<HTMLDialogElement>(null);
  const preferred = useSyncExternalStore<Provider | null>(subscribe, savedProvider, () => null);
  const [choice, setPlayer] = useState<Provider | null | undefined>();
  const player = choice === undefined ? (autoPlay ? preferred : null) : choice;
  const [reload, setReload] = useState(0);
  // A closed native dialog hides its descendants, so the floating controls live beside it.
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
  }, [open]);
  const stop = () => { setPlayer(null); onClose(); };
  const choose = (provider: Provider) => { setPlayer(provider); try { localStorage.setItem(MUSIC_PROVIDER_KEY, provider); } catch { /* Playback works without storage. */ } };

  return <><dialog ref={dialog} className={`music-dialog${player ? " music-dialog-player" : ""}`} aria-labelledby="music-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="music-surface">
      <header className="music-header">
        <div className="music-heading"><Disc3 size={22} /><div><span className="music-eyebrow">{t("Listening bar")}</span><h1 id="music-title">{player === "netease" ? "网易云音乐" : player === "local" ? t("Local music") : t("Choose your player")}</h1></div></div>
        <button type="button" className="music-icon-button" aria-label={t("Close music player")} title={t("Closing the panel keeps the music playing.")} onClick={onClose}><X size={20} /></button>
      </header>
      {player ? <>
        <div className="music-player-tools">
          <button type="button" onClick={() => setPlayer(null)}><ArrowLeft size={15} />{t("Players")}</button>
          <span>{t("Closing the panel keeps the music playing.")}</span>
          <button type="button" onClick={() => setReload(value => value + 1)} aria-label={t("Reload music player")}><RotateCw size={15} />{t("Reload")}</button>
        </div>
        {player === "netease" ? <NeteaseMusicPlayer key={reload} autoPlay={autoPlay} scene={scene} sceneName={sceneName} controlsTarget={controlsTarget} minimized={!open} onOpen={onOpen} onStop={stop} />
          : <LocalMusicPlayer key={reload} autoPlay={autoPlay} scene={scene} sceneName={sceneName} controlsTarget={controlsTarget} minimized={!open} onOpen={onOpen} onStop={stop} />}
      </> : <div className="music-chooser">
        <div className="music-record-art" aria-hidden="true"><div className="music-vinyl"><span>33⅓</span></div><div className="music-arm" /></div>
        <p className="music-intro">{t("Pick a player. Set the mood.")}</p>
        <button type="button" className="music-provider" onClick={() => choose("netease")}>
          <span className="music-provider-icon"><Music2 size={29} /></span>
          <span className="music-provider-name"><strong>网易云音乐</strong><small>{t("NetEase Cloud Music")}</small></span>
          <span className="music-provider-open">{t("Open player")}<ArrowRight size={17} /></span>
        </button>
        <button type="button" className="music-provider" onClick={() => choose("local")}>
          <span className="music-provider-icon"><Disc3 size={29} /></span>
          <span className="music-provider-name"><strong>{t("Local music")}</strong><small>{t("Local library · No sign-in needed")}</small></span>
          <span className="music-provider-open">{t("Open player")}<ArrowRight size={17} /></span>
        </button>
        <p className="music-footnote">{t("Choose your music source.")}</p>
      </div>}
    </div>
  </dialog><div className="music-controls-anchor" ref={setControlsTarget} /></>;
}
