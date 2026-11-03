"use client";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { TerminalSquare, X } from "lucide-react";
import { SessionTerminal } from "@/features/office/components/SessionTerminal";
import { useUiText } from "@/lib/i18n/ui-language";
import { createServerTerminalClient } from "./serverTerminalClient";

export function ServerTerminal({ alias, onClose }: { alias: string; onClose: () => void }) {
  const t = useUiText(), dialog = useRef<HTMLDialogElement>(null);
  const client = useMemo(() => createServerTerminalClient(alias), [alias]);
  useEffect(() => { void client.open().catch(() => {}); return () => client.close(); }, [client]);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return createPortal(<dialog ref={dialog} className="monitor-dialog" aria-label={t("Server terminal: {host}", { host: alias })} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="monitor-frame">
      <header className="monitor-header"><div className="monitor-title"><span><TerminalSquare size={14} />{t("Terminal")}</span><h1>{alias}</h1></div><button type="button" className="monitor-icon-button" aria-label={t("Close terminal")} onClick={onClose}><X size={19} /></button></header>
      <SessionTerminal client={client} threadId={alias} label={alias} autoFocus />
      <footer className="monitor-frame-footer"><span>{t("Closing this panel disconnects this terminal.")}</span></footer>
    </div>
  </dialog>, document.body);
}
