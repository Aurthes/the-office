"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Disc3, Minimize2, Music2, RotateCw, X } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import "./listening-bar.css";

export const NETEASE_PLAYER_URL = "https://music.163.com/st/webplayer";

export function MusicPlayerDialog({ open = true, onClose }: { open?: boolean; onClose: () => void }) {
  const t = useUiText();
  const dialog = useRef<HTMLDialogElement>(null);
  const [player, setPlayer] = useState<"netease" | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
  }, [open]);
  const stop = () => { setPlayer(null); onClose(); };

  return <dialog ref={dialog} className={`music-dialog${player ? " music-dialog-player" : ""}`} aria-labelledby="music-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="music-surface">
      <header className="music-header">
        <div className="music-heading"><Disc3 size={22} /><div><span className="music-eyebrow">{t("Listening bar")}</span><h1 id="music-title">{player ? "网易云音乐" : t("Choose your player")}</h1></div></div>
        <div className="music-header-actions">
          {player ? <button type="button" className="music-icon-button" aria-label={t("Minimize music player")} title={t("Keep listening while using the office")} onClick={onClose}><Minimize2 size={18} /></button> : null}
          <button type="button" className="music-icon-button" aria-label={t(player ? "Stop and close music player" : "Close music player")} onClick={stop}><X size={20} /></button>
        </div>
      </header>
      {player ? <>
        <div className="music-player-tools">
          <button type="button" onClick={() => setPlayer(null)}><ArrowLeft size={15} />{t("Players")}</button>
          <span>{t("Minimize to keep listening. Click the turntable to return.")}</span>
          <button type="button" onClick={() => setReload(value => value + 1)} aria-label={t("Reload music player")}><RotateCw size={15} />{t("Reload")}</button>
        </div>
        <iframe key={reload} className="music-embedded-player" title="网易云音乐" src={NETEASE_PLAYER_URL} sandbox="allow-scripts allow-same-origin allow-forms" allow="autoplay; encrypted-media; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
      </> : <div className="music-chooser">
        <div className="music-record-art" aria-hidden="true"><div className="music-vinyl"><span>33⅓</span></div><div className="music-arm" /></div>
        <p className="music-intro">{t("Pick a player. Set the mood.")}</p>
        <button type="button" className="music-provider" onClick={() => setPlayer("netease")}>
          <span className="music-provider-icon"><Music2 size={29} /></span>
          <span className="music-provider-name"><strong>网易云音乐</strong><small>{t("NetEase Cloud Music")}</small></span>
          <span className="music-provider-open">{t("Open player")}<ArrowRight size={17} /></span>
        </button>
        <p className="music-footnote">{t("The full music player opens inside the office.")}</p>
      </div>}
    </div>
  </dialog>;
}
