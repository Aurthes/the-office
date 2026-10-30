"use client";
import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, Paperclip, PhoneOff, X } from "lucide-react";
import { SessionSettings, type ChatSettings } from "./SessionSettings";
import { useSessionVoice } from "./useSessionVoice";
import { SessionQuestions, type SessionQuestionRequest } from "./SessionQuestions";
import { useDictation } from "./useDictation";

export type SessionAsset = { source: string; name: string; kind: "image" | "markdown" | "html" | "file"; url: string; inline?: boolean; attached?: boolean };
export type LiveSessionItem = { id: string; turnId?: string; role: string; phase?: string; content: string; assets?: SessionAsset[]; truncated?: boolean; status?: string; version?: number; timestamp?: number };
export type SessionClient = {
  call: (method: string, params: unknown) => Promise<unknown>;
  onEvent?: (handler: (event: { event: string; payload?: unknown }) => void) => () => void;
  onStatus?: (handler: (status: "connected" | "connecting" | "disconnected") => void) => () => void;
  onGap?: (handler: (gap: { expected: number; received: number }) => void) => () => void;
};
type Approval = { requestId: string; method: string; params: Record<string, unknown>; details?: string; decisions: string[]; supported: boolean; submitted?: boolean };
type Snapshot = { connected: boolean; version: number; hasMore?: boolean; activeTurnId: string | null; turnStatus?: string; error?: string | null; settings?: ChatSettings; items: LiveSessionItem[]; approvals: Approval[]; approvalCount?: number; questions?: SessionQuestionRequest[] };
type StreamSnapshot = Omit<Snapshot, "items"> & { threadId: string; subscriptionId: string;
  items: (LiveSessionItem | (Omit<LiveSessionItem, "content"> & { append: string; baseVersion: number }))[] };
type Upload = { id: string; name: string; size: number; ref?: string; error?: string };

