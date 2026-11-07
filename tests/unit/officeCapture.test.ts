// @vitest-environment node
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const { OfficeCapture } = createRequire(import.meta.url)("../../server/office-capture.js");
const { resolveUpload } = createRequire(import.meta.url)("../../server/codex-session-uploads.js");
const cleanups: (() => unknown)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=", "base64");
async function fixture({ prepare = true, ready = true, ackTimeout = 1000 } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "office-capture-test-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const uploadRoot = path.join(root, "uploads"); mkdirSync(uploadRoot);
  const a: string = randomUUID(), b: string = randomUUID(), pageId = randomUUID(), frames: { event: string; payload: Record<string, unknown> }[] = [];
  const subscriptions = new Map(), blocked = { editCommit: false, editUncertain: false }, archived = new Set();
  const store = { get: (id: string) => { if (archived.has(id) || ![a, b].includes(id)) throw new Error("missing or archived"); return { id }; } };
  const broker = new OfficeCapture({ stream: { subscriptions }, store, controls: { state: () => blocked }, directory: root, uploadOptions: { root: uploadRoot, key: "normal-upload-ref-key" }, ackTimeout });
  const ws = { readyState: 1, send: vi.fn((raw: string) => {
    const frame = JSON.parse(raw); frames.push(frame);
    if ((frame.event === "session.capture.prepare" && prepare) || (frame.event === "session.capture.ready" && ready)) queueMicrotask(() => broker.ack(ws, { ...frame.payload, result: frame.event.endsWith("prepare") ? "prepared" : "delivered" }));
  }) };
  const selection = { ready: true, threadId: a, subscriptionId: "selected-a" }; subscriptions.set(ws, selection);
  const binding = broker.bind(ws, { pageId });
  const server = createServer((req, res) => void broker.http(req, res)); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port; broker.configure(port);
  cleanups.push(() => { broker.close(); return new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });
  const configPath = path.join(root, "capture-client.json"), config = JSON.parse(readFileSync(configPath, "utf8"));
  const api = (route: string, init: RequestInit = {}) => fetch(config.url + "/capture/" + route, { ...init, headers: { Authorization: "Bearer " + config.key, ...init.headers } });
  const begin = async () => { const id = randomUUID(); const response = await api("begin", { method: "POST", body: JSON.stringify({ requestId: id }) }); return { id, response, data: await response.json() }; };
  const image = (id: string, data = png) => api(id + "/image", { method: "POST", body: data });
  return { root, uploadRoot, a, b, ws, binding, broker, selection, subscriptions, archived, blocked, frames, api, begin, image, config, configPath };
}
describe("bounded capture-only handoff", () => {
  it("freezes the bound socket's selected chat and reuses the original upload store", async () => {
    const f = await fixture();
    f.subscriptions.set({ readyState: 1 }, { ready: true, threadId: f.b, subscriptionId: "phone-or-second-tab" });
    const { id, data } = await f.begin(); expect(data).toMatchObject({ state: "prepared", threadId: f.a });
    f.selection.threadId = f.b; f.selection.subscriptionId = "selected-b";
    const response = await f.image(id); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "delivered", threadId: f.a });
    const upload = f.broker.requests.get(id).upload;
    expect((await resolveUpload(upload.ref, f.a, { root: f.uploadRoot, key: "normal-upload-ref-key" })).image).toBe(true);
    await expect(resolveUpload(upload.ref, f.b, { root: f.uploadRoot, key: "normal-upload-ref-key" })).rejects.toThrow("此会话");
    expect(readdirSync(f.uploadRoot)).toEqual([f.a]);
    expect(f.frames.filter(frame => frame.event === "session.capture.ready").every(frame => frame.payload.threadId === f.a)).toBe(true);
  });
  it("deduplicates concurrent identical uploads and rejects conflicting retry bytes", async () => {
    const f = await fixture(); const { id } = await f.begin();
    const results = await Promise.all([f.image(id), f.image(id)]); expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(readdirSync(path.join(f.uploadRoot, f.a))).toHaveLength(1);
    expect((await f.image(id, Buffer.concat([png, Buffer.from("different")]))).status).toBe(409);
    expect(readdirSync(path.join(f.uploadRoot, f.a))).toHaveLength(1);
  });
  it("rejects unbound, offline, unready, archived and editing targets before accepting capture", async () => {
    const f = await fixture(); f.broker.binding = null; expect((await f.begin()).response.status).toBe(409);
    f.broker.bind(f.ws, { pageId: randomUUID() }); f.selection.ready = false; expect((await f.begin()).response.status).toBe(409);
    f.selection.ready = true; f.blocked.editCommit = true; expect((await f.begin()).response.status).toBe(409);
    f.blocked.editCommit = false; f.archived.add(f.a); expect((await f.begin()).response.status).toBe(400);
    f.archived.clear(); f.broker.disconnected(f.ws); expect((await f.begin()).response.status).toBe(409);
    expect(readdirSync(f.uploadRoot)).toEqual([]);
  });
  it("requires explicit replacement and private proof for same-page reconnect", async () => {
    const f = await fixture(); const other = { readyState: 1, send: vi.fn() };
    expect(f.broker.bind(other, { pageId: randomUUID() })).toEqual({ conflict: true });
    expect(() => f.broker.resume(other, { ...f.binding, resumeProof: "wrong" })).toThrow("expired");
    expect(() => f.broker.resume(other, f.binding)).toThrow("another socket");
    f.ws.readyState = 3; f.broker.disconnected(f.ws);
    expect(f.broker.resume(other, f.binding)).toMatchObject({ pageId: f.binding.pageId });
    expect(f.broker.binding.ws).toBe(other);
  });
  it("does not capture when the prepare ACK loses a selection race or is absent", async () => {
    const f = await fixture({ prepare: false, ackTimeout: 250 });
    const pending = f.begin(); await vi.waitFor(() => expect(f.frames.some(frame => frame.event.endsWith("prepare"))).toBe(true), { interval: 1 });
    const p = f.frames.find(frame => frame.event.endsWith("prepare"))!.payload;
    f.selection.subscriptionId = "changed";
    expect(() => f.broker.ack(f.ws, { ...p, result: "prepared" })).toThrow("selection changed");
    expect((await pending).response.status).toBe(409);
    const missing = await f.begin(); expect(missing.response.status).toBe(409);
    expect(readdirSync(f.uploadRoot)).toEqual([]);
  });
  it("cancels without rerouting and keeps an already saved image when delivery is unknown", async () => {
    const f = await fixture({ ready: false }); const first = await f.begin(); await f.image(first.id);
    expect(f.broker.status(first.id).state).toBe("uploaded");
    const p = f.frames.find(frame => frame.event.endsWith("ready"))!.payload;
    f.broker.ack(f.ws, { ...p, result: "cancelled" });
    expect((await f.image(first.id)).status).toBe(409);
    expect(readdirSync(path.join(f.uploadRoot, f.a))).toHaveLength(1);
    expect(f.broker.status(first.id).threadId).toBe(f.a);
  });
  it("rejects bad credentials, Origin, CORS preflight, DNS hosts, fields and local paths", async () => {
    const f = await fixture();
    expect(statSync(f.configPath).mode & 0o777).toBe(0o600); expect(Object.keys(f.config).sort()).toEqual(["key", "url", "version"]);
    const badRequests: RequestInit[] = [{ headers: { Authorization: "Bearer normal-upload-ref-key" } }, { headers: { Origin: "https://office.example" } }, { method: "OPTIONS" }];
    for (const init of badRequests) {
      const response = await f.api("begin", init); expect([401, 403]).toContain(response.status); expect(response.headers.has("access-control-allow-origin")).toBe(false);
    }
    expect((await f.api("begin", { method: "POST", body: JSON.stringify({ requestId: randomUUID(), path: "/etc/passwd" }) })).status).toBe(400);
    expect((await f.api("../../etc/passwd")).status).toBe(404);
    const res = { writeHead: vi.fn(), end: vi.fn() };
    await f.broker.http({ socket: { remoteAddress: "192.0.2.5" }, headers: { host: new URL(f.config.url).host }, method: "GET" }, res);
    expect(res.writeHead.mock.calls[0][0]).toBe(403);
    res.writeHead.mockClear();
    await f.broker.http({ socket: { remoteAddress: "127.0.0.1" }, headers: { host: "attacker.example", authorization: "Bearer " + f.config.key }, method: "GET" }, res);
    expect(res.writeHead.mock.calls[0][0]).toBe(403);
  });
  it("rejects invalid PNG and oversized upload without ready events", async () => {
    const f = await fixture(); const first = await f.begin();
    await f.image(first.id, Buffer.from("not PNG"));
    expect(f.frames.some(frame => frame.event.endsWith("ready"))).toBe(false);
    const second = await f.begin();
    await f.image(second.id, Buffer.concat([png, Buffer.alloc(20 * 1024 * 1024)]));
    expect(f.frames.some(frame => frame.event.endsWith("ready"))).toBe(false);
    expect(readdirSync(path.join(f.uploadRoot, f.a))).toEqual([]);
  });
  it("expires bounded handoffs and invalidates old scoped keys on gateway restart", async () => {
    const f = await fixture(); const first = await f.begin(); f.broker.requests.get(first.id).expiresAt = 0;
    expect((await f.api(first.id)).status).toBe(410);
    const oldKey = f.config.key; f.broker.key = randomUUID(); f.broker.configure(new URL(f.config.url).port);
    expect((await f.api("begin", { method: "POST", body: JSON.stringify({ requestId: first.id }), headers: { Authorization: "Bearer " + oldKey } })).status).toBe(401);
  });
  it("runs native client → reservation → original upload → page receipt with synthetic bytes and zero sends", async () => {
    const f = await fixture(); const file = path.join(f.root, "synthetic.png"); writeFileSync(file, png);
    const { captureAttachment } = await import("../../scripts/office-capture-client.mjs");
    const frontmost = vi.fn(async () => ({ bundleId: "com.claw3d.Synthetic", pid: 7316 }));
    const capture = vi.fn(async () => ({ exitCode: 0, data: { bundleID: "com.claw3d.Synthetic", directoryPath: f.root, screenshotPath: file } }));
    const requests: string[] = [];
    const result = await captureAttachment({ configPath: f.configPath, wrapper: "fixture-unused", wrapperSha256: "fixture-unused", frontmost, capture, fetcher: (url, init) => { requests.push(String(url)); return fetch(url, init); } });
    expect(result).toMatchObject({ ok: true, threadId: f.a }); expect(capture).toHaveBeenCalledOnce(); expect(frontmost).toHaveBeenCalledTimes(2);
    expect(requests.every(url => new URL(url).pathname.startsWith("/capture/"))).toBe(true); expect(requests.join()).not.toContain("session.send");
    expect(readFileSync(file)).toEqual(png);
  });
});

