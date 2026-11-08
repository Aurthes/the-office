import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { useCurrentAgentTasks } from "@/features/office/hooks/useCurrentAgentTasks";
afterEach(cleanup);
it("reads every open-assignment page, refreshes on task events, and clears a finished task", async () => {
  let onEvent: ((event: { event: string }) => void) | undefined;
  let finished = false;
  const call = vi.fn(async (_method: string, params: { offset: number }) => ({ todos: finished ? [] : [{ id: `task${params.offset}`, title: "Agent View Compression (AVC)", status: "running", archived: false, assigneeId: `agent${params.offset}` }], total: finished ? 0 : 2 }));
  const off = vi.fn();
  const client = { call, onEvent: vi.fn(callback => { onEvent = callback; return off; }) } as unknown as Pick<GatewayClient, "call" | "onEvent">;
  const { result, unmount } = renderHook(() => useCurrentAgentTasks(client, true, "gateway"));
  await waitFor(() => expect(result.current.tasks.size).toBe(2));
  expect(call).toHaveBeenNthCalledWith(2, "todo.list", { status: "all", offset: 1, limit: 25 });
  finished = true;
  act(() => onEvent?.({ event: "todos.updated" }));
  await waitFor(() => expect(result.current.tasks.size).toBe(0));
  unmount(); expect(off).toHaveBeenCalled();
});
it("does not fetch while closed or show stale tasks after a gateway change", async () => {
  const call = vi.fn(async () => ({ todos: [{ id: "task", title: "AVC", status: "running", archived: false, assigneeId: "agent" }], total: 1 }));
  const client = { call, onEvent: vi.fn(() => () => {}) } as unknown as Pick<GatewayClient, "call" | "onEvent">;
  const { result, rerender } = renderHook(({ enabled, gateway }) => useCurrentAgentTasks(client, enabled, gateway), { initialProps: { enabled: false, gateway: "first" } });
  expect(call).not.toHaveBeenCalled();
  rerender({ enabled: true, gateway: "first" });
  await waitFor(() => expect(result.current.tasks.size).toBe(1));
  rerender({ enabled: false, gateway: "second" });
  expect(result.current.tasks.size).toBe(0);
});

it("retains assignments through phase transitions, pauses, disconnects and read failures; removes them on reassignment or completion", async () => {
  let onEvent: ((event: { event: string }) => void) | undefined;
  let fail = false;
  let task = { id: "task", title: "Example", status: "running", archived: false, assigneeId: "agent" };
  const call = vi.fn(async () => {
    if (fail) throw Error("Offline");
    return { todos: [task], total: 1 };
  });
  const client = { call, onEvent: vi.fn(callback => { onEvent = callback; return vi.fn(); }) } as unknown as Pick<GatewayClient, "call" | "onEvent">;
  const { result, rerender } = renderHook(({ enabled }) => useCurrentAgentTasks(client, enabled, "gateway"), { initialProps: { enabled: true } });
  await waitFor(() => expect(result.current.tasks.get("agent")?.[0].id).toBe("task"));
  for (const status of ["paused", "queued", "running"]) {
    const before = call.mock.calls.length;
    task = { ...task, status };
    act(() => onEvent?.({ event: "todos.updated" }));
    await waitFor(() => expect(call.mock.calls.length).toBeGreaterThan(before));
    expect(result.current.tasks.get("agent")?.[0].id).toBe("task");
  }
  fail = true;
  act(() => onEvent?.({ event: "todos.updated" }));
  await waitFor(() => expect(result.current.error).toBe("Current tasks are unavailable."));
  expect(result.current.tasks.get("agent")?.[0].id).toBe("task");
  rerender({ enabled: false });
  expect(result.current.tasks.get("agent")?.[0].id).toBe("task");
  fail = false;
  task = { ...task, assigneeId: "other" };
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.tasks.has("other")).toBe(true));
  expect(result.current.tasks.has("agent")).toBe(false);
  expect(result.current.error).toBe("");
  task = { ...task, status: "done", archived: true };
  act(() => onEvent?.({ event: "todos.updated" }));
  await waitFor(() => expect(result.current.tasks.size).toBe(0));
});

it("invalidates fieldwork immediately and never publishes a list response older than a task event", async () => {
  let receive!: (event: { event: string }) => void;
  const resolve: Array<(v: unknown) => void> = [];
  const call = vi.fn(() => new Promise(done => resolve.push(done)));
  const client = { call, onEvent: (fn: typeof receive) => { receive = fn; return vi.fn(); } } as unknown as Pick<GatewayClient, "call" | "onEvent">;
  const hook = renderHook(() => useCurrentAgentTasks(client, true, "gateway"));
  const task = { id: "A", title: "Teaser", status: "running", archived: false, assigneeId: "one", handlingAgentId: "one" };
  act(() => receive({ event: "todos.updated" }));
  await act(async () => resolve[0]({ todos: [task], total: 1 }));
  expect(hook.result.current.fieldworkSummaries).toBeNull();
  expect(hook.result.current.tasks.has("one")).toBe(false);
  await act(async () => resolve[1]({ todos: [{ ...task, id: "B", title: "机房" }], total: 1 }));
  expect(hook.result.current.fieldworkSummaries?.[0].id).toBe("B");
  act(() => receive({ event: "todos.updated" }));
  expect(hook.result.current.fieldworkSummaries).toBeNull();
  expect(hook.result.current.tasks.get("one")?.[0].id).toBe("B"); // Directory UI retains existing rows.
});

it("ignores an old gateway's in-flight response and subscription after switching", async () => {
  const receives: Array<(event: { event: string }) => void> = [], resolve: Array<(v: unknown) => void> = [];
  const call = vi.fn(() => new Promise(done => resolve.push(done)));
  const client = { call, onEvent: (fn: (event: { event: string }) => void) => { receives.push(fn); return vi.fn(); } } as unknown as Pick<GatewayClient, "call" | "onEvent">;
  const hook = renderHook(({ gateway }) => useCurrentAgentTasks(client, true, gateway), { initialProps: { gateway: "first" } });
  hook.rerender({ gateway: "second" });
  const task = { id: "B", title: "Teaser", status: "running", archived: false, assigneeId: "one", handlingAgentId: "one" };
  await act(async () => resolve[1]({ todos: [task], total: 1 }));
  await act(async () => resolve[0]({ todos: [{ ...task, id: "old" }], total: 1 }));
  act(() => receives[0]({ event: "todos.updated" }));
  expect(hook.result.current.fieldworkSummaries?.[0].id).toBe("B");
  expect(call).toHaveBeenCalledTimes(2);
});
