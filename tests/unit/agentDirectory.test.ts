import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentDirectory } from "@/features/office/components/AgentDirectory";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";
import { currentTasksByAgent, reportingForest, taskCode, type DirectoryAgent, type ReportingNode } from "@/features/office/operations/agentDirectory";
import { CEO_ID, type OrganizationView } from "@/lib/office/organization";
import { setUiLanguage } from "@/lib/i18n/ui-language";

vi.mock("@/features/ring-ship/characterPortrait", () => ({ characterPortrait: vi.fn(async () => "data:image/png;base64,cG9ydHJhaXQ=") }));
beforeEach(() => setUiLanguage("en"));
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
  const shared = { id: "same", title: "Shared task", ownerId: "head", assigneeId: "worker", status: "paused", archived: false };
  const indexed = currentTasksByAgent([shared, shared, { ...shared, id: "both", ownerId: "worker" }, { ...shared, id: "finished", status: "done" }, { ...shared, id: "archived", archived: true }]);
  expect(indexed.get("head")).toEqual([{ id: "same", title: "Shared task", code: "ST", roles: ["Owner"] }]);
  expect(indexed.get("worker")).toEqual([{ id: "same", title: "Shared task", code: "ST", roles: ["Assignee"] }, { id: "both", title: "Shared task", code: "ST", roles: ["Owner", "Assignee"] }]);
});
it.each(["project", "activity", "organization"] as const)("shows each person's actual task roles in single badges and multi-task menus in %s", view => {
  const indexed = currentTasksByAgent([{ id: "same", title: "Shared task", ownerId: "head", assigneeId: "worker", status: "queued", archived: false }, { id: "both", title: "Both roles", ownerId: "worker", assigneeId: "worker", status: "paused", archived: false }]);
  const onOpenTask = vi.fn();
  render(createElement(AgentDirectory, { agents: agents.map(agent => ({ ...agent, tasks: indexed.get(agent.id) })), organization, view, search: "", onSearchChange: vi.fn(), onViewChange: vi.fn(), selectedId: null, onOpenChat: vi.fn(), onOpenTask }));
  expect(screen.getByRole("button", { name: "Open task: Shared task" })).toHaveTextContent("Owner");
  fireEvent.click(screen.getAllByRole("button", { name: "Tasks for Worker 3: 2" })[0]);
  const menu = screen.getByRole("group", { name: "Tasks for Worker 3" });
  expect(within(menu).getByRole("button", { name: "Open task: Shared task" })).toHaveTextContent("Assignee");
  expect(within(menu).getByRole("button", { name: "Open task: Both roles" })).toHaveTextContent("Owner + Assignee");
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
it("keeps all open assignments including queued and paused work, excluding completed, archived and unassigned work", () => {
  const task = { id: "avc", title: "Agent View Compression (AVC)", status: "running", archived: false, assigneeId: "worker" };
  const result = currentTasksByAgent([task, task, { ...task, id: "paused", status: "paused" }, { ...task, id: "queued", status: "queued", assigneeId: "head" }, { ...task, id: "done", status: "done" }, { ...task, id: "archived", archived: true }, { ...task, id: "orphan", assigneeId: null }]);
  expect([...result.keys()]).toEqual(["worker", "head"]);
  expect(result.get("worker")?.map(task => task.id)).toEqual(["avc", "paused"]);
  expect(result.get("head")).toEqual([{ id: "queued", title: task.title, code: "AVC", roles: ["Assignee"] }]);
  expect(taskCode("Background Music Theme")).toBe("BMT");
  expect(taskCode("整理实验数据")).toBe("整理实验数据");
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