it.each(["begin", "image"])("reconciles a lost native %s response without recapture, duplicate save or send", async lost => {
  const f = await fixture(); const file = path.join(f.root, "native-synthetic.png"); writeFileSync(file, png);
  const { captureAttachment } = await import("../../scripts/office-capture-client.mjs");
  const capture = vi.fn(async () => ({ exitCode: 0, data: { bundleID: "com.claw3d.Synthetic", directoryPath: f.root, screenshotPath: file } }));
  let dropped = false, begins = 0;
  const result = await captureAttachment({ configPath: f.configPath, wrapper: "unused", wrapperSha256: "unused", frontmost: async () => ({ bundleId: "com.claw3d.Synthetic", pid: 1 }), capture,
    fetcher: async (url, init) => {
      if (String(url).endsWith("/begin")) begins++;
      const response = await fetch(url, init);
      if (!dropped && (lost === "begin" ? String(url).endsWith("/begin") : String(url).endsWith("/image"))) { dropped = true; await response.json(); throw new Error("Synthetic lost response"); }
      return response;
    } });
  expect(result.ok).toBe(true); expect(capture).toHaveBeenCalledOnce(); expect(begins).toBe(1);
  expect(readdirSync(path.join(f.uploadRoot, f.a))).toHaveLength(1);
});
it("freezes and rejects changed foreground identity before taking a screenshot", async () => {
  const f = await fixture(); const { captureAttachment } = await import("../../scripts/office-capture-client.mjs");
  const frontmost = vi.fn().mockResolvedValueOnce({ bundleId: "com.claw3d.Synthetic", pid: 1 }).mockResolvedValueOnce({ bundleId: "com.claw3d.Other", pid: 2 });
  const capture = vi.fn();
  const result = await captureAttachment({ configPath: f.configPath, wrapper: "unused", wrapperSha256: "unused", frontmost, capture });
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining("changed before capture") }); expect(capture).not.toHaveBeenCalled();
});
it("only rejects Shortcuts/setup editors, permits ordinary code-editor targets, and keeps capture on failed attachment", async () => {
  const f = await fixture({ ready: false }); const { captureAttachment } = await import("../../scripts/office-capture-client.mjs");
  const capture = vi.fn();
  await expect(captureAttachment({ configPath: f.configPath, wrapper: "unused", wrapperSha256: "unused", frontmost: async () => ({ bundleId: "com.apple.shortcuts", pid: 1 }), capture })).rejects.toThrow("target app");
  expect(capture).not.toHaveBeenCalled();
  const file = path.join(f.root, "editor-synthetic.png"); writeFileSync(file, png);
  capture.mockImplementation(async () => ({ exitCode: 0, data: { bundleID: "com.example.CodeEditor", directoryPath: f.root, screenshotPath: file } }));
  const result = await captureAttachment({ configPath: f.configPath, wrapper: "unused", wrapperSha256: "unused", frontmost: async () => ({ bundleId: "com.example.CodeEditor", pid: 1 }), capture,
    fetcher: async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).endsWith("/image")) { const body = await response.json(); f.broker.reject(f.broker.requests.get(body.requestId), "Synthetic page lost"); return new Response(JSON.stringify(f.broker.status(body.requestId))); }
      return response;
    } });
  expect(result.ok).toBe(false); expect(readFileSync(file)).toEqual(png);
});
