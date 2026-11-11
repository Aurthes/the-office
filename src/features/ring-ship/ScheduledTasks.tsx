"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Check, ChevronLeft, Clock3, Edit3, MessageSquare, Pause, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { useUiText } from "@/lib/i18n/ui-language";
import "./scheduled-tasks.css";

type Run = { id: string; scheduledAt: number; status: "waiting" | "dispatching" | "running" | "completed" | "failed" | "unknown"; error: string | null; manual: boolean; finishedAt: number | null };
export type ScheduledTask = { id: string; name: string; threadId: string; prompt: string; intervalMinutes?: number; firstRunAt?: number; invocations?: number[]; lastInvocationAt?: number | null; nextRunAt: number | null; enabled: boolean; sessionName: string | null; targetAvailable: boolean; runs: Run[] };
type Snapshot = { tasks: ScheduledTask[]; sessions: { id: string; name: string; project: string }[] };
type Draft = { id?: string; name: string; threadId: string; prompt: string; interval: number; unit: number; firstRun: string; mode: "specified" | "recurring"; times: string[]; enabled: boolean };
export const labels = { waiting: "Waiting", dispatching: "Sending", running: "Running", completed: "Completed", failed: "Failed", unknown: "Check conversation" };
export const inProgress = (run?: Run) => !!run && ["waiting", "dispatching", "running"].includes(run.status);
const dateInput = (time: number, precise = false) => {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60000).toISOString().slice(0, precise ? 23 : 16);
};
export const scheduleModeLabel = (task: ScheduledTask) => task.invocations === undefined ? "Repeating" : task.invocations.length === 1 ? "One-time" : "Specific times";
export const scheduleIdleLabel = (task: ScheduledTask) => !task.enabled ? "Paused" : task.invocations !== undefined && task.nextRunAt === null ? "No remaining times" : "Enabled";
export const stamp = (time: number | null | undefined) => time == null ? "—" : dateInput(time).replace("T", " ");

