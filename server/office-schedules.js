"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const active = run => ["waiting", "dispatching", "running"].includes(run?.status);
const latest = task => task.runs.at(-1);

// One scheduler belongs to the Office gateway, independent of browser clients.
// Persist the claim before sending. An ambiguous send is never retried blindly.
class OfficeSchedules {
  constructor(directory, { getSession, canSend, send, changed = () => {}, now = Date.now }) {
    this.file = path.join(directory, "scheduled-tasks.json");
    this.getSession = getSession; this.canSend = canSend; this.send = send; this.changed = changed; this.now = now;
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) : { version: 1, tasks: [] };
    if (this.data.version !== 1 || !Array.isArray(this.data.tasks)) throw new Error("Invalid scheduled task state; refusing to overwrite it");
    this.completions = new Map(); this.ticking = false; this.closed = false;
    let recovered = false;
    for (const task of this.data.tasks) {
      if (["dispatching", "running"].includes(latest(task)?.status)) {
        Object.assign(latest(task), { status: "unknown", error: "Office restarted during this run. Check the conversation before resuming.", finishedAt: this.now() });
        task.enabled = false; recovered = true;
      }
    }
    if (recovered) this.save();
  }
  save() {
    const temporary = this.file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(temporary, this.file); this.changed();
  }
  list() {
    return { tasks: this.data.tasks.map(task => {
      let session = null;
      try { session = this.getSession(task.threadId); } catch { /* Retain tasks for missing targets. */ }
      return { ...task, sessionName: session?.name ?? null, targetAvailable: !!session };
    }) };
  }
  get(id) {
    const task = this.data.tasks.find(item => item.id === id);
    if (!task) throw new Error("Scheduled task not found");
    return task;
  }
  validate(input) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) throw new Error("Name must contain 1–120 characters");
    if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 32768) throw new Error("Task instructions must contain 1–32768 characters");
    if (typeof input.threadId !== "string") throw new Error("Choose an Office session");
    this.getSession(input.threadId);
    if (!Number.isSafeInteger(input.intervalMinutes) || input.intervalMinutes < 1 || input.intervalMinutes > 525600) throw new Error("Repeat interval must be 1–525600 minutes");
    if (!Number.isSafeInteger(input.firstRunAt) || input.firstRunAt < 0 || input.firstRunAt > 8e15) throw new Error("Choose a valid first run time");
    if (typeof input.enabled !== "boolean") throw new Error("Choose whether the task is enabled");
    return { name: input.name.trim(), prompt: input.prompt.trim(), threadId: input.threadId, intervalMinutes: input.intervalMinutes, firstRunAt: input.firstRunAt, enabled: input.enabled };
  }
  futureSlot(task) {
    const step = task.intervalMinutes * 60000;
    return task.firstRunAt > this.now() ? task.firstRunAt : task.firstRunAt + (Math.floor((this.now() - task.firstRunAt) / step) + 1) * step;
  }
  create(input) {
    const config = this.validate(input);
    if (this.data.tasks.length >= 100) throw new Error("At most 100 scheduled tasks are supported");
    const task = { ...config, id: crypto.randomUUID(), nextRunAt: config.firstRunAt, createdAt: this.now(), scheduleVersion: 0, runs: [] };
    this.data.tasks.push(task); this.save(); return { task };
  }
  update(input) {
    const task = this.get(input.id), config = this.validate(input);
    const timingChanged = config.firstRunAt !== task.firstRunAt || config.intervalMinutes !== task.intervalMinutes;
    const resumed = !task.enabled && config.enabled;
    Object.assign(task, config);
    if (timingChanged) { task.nextRunAt = config.firstRunAt; task.scheduleVersion++; }
    else if (resumed) { task.nextRunAt = this.futureSlot(task); task.scheduleVersion++; }
    // A queued occurrence has not sent anything yet; edits/pause replace it.
    if (latest(task)?.status === "waiting") task.runs.pop();
    this.save(); return { task };
  }
  remove(input) {
    const task = this.get(input.id);
    if (["dispatching", "running"].includes(latest(task)?.status)) throw new Error("Wait for this run to finish before deleting the task");
    this.data.tasks = this.data.tasks.filter(item => item !== task); this.save(); return { deleted: true };
  }
  runNow(input) {
    const task = this.get(input.id); this.getSession(task.threadId);
    if (active(latest(task))) throw new Error("This task already has a pending run");
    this.enqueue(task, this.now(), true); return { queued: true };
  }
  enqueue(task, scheduledAt, manual = false) {
    const run = { id: crypto.randomUUID(), threadId: task.threadId, prompt: task.prompt, name: task.name, scheduleVersion: task.scheduleVersion, scheduledAt, manual, status: "waiting", turnId: null, error: null, startedAt: null, finishedAt: null };
    task.runs.push(run); task.runs = task.runs.slice(-10); this.save(); return run;
  }
  finish(run, status, error = null) {
    Object.assign(run, { status, error, finishedAt: this.now() });
    delete run.prompt; this.save();
  }
  handle(frame) {
    if (frame.method !== "turn/completed") return;
    const { threadId, turn } = frame.params || {};
    if (!turn?.id) return;
    const result = { status: turn.status === "completed" ? "completed" : "failed", error: turn.error?.message || (turn.status === "interrupted" ? "The run was interrupted" : turn.status === "completed" ? null : "The run failed") };
    const key = `${threadId}:${turn.id}`;
    this.completions.set(key, result);
    if (this.completions.size > 128) this.completions.delete(this.completions.keys().next().value);
    for (const task of this.data.tasks) {
      const run = latest(task);
      if (run?.status === "running" && run.threadId === threadId && run.turnId === turn.id) this.finish(run, result.status, result.error);
    }
  }
  async tick() {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      for (const task of [...this.data.tasks]) {
        if (this.closed) break;
        let run = latest(task);
        if (run?.status === "running" || run?.status === "dispatching") continue;
        if (run?.status !== "waiting") {
          if (!task.enabled || task.nextRunAt > this.now()) continue;
          run = this.enqueue(task, task.nextRunAt);
        }
        try { this.getSession(run.threadId); }
        catch (error) { task.enabled = false; this.finish(run, "failed", error.message); continue; }
        // Read-only checks may yield. Recheck ownership after edits/deletion.
        let ready;
        try { ready = await this.canSend(run.threadId); } catch { continue; }
        if (this.closed || !this.data.tasks.includes(task) || latest(task) !== run || !ready) continue;
        run.status = "dispatching"; run.startedAt = this.now(); this.save();
        try {
          const message = `[Scheduled task: ${run.name}]\nScheduled occurrence: ${new Date(run.scheduledAt).toISOString()}\nActual dispatch: ${new Date(this.now()).toISOString()}\n${run.manual ? "Manual run." : "Use the scheduled occurrence when determining the report window. Late delivery does not change that window."}\n\n${run.prompt}`;
          const result = await this.send(run.threadId, message, `schedule-${run.id}`);
          if (result.status === "busy") { run.status = "waiting"; run.startedAt = null; this.save(); continue; }
          if (result.status !== "started" || !result.turnId) throw new Error("Scheduled message acceptance could not be confirmed");
          run.status = "running"; run.turnId = result.turnId;
          if (!run.manual && task.scheduleVersion === run.scheduleVersion) task.nextRunAt = run.scheduledAt + task.intervalMinutes * 60000;
          this.save();
          const done = this.completions.get(`${run.threadId}:${run.turnId}`);
          if (done) this.finish(run, done.status, done.error);
        } catch (error) {
          task.enabled = false; this.finish(run, "unknown", `${error.message}. Check the conversation before resuming; the message was not retried.`);
        }
      }
    } finally { this.ticking = false; }
  }
  start() {
    if (this.timer) return;
    const tick = () => { void this.tick().catch(error => console.error("Office scheduled task tick failed:", error.message)); };
    this.timer = setInterval(tick, 10000); this.timer.unref(); tick();
  }
  close() { this.closed = true; clearInterval(this.timer); }
}
module.exports = { OfficeSchedules };
