import { createElement, useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HeadTaskOverview } from "@/features/office/components/HeadTaskOverview";
import { AgentInterfaceActions } from "@/features/office/components/AgentInterfaceActions";
import { taskProgressAgentIds, headTaskRows, groupHeadTaskRows, lastTaskProgress } from "@/features/office/operations/headTaskOverview";
import type { DirectoryTaskSummary } from "@/features/office/operations/agentDirectory";
import { CEO_ID, type OrganizationView } from "@/lib/office/organization";
import { setUiLanguage } from "@/lib/i18n/ui-language";

vi.mock("@/features/ring-ship/characterPortrait", () => ({ characterPortrait: vi.fn(async () => "") }));
beforeEach(() => {
  setUiLanguage("en");
  localStorage.removeItem("claw3d:task-progress-window-minutes");
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);
const task: DirectoryTaskSummary = { id: "parent", code: "T1", title: "Parent task", ownerId: "head", assigneeId: "worker", status: "running", archived: false, departmentId: "other" };
const organization: OrganizationView = { ceoAvatar: null, savePosition: vi.fn(), people: [
  { id: "head", name: "Renamable Head", title: "Manager", department: "Open Workspace", departmentId: null, reportsTo: [CEO_ID] },
  { id: "worker", name: "Employee", title: "Worker", department: "Open Workspace", departmentId: null, reportsTo: ["head"] },
] };
const phased: DirectoryTaskSummary = { ...task, executionMode: "phases", phases: [
  { id: "a1234567", title: "Parallel implementation", status: "running", assigneeId: "stale", activity: { agentId: "worker", role: "worker" } },
  { id: "b1234567", title: "Parallel review", status: "review", assigneeId: "submitter", reviewerId: "reviewer" },
  { id: "c1234567", title: "Waiting for dependency", status: "paused", assigneeId: "responsible" },
  { id: "queued", title: "Future work", status: "queued", assigneeId: "future" },
  { id: "done", title: "Past work", status: "running", completedAt: 123, assigneeId: "past" },
] };
it("uses explicit Owner, deduplicates parents, includes pending and cross-department work, excludes completed/archive and other Owners", () => {
  const rows = headTaskRows("head", [task, task, { ...task, id: "queued", status: "queued" }, { ...task, id: "done", status: "done" }, { ...task, id: "archive", archived: true }, { ...task, id: "team", departmentId: null, ownerId: "worker" }, { ...task, id: "unset", ownerId: undefined }]);
  expect(groupHeadTaskRows(rows, Date.now(), 60).map(row => row.id)).toEqual(["parent", "queued"]);
  expect(rows[1].work[0].status).toBe("Not started");
});
it("preserves all parallel work/person pairs and separates Reviewer from Assignee and Owner", () => {
  const work = headTaskRows("head", [phased])[0].work;
  expect(work.map(item => item.id)).toEqual(["a1234567", "b1234567", "c1234567"]);
  expect(work[0].people).toEqual([{ role: "Executing", agentId: "worker" }]);
  expect(work[1].people).toEqual([{ role: "Reviewer", agentId: "reviewer" }, { role: "Submitted by", agentId: "submitter" }]);
  expect(work[2].people).toEqual([{ role: "Responsible", agentId: "responsible" }]);
  expect(work[2].status).toBe("Paused");
});
it("does not replace missing execution with parent Owner, task/phase Assignee, handler, busy or phase order", () => {
  const unknown = { ...phased, phases: [{ id: "unknown", title: "Unknown activity", status: "running", assigneeId: "worker", handlingAgentId: "head" }] };
  expect(headTaskRows("head", [unknown])[0].work[0].people).toEqual([{ role: "Executing", agentId: undefined }]);
  const reviewing = { ...phased, phases: [{ id: "r", title: "Acceptance", status: "running", assigneeId: "worker", activity: { agentId: "head", role: "reviewer" } }] };
  expect(headTaskRows("head", [reviewing])[0].work[0]).toMatchObject({ status: "Reviewing", people: [{ role: "Reviewing", agentId: "head" }] });
  expect(headTaskRows("head", [{ ...task, phases: phased.phases }])[0].work).toMatchObject([{ id: "parent", title: "Specific phase not recorded", status: "Running", people: [{ role: "Task-level responsibility", agentId: "worker" }] }]);
});
it("shows queued and unknown parent work honestly without selecting the first phase", () => {
  expect(headTaskRows("head", [{ ...phased, phases: [{ id: "future", title: "Not current", status: "queued" }] }])[0].work[0]).toMatchObject({ title: "No phase started", status: "Not started", people: [] });
  expect(headTaskRows("head", [{ ...phased, phases: undefined }])[0].work[0].title).toBe("Current work not recorded");
});
it("recognizes role changes and actual department Head IDs without depending on names", () => {
  expect([...taskProgressAgentIds(organization)]).toEqual([CEO_ID, "head"]);
  const promoted = { ...organization, people: organization.people.map(p => ({ ...p, title: p.id === "worker" ? "Head" : "Worker", name: "Renamed" })) };
  expect([...taskProgressAgentIds(promoted)]).toEqual([CEO_ID, "worker"]);
  const directoryHead = { ...organization, people: [], departments: [{ id: "open-workspace", name: "Open Workspace", description: "", heads: [organization.people[0]], members: [] }] };
  expect([...taskProgressAgentIds(directoryHead)]).toEqual([CEO_ID, "head"]);
});
const tracking = { recent: [{ action: "Completed", at: 10000, actorId: "worker", phaseId: "done", detail: "Completed implementation" }], current: [{ phaseId: "a1234567", status: "running", since: 20000, reason: null, waitingForId: null }, { phaseId: "b1234567", status: "review", since: 30000, reason: null, reasonCode: "Submitted for manager acceptance", waitingForId: "reviewer" }], unscopedNote: null };
const names = new Map([["head", "Renamable Head"], ["worker", "Employee"], ["reviewer", "Reviewer"]]);
it("shows recorded progress separately from each current phase/person/wait state and navigates original IDs", () => {
  const onOpenTask = vi.fn(), onClose = vi.fn();
  render(createElement(HeadTaskOverview, { name: "Renamable Head", rows: headTaskRows("head", [{ ...phased, tracking }]), names, loading: false, error: "", onOpenTask, onClose }));
  const table = screen.getByRole("table"); expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(within(table).getAllByRole("columnheader").map(n => n.textContent)).toEqual(["Task", "Recent progress", "Current position"]);
  expect(table.querySelector(".head-recent")).toHaveTextContent("EmployeeCompletedCompleted implementation");
  expect(table.querySelector('[data-head-work-id="a1234567"]')).toHaveTextContent("Employee");
  expect(table.querySelector('[data-head-work-id="b1234567"]')).toHaveTextContent("Waiting for Reviewer");
  expect(table.querySelector('[data-head-work-id="c1234567"]')).toHaveTextContent("Pause reason not recorded");
  expect(table.querySelector('time[datetime="1970-01-01T00:00:10.000Z"]')).toBeTruthy();
  fireEvent.click(screen.getByText("Progress details"));
  fireEvent.click(screen.getByRole("button", { name: "Completed implementation" })); expect(onOpenTask).toHaveBeenCalledWith("parent", "done");
});
it("defaults to one true action, keeps older/unscoped text collapsed and preserves state timestamps when expanded", () => {
  const onOpenTask = vi.fn();
  const recorded = { ...tracking, recent: [
    { action: "Submitted", at: 40000, actorId: "worker", phaseId: "b1234567", detail: "Submitted excerpt; final acceptance is still pending." },
    { action: "Completed", at: 10000, actorId: "worker", phaseId: "done", detail: "Older result with important limitations" },
  ], unscopedNote: { at: 1000, text: "Old unscoped pause note, unrelated to current work" } };
  render(createElement(HeadTaskOverview, { name: "Head", rows: headTaskRows("head", [{ ...phased, tracking: recorded }]), names, loading: false, error: "", onOpenTask, onClose: vi.fn() }));
  const table = screen.getByRole("table"), latest = table.querySelector(".head-latest-progress")!, details = table.querySelector("details")!;
  expect(table.querySelectorAll(".head-latest-progress")).toHaveLength(1); expect(latest).toHaveTextContent("EmployeeSubmittedP-b1234567"); expect(latest).not.toHaveTextContent("Completed");
  expect(details).not.toHaveAttribute("open"); expect(screen.getByText("Older result with important limitations")).not.toBeVisible(); expect(screen.getByText("Old unscoped pause note, unrelated to current work")).not.toBeVisible();
  expect(table.querySelector(".head-work-pairs")).not.toHaveTextContent("Old unscoped pause note");
  const before = [...table.querySelectorAll(".head-state-age time")].map(n => n.getAttribute("datetime"));
  fireEvent.click(screen.getByText("Progress details"));
  expect(screen.getByText("Older result with important limitations")).toBeVisible(); expect(screen.getByText("Submitted excerpt; final acceptance is still pending.")).toBeVisible();
  expect(screen.getByText("Old unscoped pause note, unrelated to current work")).toBeVisible();
  expect([...table.querySelectorAll(".head-state-age time")].map(n => n.getAttribute("datetime"))).toEqual(before);
  fireEvent.click(screen.getByRole("button", { name: "Open full task record" })); expect(onOpenTask).toHaveBeenCalledWith("parent", undefined);
});
it("labels system operations separately from employee actions", () => {
  const system = { ...tracking, recent: [{ action: "Started", at: 10000, actorId: null, actorSource: "system", actorName: "Office", phaseId: null, detail: "System operation" }] };
  render(createElement(HeadTaskOverview, { name: "Head", rows: headTaskRows("head", [{ ...task, tracking: system }]), names, loading: false, error: "", onOpenTask: vi.fn(), onClose: vi.fn() }));
  expect(document.querySelector(".head-latest-progress strong")).toHaveTextContent("System");
  expect(document.querySelector(".head-latest-progress")).not.toHaveTextContent("Employee");
});
it("keeps prior draft DOM mounted and returns focus when the header action closes the same overview", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement("div", null, createElement("textarea", { "aria-label": "existing draft", defaultValue: "Text, @reference and attachments stay with chat" }), createElement(AgentInterfaceActions, { preset: "standard", placement: "inline", onOpenTaskProgress: () => setOpen(true) }), open ? createElement(HeadTaskOverview, { name: "Head", rows: [], names, loading: false, error: "", onOpenTask: vi.fn(), onClose: () => setOpen(false) }) : null);
  }
  render(createElement(Harness)); const draft = screen.getByRole("textbox"), trigger = screen.getByRole("button", { name: "Task progress" }); trigger.focus(); fireEvent.click(trigger);
  expect(screen.getByText("No tasks need follow-up.")).toBeTruthy(); fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.getByRole("textbox")).toBe(draft); expect(draft).toHaveValue("Text, @reference and attachments stay with chat"); expect(trigger).toHaveFocus();
});
it("keeps Teaser and Head actions compatible and moves the same callback to the existing More menu", () => {
  const progress = vi.fn(), teaser = vi.fn();
  const r = render(createElement("details", { open: true }, createElement(AgentInterfaceActions, { preset: "teaser", placement: "menu", onOpenTaskProgress: progress, onOpenBoard: teaser })));
  expect(screen.getByRole("button", { name: "Teaser board" })).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Task progress" })); expect(progress).toHaveBeenCalledOnce(); expect(document.querySelector("details")).not.toHaveAttribute("open");
  r.rerender(createElement(AgentInterfaceActions, { preset: "standard", placement: "inline" })); expect(screen.queryByRole("button", { name: "Task progress" })).toBeNull();
});
it("distinguishes loading, failure, empty, unsupported progress and recorded unknown fields", () => {
  const props = { name: "Head", rows: [], names, loading: true, error: "", onOpenTask: vi.fn(), onClose: vi.fn() };
  const r = render(createElement(HeadTaskOverview, props)); expect(screen.getByRole("status")).toHaveTextContent("Loading tasks"); expect(screen.queryByText("No tasks need follow-up.")).toBeNull();
  r.rerender(createElement(HeadTaskOverview, { ...props, loading: false, error: "Current tasks are unavailable." })); expect(screen.getByRole("alert")).toBeTruthy(); expect(screen.queryByText("No tasks need follow-up.")).toBeNull();
  r.rerender(createElement(HeadTaskOverview, { ...props, loading: false })); expect(screen.getByText("No tasks need follow-up.")).toBeTruthy();
  r.rerender(createElement(HeadTaskOverview, { ...props, loading: false, rows: headTaskRows("head", [task]) })); expect(screen.getByText("Progress records unavailable.")).toBeTruthy(); expect(screen.getByText("Specific phase not recorded")).toBeTruthy();
});
it("translates application text, retaining task and actor wording as data", () => {
  setUiLanguage("zh-CN"); render(createElement(HeadTaskOverview, { name: "Head", rows: headTaskRows("head", [{ ...task, tracking }]), names, loading: false, error: "", onOpenTask: vi.fn(), onClose: vi.fn() }));
  expect(screen.getByRole("table")).toHaveTextContent("最近进展"); expect(screen.getByRole("table")).toHaveTextContent("Parent task"); expect(screen.getByRole("table")).toHaveTextContent("Employee");
});

