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
