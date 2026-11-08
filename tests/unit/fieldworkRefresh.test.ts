import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import type { AgentState } from "@/features/agents/state/store";
import { useCurrentAgentTasks } from "@/features/office/hooks/useCurrentAgentTasks";
import { useFieldworkTasks } from "@/features/office/hooks/useFieldworkTasks";
import { advanceCrew, syncCrew, type MovingAgent } from "@/features/ring-ship/crewMotion";
import { buildShipLayout } from "@/features/ring-ship/layout";

const roster = { projects: [{ id: "office", name: "Office" }], members: [{ id: "one", projectId: "office" }] };
const agents = [{ agentId: "one", status: "running" }] as AgentState[];
const task = (title: string, id = "A", revision = 1) => ({ id, title, revision, status: "running", archived: false, assigneeId: "one", handlingAgentId: "one", lastStartedAt: 100, phases: [{ title: `Implement ${title}`, completedAt: null }] });
afterEach(cleanup);

function fixture(title: string, initialFailure = false) {
  const listeners = new Set<(e: { event: string; payload?: unknown }) => void>();
  const requests: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
  let first = true;
  const call = vi.fn((method: string) => {
    if (method !== "todo.list") return Promise.resolve({ messages: [] });
    if (first) { first = false; return initialFailure ? Promise.reject(Error("Offline")) : Promise.resolve({ todos: [task(title)], total: 1 }); }
    return new Promise((resolve, reject) => requests.push({ resolve, reject }));
  });
  const client = { call, onEvent: (listener: (e: { event: string; payload?: unknown }) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const hook = renderHook(() => {
    const source = useCurrentAgentTasks(client as unknown as Pick<GatewayClient, "call" | "onEvent">, true, "gateway");
    const fieldwork = useFieldworkTasks(client, agents, roster, true, "gateway", source.fieldworkSummaries, source.fieldworkFresh);
    return { ...fieldwork, source };
  });
  const layout = buildShipLayout(roster);
  let crew: MovingAgent | undefined;
  const sync = (status: "working" | "idle" | "error" = "working") => {
    crew = syncCrew([{ id: "one", name: "Builder", color: "#abc", item: "", status, constructionWorker: true, siteTask: hook.result.current.tasks.one }], layout, crew ? new Map([[crew.id, crew]]) : new Map(), 0)[0];
    return crew;
  };
  const settle = () => {
    const a = sync();
    for (let i = 0; i < 4000 && !a.fieldwork?.geared; i++) advanceCrew([a], layout, i * 50, .05);
    expect(a.fieldwork?.geared).toBe(true);
    return a;
  };
  const emit = (event: string, payload?: unknown) => act(() => listeners.forEach(listener => listener({ event, payload })));
  const answer = async (index: number, rows: ReturnType<typeof task>[]) => {
    await waitFor(() => expect(requests[index]).toBeDefined());
    await act(async () => requests[index].resolve({ todos: rows, total: rows.length }));
  };
  return { hook, requests, call, layout, sync, settle, emit, answer };
}

it.each([["Teaser board", "break"], ["修复克隆舱", "cloning"]])("holds %s camp through unrelated/focus refresh, delay, failure and doc-only revision", async (title, kind) => {
  const f = fixture(title);
  await waitFor(() => expect(f.hook.result.current.tasks.one).toMatchObject({ taskId: "A" }));
  const initial = f.settle(), field = initial.fieldwork, route = initial.route;
  const remains = () => {
    const a = f.sync(); advanceCrew([a], f.layout, 10000, .01);
    expect(a.worksite?.kind).toBe(kind); expect(a.fieldwork).toBe(field);
    expect(a.fieldwork?.phase).not.toBe("packing"); expect(a.route).toBe(route);
  };
  f.emit("todos.updated", { id: "unrelated-other-task" });
  expect(f.hook.result.current.source.fieldworkFresh).toBe(false);
  remains();
  // A late live item during the uncertain refresh must not invent a new target.
  f.emit("session.stream", { threadId: "one", version: 10, items: [{ role: "user", content: "调整机房", timestamp: 200 }] });
  remains();
  await f.answer(0, [task(title)]); remains();
  act(() => window.dispatchEvent(new Event("focus"))); remains();
  await waitFor(() => expect(f.requests[1]).toBeDefined());
  await act(async () => f.requests[1].reject(Error("Temporary read failure")));
  expect(f.hook.result.current.source.error).toBeTruthy(); remains();
  f.emit("todos.updated", { id: "A" }); remains();
  await f.answer(2, [task(title, "A", 2)]); remains();
});

it("changes only on a confirmed new goal and uses Shared only on confirmed unknown", async () => {
  const f = fixture("Teaser board");
  await waitFor(() => expect(f.hook.result.current.tasks.one).toMatchObject({ taskId: "A" }));
  f.settle();
  f.emit("todos.updated", { id: "A" });
  expect(f.sync().worksite?.kind).toBe("break");
  const next = { ...task("修复机房", "B"), lastStartedAt: 1000 };
  await f.answer(0, [next]);
  f.emit("session.stream", { threadId: "one", version: 20, items: [{ role: "user", content: "调整克隆舱", timestamp: 200 }] });
  let a = f.sync(); expect(a.worksite?.kind).toBe("servers");
  advanceCrew([a], f.layout, 10000, .05); expect(a.fieldwork?.phase).toBe("packing");
  for (let i = 0; i < 4000 && a.fieldwork?.phase !== "blueprint"; i++) advanceCrew([a], f.layout, i * 50, .05);
  expect(a.fieldwork?.cabinId).toBe(a.worksite?.id);
  f.emit("todos.updated", { id: "B" }); expect(f.sync().worksite?.kind).toBe("servers");
  await f.answer(1, []);
  a = f.sync(); expect(a.worksite?.projectId).toBe("open-workspace");
  advanceCrew([a], f.layout, 20000, .05); expect(a.fieldwork?.phase).toBe("packing");
  for (let i = 0; i < 4000 && a.fieldwork?.phase !== "blueprint"; i++) advanceCrew([a], f.layout, i * 50, .05);
  expect(a.fieldwork?.cabinId).toBe(a.worksite?.id);
  a = f.sync("idle");
  for (let i = 0; i < 4000 && a.fieldwork; i++) advanceCrew([a], f.layout, i * 50, .05);
  expect(a.fieldwork).toBeUndefined(); expect(a.deck).toBe(a.homeDeck);
});

it("does not start construction from initial loading/read failure; confirmed unknown does", async () => {
  const f = fixture("Unused", true);
  let a = f.sync(); advanceCrew([a], f.layout, 0, .05);
  expect(a.worksite).toBeUndefined(); expect(a.fieldwork).toBeUndefined();
  await waitFor(() => expect(f.hook.result.current.source.error).toBeTruthy());
  a = f.sync(); advanceCrew([a], f.layout, 50, .05);
  expect(a.worksite).toBeUndefined(); expect(a.fieldwork).toBeUndefined();
  act(() => window.dispatchEvent(new Event("focus")));
  await f.answer(0, []);
  a = f.sync(); expect(a.worksite?.projectId).toBe("open-workspace");
  advanceCrew([a], f.layout, 100, .05); expect(a.fieldwork).toBeDefined();
});

it("does not repack A at the Teaser board when parallel B changes its phase under the same parent", async () => {
  const f = fixture("Teaser board"); await waitFor(() => expect(f.hook.result.current.tasks.one).toMatchObject({ taskId: "A" }));
  const shared = { ...task("Shared parent"), executionMode: "phases", handlingAgentId: "owner", phases: [
    { id: "pa", title: "Implement Teaser board", handlingAgentId: "one", assigneeId: "one", status: "running", startedAt: 100, lastStartedAt: 100, completedAt: null },
    { id: "pb", title: "修复克隆舱", handlingAgentId: "two", assigneeId: "two", status: "running", startedAt: 100, lastStartedAt: 100, completedAt: null },
  ] };
  f.emit("todos.updated"); await f.answer(0, [shared]);
  await waitFor(() => expect(f.hook.result.current.tasks.one).toMatchObject({ phase: "Implement Teaser board" }));
  const initial = f.settle(), field = initial.fieldwork, route = initial.route;
  f.emit("todos.updated"); expect(f.sync().fieldwork).toBe(field);
  await f.answer(1, [{ ...shared, revision: 2, phases: [shared.phases[0], { ...shared.phases[1], title: "Update cloning lab", lastStartedAt: 1000 }] }]);
  const after = f.sync(); advanceCrew([after], f.layout, 15000, .01);
  expect(after.fieldwork).toBe(field); expect(after.route).toBe(route); expect(after.worksite?.kind).toBe("break"); expect(after.fieldwork?.phase).not.toBe("packing");
});
