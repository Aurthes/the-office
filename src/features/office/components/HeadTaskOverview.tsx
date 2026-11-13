"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useUiLanguage, useUiText } from "@/lib/i18n/ui-language";
import { shortPhaseCode } from "../operations/agentDirectory";
import { groupHeadTaskRows, type HeadTaskRow, type HeadWork } from "../operations/headTaskOverview";
import "./head-task-overview.css";

export function HeadTaskOverview({ name, rows, names, loading, error, observedAt, onClose, onOpenTask, embedded = false, historyLimited = false }: {
  name: string; rows: HeadTaskRow[]; names: ReadonlyMap<string, string>; loading: boolean; error: string;
  observedAt?: number | null; embedded?: boolean; historyLimited?: boolean; onClose?: () => void; onOpenTask: (id: string, phaseId?: string) => void;
}) {
  const t = useUiText(), { language } = useUiLanguage(), id = useId(), dialog = useRef<HTMLDialogElement>(null);
  const [clock, setClock] = useState(() => Date.now()), now = clock;
  const [windowMinutes, setWindowMinutes] = useState(() => {
    try { const value = Number(localStorage.getItem("claw3d:task-progress-window-minutes")); return [30, 60, 180, 360, 1440].includes(value) ? value : 60; } catch { return 60; }
  });
  const visibleRows = groupHeadTaskRows(rows, now, windowMinutes);
  const nextTickAt = Math.min(now + 60000, ...rows.flatMap(row => { const at = row.recentAt ?? row.progressAt; return at != null && at + windowMinutes * 60000 > now ? [at + windowMinutes * 60000] : []; }));
  useEffect(() => {
    const timer = setTimeout(() => setClock(Date.now()), Math.max(1, nextTickAt - Date.now()));
    return () => clearTimeout(timer);
  }, [nextTickAt]);
  useEffect(() => {
    if (embedded) return;
    const node = dialog.current, previous = document.activeElement;
    node?.showModal();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [embedded]);
  const open = (taskId: string, phaseId?: string) => { onClose?.(); onOpenTask(taskId, phaseId); };
  const personName = (agentId?: string | null, recordedName?: string | null) => agentId ? names.get(agentId) || recordedName || `${t("Not recorded")} (${agentId.slice(0, 8)})` : recordedName || t("Not recorded");
  const recordedTime = (at?: number | null, full = false) => {
    if (at == null) return <small>{t("Time not recorded")}</small>;
    const seconds = (at - now) / 1000, unit = Math.abs(seconds) >= 86400 ? "day" : Math.abs(seconds) >= 3600 ? "hour" : Math.abs(seconds) >= 60 ? "minute" : "second";
    const divisor = unit === "day" ? 86400 : unit === "hour" ? 3600 : unit === "minute" ? 60 : 1;
    const relative = new Intl.RelativeTimeFormat(language, { numeric: "always" }).format(Math.trunc(seconds / divisor), unit);
    return <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString(language)}>{full ? <>{new Date(at).toLocaleString(language)} · </> : null}{relative}</time>;
  };
  const eventActor = (event: NonNullable<HeadTaskRow["tracking"]>["recent"][number]) => event.actorSource === "system" ? t("System") : personName(event.actorId, event.actorName || (event.actorSource === "user" ? t("User") : null));
  const isParked = (work: HeadWork) => !work.running && ["Paused", "Not started"].includes(work.status) && !(work.progressAt != null && work.progressAt <= now && now - work.progressAt < windowMinutes * 60000);
  const renderWork = (taskId: string, work: HeadWork) => <div key={work.id} className="head-work-pair" data-head-work-id={work.id}>
          <div><small className="head-work-status" data-active={work.active}>{t(work.status)}</small>{work.running ? <small className="head-work-status" data-active>{t("Running")}</small> : null}{work.scopeLabel ? <small>{t(work.scopeLabel)}</small> : null}{work.phaseId ? <button type="button" className="head-task-link head-current-title" title={work.title} onClick={() => open(taskId, work.phaseId)}>{work.title}</button> : <span className="head-current-title">{t(work.title)}</span>}</div>
          <div className="head-work-people">{work.people.length ? work.people.map((person, index) => <p key={`${person.role}:${index}`}><small>{t(person.role)}: </small><span title={person.agentId || undefined}>{person.agentId ? personName(person.agentId) : t(person.role === "Executing" || person.role === "Reviewing" ? "Execution not recorded" : "Unassigned")}</span></p>) : ["Completed", "Archived"].includes(work.status) ? null : <span>{t("Not recorded")}</span>}</div>
          {work.status === "Paused" && isParked(work) && work.state?.needsUserDecision == null ? <small>{t("User decision need not recorded")}</small> : null}
          {work.state?.waitingForId ? <p className="head-short-text">{t("Waiting for {name}", { name: personName(work.state.waitingForId) })}</p> : null}
          {work.state?.reason || work.state?.reasonCode && work.state.reasonCode !== "Submitted for manager acceptance" ? <p className="head-short-text" title={work.state.reason || undefined}>{work.state.reasonCode ? t(work.state.reasonCode) : work.state.reason}</p> : work.status === "Paused" && isParked(work) ? <small>{t("Pause reason not recorded")}</small> : null}
          {work.state?.since != null ? <div className="head-state-age" aria-label={t("State since")}>{recordedTime(work.state.since)}</div> : work.status === "Paused" && isParked(work) ? <small>{t("Time not recorded")}</small> : null}
          {work.status === "Paused" && !isParked(work) && (work.state?.needsUserDecision == null || !work.state.reason && !work.state.reasonCode || work.state.since == null) ? <details className="head-progress-details"><summary>{t("State details")}</summary>
            {work.state?.needsUserDecision == null ? <small>{t("User decision need not recorded")}</small> : null}
            {!work.state?.reason && !work.state?.reasonCode ? <small>{t("Pause reason not recorded")}</small> : null}
            {work.state?.since == null ? <small>{t("Time not recorded")}</small> : null}
          </details> : null}
        </div>;
  const content = <>
    <header><h2 id={id}>{t("Task progress for {name}", { name })}</h2>{!embedded ? <button type="button" aria-label={t("Close task overview")} onClick={onClose}><X size={20} /></button> : null}</header>
    <p className="head-task-scope" title={t("Watched tasks, including recent completed work. Watching is separate from responsibility and execution.")}>{t("Watched tasks")} · {t("As of {time}", { time: new Date(observedAt ?? now).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", hour12: false }) })}</p>
    <label className="head-window">{t("Recent work window")}<select aria-label={t("Recent work window")} value={windowMinutes} onChange={event => {
      const value = Number(event.target.value);
      if (![30, 60, 180, 360, 1440].includes(value)) return;
      setWindowMinutes(value);
      try { localStorage.setItem("claw3d:task-progress-window-minutes", String(value)); } catch { /* Browser storage can be unavailable. */ }
    }}>{([ [30, "30 minutes"], [60, "1 hour"], [180, "3 hours"], [360, "6 hours"], [1440, "24 hours"] ] as const).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
    {historyLimited ? <p className="head-history-limit">{t("Recent history is limited to the newest 200 archived tasks.")}</p> : null}
    {loading ? <p role="status">{t("Loading tasks…")}</p> : null}
    {error ? <p role="alert">{t(error)}</p> : null}
    {!loading && !error && !visibleRows.length ? <p>{t("No tasks need follow-up.")}</p> : null}
    {visibleRows.length ? <div className="head-task-scroll"><table aria-label={t("Task progress for {name}", { name })}>
      <colgroup><col className="head-task-col" /><col className="head-recent-col" /><col className="head-work-col" /></colgroup>
      <thead><tr><th scope="col">{t("Task")}</th><th scope="col">{t("Recent update")}</th><th scope="col">{t("Current position")}</th></tr></thead>
      <tbody>{visibleRows.map(row => <tr key={row.id} data-head-task-id={row.id} data-activity={row.activityGroup}>
        <th scope="row"><small className="head-activity-label">{t(row.activityGroup === "active" ? "Active" : row.activityGroup === "recent" ? "Recent work" : "Other follow-up")}</small><button type="button" className="head-task-link" title={row.title} aria-label={t("Open task: {name}", { name: `${row.code} · ${row.title}` })} onClick={() => open(row.id)}><span className="head-task-code">{row.code}</span><span className="head-short-text">{row.title}</span></button></th>
        <td className="head-recent">{row.recentAt != null && row.recentAt !== row.tracking?.recent[0]?.at ? <div>{t("Updated")} {recordedTime(row.recentAt)}</div> : null}{!row.tracking ? <span>{t("Progress records unavailable.")}</span> : !row.tracking.recent.length ? <span>{t("No progress recorded")}</span> : (() => {
          const event = row.tracking.recent[0];
          const phaseTitle = row.work.find(work => work.phaseId === event.phaseId)?.title;
          return <div className="head-latest-progress"><strong>{eventActor(event)}</strong><span>{t(event.action)}</span>
            {event.phaseId ? <button type="button" className="head-task-link head-short-text" title={phaseTitle || event.detail || undefined} onClick={() => open(row.id, event.phaseId || undefined)}>{phaseTitle || shortPhaseCode(event.phaseId)}</button> : event.detail ? <span className="head-short-text" title={event.detail}>{event.detail}</span> : null}
            {recordedTime(event.at)}
          </div>;
        })()}
          {row.tracking && (row.tracking.recent.length > 0 || row.tracking.unscopedNote || row.completed?.length) ? <details className="head-progress-details"><summary>{t("Progress details")}</summary>
            {row.completed?.length ? <section aria-label={t("Completed phases")}><h3>{t("Completed phases")}</h3>{row.completed.map(phase => <div className="head-progress-event" key={phase.id}><button type="button" className="head-task-link" onClick={() => open(row.id, phase.id)}>{phase.title}</button>{recordedTime(phase.at, true)}</div>)}</section> : null}
            <p className="head-excerpt-note">{t("Recorded excerpts. Open the task record for full reports and context.")}</p>
            {row.tracking.recent.map((event, index) => <div className="head-progress-event" key={`${event.at}:${index}`}>
              <strong>{eventActor(event)}</strong><span>{t(event.action)}</span>
              {event.phaseId ? <button type="button" className="head-task-link" onClick={() => open(row.id, event.phaseId || undefined)}>{event.detail || shortPhaseCode(event.phaseId)}</button> : event.detail ? <p>{event.detail}</p> : null}
              {recordedTime(event.at, true)}
            </div>)}
            {row.tracking.unscopedNote ? <section className="head-operation-note" aria-label={t("Operation note (phase not recorded)")}><small>{t("Operation note (phase not recorded)")}</small><p>{row.tracking.unscopedNote.text}</p>{recordedTime(row.tracking.unscopedNote.at, true)}</section> : null}
            {row.tracking.historyLimited ? <small>{t("Retained operation history is bounded.")}</small> : null}
            <button type="button" className="head-task-link head-full-record" onClick={() => open(row.id)}>{t("Open full task record")}</button>
          </details> : null}
        </td>
        <td className="head-work-pairs">{row.work.filter(work => !isParked(work)).map(work => renderWork(row.id, work))}
          {row.work.some(work => isParked(work)) ? <details className="head-parked-work"><summary>{t("Paused / other work ({count})", { count: row.work.filter(work => isParked(work)).length })}</summary>
            {row.work.filter(work => isParked(work)).map(work => renderWork(row.id, work))}
          </details> : null}</td>
      </tr>)}</tbody>
    </table></div> : null}
  </>;
  return embedded ? <section className="head-task-overview head-task-overview--embedded" aria-labelledby={id}>{content}</section> : createPortal(<dialog ref={dialog} className="head-task-overview" aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose?.(); }} onClick={event => { if (event.target === event.currentTarget) onClose?.(); }}>{content}</dialog>, document.body);
}
