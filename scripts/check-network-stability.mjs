#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "@playwright/test";

// Read-only browser test. Faults affect this loopback proxy and browser context,
// never the host's Wi-Fi, existing browser tabs, native owner, or user tasks.
const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
const target = new URL(option("--url", "http://127.0.0.1:3033/office"));
if (target.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(target.hostname)) throw new Error("Use a loopback HTTP Studio URL");
const seconds = Number(option("--soak-seconds", "1800"));
if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw new Error("Invalid soak duration");
const reportDir = path.resolve(option("--report-dir", "./network-test-results"));
fs.mkdirSync(reportDir, { recursive: true, mode: 0o700 });
const report = { scope: "Real browser and loopback TCP fault proxy; simulated network switching, not physical Wi-Fi switching",
  url: target.href, started: new Date().toISOString(), cases: [], requests: {}, events: {}, rxBytes: 0, txBytes: 0, connections: 0, closes: [], samples: [] };
const save = () => fs.writeFileSync(path.join(reportDir, "network-stability.json"), JSON.stringify(report, null, 2));
let phase = "startup", delayMs = 0, bytesPerSecond = Infinity, blackhole = false;
const sockets = new Set(), timers = new Set();
const proxy = net.createServer(browserSocket => {
  const upstream = net.connect(Number(target.port || 80), target.hostname);
  sockets.add(browserSocket); sockets.add(upstream);
  for (const [from, to] of [[browserSocket, upstream], [upstream, browserSocket]]) {
    let due = 0;
    from.on("data", chunk => {
      if (blackhole) return;
      due = Math.max(due, Date.now() + delayMs);
      const timer = setTimeout(() => { timers.delete(timer); if (!blackhole && !to.destroyed) to.write(chunk); }, Math.max(0, due - Date.now()));
      timers.add(timer); due += chunk.length / bytesPerSecond * 1000;
    });
    from.on("error", () => to.destroy());
    from.on("end", () => to.end());
    from.on("close", () => { sockets.delete(from); to.destroy(); });
  }
});
await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
const url = new URL(target); url.hostname = "127.0.0.1"; url.port = String(proxy.address().port);
let browser, page;
const responses = [], pending = new Map();
const requireState = async (state, timeout = 45000) => page.waitForFunction(wanted =>
  [...document.querySelectorAll("[title]")].some(e => e.getAttribute("title")?.startsWith("Runtime:") && e.getAttribute("title")?.includes(`(${wanted})`)), state, { timeout });
