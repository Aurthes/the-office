"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Headphones, Mic, Paperclip, Play, SlidersHorizontal, Square, X } from "lucide-react";
import { SessionSettings, type ChatSettings } from "./SessionSettings";
import { SessionContextUsage } from "./SessionContextUsage";
import { useSessionVoice, type SessionVoiceController } from "./useSessionVoice";
import { SessionVoiceCall, SessionVoiceSettings } from "./SessionVoice";
import { SessionQuestions, type SessionQuestionRequest } from "./SessionQuestions";
import { useNativeDictation } from "./useNativeDictation";
import { useDictationShortcut } from "./useDictationShortcut";
import { dictationShortcutLabel } from "./dictationShortcutSettings";
import { useUiText } from "@/lib/i18n/ui-language";

export type SessionAsset = { source: string; name: string; kind: "image" | "markdown" | "html" | "file"; url: string; inline?: boolean; attached?: boolean };
export type LiveSessionItem = { id: string; turnId?: string; source?: "voice"; role: string; phase?: string; content: string; assets?: SessionAsset[]; truncated?: boolean; status?: string; version?: number; timestamp?: number };
export type SessionClient = {
  call: (method: string, params: unknown) => Promise<unknown>;
  onEvent?: (handler: (event: { event: string; payload?: unknown }) => void) => () => void;
  onStatus?: (handler: (status: "connected" | "connecting" | "disconnected") => void) => () => void;
  onGap?: (handler: (gap: { expected: number; received: number }) => void) => () => void;
};
type Approval = { requestId: string; method: string; params: Record<string, unknown>; details?: string; decisions: string[]; supported: boolean; submitted?: boolean };
type Snapshot = { connected: boolean; version: number; hasMore?: boolean; activeTurnId: string | null; turnStatus?: string; error?: string | null; settings?: ChatSettings; features?: { dictation: boolean; dictationHTTP?: boolean; voice: boolean; prediction: boolean; accountVersion?: number }; tokenUsage?: { last: { inputTokens: number; outputTokens: number }; modelContextWindow?: number | null }; items: LiveSessionItem[]; approvals: Approval[]; approvalCount?: number; questions?: SessionQuestionRequest[] };
type StreamSnapshot = Omit<Snapshot, "items"> & { threadId: string; subscriptionId: string;
  items: (LiveSessionItem | (Omit<LiveSessionItem, "content"> & { append: string; baseVersion: number }))[] };
type Upload = { id: string; name: string; size: number; ref?: string; error?: string };
// Closing a conversation is navigation, not a request to discard its draft.
const sessionDrafts = new Map<string, string>();
const attachmentDrafts = new Map<string, Upload[]>();

