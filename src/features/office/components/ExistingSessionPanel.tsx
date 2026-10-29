"use client";
import { useEffect, useRef, useState } from "react";

type Inspection = {
  id: string;
  name: string;
  workspace: string;
  project: string;
  status: "running" | "idle" | "unknown";
  messages: Array<{ role: string; content: string; timestamp?: number }>;
};

export function ExistingSessionPanel({ client, threadId }: {
  client: { call: (method: string, params: unknown) => Promise<unknown> };
  threadId: string;
}) {
  const [data, setData] = useState<Inspection | null>(null);
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const shownThread = useRef(threadId);
  useEffect(() => {
    if (shownThread.current !== threadId) { shownThread.current = threadId; follow.current = true; }
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [data, threadId]);
  useEffect(() => {
    let stopped = false, busy = false;
    const refresh = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const result = await client.call("session.inspect", { threadId }) as Inspection;
        if (!stopped) { setData(result); setError(""); }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "读取原会话失败");
      } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [client, threadId]);

  return (
    <section className="flex min-h-0 flex-1 flex-col text-white" aria-label="App 原会话">
      <header className="shrink-0 border-b border-white/10 p-3">
        <div className="text-[10px] text-cyan-200">App 原会话 · 只读总览</div>
        <h2 className="mt-1 break-words text-sm font-semibold">{data?.id === threadId ? data.name : "读取中…"}</h2>
        {data?.id === threadId ? <p className="mt-1 text-xs text-white/60">{data.project} · {data.status === "running" ? "工作中" : data.status === "idle" ? "空闲" : "状态记录不足"}</p> : null}
        <a href={`codex://threads/${encodeURIComponent(threadId)}`} className="mt-2 inline-block rounded border border-cyan-400/30 px-2 py-1 text-xs text-cyan-100">在桌面 App 中打开原会话 ↗</a>
      </header>
      {error ? <p role="alert" className="p-3 text-xs text-amber-200">{error}</p> : null}
      <div ref={scroll} onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60; }} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {data?.id === threadId ? data.messages.map((message, i) => (
          <article key={i} className="rounded border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-[10px] text-white/50">{message.role === "user" ? "你" : "助手"}{message.timestamp ? ` · ${new Date(message.timestamp).toLocaleString()}` : ""}</div>
            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed">{message.content}</div>
          </article>
        )) : null}
      </div>
      <footer className="shrink-0 space-y-1 border-t border-white/10 p-3 text-[10px] text-white/50">
        <p>这里显示原会话最近的记录。续聊、停止和审批仍在原 App 中进行。</p>
        <p className="break-all">Session ID：{threadId}</p>
        {data?.id === threadId ? <p className="break-all">目录：{data.workspace}</p> : null}
      </footer>
    </section>
  );
}
