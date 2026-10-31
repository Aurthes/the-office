"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft } from "lucide-react";
import type { CharacterMode } from "@/features/ring-ship/DuckCharacterPanel";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import { SessionControls, type LiveSessionItem, type SessionClient } from "./SessionControls";
import { SessionTranscript } from "./SessionTranscript";
import { useUiText } from "@/lib/i18n/ui-language";

export type SessionInspection = {
  id: string; name: string; workspace: string; project: string;
  status: "running" | "idle" | "unknown";
  controlsAvailable?: boolean; model?: string | null;
};
function CharacterLoading() {
  const t = useUiText();
  return <p role="status" className="p-5 text-xs text-white/55">{t("Loading character…")}</p>;
}
const DuckCharacterPanel = dynamic(() => import("@/features/ring-ship/DuckCharacterPanel").then(module => module.DuckCharacterPanel), { ssr: false, loading: CharacterLoading });
type Message = LiveSessionItem;
type HistoryPage = { threadId: string; messages: Message[]; nextCursor: string | null };
type LoadMode = "latest" | "older";

export function ExistingSessionPanel({ client, threadId, onReturnToEarth, returnDisabled, avatarProfile, agentStatus, agentModel, onSaveCharacter, agentName, onSessionRenamed }: {
  client: SessionClient;
  threadId: string;
  onReturnToEarth?: () => void;
  returnDisabled?: boolean;
  avatarProfile?: AgentAvatarProfile | null;
  agentStatus?: string;
  agentModel?: string | null;
  agentName?: string;
  onSessionRenamed?: (name: string) => void;
  onSaveCharacter?: (profile: AgentAvatarProfile) => Promise<void>;
}) {
  const t = useUiText();
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
            }), ...[...liveItems.current.values()].filter(item => !ids.has(item.id))];
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
    let connected = true;
    const unsubscribeStatus = client.onStatus?.(status => {
      if (status === "connected" && !connected) { void readMetadata(); void readPage("latest"); }
      connected = status === "connected";
    });
    return () => { stopped = true; load.current = null; unsubscribeStatus?.(); };
  }, [client, threadId]);

  const sessionName = agentName || data?.name || "";
  const rename = async (name: string) => {
    const result = await client.call("session.rename", { threadId, name, requestId: crypto.randomUUID() }) as { threadId: string; name: string };
    if (result.threadId !== threadId || result.name !== name) throw new Error(t("Session rename was not confirmed. Please retry."));
    setData(previous => previous?.id === threadId ? { ...previous, name: result.name } : previous);
    onSessionRenamed?.(result.name);
  };
  const openCharacter = (event: React.MouseEvent, mode: CharacterMode) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
    setCharacterMode(mode);
  };
  return <section className="flex min-h-0 flex-1 flex-col text-white" aria-label={t("App session")}>
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold" title={sessionName}>{data?.id === threadId ? sessionName : t("Loading session information…")}</h2>
        {data?.id === threadId ? <p className="mt-1 truncate text-xs text-white/45">{data.project}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {characterOpen ? <button type="button" onClick={() => setCharacterMode("chat")} className="flex min-h-10 items-center gap-2 rounded-md px-3 text-xs text-[#d2bb88] hover:bg-white/5"><ArrowLeft size={14} />{t("Back to chat")}</button> : null}
        <details className="relative" aria-label={t("Session information")}>
          <summary aria-label={t("Session information")} className="flex min-h-10 min-w-10 cursor-pointer list-none items-center justify-center rounded-md text-lg text-white/55 hover:bg-white/10">⋯</summary>
          <div className="absolute right-0 top-full z-30 mt-1 max-h-[50dvh] w-[min(320px,calc(100vw-3rem))] space-y-3 overflow-auto rounded-xl border border-white/15 bg-[#1b2532] p-4 text-xs text-white/60 shadow-xl">
            <div className="space-y-1 border-b border-white/10 pb-3">
            {onSaveCharacter ? <>
              <button type="button" disabled={!data} onClick={event => openCharacter(event, "view")} className="block min-h-10 w-full rounded px-2 text-left text-white/80 hover:bg-white/5">{t("Character")}</button>
              <button type="button" disabled={!data} onClick={event => openCharacter(event, "edit")} className="block min-h-10 w-full rounded px-2 text-left text-white/80 hover:bg-white/5">{t("Edit character")}</button>
              <button type="button" disabled={!data?.controlsAvailable} onClick={event => openCharacter(event, "rename")} className="block min-h-10 w-full rounded px-2 text-left text-white/80 hover:bg-white/5 disabled:opacity-40">{t("Rename session")}</button>
            </> : null}
            {onReturnToEarth ? <button type="button" disabled={returnDisabled || !data?.controlsAvailable} onClick={onReturnToEarth}
              title={returnDisabled ? t("Stop the current task or wait for the previous return journey") : t("Archive this original session and keep its history")}
              className="block w-full rounded-md border border-amber-300/25 px-3 py-2 text-left text-amber-200 hover:bg-amber-200/10 disabled:opacity-40">↓ {t("Return to Earth (archive)")}</button> : null}
            </div>
            <a href={`codex://threads/${encodeURIComponent(threadId)}`} className="block text-cyan-100">{t("Open session in desktop app ↗")}</a>
            <p className="break-all">{t("Session ID")}: {threadId}</p>
            {data?.id === threadId ? <p className="break-all">{t("Directory:")} {data.workspace}</p> : null}
            <p>{data?.controlsAvailable ? t("Session synced with the desktop app") : t("Read-only preview. Continue in the desktop app.")}</p>

          </div>
        </details>
      </div>
    </header>
    {characterOpen && data && onSaveCharacter ? <DuckCharacterPanel key={`${threadId}:${characterMode}`} mode={characterMode} onModeChange={setCharacterMode} onRename={data.controlsAvailable ? rename : undefined} info={{ ...data, name: sessionName }} profile={avatarProfile} status={agentStatus || data.status} model={agentModel} onSave={onSaveCharacter} /> : null}
    <div className={characterOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
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
    {data?.id === threadId && data.controlsAvailable ? <SessionControls key={threadId} client={client} threadId={threadId} onItems={onLiveItems} /> : null}
    </div>
  </section>;
}
