import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { useCurrentAgentTasks } from "@/features/office/hooks/useCurrentAgentTasks";
afterEach(cleanup);
it("reads every running-task page, refreshes on task events, and clears a finished task", async () => {
  let onEvent: ((event: { event: string }) => void) | undefined;
  let finished = false;
  const call = vi.fn(async (_method: string, params: { offset: number }) => ({ todos: finished ? [] : [{ id: `task${params.offset}`, title: "Agent View Compression (AVC)", status: "running", archived: false, assigneeId: `agent${params.offset}` }], total: finished ? 0 : 2 }));
  const off = vi.fn();
  const client = { call, onEvent: vi.fn(callback => { onEvent = callback; return off; }) } as unknown as Pick<GatewayClient, "call" | "onEvent">;
  const { result, unmount } = renderHook(() => useCurrentAgentTasks(client, true, "gateway"));
  await waitFor(() => expect(result.current.tasks.size).toBe(2));
  expect(call).toHaveBeenNthCalledWith(2, "todo.list", { status: "running", offset: 1, limit: 25 });
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
