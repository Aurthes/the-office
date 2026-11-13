import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { useCurrentAgentTasks, useTaskProgressHistory } from "@/features/office/hooks/useCurrentAgentTasks";
afterEach(cleanup);
it("reads every open-assignment page, refreshes on task events, and clears a finished task", async () => {
  let onEvent: ((event: { event: string }) => void) | undefined;
  let finished = false;
  const call = vi.fn(async (_method: string, params: { offset: number }) => ({ todos: finished ? [] : [{ id: `task${params.offset}`, title: "Agent View Compression (AVC)", status: "running", archived: false, assigneeId: `agent${params.offset}` }], total: finished ? 0 : 2 }));
  const off = vi.fn();
  const client = { call, onEvent: vi.fn(callback => { onEvent = callback; return off; }) } as unknown as Pick<GatewayClient, "call" | "onEvent">;
  const { result, unmount } = renderHook(() => useCurrentAgentTasks(client, true, "gateway"));
  await waitFor(() => expect(result.current.tasks.size).toBe(2));
  expect(call).toHaveBeenNthCalledWith(2, "todo.list", { status: "all", offset: 1, limit: 25, includeProgress: true });
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

it("updates active work on transitions, retains last snapshot on read failure and removes reassigned or completed work", async () => {
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
    await waitFor(() => expect(result.current.tasks.has("agent")).toBe(status === "running"));
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
  expect(hook.result.current.fieldworkFresh).toBe(false);
  expect(hook.result.current.fieldworkSummaries?.[0].id).toBe("B");
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

function useProgressFixture(client: Pick<GatewayClient,"call"|"onEvent">, gateway: string) {
  const open = useCurrentAgentTasks(client,true,gateway);
  const history = useTaskProgressHistory(client,true,gateway);
  return { ...open, progressSummaries: [...new Map([...history.summaries,...open.summaries].map(t=>[t.id,t])).values()], progressError: history.error, progressLoading: history.loading, progressLimited: history.limited };
}
it("reads archived history independently and never adds it to badges or fieldwork", async () => {
  let resolveHistory!: (value: unknown)=>void;const pending=new Promise(r=>resolveHistory=r);
  const open={id:"open",title:"Live",status:"running",archived:false,assigneeId:"worker",ownerId:"head"};
  const closed={...open,id:"closed",status:"done",archived:true,completedAt:Date.now()};
  const call=vi.fn(async(_method:string,p:{status:string})=>p.status==="archived"?pending:{todos:[open],total:1});
  const client={call,onEvent:vi.fn(()=>vi.fn())} as unknown as Pick<GatewayClient,"call"|"onEvent">;
  const h=renderHook(()=>useProgressFixture(client,"g"));
  await waitFor(()=>expect(h.result.current.tasks.get("worker")?.[0].id).toBe("open"));
  expect(h.result.current.fieldworkFresh).toBe(true);expect(h.result.current.progressLoading).toBe(true);
  await act(async()=>resolveHistory({todos:[closed,{...open,status:"done",archived:true}],total:2}));
  expect(h.result.current.progressSummaries.map(t=>t.id)).toEqual(["closed","open"]);
  expect(h.result.current.progressSummaries.find(t=>t.id==="open")?.status).toBe("running");
  expect(h.result.current.summaries).toEqual([open]);expect(h.result.current.fieldworkSummaries).toEqual([open]);
  expect(h.result.current.tasks.get("worker")).toHaveLength(1);
});
it("bounds archived reads to 200 and reports partial history without changing open data",async()=>{
  const call=vi.fn(async(_m:string,p:{status:string;offset:number})=>p.status==="all"?{todos:[],total:0}:{todos:Array.from({length:25},(_,i)=>({id:'old-'+(p.offset+i),title:'Done',status:'done',archived:true,assigneeId:null})),total:201});
  const client={call,onEvent:vi.fn(()=>vi.fn())} as unknown as Pick<GatewayClient,"call"|"onEvent">;
  const h=renderHook(()=>useProgressFixture(client,"g"));
  await waitFor(()=>expect(h.result.current.progressLimited).toBe(true));
  expect(h.result.current.progressSummaries).toHaveLength(200);expect(h.result.current.summaries).toHaveLength(0);expect(h.result.current.tasks.size).toBe(0);
  expect(call.mock.calls.filter(([,p])=>p.status==="archived")).toHaveLength(8);
});
it("keeps archive failure separate from valid live assignments",async()=>{
  const open={id:'live',title:'Live',status:'running',archived:false,assigneeId:'worker'};
  const call=vi.fn(async(_m:string,p:{status:string})=>{if(p.status==='archived')throw Error('offline');return {todos:[open],total:1}});
  const client={call,onEvent:vi.fn(()=>vi.fn())} as unknown as Pick<GatewayClient,"call"|"onEvent">;
  const h=renderHook(()=>useProgressFixture(client,'g'));
  await waitFor(()=>expect(h.result.current.progressError).toBe('Recent task history is unavailable.'));
  expect(h.result.current.error).toBe('');expect(h.result.current.fieldworkFresh).toBe(true);expect(h.result.current.tasks.get('worker')).toHaveLength(1);
});
it("rejects old history after task events and gateway changes",async()=>{
  const receivers: Array<(e:{event:string})=>void>=[],resolvers:Array<(v:unknown)=>void>=[];
  const call=vi.fn(async(_m:string,p:{status:string})=>p.status==='all'?{todos:[],total:0}:new Promise(r=>resolvers.push(r)));
  const client={call,onEvent:(fn:(e:{event:string})=>void)=>{receivers.push(fn);return vi.fn()}} as unknown as Pick<GatewayClient,"call"|"onEvent">;
  const h=renderHook(({gateway})=>useProgressFixture(client,gateway),{initialProps:{gateway:'old'}});
  act(()=>receivers.forEach(fn=>fn({event:'todos.updated'})));
  await act(async()=>resolvers[0]({todos:[{id:'stale',title:'Old',status:'done',archived:true}],total:1}));
  expect(h.result.current.progressSummaries).toHaveLength(0);
  h.rerender({gateway:'new'});
  await act(async()=>resolvers.at(-1)!({todos:[{id:'current',title:'New',status:'done',archived:true}],total:1}));
  expect(h.result.current.progressSummaries.map(t=>t.id)).toEqual(['current']);
  await act(async()=>resolvers[1]?.({todos:[{id:'late',title:'Late',status:'done',archived:true}],total:1}));
  expect(h.result.current.progressSummaries.map(t=>t.id)).toEqual(['current']);
});