export function SessionControls({ client, threadId, onItems }: {
  client: SessionClient;
  threadId: string; onItems: (items: LiveSessionItem[]) => void;
}) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useRef<(() => Promise<void>) | null>(null);
  const actionBusy = useRef(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const uploadsRef = useRef<Upload[]>([]);
  const uploadRequests = useRef(new Map<string, AbortController>());
  const picker = useRef<HTMLInputElement>(null);
  const dictation = useDictation(setText, text);
  const voice = useSessionVoice(client, threadId);
  const updateUploads = (next: Upload[]) => { uploadsRef.current = next; setUploads(next); };
  useEffect(() => {
    const requests = uploadRequests.current;
    return () => { for (const request of requests.values()) request.abort(); };
  }, []);
  const addFiles = async (files: File[]) => {
    if (actionBusy.current || settingsBusy || !state?.connected) return;
    if (uploadsRef.current.length + files.length > 8) { setError("每次最多 8 个附件"); return; }
    if (files.some(file => file.size > 20 * 1024 * 1024 || !file.size)) { setError("附件不能为空，每个最多 20 MB"); return; }
    setError(""); setNotice("");
    const added = files.map(file => ({ id: crypto.randomUUID(), name: file.name, size: file.size }));
    updateUploads([...uploadsRef.current, ...added]);
    await Promise.all(files.map(async (file, index) => {
      const id = added[index].id, controller = new AbortController();
      uploadRequests.current.set(id, controller);
      try {
        const response = await fetch("/api/session-uploads?" + new URLSearchParams({ threadId, name: file.name }), { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" }, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "上传失败");
        if (!controller.signal.aborted) updateUploads(uploadsRef.current.map(item => item.id === id ? { ...item, ref: result.ref } : item));
      } catch (cause) {
        if (!controller.signal.aborted) updateUploads(uploadsRef.current.map(item => item.id === id ? { ...item, error: cause instanceof Error ? cause.message : "上传失败" } : item));
      } finally { uploadRequests.current.delete(id); }
    }));
  };
  const removeFile = (id: string) => { uploadRequests.current.get(id)?.abort(); updateUploads(uploadsRef.current.filter(item => item.id !== id)); };
  const shortcutAllowed = useRef(false);
  useEffect(() => { shortcutAllowed.current = Boolean(state?.connected && !busy && !settingsBusy && voice.status === "off"); }, [state?.connected, busy, settingsBusy, voice.status]);
  useEffect(() => {
    let held = false;
    const down = (event: KeyboardEvent) => {
      if (!shortcutAllowed.current || event.key !== "Alt" || event.repeat || held || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && (event.target.tagName === "INPUT" || event.target.isContentEditable)) return;
      held = true; event.preventDefault(); dictation.start();
    };
    const up = (event: KeyboardEvent) => { if (event.key === "Alt" && held) { held = false; event.preventDefault(); dictation.stop(); } };
    const blur = () => { if (held) { held = false; dictation.stop(); } };
    window.addEventListener("keydown", down, true); window.addEventListener("keyup", up, true); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", blur); blur(); };
  }, [dictation.start, dictation.stop]);
  const readyToSend = Boolean((text.trim() || uploads.length) && uploads.every(file => file.ref) && !dictation.listening);
  const send = () => { if (readyToSend) void action("session.send", { message: text, attachments: uploads.map(file => file.ref), requestId: crypto.randomUUID() }); };
  useEffect(() => {
    let stopped = false, pending = false, retry = false, connected = true, version = -1;
    let subscriptionId: string | null = null;
    const items = new Map<string, LiveSessionItem>();
    const apply = (result: StreamSnapshot | Snapshot) => {
      if (stopped || result.version <= version) return;
      const changed: LiveSessionItem[] = [];
      for (const item of result.items) {
        if ("append" in item) {
          const previous = items.get(item.id);
          const { append, baseVersion, ...metadata } = item;
          if (!previous || previous.version !== baseVersion) { void subscribe(); return; }
          changed.push({ ...previous, ...metadata, content: previous.content + append });
        } else changed.push(item);
      }
      for (const item of changed) items.set(item.id, item);
      while (items.size > 128) items.delete(items.keys().next().value!);
      version = result.version; setState({ ...result, items: changed }); setConnectionError("");
      if (changed.length) onItems(changed);
    };
    const subscribe = async () => {
      if (stopped || !connected) return;
      if (pending) { retry = true; return; }
      pending = true; retry = false; version = -1; items.clear();
      const id = crypto.randomUUID(); subscriptionId = id;
      try {
        if (client.onEvent) await client.call("session.subscribe", { threadId, subscriptionId: id });
        else {
          // One-time compatibility snapshot for clients without event support;
          // no polling loop. The live browser always uses the subscription.
          const snapshot = await client.call("session.attach", { threadId }) as Snapshot;
          if (subscriptionId === id) apply(snapshot);
        }
      } catch (cause) {
        if (!stopped && subscriptionId === id) {
          setState(null); setConnectionError(cause instanceof Error ? cause.message : "实时连接失败");
        }
      } finally {
        pending = false;
        if (retry && !stopped) { retry = false; void subscribe(); }
      }
    };
    const unsubscribeEvent = client.onEvent?.(event => {
      if (event.event !== "session.stream") return;
      const result = event.payload as StreamSnapshot;
      if (result?.threadId === threadId && result.subscriptionId === subscriptionId) apply(result);
    });
    const unsubscribeStatus = client.onStatus?.(status => {
      connected = status === "connected";
      if (connected) void subscribe();
      else { subscriptionId = null; setState(null); }
    });
    const unsubscribeGap = client.onGap?.(() => { void subscribe(); });
    const onVisible = () => { if (document.visibilityState === "visible") void subscribe(); };
    refresh.current = subscribe;
    if (!pending && !subscriptionId) void subscribe();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true; refresh.current = null;
      unsubscribeEvent?.(); unsubscribeStatus?.(); unsubscribeGap?.();
      document.removeEventListener("visibilitychange", onVisible);
      if (client.onEvent && subscriptionId) void client.call("session.unsubscribe", { threadId, subscriptionId }).catch(() => {});
    };
  }, [client, threadId, onItems]);
  const action = async (method: string, params: object) => {
    if (actionBusy.current || settingsBusy || !state?.connected) return;
    actionBusy.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      await client.call(method, { threadId, ...params });
      if (method === "session.send") { setText(""); updateUploads([]); setNotice("已提交到原会话"); }
      if (method === "session.stop") setNotice("停止请求已提交");
      if (method === "session.approval.reply") setNotice("审批答复已提交，等待后台确认");
      if (!client.onEvent) await refresh.current?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请核对原会话后再试"); }
    finally { actionBusy.current = false; setBusy(false); }
  };
  return <div onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); } }} className="max-h-[60dvh] shrink-0 overflow-y-auto border-t border-white/10 bg-[#111b27] p-3 text-xs [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] md:px-4">
    <div className="mx-auto max-w-3xl">
    {state?.settings ? <SessionSettings key={threadId} client={client} threadId={threadId} current={state.settings} disabled={busy || !state.connected} active={Boolean(state.activeTurnId)} onBusyChange={setSettingsBusy} /> : null}
    <input ref={picker} type="file" multiple className="hidden" aria-label="选择附件" onChange={event => { void addFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
    {uploads.length ? <div className="mb-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto" aria-label="待发送附件">{uploads.map(file => <div key={file.id} className="flex max-w-full items-center gap-2 rounded-lg border border-white/15 bg-white/5 py-1 pl-2">
      <span className="min-w-0 truncate" title={file.name}>{file.name}</span><span className={file.error ? "text-rose-200" : "shrink-0 text-white/40"}>{file.error || (!file.ref ? "上传中…" : Math.max(1, Math.ceil(file.size / 1024)) + " KB")}</span>
      <button aria-label={"移除附件 " + file.name} disabled={busy} onClick={() => removeFile(file.id)} className="min-h-9 shrink-0 px-2 text-white/60"><X size={14} /></button>
    </div>)}</div> : null}
    {voice.status !== "off" ? <section aria-label="语音通话" className="mb-3 rounded-xl border border-cyan-300/30 bg-cyan-950/30 p-3">
      <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-cyan-100"><span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />{voice.status === "connecting" ? "正在连接 Codex 语音…" : "正在与 Codex 通话"}</span><button onClick={voice.stop} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-rose-200"><PhoneOff size={16} />结束</button></div>
      {voice.captions.length ? <div className="mt-2 max-h-24 space-y-1 overflow-y-auto text-xs text-white/70">{voice.captions.map((line, index) => <p key={index}><span className="text-white/40">{line.role === "user" ? "你" : "Codex"}：</span>{line.text}</p>)}</div> : <p className="text-[11px] text-white/40">同一条原会话 · 可随时开口 · 离开聊天会结束通话</p>}
      {voice.playbackBlocked ? <button onClick={() => void voice.play()} className="mt-2 rounded border border-cyan-300/40 px-3 py-2 text-cyan-100">播放声音</button> : null}
    </section> : null}
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
    {state?.questions?.map(request => <SessionQuestions key={threadId + request.requestId} client={client} threadId={threadId} request={request} />)}
    <textarea aria-label="发送到原会话" placeholder="继续同一条 Codex 会话…" rows={2} maxLength={16000} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
    }} onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); void addFiles(Array.from(event.clipboardData.files)); } }} disabled={busy || settingsBusy || !state?.connected || dictation.listening} className="max-h-36 min-h-14 w-full resize-none rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-base leading-6 text-white placeholder:text-white/35 focus:border-cyan-300/50 focus:outline-none disabled:opacity-50" />
    <div className="mt-2 flex items-center justify-between gap-2">
      <div className="flex shrink-0 items-center gap-1">
        <button aria-label="添加附件" title="添加附件，也可拖入文件或粘贴图片" disabled={busy || settingsBusy || !state?.connected} onClick={() => picker.current?.click()} className="grid h-10 w-10 place-items-center rounded-lg text-white/65 hover:bg-white/5 disabled:opacity-40"><Paperclip size={19} /></button>
        <button aria-label={dictation.listening ? "停止听写" : "听写"} title="听写到当前输入框：按住 Option 说话，松开结束；检查文字后发送" disabled={busy || settingsBusy || !state?.connected || voice.status !== "off"} onClick={dictation.listening ? dictation.stop : dictation.start} className={"grid h-10 w-10 place-items-center rounded-lg hover:bg-white/5 disabled:opacity-40 " + (dictation.listening ? "animate-pulse bg-rose-900/40 text-rose-200" : "text-white/65")}><Mic size={19} /></button>
        <button aria-label="语音对话" title="与此会话实时语音对话" disabled={busy || settingsBusy || !state?.connected || dictation.listening || voice.status !== "off"} onClick={() => void voice.start()} className="grid h-10 w-10 place-items-center rounded-lg text-white/65 hover:bg-white/5 disabled:opacity-40"><Headphones size={19} /></button>
      </div>
      <span className="hidden min-w-0 flex-1 truncate text-xs text-white/45 sm:block">{state?.connected ? state.activeTurnId ? "Codex 正在工作…" : state.turnStatus === "interrupted" ? "已停止" : "Codex · 已连接" : "连接 Codex…"}</span>
      <div className="flex shrink-0 items-center gap-2">
        {state?.activeTurnId ? <button disabled={busy || settingsBusy} onClick={() => void action("session.stop", {})} className="min-h-10 rounded-lg px-3 text-sm text-rose-200 hover:bg-white/5 disabled:opacity-40">停止</button> : null}
        <button disabled={busy || settingsBusy || !state?.connected || !readyToSend} onClick={send} className="min-h-10 rounded-lg bg-cyan-700 px-4 text-sm text-white disabled:opacity-40">{busy ? "提交中…" : state?.activeTurnId ? "追加消息" : "发送"}</button>
      </div>
    </div>
    {notice ? <p role="status" className="mt-2 text-[10px] text-cyan-100">{notice}</p> : null}
    {dictation.listening ? <p role="status" className="mt-2 text-xs text-cyan-100">{dictation.phase === "starting" ? "正在启动听写，请稍候再说话…" : dictation.phase === "finishing" ? "正在收尾识别，请稍候…" : "正在听写 · 松开 Option 或点麦克风结束，检查文字后发送"}</p> : dictation.notice ? <p role="status" className="mt-2 text-xs text-white/60">{dictation.notice}</p> : null}
    {dictation.error || voice.error ? <p role="alert" className="mt-2 break-words text-xs text-amber-100">{dictation.error || voice.error}</p> : null}
    {error ? <p role="alert" className="mt-2 break-words text-[10px] text-amber-100">{error}</p> : null}
    {state?.error ? <p role="alert" className="mt-2 break-words text-xs text-rose-200">{state.error}</p> : null}
    {connectionError ? <p role="alert" className="mt-2 break-words text-[10px] text-amber-100">{connectionError} <button className="underline" onClick={() => void refresh.current?.()}>重新连接</button></p> : null}
    </div>
  </div>;
}
