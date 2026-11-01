"use client";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRightLeft, ArrowLeft, ChevronRight, ExternalLink, LogOut, MoreHorizontal, PanelRight, SlidersHorizontal, PencilLine, UserRound } from "lucide-react";
import type { CharacterMode } from "@/features/ring-ship/DuckCharacterPanel";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import type { CompanyProject } from "@/features/retro-office/core/companyLayout";
import type { SessionVoiceController } from "./useSessionVoice";
import { SessionControls, type LiveSessionItem, type SessionClient } from "./SessionControls";
import { SessionPreviewContext } from "./SessionPreviewContext";
import { SessionWorkspace } from "./SessionWorkspace";
import type { SessionAsset } from "./SessionControls";
import { SessionTranscript } from "./SessionTranscript";
import { useUiText } from "@/lib/i18n/ui-language";
import { OfficeCodexAccount } from "./OfficeCodexAccount";

export type SessionInspection = {
  id: string; name: string; workspace: string; project: string; projectId?: string | null;
  status: "running" | "idle" | "unknown";
  controlsAvailable?: boolean; model?: string | null; runtime?: string; terminalAvailable?: boolean;
};
function CharacterLoading() {
  const t = useUiText();
  return <p role="status" className="p-5 text-xs text-white/55">{t("Loading character…")}</p>;
}
const DuckCharacterPanel = dynamic(() => import("@/features/ring-ship/DuckCharacterPanel").then(module => module.DuckCharacterPanel), { ssr: false, loading: CharacterLoading });
type Message = LiveSessionItem;
type HistoryPage = { threadId: string; messages: Message[]; nextCursor: string | null };
type LoadMode = "latest" | "older";

