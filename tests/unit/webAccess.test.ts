// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { TOTP, Secret } from "otpauth";

const credentials = { username: "fixture", password: "test-password-for-web-access" };
const { createWebAccessServer } = await import("../../server/web-access/index.js");
const { PasswordStore } = await import("../../server/web-access/password-store.js");
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
async function start(secureCookies = false, requireTotp = false) {
  gate = createWebAccessServer({ dataDir, credentials, upstream, secureCookies, requireTotp });
  base = await listen(gate);
}
async function stop() { await new Promise<void>(resolve => gate.shutdown(resolve)); }
function cookie(response: Response) { return response.headers.getSetCookie()[0].split(";")[0]; }
async function login(secure = false, code = "") {
  const headers = secure ? { "X-Forwarded-Proto": "https" } : {};
  const page = await fetch(base + "/login", { headers });
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  const response = await fetch(base + "/auth/login", { method: "POST", redirect: "manual", headers: { ...headers, Cookie: cookie(page), Origin: base }, body: new URLSearchParams({ username: credentials.username, password: credentials.password, csrf: csrf || "", code }) });
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

describe("first password setup", () => {
  async function setupForm() {
    const response = await fetch(base + "/auth/password/setup");
    const html = await response.text();
    return { cookie: cookie(response), csrf: html.match(/name="csrf" value="([^"]+)"/)?.[1] || "", html };
  }
  async function save(form: Awaited<ReturnType<typeof setupForm>>, token: string, password: string, confirmation = password, origin = base) {
    return fetch(base + "/auth/password/setup", { method: "POST", redirect: "manual", headers: { Cookie: form.cookie, Origin: origin }, body: new URLSearchParams({ csrf: form.csrf, setupToken: token, password, confirmation }) });
  }
  it("requires the owner invitation and CSRF, then goes to MFA enrollment without granting office access", async () => {
    await stop(); await start(false, true);
    const oldPending = await login();
    const token = new PasswordStore(dataDir, credentials).issueSetup();
    const form = await setupForm();
    expect(form.html).toContain("设置你的密码");
    expect(form.html).not.toContain(token);
    expect((await fetch(base + "/auth/totp/setup", { headers: { Cookie: oldPending.cookie }, redirect: "manual" })).headers.get("location")).toBe("/login");
    expect((await save(form, "wrong", "strong-fixture-password")).status).toBe(400);
    expect((await save(form, token, "strong-fixture-password", "mismatch")).status).toBe(400);
    expect((await save(form, token, "strong-fixture-password", "strong-fixture-password", "https://other.invalid")).status).toBe(403);
    const saved = await save(form, token, "strong-fixture-password");
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/auth/totp/setup");
    const pending = cookie(saved);
    expect((await fetch(base + "/api/health", { headers: { Cookie: pending } })).status).toBe(401);
    expect(await rejectedSocket({ Cookie: pending })).toBe(401);
    expect(await (await fetch(base + "/auth/totp/setup", { headers: { Cookie: pending } })).text()).toContain("绑定你的验证器");
    expect((await fetch(base + "/auth/password/setup")).status).toBe(410);
    expect((await save(form, token, "other-fixture-password")).status).toBe(410);
    await stop(); await start(false, true);
    const nextPage = await fetch(base + "/login"); const csrf = (await nextPage.text()).match(/name="csrf" value="([^"]+)"/)?.[1] || "";
    const result = await fetch(base + "/auth/login", { method: "POST", redirect: "manual", headers: { Cookie: cookie(nextPage), Origin: base }, body: new URLSearchParams({ username: credentials.username, password: "strong-fixture-password", csrf }) });
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe("/auth/totp/setup");
  });
  it("invalidates earlier password sessions and closes their sockets when the new password is saved", async () => {
    const old = await login();
    const ws = new WebSocket(base.replace("http:", "ws:") + "/api/gateway/ws", { headers: { Cookie: old.cookie }, origin: base });
    await new Promise(resolve => ws.once("message", resolve));
    const closed = new Promise(resolve => ws.once("close", resolve));
    const token = new PasswordStore(dataDir, credentials).issueSetup();
    const form = await setupForm(); const result = await save(form, token, "strong-fixture-password");
    expect(result.status).toBe(303); await closed;
    expect((await fetch(base + "/api/health", { headers: { Cookie: old.cookie } })).status).toBe(401);
    expect(await rejectedSocket({ Cookie: old.cookie })).toBe(401);
    const oldLoginPage = await fetch(base + "/login"); const csrf = (await oldLoginPage.text()).match(/name="csrf" value="([^"]+)"/)?.[1] || "";
    const rejected = await fetch(base + "/auth/login", { method: "POST", headers: { Cookie: cookie(oldLoginPage), Origin: base }, body: new URLSearchParams({ username: credentials.username, password: credentials.password, csrf }) });
    expect(rejected.status).toBe(401);
  });
});

