"use client";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRightLeft, ArrowLeft, ChevronRight, CopyPlus, ExternalLink, Focus, LogOut, MoreHorizontal, PanelRight, SlidersHorizontal, PencilLine, UserRound } from "lucide-react";
import type { OrganizationView } from "@/lib/office/organization";
import type { CharacterMode } from "@/features/ring-ship/DuckCharacterPanel";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import type { CompanyProject } from "@/features/retro-office/core/companyLayout";
import type { SessionVoiceController } from "./useSessionVoice";
import { SessionControls, type LiveSessionItem, type SessionClient, type ReplySource } from "./SessionControls";
import { SessionPreviewContext } from "./SessionPreviewContext";
import { SessionWorkspace } from "./SessionWorkspace";
import type { SessionAsset } from "./SessionControls";
import { SessionTranscript } from "./SessionTranscript";
import { useUiText } from "@/lib/i18n/ui-language";
import { OfficeCodexAccount } from "./OfficeCodexAccount";
import { SessionMessageLocation } from "./SessionMessageLocation";
import { AgentInterfaceActions, AgentInterfacePresetEditor } from "./AgentInterfaceActions";
import type { AgentInterfacePreset } from "@/lib/office/agent-interface";
import type { MessageSearchTarget } from "./MessageSearchResults";

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
type HistoryPage = { historyEpoch?: string; threadId: string; messages: Message[]; nextCursor: string | null };
type LoadMode = "latest" | "older" | "sync";
function reconcileLocalSends(messages: Message[]) {
  const received = new Set(messages.filter(message => message.role === "user" && !message.delivery && message.clientId).map(message => message.clientId));
  return messages.filter(message => !message.delivery || !received.has(message.clientId));
}

