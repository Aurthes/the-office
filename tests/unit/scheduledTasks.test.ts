import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EventFrame, GatewayClient } from "@/lib/gateway/GatewayClient";
import { ScheduledTasks, type ScheduledTask } from "@/features/ring-ship/ScheduledTasks";
import { setUiLanguage } from "@/lib/i18n/ui-language";

beforeEach(() => {
  setUiLanguage("en");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
function fixture(tasks: ScheduledTask[] = []) {
  let event: ((frame: EventFrame) => void) | null = null;
  const sessions = [{ id: "chat", name: "Report conversation", project: "Trading" }];
  const call = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async method => method === "schedule.list" ? { tasks, sessions } : { id: "new" });
  const unsubscribe = vi.fn();
  const client = { call, onEvent: vi.fn((fn: (frame: EventFrame) => void) => { event = fn; return unsubscribe; }) };
  const close = vi.fn(), openSession = vi.fn();
  const props = { open: true, onClose: close, onOpenSession: openSession, client: client as unknown as Pick<GatewayClient, "call" | "onEvent">, connected: true };
  const view = render(createElement(ScheduledTasks, props));
  return { tasks, sessions, call, unsubscribe, client, close, openSession, props, view, emit: () => event?.({ type: "event", event: "schedules.updated" }) };
}
const task = (): ScheduledTask => ({ id: "one", name: "Hourly report", threadId: "chat", prompt: "Keep user instructions exactly.", intervalMinutes: 60, firstRunAt: Date.UTC(2026, 10, 1, 14, 10), nextRunAt: Date.UTC(2026, 10, 1, 15, 10), enabled: true, sessionName: "Report conversation", targetAvailable: true, runs: [] });

it("creates a recurring task in an existing Office conversation without sending or creating a conversation", async () => {
  const f = fixture();
  fireEvent.click(await screen.findByRole("button", { name: "New task" }));
  fireEvent.change(screen.getByLabelText("Task name"), { target: { value: "My hourly report" } });
  fireEvent.change(screen.getByLabelText("First run"), { target: { value: "2026-11-02T10:10" } });
  fireEvent.change(screen.getByLabelText("Task instructions"), { target: { value: "Use only the saved report script." } });
  fireEvent.click(screen.getByRole("button", { name: "Save scheduled task" }));
  await waitFor(() => expect(f.call.mock.calls.some(([method]) => method === "schedule.create")).toBe(true));
  const [, params] = f.call.mock.calls.find(([method]) => method === "schedule.create")!;
  expect(params).toMatchObject({ name: "My hourly report", threadId: "chat", prompt: "Use only the saved report script.", intervalMinutes: 60, enabled: true, firstRunAt: new Date("2026-11-02T10:10").getTime() });
  expect(f.call.mock.calls.some(([method]) => ["session.create", "session.send"].includes(method))).toBe(false);
});

it("edits, pauses, queues a manual run, and requires a separate delete click", async () => {
  const f = fixture([task()]);
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Task instructions")).toHaveValue("Keep user instructions exactly.");
  fireEvent.change(screen.getByLabelText("Repeat interval"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save scheduled task" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save scheduled task" })).toBeNull());
  expect(f.call.mock.calls.find(([method]) => method === "schedule.update")?.[1]).toMatchObject({ id: "one", intervalMinutes: 120 });
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  await waitFor(() => expect(f.call.mock.calls.filter(([method]) => method === "schedule.update")).toHaveLength(2));
  expect(f.call.mock.calls.filter(([method]) => method === "schedule.update").at(-1)?.[1]).toMatchObject({ enabled: false });
  await waitFor(() => expect(screen.getByRole("button", { name: "Run now" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Run now" }));
  await waitFor(() => expect(f.call.mock.calls.some(([method]) => method === "schedule.run")).toBe(true));
  await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(f.call.mock.calls.some(([method]) => method === "schedule.delete")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
  await waitFor(() => expect(f.call.mock.calls.some(([method]) => method === "schedule.delete")).toBe(true));
});

it("refreshes from task events only while open, and opens the selected conversation", async () => {
  const f = fixture([task()]);
  await screen.findByRole("button", { name: "Edit" });
  expect(f.call).toHaveBeenCalledTimes(1);
  await act(async () => { f.emit(); });
  expect(f.call).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Report conversation" }));
  expect(f.close).toHaveBeenCalledOnce(); expect(f.openSession).toHaveBeenCalledWith("chat");
  f.view.rerender(createElement(ScheduledTasks, { ...f.props, open: false }));
  expect(f.unsubscribe).toHaveBeenCalled();
  f.view.rerender(createElement(ScheduledTasks, { ...f.props, open: true, connected: false }));
  expect(f.call).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "New task" })).toBeDisabled();
});

it("shows running and uncertain outcomes faithfully and prevents another active run or deletion", async () => {
  const running = { ...task(), runs: [{ id: "run", scheduledAt: Date.now(), status: "running" as const, error: null, manual: false, finishedAt: null }] };
  const uncertain = { ...task(), id: "two", name: "Uncertain report", enabled: false, runs: [{ ...running.runs[0], status: "unknown" as const, error: "Lost acknowledgement" }] };
  fixture([running, uncertain]);
  const card = within(await screen.findByRole("article", { name: "Hourly report" }));
  expect(card.getByRole("button", { name: "Run now" })).toBeDisabled();
  expect(card.getByRole("button", { name: "Delete" })).toBeDisabled();
  expect(card.queryByText("Completed")).toBeNull();
  expect(screen.getByText("Lost acknowledgement")).toBeInTheDocument();
  expect(screen.getByText("This task was paused to avoid a duplicate. Check its conversation before resuming.")).toBeInTheDocument();
});

it("reuses a management operation ID after a lost acknowledgement", async () => {
  const f = fixture([task()]);
  await screen.findByRole("button", { name: "Pause" });
  f.call.mockImplementation(async (method: string) => { if (method === "schedule.update") throw new Error("Network timeout"); return { tasks: f.tasks, sessions: f.sessions }; });
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  await screen.findByRole("alert");
  await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  await waitFor(() => expect(f.call.mock.calls.filter(([method]) => method === "schedule.update")).toHaveLength(2));
  const updates = f.call.mock.calls.filter(([method]) => method === "schedule.update");
  expect(updates[0][1]).toEqual(updates[1][1]);
});

it("translates controls while preserving user-supplied names and instructions", async () => {
  setUiLanguage("zh-CN");
  fixture([{ ...task(), name: "My custom report" }]);
  const card = await screen.findByRole("article", { name: "My custom report" });
  expect(within(card).getByRole("button", { name: "立即运行" })).toBeInTheDocument();
  expect(within(card).getByText("Keep user instructions exactly.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "到点，把事办好。" })).toBeInTheDocument();
});