describe("Google Authenticator login", () => {
  async function beginEnrollment() {
    const auth = await login();
    expect(auth.response.headers.get("location")).toBe("/auth/totp/setup");
    const response = await fetch(base + "/auth/totp/setup", { headers: { Cookie: auth.cookie } });
    const html = await response.text();
    const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1] || "";
    const secret = html.match(/id="setup-key">([^<]+)/)?.[1] || "";
    const generator = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" });
    return { ...auth, html, csrf, generator };
  }
  async function confirm(enrollment: Awaited<ReturnType<typeof beginEnrollment>>, code: string, csrf = enrollment.csrf) {
    return fetch(base + "/auth/totp/confirm", { method: "POST", redirect: "manual", headers: { Cookie: enrollment.cookie, Origin: base }, body: new URLSearchParams({ csrf, code }) });
  }
  async function attempt(code = "", password = credentials.password) {
    const page = await fetch(base + "/login");
    const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1] || "";
    return fetch(base + "/auth/login", { method: "POST", redirect: "manual", headers: { Cookie: cookie(page), Origin: base }, body: new URLSearchParams({ username: credentials.username, password, csrf, code }) });
  }
  it("requires fresh password authentication before setup and keeps HTTP/WS locked until a real code is confirmed", async () => {
    const old = await login();
    await stop(); await start(false, true);
    expect((await fetch(base + "/api/health", { headers: { Cookie: old.cookie } })).status).toBe(401);
    expect((await fetch(base + "/auth/totp/setup", { redirect: "manual" })).headers.get("location")).toBe("/login");
    const enrollment = await beginEnrollment();
    expect(enrollment.html).toContain("data:image/png;base64,");
    expect(enrollment.html).toContain("手动添加");
    expect((await fetch(base + "/api/health", { headers: { Cookie: enrollment.cookie } })).status).toBe(401);
    expect(await rejectedSocket({ Cookie: enrollment.cookie })).toBe(401);
    expect((await confirm(enrollment, "", "wrong-csrf")).status).toBe(403);
    expect((await confirm(enrollment, "invalid")).status).toBe(401);
    const activated = await confirm(enrollment, enrollment.generator.generate());
    expect(activated.status).toBe(200);
    const html = await activated.text();
    expect(html).toContain("恢复码");
    const authenticated = cookie(activated);
    expect(authenticated).not.toBe(enrollment.cookie);
    expect((await fetch(base + "/office", { headers: { Cookie: authenticated } })).status).toBe(200);
    const ws = new WebSocket(base.replace("http:", "ws:") + "/api/gateway/ws", { headers: { Cookie: authenticated }, origin: base });
    expect(await new Promise(resolve => ws.once("message", value => resolve(String(value))))).toBe("mock connected");
    await new Promise<void>(resolve => { ws.once("close", () => resolve()); ws.close(); });
    expect((await fetch(base + "/api/health", { headers: { Cookie: old.cookie } })).status).toBe(401);
    expect((await fetch(base + "/api/health", { headers: { Cookie: enrollment.cookie } })).status).toBe(401);
    expect((await fetch(base + "/auth/totp/setup", { headers: { Cookie: authenticated }, redirect: "manual" })).status).toBe(303);
    expect((await confirm(enrollment, enrollment.generator.generate())).status).toBe(303);
  });
  it("enforces both factors, rejects reused codes and persists a verified login and policy across restart", async () => {
    await stop(); await start(false, true);
    const enrollment = await beginEnrollment();
    const current = enrollment.generator.generate();
    const activated = await confirm(enrollment, current);
    expect(activated.status).toBe(200);
    expect((await attempt()).status).toBe(401);
    expect((await attempt(current)).status).toBe(401);
    const next = enrollment.generator.generate({ timestamp: Date.now() + 30000 });
    expect((await attempt(next, "wrong-password")).status).toBe(401);
    const auth = await login(false, next);
    const state = await (await fetch(base + "/auth/session", { headers: { Cookie: auth.cookie } })).json();
    expect(state.twoFactorEnabled).toBe(true);
    expect(JSON.stringify(state)).not.toContain("secret");
    await stop(); await start(false, true);
    expect((await fetch(base + "/office", { headers: { Cookie: auth.cookie } })).status).toBe(200);
    expect((await attempt(next)).status).toBe(401);
    expect((await attempt()).status).toBe(401);
  });
  it("accepts recovery codes once and limits repeated second-factor attempts", async () => {
    await stop(); await start(false, true);
    const enrollment = await beginEnrollment();
    const activated = await confirm(enrollment, enrollment.generator.generate());
    const html = await activated.text();
    const recoveryCode = html.match(/readonly spellcheck="false">([^\n]+)/)?.[1] || "";
    expect(recoveryCode).toMatch(/^[A-F0-9-]{24}$/);
    expect((await attempt(recoveryCode, "wrong-password")).status).toBe(401);
    expect((await attempt(recoveryCode)).status).toBe(303);
    expect((await attempt(recoveryCode)).status).toBe(401);
    for (let i = 0; i < 9; i++) expect((await attempt("bad-code")).status).toBe(401);
    expect((await attempt("bad-code")).status).toBe(429);
  });
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
