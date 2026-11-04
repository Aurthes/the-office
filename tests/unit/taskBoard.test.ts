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
function fixture(scope?: string | null, overrides: Partial<OfficeTodo> = {}) {
  const todo: OfficeTodo = { id: "todo", revision: 4, title: "Release app", documentation: "Verify the release", departmentId: "alpha", departmentName: "Alpha", assigneeId: "alice", assigneeName: "Alice", assigneeAvailable: true, status: "running", archived: false, progress: 0, phases: [{ id: "plan", title: "Plan release", notes: "Record evidence", elapsedMs: 3000, startedAt: null, completedAt: null }, { id: "verify", title: "Validate release", elapsedMs: 0, startedAt: null, completedAt: null }], events: [], ...overrides };
  const departments = [{ id: null, name: "Open Workspace", total: 0, running: 0, unassigned: 0 }, { id: "alpha", name: "Alpha", total: 1, running: 1, unassigned: 0 }];
  const call = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method, params) => method === "todo.list" ? { todos: (todo.archived && !["done", "archived"].includes((params as { status?: string }).status || "")) ? [] : [todo], total: (todo.archived && !["done", "archived"].includes((params as { status?: string }).status || "")) ? 0 : 1, departments, agents: [{ id: "alice", name: "Alice", projectId: "alpha" }], serverTime: Date.now() } : { todo, serverTime: Date.now() });
  const client = { call, onEvent: vi.fn(() => () => {}) } as unknown as Pick<GatewayClient, "call" | "onEvent">;
  const props = { open: true, departmentId: scope, onClose: vi.fn(), onOpenSession: vi.fn(), connected: true, client };
  render(createElement(TaskBoard, props));
  return { todo, call, props };
}
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
  fireEvent.change(screen.getByRole("combobox", { name: "Task owner" }), { target: { value: "__unassigned__" } });
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