it("unions automatic Owner with explicit watchers without changing parent counts or execution attribution", () => {
  const watched = { ...phased, watcherIds: [CEO_ID, "observer", "observer"] };
  for (const id of ["head", CEO_ID, "observer"]) expect(headTaskRows(id, [watched, watched])).toHaveLength(1);
  expect(headTaskRows("worker", [watched])).toHaveLength(0);
  expect(headTaskRows("head", [{ ...watched, ownerId: "new-owner" }])).toHaveLength(0);
  expect(headTaskRows("new-owner", [{ ...watched, ownerId: "new-owner", watcherIds: [] }])).toHaveLength(1);
  expect(groupHeadTaskRows(headTaskRows(CEO_ID, [{ ...watched, status: "done", phases: [] }, { ...watched, archived: true, phases: [] }]), Date.now(), 60)).toHaveLength(0);
  expect(headTaskRows("observer", [watched])[0].work).toEqual(headTaskRows("head", [watched])[0].work);
  expect(taskProgressAgentIds(organization).has(CEO_ID)).toBe(true);
  expect(taskProgressAgentIds(organization).has("worker")).toBe(false);
});

it.each(["Accepted", "Submitted"])("keeps an unscoped %s report in the short preview and collapsed original excerpt", action => {
  const report = "Accepted delivery with important limits; this task is still awaiting the remaining phases. ".repeat(3);
  const onOpenTask = vi.fn();
  const recorded = { recent: [{ action, at: 40000, actorId: "head", phaseId: null, detail: report }], current: [], unscopedNote: null };
  render(createElement(HeadTaskOverview, { name: "Head", rows: headTaskRows("head", [{ ...task, tracking: recorded }]), names, loading: false, error: "", onOpenTask, onClose: vi.fn() }));
  const latest = document.querySelector(".head-latest-progress")!, preview = latest.querySelector(".head-short-text")!, details = document.querySelector(".head-progress-details")!;
  expect(latest).toHaveTextContent(action); expect(latest).not.toHaveTextContent("Completed");
  expect(preview.tagName).toBe("SPAN"); expect(preview.textContent).toBe(report);
  expect(details).not.toHaveAttribute("open"); expect(details.querySelector(".head-progress-event p")).not.toBeVisible();
  fireEvent.click(screen.getByText("Progress details"));
  expect(details.querySelector(".head-progress-event p")).toBeVisible(); expect(details.querySelector(".head-progress-event p")?.textContent).toBe(report);
  fireEvent.click(screen.getByRole("button", { name: "Open full task record" })); expect(onOpenTask).toHaveBeenCalledWith("parent", undefined);
});

