"use client";

import { useEffect, useRef } from "react";
import { ArrowUpRight, Disc3, Music2, X } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import "./listening-bar.css";

export const NETEASE_PLAYER_URL = "https://music.163.com/st/webplayer";

export function MusicPlayerDialog({ onClose }: { onClose: () => void }) {
  const t = useUiText();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="music-dialog" aria-labelledby="music-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="music-surface">
      <header className="music-header">
        <div className="music-heading"><Disc3 size={22} /><div><span className="music-eyebrow">{t("Listening bar")}</span><h1 id="music-title">{t("Choose your player")}</h1></div></div>
        <button type="button" className="music-icon-button" aria-label={t("Close music player")} onClick={onClose}><X size={20} /></button>
      </header>
      <div className="music-chooser">
        <div className="music-record-art" aria-hidden="true"><div className="music-vinyl"><span>33⅓</span></div><div className="music-arm" /></div>
        <p className="music-intro">{t("Pick a player. Set the mood.")}</p>
        <a className="music-provider" href={NETEASE_PLAYER_URL} target="_blank" rel="noopener noreferrer">
          <span className="music-provider-icon"><Music2 size={29} /></span>
          <span className="music-provider-name"><strong>网易云音乐</strong><small>{t("NetEase Cloud Music")}</small></span>
          <span className="music-provider-open">{t("Open player")}<ArrowUpRight size={17} /></span>
        </a>
        <p className="music-footnote">{t("Opens the official player in a new browser tab.")}</p>
      </div>
    </div>
  </dialog>;
}
