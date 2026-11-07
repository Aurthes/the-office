import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DepartmentPanel, openDepartmentTab, type DepartmentPanelState } from "@/features/ring-ship/DepartmentPanel";
import { TaskBoard } from "@/features/ring-ship/TaskBoard";
import { useCurrentAgentTasks } from "@/features/office/hooks/useCurrentAgentTasks";
import type { DirectoryTaskSummary } from "@/features/office/operations/agentDirectory";
import { organizationDepartments } from "@/lib/office/departments";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { setUiLanguage } from "@/lib/i18n/ui-language";

beforeEach(() => {
  setUiLanguage("en");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(cleanup);

function fixture() {
  const row = (id: string, extra: Partial<DirectoryTaskSummary> = {}): DirectoryTaskSummary => ({ id, title: id, status: "queued", archived: false, departmentId: "a", ownerId: "head", ownerName: "Leader", assigneeId: "worker", assigneeName: "Builder", ...extra });
  let rows = [...Array.from({ length: 28 }, (_, i) => row(`Task ${i}`)), row("Paused task", { status: "paused" }), row("Review task", { status: "paused", reviewerId: "head" }), row("Open task", { departmentId: null }), row("Other department", { departmentId: "b" }), row("Done task", { status: "done" }), row("Archived task", { archived: true })];
  let fail = false, release: () => void = () => {}, event: ((event: { event: string }) => void) | undefined;
  const first = new Promise<void>(resolve => { release = resolve; }), off = vi.fn();
  const call = vi.fn(async (method: string, input: unknown) => {
    if (method === "todo.get") return { todo: { ...row("Review task"), revision: 1, departmentName: "A", assigneeAvailable: true, phases: [{ id: "verify", title: "Verify", elapsedMs: 0, startedAt: null, completedAt: null }], progress: 0 }, serverTime: Date.now() };
    await first;
    if (fail) throw Error("Offline");
    const { offset = 0, limit = 25 } = input as { offset?: number; limit?: number };
    return { todos: rows.slice(offset, offset + limit).map(row => ({ ...row, revision: 1, departmentName: "A", assigneeAvailable: true, progress: 0, phases: [] })), total: rows.length, agents: [], departments: [], serverTime: Date.now() };
  });
  const client = { call, onEvent: vi.fn(callback => { event = callback; return off; }) } as unknown as Pick<GatewayClient, "call" | "onEvent">;
  const organization = { people: [], ceoAvatar: null, savePosition: vi.fn(), departments: organizationDepartments([{ id: "a", name: "A" }, { id: "b", name: "B" }], []) };
  function Page() {
    const [state, setState] = useState<DepartmentPanelState>({ open: false, selectedId: "a", tabs: ["a"] });
    const [taskId, setTaskId] = useState<string | undefined>();
    const chatOpen = false;
    const tasks = useCurrentAgentTasks(client, chatOpen || state.open, "gateway");
    return h("div", null, h("button", { onClick: () => setState(s => ({ ...s, open: true })) }, "Open department while chat is closed"),
      h(DepartmentPanel, { organization, state, tasks, onSelect: id => setState(s => openDepartmentTab(s, id)), onClose: () => setState(s => ({ ...s, open: false })), onOpenTask: setTaskId }),
      h(TaskBoard, { open: !!taskId, taskId, client, connected: true, onClose: () => setTaskId(undefined), onOpenSession: vi.fn() }));
  }
  const view = render(h(Page));
  return { ...view, call, off, release, emit: () => act(() => event?.({ event: "todos.updated" })), fail: (value: boolean) => { fail = value; }, rows: (value: DirectoryTaskSummary[]) => { rows = value; } };
}

it("loads every page when a department opens with chat closed and scopes the existing follow-up filter to stored department IDs", async () => {
  const f = fixture(); expect(f.call).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open department while chat is closed" }));
  const region = await screen.findByRole("region", { name: "Needs follow-up" });
  expect(within(region).getByRole("status")).toHaveTextContent("Loading tasks…");
  f.release();
  await waitFor(() => expect(within(region).getAllByRole("button")).toHaveLength(30));
  expect(f.call).toHaveBeenCalledWith("todo.list", { status: "all", offset: 25, limit: 25 });
  expect(region).toHaveTextContent("Paused task"); expect(region).toHaveTextContent("Awaiting manager review");
  expect(region).toHaveTextContent("Owner: Leader"); expect(region).toHaveTextContent("Assignee: Builder");
  for (const name of ["Other department", "Done task", "Archived task", "Open task"]) expect(within(region).queryByRole("button", { name })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Company overview" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Workspace" }));
  const open = screen.getByRole("region", { name: "Needs follow-up" });
  expect(within(open).getAllByRole("button")).toHaveLength(1); expect(within(open).getByRole("button", { name: "Open task" })).toBeTruthy();
  f.unmount(); expect(f.off).toHaveBeenCalled();
});
it("retains tasks with a read error, refreshes on existing update events and shows the real empty state", async () => {
  const f = fixture(); f.release();
  fireEvent.click(screen.getByRole("button", { name: "Open department while chat is closed" }));
  const region = await screen.findByRole("region", { name: "Needs follow-up" });
  await waitFor(() => expect(within(region).getAllByRole("button")).toHaveLength(30));
  f.fail(true); f.emit();
  expect(await within(region).findByRole("alert")).toHaveTextContent("Current tasks are unavailable.");
  expect(within(region).getAllByRole("button")).toHaveLength(30);
  f.fail(false); f.rows([]); f.emit();
  expect(await within(region).findByText("No tasks need follow-up.")).toBeVisible();
  expect(within(region).queryByRole("alert")).toBeNull();
});
it("closes department details and opens the existing TaskBoard detail for the same task ID", async () => {
  const f = fixture(); f.release();
  fireEvent.click(screen.getByRole("button", { name: "Open department while chat is closed" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review task" }));
  expect(await screen.findByRole("heading", { name: "Review task" })).toBeVisible();
  expect(f.call).toHaveBeenCalledWith("todo.get", { id: "Review task" });
  expect(screen.queryByRole("dialog", { name: "Departments" })).toBeNull();
});
