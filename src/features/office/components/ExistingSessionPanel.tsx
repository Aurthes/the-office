"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Inspection = {
  id: string; name: string; workspace: string; project: string;
  status: "running" | "idle" | "unknown";
};
type Message = { id: string; role: string; content: string; timestamp?: number; truncated?: boolean };
type HistoryPage = { threadId: string; messages: Message[]; nextCursor: string | null };
type LoadMode = "latest" | "older";

export function ExistingSessionPanel({ client, threadId }: {
  client: { call: (method: string, params: unknown) => Promise<unknown> };
  threadId: string;
}) {
  const [data, setData] = useState<Inspection | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metadataError, setMetadataError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastTop = useRef(0);
  const touchY = useRef(0);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const load = useRef<((mode: LoadMode) => Promise<void>) | null>(null);
  const failedMode = useRef<LoadMode>("latest");

  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node || !loaded) return;
    if (anchor.current) {
      node.scrollTop = anchor.current.top + node.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (follow.current) node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    lastTop.current = node.scrollTop;
  }, [messages, loaded]);

  useEffect(() => {
    let stopped = false, busy = false, metadataBusy = false;
    let cursor: string | null = null;
    setData(null); setMessages([]); setOlderCursor(null); setLoaded(false); setError(""); setMetadataError("");
    follow.current = true; anchor.current = null; lastTop.current = 0;
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
      if (busy || stopped || (mode === "older" && !cursor)) return;
      busy = true; setLoading(true); failedMode.current = mode;
      const before = mode === "older" && scroll.current ? { height: scroll.current.scrollHeight, top: scroll.current.scrollTop } : null;
      try {
        const result = await client.call("session.history", { threadId, ...(mode === "older" ? { cursor } : {}) }) as HistoryPage;
        if (stopped) return;
        if (result.threadId !== threadId) throw new Error("会话记录不匹配，请重试");
        anchor.current = before; follow.current = mode === "latest";
        setMessages(previous => {
          if (mode === "latest") return result.messages;
          const existing = new Set(previous.map(message => message.id));
          return [...result.messages.filter(message => !existing.has(message.id)), ...previous];
        });
        cursor = result.nextCursor;
        setOlderCursor(cursor); setLoaded(true); setError("");
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "读取这一块失败");
      } finally { busy = false; if (!stopped) setLoading(false); }
    };
    load.current = readPage;
    void readMetadata(); void readPage("latest");
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void readMetadata(); }, 5000);
    return () => { stopped = true; load.current = null; window.clearInterval(timer); };
  }, [client, threadId]);

  return <section className="flex min-h-0 flex-1 flex-col text-white" aria-label="App 原会话">
    <header className="shrink-0 border-b border-white/10 p-3">
      <div className="text-[10px] text-cyan-200">App 原会话 · 只读总览</div>
      <h2 className="mt-1 break-words text-sm font-semibold">{data?.id === threadId ? data.name : "读取会话信息…"}</h2>
      {data?.id === threadId ? <p className="mt-1 text-xs text-white/60">{data.project} · {data.status === "running" ? "工作中" : data.status === "idle" ? "空闲" : "状态记录不足"}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={`codex://threads/${encodeURIComponent(threadId)}`} className="rounded border border-cyan-400/30 px-2 py-1 text-xs text-cyan-100">在桌面 App 中打开原会话 ↗</a>
        <button disabled={loading} onClick={() => void load.current?.("latest")} className="rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-40">刷新最新</button>
      </div>
    </header>
    {metadataError ? <p role="alert" className="p-3 text-xs text-amber-200">{metadataError}</p> : null}
    {error ? <p role="alert" className="p-3 text-xs text-amber-200">{error} <button onClick={() => void load.current?.(failedMode.current)} className="underline">重试</button></p> : null}
    <div ref={scroll} aria-label="会话记录" onScroll={event => {
      const node = event.currentTarget, movingUp = node.scrollTop < lastTop.current;
      follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
      lastTop.current = node.scrollTop;
      if (movingUp && node.scrollTop < 80) void load.current?.("older");
    }} onWheel={event => {
      if (event.deltaY < 0 && event.currentTarget.scrollTop < 80) void load.current?.("older");
    }} onTouchStart={event => { touchY.current = event.touches[0]?.clientY ?? 0; }} onTouchMove={event => {
      const y = event.touches[0]?.clientY ?? touchY.current;
      if (y > touchY.current + 20 && event.currentTarget.scrollTop < 80) { touchY.current = y; void load.current?.("older"); }
    }} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 [overflow-anchor:none]">
      <div className="flex min-h-8 items-center justify-center text-[10px] text-white/50">
        {loading ? <span role="status">读取这一块…</span> : olderCursor ? <button onClick={() => void load.current?.("older")} className="px-3 py-1 text-cyan-200">↑ 读取更早记录</button> : loaded ? "已到最早记录" : null}
      </div>
      {loaded && messages.length === 0 ? <p className="text-center text-xs text-white/50">这一块没有对话文字（工具活动已略过）。{olderCursor ? "向上滚动或点上方按钮，读取更早一块。" : ""}</p> : null}
      {messages.map(message => <article key={message.id} className={`rounded-lg border border-l-4 p-3 ${message.role === "user" ? "border-cyan-400/60 bg-[#0b5268] text-cyan-50" : "border-slate-500/55 bg-[#242932] text-slate-100"}`}>
        <div className={`mb-2 text-[10px] font-semibold ${message.role === "user" ? "text-cyan-100" : "text-slate-300"}`}>{message.role === "user" ? "你" : "助手"}{message.timestamp ? ` · ${new Date(message.timestamp).toLocaleString()}` : ""}</div>
        <div className="agent-markdown min-w-0 break-words text-xs leading-relaxed [&_a]:text-sky-200 [&_a]:underline"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
        {message.truncated ? <p className="mt-2 text-[10px] text-amber-200/70">长消息已截断，全文可在原 App 查看。</p> : null}
      </article>)}
    </div>
    <footer className="shrink-0 space-y-1 border-t border-white/10 p-3 text-[10px] text-white/50">
      <p>向上滚动才读取更早一块；点“刷新最新”查看新记录。续聊、停止和审批仍在原 App 中进行。</p>
      <p className="break-all">Session ID：{threadId}</p>
      {data?.id === threadId ? <p className="break-all">目录：{data.workspace}</p> : null}
    </footer>
  </section>;
}
