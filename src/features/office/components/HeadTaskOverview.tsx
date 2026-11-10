"use client";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import type { HeadTaskRow } from "../operations/headTaskOverview";
import "./head-task-overview.css";

export function HeadTaskOverview({ name, rows, names, loading, error, onClose, onOpenTask }: {
  name: string; rows: HeadTaskRow[]; names: ReadonlyMap<string, string>; loading: boolean; error: string;
  onClose: () => void; onOpenTask: (id: string, phaseId?: string) => void;
}) {
  const t = useUiText(), id = useId(), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement;
    node?.showModal();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const open = (taskId: string, phaseId?: string) => { onClose(); onOpenTask(taskId, phaseId); };
  return createPortal(<dialog ref={dialog} className="head-task-overview" aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><h2 id={id}>{t("Managed tasks for {name}", { name })}</h2><button type="button" aria-label={t("Close task overview")} onClick={onClose}><X size={20} /></button></header>
    <p className="head-task-scope">{t("Unfinished tasks followed up by this Owner. Responsibility is separate from execution.")}</p>
    {loading ? <p role="status">{t("Loading tasks…")}</p> : null}
    {error ? <p role="alert">{t(error)}</p> : null}
    {!loading && !error && !rows.length ? <p>{t("No tasks need follow-up.")}</p> : null}
    {rows.length ? <div className="head-task-scroll"><table aria-label={t("Managed tasks for {name}", { name })}>
      <colgroup><col className="head-task-col" /><col className="head-work-col" /><col className="head-person-col" /></colgroup>
      <thead><tr><th scope="col">{t("Task")}</th><th scope="col">{t("Current work")}</th><th scope="col">{t("Who is working")}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} data-head-task-id={row.id}>
        <th scope="row"><button type="button" className="head-task-link" aria-label={t("Open task: {name}", { name: `${row.code} · ${row.title}` })} onClick={() => open(row.id)}><span className="head-task-code">{row.code}</span><span>{row.title}</span></button></th>
        <td colSpan={2} className="head-work-pairs">{row.work.map(work => <div key={work.id} className="head-work-pair" data-head-work-id={work.id}>
          <div><small className="head-work-status">{t(work.status)}</small>{work.phaseId ? <button type="button" className="head-task-link" onClick={() => open(row.id, work.phaseId)}>{work.title}</button> : <span>{t(work.title)}</span>}</div>
          <div className="head-work-people">{work.people.length ? work.people.map((person, index) => <p key={`${person.role}:${index}`}><small>{t(person.role)}</small><span title={person.agentId || undefined}>{person.agentId ? names.get(person.agentId) || `${t("Not recorded")} (${person.agentId.slice(0, 8)})` : t(person.role === "Executing" || person.role === "Reviewing" ? "Execution not recorded" : "Unassigned")}</span></p>) : <span>{t("Not recorded")}</span>}</div>
        </div>)}</td>
      </tr>)}</tbody>
    </table></div> : null}
  </dialog>, document.body);
}
