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

it("uses unique current handling task/phase, never the owner list or stale history", async () => {
  let receive!: (e: { event: string; payload: unknown }) => void, finish!: (v: unknown) => void;
  const call = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const client = { call, onEvent: (fn: typeof receive) => { receive = fn; return vi.fn(); } };
  const title = "Teaser看板、会话入口与逐题白板";
  const task = { id: "A", title, status: "running", archived: false, handlingAgentId: "one", revision: 1, lastStartedAt: 100, phases: [{ title: "调整Teaser白板", completedAt: null }] };
  const hook = renderHook(({ tasks }) => useFieldworkTasks(client, agents, roster, true, "gateway", tasks), { initialProps: { tasks: null as typeof task[] | null } });
  expect(hook.result.current.tasks.one).toBeUndefined();
  hook.rerender({ tasks: [task] });
  expect(hook.result.current.tasks.one).toMatchObject({ taskId: "A", title });
  await act(async () => finish({ messages: [{ role: "user", content: "调整克隆舱" }] }));
  expect(hook.result.current.tasks.one).toMatchObject({ taskId: "A" });
  act(() => receive({ event: "session.stream", payload: { threadId: "one", version: 20, items: [{ role: "user", content: "调整克隆舱", timestamp: 50 }] } }));
  expect(hook.result.current.tasks.one).toMatchObject({ taskId: "A" });
  const next = { ...task, id: "B", title: "修复机房", revision: 2 };
  hook.rerender({ tasks: [next] });
  expect(hook.result.current.tasks.one).toMatchObject({ taskId: "B", title: "修复机房" });
  act(() => receive({ event: "session.stream", payload: { threadId: "one", version: 19, items: [{ role: "user", content: "调整吧台", timestamp: 200 }] } }));
  expect(hook.result.current.tasks.one).toMatchObject({ taskId: "B" });
  expect(call).toHaveBeenCalledTimes(1); // No extra history on same-running task/revision changes.
  hook.rerender({ tasks: [next, { ...task, id: "owner-only", handlingAgentId: "other", title: "克隆舱" }] });
  expect(hook.result.current.tasks.one).toMatchObject({ taskId: "B" });
});
it("keeps accepted steering through doc-only revisions but invalidates changed work goals", () => {
  let receive!: (e: { event: string; payload: unknown }) => void;
  const task = { id: "A", title: "Teaser board", status: "running", archived: false, handlingAgentId: "one", revision: 1, lastStartedAt: 100 };
  const client = { call: vi.fn(), onEvent: (fn: typeof receive) => { receive = fn; return vi.fn(); } };
  const hook = renderHook(({ tasks }) => useFieldworkTasks(client, agents, roster, true, "gateway", tasks), { initialProps: { tasks: [task] } });
  act(() => receive({ event: "session.stream", payload: { threadId: "one", version: 1, items: [{ role: "user", content: "调整克隆舱", timestamp: 200 }] } }));
  expect(hook.result.current.tasks.one).toBe("调整克隆舱");
  hook.rerender({ tasks: [{ ...task, revision: 2 }] });
  expect(hook.result.current.tasks.one).toBe("调整克隆舱");
  hook.rerender({ tasks: [{ ...task, revision: 2, lastStartedAt: 300 }] });
  expect(hook.result.current.tasks.one).toMatchObject({ taskId: "A", revision: 2 });
  expect(client.call).not.toHaveBeenCalled();
});
it("keeps unknown/ambiguous metadata safe and refuses unrelated controlled notifications", async () => {
  let receive!: (e: { event: string; payload: unknown }) => void;
  const task = { id: "A", title: "Teaser board", status: "running", archived: false, handlingAgentId: "one", revision: 1 };
  const client = { call: vi.fn().mockResolvedValue({ messages: [] }), onEvent: (fn: typeof receive) => { receive = fn; return vi.fn(); } };
  const hook = renderHook(({ tasks }) => useFieldworkTasks(client, agents, roster, true, "gateway", tasks), { initialProps: { tasks: [task, { ...task, id: "B", title: "克隆舱" }] as typeof task[] | null } });
  expect(hook.result.current.tasks.one).toBeNull();
  act(() => receive({ event: "session.stream", payload: { threadId: "one", items: [{ role: "user", content: "Work on delegated Office task 00000000-0000-4000-8000-000000000074: 克隆舱\nTask update: {}" }] } }));
  expect(hook.result.current.tasks.one).toBeNull();
  hook.rerender({ tasks: null });
  expect(hook.result.current.tasks.one).toBeUndefined();
  await act(async () => {});
});
it("ignores callbacks/history from a previous gateway and uses the new metadata directly", async () => {
  const receives: Array<(e: { event: string; payload: unknown }) => void> = [];
  const client = { call: vi.fn().mockResolvedValue({ messages: [] }), onEvent: (fn: (e: { event: string; payload: unknown }) => void) => { receives.push(fn); return vi.fn(); } };
  const task = { id: "A", title: "Teaser board", status: "running", archived: false, handlingAgentId: "one", revision: 1 };
  const hook = renderHook(({ gateway, tasks }) => useFieldworkTasks(client, agents, roster, true, gateway, tasks), { initialProps: { gateway: "first", tasks: [task] } });
  hook.rerender({ gateway: "second", tasks: [{ ...task, id: "B", title: "修复机房" }] });
  act(() => receives[0]({ event: "session.stream", payload: { threadId: "one", version: 100, items: [{ role: "user", content: "调整克隆舱", timestamp: 500 }] } }));
  expect(hook.result.current.tasks.one).toMatchObject({ taskId: "B" });
  await act(async () => {});
});
