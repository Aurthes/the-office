"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, ClipboardList, List, ListTree, MessageSquare, Pause, Play, Plus, RefreshCw, X } from "lucide-react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { useUiText } from "@/lib/i18n/ui-language";
import "./task-board.css";

type Phase = { id: string; title: string; notes?: string; elapsedMs: number; startedAt: number | null; completedAt: number | null };
export type OfficeTodo = { id: string; revision: number; title: string; documentation?: string; departmentId: string | null; departmentName: string; assigneeId: string | null; assigneeName: string | null; assigneeAvailable: boolean; status: "queued" | "running" | "paused" | "done"; archived: boolean; completedAt?: number | null; phases: Phase[]; progress: number; events?: { at: number; message: string; actor: { name?: string } }[] };
type Snapshot = { todos: OfficeTodo[]; total: number; departments: { id: string | null; name: string; total: number; running: number; unassigned: number }[]; agents: { id: string; name: string; projectId: string | null }[]; serverTime: number };
type Draft = { id?: string; revision?: number; title: string; documentation: string; departmentId: string; assigneeId: string; phases: { id?: string; title: string; notes: string }[] };
const ALL = "__all__", OPEN = "__open__", UNASSIGNED = "__unassigned__";
const labels = { queued: "Queued", running: "Running", paused: "Paused", done: "Completed" };
export const taskDuration = (ms: number) => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${Math.floor(seconds / 60) % 60 < 10 ? "0" : ""}${Math.floor(seconds / 60) % 60}:${(seconds % 60).toString().padStart(2, "0")}`; };
const phaseTime = (phase: Phase, now: number) => phase.elapsedMs + (phase.startedAt == null ? 0 : Math.max(0, now - phase.startedAt));
const totalTime = (todo: OfficeTodo, now: number) => todo.phases.reduce((sum, phase) => sum + phaseTime(phase, now), 0);

const taskCompletionTime = (todo: OfficeTodo) => {
  if (todo.status !== "done") return null;
  if (Number.isFinite(todo.completedAt)) return todo.completedAt!;
  const times = todo.phases.map(phase => phase.completedAt);
  return times.length && times.every(time => typeof time === "number" && Number.isFinite(time)) ? Math.max(...times as number[]) : null;
};
function CompletionTime({ at, kind }: { at: number | null; kind: "task" | "phase" }) {
  const t = useUiText();
  return <span className="todo-completed-at" data-completion-kind={kind}>{at == null ? t("Completion time not recorded") : <>{t("Completed at")}: <time dateTime={new Date(at).toISOString()} title={new Date(at).toISOString()}>{new Date(at).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time></>}</span>;
}

export function TaskBoard({ open, departmentId, taskId, onClose, onOpenSession, client, connected }: {
  open: boolean; departmentId?: string | null; taskId?: string; onClose: () => void; onOpenSession: (id: string) => void;
  client?: Pick<GatewayClient, "call" | "onEvent">; connected: boolean;
}) {
  const t = useUiText(), dialog = useRef<HTMLDialogElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null), [snapshot, setSnapshot] = useState<Snapshot>(() => ({ todos: [], total: 0, departments: [], agents: [], serverTime: Date.now() }));
  const [scope, setScope] = useState(ALL), [status, setStatus] = useState("all"), [owner, setOwner] = useState(ALL), [query, setQuery] = useState(""), [offset, setOffset] = useState(0), [tree, setTree] = useState(true);
  const [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<OfficeTodo | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [pulse, setPulse] = useState(0), [clock, setClock] = useState(Date.now);
  const [timeOffset, setTimeOffset] = useState(0);
  const mutation = useRef(false), request = useRef<{ key: string; id: string } | null>(null), active = useRef(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setPortal(document.body)); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => {
    if (!portal) return;
    active.current = open;
    const frame = requestAnimationFrame(() => {
    if (open) { if (!dialog.current?.open) dialog.current?.showModal(); setScope(departmentId === undefined ? ALL : departmentId === null ? OPEN : departmentId); setOffset(0); setStatus("all"); setSelected(taskId || null); setDetail(null); setDraft(null); setError(""); setPulse(value => value + 1); }
    else dialog.current?.close();
    });
    return () => { active.current = false; cancelAnimationFrame(frame); };
  }, [open, departmentId, taskId, portal]);
  useEffect(() => { if (!open) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [open]);
  useEffect(() => {
    if (!open || !client || !connected) return;
    let stopped = false;
    void Promise.resolve().then(() => { if (!stopped) setLoading(true); });
    void client.call<Snapshot>("todo.list", { ...(scope === ALL ? {} : { departmentId: scope === OPEN ? null : scope }), ...(owner === ALL ? {} : { assigneeId: owner === UNASSIGNED ? null : owner }), status, ...(query.trim() ? { query: query.trim() } : {}), offset, limit: 25 }).then(data => {
      if (stopped) return;
      if (!Array.isArray(data.todos)) throw new Error("Task board is not available on this gateway.");
      setTimeOffset(data.serverTime - Date.now()); setClock(Date.now()); setSnapshot(data);
    }).catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : "Could not load task board."); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [open, client, connected, scope, owner, status, query, offset, pulse]);
  useEffect(() => {
    if (!open || !client || !connected) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = client.onEvent(event => { if (["todos.updated", "roster.updated", "project.updated"].includes(event.event) && !timer) timer = setTimeout(() => { timer = undefined; setPulse(value => value + 1); }, 150); });
    return () => { off(); clearTimeout(timer); };
  }, [open, client, connected]);
  useEffect(() => {
    if (!open || !selected || !client || !connected) return;
    let stopped = false;
    void client.call<{ todo: OfficeTodo; serverTime: number }>("todo.get", { id: selected }).then(data => { if (!stopped) { setDetail(data.todo); setTimeOffset(data.serverTime - Date.now()); } }).catch(cause => { if (!stopped) setError(String(cause.message || cause)); });
    return () => { stopped = true; };
  }, [open, selected, pulse, client, connected]);
  const online = !!client && connected, disabled = !online || saving;
  const now = clock + timeOffset;
  const mutate = async (method: string, params: object) => {
    if (!client || !connected || mutation.current) return null;
    mutation.current = true; setSaving(true); setError("");
    const key = JSON.stringify({ method, params });
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      const result = await client.call<{ todo: OfficeTodo }>(method, { ...params, requestId: request.current.id });
      request.current = null;
      if (active.current) { setPulse(value => value + 1); if (result.todo) { setSelected(result.todo.id); setDetail(result.todo); } }
      return result;
    } catch (cause) { if (cause instanceof Error && /busy|Sign in|Assign an agent|changed|Choose an unfinished/.test(cause.message)) request.current = null; if (active.current) { setError(cause instanceof Error ? cause.message : "Could not save task. Refresh before retrying."); setPulse(value => value + 1); } return null; }
    finally { mutation.current = false; setSaving(false); }
  };
  const edit = (todo?: OfficeTodo, followup = false) => {
    setError("");
    setDraft({ id: todo?.id, revision: todo?.revision, title: todo?.title || "", documentation: todo?.documentation || "", departmentId: todo ? todo.departmentId ?? OPEN : (scope !== ALL ? scope : OPEN), assigneeId: todo?.assigneeId || "", phases: todo ? [...todo.phases.map(phase => ({ id: phase.id, title: phase.title, notes: phase.notes || "" })), ...(followup ? [{ title: t("Follow-up"), notes: "" }] : [])] : [{ title: "Plan", notes: "" }, { title: "Execute", notes: "" }, { title: "Verify", notes: "" }] });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!draft) return;
    const result = await mutate(draft.id ? "todo.edit" : "todo.create", { ...(draft.id ? { id: draft.id, revision: draft.revision } : {}), title: draft.title, documentation: draft.documentation, departmentId: draft.departmentId === OPEN ? null : draft.departmentId, assigneeId: draft.assigneeId || null, phases: draft.phases });
    if (result && active.current) setDraft(null);
  };
  const action = (action: string, extra = {}) => { if (detail) void mutate(`todo.${action}`, { id: detail.id, revision: detail.revision, ...extra }); };
  const groups = snapshot.departments.filter(dept => snapshot.todos.some(todo => todo.departmentId === dept.id));
  // Historical departments remain visible even after their workspace is removed.
  for (const todo of snapshot.todos) if (!groups.some(group => group.id === todo.departmentId)) groups.push({ id: todo.departmentId, name: todo.departmentName, total: 0, running: 0, unassigned: 0 });
  const renderCard = (todo: OfficeTodo) => <article key={todo.id} className="todo-card" data-testid="todo-card">
    <button className="todo-card-open" type="button" onClick={() => { setSelected(todo.id); setDetail(null); setDraft(null); setError(""); }}>
      <span className="todo-card-heading"><strong>{todo.title}</strong><span className="todo-status" data-status={todo.status}>{t(labels[todo.status])}</span></span>
      <span className="todo-meta">{todo.departmentName} · {todo.assigneeName || t("Unassigned")}</span>
      <span className="todo-progress"><progress max={todo.phases.length} value={todo.progress} /><span>{todo.progress}/{todo.phases.length} · {taskDuration(totalTime(todo, now))}</span></span>
      {todo.status === "done" ? <CompletionTime at={taskCompletionTime(todo)} kind="task" /> : null}
      <span className="todo-current">{todo.phases.find(phase => phase.startedAt != null)?.title || todo.phases.find(phase => phase.completedAt == null)?.title || t("All phases completed")}</span>
    </button>
    {tree ? <ol className="todo-phase-tree">{todo.phases.map(phase => <li key={phase.id} data-current={phase.startedAt != null}><span>{phase.completedAt != null ? "✓" : phase.startedAt != null ? "●" : "○"} {phase.title}{phase.completedAt != null ? <CompletionTime at={phase.completedAt} kind="phase" /> : null}</span><time>{taskDuration(phaseTime(phase, now))}</time></li>)}</ol> : null}
  </article>;
  if (!portal) return null;
  return createPortal(<dialog ref={dialog} className="todo-dialog" aria-labelledby="todo-board-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="todo-frame">
      <header className="todo-header"><ClipboardList size={20} /><div><h1 id="todo-board-title">{t("Task board")}</h1><p>{scope === ALL ? t("All departments") : snapshot.departments.find(dept => (dept.id || OPEN) === scope)?.name || t("Department tasks")}</p></div><button type="button" aria-label={t("Refresh task board")} disabled={disabled || loading} onClick={() => { setError(""); setPulse(value => value + 1); }}><RefreshCw size={16} /></button><button type="button" aria-label={t("Close task board")} onClick={onClose}><X size={20} /></button></header>
      <div className="todo-body">
        <aside className="todo-departments" aria-label={t("Departments")}>
          <button type="button" aria-pressed={scope === ALL} onClick={() => { setScope(ALL); setOffset(0); setSelected(null); setDraft(null); }}>{t("All departments")}<b>{snapshot.departments.reduce((sum, dept) => sum + dept.total, 0)}</b></button>
          {snapshot.departments.map(dept => <button key={dept.id || OPEN} type="button" aria-pressed={scope === (dept.id || OPEN)} onClick={() => { setScope(dept.id || OPEN); setOffset(0); setSelected(null); setDraft(null); }}><span>{dept.name}<small>{t("{count} running", { count: dept.running })} · {t("{count} unassigned", { count: dept.unassigned })}</small></span><b>{dept.total}</b></button>)}
        </aside>
        <main className="todo-main" aria-busy={loading || saving}>
          {!online ? <p className="todo-notice">{t("Connect the Office gateway to manage tasks.")}</p> : null}
          {error ? <p className="todo-error" role="alert">{t(error)}</p> : null}
          {draft ? <form className="todo-editor" onSubmit={event => { void submit(event); }}>
            <div className="todo-section-heading"><button type="button" disabled={saving} onClick={() => setDraft(null)}><ArrowLeft size={14} />{t("Cancel")}</button><h2>{t(draft.id ? "Edit to-do" : "New to-do")}</h2></div>
            <fieldset disabled={disabled}>
              <label>{t("Task title")}<input required maxLength={200} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
              <div className="todo-form-row"><label>{t("Department")}<select aria-label={t("Department")} value={draft.departmentId} onChange={event => setDraft({ ...draft, departmentId: event.target.value })}>{!snapshot.departments.some(dept => (dept.id || OPEN) === draft.departmentId) ? <option value={draft.departmentId}>{detail?.departmentName}</option> : null}{snapshot.departments.map(dept => <option key={dept.id || OPEN} value={dept.id || OPEN}>{dept.name}</option>)}</select></label><label>{t("Assigned to")}<select aria-label={t("Assigned to")} value={draft.assigneeId} onChange={event => setDraft({ ...draft, assigneeId: event.target.value })}><option value="">{t("Unassigned")}</option>{draft.assigneeId && !snapshot.agents.some(agent => agent.id === draft.assigneeId) ? <option value={draft.assigneeId}>{detail?.assigneeName} ({t("Unavailable")})</option> : null}{snapshot.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label></div>
              <label>{t("Documentation")}<textarea rows={5} maxLength={24000} value={draft.documentation} onChange={event => setDraft({ ...draft, documentation: event.target.value })} /></label>
              <div className="todo-section-heading"><h3>{t("Phases")}</h3><button type="button" disabled={draft.phases.length >= 20} onClick={() => setDraft({ ...draft, phases: [...draft.phases, { title: "", notes: "" }] })}><Plus size={14} />{t("Add phase")}</button></div>
              <ol className="todo-phase-editor">{draft.phases.map((phase, index) => <li key={phase.id || index}><span>{index + 1}</span><div><label>{t("Phase title")}<input required maxLength={160} value={phase.title} onChange={event => setDraft({ ...draft, phases: draft.phases.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} /></label><label>{t("Phase notes")}<textarea rows={2} maxLength={3000} value={phase.notes} onChange={event => setDraft({ ...draft, phases: draft.phases.map((item, i) => i === index ? { ...item, notes: event.target.value } : item) })} /></label></div><button type="button" aria-label={t("Remove phase {number}", { number: index + 1 })} disabled={draft.phases.length <= 1} onClick={() => setDraft({ ...draft, phases: draft.phases.filter((_, i) => i !== index) })}><X size={14} /></button></li>)}</ol>
              <button className="todo-primary" type="submit"><Check size={15} />{t(saving ? "Saving…" : "Save to-do")}</button>
            </fieldset>
          </form> : selected ? <>
            <button type="button" onClick={() => { setSelected(null); setDetail(null); }}><ArrowLeft size={14} />{t("Task list")}</button>
            {!detail ? <p>{t("Loading…")}</p> : <article className="todo-detail">
              <span className="todo-status" data-status={detail.status}>{t(labels[detail.status])}{detail.archived ? ` · ${t("Archived")}` : ""}</span><h2>{detail.title}</h2><p className="todo-meta">{detail.departmentName} · {detail.assigneeName || t("Unassigned")}</p>
              <div className="todo-progress"><progress max={detail.phases.length} value={detail.progress} /><span>{detail.progress}/{detail.phases.length} · {taskDuration(totalTime(detail, now))}</span></div>
              {detail.status === "done" ? <CompletionTime at={taskCompletionTime(detail)} kind="task" /> : null}
              <div className="todo-actions">{!detail.archived ? <><button type="button" disabled={disabled} onClick={() => edit(detail)}>{t("Edit")}</button><button type="button" disabled={disabled || detail.status === "done"} onClick={() => action(detail.status === "running" ? "pause" : "start")}>{detail.status === "running" ? <Pause size={14} /> : <Play size={14} />}{t(detail.status === "running" ? "Pause timer" : "Start timer")}</button><button className="todo-primary" type="button" disabled={disabled || !detail.assigneeAvailable || detail.status === "done"} onClick={() => action("run")}><Play size={14} />{t("Start with agent")}</button><button type="button" disabled={disabled} onClick={() => action("archive")}>{t("Archive")}</button></> : detail.status === "done" ? <><button type="button" disabled={disabled} onClick={() => edit(detail)}>{t("Edit")}</button><button type="button" className="todo-primary" disabled={disabled || detail.phases.length >= 20} onClick={() => edit(detail, true)}><Plus size={14} />{t("Add follow-up")}</button></> : <button type="button" disabled={disabled} onClick={() => action("restore")}>{t("Restore")}</button>}
                {detail.assigneeId ? <button type="button" disabled={!detail.assigneeAvailable} onClick={() => { onClose(); onOpenSession(detail.assigneeId!); }}><MessageSquare size={14} />{t("Open conversation")}</button> : null}</div>
              <h3>{t("Phases")}</h3><ol className="todo-phase-list">{detail.phases.map(phase => <li key={phase.id} data-current={phase.startedAt != null}><label><input type="checkbox" checked={phase.completedAt != null} disabled={disabled || (detail.archived && detail.status !== "done")} onChange={() => action(phase.completedAt != null ? "reopen" : "complete", { phaseId: phase.id })} /><span>{phase.title}{phase.completedAt != null ? <CompletionTime at={phase.completedAt} kind="phase" /> : null}{phase.notes ? <small>{phase.notes}</small> : null}</span></label><time>{taskDuration(phaseTime(phase, now))}</time></li>)}</ol>
              <h3>{t("Documentation")}</h3><p className="todo-documentation">{detail.documentation || t("No documentation yet.")}</p>
              <details className="todo-history"><summary>{t("Activity history")}</summary>{detail.events?.slice().reverse().map((event, index) => <p key={index}><time>{new Date(event.at).toLocaleString()}</time> · {event.actor.name || "Office"}<br />{event.message}</p>)}</details>
            </article>}
          </> : <>
            <div className="todo-section-heading"><h2>{t("{count} to-dos", { count: snapshot.total })}</h2><button type="button" className="todo-primary" disabled={disabled} onClick={() => edit()}><Plus size={15} />{t("New to-do")}</button></div>
            <div className="todo-filters"><input aria-label={t("Search tasks")} placeholder={t("Search tasks")} maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} /><select aria-label={t("Task status")} value={status} onChange={event => { setStatus(event.target.value); setOffset(0); }}>{["all", "queued", "running", "paused", "done", "archived"].map(value => <option key={value} value={value}>{t(value === "all" ? "Needs follow-up" : value === "archived" ? "Archived" : labels[value as keyof typeof labels])}</option>)}</select><select aria-label={t("Task owner")} value={owner} onChange={event => { setOwner(event.target.value); setOffset(0); }}><option value={ALL}>{t("All agents")}</option><option value={UNASSIGNED}>{t("Unassigned")}</option>{snapshot.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button type="button" aria-label={t(tree ? "Show task list" : "Show task tree")} onClick={() => setTree(!tree)}>{tree ? <List size={16} /> : <ListTree size={16} />}{t(tree ? "List view" : "Tree view")}</button></div>
            {!loading && !snapshot.todos.length ? <div className="todo-empty"><ClipboardList size={32} /><p>{t("No to-dos here yet.")}</p><p>{t("Create a to-do here, or give an agent a task in chat.")}</p></div> : null}
            {tree ? groups.map(group => <section className="todo-group" key={group.id || OPEN}><h3>{group.name}</h3>{snapshot.todos.filter(todo => todo.departmentId === group.id).map(renderCard)}</section>) : <div className="todo-cards">{snapshot.todos.map(renderCard)}</div>}
            <div className="todo-pagination"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>{t("Previous")}</button><span>{snapshot.total ? `${offset + 1}–${Math.min(offset + 25, snapshot.total)} / ${snapshot.total}` : "0"}</span><button type="button" disabled={loading || offset + 25 >= snapshot.total} onClick={() => setOffset(offset + 25)}>{t("Next")}</button></div>
          </>}
        </main>
      </div>
      <footer className="todo-footer">{t("Completed tasks are archived automatically. Completion times use your local time zone.")}</footer>
    </div>
  </dialog>, portal);
}
