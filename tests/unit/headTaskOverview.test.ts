import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HeadTaskOverview } from "@/features/office/components/HeadTaskOverview";
import { AgentInterfaceActions } from "@/features/office/components/AgentInterfaceActions";
import { departmentManagerIds, headTaskRows } from "@/features/office/operations/headTaskOverview";
import type { DirectoryTaskSummary } from "@/features/office/operations/agentDirectory";
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
  expect(headTaskRows("head", [{ ...task, phases: phased.phases }])[0].work).toMatchObject([{ id: "parent", title: "Specific phase not recorded", status: "Running", people: [{ role: "Task-level responsibility", agentId: "worker" }] }]);
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
  fireEvent.click(screen.getByRole("button", { name: "Completed implementation" })); expect(onOpenTask).toHaveBeenCalledWith("parent", "done");
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