it("puts actual following work first, distinguishes explicit decisions and folds completed history", () => {
  const input = { ...phased, phases: [phased.phases![2], phased.phases![0], phased.phases![4]], tracking: { ...tracking, current: [{ phaseId: "c1234567", status: "paused", since: 1, needsUserDecision: true, reason: "Choose scope", waitingForId: null }] } };
  const rows = headTaskRows("head", [input]);
  expect(rows[0].work.map(w => [w.id, w.status])).toEqual([["a1234567", "Running"], ["c1234567", "Needs user decision"]]);
  expect(rows[0].work[0].people).toEqual([{ role: "Executing", agentId: "worker" }]);
  render(createElement(HeadTaskOverview, { name: "Head", rows, names, loading: false, error: "", onOpenTask: vi.fn(), onClose: vi.fn() }));
  expect(screen.getByText("Past work")).not.toBeVisible();
  fireEvent.click(screen.getByText("Progress details"));
  expect(screen.getByText("Past work")).toBeVisible();
});

it("uses a real remaining nested handoff as responsibility, never stale accepted executor or guessed Owner", () => {
  const t = { ...phased, phases: [{ id: "fix", title: "Generic tick fix", status: "running", assigneeId: "dev" }], delegations: [
    { phaseId: "fix", managerId: "head", workerId: "quant", state: "working" },
    { phaseId: "fix", managerId: "quant", workerId: "dev", state: "accepted" },
  ] };
  expect(headTaskRows("head", [t])[0].work[0].people).toEqual([{ role: "Responsible", agentId: "quant" }]);
});

