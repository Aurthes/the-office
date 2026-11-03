import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentState } from "@/features/agents/state/store";
import { useFieldworkTasks } from "@/features/office/hooks/useFieldworkTasks";

const roster = { projects: [{ id: "office", name: "Office" }, { id: "other", name: "Other" }], members: [{ id: "one", projectId: "office" }, { id: "two", projectId: "other" }] };
const agents = [{ agentId: "one", status: "running" }, { agentId: "two", status: "running" }] as AgentState[];
afterEach(cleanup);
it("reads only active Office tasks and does not poll on ordinary metadata refreshes", async () => {
  const call = vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "调整雨林里的灯光" }], nextCursor: null });
  const client = { call };
  const hook = renderHook(({ values }) => useFieldworkTasks(client, values, roster, true, "gateway"), { initialProps: { values: agents } });
  await waitFor(() => expect(hook.result.current.tasks.one).toBe("调整雨林里的灯光"));
  expect(call).toHaveBeenCalledTimes(1); expect(call).toHaveBeenCalledWith("session.history", { threadId: "one" });
  hook.rerender({ values: agents.map(a => ({ ...a, name: "Refreshed" })) });
  await act(async () => {}); expect(call).toHaveBeenCalledTimes(1);
  expect(hook.result.current.workers.has("two")).toBe(false);
});
it("lets a new live task win over a late history response, and keeps it through Continue", async () => {
  let receive!: (e: { event: string; payload: unknown }) => void, finish!: (v: unknown) => void;
  const client = { call: vi.fn(() => new Promise(resolve => { finish = resolve; })), onEvent: (fn: typeof receive) => { receive = fn; return vi.fn(); } };
  const hook = renderHook(() => useFieldworkTasks(client, agents, roster, true, "gateway"));
  act(() => receive({ event: "session.stream", payload: { threadId: "one", items: [{ role: "user", content: "修改吧台" }] } }));
  await act(async () => finish({ messages: [{ role: "user", content: "调整雨林" }], nextCursor: null }));
  expect(hook.result.current.tasks.one).toBe("修改吧台");
  act(() => receive({ event: "session.stream", payload: { threadId: "one", items: [{ role: "user", content: "继续" }] } }));
  expect(hook.result.current.tasks.one).toBe("修改吧台");
  act(() => receive({ event: "session.stream", payload: { threadId: "two", items: [{ role: "user", content: "调整雨林" }] } }));
  expect(hook.result.current.tasks.two).toBeUndefined();
});
it("walks bounded history pages to find the task behind a long work log", async () => {
  const call = vi.fn().mockResolvedValueOnce({ messages: [{ role: "assistant", content: "正在工作" }], nextCursor: "older" }).mockResolvedValueOnce({ messages: [{ role: "user", content: "调整机房" }, { role: "user", content: "go" }], nextCursor: "more" });
  const client = { call }; const hook = renderHook(() => useFieldworkTasks(client, agents, roster, true, "gateway"));
  await waitFor(() => expect(hook.result.current.tasks.one).toBe("调整机房"));
  expect(call).toHaveBeenCalledTimes(2); expect(call.mock.calls[1]).toEqual(["session.history", { threadId: "one", cursor: "older" }]);
});
it("clears uncertain task context when history cannot be read", async () => {
  const client = { call: vi.fn().mockRejectedValue(new Error("Unavailable")) };
  const hook = renderHook(() => useFieldworkTasks(client, agents, roster, true, "gateway"));
  await waitFor(() => expect(hook.result.current.tasks.one).toBe(""));
});
