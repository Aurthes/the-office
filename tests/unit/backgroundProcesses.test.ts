// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
const { registerJob, validateJob, elapsedSeconds, parseProcesses, redactLog, tailFile, progressFromLog, createBackgroundMonitor, readProcesses } = createRequire(import.meta.url)("../../server/background-processes.js");
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "office-background-")); roots.push(root);
  const events = path.join(root, "events.jsonl"), stderr = path.join(root, "stderr.log");
  await writeFile(events, JSON.stringify({ time: 1700000000, date: "2026-01-01T00", step: "download", stage: "partial" }) + "\n");
  await writeFile(stderr, 'Authorization: Bearer do-not-expose\npassword=hidden-value\n');
  const job = { version: 1, id: "sync", name: "Data sync", target: { type: "launchd", label: "com.example.sync" }, eventsFile: events };
  await registerJob(job, root);
  const registry = path.join(root, "jobs"); await registerJob(job, registry);
  const execute = vi.fn(async (command: string) => {
    if (command === "/bin/ps") return " 42 01:02:03 S Thu Nov  5 12:00:00 2026\n";
    if (command === "/usr/bin/plutil") return JSON.stringify({ Label: "com.example.sync", StandardErrorPath: stderr, StandardOutPath: "/dev/null", EnvironmentVariables: { TOKEN: "must-stay-private" }, ProgramArguments: ["worker", "--secret", "also-private"] });
    if (command === "/bin/launchctl") return "state = running\n    pid = 42\n    last exit code = 1\n";
    throw new Error("Unexpected command");
  });
  let time = 10000;
  const monitor = createBackgroundMonitor({ root: registry, execute, platform: "darwin", uid: 501, now: () => time, home: root });
  return { root, registry, events, stderr, job, execute, monitor, advance: () => { time += 5000; } };
}
describe("local background task monitor", () => {
  it("registers independent jobs atomically and rejects executable or traversing targets", async () => {
    const f = await fixture();
    await Promise.all([registerJob({ ...f.job, id: "one" }, f.registry), registerJob({ ...f.job, id: "two" }, f.registry)]);
    expect(JSON.parse(await readFile(path.join(f.registry, "one.json"), "utf8")).id).toBe("one");
    expect((await stat(path.join(f.registry, "one.json"))).mode & 0o777).toBe(0o600);
    expect(() => validateJob({ ...f.job, id: "../auth" })).toThrow();
    expect(() => validateJob({ ...f.job, id: 123 })).toThrow();
    expect(() => validateJob({ ...f.job, target: { type: "launchd", label: "job; touch bad" } })).toThrow();
    expect(() => validateJob({ ...f.job, target: { type: "pid", pid: 1 } })).toThrow();
  });
  it("shares one bounded sample and exposes only the intended metadata and progress", async () => {
    const f = await fixture(); const snapshots = await Promise.all([f.monitor.snapshot(), f.monitor.snapshot(), f.monitor.snapshot()]);
    expect(f.execute.mock.calls.filter(([name]) => name === "/bin/ps")).toHaveLength(1);
    expect(snapshots[0].jobs[0]).toMatchObject({ status: "running", pid: 42, elapsedSeconds: 3723, lastExitCode: 1, progress: { text: "2026-01-01T00 · download · partial", at: 1700000000000 }, logStreams: ["events", "stderr"] });
    const serialized = JSON.stringify(snapshots[0]);
    for (const secret of [f.events, f.stderr, "must-stay-private", "also-private", "ProgramArguments", "EnvironmentVariables"]) expect(serialized).not.toContain(secret);
    await f.monitor.snapshot(); expect(f.execute.mock.calls.filter(([name]) => name === "/bin/ps")).toHaveLength(1);
    f.advance(); await f.monitor.snapshot(); expect(f.execute.mock.calls.filter(([name]) => name === "/bin/ps")).toHaveLength(2);
  });
  it("shows a real service failure but does not call an ordinary stopped process successful", async () => {
    const f = await fixture(); const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async command => command === "/bin/launchctl" ? " state = not running\n last exit code = 1\n" : original(command));
    expect((await f.monitor.snapshot()).jobs[0]).toMatchObject({ status: "failed", pid: null, lastExitCode: 1 });
    f.advance(); f.execute.mockImplementation(async command => command === "/bin/launchctl" ? " state = not running\n last exit code = 0\n" : original(command));
    expect((await f.monitor.snapshot()).jobs[0].status).toBe("stopped");
  });
  it("refuses to attach a reused PID to a registered task", async () => {
    const f = await fixture();
    await registerJob({ ...f.job, id: "pid-worker", target: { type: "pid", pid: 42, started: "earlier process identity" } }, f.registry);
    expect((await f.monitor.snapshot()).jobs.find((row: { id: string }) => row.id === "pid-worker")).toMatchObject({ status: "stopped", pid: null, lastExitCode: null });
  });
  it("keeps failed probes unknown and handles unloaded services without inventing a result", async () => {
    const f = await fixture(); const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async command => { if (command === "/bin/launchctl") throw new Error("permission failure"); return original(command); });
    expect((await f.monitor.snapshot()).jobs[0]).toMatchObject({ status: "unknown", error: "Could not sample this background task." });
    f.advance(); f.execute.mockImplementation(async command => { if (command === "/bin/launchctl") throw Object.assign(new Error("missing"), { stderr: "Could not find service" }); return original(command); });
    expect((await f.monitor.snapshot()).jobs[0]).toMatchObject({ status: "stopped", lastExitCode: null, error: "Service is not loaded." });
    f.advance(); f.execute.mockImplementation(async command => command === "/bin/launchctl" ? "unrecognized output" : original(command));
    expect((await f.monitor.snapshot()).jobs[0]).toMatchObject({ status: "unknown", lastExitCode: null });
  });
  it("returns only registered log streams, bounds output, redacts secrets and tolerates missing files", async () => {
    const f = await fixture();
    const log = await f.monitor.log("sync", "stderr"); expect(log.available).toBe(true);
    expect(log.content).toContain("[redacted]"); expect(log.content).not.toContain("do-not-expose"); expect(log.content).not.toContain("hidden-value");
    await expect(f.monitor.log("../auth", "stderr")).rejects.toThrow("Unknown");
    await expect(f.monitor.log("sync", "/etc/passwd")).rejects.toThrow("Unknown");
    await expect(f.monitor.log("sync", "stdout")).rejects.toThrow("Unknown");
    await writeFile(f.events, "old\n".repeat(20000) + "latest line\n");
    const tail = await tailFile(f.events); expect(tail.truncated).toBe(true); expect(tail.content.length).toBeLessThan(32769); expect(tail.content).toContain("latest line");
    await rm(f.events); expect(await tailFile(f.events)).toMatchObject({ available: false, content: "" });
  });
  it("handles ordinary timestamps and credential formats without returning an invalid date", () => {
    expect(progressFromLog({ content: '{"step":"update","time":1e100}', updatedAt: 123 })).toEqual({ text: "update", at: 123 });
    const clean = redactLog('https://user:password@example.test/file?signature=secret Authorization: Bearer abc.def token="private" --api-key "private" sk-12345678901234567890');
    for (const secret of ["user:password", "signature=secret", "abc.def", '"private"', "sk-12345678901234567890"]) expect(clean).not.toContain(secret);
    expect(elapsedSeconds("03:04")).toBe(184); expect(elapsedSeconds("1-02:03:04")).toBe(93784);
    expect(parseProcesses(" 9 03:04 Z Fri Nov  6 00:00:00 2026\n").get(9).zombie).toBe(true);
    const environment = redactLog('WORKER_TOKEN=prefix-token OPENAI_API_KEY=prefix-api AWS_SECRET_ACCESS_KEY=prefix-secret dbPassword=prefix-password --worker-token prefix-cli');
    for (const value of ["prefix-token", "prefix-api", "prefix-secret", "prefix-password", "prefix-cli"]) expect(environment).not.toContain(value);
  });
  it("can sample this test process using the host's real process table", async () => {
    const processes = await readProcesses(); expect(processes.get(process.pid)).toMatchObject({ pid: process.pid, zombie: false });
    expect(processes.get(process.pid).started).toBeTruthy();
  });
  it("does not block on a named pipe presented as a log file", async () => {
    const f = await fixture(), pipe = path.join(f.root, "pipe.log"); execFileSync("mkfifo", [pipe]);
    expect(await tailFile(pipe)).toMatchObject({ available: false, content: "" });
  });
  it("uses the same process identity across caller language environments", async () => {
    const expected = (await readProcesses()).get(process.pid).started;
    const script = "require(" + JSON.stringify(path.resolve("server/background-processes.js")) + ").readProcesses().then(rows => process.stdout.write(rows.get(" + process.pid + ").started));";
    const localized = execFileSync(process.execPath, ["-e", script], { env: { ...process.env, LC_ALL: "fr_FR.UTF-8" }, encoding: "utf8" });
    expect(localized).toBe(expected);
  });
});