it("keeps paused/unknown work collapsed, preserves detail and full active title with original links", () => {
  const open = vi.fn();
  render(createElement(HeadTaskOverview, { name: "Head", rows: headTaskRows("head", [{ ...phased, tracking }]), names, loading: false, error: "", onOpenTask: open, onClose: vi.fn() }));
  const active = document.querySelector('[data-head-work-id="a1234567"]')!;
  const title = active.querySelector('button')!;
  expect(title).toHaveClass("head-current-title"); expect(title).not.toHaveClass("head-short-text");
  expect(screen.getByText("Pause reason not recorded")).not.toBeVisible();
  expect(screen.getByText("User decision need not recorded")).not.toBeVisible();
  expect(document.querySelector('.head-parked-work')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText("Paused / other work (1)"));
  expect(screen.getByText("Pause reason not recorded")).toBeVisible();
  expect(screen.getByText("User decision need not recorded")).toBeVisible();
  expect(screen.queryByText("No user decision needed")).toBeNull();
  fireEvent.click(title);expect(open).toHaveBeenCalledWith('parent','a1234567');
});
it("keeps an entirely parked task compact and allows keyboard access to recorded stop reason", () => {
  const stopped = { ...phased, phases: [phased.phases![2]], tracking: { ...tracking, current: [{phaseId:'c1234567',status:'paused',since:20000,reason:'User explicitly stopped the run',needsUserDecision:false,waitingForId:null}] } };
  render(createElement(HeadTaskOverview, { name: "Head", rows: headTaskRows("head", [stopped]), names, loading: false, error: "", onOpenTask: vi.fn(), onClose: vi.fn() }));
  expect(screen.getByText('User explicitly stopped the run')).not.toBeVisible();
  fireEvent.click(screen.getByText('Paused / other work (1)'));
  expect(screen.getByText('User explicitly stopped the run')).toBeVisible();
  expect(screen.queryByText('Needs user decision')).toBeNull();
});


