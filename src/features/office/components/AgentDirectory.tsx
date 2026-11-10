"use client";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Link2, Users, X } from "lucide-react";
import { CharacterPortrait } from "./CharacterPortrait";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";
import { OrganizationPanel } from "@/features/ring-ship/OrganizationPanel";
import { CEO_ID, OPEN_DEPARTMENT_ID, type OrganizationView } from "@/lib/office/organization";
import { departmentButtonLabel } from "@/lib/office/departments";
import { useUiText } from "@/lib/i18n/ui-language";
import { AgentActivityIndicator } from "./AgentActivityIndicator";
import { ScheduledTaskIndicator } from "./ScheduledTaskIndicator";
import { organizeChatRoster } from "../operations/chatRoster";
import { reportingForest, type AgentDirectoryView, type CurrentAgentTask, type DirectoryAgent, type ReportingNode } from "../operations/agentDirectory";
import { MessageSearchResults, type MessageSearchTarget } from "./MessageSearchResults";
import type { SessionClient } from "./SessionControls";
import "./agent-directory.css";

function TaskRoles({ roles = ["Assignee"], parentOwner = false, parentAssignment = false }: { roles?: CurrentAgentTask["roles"]; parentOwner?: boolean; parentAssignment?: boolean }) {
  const t = useUiText();
  const labels = [...(parentOwner ? [t("Parent task owner")] : []), ...roles.map(role => t(role === "Assignee" && parentAssignment ? "Assigned" : role))];
  return labels.length ? <span className="directory-task-role">{labels.join(" + ")}</span> : null;
}

