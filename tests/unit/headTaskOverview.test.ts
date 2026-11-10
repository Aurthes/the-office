import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentDirectory } from "@/features/office/components/AgentDirectory";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";
import { departmentManagerIds, headTaskRows } from "@/features/office/operations/headTaskOverview";
import type { DirectoryAgent, DirectoryTaskSummary } from "@/features/office/operations/agentDirectory";
import { CEO_ID, type OrganizationView } from "@/lib/office/organization";
import { setUiLanguage } from "@/lib/i18n/ui-language";

vi.mock("@/features/ring-ship/characterPortrait", () => ({ characterPortrait: vi.fn(async () => "") }));
beforeEach(() => {
  setUiLanguage("en");
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);
const task: DirectoryTaskSummary = { id: "parent", code: "T1", title: "Parent task", ownerId: "head", assigneeId: "worker", status: "running", archived: false, departmentId: "other" };
const organization: OrganizationView = { ceoAvatar: null, savePosition: vi.fn(), people: [
  { id: "head", name: "Renamable Head", title: "Manager", department: "Open Workspace", departmentId: null, reportsTo: [CEO_ID] },
  { id: "worker", name: "Employee", title: "Worker", department: "Open Workspace", departmentId: null, reportsTo: ["head"] },
] };
const agents: DirectoryAgent[] = organization.people.map(person => ({ ...person, projectId: null, projectName: "Open Workspace", color: "#aaa", updatedAt: null, activity: getAgentActivity({ status: "idle" }) }));
const phased: DirectoryTaskSummary = { ...task, executionMode: "phases", phases: [
  { id: "a1234567", title: "Parallel implementation", status: "running", assigneeId: "stale", activity: { agentId: "worker", role: "worker" } },
  { id: "b1234567", title: "Parallel review", status: "review", assigneeId: "submitter", reviewerId: "reviewer" },
  { id: "c1234567", title: "Waiting for dependency", status: "paused", assigneeId: "responsible" },
  { id: "queued", title: "Future work", status: "queued", assigneeId: "future" },
  { id: "done", title: "Past work", status: "running", completedAt: 123, assigneeId: "past" },
] };
it("uses explicit Owner, deduplicates parents, includes pending and cross-department work, excludes completed/archive and other Owners", () => {
  const rows = headTaskRows("head", [task, task, { ...task, id: "queued", status: "queued" }, { ...task, id: "done", status: "done" }, { ...task, id: "archive", archived: true }, { ...task, id: "team", departmentId: null, ownerId: "worker" }, { ...task, id: "unset", ownerId: undefined }]);
  expect(rows.map(row => row.id)).toEqual(["parent", "queued"]);
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
  expect(headTaskRows("head", [{ ...task, phases: phased.phases }])[0].work).toEqual([{ id: "parent", title: "Specific phase not recorded", status: "Running", people: [{ role: "Task-level responsibility", agentId: "worker" }] }]);
});
it("shows queued and unknown parent work honestly without selecting the first phase", () => {
  expect(headTaskRows("head", [{ ...phased, phases: [{ id: "future", title: "Not current", status: "queued" }] }])[0].work[0]).toMatchObject({ title: "No phase started", status: "Not started", people: [] });
  expect(headTaskRows("head", [{ ...phased, phases: undefined }])[0].work[0].title).toBe("Current work not recorded");
});
it("recognizes role changes and actual department Head IDs without depending on names", () => {
  expect([...departmentManagerIds(organization)]).toEqual(["head"]);
  const promoted = { ...organization, people: organization.people.map(p => ({ ...p, title: p.id === "worker" ? "Head" : "Worker", name: "Renamed" })) };
  expect([...departmentManagerIds(promoted)]).toEqual(["worker"]);
  const directoryHead = { ...organization, people: [], departments: [{ id: "open-workspace", name: "Open Workspace", description: "", heads: [organization.people[0]], members: [] }] };
  expect([...departmentManagerIds(directoryHead)]).toEqual(["head"]);
});
function props(view: "project" | "activity" | "organization" = "project") {
  return { agents, organization, taskSummaries: [phased], view, onViewChange: vi.fn(), search: "", onSearchChange: vi.fn(), selectedId: null, onOpenChat: vi.fn(), onOpenTask: vi.fn() };
}
it.each(["project", "activity", "organization"] as const)("opens the Head overview from the original card position in %s, preserves each paired phase and detail route", view => {
  const p = props(view); render(createElement(AgentDirectory, p));
  const trigger = screen.getByRole("button", { name: "Managed tasks for Renamable Head" });
  expect(trigger).toHaveTextContent("Manage 1 tasks"); trigger.focus(); fireEvent.click(trigger);
  const table = screen.getByRole("table"); expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(within(table).getAllByRole("columnheader").map(n => n.textContent)).toEqual(["Task", "Current work", "Who is working"]);
  const pair = table.querySelector('[data-head-work-id="a1234567"]')!;
  expect(pair).toHaveTextContent("Parallel implementation"); expect(pair).toHaveTextContent("Employee"); expect(pair).not.toHaveTextContent("Renamable Head");
  fireEvent.click(within(table).getByRole("button", { name: "P-b1234567 · Parallel review" }));
  expect(p.onOpenTask).toHaveBeenCalledExactlyOnceWith("parent", "b1234567"); expect(p.onOpenChat).not.toHaveBeenCalled();
  expect(document.querySelector("dialog")).toBeNull(); expect(trigger).toHaveFocus();
});
it("distinguishes loading/error from an accepted empty list, restores focus, and updates Owner/name/role without a new fetch", () => {
  const p = props(); const r = render(createElement(AgentDirectory, { ...p, taskSummaries: [], tasksLoading: true }));
  const trigger = screen.getByRole("button", { name: "Managed tasks for Renamable Head" }); trigger.focus(); fireEvent.click(trigger);
  expect(screen.getByRole("status")).toHaveTextContent("Loading tasks"); expect(screen.queryByText("No tasks need follow-up.")).toBeNull();
  r.rerender(createElement(AgentDirectory, { ...p, taskSummaries: [], taskError: "Current tasks are unavailable." }));
  expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("unavailable"); expect(screen.queryByText("No tasks need follow-up.")).toBeNull();
  r.rerender(createElement(AgentDirectory, { ...p, taskSummaries: [] })); expect(screen.getByText("No tasks need follow-up.")).toBeTruthy();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true })); expect(trigger).toHaveFocus();
  const changed = { ...organization, people: organization.people.map(person => ({ ...person, name: `${person.name} new`, title: person.id === "worker" ? "Head" : "Worker" })) };
  r.rerender(createElement(AgentDirectory, { ...p, organization: changed, taskSummaries: [{ ...task, ownerId: "worker" }] }));
  expect(screen.queryByRole("button", { name: "Managed tasks for Renamable Head" })).toBeNull();
  expect(screen.getByRole("button", { name: "Managed tasks for Employee" })).toHaveTextContent("Manage 1 tasks");
});
it("translates app-owned text but preserves task/person names", () => {
  setUiLanguage("zh-CN"); render(createElement(AgentDirectory, props()));
  fireEvent.click(screen.getByRole("button", { name: "Renamable Head 的管理任务" }));
  expect(screen.getByRole("table")).toHaveTextContent("当前在做什么"); expect(screen.getByRole("table")).toHaveTextContent("Parent task");
});