export function SessionControls({ client, threadId, onItems, voice: sharedVoice }: {
  client: SessionClient;
  threadId: string; onItems: (items: LiveSessionItem[]) => void;
  voice?: SessionVoiceController;
}) {
  const t = useUiText();
  const [state, setState] = useState<Snapshot | null>(null);
  const [prediction, setPrediction] = useState<{ threadId: string; text: string } | null>(null);
  const previousPredictionState = useRef({ threadId, working: false });
  const [text, setTextState] = useState(() => sessionDrafts.get(threadId) || "");
  const setText = useCallback((value: string) => {
    if (value) sessionDrafts.set(threadId, value); else sessionDrafts.delete(threadId);
    setTextState(value);
  }, [threadId]);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useRef<(() => Promise<void>) | null>(null);
  const actionBusy = useRef(false);
  const [uploads, setUploads] = useState<Upload[]>(() => attachmentDrafts.get(threadId) || []);
  const uploadsRef = useRef<Upload[]>(uploads);
  const uploadRequests = useRef(new Map<string, AbortController>());
  const picker = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const suggestedText = prediction?.threadId === threadId && state?.connected && !state.activeTurnId && state.turnStatus === "completed" && !text && !uploads.length ? prediction.text : "";
  useEffect(() => {
    let stopped = false;
    const generationTrigger = previousPredictionState.current.threadId === threadId && previousPredictionState.current.working ? "live" : "catch_up";
    previousPredictionState.current = { threadId, working: Boolean(state?.activeTurnId) };
    setPrediction(null);
    if (!state?.connected || state.features?.prediction === false || state.activeTurnId || state.turnStatus !== "completed") return () => { stopped = true; };
    const requestId = crypto.randomUUID();
    const applyPrediction = (value: unknown) => {
      const result = value as { text?: unknown } | null;
      if (!stopped && typeof result?.text === "string" && result.text.trim() && result.text.length <= 4000) setPrediction({ threadId, text: result.text });
    };
    const unsubscribe = client.onEvent?.(event => {
      if (event.event !== "session.prediction") return;
      const payload = event.payload as { threadId: string; requestId: string; prediction: unknown };
      if (payload?.threadId === threadId && payload.requestId === requestId) applyPrediction(payload.prediction);
    });
    void client.call("session.prediction", { threadId, generationTrigger, requestId }).then(applyPrediction).catch(() => {}); // Suggestions never block the composer or its connection.
    return () => { stopped = true; unsubscribe?.(); };
  }, [client, threadId, state?.connected, state?.activeTurnId, state?.turnStatus, state?.features?.prediction]);
  const resizeInput = useCallback(() => {
    const node = input.current;
    if (!node?.clientWidth) return; // The chat stays mounted behind the character page.
    // Measure outside normal flow so a temporary shrink cannot move the transcript.
    const measure = node.cloneNode(false) as HTMLTextAreaElement;
    measure.removeAttribute("id"); measure.setAttribute("aria-hidden", "true"); measure.tabIndex = -1;
    measure.value = node.value || suggestedText;
    Object.assign(measure.style, { position: "fixed", visibility: "hidden", pointerEvents: "none",
      width: `${node.getBoundingClientRect().width}px`, height: "auto", maxHeight: "none" });
    node.after(measure);
    const height = measure.scrollHeight + measure.offsetHeight - measure.clientHeight;
    measure.remove();
    node.style.height = `${height}px`;
  }, [suggestedText]);
  useLayoutEffect(resizeInput, [text, resizeInput]);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let width = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resizeInput();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [resizeInput]);
  const dictation = useNativeDictation(threadId, text, setText, state?.features?.dictationHTTP ? undefined : client);
  useLayoutEffect(() => {
    if (!dictation.transcriptionTime || dictation.busy) return;
    const node = input.current;
    if (!node || node.disabled || document.hidden || !node.getClientRects().length) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }, [dictation.transcriptionTime, dictation.busy]);
  const localVoice = useSessionVoice(client);
  const voice = sharedVoice || localVoice;
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const recording = dictation.phase === "starting" || dictation.phase === "recording";
  const dictatedSend = useRef<((message: string) => void) | null>(null);
  const stopDictation = async (send = false) => {
    const message = await dictation.stop();
    if (send && message?.trim()) dictatedSend.current?.(message);
  };
  const updateUploads = (next: Upload[]) => { uploadsRef.current = next; if (next.length) attachmentDrafts.set(threadId, next); else attachmentDrafts.delete(threadId); setUploads(next); };
  useEffect(() => {
    const requests = uploadRequests.current;
    return () => {
      for (const request of requests.values()) request.abort();
      const kept = uploadsRef.current.map(file => file.ref || file.error ? file : { ...file, error: "Upload interrupted. Please select the file again." });
      if (kept.length) attachmentDrafts.set(threadId, kept); else attachmentDrafts.delete(threadId);
    };
  }, [threadId]);
  const addFiles = async (files: File[]) => {
    if (actionBusy.current || settingsBusy || !state?.connected) return;
    if (uploadsRef.current.length + files.length > 8) { setError("Up to 8 attachments per message"); return; }
    if (files.some(file => file.size > 20 * 1024 * 1024 || !file.size)) { setError("Attachments must not be empty and must be under 20 MB each"); return; }
    setError(""); setNotice("");
    const added = files.map(file => ({ id: crypto.randomUUID(), name: file.name, size: file.size }));
    updateUploads([...uploadsRef.current, ...added]);
    await Promise.all(files.map(async (file, index) => {
      const id = added[index].id, controller = new AbortController();
      uploadRequests.current.set(id, controller);
      try {
        const response = await fetch("/api/session-uploads?" + new URLSearchParams({ threadId, name: file.name }), { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" }, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Upload failed");
        if (!controller.signal.aborted) updateUploads(uploadsRef.current.map(item => item.id === id ? { ...item, ref: result.ref } : item));
      } catch (cause) {
        if (!controller.signal.aborted) updateUploads(uploadsRef.current.map(item => item.id === id ? { ...item, error: cause instanceof Error ? cause.message : "Upload failed" } : item));
      } finally { uploadRequests.current.delete(id); }
    }));
  };
  const removeFile = (id: string) => { uploadRequests.current.get(id)?.abort(); updateUploads(uploadsRef.current.filter(item => item.id !== id)); };
  const canContinue = Boolean(state?.turnStatus === "interrupted" && !state.activeTurnId && !text.trim() && !uploads.length && !dictation.busy && voice.status === "off");
  const readyToSend = canContinue || Boolean((recording || text.trim() || suggestedText || uploads.length) && uploads.every(file => file.ref) && dictation.phase !== "transcribing");
  const send = () => {
    if (busy || settingsBusy || !state?.connected || !readyToSend) return;
    if (recording) { void stopDictation(true); return; }
    if (canContinue) { void action("session.continue", { requestId: crypto.randomUUID() }); return; }
    const message = text || suggestedText;
    if (!text && suggestedText) setText(suggestedText); // Retain a draft if submission fails.
    setPrediction(null);
    void action("session.send", { message, attachments: uploads.map(file => file.ref), requestId: crypto.randomUUID() });
  };
  const dictationShortcut = useDictationShortcut({ input, phase: dictation.phase, enabled: !busy && !settingsBusy && Boolean(state?.connected) && state?.features?.dictation !== false && voice.status === "off",
    start: dictation.start, stop: submit => submit ? send() : stopDictation(), discard: dictation.discard });
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
      setConnectionError("");
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
          setState(null); setConnectionError(cause instanceof Error ? cause.message : "Live connection failed");
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
      if (method === "session.send") { setText(""); if (!dictation.error) dictation.clear(); updateUploads([]); setNotice("Submitted to the session"); }
      if (method === "session.continue") setNotice("Submitted to the session");
      if (method === "session.stop") setNotice("Stop request submitted");
      if (method === "session.approval.reply") setNotice("Approval reply submitted; waiting for confirmation");
      if (!client.onEvent) await refresh.current?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed. Check the session before retrying."); }
    finally { actionBusy.current = false; setBusy(false); }
  };
  useEffect(() => {
    dictatedSend.current = message => {
      if (!uploadsRef.current.every(file => file.ref)) return;
      setPrediction(null);
      void action("session.send", { message, attachments: uploadsRef.current.map(file => file.ref), requestId: crypto.randomUUID() });
    };
    return () => { dictatedSend.current = null; };
  });
  return <div onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); } }} className="max-h-[60dvh] shrink-0 overflow-y-auto border-t border-white/10 bg-[#111b27] p-3 text-xs [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] md:px-4">
    <div className="mx-auto max-w-3xl">
    {state?.settings ? <SessionSettings key={`${threadId}:${state.features?.accountVersion || 0}`} client={client} threadId={threadId} current={state.settings} disabled={busy || !state.connected || voice.status !== "off"} active={Boolean(state.activeTurnId)} onBusyChange={setSettingsBusy}>
      {state.tokenUsage ? <SessionContextUsage usage={state.tokenUsage} /> : null}
    </SessionSettings> : null}
    <input ref={picker} type="file" multiple className="hidden" aria-label={t("Choose attachments")} onChange={event => { void addFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
    {uploads.length ? <div className="mb-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto" aria-label={t("Pending attachments")}>{uploads.map(file => <div key={file.id} className="flex max-w-full items-center gap-2 rounded-lg border border-white/15 bg-white/5 py-1 pl-2">
      <span className="min-w-0 truncate" title={file.name}>{file.name}</span><span className={file.error ? "text-rose-200" : "shrink-0 text-white/40"}>{file.error ? t(file.error) : (!file.ref ? t("Uploading…") : Math.max(1, Math.ceil(file.size / 1024)) + " KB")}</span>
      <button aria-label={t("Remove attachment {name}", { name: file.name })} disabled={busy} onClick={() => removeFile(file.id)} className="min-h-9 shrink-0 px-2 text-white/60"><X size={14} /></button>
    </div>)}</div> : null}
    {voiceSettingsOpen ? <SessionVoiceSettings client={client} voice={voice} onClose={() => setVoiceSettingsOpen(false)} /> : null}
    {voice.status !== "off" && voice.threadId === threadId ? <div className="mb-3"><SessionVoiceCall voice={voice} /></div> : null}
    {state?.approvals.length ? <div className="mb-3 max-h-[32vh] space-y-3 overflow-y-auto" aria-label={t("Pending approvals")}>
      {state.approvals.map(request => <div key={request.requestId} className="rounded border border-amber-300/40 bg-amber-900/15 p-2">
        <p className="font-semibold text-amber-100">{request.method === "item/fileChange/requestApproval" ? t("File change approval") : request.method === "item/commandExecution/requestApproval" ? t("Command execution approval") : t("This session needs your input")}</p>
        <pre className="my-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] text-white/80">{JSON.stringify({ command: request.params.command, cwd: request.params.cwd, reason: request.params.reason, message: request.params.message, network: request.params.networkApprovalContext, permissions: request.params.permissions || request.params.additionalPermissions, grantRoot: request.params.grantRoot }, null, 2)}{request.details ? `\n${request.details}` : ""}</pre>
        {request.supported ? <div className="flex gap-2">
          <button disabled={busy || request.submitted || !request.decisions.includes("accept")} onClick={() => void action("session.approval.reply", { requestId: request.requestId, decision: "accept" })} className="rounded border border-emerald-300/50 px-3 py-1 text-emerald-100 disabled:opacity-40">{t("Allow once")}</button>
          <button disabled={busy || request.submitted} onClick={() => void action("session.approval.reply", { requestId: request.requestId, decision: request.decisions.includes("decline") ? "decline" : "cancel" })} className="rounded border border-rose-300/50 px-3 py-1 text-rose-100 disabled:opacity-40">{request.decisions.includes("decline") ? t("Decline") : t("Cancel turn")}</button>
        </div> : <p className="text-amber-100">{t("This request is not supported in Office. Stop the task to cancel it.")}</p>}
      </div>)}
      {(state.approvalCount || 0) > state.approvals.length ? <p className="text-amber-100">{t("More requests will appear after these approvals are handled.")}</p> : null}
    </div> : null}
    {state?.questions?.map(request => <SessionQuestions key={threadId + request.requestId} client={client} threadId={threadId} request={request} />)}
    <textarea ref={input} aria-label={t("Send to session")} aria-description={suggestedText ? t("Suggested next message. Tab to edit, or Send to submit.") : undefined} placeholder={suggestedText || t("Continue this Codex session…")} rows={1} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => {
      if (suggestedText && !event.nativeEvent.isComposing && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.key === "Tab") { event.preventDefault(); setText(suggestedText); setPrediction(null); return; }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setPrediction(null); return; }
      }
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
    }} onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); void addFiles(Array.from(event.clipboardData.files)); } }} disabled={busy || settingsBusy || !state?.connected || dictation.busy} className="session-composer-input w-full resize-none overflow-y-auto rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-base leading-6 text-white placeholder:text-white/35 focus:border-cyan-300/50 focus:outline-none disabled:opacity-50" />
    <div className="session-composer-actions mt-2 flex items-center justify-between gap-2">
      <div className="flex shrink-0 items-center gap-1">
        {dictation.busy ? <button aria-label={t("Cancel recording")} title={t("Cancel recording (Esc)")} onClick={dictation.discard} className="grid h-10 w-10 place-items-center rounded-lg text-white/65 hover:bg-white/5"><X size={19} /></button> :
          <button aria-label={t("Add attachments")} title={t("Add attachments, drag files, or paste images")} disabled={busy || settingsBusy || !state?.connected} onClick={() => picker.current?.click()} className="grid h-10 w-10 place-items-center rounded-lg text-white/65 hover:bg-white/5 disabled:opacity-40"><Paperclip size={19} /></button>}
        <button aria-label={recording ? t("Stop recording and transcribe") : t("Dictation")} title={state?.features?.dictation === false ? t("Dictation needs an OpenAI API key on the Office server") : dictationShortcut === "off" ? t("Click to record. Enter: transcribe and send. Esc: cancel.") : t("Click to record. {shortcut}: tap to toggle, hold to dictate. Enter: transcribe and send. Esc: cancel.", { shortcut: dictationShortcutLabel(dictationShortcut) })} disabled={state?.features?.dictation === false || dictation.phase === "transcribing" || (!recording && (busy || settingsBusy || !state?.connected || voice.status !== "off"))} onClick={() => { if (recording) void stopDictation(); else void dictation.start(); }} className={"grid h-10 w-10 place-items-center rounded-lg disabled:opacity-40 " + (dictation.phase === "recording" ? "animate-pulse bg-rose-900/40 text-rose-200" : "text-white/65 hover:bg-white/5")}><Mic size={19} /></button>
        {!dictation.busy ? <button aria-label={t("Voice chat")} title={state?.features?.voice === false ? t("Live voice is not connected to the Office runtime yet") : t("Start an experimental voice call in this session")} disabled={state?.features?.voice === false || busy || settingsBusy || !state?.connected || dictation.busy || voice.status !== "off"} onClick={() => void voice.start(threadId)} className="grid h-10 w-10 place-items-center rounded-lg text-white/65 hover:bg-white/5 disabled:opacity-40"><Headphones size={19} /></button> : null}
        {state?.features?.voice !== false ? <button aria-label={t("Voice settings")} aria-expanded={voiceSettingsOpen} title={t("Voice settings")} onClick={() => setVoiceSettingsOpen(value => !value)} className="grid h-10 w-10 place-items-center rounded-lg text-white/65 hover:bg-white/5"><SlidersHorizontal size={18} /></button> : null}
      </div>
      {dictation.busy ? <span role="status" className="min-w-0 flex-1 truncate text-xs text-rose-200">
        {dictation.phase === "starting" ? t("Preparing microphone…") : dictation.phase === "transcribing" ? t("Transcribing…") : t("Recording · {time}", { time: `${Math.floor(dictation.seconds / 60)}:${String(Math.floor(dictation.seconds % 60)).padStart(2, "0")}` })}
      </span> : <span className="hidden min-w-0 flex-1 truncate text-xs text-white/45 sm:block">{state?.connected ? state.activeTurnId ? t("Codex is working…") : state.turnStatus === "interrupted" ? t("Stopped") : t("Codex · Connected") : connectionError ? t("Codex unavailable") : t("Connecting to Codex…")}</span>}
      <div className="flex shrink-0 items-center gap-2">
        {!state?.settings && state?.tokenUsage ? <SessionContextUsage usage={state.tokenUsage} above /> : null}
        {state?.activeTurnId && !dictation.busy ? <button aria-label={t("Stop")} title={t("Stop")} disabled={busy || settingsBusy} onClick={() => void action("session.stop", {})} className="grid h-10 w-10 place-items-center rounded-lg text-rose-200 hover:bg-white/5 disabled:opacity-40"><Square size={15} fill="currentColor" aria-hidden="true" /></button> : null}
        <button aria-label={canContinue ? t("Continue interrupted task") : recording ? t("Transcribe and send") : undefined} title={canContinue ? t("Continue interrupted task") : recording ? t("Transcribe and send (Enter)") : undefined} disabled={busy || settingsBusy || !state?.connected || !readyToSend} onClick={send} className="min-h-10 rounded-lg bg-cyan-700 px-4 text-sm text-white disabled:opacity-40">{busy ? t("Submitting…") : canContinue ? <Play size={18} fill="currentColor" aria-hidden="true" /> : dictation.busy ? t("Send") : state?.activeTurnId ? t("Steer") : t("Send")}</button>
      </div>
    </div>

    {dictation.clip && !dictation.busy ? <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-white/55"><span>{t("Recording: {seconds} seconds · Kept", { seconds: Math.ceil(dictation.clip.seconds) })}</span>{dictation.transcriptionTime ? <span>{t(dictation.transcriptionTime.retry ? "Retry took {seconds} seconds" : "Transcription took {seconds} seconds", { seconds: dictation.transcriptionTime.seconds.toFixed(1) })}</span> : null}{dictation.phase === "error" ? <button className="text-cyan-200 underline" onClick={() => void dictation.retry()}>{t("Retry transcription")}</button> : null}<button className="underline" onClick={dictation.download}>{t("Download recording")}</button><button className="underline" onClick={dictation.clear}>{t("Clear recording")}</button></div> : null}
    {dictation.error ? <p role="alert" className="mt-1 text-xs text-amber-100">{t(dictation.error)}</p> : null}
    {notice ? <p role="status" className="mt-2 text-[10px] text-cyan-100">{t(notice)}</p> : null}
    {voice.error && voice.threadId === threadId ? <p role="alert" className="mt-2 break-words text-xs text-amber-100">{t(voice.error)}</p> : null}
    {error ? <p role="alert" className="mt-2 break-words text-[10px] text-amber-100">{t(error)}</p> : null}
    {state?.error ? <p role="alert" className="mt-2 break-words text-xs text-rose-200">{state.error}</p> : null}
    {connectionError ? <p role="alert" className="mt-2 break-words text-[10px] text-amber-100">{t(connectionError)} <button className="underline" onClick={() => void refresh.current?.()}>{t("Reconnect")}</button></p> : null}
    </div>
  </div>;
}
