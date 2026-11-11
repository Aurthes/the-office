import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const { OfficeSchedules } = createRequire(import.meta.url)("../../server/office-schedules.js");
const directories: string[] = [];
afterEach(() => { directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })); });
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "office-schedules-")); directories.push(directory);
  let now = Date.UTC(2026, 10, 1, 14, 10);
  const sessions = new Map([["chat", { name: "Own report chat" }], ["other", { name: "Other chat" }]]);
  const deps = {
    getSession: (id: string) => { const session = sessions.get(id); if (!session) throw new Error("Office session is missing or archived"); return session; },
    canSend: vi.fn<(id: string) => Promise<boolean>>(async () => true),
    send: vi.fn<(id: string, message: string, requestId: string) => Promise<{ status: string; turnId: string }>>(async () => ({ status: "started", turnId: `turn-${crypto.randomUUID()}` })),
    now: () => now,
  };
  const scheduler = new OfficeSchedules(directory, deps);
  const config = { name: "Hourly report", threadId: "chat", prompt: "Read existing data and report here.", intervalMinutes: 60, firstRunAt: now, enabled: true };
  const complete = (turnId: string, status = "completed", threadId = "chat") => scheduler.handle({ method: "turn/completed", params: { threadId, turn: { id: turnId, status } } });
  return { directory, deps, scheduler, config, complete, sessions, advance: (ms: number) => { now += ms; } };
}
describe("Office scheduled conversation tasks", () => {
  it("marks enabled schedules independently of current activity and clears paused or deleted tasks", async () => {
    const f = fixture(), { task } = f.scheduler.create({ ...f.config, firstRunAt: f.config.firstRunAt + 3600000 });
    const second = f.scheduler.create(f.config).task;
    expect([...f.scheduler.pendingThreadIds()]).toEqual(["chat"]);
    f.scheduler.update({ ...f.config, id: task.id, enabled: false });
    f.scheduler.remove({ id: second.id });
    expect([...f.scheduler.pendingThreadIds()]).toEqual([]);
    f.scheduler.runNow({ id: task.id });
    expect([...f.scheduler.pendingThreadIds()]).toEqual(["chat"]);
    f.deps.canSend.mockResolvedValue(false); await f.scheduler.tick();
    expect([...f.scheduler.pendingThreadIds()]).toEqual(["chat"]);
    f.deps.canSend.mockResolvedValue(true); await f.scheduler.tick();
    expect(task.runs.at(-1).status).toBe("running");
    expect([...f.scheduler.pendingThreadIds()]).toEqual([]);
  });
  it("keeps an unconfirmed dispatch on its captured target when the future schedule moves", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config);
    f.deps.send.mockImplementationOnce(async () => {
      f.scheduler.update({ ...f.config, id: task.id, threadId: "other" });
      expect([...f.scheduler.pendingThreadIds()].sort()).toEqual(["chat", "other"]);
      return { status: "started", turnId: "old-target" };
    });
    await f.scheduler.tick();
    expect([...f.scheduler.pendingThreadIds()]).toEqual(["other"]);
  });
  it("dispatches once when due, keeps acceptance separate from completion, and resumes ordered missed occurrences", async () => {
    const f = fixture(), { task } = f.scheduler.create({ ...f.config, firstRunAt: f.config.firstRunAt - 2 * 3600000 });
    await Promise.all([f.scheduler.tick(), f.scheduler.tick()]);
    expect(f.deps.send).toHaveBeenCalledTimes(1);
    expect(f.deps.send.mock.calls[0][1]).toContain("2026-11-01T12:10:00.000Z");
    expect(f.deps.send.mock.calls[0][1]).toContain("Actual dispatch: 2026-11-01T14:10:00.000Z");
    expect(task.runs[0].status).toBe("running");
    await f.scheduler.tick(); expect(f.deps.send).toHaveBeenCalledTimes(1);
    f.complete(task.runs[0].turnId, "completed", "other"); expect(task.runs[0].status).toBe("running");
    f.complete(task.runs[0].turnId); expect(task.runs[0].status).toBe("completed");
    await f.scheduler.tick(); expect(f.deps.send).toHaveBeenCalledTimes(2);
    expect(f.deps.send.mock.calls[1][1]).toContain("2026-11-01T13:10:00.000Z");
    expect(new OfficeSchedules(f.directory, f.deps).list().tasks[0]).toMatchObject({ enabled: false, runs: [{ status: "completed" }, { status: "unknown" }] });
  });
  it("waits through disconnect/busy checks and a last-moment busy send without advancing the occurrence", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config);
    f.deps.canSend.mockResolvedValue(false);
    await f.scheduler.tick(); expect(task.runs[0].status).toBe("waiting"); expect(f.deps.send).not.toHaveBeenCalled();
    f.deps.canSend.mockResolvedValue(true); f.deps.send.mockResolvedValueOnce({ status: "busy", turnId: "" });
    await f.scheduler.tick(); expect(task.nextRunAt).toBe(f.config.firstRunAt); expect(task.runs).toHaveLength(1);
    const restarted = new OfficeSchedules(f.directory, f.deps); await restarted.tick();
    expect(restarted.list().tasks[0].runs[0].status).toBe("running");
    expect(f.deps.send.mock.calls[0][2]).toBe(f.deps.send.mock.calls[1][2]);
  });
  it("never retries an uncertain send, including after restart, and pauses until the user checks", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config);
    f.deps.send.mockRejectedValueOnce(new Error("lost acknowledgement"));
    await f.scheduler.tick(); await f.scheduler.tick();
    expect(task.enabled).toBe(false); expect(task.runs[0].status).toBe("unknown");
    const restarted = new OfficeSchedules(f.directory, f.deps); await restarted.tick();
    expect(f.deps.send).toHaveBeenCalledTimes(1);
    expect(restarted.list().tasks[0].runs[0].error).toContain("lost acknowledgement");
  });
  it("preserves a schedule edited during a send and matches completion to the captured conversation", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config);
    f.deps.send.mockImplementationOnce(async () => {
      f.scheduler.update({ ...f.config, id: task.id, intervalMinutes: 120, firstRunAt: f.config.firstRunAt + 7200000, threadId: "other" });
      return { status: "started", turnId: "captured" };
    });
    await f.scheduler.tick();
    expect(task.nextRunAt).toBe(f.config.firstRunAt + 7200000);
    expect(task.runs[0].threadId).toBe("chat");
    f.complete("captured"); expect(task.runs[0].status).toBe("completed");
    await f.scheduler.tick(); expect(f.deps.send).toHaveBeenCalledTimes(1);
  });
  it("cancels unsent work on pause/delete even while a readiness check is in flight", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config);
    f.deps.canSend.mockImplementationOnce(async () => { f.scheduler.remove({ id: task.id }); return true; });
    await f.scheduler.tick(); expect(f.deps.send).not.toHaveBeenCalled(); expect(f.scheduler.list().tasks).toEqual([]);
    const second = f.scheduler.create(f.config).task;
    f.deps.canSend.mockResolvedValue(false); await f.scheduler.tick();
    f.scheduler.update({ ...f.config, id: second.id, enabled: false });
    f.deps.canSend.mockResolvedValue(true); await f.scheduler.tick(); expect(f.deps.send).not.toHaveBeenCalled();
    f.advance(2 * 3600000); f.scheduler.update({ ...f.config, id: second.id, enabled: true });
    expect(second.nextRunAt).toBe(f.config.firstRunAt + 3 * 3600000);
  });
  it("keeps the future resumed slot when a previous send acknowledgement is delayed", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config);
    f.deps.send.mockImplementationOnce(async () => {
      f.scheduler.update({ ...f.config, id: task.id, enabled: false });
      f.advance(2 * 3600000);
      f.scheduler.update({ ...f.config, id: task.id, enabled: true });
      return { status: "started", turnId: "late-ack" };
    });
    await f.scheduler.tick(); f.complete("late-ack");
    expect(task.nextRunAt).toBe(f.config.firstRunAt + 3 * 3600000);
    await f.scheduler.tick(); expect(f.deps.send).toHaveBeenCalledTimes(1);
  });
  it("supports manual runs while paused without changing the recurring cursor, and records real failures", async () => {
    const f = fixture(), { task } = f.scheduler.create({ ...f.config, enabled: false });
    f.scheduler.runNow({ id: task.id });
    expect(() => f.scheduler.runNow({ id: task.id })).toThrow("pending run");
    await f.scheduler.tick();
    expect(task.nextRunAt).toBe(f.config.firstRunAt);
    expect(() => f.scheduler.remove({ id: task.id })).toThrow("finish");
    f.complete(task.runs[0].turnId, "interrupted");
    expect(task.runs[0]).toMatchObject({ status: "failed", error: "The run was interrupted", manual: true });
    f.scheduler.remove({ id: task.id }); expect(f.scheduler.list().tasks).toEqual([]);
  });
  it("handles a completion notification arriving before the send acknowledgement", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config);
    f.deps.send.mockImplementationOnce(async () => { f.complete("fast"); return { status: "started", turnId: "fast" }; });
    await f.scheduler.tick(); expect(task.runs[0].status).toBe("completed");
  });
  it("retains an archived target visibly and disables its task without contacting a foreign session", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config); f.sessions.delete("chat");
    expect(f.scheduler.list().tasks[0]).toMatchObject({ targetAvailable: false, sessionName: null });
    await f.scheduler.tick(); expect(task.enabled).toBe(false); expect(task.runs[0].status).toBe("failed");
    expect(f.deps.canSend).not.toHaveBeenCalled(); expect(f.deps.send).not.toHaveBeenCalled();
    expect(() => f.scheduler.create({ ...f.config, threadId: "foreign" })).toThrow("Office session");
  });
  it("immediately pauses an archived session's tasks, discards unsent work and preserves history across restart", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config);
    await f.scheduler.tick(); f.complete(task.runs[0].turnId);
    const history = structuredClone(task.runs);
    const queued = f.scheduler.create({ ...f.config, enabled: false }).task;
    f.scheduler.runNow({ id: queued.id });
    const future = f.scheduler.create({ ...f.config, firstRunAt: f.config.firstRunAt + 3600000 }).task;
    const other = f.scheduler.create({ ...f.config, threadId: "other", firstRunAt: f.config.firstRunAt + 86400000 }).task;
    f.sessions.delete("chat"); f.scheduler.pauseForSession("chat");
    expect([task.enabled, queued.enabled, future.enabled, other.enabled]).toEqual([false, false, false, true]);
    expect(task.runs).toEqual(history); expect(queued.runs).toEqual([]); expect(future.runs).toEqual([]);
    expect([...f.scheduler.pendingThreadIds()]).toEqual(["other"]);
    const restarted = new OfficeSchedules(f.directory, f.deps);
    expect(restarted.list().tasks[0]).toMatchObject({ enabled: false, targetAvailable: false, runs: history });
    f.advance(3600000); await restarted.tick();
    expect(f.deps.send).toHaveBeenCalledTimes(1);
  });
  it("cancels unsent work when archive finishes during an asynchronous readiness check", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config);
    f.deps.canSend.mockImplementationOnce(async () => {
      f.sessions.delete("chat"); f.scheduler.pauseForSession("chat"); return true;
    });
    await f.scheduler.tick();
    expect(task).toMatchObject({ enabled: false, runs: [] });
    expect(f.deps.send).not.toHaveBeenCalled();
  });
  it("reassigns a paused task without losing history, then resumes on its next future slot in the new session", async () => {
    const f = fixture(), { task } = f.scheduler.create(f.config);
    await f.scheduler.tick(); f.complete(task.runs[0].turnId);
    const originalRun = structuredClone(task.runs[0]);
    f.sessions.delete("chat"); f.scheduler.pauseForSession("chat");
    f.advance(2 * 3600000);
    f.scheduler.update({ ...f.config, id: task.id, threadId: "other", enabled: false });
    await f.scheduler.tick(); expect(f.deps.send).toHaveBeenCalledTimes(1);
    expect(f.scheduler.list().tasks[0]).toMatchObject({ targetAvailable: true, sessionName: "Other chat", enabled: false });
    f.scheduler.update({ ...f.config, id: task.id, threadId: "other", enabled: true });
    expect(task.nextRunAt).toBe(f.config.firstRunAt + 3 * 3600000);
    await f.scheduler.tick(); expect(f.deps.send).toHaveBeenCalledTimes(1);
    f.advance(3600000); await f.scheduler.tick();
    expect(f.deps.send).toHaveBeenLastCalledWith("other", expect.stringContaining(f.config.prompt), expect.any(String), { purpose: "automation", trigger: "schedule", originId: task.runs[1].id });
    expect(task.runs[0]).toEqual(originalRun);
    expect(task.runs[1]).toMatchObject({ threadId: "other", status: "running" });
  });
  it("validates inputs, retains ten runs, and refuses to overwrite corrupt storage", async () => {
    const f = fixture();
    for (const patch of [{ intervalMinutes: 0 }, { firstRunAt: NaN }, { enabled: "true" }, { prompt: "" }]) expect(() => f.scheduler.create({ ...f.config, ...patch })).toThrow();
    const { task } = f.scheduler.create(f.config);
    for (let i = 0; i < 12; i++) { f.scheduler.runNow({ id: task.id }); await f.scheduler.tick(); f.complete(task.runs.at(-1).turnId); }
    expect(task.runs).toHaveLength(10);
    const file = path.join(f.directory, "scheduled-tasks.json"); writeFileSync(file, '{"version":99,"tasks":[]}');
    expect(() => new OfficeSchedules(f.directory, f.deps)).toThrow("refusing to overwrite");
    expect(readFileSync(file, "utf8")).toBe('{"version":99,"tasks":[]}');
  });
});


