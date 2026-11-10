import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentDirectory } from "@/features/office/components/AgentDirectory";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";
import { currentTasksByAgent, reportingForest, shortPhaseCode, type DirectoryAgent, type ReportingNode } from "@/features/office/operations/agentDirectory";
import { CEO_ID, type OrganizationView } from "@/lib/office/organization";
import { setUiLanguage } from "@/lib/i18n/ui-language";

vi.mock("@/features/ring-ship/characterPortrait", () => ({ characterPortrait: vi.fn(async () => "data:image/png;base64,cG9ydHJhaXQ=") }));
beforeEach(() => {
  setUiLanguage("en");
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);
const agents: DirectoryAgent[] = [
  { id: "worker", name: "Worker 3", color: "#ffcc00", activity: getAgentActivity({ status: "working" }), hasPendingSchedule: true, updatedAt: 100, projectId: "office", projectName: "Office", tasks: [{ id: "avc", title: "Agent View Compression (AVC)", code: "AVC" }] },
  { id: "head", name: "Ranger", color: "#00cccc", activity: getAgentActivity({ status: "idle", needsInput: true }), updatedAt: 200, projectId: "office", projectName: "Office" },
  { id: "review", name: "Reviewer", color: "#cc00cc", activity: getAgentActivity({ status: "idle", needsReview: true }), updatedAt: 50, projectId: null, projectName: "Open Workspace" },
];
const organization: OrganizationView = { ceoAvatar: null, savePosition: vi.fn(), people: [
  { id: CEO_ID, name: "CEO", title: "CEO", department: "Company", departmentId: null, reportsTo: [] },
  { id: "head", name: "Ranger", title: "Head", department: "Office", departmentId: "office", reportsTo: [CEO_ID] },
  { id: "worker", name: "Worker 3", title: "Worker", department: "Office", departmentId: "office", reportsTo: ["head", CEO_ID] },
  { id: "review", name: "Reviewer", title: "Worker", department: "Open Workspace", departmentId: null, reportsTo: [CEO_ID] },
] };
it("opens the real CEO session from the organization tree instead of only inspecting the NPC", () => {
  const onOpenChat = vi.fn();
  const ceo: DirectoryAgent = { ...agents[0], id: CEO_ID, name: "CEO", projectId: null, projectName: "Company", tasks: [] };
  render(createElement(AgentDirectory, { agents: [ceo, ...agents], organization, view: "organization", search: "", onSearchChange: vi.fn(), selectedId: null, onViewChange: vi.fn(), onOpenChat, onOpenTask: vi.fn() }));
  expect(document.querySelectorAll(`[data-person-id="${CEO_ID}"]`)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Open session: CEO" }));
  expect(onOpenChat).toHaveBeenCalledExactlyOnceWith(CEO_ID);
});
function fixture(view: "project" | "activity" | "organization" = "project", search = "") {
  const props = { agents, organization, view, search, onSearchChange: vi.fn(), selectedId: null, onViewChange: vi.fn(), onOpenChat: vi.fn(), onOpenTask: vi.fn() };
  const result = render(createElement(AgentDirectory, props));
  return { ...result, props };
}
it("indexes the same task ID under Owner and Assignee, deduplicates the same person and keeps different tasks", () => {
  const shared = { id: "same", code: "T1", title: "Shared task", ownerId: "head", assigneeId: "worker", status: "running", archived: false };
  const indexed = currentTasksByAgent([shared, shared, { ...shared, id: "both", code: "T2", ownerId: "worker" }, { ...shared, id: "finished", status: "done" }, { ...shared, id: "archived", archived: true }]);
  expect(indexed.get("head")).toEqual([{ id: "same", title: "Shared task", code: "T1", roles: ["Owner"], status: "running" }]);
  expect(indexed.get("worker")).toEqual([{ id: "same", title: "Shared task", code: "T1", roles: ["Assignee"], status: "running" }, { id: "both", title: "Shared task", code: "T2", roles: ["Owner", "Assignee"], status: "running" }]);
});
it.each(["project", "activity", "organization"] as const)("shows each person's actual task roles in single badges and multi-task menus in %s", view => {
  const summaries = [{ id: "same", title: "Shared task", ownerId: "head", assigneeId: "worker", status: "running", archived: false }, { id: "both", title: "Both roles", ownerId: "worker", assigneeId: "worker", status: "running", archived: false }];
  const indexed = currentTasksByAgent(summaries);
  const onOpenTask = vi.fn();
  render(createElement(AgentDirectory, { agents: agents.map(agent => ({ ...agent, tasks: indexed.get(agent.id) })), taskSummaries: summaries, organization, view, search: "", onSearchChange: vi.fn(), onViewChange: vi.fn(), selectedId: null, onOpenChat: vi.fn(), onOpenTask }));
  fireEvent.click(screen.getAllByRole("button", { name: "Managed tasks for Ranger" })[0]);
  const ownerTable = screen.getByRole("table");
  expect(within(ownerTable).getByRole("button", { name: "Open task: same · Shared task" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close task overview" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Tasks for Worker 3: 2" })[0]);
  const menu = screen.getByRole("group", { name: "Tasks for Worker 3" });
  expect(within(menu).getByRole("button", { name: "Open task: Shared task" })).toHaveTextContent("Assigned");
  expect(within(menu).getByRole("button", { name: "Open task: Both roles" })).toHaveTextContent("Owner + Assigned");
  fireEvent.click(within(menu).getByRole("button", { name: "Open task: Shared task" }));
  expect(onOpenTask).toHaveBeenCalledWith("same");
});
it.each(["project", "activity", "organization"] as const)("preserves avatars, attention states, schedule and task links in %s", view => {
  const { props } = fixture(view);
  expect(screen.getAllByRole("img", { name: "Working" }).length).toBeGreaterThan(0);
  expect(screen.getByRole("img", { name: "Needs your input" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "New result to review" })).toBeTruthy();
  expect(screen.getAllByRole("img", { name: "Pending scheduled task" }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("img", { name: "Portrait of Worker 3" }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole("button", { name: "Open task: Agent View Compression (AVC)" })[0]);
  expect(props.onOpenTask).toHaveBeenCalledWith("avc");
  expect(props.onOpenChat).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Open session: Worker 3" })[0]);
  expect(props.onOpenChat).toHaveBeenCalledWith("worker");
});
it("groups projects by default and orders recent activity by actual timestamps", () => {
  const { rerender, props } = fixture();
  expect(screen.getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["Office2", "Open Workspace1"]);
  rerender(createElement(AgentDirectory, { ...props, view: "activity" }));
  expect(screen.getAllByRole("button", { name: /^Open session:/ }).map(node => node.getAttribute("aria-label"))).toEqual(["Open session: Ranger", "Open session: Worker 3", "Open session: Reviewer"]);
  fireEvent.change(screen.getByRole("combobox", { name: "Organize agents" }), { target: { value: "organization" } });
  expect(props.onViewChange).toHaveBeenCalledWith("organization");
});
it("keeps ancestor paths when searching by a task code and lets branches collapse", () => {
  const { props, rerender } = fixture("organization", "AVC");
  const tree = screen.getByRole("list", { name: "Reporting lines" });
  expect(within(tree).getByRole("button", { name: "Open session: CEO" })).toBeTruthy();
  expect(within(tree).getByRole("button", { name: "Open session: Ranger" })).toBeTruthy();
  expect(within(tree).queryByRole("button", { name: "Open session: Reviewer" })).toBeNull();
  rerender(createElement(AgentDirectory, { ...props, search: "" }));
  fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
  expect(within(tree).queryByRole("button", { name: "Open session: Worker 3" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  expect(within(tree).getAllByRole("button", { name: "Open session: Worker 3" })).toHaveLength(2);
  expect(within(tree).getByLabelText("Also reports here")).toBeTruthy();
});
it("shows only running legacy work, excluding queued, paused, completed and archived work", () => {
  const task = { id: "avc", code: "T37", title: "Agent View Compression (AVC)", status: "running", archived: false, assigneeId: "worker" };
  const result = currentTasksByAgent([task, task, { ...task, id: "paused", status: "paused" }, { ...task, id: "queued", status: "queued", assigneeId: "head" }, { ...task, id: "done", status: "done" }, { ...task, id: "archived", archived: true }, { ...task, id: "orphan", assigneeId: null }]);
  expect([...result.keys()]).toEqual(["worker"]);
  expect(result.get("worker")?.map(task => task.id)).toEqual(["avc"]);
  expect(result.has("head")).toBe(false);
  expect(currentTasksByAgent([{ ...task, title: "Renamed task" }]).get("worker")?.[0].code).toBe("T37");
  expect(currentTasksByAgent([{ ...task, code: undefined }]).get("worker")?.[0].code).toBe(task.id);
});
it.each(["project", "activity", "organization"] as const)("keeps idle agents' assignments accessible and searchable in %s", view => {
  const { props, rerender } = fixture(view);
  const assigned = [...agents[0].tasks!, { id: "sync", title: "Server Sync (SYNC)", code: "SYNC" }];
  const idle = { ...agents[0], activity: getAgentActivity({ status: "idle" }), tasks: assigned };
  rerender(createElement(AgentDirectory, { ...props, agents: [idle, ...agents.slice(1)] }));
  const trigger = screen.getAllByRole("button", { name: "Tasks for Worker 3: 2" })[0];
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("group", { name: "Tasks for Worker 3" })).toBeNull();
  fireEvent.click(trigger);
  // Shared reporting references must not open a second copy of the list.
  const list = screen.getByRole("group", { name: "Tasks for Worker 3" });
  expect(within(list).getAllByRole("button")).toHaveLength(2);
  fireEvent.keyDown(list, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Open task: Server Sync (SYNC)" }));
  expect(props.onOpenTask).toHaveBeenCalledWith("sync");
  expect(props.onOpenChat).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  rerender(createElement(AgentDirectory, { ...props, agents: [idle, ...agents.slice(1)], search: "SYNC" }));
  expect(screen.getAllByRole("button", { name: "Tasks for Worker 3: 2" }).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Open session: Reviewer" })).toBeNull();
  rerender(createElement(AgentDirectory, { ...props, agents: [idle], search: "", view: "activity" }));
  fireEvent.click(screen.getByRole("button", { name: "Tasks for Worker 3: 2" }));
  rerender(createElement(AgentDirectory, { ...props, agents: [{ ...idle, tasks: [assigned[0]] }], search: "", view: "activity" }));
  expect(screen.getByRole("button", { name: "Open task: Agent View Compression (AVC)" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Tasks for Worker 3" })).toBeNull();
});
it("retains every reporting edge and unconfigured session, with bounded references for shared subtrees", () => {
  const people = [...organization.people, { id: "newbie", name: "Newbie", title: "Worker", department: "Office", departmentId: "office", reportsTo: ["worker"] }];
  const forest = reportingForest(people, [...agents, { ...agents[0], id: "new-session" }]);
  const nodes: ReportingNode[] = [];
  const collect = (node: ReportingNode) => { nodes.push(node); node.children.forEach(collect); };
  forest.forEach(collect);
  expect(nodes.filter(node => node.person.id === "worker")).toHaveLength(2);
  expect(nodes.filter(node => node.person.id === "worker" && node.reference)).toHaveLength(1);
  expect(nodes.filter(node => node.person.id === "newbie")).toHaveLength(1);
  expect(nodes.some(node => node.person.id === "new-session")).toBe(true);
});

it("only offers overlay dismissal when requested and leaves chat selection to its own control", () => {
  const { props, rerender } = fixture("organization");
  expect(screen.queryByRole("button", { name: "Dismiss session list" })).toBeNull();
  const onDismiss = vi.fn();
  rerender(createElement(AgentDirectory, { ...props, onDismiss }));
  expect(screen.getByRole("combobox", { name: "Organize agents" })).toHaveValue("organization");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss session list" }));
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(props.onOpenChat).not.toHaveBeenCalled();
});

it.each(["project", "activity", "organization"] as const)("keeps department buttons distinct from chats and exposes full department names in %s", view => {
  const name = "A department name long enough to be visually truncated", openDepartment = vi.fn(), onOpenChat = vi.fn();
  const ceo: DirectoryAgent = { ...agents[0], id: CEO_ID, name: "CEO", projectId: null, projectName: "Company", tasks: [] };
  render(createElement(AgentDirectory, {
    agents: [ceo, ...agents.map(agent => agent.projectId ? { ...agent, projectName: name } : agent)],
    organization: { ...organization, openDepartment, people: organization.people.map(person => person.departmentId ? { ...person, department: name } : person) },
    view, search: "", onSearchChange: vi.fn(), selectedId: null, onViewChange: vi.fn(), onOpenChat, onOpenTask: vi.fn(),
  }));
  const buttons = screen.getAllByRole("button", { name });
  for (const button of buttons) {
    expect(button).toHaveClass("directory-department"); expect(button).toHaveAttribute("title", name);
    expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(button.closest(".directory-agent-open")).toBeNull();
  }
  fireEvent.click(buttons[0]); expect(openDepartment).toHaveBeenLastCalledWith("office");
  const open = screen.getAllByRole("button", { name: "Open Workspace" })[0];
  expect(open).toHaveAttribute("title", "Open Workspace");
  fireEvent.click(open); expect(openDepartment).toHaveBeenLastCalledWith("open-workspace");
  if (view !== "project") {
    const company = screen.getAllByRole("button", { name: "Company" })[0];
    expect(company).toHaveAttribute("title", "Company"); fireEvent.click(company);
    expect(openDepartment).toHaveBeenLastCalledWith(undefined);
  }
  expect(onOpenChat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open session: CEO" }));
  expect(onOpenChat).toHaveBeenCalledWith(CEO_ID);
});

it("deduplicates a phase-mode parent and displays only each employee's actual participation state", () => {
  const task = { id: "shared", title: "Shared", status: "running", archived: false, executionMode: "phases" as const, ownerId: "head", assigneeId: "old-parent", phases: [
    { id: "a", title: "Teaser", status: "running", assigneeId: "worker", handlingAgentId: "worker", completedAt: null },
    { id: "b", title: "Clone", status: "done", assigneeId: "other", handlingAgentId: "head", completedAt: 1000 },
  ], delegations: [{ phaseId: "a", managerId: "head", workerId: "retired-worker", state: "recalled" }] };
  const index = currentTasksByAgent([task, task]);
  expect(index.get("head")).toHaveLength(1); expect(index.get("worker")?.[0].phases).toEqual([{ id: "a", code: "P-a", title: "Teaser", status: "running", roles: ["Assignee"] }]);
  expect(index.has("other")).toBe(false); expect(index.has("old-parent")).toBe(false);
  expect(index.has("retired-worker")).toBe(false);
});


it("expands the parent Owner scope while keeping phase Assignee and Reviewer roles separate", () => {
  const phases = [
    { id: "a1234567-aaaa-4000-8000-000000000001", title: "Investigate", status: "running", assigneeId: "worker", handlingAgentId: "worker", completedAt: null },
    { id: "b1234567-bbbb-4000-8000-000000000002", title: "Review", status: "running", assigneeId: "other", reviewerId: "worker", handlingAgentId: "worker", completedAt: null },
    { id: "c1234567-cccc-4000-8000-000000000003", title: "Unrelated", status: "queued", assigneeId: "other", completedAt: null },
  ];
  const task = { id: "shared", code: "T87", title: "Parent", status: "running", archived: false, executionMode: "phases" as const, ownerId: "head", assigneeId: null, phases };
  const index = currentTasksByAgent([task, task]);
  expect(index.get("head")).toHaveLength(1);
  expect(index.get("head")?.[0].phases?.map(p => p.title)).toEqual(["Investigate", "Review"]);
  expect(index.get("head")?.[0].phases?.every(p => !p.roles.length)).toBe(true);
  expect(index.get("worker")?.[0].phases?.map(p => [p.title, p.roles, p.status])).toEqual([["Investigate", ["Assignee"], "running"], ["Review", ["Reviewer"], "running"]]);
  const reordered = currentTasksByAgent([{ ...task, phases: [...phases].reverse() }]);
  expect(reordered.get("head")?.[0].phases?.find(p => p.id === phases[0].id)?.code).toBe(index.get("worker")?.[0].phases?.[0].code);
  expect(shortPhaseCode(phases[0].id)).toBe("P-a1234567");
});

it.each(["project", "activity", "organization"] as const)("opens separate running phase rows even for one parent and counts the visible work items in %s", view => {
  const phases = [
    { id: "first-phase", code: "P-first-ph", title: "Running investigation with a long detailed title", status: "running", roles: ["Assignee" as const] },
    { id: "review-phase", code: "P-review-p", title: "Review the result", status: "running", roles: ["Reviewer" as const] },
  ];
  const onOpenTask = vi.fn();
  render(createElement(AgentDirectory, { agents: [{ ...agents[0], tasks: [{ id: "parent", code: "T87", title: "Parent task", roles: ["Owner", "Assignee", "Reviewer"], phases }] }], organization, view, search: "", onSearchChange: vi.fn(), onViewChange: vi.fn(), selectedId: null, onOpenChat: vi.fn(), onOpenTask }));
  const trigger = screen.getAllByRole("button", { name: "Tasks for Worker 3: 2" })[0]; fireEvent.click(trigger);
  const menu = screen.getByRole("group", { name: "Tasks for Worker 3" });
  const rows = within(menu).getAllByRole("button"); expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("T87 · P-first-ph"); expect(rows[0]).toHaveTextContent("Running");
  expect(rows[0]).toHaveTextContent("Parent task owner + Assignee"); expect(rows[0]).not.toHaveTextContent("Reviewer");
  expect(rows[1]).toHaveTextContent("Parent task owner + Reviewer"); expect(rows[1]).not.toHaveTextContent("Assignee");
  fireEvent.click(rows[1]); expect(onOpenTask).toHaveBeenCalledExactlyOnceWith("parent", "review-phase");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it("excludes ended participation instead of inventing a current Assignee or Reviewer role", () => {
  const index = currentTasksByAgent([{ id: "t", title: "Task", assigneeId: null, ownerId: "head", status: "queued", archived: false, executionMode: "phases", phases: [{ id: "p", title: "Past participation", assigneeId: "other" }], delegations: [{ phaseId: "p", workerId: "worker", managerId: "head", state: "recalled" }] }]);
  expect(index.has("worker")).toBe(false);
});


it("filters phase states before person association and leaves the source/history intact", () => {
  const phases = ["queued", "paused", "review", "done", "waiting", "running"].map((status, i) => ({ id: `phase-${i}`, title: status, status, assigneeId: "worker", handlingAgentId: "worker", completedAt: status === "done" ? 123 : null }));
  const task = { id: "parent", title: "Parent", status: "running", archived: false, executionMode: "phases" as const, ownerId: "head", assigneeId: null, phases };
  const before = JSON.stringify(task);
  const index = currentTasksByAgent([task, task]);
  expect(index.get("worker")?.[0].phases?.map(p => p.id)).toEqual(["phase-5"]);
  expect(index.get("head")?.[0].phases?.map(p => p.id)).toEqual(["phase-5"]);
  expect(JSON.stringify(task)).toBe(before);
  expect(currentTasksByAgent([{ ...task, phases: phases.slice(0, -1) }]).size).toBe(0);
  expect(currentTasksByAgent([{ ...task, archived: true }]).size).toBe(0);
});

it("does not claim another handler's active work for an assignee or historic handoff participant", () => {
  const task = { id: "parent", title: "Parent", status: "running", archived: false, executionMode: "phases" as const, ownerId: "head", assigneeId: null, phases: [{ id: "p", title: "Delegated", status: "running", assigneeId: "former", handlingAgentId: "current", completedAt: null }], delegations: [{ phaseId: "p", workerId: "former", managerId: "old-manager", state: "accepted" }] };
  const index = currentTasksByAgent([task]);
  expect([...index.keys()]).toEqual(["head", "current"]);
  expect(index.get("head")?.[0].roles).toEqual(["Owner"]);
  expect(index.get("current")?.[0].phases?.[0].roles).toEqual([]);
  const legacy = currentTasksByAgent([{ ...task, executionMode: undefined, assigneeId: "former", handlingAgentId: "current", reviewerId: "current" }]);
  expect([...legacy.keys()]).toEqual(["head", "current", "former"]);
  expect(legacy.get("current")?.[0].roles).toEqual(["Reviewer"]);
});

it("updates visible rows and counts together, removes the last menu and keeps agents reachable", () => {
  const phases = [{ id: "p1", title: "First", status: "queued", assigneeId: "worker", handlingAgentId: "worker" }, { id: "p2", title: "Second", status: "running", assigneeId: "worker", handlingAgentId: "worker" }];
  const task = { id: "parent", code: "T87", title: "Parent", status: "running", archived: false, executionMode: "phases" as const, ownerId: "head", assigneeId: null, phases };
  const props = { organization, view: "activity" as const, search: "", onSearchChange: vi.fn(), onViewChange: vi.fn(), selectedId: null, onOpenChat: vi.fn(), onOpenTask: vi.fn() };
  const project = () => [{ ...agents[0], tasks: currentTasksByAgent([task]).get("worker") }];
  const { rerender } = render(createElement(AgentDirectory, { ...props, agents: project() }));
  fireEvent.click(screen.getByRole("button", { name: "Tasks for Worker 3: 1" }));
  expect(within(screen.getByRole("group")).getAllByRole("button")).toHaveLength(1);
  phases[0].status = "running"; rerender(createElement(AgentDirectory, { ...props, agents: project() }));
  expect(screen.getByRole("button", { name: "Tasks for Worker 3: 2" })).toHaveAttribute("aria-expanded", "true");
  expect(within(screen.getByRole("group")).getAllByRole("button")).toHaveLength(2);
  phases[0].status = "paused"; phases[1].status = "done"; rerender(createElement(AgentDirectory, { ...props, agents: project() }));
  expect(screen.queryByRole("group")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Tasks for Worker/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Open session: Worker 3" })).toBeTruthy();
});


it("keeps begun paused work and pending review, excluding unstarted and closed participants", () => {
  const task = { id: "t", title: "Work", status: "paused", archived: false, executionMode: "phases" as const, ownerId: "head", assigneeId: "old", phases: [
    { id: "p", title: "Blocked", status: "paused", assigneeId: "worker", handlingAgentId: "worker", lastStartedAt: 100, completedAt: null },
    { id: "r", title: "Review", status: "review", assigneeId: "submitter", handlingAgentId: "head", reviewerId: "head", completedAt: null },
    { id: "u", title: "Unstarted", status: "paused", assigneeId: "worker", handlingAgentId: "worker", completedAt: null },
    { id: "q", title: "Queued", status: "queued", assigneeId: "worker", lastStartedAt: 100, completedAt: null },
  ], delegations: [{ phaseId: "p", managerId: "head", workerId: "past", state: "accepted" }, { phaseId: "r", managerId: "head", workerId: "submitter", state: "review" }] };
  const index = currentTasksByAgent([task]);
  expect(index.get("worker")?.[0].phases?.map(p => [p.id, p.status])).toEqual([["p", "paused"]]);
  expect(index.get("submitter")?.[0].phases?.[0]).toMatchObject({ id: "r", status: "review", roles: ["Assignee"] });
  expect(index.has("past")).toBe(false); expect(index.has("old")).toBe(false);
  expect(index.get("head")?.[0].phases).toHaveLength(2);
});
it("distinguishes explicit legacy phase responsibility from an assigned parent without fabricating a handoff", () => {
  const phase = { id: "p", title: "Current responsibility", assigneeId: "worker" as string | null, elapsedMs: 50, startedAt: null, completedAt: null as number | null };
  const task = { id: "t", title: "Legacy", status: "paused", archived: false, ownerId: "head", assigneeId: "past", handlingAgentId: "head", phases: [phase], delegations: [{ managerId: "head", workerId: "past", state: "accepted" }] };
  const before = JSON.stringify(task), index = currentTasksByAgent([task]);
  expect(index.get("worker")?.[0].phases?.[0]).toMatchObject({ id: "p", status: "paused", roles: ["Assignee"] });
  expect(index.get("past")?.[0]).toMatchObject({ roles: ["Assignee"], status: "paused" }); expect(index.get("past")?.[0].phases).toBeUndefined(); expect(JSON.stringify(task)).toBe(before);
  expect(currentTasksByAgent([{ ...task, status: "running" }]).get("worker")?.[0].phases?.[0].status).toBe("assigned");
  phase.assigneeId = null; expect(currentTasksByAgent([task]).has("worker")).toBe(false);
  phase.assigneeId = "other"; expect(currentTasksByAgent([task]).has("worker")).toBe(false);
  phase.assigneeId = "worker"; phase.completedAt = 100; expect(currentTasksByAgent([task]).has("worker")).toBe(false);
  phase.completedAt = null; phase.elapsedMs = 0; expect(currentTasksByAgent([task]).has("worker")).toBe(false);
});
it("renders real paused/review/assigned labels and counts without changing task navigation", () => {
  const onOpenTask = vi.fn();
  const task = { id: "t", code: "T1", title: "Legacy", status: "paused", archived: false, assigneeId: "head", handlingAgentId: "head", phases: [{ id: "p", title: "Paused responsibility", assigneeId: "worker", elapsedMs: 50, completedAt: null }] };
  const indexed = currentTasksByAgent([task]);
  render(createElement(AgentDirectory, { agents: [{ ...agents[0], tasks: indexed.get("worker") }], organization, view: "activity", search: "", onSearchChange: vi.fn(), onViewChange: vi.fn(), selectedId: null, onOpenChat: vi.fn(), onOpenTask }));
  fireEvent.click(screen.getByRole("button", { name: "Tasks for Worker 3: 1" }));
  const menu = screen.getByRole("group"); expect(menu).toHaveTextContent("Paused"); expect(menu).toHaveTextContent("Assignee"); expect(menu).not.toHaveTextContent("Running");
  fireEvent.click(within(menu).getByRole("button")); expect(onOpenTask).toHaveBeenCalledWith("t", "p");
});


it("shows a legacy assigned task and its actual paused state without claiming a phase or handoff", () => {
  const task = { id: "legacy", code: "T22", title: "Assigned parent", status: "paused", archived: false, ownerId: "head", assigneeId: "worker", handlingAgentId: "head", phases: [{ id: "target", title: "Head acceptance phase", elapsedMs: 20, completedAt: null }], delegations: [{ managerId: "head", workerId: "worker", state: "accepted" }, { managerId: "head", workerId: "unassigned-past", state: "accepted" }] };
  const before = JSON.stringify(task), index = currentTasksByAgent([task]);
  expect(index.get("worker")?.[0]).toMatchObject({ roles: ["Assignee"], status: "paused" }); expect(index.get("worker")?.[0].phases).toBeUndefined();
  expect(index.has("unassigned-past")).toBe(false); expect(JSON.stringify(task)).toBe(before);
  const onOpenTask = vi.fn(); render(createElement(AgentDirectory, { agents: [{ ...agents[0], tasks: index.get("worker") }], organization, view: "activity", search: "", onSearchChange: vi.fn(), onViewChange: vi.fn(), selectedId: null, onOpenChat: vi.fn(), onOpenTask }));
  fireEvent.click(screen.getByRole("button", { name: "Tasks for Worker 3: 1" }));const row = within(screen.getByRole("group")).getByRole("button");
  expect(row).toHaveTextContent("Assigned"); expect(row).toHaveTextContent("Paused"); expect(row).not.toHaveTextContent("P-target"); expect(row).not.toHaveTextContent("Head acceptance phase");
  fireEvent.click(row);expect(onOpenTask).toHaveBeenCalledExactlyOnceWith("legacy");
  for (const status of ["queued", "done"]) expect(currentTasksByAgent([{ ...task, status }]).has("worker")).toBe(false);
  expect(currentTasksByAgent([{ ...task, archived: true }]).has("worker")).toBe(false);
  expect(currentTasksByAgent([{ ...task, phases: [{ id: "new", title: "Never started", elapsedMs: 0, completedAt: null }] }]).has("worker")).toBe(false);
});
