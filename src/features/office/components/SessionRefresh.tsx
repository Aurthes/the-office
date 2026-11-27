"use client";
import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { LockKeyhole, X } from "lucide-react";
import { SessionTaskContext } from "./SessionTaskContext";
import { SessionTranscript } from "./SessionTranscript";
import type { LiveSessionItem, SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";

export type RefreshIntent = { checkpointId: string; independentNewTopic: true };
type Operation = { id: string; status: string; reason?: string; reasons?: string[]; conversationVersion?: number };
type Status = { threadId: string; conversationVersion: number; stateRevision: number | null; lastTurnId: string | null; preparing: boolean; blockers: string[]; checkpoint: { id: string; version: number; invalidated?: boolean; consumedBy?: string } | null; operation: Operation | null; nextRequest?: { id: string } | null; conversations: { version: number; current: boolean; retiredAt?: number; turnCount?: number }[] };
const stateLabels: Record<string, string> = { focus: "Current focus", decisions: "Key conclusions and reasons", followUp: "Responsibilities and next decisions", links: "Tasks and original sources" };
type State = { id: string; revision: number; sections: Record<string, string> };
// An overlay keeps the composer, file preview and Workspace mounted. A lost
// acknowledgement is inspected by the original operation ID, never retried.
export function SessionRefresh({ client, threadId, onClose, intent, onIntent, onOpenAgentState }: { client: SessionClient; threadId: string; onClose: () => void; intent?: RefreshIntent; onIntent: (intent?: RefreshIntent) => void; onOpenAgentState?: () => void }) {
  const openTask = useContext(SessionTaskContext), requirementsId = useId();
  const t = useUiText(), [status, setStatus] = useState<Status | null>(null), [saved, setSaved] = useState<State | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [verified, setVerified] = useState(false), [receiptNeeded, setReceiptNeeded] = useState(false);
  const [history, setHistory] = useState<{ version: number; messages: LiveSessionItem[]; nextCursor: string | null } | null>(null);
  const alive = useRef(true), owner = useRef(threadId), sequence = useRef(0), operationId = useRef<string | undefined>(undefined), root = useRef<HTMLElement>(null);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const [next, state] = await Promise.all([client.call("session.refresh.status", { threadId, requestId: operationId.current }), client.call("agent.state.get", { actorId: threadId, agentId: threadId })]) as [Status, State];
      if (!alive.current || request !== sequence.current || owner.current !== threadId) return;
      if (next.threadId !== threadId || state.id !== threadId) throw Error("The employee changed. Reopen refresh for the current employee.");
      setStatus(next); setSaved(state); setReceiptNeeded(next.preparing); setError("");
    } catch (cause) { if (alive.current && request === sequence.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [client, threadId]);
  useEffect(() => { alive.current = true; owner.current = threadId; void reload(); return () => { alive.current = false; }; }, [reload, threadId]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => previous?.focus();
  }, []);
  const act = async (checkpoint: boolean) => {
    if (busy || receiptNeeded || !status || !saved || !verified || status.blockers.length || !hasSavedState || stateChanged) return;
    setBusy(true); setError("");
    const requestId = crypto.randomUUID(); operationId.current = checkpoint ? undefined : requestId;
    try {
      const result = await client.call(checkpoint ? "session.refresh.checkpoint" : "session.refresh", {
        threadId, requestId, expectedVersion: status.conversationVersion, stateRevision: saved.revision,
        stateVerified: true, noUntrackedWork: true, noPendingReports: true,
        ...(checkpoint ? { turnId: status.lastTurnId, closedScope: { kind: "conversation" } } : {}),
      }) as Operation;
      if (!alive.current || owner.current !== threadId) return;
      if (checkpoint) onIntent({ checkpointId: result.id, independentNewTopic: true });
      else if (result.status === "completed") onIntent(undefined);
      setVerified(false); await reload();
    } catch (cause) { if (alive.current && owner.current === threadId) { setVerified(false); setReceiptNeeded(true); setError((cause instanceof Error ? cause.message : String(cause)) + " · Check the operation receipt before trying another refresh."); } }
    finally { if (alive.current && owner.current === threadId) setBusy(false); }
  };
  const read = async (version: number, cursor?: string) => {
    if (busy) return; setBusy(true); setError("");
    try {
      const page = await client.call("session.history", { threadId, conversationVersion: version, limit: 40, ...(cursor ? { cursor } : {}) }) as { messages: LiveSessionItem[]; nextCursor: string | null };
      if (alive.current && owner.current === threadId) setHistory(previous => ({ version, messages: cursor && previous?.version === version ? [...page.messages, ...previous.messages] : page.messages, nextCursor: page.nextCursor }));
    } catch (cause) { if (alive.current && owner.current === threadId) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive.current && owner.current === threadId) setBusy(false); }
  };
  const pending = busy || receiptNeeded || status?.preparing;
  const hasSavedState = !!saved && saved.revision > 0 && Object.values(saved.sections).some(value => value.trim());
  const stateChanged = !!saved && saved.revision !== status?.stateRevision;
  const blocked = !!status && (status.blockers.length > 0 || !hasSavedState || stateChanged);
  // These are links to authoritative task codes, never a rule for permitting refresh.
  const taskCodes = [...new Set(status?.blockers.flatMap(reason => reason.match(/\bT[1-9]\d*\b/g) || []) || [])];
  const actionStyle = blocked ? { opacity: 0.4, cursor: "not-allowed", background: "transparent", borderStyle: "dashed" } : undefined;
  return <section ref={root} role="dialog" aria-modal="true" aria-label={t("Refresh session")} tabIndex={-1} className="absolute inset-0 z-40 flex min-h-0 min-w-0 flex-col bg-[var(--background)] text-[var(--foreground)]" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") {
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-current/15 p-3"><strong>{t("Refresh session")}</strong><button type="button" aria-label={t("Close")} onClick={onClose}><X size={20} /></button></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-sm">
      <p>{t("Keep this employee, saved State, Notes and tasks. Start a clean conversation; previous conversations remain read only. Ordinary messages keep using the current conversation.")}</p>
      {error ? <p role="alert" className="text-amber-500">{t(error)}</p> : null}
      {!status ? <p role="status">{t("Loading…")}</p> : <>
        <p>{t("Conversation")} v{status.conversationVersion} · {t("Agent State")} r{saved?.revision ?? "?"}</p>
        <details><summary>{t("Review saved Agent State")}</summary>{saved ? Object.entries(saved.sections).map(([key, value]) => <div key={key} className="mt-2"><strong>{t(stateLabels[key] || key)}</strong><p className="whitespace-pre-wrap break-words">{value || t("Empty")}</p></div>) : t("Unavailable")}</details>
        <div id={requirementsId} role="status" aria-live="polite" className="rounded-lg border border-current/25 p-3">
          <strong>{t(blocked ? status.operation ? "Refresh unavailable" : "Not refreshed — requirements are not met" : pending ? "Checking refresh status…" : verified ? "Ready to refresh" : "Review and confirm before refreshing")}</strong>
          {blocked ? <>
            <p className="mt-1">{t("No refresh will run until these requirements are resolved. Checking the confirmation box does not override them.")}</p>
            <ul className="mt-2 list-disc pl-5">{status.blockers.map(reason => <li key={reason}>{t(reason)}</li>)}
              {!hasSavedState ? <li>{t("Save a nonempty Agent State for this employee, then review the saved revision.")}</li> : null}
              {stateChanged ? <li>{t("Saved State changed. Check status again and review the latest revision.")}</li> : null}
            </ul>
          </> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {onOpenAgentState ? <button type="button" className="session-action-back" disabled={busy || status.preparing} onClick={onOpenAgentState}>{t(hasSavedState ? "View or edit Agent State" : "Save Agent State in Workspace")}</button> : null}
            {taskCodes.map(code => openTask ? <button type="button" key={code} className="session-action-back" disabled={busy} onClick={() => { onClose(); openTask(code); }}>{t("View task")} {code}</button> : <span key={code}>{t("View task")} {code} · {t("Task board")}</span>)}
          </div>
        </div>
        <label className="flex items-start gap-2"><input type="checkbox" checked={verified} disabled={pending || !hasSavedState || stateChanged} onChange={event => setVerified(event.target.checked)} /><span>{t("I reviewed this saved State. The current scope is concluded, with no unrecorded work or pending reports.")}</span></label>
        <div className="flex flex-wrap gap-2"><button type="button" aria-describedby={requirementsId} title={blocked ? t("Resolve the requirements above before refreshing") : undefined} style={actionStyle} className="session-action-back" disabled={pending || !verified || blocked} onClick={() => void act(false)}>{blocked ? <LockKeyhole size={14} aria-hidden="true" /> : null}{t("Refresh now")}</button><button type="button" aria-describedby={requirementsId} style={actionStyle} className="session-action-back" disabled={pending || !verified || blocked || !status.lastTurnId} onClick={() => void act(true)}>{t("Checkpoint · next message is a new topic")}</button><button type="button" className="session-action-back" disabled={busy} onClick={() => { setBusy(true); setVerified(false); void reload().finally(() => { if (alive.current) setBusy(false); }); }}>{t("Check status")}</button></div>
        {intent ? <p role="status">{t("Only your next submitted message carries the independent new-topic intent. Safety gates may keep the current conversation.")} <button type="button" className="underline" onClick={() => onIntent(undefined)}>{t("Cancel intent")}</button></p> : null}
        {status.nextRequest ? <p role="status">{t("An exact next-topic input is reserved. Inspect its send receipt; use Stop to cancel the reservation. Do not send a replacement blindly.")}</p> : null}
        {status.operation ? <p role="status">{t("Refresh operation")}: {status.operation.status}{status.operation.reason ? ` · ${status.operation.reason}` : ""}{status.operation.reasons?.map(reason => ` · ${reason}`).join("")}</p> : null}
        <h3>{t("Previous conversations · Read only")}</h3><div className="flex flex-wrap gap-2">{status.conversations.filter(entry => !entry.current).map(entry => <button type="button" className="session-action-back" disabled={busy} key={entry.version} onClick={() => void read(entry.version)}>v{entry.version} · {entry.turnCount} {t("turns")}</button>)}</div>
        {history ? <div className="space-y-3"><p>{t("Read only")} · v{history.version}</p>{history.nextCursor ? <button type="button" disabled={busy} onClick={() => void read(history.version, history.nextCursor!)}>{t("Load earlier messages")}</button> : null}<SessionTranscript messages={history.messages} /></div> : null}
      </>}
    </div>
  </section>;
}