async function oneRefresh() {
  const before = responses.length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const until = Date.now() + 20000;
  while (responses.length === before) { if (Date.now() > until) throw new Error("Snapshot refresh did not finish"); await pause(20); }
  return responses.at(-1);
}
async function run(name, work) {
  phase = name; const start = Date.now();
  try { const result = await work(); report.cases.push({ name, passed: true, ms: Date.now() - start, ...result }); }
  catch (error) { report.cases.push({ name, passed: false, ms: Date.now() - start, error: error.message }); throw error; }
  finally { save(); console.log(JSON.stringify(report.cases.at(-1))); }
}
try {
  browser = await chromium.launch({ headless: true, ...(option("--channel", null) ? { channel: option("--channel") } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  page = await context.newPage();
  page.on("websocket", ws => {
    const id = ++report.connections;
    ws.on("framesent", ({ payload }) => {
      report.txBytes += Buffer.byteLength(String(payload));
      try { const f = JSON.parse(String(payload)); if (f.method) { report.requests[f.method] = (report.requests[f.method] || 0) + 1; pending.set(f.id, { method: f.method, at: Date.now() }); } } catch { /* Non-protocol frame. */ }
    });
    ws.on("framereceived", ({ payload }) => {
      report.rxBytes += Buffer.byteLength(String(payload));
      try {
        const f = JSON.parse(String(payload));
        if (f.event) report.events[f.event] = (report.events[f.event] || 0) + 1;
        const request = pending.get(f.id);
        if (request && f.type === "res") {
          pending.delete(f.id);
          if (request.method === "office.snapshot") responses.push({ ms: Date.now() - request.at, bytes: Buffer.byteLength(String(payload)), agents: f.payload?.agents?.length, ok: f.ok });
        }
      } catch { /* Non-protocol frame. */ }
    });
    ws.on("close", () => { report.closes.push({ id, phase, at: new Date().toISOString() }); save(); });
  });
  await page.goto(url.href);
  await page.getByRole("button", { name: "+ Project", exact: true }).waitFor({ timeout: 30000 });
  if (await page.getByRole("button", { name: "Close onboarding", exact: true }).isVisible()) await page.getByRole("button", { name: "Close onboarding", exact: true }).click();
  await requireState("connected");
  await pause(500); // Let the initial roster subscription reconcile before measuring a refresh.
  await run("single-snapshot", async () => {
    const before = { ...report.requests };
    const response = await oneRefresh();
    if (!response.ok) throw new Error("Expected a successful snapshot request");
    for (const method of ["sessions.list", "sessions.preview", "exec.approvals.get", "config.get", "agents.list"]) if ((report.requests[method] || 0) !== (before[method] || 0)) throw new Error(`Unexpected metadata fan-out: ${method}`);
    return { ...response, snapshotRequests: (report.requests["office.snapshot"] || 0) - (before["office.snapshot"] || 0) };
  });
  await run("slow-link-1s-rtt-64KiB-per-second", async () => {
    delayMs = 500; bytesPerSecond = 65536;
    const result = [];
    for (let n = 0; n < 5; n++) result.push(await oneRefresh());
    delayMs = 0; bytesPerSecond = Infinity;
    if (result.some(r => !r.ok || r.ms < 900 || r.ms >= 20000)) throw new Error("Slow-link timing/refresh failed");
    return { samples: result };
  });
  await run("browser-offline-online", async () => {
    await context.setOffline(true); await requireState("disconnected", 10000); await pause(4000);
    const start = Date.now(); await context.setOffline(false); await requireState("connected");
    return { recoveryMs: Date.now() - start };
  });
  await run("transport-switch", async () => {
    const before = report.connections, start = Date.now();
    for (const socket of [...sockets]) socket.destroy();
    while (report.connections === before) { if (Date.now() - start > 45000) throw new Error("No replacement WebSocket"); await pause(50); }
    await requireState("connected"); return { recoveryMs: Date.now() - start };
  });
  await run("silent-blackhole", async () => {
    blackhole = true; const start = Date.now();
    try { await requireState("disconnected", 110000); }
    finally { blackhole = false; }
    const detectedMs = Date.now() - start, restore = Date.now(); await requireState("connected");
    return { detectedMs, recoveryMs: Date.now() - restore };
  });
  await run("idle-blackhole", async () => {
    await oneRefresh(); await pause(500);
    blackhole = true; const start = Date.now();
    try { await requireState("disconnected", 110000); }
    finally { blackhole = false; }
    const detectedMs = Date.now() - start, restore = Date.now(); await requireState("connected");
    return { detectedMs, recoveryMs: Date.now() - restore };
  });
  // Retired black-holed sockets may finish their close handshake after their
  // replacements are connected. They are not failures of the new connection.
  phase = "fault-cleanup";
  for (const socket of [...sockets]) socket.destroy();
  await pause(100); await requireState("connected");
  await oneRefresh(); await pause(500);
  await run("continuous-connection", async () => {
    const before = report.closes.length, start = Date.now(), end = start + seconds * 1000;
    while (Date.now() < end) {
      await pause(Math.min(10000, Math.max(1, end - Date.now())));
      const runtime = await page.locator('[title^="Runtime:"]').getAttribute("title").catch(() => null);
      report.samples.push({ at: new Date().toISOString(), runtime, rxBytes: report.rxBytes, connections: report.connections }); save();
      if (report.samples.length % 6 === 0) console.log("SOAK_PROGRESS", Math.round((Date.now() - start) / 1000), runtime);
    }
    if (report.closes.length !== before || report.samples.some(s => !s.runtime?.includes("(connected)"))) throw new Error("Connection changed during soak; inspect report");
    return { observedSeconds: Math.round((Date.now() - start) / 1000) };
  });
  await page.screenshot({ path: path.join(reportDir, "office.png") });
  report.verdict = "passed";
} catch (error) {
  report.verdict = "failed"; report.error = error.message; process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(reportDir, "failure.png") }).catch(() => {});
  console.error(error.message);
} finally {
  phase = "cleanup"; await browser?.close();
  for (const timer of timers) clearTimeout(timer);
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => proxy.close(resolve));
  report.ended = new Date().toISOString(); save();
  console.log("NETWORK_TEST_DONE", report.verdict, path.join(reportDir, "network-stability.json"));
}
