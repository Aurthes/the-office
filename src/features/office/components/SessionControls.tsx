"use client";
import { useEffect, useRef, useState } from "react";

export type LiveSessionItem = { id: string; turnId?: string; role: string; phase?: string; content: string; truncated?: boolean; status?: string; version?: number; timestamp?: number };
export type SessionClient = { call: (method: string, params: unknown) => Promise<unknown>; onEvent?: (handler: (event: { event: string; payload?: unknown }) => void) => () => void };
type Approval = { requestId: string; method: string; params: Record<string, unknown>; details?: string; decisions: string[]; supported: boolean; submitted?: boolean };
type Snapshot = { connected: boolean; version: number; hasMore?: boolean; activeTurnId: string | null; turnStatus?: string; error?: string | null; items: LiveSessionItem[]; approvals: Approval[]; approvalCount?: number };

export function SessionControls({ client, threadId, onItems }: {
  client: SessionClient;
  threadId: string; onItems: (items: LiveSessionItem[]) => void;
}) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useRef<(() => Promise<void>) | null>(null);
  const actionBusy = useRef(false);
  useEffect(() => {
    let stopped = false, pending = false, dirty = false, attached = false, version = 0;
    const read = async () => {
      if (stopped) return;
      if (pending) { dirty = true; return; }
      pending = true;
      try {
        do {
          dirty = false;
          const result = await client.call(attached ? "session.live" : "session.attach", { threadId, since: version }) as Snapshot;
          if (stopped) return;
          attached = true; version = result.version; setState(result); setConnectionError("");
          if (result.items.length) onItems(result.items);
          dirty ||= Boolean(result.hasMore);
        } while (dirty && !stopped);
      } catch (cause) {
        if (!stopped) { attached = false; setState(null); setConnectionError(cause instanceof Error ? cause.message : "实时连接失败"); }
      } finally { pending = false; }
    };
    const unsubscribe = client.onEvent?.(event => {
      if (event.event === "session.updated" && (event.payload as { threadId?: string })?.threadId === threadId) void read();
    });
    const onVisible = () => { if (document.visibilityState === "visible") void read(); };
    refresh.current = read; void read();
    const timer = window.setInterval(onVisible, client.onEvent ? 15000 : 1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; refresh.current = null; clearInterval(timer); unsubscribe?.(); document.removeEventListener("visibilitychange", onVisible); };
  }, [client, threadId, onItems]);
  const action = async (method: string, params: object) => {
    if (actionBusy.current || !state?.connected) return;
    actionBusy.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      await client.call(method, { threadId, ...params });
      if (method === "session.send") { setText(""); setNotice("已提交到原会话"); }
      if (method === "session.stop") setNotice("停止请求已提交");
      if (method === "session.approval.reply") setNotice("审批答复已提交，等待后台确认");
      await refresh.current?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请核对原会话后再试"); }
    finally { actionBusy.current = false; setBusy(false); }
  };
  return <div className="max-h-[40vh] shrink-0 overflow-y-auto border-t border-white/15 bg-[#101b25] p-3 text-xs">
    {state?.approvals.length ? <div className="mb-3 max-h-[32vh] space-y-3 overflow-y-auto" aria-label="待处理审批">
      {state.approvals.map(request => <div key={request.requestId} className="rounded border border-amber-300/40 bg-amber-900/15 p-2">
        <p className="font-semibold text-amber-100">{request.method === "item/fileChange/requestApproval" ? "文件修改审批" : request.method === "item/commandExecution/requestApproval" ? "命令执行审批" : "原会话需要处理请求"}</p>
        <pre className="my-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] text-white/80">{JSON.stringify({ command: request.params.command, cwd: request.params.cwd, reason: request.params.reason, message: request.params.message, network: request.params.networkApprovalContext, permissions: request.params.additionalPermissions, grantRoot: request.params.grantRoot }, null, 2)}{request.details ? `\n${request.details}` : ""}</pre>
        {request.supported ? <div className="flex gap-2">
          <button disabled={busy || request.submitted || !request.decisions.includes("accept")} onClick={() => void action("session.approval.reply", { requestId: request.requestId, decision: "accept" })} className="rounded border border-emerald-300/50 px-3 py-1 text-emerald-100 disabled:opacity-40">允许本次</button>
          <button disabled={busy || request.submitted} onClick={() => void action("session.approval.reply", { requestId: request.requestId, decision: request.decisions.includes("decline") ? "decline" : "cancel" })} className="rounded border border-rose-300/50 px-3 py-1 text-rose-100 disabled:opacity-40">{request.decisions.includes("decline") ? "拒绝" : "取消本轮"}</button>
        </div> : <p className="text-amber-100">此类请求请在原 App 中处理。</p>}
      </div>)}
      {(state.approvalCount || 0) > state.approvals.length ? <p className="text-amber-100">还有待处理请求，完成以上审批后显示。</p> : null}
    </div> : null}
    <div className="mb-2 flex items-center justify-between text-[10px] text-white/60">
      <span>{state?.connected ? state.activeTurnId ? "Codex 正在工作…" : state.turnStatus === "interrupted" ? "已停止" : "Codex · 已连接" : "连接 Codex…"}</span>
      {state?.activeTurnId ? <button disabled={busy} onClick={() => void action("session.stop", {})} className="rounded border border-rose-400/50 px-3 py-1 text-rose-100 disabled:opacity-40">停止</button> : null}
    </div>
    <textarea aria-label="发送到原会话" placeholder="继续同一条 Codex 会话…" rows={2} maxLength={16000} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (text.trim()) void action("session.send", { message: text, requestId: crypto.randomUUID() }); }
    }} disabled={busy || !state?.connected} className="w-full resize-y rounded border border-cyan-300/30 bg-black/30 p-2 text-white placeholder:text-white/40 disabled:opacity-50" />
    <div className="mt-2 flex items-center justify-between gap-2">
      <span className="text-[10px] text-white/50">Enter 发送 · Shift+Enter 换行</span>
      <button disabled={busy || !state?.connected || !text.trim()} onClick={() => void action("session.send", { message: text, requestId: crypto.randomUUID() })} className="rounded bg-cyan-700 px-4 py-1.5 text-white disabled:opacity-40">{busy ? "提交中…" : state?.activeTurnId ? "追加消息" : "发送"}</button>
    </div>
    {notice ? <p role="status" className="mt-2 text-[10px] text-cyan-100">{notice}</p> : null}
    {error ? <p role="alert" className="mt-2 break-words text-[10px] text-amber-100">{error}</p> : null}
    {state?.error ? <p role="alert" className="mt-2 break-words text-xs text-rose-200">{state.error}</p> : null}
    {connectionError ? <p role="alert" className="mt-2 break-words text-[10px] text-amber-100">{connectionError}</p> : null}
  </div>;
}
