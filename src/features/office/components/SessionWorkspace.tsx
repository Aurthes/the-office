"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUp, ExternalLink, File, Files, Folder, Globe, Image, RefreshCw, Terminal, X } from "lucide-react";
import type { SessionAsset, SessionClient } from "./SessionControls";
import { SessionAssetPreview } from "./SessionMarkdown";
import { useUiText } from "@/lib/i18n/ui-language";

const SessionTerminal = dynamic(() => import("./SessionTerminal").then(module => module.SessionTerminal), { ssr: false });
type Listing = { path: string; entries: { name: string; directory: boolean }[]; truncated: boolean };
type FileRead = { path: string; content?: string; asset?: SessionAsset };
type Tab = "files" | "preview" | "terminal" | "browser";

export function SessionWorkspace({ client, threadId, asset, assets, onSelectAsset, onClose, terminalAvailable = true }: {
  client: SessionClient; threadId: string; asset: SessionAsset | null; assets: SessionAsset[];
  onSelectAsset: (asset: SessionAsset | null) => void; onClose: () => void; terminalAvailable?: boolean;
}) {
  const t = useUiText();
  const [tab, setTab] = useState<Tab>(asset ? "preview" : "files");
  const [listing, setListing] = useState<Listing | null>(null);
  const [file, setFile] = useState<FileRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { if (asset) setTab("preview"); }, [asset]);
  const list = useCallback(async (path = "") => {
    const id = ++request.current; setBusy(true); setError("");
    try { const result = await client.call("session.workspace.list", { threadId, path }) as Listing; if (id === request.current) setListing(result); }
    catch (cause) { if (id === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (id === request.current) setBusy(false); }
  }, [client, threadId]);
  useEffect(() => { if (tab === "files" && !listing) void list(); }, [tab, listing, list]);
  const read = async (path: string) => {
    const id = ++request.current; setBusy(true); setError("");
    try {
      const result = await client.call("session.workspace.read", { threadId, path }) as FileRead;
      if (id !== request.current) return;
      setFile(result); onSelectAsset(result.asset || null); setTab("preview");
    } catch (cause) { if (id === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (id === request.current) setBusy(false); }
  };
  const tabs = ([["files", Files, "Files"], ["preview", Image, "Preview"], ["terminal", Terminal, "Terminal"], ["browser", Globe, "Browser"]] as const).filter(([key]) => terminalAvailable || key !== "terminal");
  return <aside className="session-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label={t("Session workspace")}>
    <div className="session-workspace-tabs" role="tablist" aria-label={t("Workspace views")} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const current = tabs.findIndex(([key]) => key === tab);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      setError(""); setTab(tabs[next][0]); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>
      {tabs.map(([key, Icon, label]) => <button key={key} type="button" role="tab" title={t(label)} tabIndex={tab === key ? 0 : -1} id={`workspace-tab-${key}`} aria-controls={`workspace-panel-${key}`} aria-selected={tab === key} onClick={() => { setError(""); setTab(key); }}><Icon size={15} aria-hidden="true" /><span>{t(label)}</span></button>)}
      <button className="ml-auto" type="button" aria-label={t("Close workspace")} title={t("Back to chat")} onClick={onClose}><X size={16} /></button>
    </div>
    {error ? <p role="alert" className="px-4 py-3 text-xs text-amber-200">{t(error)}</p> : null}
    <div role="tabpanel" id={`workspace-panel-${tab}`} aria-labelledby={`workspace-tab-${tab}`} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {tab === "files" ? <>
        <div className="session-workspace-toolbar">
          <button type="button" disabled={!listing?.path || busy} aria-label={t("Parent folder")} onClick={() => void list(listing?.path.split("/").slice(0, -1).join("/"))}><ArrowUp size={15} /></button>
          <span className="min-w-0 flex-1 truncate text-xs text-white/55" title={listing?.path}>{listing?.path || t("Project files")}</span>
          <button type="button" disabled={busy} aria-label={t("Refresh files")} onClick={() => void list(listing?.path)}><RefreshCw size={14} /></button>
        </div>
        <div className="session-workspace-files min-h-0 flex-1 overflow-auto p-2" aria-busy={busy}>
          {busy ? <p role="status" className="p-3 text-xs text-white/50">{t("Loading files…")}</p> : listing?.entries.map(entry => <button key={entry.name} type="button" onClick={() => {
            const path = [listing.path, entry.name].filter(Boolean).join("/");
            if (entry.directory) void list(path); else void read(path);
          }}>{entry.directory ? <Folder size={15} className="text-[#c9b58e]" /> : <File size={15} className="text-white/45" />}<span className="truncate">{entry.name}</span></button>)}
          {!busy && listing?.entries.length === 0 ? <p className="p-3 text-xs text-white/50">{t("This folder is empty.")}</p> : null}
          {listing?.truncated ? <p className="p-3 text-xs text-white/45">{t("Showing the first 300 entries.")}</p> : null}
        </div>
      </> : tab === "terminal" ? <SessionTerminal client={client} threadId={threadId} /> : tab === "browser" ? <div className="flex flex-1 flex-col items-start justify-center gap-4 p-6">
        <Globe size={28} className="text-[#c9b58e]" />
        <h3 className="text-sm font-medium">{t("Use the original Codex browser")}</h3>
        <p className="text-sm leading-6 text-white/55">{t("Open this chat in Codex, then use its browser tabs. Your existing pages and sign-ins stay there.")}</p>
        <a className="session-workspace-link" href={`codex://threads/${encodeURIComponent(threadId)}`}><ExternalLink size={15} />{t("Open in Codex")}</a>
      </div> : asset ? <SessionAssetPreview key={asset.url} asset={asset} embedded onClose={() => { onSelectAsset(null); setFile(null); setTab("files"); }} /> : file?.content !== undefined ? <>
        <div className="session-workspace-toolbar"><span className="min-w-0 flex-1 truncate text-xs text-white/55" title={file.path}>{file.path}</span><button type="button" disabled={busy} aria-label={t("Reload file")} onClick={() => void read(file.path)}><RefreshCw size={14} /></button></div>
        <pre className="m-0 min-h-0 flex-1 overflow-auto p-4 text-xs leading-6 text-white/80"><code>{file.content}</code></pre>
      </> : <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="mb-3 text-xs text-white/50">{t("Select a chat attachment or a project file to preview.")}</p>
        <div className="session-workspace-files">{assets.map(item => <button key={item.url} type="button" onClick={() => onSelectAsset(item)}><File size={15} /><span className="truncate">{item.name}</span></button>)}</div>
      </div>}
    </div>
  </aside>;
}
