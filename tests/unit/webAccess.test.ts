// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const credentials = { username: "fixture", password: "test-password-for-web-access" };
const { createWebAccessServer } = await import("../../server/web-access/index.js");
let gateway: ReturnType<typeof http.createServer>;
let gate: ReturnType<typeof createWebAccessServer>;
let upstream: string;
let base: string;
let dataDir: string;
let websocketServer: WebSocketServer;

async function listen(server: ReturnType<typeof http.createServer>) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return `http://127.0.0.1:${address.port}`;
}
async function start(secureCookies = false) {
  gate = createWebAccessServer({ dataDir, credentials, upstream, secureCookies });
  base = await listen(gate);
}
async function stop() { await new Promise<void>(resolve => gate.shutdown(resolve)); }
function cookie(response: Response) { return response.headers.getSetCookie()[0].split(";")[0]; }
async function login(secure = false) {
  const headers = secure ? { "X-Forwarded-Proto": "https" } : {};
  const page = await fetch(base + "/login", { headers });
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  const response = await fetch(base + "/auth/login", { method: "POST", redirect: "manual", headers: { ...headers, Cookie: cookie(page), Origin: base }, body: new URLSearchParams({ username: credentials.username, password: credentials.password, csrf: csrf || "" }) });
  expect(response.status).toBe(303);
  return { cookie: cookie(response), response, originalCookie: cookie(page) };
}
async function rejectedSocket(headers: Record<string, string> = {}, origin = base) {
  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/api/gateway/ws", { headers, origin });
    ws.on("unexpected-response", (_, response) => { resolve(response.statusCode || 0); response.resume(); ws.terminate(); });
    ws.on("open", () => { ws.close(); reject(new Error("Unexpected upgrade")); });
    ws.on("error", () => {});
  });
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "claw3d-web-access-"));
  gateway = http.createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ path: req.url, authorization: req.headers.authorization || null, cookie: req.headers.cookie || null })); });
  websocketServer = new WebSocketServer({ server: gateway });
  websocketServer.on("connection", ws => ws.send("mock connected"));
  upstream = await listen(gateway);
  await start();
});
afterEach(async () => {
  await stop();
  await new Promise<void>(resolve => gateway.close(() => resolve()));
  websocketServer.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("office form login", () => {
  it("shows a real login page and protects HTTP and WebSocket without Basic Auth popups", async () => {
    const page = await fetch(base + "/login");
    expect(await page.text()).toContain("登录你的办公室");
    expect(page.headers.get("www-authenticate")).toBeNull();
    const styles = await fetch(base + "/auth/style.css");
    expect(styles.status).toBe(200);
    expect(styles.headers.get("content-type")).toContain("text/css");
    expect(await styles.text()).toContain(".login-card");
    expect((await fetch(base + "/auth/ui.js")).status).toBe(200);
    const office = await fetch(base + "/office", { redirect: "manual" });
    expect(office.status).toBe(303);
    expect(office.headers.get("location")).toBe("/login");
    expect((await fetch(base + "/api/health")).status).toBe(401);
    expect(await rejectedSocket()).toBe(401);
  });

  it("rotates the session on login and keeps repeated requests authenticated", async () => {
    const auth = await login();
    expect(auth.cookie).not.toBe(auth.originalCookie);
    for (let i = 0; i < 3; i++) {
      const response = await fetch(base + "/office", { headers: { Cookie: auth.cookie, Authorization: "Basic do-not-forward" } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ path: "/office", authorization: null, cookie: null });
    }
    const ws = new WebSocket(base.replace("http:", "ws:") + "/api/gateway/ws", { headers: { Cookie: auth.cookie }, origin: base });
    const message = await new Promise(resolve => ws.once("message", data => resolve(String(data))));
    expect(message).toBe("mock connected");
    await new Promise<void>(resolve => { ws.once("close", () => resolve()); ws.close(); });
  });

  it("persists a login across an access-service restart", async () => {
    const auth = await login();
    await stop();
    await start();
    expect((await fetch(base + "/office", { headers: { Cookie: auth.cookie } })).status).toBe(200);
  });

  it("rejects missing CSRF, wrong passwords, cross-origin posts and upgrades", async () => {
    const empty = await fetch(base + "/auth/login", { method: "POST", body: new URLSearchParams({ username: credentials.username, password: credentials.password, csrf: "" }) });
    expect(empty.status).toBe(403);
    const page = await fetch(base + "/login");
    const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1] || "";
    const bad = await fetch(base + "/auth/login", { method: "POST", headers: { Cookie: cookie(page), Origin: base }, body: new URLSearchParams({ username: credentials.username, password: "wrong", csrf }) });
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain("用户名或密码不正确");
    expect(bad.headers.get("www-authenticate")).toBeNull();
    const cross = await fetch(base + "/auth/login", { method: "POST", headers: { Cookie: cookie(page), Origin: "https://other.invalid" }, body: new URLSearchParams({ username: credentials.username, password: credentials.password, csrf }) });
    expect(cross.status).toBe(403);
    const auth = await login();
    expect(await rejectedSocket({ Cookie: auth.cookie }, "https://other.invalid")).toBe(403);
  });

  it("logs out, invalidates the old cookie and closes existing WebSockets", async () => {
    const auth = await login();
    const state = await (await fetch(base + "/auth/session", { headers: { Cookie: auth.cookie } })).json();
    const ws = new WebSocket(base.replace("http:", "ws:") + "/api/gateway/ws", { headers: { Cookie: auth.cookie }, origin: base });
    await new Promise(resolve => ws.once("message", resolve));
    const closed = new Promise(resolve => ws.once("close", resolve));
    const logout = await fetch(base + "/auth/logout", { method: "POST", headers: { Cookie: auth.cookie, Origin: base }, body: new URLSearchParams({ csrf: state.csrf }) });
    expect(logout.status).toBe(204);
    await closed;
    expect((await fetch(base + "/api/health", { headers: { Cookie: auth.cookie } })).status).toBe(401);
    expect(await rejectedSocket({ Cookie: auth.cookie })).toBe(401);
  });

  it("sets a seven-day Secure, HttpOnly, host-bound cookie behind HTTPS", async () => {
    await stop();
    await start(true);
    const auth = await login(true);
    const header = auth.response.headers.getSetCookie()[0];
    expect(header).toMatch(/^__Host-claw3d_session=/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toMatch(/Domain=/i);
    const expires = header.match(/Expires=([^;]+)/)?.[1] || "";
    expect(new Date(expires).getTime() - Date.now()).toBeGreaterThan(6.9 * 86400000);
  });

  it("limits repeated password attempts", async () => {
    const page = await fetch(base + "/login");
    const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1] || "";
    for (let i = 0; i < 11; i++) {
      const response = await fetch(base + "/auth/login", { method: "POST", headers: { Cookie: cookie(page), Origin: base }, body: new URLSearchParams({ username: credentials.username, password: "wrong", csrf }) });
      expect(response.status).toBe(i < 10 ? 401 : 429);
    }
  });
});