export function ScheduledTasks({ open, onClose, onOpenSession, client, connected }: {
  open: boolean; onClose: () => void; onOpenSession: (id: string) => void;
  client?: Pick<GatewayClient, "call" | "onEvent">; connected: boolean;
}) {
  const t = useUiText(), dialog = useRef<HTMLDialogElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({ tasks: [], sessions: [] });
  const [draft, setDraft] = useState<Draft | null>(null), [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const mountedOpen = useRef(false);
  const pendingOperation = useRef<{ key: string; requestId: string } | null>(null);
  useEffect(() => { setPortal(document.body); }, []);
  useEffect(() => {
    mountedOpen.current = open;
    const node = dialog.current;
    if (open && !node?.open) node?.showModal();
    if (!open) { if (node?.open) node.close(); setDraft(null); setDeleting(null); }
    return () => { mountedOpen.current = false; };
  }, [open, portal]);
  useEffect(() => {
    if (!open || !client || !connected) { setLoading(false); return; }
    let stopped = false, pending = false, dirty = false;
    const load = async () => {
      if (pending) { dirty = true; return; }
      pending = true; setLoading(true);
      try {
        const data = await client.call<Snapshot>("schedule.list", {});
        if (!Array.isArray(data.tasks) || !Array.isArray(data.sessions)) throw new Error("Scheduled tasks are not available on this gateway.");
        if (!stopped) { setSnapshot(data); setError(""); }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : "Could not load scheduled tasks."); }
      finally { pending = false; if (!stopped) { setLoading(false); if (dirty) { dirty = false; void load(); } } }
    };
    void load();
    const unsubscribe = client.onEvent(event => { if (event.event === "schedules.updated") void load(); });
    return () => { stopped = true; unsubscribe(); };
  }, [open, client, connected, revision]);
  const mutate = useCallback(async (method: string, params: object) => {
    if (!client || !connected) return false;
    setSaving(true); setError("");
    try {
      const key = JSON.stringify({ method, params });
      if (pendingOperation.current?.key !== key) pendingOperation.current = { key, requestId: crypto.randomUUID() };
      await client.call(method, { ...params, requestId: pendingOperation.current.requestId });
      pendingOperation.current = null;
      if (mountedOpen.current) { setRevision(value => value + 1); setDeleting(null); }
      return true;
    } catch (cause) { if (mountedOpen.current) setError(cause instanceof Error ? cause.message : "The operation could not be confirmed. Refresh and check the task before retrying."); return false; }
    finally { setSaving(false); }
  }, [client, connected]);
  const config = (task: ScheduledTask) => ({ id: task.id, name: task.name, threadId: task.threadId, prompt: task.prompt, ...(task.invocations === undefined ? { intervalMinutes: task.intervalMinutes, firstRunAt: task.firstRunAt } : { invocations: task.invocations }), enabled: task.enabled });
  const edit = (task?: ScheduledTask) => {
    setError(""); setDeleting(null);
    const minutes = task?.intervalMinutes || 60, unit = minutes % 1440 === 0 ? 1440 : minutes % 60 === 0 ? 60 : 1;
    setDraft({ id: task?.id, name: task?.name || "", threadId: task?.threadId || snapshot.sessions[0]?.id || "", prompt: task?.prompt || "", interval: minutes / unit, unit, firstRun: dateInput(task?.firstRunAt ?? (Math.floor(Date.now() / 3600000) + 1) * 3600000), mode: task?.invocations !== undefined || !task ? "specified" : "recurring", times: task?.invocations?.map(time => dateInput(time, true)) ?? [dateInput((Math.floor(Date.now() / 3600000) + 1) * 3600000)], enabled: task?.enabled ?? true });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!draft) return;
    const firstRunAt = new Date(draft.firstRun).getTime(), intervalMinutes = draft.interval * draft.unit;
    if (draft.mode === "recurring" && (!Number.isFinite(firstRunAt) || !Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 525600)) { setError("Choose a valid first run time and repeat interval."); return; }
    const invocations = draft.times.map(time => new Date(time).getTime());
    if (draft.mode === "specified" && invocations.some(time => !Number.isFinite(time))) { setError("Choose valid execution times."); return; }
    const saved = await mutate(draft.id ? "schedule.update" : "schedule.create", { ...(draft.id ? { id: draft.id } : {}), name: draft.name, threadId: draft.threadId, prompt: draft.prompt, ...(draft.mode === "specified" ? { invocations } : { intervalMinutes, firstRunAt }), enabled: draft.enabled });
    if (saved && mountedOpen.current) setDraft(null);
  };
  const online = !!client && connected, disabled = !online || saving;
  if (!portal) return null;
  return createPortal(<dialog ref={dialog} className="schedules-dialog" aria-labelledby="schedules-title"
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="schedules-frame">
      <header className="schedules-header">
        <span><CalendarClock size={19} /><strong id="schedules-title">{t("Scheduled tasks")}</strong></span>
        <button type="button" aria-label={t("Refresh scheduled tasks")} disabled={disabled || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /></button>
        <button type="button" aria-label={t("Close scheduled tasks")} onClick={onClose}><X size={19} /></button>
      </header>
      <div className="schedules-content" aria-busy={loading || saving}>
        <div className="schedules-intro"><div><span className="schedules-eyebrow">{t("OPERATIONS CONSOLE")}</span><h1>{t("The right task, on time.")}</h1><p>{t("Send instructions once, at specific times, or on a repeating schedule.")}</p></div><Clock3 size={46} strokeWidth={1} aria-hidden="true" /></div>
        {!online ? <p className="schedules-notice" role="status">{t("Connect the Office gateway to manage scheduled tasks.")}</p> : null}
        {error ? <p className="schedules-error" role="alert">{t(error)}</p> : null}
        {draft ? <form onSubmit={event => { void submit(event); }} className="schedules-editor">
          <div className="schedules-section-heading"><button type="button" disabled={saving} onClick={() => setDraft(null)}><ChevronLeft size={16} />{t("Task list")}</button><h2>{t(draft.id ? "Edit scheduled task" : "New scheduled task")}</h2></div>
          <fieldset disabled={disabled}>
            <label>{t("Task name")}<input required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>{t("Target conversation")}<select required value={draft.threadId} onChange={event => setDraft({ ...draft, threadId: event.target.value })}>
              <option value="">{t("Choose a conversation")}</option>
              {!snapshot.sessions.some(session => session.id === draft.threadId) && draft.threadId ? <option value={draft.threadId} disabled>{t("Conversation unavailable")}</option> : null}
              {snapshot.sessions.map(session => <option key={session.id} value={session.id}>{session.project} / {session.name}</option>)}
            </select></label>
            <label>{t("Schedule mode")}<select aria-label={t("Schedule mode")} value={draft.mode} onChange={event => setDraft({ ...draft, mode: event.target.value as Draft["mode"] })}>
              <option value="specified">{t("Once / specific times")}</option><option value="recurring" disabled={!!draft.id && snapshot.tasks.find(task => task.id === draft.id)?.invocations !== undefined}>{t("Repeating")}</option>
            </select></label>
            {draft.mode === "specified" ? <div className="schedule-invocations">
              <p>{t("Execution times")} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
              {draft.times.map((time, index) => <div className="schedule-invocation" key={index}><input required aria-label={`${t("Execution time")} ${index + 1}`} type="datetime-local" step="0.001" value={time} onChange={event => setDraft({ ...draft, times: draft.times.map((old, i) => i === index ? event.target.value : old) })} /><button type="button" aria-label={`${t("Remove time")} ${index + 1}`} onClick={() => setDraft({ ...draft, times: draft.times.filter((_, i) => i !== index) })}><X size={14} /></button></div>)}
              <button type="button" disabled={draft.times.length >= 1000} onClick={() => setDraft({ ...draft, times: [...draft.times, dateInput(Date.now() + 1800000)] })}><Plus size={14} />{t("Add time")}</button>
              <p className="schedules-help">{t("Each time wakes once. An empty list clears future times; it does not stop the current run or mean the job succeeded.")}</p>
            </div> : <div className="schedules-form-row">
              <label>{t("First run")}<input required aria-label={t("First run")} type="datetime-local" value={draft.firstRun} onChange={event => setDraft({ ...draft, firstRun: event.target.value })} /><small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small></label>
              <label>{t("Repeat every")}<span className="schedules-interval"><input required aria-label={t("Repeat interval")} type="number" min={1} step={1} max={Math.floor(525600 / draft.unit)} value={draft.interval || ""} onChange={event => setDraft({ ...draft, interval: Number(event.target.value) })} /><select aria-label={t("Interval unit")} value={draft.unit} onChange={event => setDraft({ ...draft, unit: Number(event.target.value) })}><option value={1}>{t("minutes")}</option><option value={60}>{t("hours")}</option><option value={1440}>{t("days (24 hours)")}</option></select></span></label>
            </div>}
            <label>{t("Task instructions")}<textarea required maxLength={32768} rows={7} value={draft.prompt} onChange={event => setDraft({ ...draft, prompt: event.target.value })} placeholder={t("Describe what to do and what to report in this conversation.")} /></label>
            <label className="schedules-checkbox"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />{t("Enabled")}</label>
            <p className="schedules-help">{t("Busy conversations wait. Missed times run in order. Specified times never repeat; resuming a recurring task starts at its next future slot.")}</p>
            <div className="schedules-editor-actions"><button type="button" onClick={() => setDraft(null)}>{t("Cancel")}</button><button type="submit" className="schedules-primary"><Check size={15} />{t(saving ? "Saving…" : "Save scheduled task")}</button></div>
          </fieldset>
        </form> : <>
          <div className="schedules-section-heading"><h2>{t("{count} scheduled tasks", { count: snapshot.tasks.length })}</h2><button className="schedules-primary" type="button" disabled={disabled || loading || !snapshot.sessions.length} onClick={() => edit()}><Plus size={15} />{t("New task")}</button></div>
          {!loading && !snapshot.tasks.length ? <div className="schedules-empty"><CalendarClock size={32} /><h3>{t("No scheduled tasks yet")}</h3><p>{t(snapshot.sessions.length ? "Choose a conversation, set a time, and tell it what to do." : "Create an Office conversation first, then add a task here.")}</p></div> : null}
          <div className="schedules-list">{snapshot.tasks.map(task => {
            const run = task.runs.at(-1), pending = inProgress(run), running = run?.status === "running" || run?.status === "dispatching";
            const status = pending && run ? labels[run.status] : scheduleIdleLabel(task);
            return <article className="schedule-card" key={task.id} aria-label={task.name}>
              <div className="schedule-card-heading"><h3>{task.name}</h3><span className="schedule-status" data-status={pending ? run?.status : task.enabled ? "enabled" : "paused"}>{t(status)}</span></div>
              <button type="button" className="schedule-conversation" disabled={!task.targetAvailable} onClick={() => { onClose(); onOpenSession(task.threadId); }}><MessageSquare size={13} />{task.sessionName || t("Conversation unavailable")}</button>
              {!task.targetAvailable ? <p className="schedules-help">{t("Edit this task to choose another conversation before resuming.")}</p> : null}
              <div className="schedule-times"><span>{t(scheduleModeLabel(task))}{task.invocations === undefined ? ` · ${t("Every {minutes} min", { minutes: task.intervalMinutes ?? "—" })}` : ` · ${task.invocations.length}`}</span><span>{t("Next run")}: {task.enabled ? stamp(task.nextRunAt) : "—"}</span></div>
              {task.invocations !== undefined ? <details className="schedule-time-details"><summary>{t("Execution times")}</summary><pre>{task.invocations.map(time => new Date(time).toLocaleString()).join("\n") || t("No remaining times")}</pre></details> : null}
              <p className="schedule-prompt">{task.prompt}</p>
              {run ? <div className="schedule-last-run" data-status={run.status}><span>{t("Last run")}: {stamp(run.scheduledAt)} · {t(labels[run.status])}{run.manual ? ` · ${t("Manual")}` : ""}</span>{run.error ? <p>{t(run.error)}</p> : null}</div> : null}
              {run?.status === "unknown" && !task.enabled ? <p className="schedules-help">{t("This task was paused to avoid a duplicate. Check its conversation before resuming.")}</p> : null}
              {deleting === task.id ? <div className="schedule-delete-confirm"><span>{t("Delete this scheduled task?")}</span><button type="button" disabled={disabled} onClick={() => setDeleting(null)}>{t("Cancel")}</button><button type="button" disabled={disabled} onClick={() => { void mutate("schedule.delete", { id: task.id }); }}>{t("Delete task")}</button></div> : <div className="schedule-actions">
                <button type="button" disabled={disabled || pending || !task.targetAvailable} onClick={() => { void mutate("schedule.run", { id: task.id }); }}><Play size={13} />{t("Run now")}</button>
                <button type="button" disabled={disabled} onClick={() => edit(task)}><Edit3 size={13} />{t("Edit")}</button>
                <button type="button" disabled={disabled || (!task.enabled && !task.targetAvailable)} onClick={() => { void mutate("schedule.update", { ...config(task), enabled: !task.enabled }); }}>{task.enabled ? <Pause size={13} /> : <Play size={13} />}{t(task.enabled ? "Pause" : "Resume")}</button>
                <button type="button" disabled={disabled || running} onClick={() => setDeleting(task.id)}><Trash2 size={13} />{t("Delete")}</button>
              </div>}
            </article>;
          })}</div>
        </>}
      </div>
      <footer className="schedules-footer">{t("Runs while the Office backend is running. Closing this page does not stop tasks.")}</footer>
    </div>
  </dialog>, portal);
}