export function ExistingSessionPanel({ client, threadId, onReturnToEarth, returnDisabled, avatarProfile, agentStatus, agentModel, onSaveCharacter, agentName, onSessionRenamed, onOpenWorkspace, headerStart, headerEnd, projects = [], voice }: {
  client: SessionClient;
  voice?: SessionVoiceController;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  onOpenWorkspace?: () => void;
  threadId: string;
  onReturnToEarth?: () => void;
  returnDisabled?: boolean;
  avatarProfile?: AgentAvatarProfile | null;
  agentStatus?: string;
  agentModel?: string | null;
  agentName?: string;
  onSessionRenamed?: (name: string) => void;
  onSaveCharacter?: (profile: AgentAvatarProfile) => Promise<void>;
  projects?: CompanyProject[];
}) {
  const t = useUiText();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<SessionAsset | null>(null);
  const openPreview = useCallback((asset: SessionAsset) => { setPreviewAsset(asset); setWorkspaceOpen(true); onOpenWorkspace?.(); }, [onOpenWorkspace]);
  const [characterMode, setCharacterMode] = useState<CharacterMode | "chat">("chat");
  const characterOpen = characterMode !== "chat";
  const [data, setData] = useState<SessionInspection | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLatest, setShowLatest] = useState(false);
  const [error, setError] = useState("");
  const [metadataError, setMetadataError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastTop = useRef(0);
  const touchY = useRef(0);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const load = useRef<((mode: LoadMode) => Promise<void>) | null>(null);
  const onHistorySync = useCallback(() => { void load.current?.("latest"); }, []);
  const failedMode = useRef<LoadMode>("latest");
  const liveItems = useRef(new Map<string, LiveSessionItem>());
  const onLiveItems = useCallback((items: LiveSessionItem[]) => {
    for (const item of items) liveItems.current.set(item.id, item);
    while (liveItems.current.size > 128) liveItems.current.delete(liveItems.current.keys().next().value!);
    setMessages(previous => {
      const next = [...previous];
      for (const item of items) {
        const index = next.findIndex(message => message.id === item.id);
        if (index < 0) next.push(item); else next[index] = { ...next[index], ...item };
      }
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node || !loaded) return;
    if (anchor.current) {
      node.scrollTop = anchor.current.top + node.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (follow.current) node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    lastTop.current = node.scrollTop;
    setShowLatest(node.scrollHeight - node.clientHeight - node.scrollTop > 60);
  }, [messages, loaded]);

  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!follow.current || !node.clientHeight || !node.clientWidth) return;
      node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      lastTop.current = node.scrollTop;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let stopped = false, busy = false, metadataBusy = false, reloadLatest = false;
    let cursor: string | null = null;
    setShowLatest(false);
    setData(null); setMessages([]); setOlderCursor(null); setLoaded(false); setError(""); setMetadataError("");
    follow.current = true; anchor.current = null; lastTop.current = 0;
    liveItems.current.clear();
    const readMetadata = async () => {
      if (metadataBusy || stopped) return;
      metadataBusy = true;
      try {
        const result = await client.call("session.inspect", { threadId, includeHistory: false }) as SessionInspection;
        if (!stopped) { setData(result); setMetadataError(""); }
      } catch (cause) {
        if (!stopped) setMetadataError(cause instanceof Error ? cause.message : "Could not read session information");
      } finally { metadataBusy = false; }
    };
    const readPage = async (mode: LoadMode) => {
      if (stopped || (mode === "older" && !cursor)) return;
      if (busy) { if (mode === "latest") reloadLatest = true; return; }
      busy = true; setLoading(true); failedMode.current = mode;
      const liveBeforeRead = new Set(liveItems.current.keys());
      const before = mode === "older" && scroll.current ? { height: scroll.current.scrollHeight, top: scroll.current.scrollTop } : null;
      try {
        const result = await client.call("session.history", { threadId, ...(mode === "older" ? { cursor } : {}) }) as HistoryPage;
        if (stopped) return;
        if (result.threadId !== threadId) throw new Error("Session history mismatch. Please retry.");
        anchor.current = before; follow.current = mode === "latest";
        setMessages(previous => {
          if (mode === "latest") {
            const ids = new Set(result.messages.map(message => message.id));
            return [...result.messages.map(message => {
              const live = liveItems.current.get(message.id);
              return live && (live.status === "completed" || live.content.length > message.content.length) ? { ...message, ...live } : message;
            }), ...[...liveItems.current.values()].filter(item => !ids.has(item.id) && !liveBeforeRead.has(item.id))];
          }
          const existing = new Set(previous.map(message => message.id));
          return [...result.messages.filter(message => !existing.has(message.id)), ...previous];
        });
        cursor = result.nextCursor;
        setOlderCursor(cursor); setLoaded(true); setError("");
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "Could not load this page");
      } finally {
        busy = false;
        if (!stopped) {
          setLoading(false);
          if (reloadLatest) { reloadLatest = false; void readPage("latest"); }
        }
      }
    };
    load.current = readPage;
    void readMetadata(); void readPage("latest");
    const unsubscribeRoster = client.onEvent?.(event => { if (event.event === "roster.updated") void readMetadata(); });
    let connected = true;
    const unsubscribeStatus = client.onStatus?.(status => {
      if (status === "connected" && !connected) { void readMetadata(); void readPage("latest"); }
      connected = status === "connected";
    });
    return () => { stopped = true; load.current = null; unsubscribeStatus?.(); unsubscribeRoster?.(); };
  }, [client, threadId]);

  const sessionName = agentName || data?.name || "";
  const rename = async (name: string) => {
    const result = await client.call("session.rename", { threadId, name, requestId: crypto.randomUUID() }) as { threadId: string; name: string };
    if (result.threadId !== threadId || result.name !== name) throw new Error(t("Session rename was not confirmed. Please retry."));
    setData(previous => previous?.id === threadId ? { ...previous, name: result.name } : previous);
    onSessionRenamed?.(result.name);
  };
  const reassign = async (projectId: string) => {
    const result = await client.call("session.reassign", { threadId, projectId, requestId: crypto.randomUUID() }) as { threadId: string; projectId: string; project: string };
    if (result.threadId !== threadId || result.projectId !== projectId) throw new Error(t("Reassignment was not confirmed. Check the current project before retrying."));
    setData(previous => previous?.id === threadId ? { ...previous, projectId, project: result.project } : previous);
  };
  const openCharacter = (event: React.MouseEvent, mode: CharacterMode) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
    setCharacterMode(mode);
  };
  return <SessionPreviewContext.Provider value={openPreview}><section className="session-panel flex min-h-0 min-w-0 flex-1 flex-col text-white" aria-label={t("Codex session")}>
    <header className="session-panel-header flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
      {headerStart}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold" title={sessionName}>{data?.id === threadId ? sessionName : t("Loading session information…")}</h2>
        {data?.id === threadId ? <p className="mt-1 truncate text-xs text-white/45">{data.project}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {characterOpen ? <button type="button" onClick={() => setCharacterMode("chat")} className="session-action-back"><ArrowLeft size={14} />{t("Back to chat")}</button> : null}
        {!characterOpen ? <button type="button" aria-label={t(workspaceOpen ? "Close workspace" : "Open workspace")} aria-expanded={workspaceOpen} title={t("Workspace")}
          disabled={!data?.controlsAvailable} className="session-action-back session-workspace-toggle" onClick={() => { setWorkspaceOpen(value => !value); if (!workspaceOpen) onOpenWorkspace?.(); }}><PanelRight size={15} /><span>{t("Workspace")}</span></button> : null}
        <details className="session-actions relative" aria-label={t("Session information")}>
          <summary aria-label={t("Session information")} className="session-actions-trigger"><MoreHorizontal size={18} aria-hidden="true" /></summary>
          <div className="session-actions-popover">
            <div className="session-actions-list">
            {onSaveCharacter ? <>
              <button type="button" disabled={!data} onClick={event => openCharacter(event, "view")} className="session-action session-action--view"><span className="session-action-icon"><UserRound size={16} aria-hidden="true" /></span><span className="session-action-label">{t("Character")}</span><ChevronRight className="session-action-chevron" size={14} aria-hidden="true" /></button>
              <button type="button" disabled={!data} onClick={event => openCharacter(event, "edit")} className="session-action session-action--edit"><span className="session-action-icon"><SlidersHorizontal size={16} aria-hidden="true" /></span><span className="session-action-label">{t("Edit character")}</span><ChevronRight className="session-action-chevron" size={14} aria-hidden="true" /></button>
              <button type="button" disabled={!data?.controlsAvailable} onClick={event => openCharacter(event, "rename")} className="session-action session-action--rename"><span className="session-action-icon"><PencilLine size={16} aria-hidden="true" /></span><span className="session-action-label">{t("Rename session")}</span><ChevronRight className="session-action-chevron" size={14} aria-hidden="true" /></button>
              <button type="button" disabled={!data?.controlsAvailable || !projects.length} onClick={event => openCharacter(event, "reassign")} className="session-action session-action--reassign"><span className="session-action-icon"><ArrowRightLeft size={16} aria-hidden="true" /></span><span className="session-action-label">{t("Reassign")}</span><ChevronRight className="session-action-chevron" size={14} aria-hidden="true" /></button>
            </> : null}
            {onReturnToEarth ? <button type="button" disabled={returnDisabled || !data?.controlsAvailable} onClick={onReturnToEarth}
              title={returnDisabled ? t("Stop the current task or wait for the previous return journey") : t("Archive this original session and keep its history")}
              className="session-action session-action--return"><span className="session-action-icon"><LogOut size={16} aria-hidden="true" /></span><span className="session-action-label">{t("Return to Earth (archive)")}</span><ChevronRight className="session-action-chevron" size={14} aria-hidden="true" /></button> : null}
            </div>
            {data?.runtime !== "office" ? <a href={`codex://threads/${encodeURIComponent(threadId)}`} className="session-actions-desktop"><ExternalLink size={14} aria-hidden="true" /><span>{t("Open session in desktop app ↗")}</span></a> : null}
            <div className="session-actions-meta">
            <p className="break-all">{t("Session ID")}: {threadId}</p>
            {data?.id === threadId ? <p className="break-all">{t("Directory:")} {data.workspace}</p> : null}
            <p>{data?.runtime === "office" ? t("Office-owned session") : data?.controlsAvailable ? t("Session synced with the desktop app") : t("Read-only preview. Continue in the desktop app.")}</p>
            </div>
          </div>
        </details>
        {headerEnd}
      </div>
    </header>
    {characterOpen && data && onSaveCharacter ? <DuckCharacterPanel key={`${threadId}:${characterMode}`} mode={characterMode} onModeChange={setCharacterMode} onRename={data.controlsAvailable ? rename : undefined} onReassign={data.controlsAvailable ? reassign : undefined} projects={projects} info={{ ...data, name: sessionName }} profile={avatarProfile} status={agentStatus || data.status} model={agentModel} onSave={onSaveCharacter} /> : null}
    <div className={characterOpen ? "hidden" : `session-workspace-layout min-h-0 flex-1${workspaceOpen ? " session-workspace-layout--open" : ""}`}>
    <div className="session-conversation flex min-h-0 min-w-0 flex-1 flex-col">
    {metadataError ? <p role="alert" className="p-3 text-xs text-amber-200">{t(metadataError)}</p> : null}
    {error ? <p role="alert" className="p-3 text-xs text-amber-200">{t(error)} <button onClick={() => void load.current?.(failedMode.current)} className="underline">{t("Retry")}</button></p> : null}
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scroll} aria-label={t("Session history")} onScroll={event => {
      const node = event.currentTarget, movingUp = node.scrollTop < lastTop.current;
      follow.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 60;
      setShowLatest(!follow.current);
      lastTop.current = node.scrollTop;
      if (movingUp && node.scrollTop < 80) void load.current?.("older");
    }} onWheel={event => {
      if (event.deltaY < 0 && event.currentTarget.scrollTop < 80) void load.current?.("older");
    }} onTouchStart={event => { touchY.current = event.touches[0]?.clientY ?? 0; }} onTouchMove={event => {
      const y = event.touches[0]?.clientY ?? touchY.current;
      if (y > touchY.current + 20 && event.currentTarget.scrollTop < 80) { touchY.current = y; void load.current?.("older"); }
    }} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 [overflow-anchor:none] md:px-4">
      <div className="mx-auto w-full max-w-3xl space-y-3">
      <div className="flex min-h-8 items-center justify-center text-[10px] text-white/50">
        {loading ? <span role="status">{t("Loading messages…")}</span> : olderCursor ? <button onClick={() => void load.current?.("older")} className="px-3 py-1 text-cyan-200">{t("↑ Load older messages")}</button> : loaded ? t("Start of history") : null}
      </div>
      {loaded && messages.length === 0 ? <p className="text-center text-xs text-white/50">{t("No chat text on this page (tool activity omitted).")}{olderCursor ? t("Scroll up or use the button above to load older messages.") : ""}</p> : null}
      <SessionTranscript messages={messages} />
      </div>
    </div>
    {showLatest ? <button aria-label={t("Go to latest message")} onClick={() => {
      const node = scroll.current;
      if (!node) return;
      follow.current = true; node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      lastTop.current = node.scrollTop; setShowLatest(false);
    }} className="absolute bottom-3 left-1/2 z-10 min-h-10 -translate-x-1/2 rounded-full border border-white/20 bg-[#243346] px-4 text-xs text-white shadow-xl hover:bg-[#30445c]">{t("↓ Latest messages")}</button> : null}
    </div>
    {data?.runtime === "office" ? <OfficeCodexAccount client={client} /> : null}
    {data?.id === threadId && data.controlsAvailable ? <SessionControls key={threadId} client={client} threadId={threadId} onItems={onLiveItems} onHistorySync={onHistorySync} voice={voice} /> : null}
    </div>
    {workspaceOpen ? <SessionWorkspace key={threadId} client={client} threadId={threadId} asset={previewAsset} terminalAvailable={data?.terminalAvailable}
      assets={[...new Map(messages.flatMap(message => message.assets || []).map(asset => [asset.url, asset])).values()].slice(-40)}
      onSelectAsset={setPreviewAsset} onClose={() => setWorkspaceOpen(false)} /> : null}
    </div>
  </section></SessionPreviewContext.Provider>;
}
