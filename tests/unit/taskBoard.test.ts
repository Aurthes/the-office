import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { TaskBoard, type OfficeTodo } from "@/features/ring-ship/TaskBoard";
import { setUiLanguage } from "@/lib/i18n/ui-language";
beforeEach(() => {
  setUiLanguage("en");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
function fixture(scope?: string | null, overrides: Partial<OfficeTodo> = {}, taskId?: string) {
  const todo: OfficeTodo = { id: "todo", revision: 4, title: "Release app", documentation: "Verify the release", departmentId: "alpha", departmentName: "Alpha", assigneeId: "alice", assigneeName: "Alice", assigneeAvailable: true, status: "running", archived: false, progress: 0, phases: [{ id: "plan", title: "Plan release", notes: "Record evidence", elapsedMs: 3000, startedAt: null, completedAt: null }, { id: "verify", title: "Validate release", elapsedMs: 0, startedAt: null, completedAt: null }], events: [], ...overrides };
  const departments = [{ id: null, name: "Open Workspace", total: 0, running: 0, unassigned: 0 }, { id: "alpha", name: "Alpha", total: 1, running: 1, unassigned: 0 }];
  const call = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method, params) => method === "todo.list" ? { todos: (todo.archived && !["done", "archived"].includes((params as { status?: string }).status || "")) ? [] : [todo], total: (todo.archived && !["done", "archived"].includes((params as { status?: string }).status || "")) ? 0 : 1, departments, agents: [{ id: "alice", name: "Alice", projectId: "alpha" }], serverTime: Date.now() } : { todo, serverTime: Date.now() });
  const client = { call, onEvent: vi.fn(() => () => {}) } as unknown as Pick<GatewayClient, "call" | "onEvent">;
  const props = { open: true, departmentId: scope, taskId, onClose: vi.fn(), onOpenSession: vi.fn(), connected: true, client };
  const view = render(createElement(TaskBoard, props));
  return { todo, call, props, ...view };
}
it("shows the backend task code in both the list and the existing detail view", async () => {
  const f = fixture(undefined, { code: "T37" });
  const card = await screen.findByTestId("todo-card");
  expect(within(card).getByText("T37")).toBeTruthy();
  fireEvent.click(await within(card).findByRole("button"));
  expect(await screen.findByRole("heading", { name: "T37 · Release app" })).toBeTruthy();
  expect(f.call).toHaveBeenCalledWith("todo.get", { id: f.todo.id });
});
it("separates the Owner and Assignee filters and displays both on cards and details", async () => {
  const f = fixture(undefined, { ownerId: "alice", ownerName: "Follow-up Alice", assigneeName: "Executor Alice" });
  await screen.findByRole("combobox", { name: "Task owner" });
  const card = await screen.findByTestId("todo-card");
  expect(card).toHaveTextContent("Owner: Follow-up Alice"); expect(card).toHaveTextContent("Assignee: Executor Alice");
  fireEvent.change(screen.getByRole("combobox", { name: "Task owner" }), { target: { value: "alice" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Task assignee" }), { target: { value: "__unassigned__" } });
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.list", expect.objectContaining({ ownerId: "alice", assigneeId: null })));
  fireEvent.click(within(card).getByRole("button"));
  const detail = await screen.findByRole("heading", { name: "Release app" });
  expect(detail.closest("article")).toHaveTextContent("Owner: Follow-up Alice");
});
it("edits the Owner explicitly while keeping an unrelated edit from clearing legacy ownership", async () => {
  const f = fixture(undefined, {}, "todo");
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Documentation"), { target: { value: "Unrelated edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save to-do" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.edit", expect.objectContaining({ documentation: "Unrelated edit" })));
  expect(f.call.mock.calls.find(([method]) => method === "todo.edit")?.[1]).not.toHaveProperty("ownerId");
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "alice" } });
  fireEvent.click(screen.getByRole("button", { name: "Save to-do" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.edit", expect.objectContaining({ ownerId: "alice", assigneeId: "alice" })));
});
it("creates work with a selected follow-up owner and no executor", async () => {
  const f = fixture("alpha");
  fireEvent.click(await screen.findByRole("button", { name: "New to-do" }));
  fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Owned work" } });
  fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "alice" } });
  expect(screen.getByRole("combobox", { name: "Assignee: Plan" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Save to-do" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.create", expect.objectContaining({ ownerId: "alice", assigneeId: null })));
});
it("clears an explicit follow-up owner without changing the executor", async () => {
  const f = fixture(undefined, { ownerId: "alice", ownerName: "Alice" }, "todo");
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save to-do" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.edit", expect.objectContaining({ ownerId: null, assigneeId: "alice" })));
});
it("shows a submitted handoff as awaiting review and keeps final completion unavailable", async () => {
  const f = fixture(undefined, { progress: 1, delegations: [{ id: "handoff", managerId: "alice", workerId: "bob", state: "review", instructions: "Implement without deployment", acceptanceCriteria: "Tests pass", report: "Evidence and artifact location" }] }, "todo");
  f.todo.phases[0].completedAt = Date.now();
  expect(await screen.findByText("Awaiting manager review")).toBeInTheDocument();
  expect(await screen.findByRole("region", { name: "Delegation and acceptance" })).toHaveTextContent("Evidence and artifact location");
  expect(screen.getByRole("checkbox", { name: /Validate release/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Open conversation" })); expect(f.props.onOpenSession).toHaveBeenCalledWith("alice");
});
it("opens the linked task directly and can return to its conversation", async () => {
  const f = fixture(undefined, { title: "Agent View Compression (AVC)" }, "todo");
  expect(await screen.findByRole("heading", { name: "Agent View Compression (AVC)" })).toBeTruthy();
  expect(f.call).toHaveBeenCalledWith("todo.get", { id: "todo" });
  fireEvent.click(screen.getByRole("button", { name: "Open conversation" }));
  expect(f.props.onClose).toHaveBeenCalled();
  expect(f.props.onOpenSession).toHaveBeenCalledWith("alice");
});
it("reloads a linked task when reopening the same task board", async () => {
  const f = fixture(undefined, { title: "Agent View Compression (AVC)" }, "todo");
  await screen.findByRole("button", { name: "Open conversation" });
  f.rerender(createElement(TaskBoard, { ...f.props, open: false }));
  f.rerender(createElement(TaskBoard, { ...f.props, open: true }));
  await waitFor(() => expect(f.call.mock.calls.filter(([method]) => method === "todo.get").length).toBeGreaterThanOrEqual(2));
  expect(await screen.findByRole("button", { name: "Open conversation" })).toBeTruthy();
});
it("opens the global board and scopes the whiteboard to its department", async () => {
  const f = fixture("alpha"); await screen.findByRole("dialog", { name: "Task board" });
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.list", expect.objectContaining({ departmentId: "alpha" })));
  expect(await screen.findByText("Release app")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /All departments/ }));
  await waitFor(() => expect(f.call.mock.calls.at(-1)?.[1]).not.toHaveProperty("departmentId"));
});
it("shows the task tree and sends a phase check with its revision and phase ID", async () => {
  const f = fixture(); await screen.findByRole("dialog", { name: "Task board" }); fireEvent.click(await screen.findByRole("button", { name: /Release app/ }));
  const check = await screen.findByRole("checkbox", { name: /Plan release/ }); fireEvent.click(check);
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.complete", expect.objectContaining({ id: "todo", revision: 4, phaseId: "plan" })));
  expect(screen.getByText("00:00:03")).toBeTruthy();
});
it("allows human edits without resetting phase identities or copying stale live revisions into the form", async () => {
  const f = fixture(); await screen.findByRole("dialog", { name: "Task board" }); fireEvent.click(await screen.findByRole("button", { name: /Release app/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Documentation"), { target: { value: "Verified evidence" } });
  f.todo.revision = 8;
  fireEvent.click(screen.getByRole("button", { name: "Save to-do" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.edit", expect.objectContaining({ revision: 4, documentation: "Verified evidence", phases: expect.arrayContaining([expect.objectContaining({ id: "plan" })]) })));
});
it("creates unassigned work in the selected department with ordered phases", async () => {
  const f = fixture("alpha"); await screen.findByRole("dialog", { name: "Task board" }); fireEvent.click(await screen.findByRole("button", { name: "New to-do" }));
  fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "New feature" } });
  fireEvent.click(screen.getByRole("button", { name: "Save to-do" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.create", expect.objectContaining({ departmentId: "alpha", assigneeId: null, title: "New feature", requestId: expect.any(String), phases: [{ title: "Plan", notes: "" }, { title: "Execute", notes: "" }, { title: "Verify", notes: "" }] })));
});
it("filters unassigned work and supports a list view", async () => {
  const f = fixture(); await screen.findByRole("dialog", { name: "Task board" }); await screen.findByText("Release app");
  fireEvent.change(screen.getByRole("combobox", { name: "Task assignee" }), { target: { value: "__unassigned__" } });
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.list", expect.objectContaining({ assigneeId: null })));
  fireEvent.click(screen.getByRole("button", { name: "Show task list" }));
  expect(within(screen.getByTestId("todo-card")).queryByText("Plan release")).toBeTruthy();
  expect(document.querySelector(".todo-phase-tree")).toBeNull();
});
it("shows rejected concurrent edits and keeps the human draft for copying or revising", async () => {
  const f = fixture(); await screen.findByRole("dialog", { name: "Task board" }); fireEvent.click(await screen.findByRole("button", { name: /Release app/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "My change" } });
  f.call.mockImplementation(async method => { if (method === "todo.edit") throw new Error("This to-do changed. Refresh it before saving"); return { todo: f.todo, todos: [f.todo], total: 1, departments: [], agents: [], serverTime: Date.now() }; });
  fireEvent.click(screen.getByRole("button", { name: "Save to-do" }));
  await screen.findByRole("alert"); expect((screen.getByLabelText("Task title") as HTMLInputElement).value).toBe("My change");
});

it("shows exact task and phase completion dates in history while current work stays clear", async () => {
  const first = Date.UTC(2026, 10, 4, 2, 0, 0), last = first + 60000;
  fixture(undefined, { status: "done", archived: true, completedAt: last, progress: 2, phases: [{ id: "plan", title: "Plan release", elapsedMs: 3000, startedAt: null, completedAt: first }, { id: "verify", title: "Validate release", elapsedMs: 2000, startedAt: null, completedAt: last }] });
  await screen.findByRole("dialog", { name: "Task board" });
  expect(screen.queryByText("Release app")).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Task status" }), { target: { value: "archived" } });
  fireEvent.click(await screen.findByRole("button", { name: /Release app/ }));
  await screen.findByRole("button", { name: "Add follow-up" });
  expect(document.querySelector('[data-completion-kind="task"] time')?.getAttribute("datetime")).toBe(new Date(last).toISOString());
  expect([...document.querySelectorAll('[data-completion-kind="phase"] time')].map(node => node.getAttribute("datetime"))).toEqual([new Date(first).toISOString(), new Date(last).toISOString()]);
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
});
it("starts a follow-up draft from archived completed work and preserves every old phase ID", async () => {
  const f = fixture(undefined, { status: "done", archived: true, completedAt: 2000, progress: 2, phases: [{ id: "plan", title: "Plan release", notes: "Record evidence", elapsedMs: 3000, startedAt: null, completedAt: 1000 }, { id: "verify", title: "Validate release", elapsedMs: 0, startedAt: null, completedAt: 2000 }] });
  await screen.findByRole("dialog", { name: "Task board" });
  fireEvent.change(screen.getByRole("combobox", { name: "Task status" }), { target: { value: "archived" } });
  fireEvent.click(await screen.findByRole("button", { name: /Release app/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Add follow-up" }));
  expect(screen.getAllByLabelText("Phase title")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Save to-do" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.edit", expect.objectContaining({ phases: [{ id: "plan", title: "Plan release", notes: "Record evidence" }, { id: "verify", title: "Validate release", notes: "" }, { title: "Follow-up", notes: "" }] })));
});

it("collapses completed phases in task cards while leaving unfinished phases visible", async () => {
  fixture(undefined, { progress: 1, phases: [{ id: "plan", title: "Plan release", elapsedMs: 3000, startedAt: null, completedAt: 1000 }, { id: "verify", title: "Validate release", elapsedMs: 0, startedAt: Date.now(), completedAt: null }] });
  await screen.findByRole("dialog", { name: "Task board" });
  const card = await screen.findByTestId("todo-card");
  const group = within(card).getByText("Completed phases (1)").closest("details")!;
  expect(group).not.toHaveAttribute("open");
  expect(within(group).getByText(/Plan release/)).not.toBeVisible();
  expect(within(card).getByText(/● Validate release/)).toBeVisible();
  fireEvent.click(within(card).getByText("Completed phases (1)"));
  expect(within(group).getByText(/Plan release/)).toBeVisible();
});

it("keeps phase notes, completion times and undo available after expanding the detail group", async () => {
  const f = fixture(undefined, { progress: 1, phases: [{ id: "plan", title: "Plan release", notes: "Saved evidence", elapsedMs: 3000, startedAt: null, completedAt: 1000 }, { id: "verify", title: "Validate release", elapsedMs: 0, startedAt: null, completedAt: null }] }, "todo");
  await screen.findByRole("dialog", { name: "Task board" });
  const summary = await screen.findByText("Completed phases (1)"), group = summary.closest("details")!;
  expect(group).not.toHaveAttribute("open");
  expect(screen.getByRole("checkbox", { name: "Validate release" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name: /Plan release/ })).not.toBeVisible();
  fireEvent.click(summary);
  expect(screen.getByText("Saved evidence")).toBeVisible();
  expect(group.querySelector('[data-completion-kind="phase"] time')).toHaveAttribute("datetime", new Date(1000).toISOString());
  fireEvent.click(screen.getByRole("checkbox", { name: /Plan release/ }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.reopen", expect.objectContaining({ id: "todo", revision: 4, phaseId: "plan" })));
});

it("preserves an expanded group across refreshes and resets it when the board is reopened", async () => {
  const f = fixture(undefined, { progress: 1, phases: [{ id: "plan", title: "Plan release", elapsedMs: 3000, startedAt: null, completedAt: 1000 }, { id: "verify", title: "Validate release", elapsedMs: 0, startedAt: null, completedAt: null }] }, "todo");
  await screen.findByRole("dialog", { name: "Task board" });
  await screen.findByRole("checkbox", { name: "Validate release" });
  fireEvent.click(await screen.findByText("Completed phases (1)"));
  const group = document.querySelector(".todo-completed-phases")!;
  fireEvent.click(screen.getByRole("button", { name: "Refresh task board" }));
  await waitFor(() => expect(f.call.mock.calls.filter(([method]) => method === "todo.get").length).toBeGreaterThan(1));
  expect(group).toHaveAttribute("open");
  f.rerender(createElement(TaskBoard, { ...f.props, open: false }));
  f.rerender(createElement(TaskBoard, { ...f.props, open: true }));
  await waitFor(() => expect(document.querySelector(".todo-detail .todo-completed-phases")).not.toHaveAttribute("open"));
});

it("shows the execution employee separately from the manager who receives review", async () => {
  const f = fixture(undefined, { assigneeId: "bob", assigneeName: "Bob", assigneeAvailable: false, handlingAgentId: "alice", handlingAgentName: "Alice", handlingAgentAvailable: true, reviewerId: "alice", delegations: [{ id: "handoff", managerId: "alice", workerId: "bob", state: "review", instructions: "Implement", acceptanceCriteria: "Verified" }] }, "todo");
  expect(await screen.findByText("Alpha · Owner: Not recorded · Assignee: Bob · Review by Alice")).toBeInTheDocument();
  const button = await screen.findByRole("button", { name: "Open review with manager" }); expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.run", expect.objectContaining({ id: "todo" })));
  expect(screen.getByRole("button", { name: "Open conversation" })).toBeDisabled();
});

function phaseFixture() {
  return fixture(undefined, { executionMode: "phases", ownerId: "alice", ownerName: "Alice", assigneeId: null, assigneeName: null, status: "queued", phases: [
    { id: "a", title: "Teaser", assigneeId: "alice", assigneeName: "Alice", assigneeAvailable: true, status: "queued", elapsedMs: 0, startedAt: null, completedAt: null },
    { id: "b", title: "Clone", assigneeId: "alice", assigneeName: "Alice", assigneeAvailable: true, status: "queued", elapsedMs: 0, startedAt: null, completedAt: null },
  ] });
}
it("puts execution controls on each phase, keeps them focusable and avoids nested buttons", async () => {
  const f = phaseFixture(); await screen.findByRole("button", { name: "Start with agent: Teaser" }); const card = await screen.findByTestId("todo-card");
  const a = within(card).getByRole("button", { name: "Start with agent: Teaser" }); a.focus(); expect(document.activeElement).toBe(a);
  expect(card.querySelector("button button")).toBeNull(); expect(within(card).getByText(/Owner: Alice/)).toBeTruthy();
  fireEvent.click(within(card).getByRole("button", { name: /Shared work|Release app/ }));
  await screen.findByRole("heading", { name: "Release app" });
  expect(screen.queryByRole("button", { name: "Start timer" })).toBeNull(); expect(screen.getByRole("combobox", { name: "Assignee: Clone" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start with agent: Clone" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("todo.run", expect.objectContaining({ id: "todo", revision: 4, phaseId: "b" })));
});
it("keeps B actionable while A awaits a result and reuses A's request ID after unrelated revision updates", async () => {
  const f = phaseFixture(); await screen.findByRole("button", { name: "Start with agent: Teaser" });
  const original = f.call.getMockImplementation()!; let rejectA: (error: Error) => void = () => {};
  let aCalls = 0;
  f.call.mockImplementation(async (method, params) => {
    const p = params as { phaseId?: string };
    if (method === "todo.run" && p.phaseId === "a" && ++aCalls === 1) return new Promise((_, reject) => { rejectA = reject; });
    if (method === "todo.run" && p.phaseId === "b") f.todo.revision = 5;
    return original(method, params);
  });
  fireEvent.click(screen.getByRole("button", { name: "Start with agent: Teaser" }));
  expect(screen.getByRole("button", { name: "Start with agent: Clone" })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Start with agent: Clone" }));
  await waitFor(() => expect(f.call.mock.calls.filter(([m]) => m === "todo.run")).toHaveLength(2));
  rejectA(new Error("Request timed out; delivery unknown"));
  await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "Start with agent: Teaser" }));
  await waitFor(() => expect(f.call.mock.calls.filter(([m, p]) => m === "todo.run" && (p as { phaseId?: string }).phaseId === "a")).toHaveLength(2));
  const calls = f.call.mock.calls.filter(([m, p]) => m === "todo.run" && (p as { phaseId?: string }).phaseId === "a");
  expect(calls[1][1]).toEqual(calls[0][1]);
});
it("keeps phase dispatch unavailable without an Owner and only offers conversion when legacy work is stopped", async () => {
  const f = fixture(undefined, { executionMode: "phases", ownerId: null, assigneeId: null, status: "queued", phases: [{ id: "a", title: "Waiting", assigneeId: "alice", assigneeAvailable: true, status: "queued", elapsedMs: 0, startedAt: null, completedAt: null }] });
  expect(await screen.findByRole("button", { name: "Start with agent: Waiting" })).toBeDisabled();
  expect(f.call.mock.calls.every(([method]) => method !== "todo.run")).toBe(true);
  cleanup(); fixture(undefined, {}, "todo"); fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  expect(screen.getByRole("button", { name: "Assign phases independently" })).toBeDisabled();
});