export function ExistingSessionPanel({ client, threadId, active = true, captureEligible = false, onCaptureAdopt, focusMode = false, onToggleFocus, onReturnToEarth, returnDisabled, avatarProfile, agentStatus, agentModel, onSaveCharacter, agentName, onSessionRenamed, onOpenWorkspace, onOpenThread, onFork, forkDisabled, headerStart, headerEnd, projects = [], voice, organization, messageTarget, onCloseMessage, interfacePreset = "standard", onSaveInterfacePreset, onOpenTeaserBoard, externalSends, onExternalReceipt }: {
  client: SessionClient;
  active?: boolean;
  captureEligible?: boolean;
  onCaptureAdopt?: () => void;
  focusMode?: boolean;
  onToggleFocus?: () => void;
  voice?: SessionVoiceController;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  onOpenWorkspace?: () => void;
  onOpenThread?: (id: string) => void | Promise<void>;
  onFork?: (name?: string, lastTurnId?: string) => void;
  forkDisabled?: boolean;
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
  organization?: OrganizationView;
  messageTarget?: MessageSearchTarget | null;
  onCloseMessage?: () => void;
  interfacePreset?: AgentInterfacePreset;
  onSaveInterfacePreset?: (preset: AgentInterfacePreset) => Promise<void>;
  onOpenTeaserBoard?: () => void;
  externalSends?: readonly LiveSessionItem[];
  onExternalReceipt?: (threadId: string, clientId: string) => void;
}) {
  const t = useUiText();
  const [questionTarget, setQuestionTarget] = useState<{ ownerId: string; target: MessageSearchTarget } | null>(null);
  const shownMessageTarget = messageTarget || (questionTarget?.ownerId === threadId ? questionTarget.target : null);

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<SessionAsset | null>(null);
  const openPreview = useCallback((asset: SessionAsset) => { setPreviewAsset(asset); setWorkspaceOpen(true); onOpenWorkspace?.(); }, [onOpenWorkspace]);
  const [characterMode, setCharacterMode] = useState<CharacterMode | "chat">("chat");
  const characterOpen = characterMode !== "chat";
  const [data, setData] = useState<SessionInspection | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef(messages);
  const owner = useRef(threadId);
  useLayoutEffect(() => { owner.current = threadId; }, [threadId]);
  useLayoutEffect(() => { messagesRef.current = messages; }, [messages]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLatest, setShowLatest] = useState(false);
  const [error, setError] = useState("");
  const [metadataError, setMetadataError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastTop = useRef(0);
  const sourceScroll = useRef<{ ownerId: string; top: number; following: boolean } | null>(null);
  const openQuestion = useCallback((source: ReplySource) => {
    sourceScroll.current = { ownerId: threadId, top: scroll.current?.scrollTop || 0, following: follow.current };
    follow.current = false;
    setQuestionTarget({ ownerId: threadId, target: { ...source, messageId: `${source.turnId}:${source.itemId}`, name: t("Original message"), project: "", archived: false, snippet: source.excerpt, snippetMatchRange: { start: 0, end: 0 }, requestId: crypto.randomUUID() } });
  }, [t, threadId]);
  useLayoutEffect(() => {
    const saved = sourceScroll.current;
    if (shownMessageTarget || !saved) return;
    if (saved.ownerId === threadId && scroll.current) { scroll.current.scrollTop = saved.top; lastTop.current = saved.top; follow.current = saved.following; }
    sourceScroll.current = null;
  }, [shownMessageTarget, threadId]);

  const touchY = useRef(0);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const load = useRef<((mode: LoadMode) => Promise<void>) | null>(null);
  const historyEpoch = useRef<string | undefined>(undefined);
  const resetHistory = useRef<((epoch: string) => void) | null>(null);
  const onHistoryReset = useCallback((epoch: string) => { resetHistory.current?.(epoch); }, []);
  const onHistorySync = useCallback(() => { void load.current?.("sync"); }, []);
  const failedMode = useRef<LoadMode>("latest");
  const liveItems = useRef(new Map<string, LiveSessionItem>());
  const onSendState = useCallback((id: string, item: LiveSessionItem) => {
    if (owner.current !== id || (item.historyEpoch && historyEpoch.current && item.historyEpoch !== historyEpoch.current)) return;
    setMessages(previous => {
      if (previous.some(message => message.role === "user" && !message.delivery && message.clientId === item.clientId)) return previous;
      const index = previous.findIndex(message => message.id === item.id);
      if (index < 0) return [...previous, item];
      return previous.map((message, i) => i === index ? item : message);
    });
  }, []);
  useEffect(() => {
    for (const message of messages) if (message.role === "user" && !message.delivery && message.clientId) onExternalReceipt?.(threadId, message.clientId);
  }, [messages, onExternalReceipt, threadId]);
  const onLiveItems = useCallback((items: LiveSessionItem[]) => {
    for (const item of items) liveItems.current.set(item.id, item);
    while (liveItems.current.size > 128) liveItems.current.delete(liveItems.current.keys().next().value!);
    setMessages(previous => {
      const next = [...previous];
      for (const item of items) {
        const index = next.findIndex(message => message.id === item.id);
        if (index < 0) next.push(item); else next[index] = { ...next[index], ...item };
      }
      return items.some(item => item.role === "user" && item.clientId) ? reconcileLocalSends(next) : next;
    });
  }, []);

  useLayoutEffect(() => {
    const node = scroll.current;
    if (!active || !node || !loaded || !node.clientHeight) return;
    if (anchor.current) {
      node.scrollTop = anchor.current.top + node.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (follow.current) node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    lastTop.current = node.scrollTop;
    setShowLatest(node.scrollHeight - node.clientHeight - node.scrollTop > 60);
  }, [messages, loaded, active, workspaceOpen, characterOpen]);

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
    let cursor: string | null = null, readVersion = 0, connectionVersion = 0;
    const acceptEpoch = (epoch: string | undefined) => {
      if (!epoch || historyEpoch.current === epoch) return false;
      const changed = historyEpoch.current !== undefined;
      historyEpoch.current = epoch;
      if (!changed) return false;
      // A destructive native reset is different from a bounded catch-up page.
      // Cancel every old read/cursor, including reads owned by hidden panels.
      readVersion++; busy = false; reloadLatest = false; cursor = null;
      liveItems.current.clear(); messagesRef.current = [];
      setMessages([]); setOlderCursor(null); setLoaded(false); setActiveTurnId(null);
      anchor.current = null; follow.current = true;
      void readPage("latest");
      return true;
    };
    resetHistory.current = epoch => { acceptEpoch(epoch); };
    setShowLatest(false);
    setData(null); setMessages([]); setOlderCursor(null); setLoaded(false); setError(""); setMetadataError("");
    follow.current = true; anchor.current = null; lastTop.current = 0;
    liveItems.current.clear();
    setActiveTurnId(null);
    const readMetadata = async () => {
      if (metadataBusy || stopped) return;
      metadataBusy = true;
      const epochAtRead = historyEpoch.current;
      try {
        const result = await client.call("session.inspect", { threadId, includeHistory: false }) as SessionInspection;
        if (!stopped) { if (epochAtRead === historyEpoch.current) acceptEpoch((result as SessionInspection & { historyEpoch?: string }).historyEpoch); setData(result); setMetadataError(""); }
      } catch (cause) {
        if (!stopped) setMetadataError(cause instanceof Error ? cause.message : "Could not read session information");
      } finally { metadataBusy = false; }
    };
    const readPage = async (mode: LoadMode) => {
      if (stopped || (mode === "older" && !cursor)) return;
      if (busy) { if (mode !== "older") reloadLatest = true; return; }
      const readId = ++readVersion, connectionAtRead = connectionVersion;
      busy = true; if (mode !== "sync") setLoading(true); failedMode.current = mode;
      // Keep changes received during the read, including updates to existing IDs.
      const liveBeforeRead = new Map(liveItems.current);
      const previousIds = new Set(messagesRef.current.filter(message => !message.delivery).map(message => message.id));
      const before = mode === "older" && scroll.current ? { height: scroll.current.scrollHeight, top: scroll.current.scrollTop } : null;
      try {
        const result = await client.call("session.history", { threadId, ...(mode === "older" ? { cursor, historyEpoch: historyEpoch.current } : {}) }) as HistoryPage;
        if (stopped || readId !== readVersion || connectionAtRead !== connectionVersion) return;
        if (acceptEpoch(result.historyEpoch)) return;
        if (result.threadId !== threadId) throw new Error("Session history mismatch. Please retry.");
        // Catch up to a retained timeline, paging only across the missed gap.
        // Stream bootstrap items are a cache, so use canonical history order.
        while (mode === "sync" && previousIds.size && result.nextCursor && !result.messages.some(message => previousIds.has(message.id))) {
          const older = await client.call("session.history", { threadId, cursor: result.nextCursor, historyEpoch: historyEpoch.current }) as HistoryPage;
          if (stopped || readId !== readVersion || connectionAtRead !== connectionVersion) return;
          if (acceptEpoch(older.historyEpoch)) return;
          if (older.threadId !== threadId) throw new Error("Session history mismatch. Please retry.");
          result.messages = [...older.messages, ...result.messages]; result.nextCursor = older.nextCursor;
        }
        if (mode !== "sync") { anchor.current = before; follow.current = mode === "latest"; }
        const syncedIds = new Set(result.messages.map(message => message.id));
        const overlap = mode === "sync" && result.nextCursor !== null && messagesRef.current.some(message => syncedIds.has(message.id));
        setMessages(previous => {
          if (mode !== "older") {
            const ids = new Set(result.messages.map(message => message.id));
            const page = result.messages.map(message => {
              const live = liveItems.current.get(message.id);
              return live && (live.status === "completed" || live.content.length > message.content.length) ? { ...message, ...live } : message;
            });
            // A bounded history read can lag behind received live messages.
            // Sync adds canonical entries; absence from that page is not deletion.
            // Keep unmatched messages beside their next known timeline anchor.
            const before = new Map<string, Message[]>();
            let unmatched: Message[] = [];
            if (mode === "sync") for (const message of previous) {
              if (ids.has(message.id)) { before.set(message.id, unmatched); unmatched = []; }
              else unmatched.push(message);
            }
            const merged = [...page.flatMap(message => [...(before.get(message.id) || []), message]), ...unmatched];
            for (const item of merged) ids.add(item.id);
            const keptLocal = mode === "sync" ? [] : previous.filter(message => message.delivery && !ids.has(message.id));
            return reconcileLocalSends([...merged, ...keptLocal, ...[...liveItems.current.values()].filter(item => !ids.has(item.id) && liveBeforeRead.get(item.id) !== item)]);
          }
          const existing = new Set(previous.map(message => message.id));
          return reconcileLocalSends([...result.messages.filter(message => !existing.has(message.id)), ...previous]);
        });
        if (!overlap) cursor = result.nextCursor;
        setOlderCursor(cursor); setLoaded(true); setError("");
      } catch (cause) {
        if (!stopped && readId === readVersion && connectionAtRead === connectionVersion) setError(cause instanceof Error ? cause.message : "Could not load this page");
      } finally {
        if (!stopped && readId === readVersion) {
          busy = false;
          setLoading(false);
          if (reloadLatest) { reloadLatest = false; void readPage("sync"); }
        }
      }
    };
    load.current = readPage;
    void readMetadata(); void readPage("latest");
    const unsubscribeRoster = client.onEvent?.(event => {
      if (event.event === "roster.updated") void readMetadata();
      if (event.event === "session.historyReset") {
        const reset = event.payload as { threadId: string; historyEpoch: string };
        if (reset?.threadId === threadId) acceptEpoch(reset.historyEpoch);
      }
    });
    let connected = true;
    const unsubscribeStatus = client.onStatus?.(status => {
      if (status === "connected" && !connected) { connectionVersion++; void readMetadata(); void readPage("sync"); }
      connected = status === "connected";
    });
    return () => { stopped = true; readVersion++; load.current = null; resetHistory.current = null; unsubscribeStatus?.(); unsubscribeRoster?.(); };
  }, [client, threadId]);

  // Initialize the timeline before adding retained external sends, including
  // when their target chat opens after the whiteboard RPC has already finished.
  useEffect(() => {
    if (!externalSends?.length) return;
    for (const item of externalSends) onSendState(threadId, item);
    if (externalSends.some(item => item.delivery === "accepted" || item.delivery === "unknown")) onHistorySync();
  }, [client, externalSends, onHistorySync, onSendState, threadId]);

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
  return <SessionPreviewContext.Provider value={openPreview}><section className="session-panel relative flex min-h-0 min-w-0 flex-1 flex-col text-white" aria-label={t("Codex session")}>
    {shownMessageTarget ? <SessionMessageLocation client={client} target={shownMessageTarget} onClose={messageTarget && onCloseMessage ? onCloseMessage : () => setQuestionTarget(null)} headerStart={headerStart} /> : null}
    <div inert={Boolean(shownMessageTarget)} aria-hidden={Boolean(shownMessageTarget)} className="flex min-h-0 flex-1 flex-col">
    <header className="session-panel-header flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
      {headerStart}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold" title={sessionName}>{data?.id === threadId ? sessionName : t("Loading session information…")}</h2>
        {data?.id === threadId ? <p className="mt-1 truncate text-xs text-white/45">{data.project}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onToggleFocus ? <button type="button" aria-label={t("Focus mode")} aria-pressed={focusMode} onClick={onToggleFocus}
          title={t(focusMode ? "Focus on: keep this session until switched off" : "Keep this session open beyond the 15-minute cache")}
          className="session-action-back session-focus-toggle"><Focus size={15} /><span className="hidden sm:inline">{t("Focus")}</span></button> : null}
        <AgentInterfaceActions preset={interfacePreset} onOpenBoard={onOpenTeaserBoard} placement="inline" />
        {characterOpen ? <button type="button" onClick={() => setCharacterMode("chat")} className="session-action-back"><ArrowLeft size={14} />{t("Back to chat")}</button> : null}
        {!characterOpen ? <button type="button" aria-label={t(workspaceOpen ? "Close workspace" : "Open workspace")} aria-expanded={workspaceOpen} title={t("Workspace")}
          disabled={!data?.controlsAvailable} className="session-action-back session-workspace-toggle" onClick={() => { setWorkspaceOpen(value => !value); if (!workspaceOpen) onOpenWorkspace?.(); }}><PanelRight size={15} /><span>{t("Workspace")}</span></button> : null}
        <details className="session-actions relative" aria-label={t("Session information")}>
          <summary aria-label={t("Session information")} className="session-actions-trigger"><MoreHorizontal size={18} aria-hidden="true" /></summary>
          <div className="session-actions-popover">
            <div className="session-actions-list">
            <AgentInterfaceActions preset={interfacePreset} onOpenBoard={onOpenTeaserBoard} placement="menu" />
            {onSaveInterfacePreset ? <AgentInterfacePresetEditor key={`${threadId}:${interfacePreset}`} preset={interfacePreset} onSave={onSaveInterfacePreset} /> : null}
            {onSaveCharacter ? <>
              <button type="button" disabled={!data} onClick={event => openCharacter(event, "view")} className="session-action session-action--view"><span className="session-action-icon"><UserRound size={16} aria-hidden="true" /></span><span className="session-action-label">{t("Character")}</span><ChevronRight className="session-action-chevron" size={14} aria-hidden="true" /></button>
              <button type="button" disabled={!data} onClick={event => openCharacter(event, "edit")} className="session-action session-action--edit"><span className="session-action-icon"><SlidersHorizontal size={16} aria-hidden="true" /></span><span className="session-action-label">{t("Edit character")}</span><ChevronRight className="session-action-chevron" size={14} aria-hidden="true" /></button>
              <button type="button" disabled={!data?.controlsAvailable} onClick={event => openCharacter(event, "rename")} className="session-action session-action--rename"><span className="session-action-icon"><PencilLine size={16} aria-hidden="true" /></span><span className="session-action-label">{t("Rename session")}</span><ChevronRight className="session-action-chevron" size={14} aria-hidden="true" /></button>
              <button type="button" disabled={!data?.controlsAvailable || !projects.length} onClick={event => openCharacter(event, "reassign")} className="session-action session-action--reassign"><span className="session-action-icon"><ArrowRightLeft size={16} aria-hidden="true" /></span><span className="session-action-label">{t("Reassign")}</span><ChevronRight className="session-action-chevron" size={14} aria-hidden="true" /></button>
            </> : null}
            {onFork ? <button type="button" disabled={forkDisabled || !data?.controlsAvailable} onClick={() => onFork()} className="session-action"><span className="session-action-icon"><CopyPlus size={16} aria-hidden="true" /></span><span className="session-action-label">{t("Fork agent")}</span><ChevronRight className="session-action-chevron" size={14} aria-hidden="true" /></button> : null}
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
    {characterOpen && data && onSaveCharacter ? <DuckCharacterPanel key={`${threadId}:${characterMode}`} mode={characterMode} onModeChange={setCharacterMode} onRename={data.controlsAvailable ? rename : undefined} onReassign={data.controlsAvailable ? reassign : undefined} projects={projects} organization={organization} info={{ ...data, name: sessionName }} profile={avatarProfile} status={agentStatus || data.status} model={agentModel} onSave={onSaveCharacter} /> : null}
    <div className={characterOpen ? "hidden" : `session-workspace-layout min-h-0 flex-1${workspaceOpen ? " session-workspace-layout--open" : ""}`}>
    <div className="session-conversation flex min-h-0 min-w-0 flex-1 flex-col">
    {metadataError ? <p role="alert" className="p-3 text-xs text-amber-200">{t(metadataError)}</p> : null}
    {error ? <p role="alert" className="p-3 text-xs text-amber-200">{t(error)} <button onClick={() => void load.current?.(failedMode.current)} className="underline">{t("Retry")}</button></p> : null}
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scroll} aria-label={t("Session history")} onScroll={event => {
      if (!active || shownMessageTarget || !event.currentTarget.clientHeight) return;
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
      <SessionTranscript messages={messages} activeTurnId={activeTurnId} onForkFrom={onFork ? lastTurnId => onFork(undefined, lastTurnId) : undefined} forkDisabled={forkDisabled || !data?.controlsAvailable} onOpenQuestion={openQuestion} />
      </div>
    </div>
    {showLatest ? <button aria-label={t("Go to latest message")} onClick={() => {
      const node = scroll.current;
      if (!node) return;
      follow.current = true; node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      lastTop.current = node.scrollTop; setShowLatest(false);
    }} className="absolute bottom-3 left-1/2 z-10 min-h-10 -translate-x-1/2 rounded-full border border-white/20 bg-[#243346] px-4 text-xs text-white shadow-xl hover:bg-[#30445c]">{t("↓ Latest messages")}</button> : null}
    </div>
    {data?.runtime === "office" ? <OfficeCodexAccount client={client} quiet /> : null}
    {data?.id === threadId && data.controlsAvailable ? <SessionControls captureEligible={captureEligible} onCaptureAdopt={onCaptureAdopt} key={threadId} active={active && !shownMessageTarget} client={client} threadId={threadId} onItems={onLiveItems} onHistorySync={onHistorySync} onHistoryReset={onHistoryReset} onActiveTurnChange={setActiveTurnId} onSendState={onSendState} voice={voice} onOpenThread={onOpenThread} onFork={onFork} onRenamed={name => { setData(previous => previous ? { ...previous, name } : previous); onSessionRenamed?.(name); }} /> : null}
    </div>
    {workspaceOpen ? <SessionWorkspace key={threadId} active={active && !shownMessageTarget} client={client} threadId={threadId} asset={previewAsset} terminalAvailable={data?.terminalAvailable}
      assets={[...new Map(messages.flatMap(message => message.assets || []).map(asset => [asset.url, asset])).values()].slice(-40)}
      onSelectAsset={setPreviewAsset} onClose={() => setWorkspaceOpen(false)} /> : null}
    </div>
    </div>
  </section></SessionPreviewContext.Provider>;
}