it("groups genuine recent work after long-running tasks and retains completed/paused work only with evidence", () => {
  const now = Date.now(), ago = (minutes: number) => now - minutes * 60000;
  const make = (id: string, extra = {}) => ({ ...task, id, status: "paused", ...extra });
  const input = [make("cold", { updatedAt: now }), make("recent", { tracking: { recent: [{ action: "Submitted", at: ago(10), actorId: "worker", phaseId: null }], current: [] } }),
    make("old-running", { status: "running", tracking: { recent: [{ action: "Started", at: ago(120), actorId: "worker", phaseId: null }], current: [] } }),
    make("done", { status: "done", archived: true, completedAt: ago(5) }), make("old-done", { status: "done", archived: true, completedAt: ago(61) }),
    make("paused", { pauseContext: { at: ago(3), actor: { source: "agent" } } }),
    make("timer", { pauseContext: { at: now, actor: { source: "system" } }, tracking: { recent: [{ action: "Paused", at: now, actorId: null, actorSource: "system" }], current: [] } }),
  ];
  const rows=groupHeadTaskRows(headTaskRows("head",input),now,60);
  expect(rows.map(r=>[r.id,r.activityGroup])).toEqual([["old-running","running"],["paused","recent"],["done","recent"],["recent","recent"],["cold","other"],["timer","other"]]);
  expect(groupHeadTaskRows(headTaskRows("head",input),now,180).some(r=>r.id==="old-done")).toBe(true);
  expect(lastTaskProgress(make("metadata",{updatedAt:now,lastStartedAt:now}))).toBeNull();
});
it("uses recorded phase completion/pause but not an unknown historical timer stop or unrelated observer", () => {
  const now=Date.now();const t={...phased,phases:[{id:"done",title:"Delivered",status:"done",completedAt:now-1000},{id:"p",title:"Explicit pause",status:"paused",pauseContext:{at:now,actor:{source:"user"}}}]};
  expect(lastTaskProgress(t)).toBe(now);
  expect(groupHeadTaskRows(headTaskRows("head",[t]),now,60)[0].activityGroup).toBe("recent");
  expect(headTaskRows("other-observer",[t])).toHaveLength(0);
  expect(lastTaskProgress({...task,status:"paused",tracking:{recent:[],current:[{phaseId:null,status:"paused",since:now,reason:null,reasonCode:"Legacy timer stop; follow-up not recorded",waitingForId:null}]}})).toBeNull();
});
it("remembers a validated window and automatically expires closed work without querying the backend", async () => {
  vi.useFakeTimers();
  try {
    const now=new Date("2026-11-13T10:00:00Z").getTime();vi.setSystemTime(now);
    const rows=headTaskRows("head",[{...task,id:"done",status:"done",archived:true,completedAt:now-60*60000+1000}]);
    const props={name:"Head",rows,names,loading:false,error:"",embedded:true,onOpenTask:vi.fn()};
    const view=render(createElement(HeadTaskOverview,props));
    expect(screen.getByLabelText("Recent work window")).toHaveValue("60");expect(document.querySelector('[data-head-task-id="done"]')).toBeTruthy();
    await act(async()=>vi.advanceTimersByTime(500));view.rerender(createElement(HeadTaskOverview,{...props,rows:[...rows]}));
    await act(async()=>vi.advanceTimersByTime(500));expect(document.querySelector('[data-head-task-id="done"]')).toBeNull();
    fireEvent.change(screen.getByLabelText("Recent work window"),{target:{value:"180"}});expect(document.querySelector('[data-head-task-id="done"]')).toBeTruthy();
    view.unmount();render(createElement(HeadTaskOverview,props));expect(screen.getByLabelText("Recent work window")).toHaveValue("180");
  }finally{vi.useRealTimers()}
});

