"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, X } from "lucide-react";
import { OPEN_DEPARTMENT_ID, type OrganizationView } from "@/lib/office/organization";
import { departmentButtonLabel, MAX_DEPARTMENT_DESCRIPTION, type OrganizationDepartment } from "@/lib/office/departments";
import { useUiText } from "@/lib/i18n/ui-language";
import { needsFollowUp, type DirectoryTaskSummary } from "@/features/office/operations/agentDirectory";
import "./scheduled-tasks.css";
import "./department-panel.css";

export type DepartmentPanelState = { open: boolean; selectedId: string | null; tabs: string[] };
export function openDepartmentTab(current: DepartmentPanelState, id?: string): DepartmentPanelState {
  return { open: true, selectedId: id ?? null, tabs: id && !current.tabs.includes(id) ? [...current.tabs, id] : current.tabs };
}

export type DepartmentTaskState = { summaries: DirectoryTaskSummary[]; loading: boolean; error: string };
export function DepartmentPanel({ organization, state, onSelect, onClose, tasks, onOpenTask }: {
  organization: OrganizationView; state: DepartmentPanelState; onSelect: (id?: string) => void; onClose: () => void;
  tasks?: DepartmentTaskState; onOpenTask?: (id: string) => void;
}) {
  const t = useUiText(), dialog = useRef<HTMLDialogElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  useEffect(() => { const frame = requestAnimationFrame(() => setPortal(document.body)); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => {
    if (!portal || !dialog.current) return;
    if (state.open) { if (!dialog.current.open) dialog.current.showModal(); }
    else dialog.current.close();
  }, [state.open, portal]);
  const departments = organization.departments || [];
  const departmentName = (id: string) => { const department = departments.find(d => d.id === id); return !department ? t("Department unavailable") : id === OPEN_DEPARTMENT_ID ? t("Open Workspace") : department.name; };
  if (!portal) return null;
  return createPortal(<dialog ref={dialog} className="schedules-dialog department-dialog" aria-labelledby="department-panel-title"
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="department-frame">
      <header className="schedules-header"><Building2 size={19} /><strong id="department-panel-title">{t("Departments")}</strong><button type="button" aria-label={t("Close departments")} onClick={onClose}><X size={19} /></button></header>
      <nav className="department-tabs" role="tablist" aria-label={t("Departments")}>
        <button type="button" role="tab" aria-selected={state.selectedId === null} onClick={() => onSelect()}>{t("Company overview")}</button>
        {state.tabs.map(id => <button type="button" key={id} role="tab" title={departmentName(id)} data-department-id={id} aria-selected={state.selectedId === id} onClick={() => onSelect(id)}>{departmentButtonLabel(id, departmentName(id))}</button>)}
      </nav>
      <div className="department-content">
        <section role="tabpanel" hidden={state.selectedId !== null} aria-label={t("Company overview")}>
          <h1>{t("Company overview")}</h1>
          <div className="department-overview">{departments.map(department => <article key={department.id}>
            <h2><button type="button" data-department-id={department.id} title={departmentName(department.id)} onClick={() => onSelect(department.id)}>{departmentButtonLabel(department.id, departmentName(department.id))}</button></h2>
            <p>{department.description || t("No responsibilities recorded.")}</p>
            <small>{t("Department Head")}: {department.heads.map(head => head.name).join(", ") || t("Head position vacant")}</small>
            <MemberList department={department} organization={organization} onClose={onClose} />
          </article>)}</div>
        </section>
        {state.tabs.map(id => <section key={id} role="tabpanel" hidden={state.selectedId !== id} aria-label={departmentName(id)}>
          {departments.find(d => d.id === id) ? <><DepartmentDetail department={departments.find(d => d.id === id)!} organization={organization} onClose={onClose} />{tasks ? <DepartmentTasks departmentId={id} tasks={tasks} onOpenTask={onOpenTask ? taskId => { onClose(); onOpenTask(taskId); } : undefined} /> : null}</> : <p>{t("Department unavailable")}</p>}
        </section>)}
      </div>
    </div>
  </dialog>, portal);
}

function DepartmentTasks({ departmentId, tasks, onOpenTask }: { departmentId: string; tasks: DepartmentTaskState; onOpenTask?: (id: string) => void }) {
  const t = useUiText(), id = departmentId === OPEN_DEPARTMENT_ID ? null : departmentId;
  const rows = [...new Map(tasks.summaries.filter(task => needsFollowUp(task) && task.departmentId === id).map(task => [task.id, task])).values()];
  return <section className="department-tasks" aria-label={t("Needs follow-up")}>
    <h2>{t("Needs follow-up")} · {rows.length}</h2>
    {tasks.loading ? <p role="status">{t("Loading tasks…")}</p> : null}
    {tasks.error ? <p role="alert">{t(tasks.error)}</p> : null}
    {!tasks.loading && !tasks.error && !rows.length ? <p>{t("No tasks need follow-up.")}</p> : null}
    <ul>{rows.map(task => <li key={task.id}><button type="button" disabled={!onOpenTask} onClick={() => onOpenTask?.(task.id)}>{task.code ? <><span className="font-mono">{task.code}</span> · </> : null}{task.title}</button>
      <small>{t(task.reviewerId ? "Awaiting manager review" : task.status === "running" ? "Running" : task.status === "paused" ? "Paused" : "Queued")}</small>
      <p>{t("Owner")}: {task.ownerName || task.ownerId || t(task.ownerId === undefined ? "Not recorded" : "Unassigned")}{task.executionMode === "phases" ? ` · ${task.phases?.filter(p => p.completedAt != null).length || 0}/${task.phases?.length || 0} ${t("Phases")}` : <> · {t("Assignee")}: {task.assigneeName || task.assigneeId || t("Unassigned")}</>}</p>
    </li>)}</ul>
  </section>;
}

function MemberList({ department, organization, onClose }: { department: OrganizationDepartment; organization: OrganizationView; onClose: () => void }) {
  const t = useUiText();
  return <ul className="department-members" aria-label={t("Members")}>
    {department.members.map(person => <li key={person.id}>
      {organization.focusPerson ? <button type="button" onClick={() => { organization.focusPerson?.(person.id); onClose(); }}>{person.name}</button> : <span>{person.name}</span>}
      <span>{["Worker", "Head", "CEO"].includes(person.title) ? t(person.title) : person.title}</span>
    </li>)}
    {!department.members.length ? <li>{t("No members yet.")}</li> : null}
  </ul>;
}

function DepartmentDetail({ department, organization, onClose }: { department: OrganizationDepartment; organization: OrganizationView; onClose: () => void }) {
  const t = useUiText(), [editing, setEditing] = useState(false), [draft, setDraft] = useState(department.description);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  return <>
    <h1>{department.id === OPEN_DEPARTMENT_ID ? t("Open Workspace") : department.name}</h1>
    <h2>{t("Responsibilities")}</h2>
    {editing ? <form onSubmit={event => {
      event.preventDefault(); if (saving || !organization.saveDepartmentDescription) return;
      setSaving(true); setError("");
      void organization.saveDepartmentDescription(department.id, draft).then(() => setEditing(false))
        .catch(cause => setError(cause instanceof Error ? t(cause.message) : t("Could not save department responsibilities."))).finally(() => setSaving(false));
    }}>
      <textarea aria-label={t("Responsibilities")} maxLength={MAX_DEPARTMENT_DESCRIPTION} rows={7} value={draft} disabled={saving} onChange={event => setDraft(event.target.value)} />
      {error ? <p role="alert">{error}</p> : null}
      <div className="department-actions"><button type="button" disabled={saving} onClick={() => { setEditing(false); setError(""); }}>{t("Cancel")}</button><button type="submit" disabled={saving}>{t(saving ? "Saving…" : "Save responsibilities")}</button></div>
    </form> : <>
      <p className="department-description">{department.description || t("No responsibilities recorded.")}</p>
      {organization.saveDepartmentDescription ? <button type="button" onClick={() => { setDraft(department.description); setError(""); setEditing(true); }}>{t("Edit responsibilities")}</button> : null}
    </>}
    <h2>{t("Department Head")}</h2><p>{department.heads.map(head => `${head.name} · ${["Worker", "Head", "CEO"].includes(head.title) ? t(head.title) : head.title}`).join(", ") || t("Head position vacant")}</p>
    <h2>{t("Members")}</h2><MemberList department={department} organization={organization} onClose={onClose} />
  </>;
}