describe("specified Office invocation times", () => {
  function once(f: ReturnType<typeof fixture>, invocations = [f.config.firstRunAt]) {
    const { intervalMinutes, firstRunAt, ...config } = f.config; void intervalMinutes; void firstRunAt;
    return { ...config, invocations };
  }
  it("claims durably before send, exhausts once, and does not replay after many ticks or restart", async () => {
    const f = fixture(), config = once(f), task = f.scheduler.create(config).task;
    f.deps.send.mockImplementationOnce(async () => {
      const disk = JSON.parse(readFileSync(path.join(f.directory, "scheduled-tasks.json"), "utf8")).tasks[0];
      expect(disk).toMatchObject({ lastInvocationAt: config.invocations[0], nextRunAt: null, runs: [{ status: "dispatching" }] });
      return { status: "started", turnId: "one" };
    });
    await f.scheduler.tick(); expect([...f.scheduler.pendingThreadIds()]).toEqual(["chat"]);
    f.complete("one"); expect([...f.scheduler.pendingThreadIds()]).toEqual([]);
    f.advance(86400000); for (let i=0;i<4;i++) await f.scheduler.tick();
    const restored = new OfficeSchedules(f.directory, f.deps); await restored.tick();
    expect(task).toMatchObject({ enabled: true, nextRunAt: null }); expect(f.deps.send).toHaveBeenCalledTimes(1);
  });
  it("normalizes a past unordered list, drains busy backlog in order, persists beyond ten runs and never resets the claim", async () => {
    const f = fixture(), times = Array.from({length:12}, (_,i)=>f.config.firstRunAt-12000+i*1000), config = once(f,[...times].reverse()), task=f.scheduler.create(config).task;
    expect(task.invocations).toEqual(times);
    f.deps.canSend.mockResolvedValueOnce(false); await f.scheduler.tick(); expect(task.lastInvocationAt).toBe(null);
    f.deps.send.mockResolvedValueOnce({ status:"busy",turnId:"" }); await f.scheduler.tick();
    const firstId=task.runs[0].id; const restored=new OfficeSchedules(f.directory,f.deps);
    for(let i=0;i<12;i++){await restored.tick();const run=restored.get(task.id).runs.at(-1); if(i===0)expect(run.id).toBe(firstId);expect(run.scheduledAt).toBe(times[i]);restored.handle({method:"turn/completed",params:{threadId:"chat",turn:{id:run.turnId,status:"completed"}}});}
    const done=restored.get(task.id);expect(done.runs).toHaveLength(10);expect(done.nextRunAt).toBe(null);
    restored.update({...config,id:task.id,lastInvocationAt:null});await restored.tick();
    const again=new OfficeSchedules(f.directory,f.deps);await again.tick();expect(again.get(task.id).lastInvocationAt).toBe(times.at(-1));expect(f.deps.send).toHaveBeenCalledTimes(13);
  });
  it("keeps waiting and confirmed-busy slots on text edits, but list/target edits or pause cancel unsent work", async()=>{
    const f=fixture(),config=once(f),task=f.scheduler.create(config).task;
    f.deps.canSend.mockResolvedValueOnce(false);await f.scheduler.tick();const id=task.runs[0].id;
    f.scheduler.update({...config,id:task.id,prompt:"New instructions"});expect(task.runs[0].id).toBe(id);
    f.deps.send.mockResolvedValueOnce({status:"busy",turnId:""});await f.scheduler.tick();expect(f.deps.send.mock.calls.at(-1)?.[1]).toContain("New instructions");
    f.scheduler.update({...config,id:task.id,name:"Edited"});expect(task.runs[0].id).toBe(id);
    await f.scheduler.tick();expect(task.runs[0].id).toBe(id);expect(task.runs[0].status).toBe("running");f.complete(task.runs[0].turnId);
    f.scheduler.update({...config,id:task.id,invocations:[f.config.firstRunAt+1000]});f.advance(1000);f.deps.canSend.mockResolvedValueOnce(false);await f.scheduler.tick();
    f.scheduler.update({...config,id:task.id,invocations:[f.config.firstRunAt+1000],threadId:"other"});expect(task.runs).toHaveLength(1);
    await f.scheduler.tick();expect(task.runs.at(-1).threadId).toBe("other");
  });
  it("rearms the same id while running and preserves the new cursor through late ACK/completion", async()=>{
    const f=fixture(),config=once(f),task=f.scheduler.create(config).task,next=f.config.firstRunAt+2000;
    f.deps.send.mockImplementationOnce(async()=>{f.scheduler.update({...config,id:task.id,invocations:[next]});f.complete("late");return{status:"started",turnId:"late"};});
    await f.scheduler.tick();expect(task.runs[0].status).toBe("completed");expect(task.nextRunAt).toBe(next);
    f.advance(2000);await f.scheduler.tick();expect(f.deps.send).toHaveBeenCalledTimes(2);expect(task.nextRunAt).toBe(null);
    f.scheduler.update({...config,id:task.id,invocations:[]});expect(task.runs.at(-1).status).toBe("running");
    expect(()=>f.scheduler.remove({id:task.id})).toThrow(/finish/);f.complete(task.runs.at(-1).turnId);await f.scheduler.tick();expect(f.deps.send).toHaveBeenCalledTimes(2);
  });
  it("cancels an obsolete busy receipt after an in-flight edit without replacing the new plan",async()=>{
    const f=fixture(),config=once(f),task=f.scheduler.create(config).task,next=f.config.firstRunAt+1000;
    f.deps.send.mockImplementationOnce(async()=>{f.scheduler.update({...config,id:task.id,invocations:[next]});return{status:"busy",turnId:""};});
    await f.scheduler.tick();expect(task.runs).toHaveLength(0);expect(task.nextRunAt).toBe(next);await f.scheduler.tick();expect(f.deps.send).toHaveBeenCalledTimes(1);
    f.advance(1000);await f.scheduler.tick();expect(f.deps.send).toHaveBeenCalledTimes(2);
  });
  it("preserves a crash/unknown boundary, refuses automatic replay, and requires an explicit new time",async()=>{
    const f=fixture(),config=once(f),task=f.scheduler.create(config).task;
    f.deps.send.mockRejectedValueOnce(Error("Lost ACK"));await f.scheduler.tick();
    expect(task).toMatchObject({enabled:false,lastInvocationAt:config.invocations[0],nextRunAt:null});
    const restored=new OfficeSchedules(f.directory,f.deps);restored.update({...config,id:task.id,enabled:true});await restored.tick();expect(f.deps.send).toHaveBeenCalledTimes(1);
    restored.update({...config,id:task.id,invocations:[f.config.firstRunAt+1]});f.advance(1);await restored.tick();
    const crashed=new OfficeSchedules(f.directory,f.deps);expect(crashed.get(task.id)).toMatchObject({enabled:false,nextRunAt:null});expect(crashed.get(task.id).runs.at(-1).status).toBe("unknown");
  });
  it("supports clearing, pause/resume and manual runs without consuming/resetting the list",async()=>{
    const f=fixture(),config=once(f,[f.config.firstRunAt+5000]),task=f.scheduler.create({...config,enabled:false}).task;
    f.scheduler.runNow({id:task.id});await f.scheduler.tick();expect(task.lastInvocationAt).toBe(null);expect(task.nextRunAt).toBe(config.invocations[0]);f.complete(task.runs[0].turnId);
    f.advance(5000);f.scheduler.update({...config,id:task.id});f.deps.canSend.mockResolvedValueOnce(false);await f.scheduler.tick();
    f.scheduler.update({...config,id:task.id,enabled:false});expect(task.runs).toHaveLength(1);
    f.scheduler.update({...config,id:task.id});await f.scheduler.tick();f.complete(task.runs.at(-1).turnId);
    f.scheduler.update({...config,id:task.id,invocations:[]});expect(task.nextRunAt).toBe(null);expect(task.enabled).toBe(true);await f.scheduler.tick();expect(f.deps.send).toHaveBeenCalledTimes(2);
    f.scheduler.remove({id:task.id});
  });
  it("rejects mixed/invalid/duplicate input and old-client conversion, permits explicit recurring-to-list conversion",()=>{
    const f=fixture(),config=once(f);
    for(const invocations of [null,"bad",[NaN],[-1],[8e15+1],[1.2],[1,1],Array(1001).fill(1)])expect(()=>f.scheduler.create({...config,invocations})).toThrow();
    for(const mix of [{firstRunAt:0},{intervalMinutes:60}])expect(()=>f.scheduler.create({...config,...mix})).toThrow(/not both/);
    const task=f.scheduler.create(config).task;expect(()=>f.scheduler.update({...f.config,id:task.id})).toThrow(/Include invocations/);
    const old=f.scheduler.create(f.config).task;f.scheduler.update({...config,id:old.id});expect(old).not.toHaveProperty("intervalMinutes");expect(old).not.toHaveProperty("firstRunAt");expect(old.invocations).toEqual(config.invocations);
  });
  it("rechecks ownership after a readiness yield when the list is cleared or the task deleted",async()=>{
    const f=fixture(),config=once(f),task=f.scheduler.create(config).task;
    f.deps.canSend.mockImplementationOnce(async()=>{f.scheduler.update({...config,id:task.id,invocations:[]});return true;});await f.scheduler.tick();expect(f.deps.send).not.toHaveBeenCalled();
    f.scheduler.update({...config,id:task.id});f.deps.canSend.mockImplementationOnce(async()=>{f.scheduler.remove({id:task.id});return true;});await f.scheduler.tick();expect(f.deps.send).not.toHaveBeenCalled();
  });
});