function AssignedTaskMenu({ name, tasks, onOpenTask }: { name: string; tasks: CurrentAgentTask[]; onOpenTask: (id: string, phaseId?: string) => void }) {
  const t = useUiText(), id = useId(), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const count = tasks.reduce((sum, task) => sum + (task.phases?.length ?? 1), 0);
  const escape = (event: KeyboardEvent) => {
    if (open && event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  };
  return <>
    <button ref={trigger} type="button" className="directory-task directory-task-count" title={tasks.map(task => task.title).join("\n")}
      aria-label={t("Tasks for {name}: {count}", { name, count })} aria-expanded={open} aria-controls={id}
      onKeyDown={escape} onClick={() => setOpen(value => !value)}>{t("{count} tasks", { count })}<ChevronDown size={11} aria-hidden="true" /></button>
    {open ? <div id={id} className="directory-task-list" role="group" aria-label={t("Tasks for {name}", { name })} onKeyDown={escape}>
      {tasks.flatMap(task => task.phases?.length ? task.phases.map(phase => <button type="button" key={`${task.id}:${phase.id}`} className="directory-task-link" title={`${task.title}\n${phase.title}\n${phase.id}`} aria-label={t("Open task: {name}", { name: `${task.code} ${phase.code} · ${phase.title}` })}
        onClick={() => { setOpen(false); onOpenTask(task.id, phase.id); }}>
        <span className="directory-task-meta"><span className="directory-task-code">{task.code} · {phase.code}</span><TaskRoles roles={phase.roles} parentOwner={task.roles?.includes("Owner")} /><small>{t(phase.status === "done" ? "Completed" : phase.status === "finished" ? "Participation ended" : phase.status === "waiting" ? "Awaiting result" : phase.status === "running" ? "Running" : phase.status === "review" ? "Awaiting manager review" : phase.status === "paused" ? "Paused" : phase.status === "assigned" ? "Assigned" : "Queued")}</small></span>
        <span className="directory-task-title">{phase.title}</span>
      </button>) : [<button type="button" key={task.id} className="directory-task-link" aria-label={t("Open task: {name}", { name: task.title })}
        onClick={() => { setOpen(false); onOpenTask(task.id); }}><span className="directory-task-meta"><span className="directory-task-code">{task.code}</span><TaskRoles roles={task.roles} parentAssignment /><small>{task.status ? t(task.status === "paused" ? "Paused" : "Running") : null}</small></span><span className="directory-task-title">{task.title}</span></button>])}
    </div> : null}
  </>;
}

export function AgentDirectory({ agents, organization, view, onViewChange, search, onSearchChange, selectedId, onOpenChat, onOpenTask, taskError, focusRequest, client, onOpenMessage, onDismiss }: {
  agents: DirectoryAgent[]; organization: OrganizationView; view: AgentDirectoryView; onViewChange: (view: AgentDirectoryView) => void;
  search: string; onSearchChange: (search: string) => void; selectedId: string | null;
  onOpenChat: (id: string) => void; onOpenTask: (id: string, phaseId?: string) => void; taskError?: string;
  focusRequest?: { id: string; request: number } | null;
  onDismiss?: () => void;
  client?: SessionClient; onOpenMessage?: (target: MessageSearchTarget) => void;
}) {
  const t = useUiText(), container = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [inspected, setInspected] = useState(CEO_ID);
  const [searchMessages, setSearchMessages] = useState(false);
  const forest = useMemo(() => reportingForest(organization.people, agents), [organization.people, agents]);
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const query = search.trim().toLocaleLowerCase();
  const matches = (agent: DirectoryAgent) => !query || [agent.name, agent.id, agent.projectName, ...(agent.tasks || []).flatMap(task => [task.code, task.title, ...(task.phases || []).flatMap(phase => [phase.code, phase.title])])].some(value => value?.toLocaleLowerCase().includes(query));
  const groups = organizeChatRoster(agents.filter(matches), view === "activity" ? "activity" : "project");
  const visible = new Set<string>();
  if (query) {
    const include = (id: string) => { if (visible.has(id)) return; visible.add(id); organization.people.find(person => person.id === id)?.reportsTo.forEach(include); };
    for (const person of organization.people) if ([person.name, person.title, person.department].some(value => value.toLocaleLowerCase().includes(query)) || (byId.has(person.id) && matches(byId.get(person.id)!))) include(person.id);
    for (const agent of agents) if (matches(agent)) include(agent.id);
  }
  useEffect(() => {
    if (!focusRequest || view !== "organization") return;
    const ancestors = new Set<string>();
    const include = (id: string) => { if (ancestors.has(id)) return; ancestors.add(id); organization.people.find(person => person.id === id)?.reportsTo.forEach(include); };
    include(focusRequest.id);
    const frame = requestAnimationFrame(() => {
      setInspected(focusRequest.id);
      setCollapsed(previous => new Set([...previous].filter(id => !ancestors.has(id))));
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, organization.people, view]);
  useEffect(() => {
    if (!focusRequest || view !== "organization") return;
    const frame = requestAnimationFrame(() => {
      const card = [...(container.current?.querySelectorAll<HTMLElement>("[data-person-id]") || [])].find(node => node.dataset.personId === focusRequest.id);
      card?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsed, focusRequest, view]);
  const card = (agent: DirectoryAgent, subtitle: string, departmentLink = false) => {
    const tasks = agent.tasks || [];
    const title = organization.people.find(person => person.id === agent.id)?.title || "Worker";
    return <div className="directory-agent" data-selected={agent.id === selectedId} data-person-id={agent.id} style={{ borderLeftColor: agent.color }}>
    <button type="button" className="directory-agent-open" aria-label={t("Open session: {0}", { "0": agent.name })} onClick={() => { setInspected(agent.id); onOpenChat(agent.id); }}>
      <CharacterPortrait name={agent.name} profile={agent.avatarProfile} />
      <span className="directory-agent-copy"><strong title={agent.name}>{agent.name}</strong><small title={subtitle}>{departmentLink && organization.openDepartment ? ["Worker", "Head", "CEO"].includes(title) ? t(title) : title : subtitle}</small></span>
      <span className="directory-agent-status"><AgentActivityIndicator activity={agent.activity} /><ScheduledTaskIndicator active={agent.hasPendingSchedule} /></span>
    </button>
    {departmentLink && organization.openDepartment ? <button type="button" className="directory-department" title={agent.id === CEO_ID ? t("Company") : agent.projectName || t("Open Workspace")} onClick={() => organization.openDepartment?.(agent.id === CEO_ID ? undefined : agent.projectId || OPEN_DEPARTMENT_ID)}><span>{agent.id === CEO_ID ? t("Company") : departmentButtonLabel(agent.projectId, agent.projectName || t("Open Workspace"))}</span><ChevronRight size={12} aria-hidden="true" /></button> : null}
    {tasks.length === 1 && !tasks[0].phases?.length && !tasks[0].status ? <button type="button" className="directory-task" title={tasks[0].title} aria-label={t("Open task: {name}", { name: tasks[0].title })} onClick={() => onOpenTask(tasks[0].id)}>{tasks[0].code}<TaskRoles roles={tasks[0].roles} /></button> : tasks.length ? <AssignedTaskMenu name={agent.name} tasks={tasks} onOpenTask={onOpenTask} /> : null}
  </div>;
  };
  const branch = (node: ReportingNode): ReactNode => {
    const { person, reference, children } = node;
    if (query && !visible.has(person.id)) return null;
    const agent = byId.get(person.id) || { id: person.id, name: person.name, color: "#e1cb9f", avatarProfile: person.id === CEO_ID ? organization.ceoAvatar : null, projectId: person.departmentId, projectName: person.department, updatedAt: null, activity: getAgentActivity({ status: "idle" }) };
    const expanded = !!query || !collapsed.has(person.id);
    return <li key={person.id} data-ceo={person.id === CEO_ID || undefined}>
      <div className="directory-branch-row">
        {children.length ? <button type="button" className="directory-branch-toggle" aria-label={t("Toggle reports for {name}", { name: person.name })} aria-expanded={expanded} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(person.id)) next.delete(person.id); else next.add(person.id); return next; })}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button> : <span className="directory-branch-spacer">{reference ? <Link2 size={13} aria-label={t("Also reports here")} /> : null}</span>}
        {card(agent, `${["Worker", "Head", "CEO"].includes(person.title) ? t(person.title) : person.title} · ${person.departmentId ? person.department : person.id === CEO_ID ? t("Company") : t("Open Workspace")}`, true)}
      </div>
      {children.length && expanded ? <ul>{children.map(branch)}</ul> : null}
    </li>;
  };
  return <aside id="session-chat-list" ref={container} aria-label={t("Agents")} className="agent-directory session-chat-list">
    <header className="directory-heading"><Users size={16} /><strong>{t(searchMessages ? "Message search" : "Agents")}</strong>{!searchMessages ? <span>{agents.length}</span> : null}{onDismiss ? <button type="button" className="directory-dismiss" aria-label={t("Dismiss session list")} onClick={onDismiss}><X size={16} /></button> : null}</header>
    {client && onOpenMessage ? <div className="directory-search-tabs" role="tablist" aria-label={t("Search type")}>
      <button type="button" role="tab" aria-selected={!searchMessages} onClick={() => setSearchMessages(false)}>{t("Sessions")}</button>
      <button type="button" role="tab" aria-selected={searchMessages} onClick={() => setSearchMessages(true)}>{t("Messages")}</button>
    </div> : null}
    <div className="directory-controls">
      {!searchMessages ? <select aria-label={t("Organize agents")} value={view} onChange={event => onViewChange(event.target.value as AgentDirectoryView)}>
        <option value="project">{t("By project")}</option><option value="organization">{t("Reporting lines")}</option><option value="activity">{t("Recently active")}</option>
      </select> : null}
      <input type="search" aria-label={t(searchMessages ? "Search messages" : "Search sessions")} placeholder={t(searchMessages ? "Search conversation text" : "Search agents, projects or tasks")} value={search} onChange={event => onSearchChange(event.target.value)} />
    </div>
    {taskError ? <p className="directory-notice" role="status">{t(taskError)}</p> : null}
    {searchMessages && client && onOpenMessage ? <MessageSearchResults client={client} query={search} onOpenMessage={onOpenMessage} /> : view === "organization" ? <>
      <div className="directory-tree-tools"><button type="button" onClick={() => setCollapsed(new Set())}>{t("Expand all")}</button><button type="button" onClick={() => setCollapsed(new Set(organization.people.map(person => person.id)))}>{t("Collapse all")}</button></div>
      <div className="directory-scroll"><ul className="directory-tree" aria-label={t("Reporting lines")}>{forest.map(branch)}</ul>{query && !visible.size ? <p className="directory-empty">{t("No matching agents.")}</p> : null}
        <details className="directory-position" key={inspected}><summary>{t("Organization details")} · {organization.people.find(person => person.id === inspected)?.name}</summary><OrganizationPanel key={inspected} organization={organization} personId={inspected} /></details>
      </div>
    </> : <div className="directory-scroll">
      {groups.map(group => <section key={group.id || "ungrouped"}>{view === "project" ? <h3 className="directory-project">{organization.openDepartment ? <button type="button" className="directory-department" title={group.id ? group.name : t("Open Workspace")} onClick={() => organization.openDepartment?.(group.id || OPEN_DEPARTMENT_ID)}><span>{departmentButtonLabel(group.id, group.name)}</span><ChevronRight size={12} aria-hidden="true" /></button> : group.id ? group.name : t("Open Workspace")}<span>{group.agents.length}</span></h3> : null}
        {group.agents.map(entry => { const agent = byId.get(entry.id)!; return <div key={agent.id}>{card(agent, view === "activity" ? (agent.projectId ? agent.projectName : t("Open Workspace")) : t(agent.activity.label), view === "activity")}</div>; })}
      </section>)}
      {!groups.some(group => group.agents.length) ? <p className="directory-empty">{t("No matching agents.")}</p> : null}
    </div>}
  </aside>;
}
