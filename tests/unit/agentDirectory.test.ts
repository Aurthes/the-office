import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentDirectory } from "@/features/office/components/AgentDirectory";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";
import { currentTasksByAgent, reportingForest, taskCode, type DirectoryAgent, type ReportingNode } from "@/features/office/operations/agentDirectory";
import { CEO_ID, type OrganizationView } from "@/lib/office/organization";
import { setUiLanguage } from "@/lib/i18n/ui-language";

beforeEach(() => setUiLanguage("en"));
afterEach(cleanup);
const agents: DirectoryAgent[] = [
  { id: "worker", name: "Worker 3", color: "#ffcc00", activity: getAgentActivity({ status: "working" }), hasPendingSchedule: true, updatedAt: 100, projectId: "office", projectName: "Office", task: { id: "avc", title: "Agent View Compression (AVC)", code: "AVC" } },
  { id: "head", name: "Ranger", color: "#00cccc", activity: getAgentActivity({ status: "idle", needsInput: true }), updatedAt: 200, projectId: "office", projectName: "Office" },
  { id: "review", name: "Reviewer", color: "#cc00cc", activity: getAgentActivity({ status: "idle", needsReview: true }), updatedAt: 50, projectId: null, projectName: "Open Workspace" },
];
const organization: OrganizationView = { ceoAvatar: null, savePosition: vi.fn(), people: [
  { id: CEO_ID, name: "CEO", title: "CEO", department: "Company", departmentId: null, reportsTo: [] },
  { id: "head", name: "Ranger", title: "Head", department: "Office", departmentId: "office", reportsTo: [CEO_ID] },
  { id: "worker", name: "Worker 3", title: "Worker", department: "Office", departmentId: "office", reportsTo: ["head", CEO_ID] },
  { id: "review", name: "Reviewer", title: "Worker", department: "Open Workspace", departmentId: null, reportsTo: [CEO_ID] },
] };
function fixture(view: "project" | "activity" | "organization" = "project", search = "") {
  const props = { agents, organization, view, search, onSearchChange: vi.fn(), selectedId: null, onViewChange: vi.fn(), onOpenChat: vi.fn(), onOpenTask: vi.fn(), hasConversation: false };
  const result = render(createElement(AgentDirectory, props));
  return { ...result, props };
}
it.each(["project", "activity", "organization"] as const)("preserves avatars, attention states, schedule and task links in %s", view => {
  const { props } = fixture(view);
  expect(screen.getAllByRole("img", { name: "Working" }).length).toBeGreaterThan(0);
  expect(screen.getByRole("img", { name: "Needs your input" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "New result to review" })).toBeTruthy();
  expect(screen.getAllByRole("img", { name: "Pending scheduled task" }).length).toBeGreaterThan(0);
  expect(screen.getAllByAltText("Avatar for Worker 3").length).toBeGreaterThan(0);
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
  expect(within(tree).getByRole("button", { name: "CEO organization" })).toBeTruthy();
  expect(within(tree).getByRole("button", { name: "Open session: Ranger" })).toBeTruthy();
  expect(within(tree).queryByRole("button", { name: "Open session: Reviewer" })).toBeNull();
  rerender(createElement(AgentDirectory, { ...props, search: "" }));
  fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
  expect(within(tree).queryByRole("button", { name: "Open session: Worker 3" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
  expect(within(tree).getAllByRole("button", { name: "Open session: Worker 3" })).toHaveLength(2);
  expect(within(tree).getByLabelText("Also reports here")).toBeTruthy();
});
it("uses real running task bindings and readable codes without reviving old or unassigned work", () => {
  const task = { id: "avc", title: "Agent View Compression (AVC)", status: "running", archived: false, assigneeId: "worker" };
  const result = currentTasksByAgent([task, { ...task, id: "paused", status: "paused", assigneeId: "head" }, { ...task, id: "archived", archived: true, assigneeId: "review" }, { ...task, id: "orphan", assigneeId: null }]);
  expect([...result.keys()]).toEqual(["worker"]);
  expect(result.get("worker")).toEqual({ id: "avc", title: task.title, code: "AVC" });
  expect(taskCode("Background Music Theme")).toBe("BMT");
  expect(taskCode("整理实验数据")).toBe("整理实验数据");
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