it("keeps a recently explicitly paused phase visible while cold paused history stays collapsed", () => {
  const now=Date.now();const input={...phased,phases:[{id:'recent',title:'Just paused real work',status:'paused',assigneeId:'worker',pauseContext:{at:now-1000,actor:{source:'agent'}}},{id:'old',title:'Cold paused work',status:'paused',assigneeId:'worker'}]};
  render(createElement(HeadTaskOverview,{name:'Head',rows:headTaskRows('head',[input]),names,loading:false,error:'',embedded:true,onOpenTask:vi.fn()}));
  expect(screen.getByText('P-recent · Just paused real work')).toBeVisible();
  expect(screen.getByText('P-old · Cold paused work')).not.toBeVisible();
});

it("deduplicates current ownership before watcher filtering and rejects unsupported stored windows",()=>{
  expect(headTaskRows('head',[{...task,status:'done',archived:true},{...task,ownerId:'new-owner'}])).toHaveLength(0);
  localStorage.setItem('claw3d:task-progress-window-minutes','17');
  render(createElement(HeadTaskOverview,{name:'Head',rows:[],names,loading:false,error:'',embedded:true,onOpenTask:vi.fn()}));
  expect(screen.getByLabelText('Recent work window')).toHaveValue('60');
});

it("shows a unique valid legacy timed plan phase without asserting phase execution or a handoff binding", () => {
  const legacy = {...task, phases:[{id:'earlier',title:'Earlier incomplete',startedAt:null,completedAt:null},{id:'current-clock',title:'Current legacy plan position',startedAt:1794544555969,completedAt:null,assigneeId:'unrelated-phase-person'}]};
  const rows=headTaskRows('head',[legacy]);
  expect(rows[0].work[0]).toMatchObject({id:'parent',phaseId:'current-clock',scopeLabel:'Current timed phase',title:'P-current- · Current legacy plan position',status:'Running',people:[{role:'Task-level responsibility',agentId:'worker'}]});
  expect(rows[0].work[0]).not.toHaveProperty('handoffId');
  const open=vi.fn();render(createElement(HeadTaskOverview,{name:'Head',rows,names,loading:false,error:'',embedded:true,onOpenTask:open}));
  expect(screen.getByText('Current timed phase')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'P-current- · Current legacy plan position'}));
  expect(open).toHaveBeenCalledWith('parent','current-clock');
});
it.each([
  ['no clock',[]],
  ['background stopped clock',[{id:'p',title:'Next task',startedAt:null,completedAt:null}]],
  ['multiple clocks',[{id:'p',title:'One',startedAt:1000,completedAt:null},{id:'q',title:'Two',startedAt:2000,completedAt:null}]],
  ['NaN time',[{id:'p',title:'Bad',startedAt:NaN,completedAt:null}]],
  ['infinite time',[{id:'p',title:'Bad',startedAt:Infinity,completedAt:null}]],
  ['negative time',[{id:'p',title:'Bad',startedAt:-1,completedAt:null}]],
  ['string time',[{id:'p',title:'Bad',startedAt:'1794544555969',completedAt:null}]],
  ['completed residue',[{id:'p',title:'Done',startedAt:1000,completedAt:2000}]],
  ['residue plus current',[{id:'p',title:'Done',startedAt:1000,completedAt:2000},{id:'q',title:'Current',startedAt:3000,completedAt:null}]],
  ['missing ID',[{title:'Unlinked',startedAt:1000,completedAt:null}]],
  ['duplicate phase IDs',[{id:'p',title:'Old duplicate',startedAt:null,completedAt:null},{id:'p',title:'Current duplicate',startedAt:1000,completedAt:null}]],
  ['paused phase residue',[{id:'p',title:'Paused',startedAt:1000,completedAt:null,status:'paused'}]],
])("does not guess a legacy phase for %s", (_label,phases)=>{
  const rows=headTaskRows('head',[{...task,phases} as DirectoryTaskSummary]);
  expect(rows[0].work[0].title).toBe('Specific phase not recorded');expect(rows[0].work[0]).not.toHaveProperty('phaseId');
});
it.each(['paused','queued'])("does not promote stale legacy timers when the task is %s",status=>{
  const work=headTaskRows('head',[{...task,status,phases:[{id:'p',title:'Stale timer',startedAt:1000,completedAt:null}]}])[0].work[0];
  expect(work).not.toHaveProperty('phaseId');expect(work.title).toBe('Specific phase not recorded');
});
it("preserves the legacy reviewer and recent grouping while locating only a timer",()=>{
  const now=Date.now();const legacy={...task,reviewerId:'reviewer',phases:[{id:'clock',title:'Review plan',startedAt:now-1000,completedAt:null}],tracking:{recent:[{action:'Submitted',at:now-1000,actorId:'worker',phaseId:null}],current:[]}};
  const row=headTaskRows('head',[legacy])[0];expect(row.work[0].people).toEqual([{role:'Reviewer',agentId:'reviewer'},{role:'Task-level responsibility',agentId:'worker'}]);
  expect(row.work[0].status).toBe('Awaiting manager review');expect(groupHeadTaskRows([row],now,60)[0].activityGroup).toBe('recent');
});
