"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useUiLanguage, useUiText } from "@/lib/i18n/ui-language";
import { shortPhaseCode } from "../operations/agentDirectory";
import type { HeadTaskRow } from "../operations/headTaskOverview";
import "./head-task-overview.css";

export function HeadTaskOverview({ name, rows, names, loading, error, observedAt, onClose, onOpenTask }: {
  name: string; rows: HeadTaskRow[]; names: ReadonlyMap<string, string>; loading: boolean; error: string;
  observedAt?: number | null; onClose: () => void; onOpenTask: (id: string, phaseId?: string) => void;
}) {
  const t = useUiText(), { language } = useUiLanguage(), id = useId(), dialog = useRef<HTMLDialogElement>(null);
  const [openedAt] = useState(() => Date.now()), now = Math.max(openedAt, observedAt || 0);
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement;
    node?.showModal();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const open = (taskId: string, phaseId?: string) => { onClose(); onOpenTask(taskId, phaseId); };
  const personName = (agentId?: string | null, recordedName?: string | null) => agentId ? names.get(agentId) || recordedName || `${t("Not recorded")} (${agentId.slice(0, 8)})` : recordedName || t("Not recorded");
  const recordedTime = (at?: number | null) => {
    if (at == null) return <small>{t("Time not recorded")}</small>;
    const seconds = (at - now) / 1000, unit = Math.abs(seconds) >= 86400 ? "day" : Math.abs(seconds) >= 3600 ? "hour" : Math.abs(seconds) >= 60 ? "minute" : "second";
    const divisor = unit === "day" ? 86400 : unit === "hour" ? 3600 : unit === "minute" ? 60 : 1;
    return <time dateTime={new Date(at).toISOString()} title={new Date(at).toISOString()}>{new Date(at).toLocaleString(language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}<small>{new Intl.RelativeTimeFormat(language, { numeric: "always" }).format(Math.trunc(seconds / divisor), unit)}</small></time>;
  };
  return createPortal(<dialog ref={dialog} className="head-task-overview" aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><h2 id={id}>{t("Task progress for {name}", { name })}</h2><button type="button" aria-label={t("Close task overview")} onClick={onClose}><X size={20} /></button></header>
    <p className="head-task-scope">{t("Unfinished tasks followed up by this Owner. Responsibility is separate from execution.")}</p>
    <p className="head-task-scope">{t("As of {time}", { time: new Date(now).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", hour12: false }) })}</p>
    {loading ? <p role="status">{t("Loading tasks…")}</p> : null}
    {error ? <p role="alert">{t(error)}</p> : null}
    {!loading && !error && !rows.length ? <p>{t("No tasks need follow-up.")}</p> : null}
    {rows.length ? <div className="head-task-scroll"><table aria-label={t("Task progress for {name}", { name })}>
      <colgroup><col className="head-task-col" /><col className="head-recent-col" /><col className="head-work-col" /></colgroup>
      <thead><tr><th scope="col">{t("Task")}</th><th scope="col">{t("Recent progress")}</th><th scope="col">{t("Current position")}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} data-head-task-id={row.id}>
        <th scope="row"><button type="button" className="head-task-link" aria-label={t("Open task: {name}", { name: `${row.code} · ${row.title}` })} onClick={() => open(row.id)}><span className="head-task-code">{row.code}</span><span>{row.title}</span></button></th>
        <td className="head-recent">{!row.tracking ? <span>{t("Progress records unavailable.")}</span> : !row.tracking.recent.length ? <span>{t("No progress recorded")}</span> : row.tracking.recent.map((event, index) => <div className="head-progress-event" key={`${event.at}:${index}`}>
          <strong>{personName(event.actorId, event.actorName || (event.actorSource === "system" ? t("Office") : event.actorSource === "user" ? t("User") : null))}</strong><span>{t(event.action)}</span>
          {event.phaseId ? <button type="button" className="head-task-link" onClick={() => open(row.id, event.phaseId || undefined)}>{event.detail || shortPhaseCode(event.phaseId)}</button> : event.detail ? <span>{event.detail}</span> : null}
          {recordedTime(event.at)}
        </div>)}{row.tracking?.historyLimited ? <small>{t("Retained operation history is bounded.")}</small> : null}</td>
        <td className="head-work-pairs">{row.work.map(work => <div key={work.id} className="head-work-pair" data-head-work-id={work.id}>
          <div><small className="head-work-status">{t(work.status)}</small>{work.phaseId ? <button type="button" className="head-task-link" onClick={() => open(row.id, work.phaseId)}>{work.title}</button> : <span>{t(work.title)}</span>}</div>
          <div className="head-work-people">{work.people.length ? work.people.map((person, index) => <p key={`${person.role}:${index}`}><small>{t(person.role)}</small><span title={person.agentId || undefined}>{person.agentId ? personName(person.agentId) : t(person.role === "Executing" || person.role === "Reviewing" ? "Execution not recorded" : "Unassigned")}</span></p>) : <span>{t("Not recorded")}</span>}</div>
          {work.state?.waitingForId ? <p>{t("Waiting for {name}", { name: personName(work.state.waitingForId) })}</p> : null}
          {work.state?.reasonCode || work.state?.reason ? <p>{work.state.reasonCode ? t(work.state.reasonCode) : work.state.reason}</p> : work.status === "Paused" ? <small>{t("Pause reason not recorded")}</small> : null}
          <small>{t("State since")}</small>{recordedTime(work.state?.since)}
        </div>)}{row.tracking?.unscopedNote ? <div className="head-operation-note"><small>{t("Operation note (phase not recorded)")}</small><p>{row.tracking.unscopedNote.text}</p>{recordedTime(row.tracking.unscopedNote.at)}</div> : null}</td>
      </tr>)}</tbody>
    </table></div> : null}
  </dialog>, document.body);
}
