"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SessionControls, type LiveSessionItem, type SessionClient } from "./SessionControls";
import { SessionTranscript } from "./SessionTranscript";

type Inspection = {
  id: string; name: string; workspace: string; project: string;
  status: "running" | "idle" | "unknown";
  controlsAvailable?: boolean;
};
type Message = LiveSessionItem;
type HistoryPage = { threadId: string; messages: Message[]; nextCursor: string | null };
type LoadMode = "latest" | "older";

export function ExistingSessionPanel({ client, threadId }: {
  client: SessionClient;
  threadId: string;
}) {
  const [data, setData] = useState<Inspection | null>(null);
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
        const result = await client.call("session.inspect", { threadId, includeHistory: false }) as Inspection;
        if (!stopped) { setData(result); setMetadataError(""); }
      } catch (cause) {
        if (!stopped) setMetadataError(cause instanceof Error ? cause.message : "读取会话信息失败");
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
        if (result.threadId !== threadId) throw new Error("会话记录不匹配，请重试");
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
        if (!stopped) setError(cause instanceof Error ? cause.message : "读取这一块失败");
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

  return <section className="flex min-h-0 flex-1 flex-col text-white" aria-label="App 原会话">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold" title={data?.name}>{data?.id === threadId ? data.name : "读取会话信息…"}</h2>
        {data?.id === threadId ? <p className="mt-1 truncate text-xs text-white/45">{data.project}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <details className="relative" aria-label="会话信息">
          <summary aria-label="会话信息" className="flex min-h-10 min-w-10 cursor-pointer list-none items-center justify-center rounded-md text-lg text-white/55 hover:bg-white/10">⋯</summary>
          <div className="absolute right-0 top-full z-30 mt-1 max-h-[50dvh] w-[min(320px,calc(100vw-3rem))] space-y-3 overflow-auto rounded-xl border border-white/15 bg-[#1b2532] p-4 text-xs text-white/60 shadow-xl">
            <a href={`codex://threads/${encodeURIComponent(threadId)}`} className="block text-cyan-100">在桌面 App 中打开原会话 ↗</a>
            <p className="break-all">Session ID：{threadId}</p>
            {data?.id === threadId ? <p className="break-all">目录：{data.workspace}</p> : null}
            <p>{data?.controlsAvailable ? "与桌面 App 同步的原会话" : "只读预览，请在桌面 App 中继续对话"}</p>
          </div>
        </details>
      </div>
    </header>
    {metadataError ? <p role="alert" className="p-3 text-xs text-amber-200">{metadataError}</p> : null}
    {error ? <p role="alert" className="p-3 text-xs text-amber-200">{error} <button onClick={() => void load.current?.(failedMode.current)} className="underline">重试</button></p> : null}
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scroll} aria-label="会话记录" onScroll={event => {
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
    }} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 [overflow-anchor:none] md:px-8">
      <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="flex min-h-8 items-center justify-center text-[10px] text-white/50">
        {loading ? <span role="status">读取这一块…</span> : olderCursor ? <button onClick={() => void load.current?.("older")} className="px-3 py-1 text-cyan-200">↑ 读取更早记录</button> : loaded ? "已到最早记录" : null}
      </div>
      {loaded && messages.length === 0 ? <p className="text-center text-xs text-white/50">这一块没有对话文字（工具活动已略过）。{olderCursor ? "向上滚动或点上方按钮，读取更早一块。" : ""}</p> : null}
      <SessionTranscript messages={messages} />
      </div>
    </div>
    {showLatest ? <button aria-label="回到最新消息" onClick={() => {
      const node = scroll.current;
      if (!node) return;
      follow.current = true; node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      lastTop.current = node.scrollTop; setShowLatest(false);
    }} className="absolute bottom-3 left-1/2 z-10 min-h-10 -translate-x-1/2 rounded-full border border-white/20 bg-[#243346] px-4 text-xs text-white shadow-xl hover:bg-[#30445c]">↓ 最新消息</button> : null}
    </div>
    {data?.id === threadId && data.controlsAvailable ? <SessionControls key={threadId} client={client} threadId={threadId} onItems={onLiveItems} /> : null}
  </section>;
}
