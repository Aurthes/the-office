"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Disc3, Music2, RotateCw, X } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { NeteaseMusicPlayer } from "./NeteaseMusicPlayer";
import "./listening-bar.css";

export function MusicPlayerDialog({ open = true, autoPlay = false, scene = "deep-space", sceneName = "Quiet Anchorage", onOpen, onClose }: { open?: boolean; autoPlay?: boolean; scene?: string; sceneName?: string; onOpen: () => void; onClose: () => void }) {
  const t = useUiText();
  const dialog = useRef<HTMLDialogElement>(null);
  const [player, setPlayer] = useState<"netease" | null>(() => autoPlay ? "netease" : null);
  const [reload, setReload] = useState(0);
  // A closed native dialog hides its descendants, so the floating controls live beside it.
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
  }, [open]);
  const stop = () => { setPlayer(null); onClose(); };

  return <><dialog ref={dialog} className={`music-dialog${player ? " music-dialog-player" : ""}`} aria-labelledby="music-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="music-surface">
      <header className="music-header">
        <div className="music-heading"><Disc3 size={22} /><div><span className="music-eyebrow">{t("Listening bar")}</span><h1 id="music-title">{player ? "网易云音乐" : t("Choose your player")}</h1></div></div>
        <button type="button" className="music-icon-button" aria-label={t("Close music player")} title={t("Closing the panel keeps the music playing.")} onClick={onClose}><X size={20} /></button>
      </header>
      {player ? <>
        <div className="music-player-tools">
          <button type="button" onClick={() => setPlayer(null)}><ArrowLeft size={15} />{t("Players")}</button>
          <span>{t("Closing the panel keeps the music playing.")}</span>
          <button type="button" onClick={() => setReload(value => value + 1)} aria-label={t("Reload music player")}><RotateCw size={15} />{t("Reload")}</button>
        </div>
        <NeteaseMusicPlayer key={reload} autoPlay={autoPlay} scene={scene} sceneName={sceneName} controlsTarget={controlsTarget} minimized={!open} onOpen={onOpen} onStop={stop} />
      </> : <div className="music-chooser">
        <div className="music-record-art" aria-hidden="true"><div className="music-vinyl"><span>33⅓</span></div><div className="music-arm" /></div>
        <p className="music-intro">{t("Pick a player. Set the mood.")}</p>
        <button type="button" className="music-provider" onClick={() => setPlayer("netease")}>
          <span className="music-provider-icon"><Music2 size={29} /></span>
          <span className="music-provider-name"><strong>网易云音乐</strong><small>{t("NetEase Cloud Music")}</small></span>
          <span className="music-provider-open">{t("Open player")}<ArrowRight size={17} /></span>
        </button>
        <p className="music-footnote">{t("Search and listen without leaving the office.")}</p>
      </div>}
    </div>
  </dialog><div className="music-controls-anchor" ref={setControlsTarget} /></>;
}
