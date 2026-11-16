// @vitest-environment node
import http from "node:http";
import fs from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { createMmPnlProxy } = await import("../../server/mm-pnl-proxy.js");
const { createProxyBoundary } = await import("../../server/proxy-boundary.js");
let backend: http.Server, office: http.Server, base: string;
const seen: { path?: string; headers: http.IncomingHttpHeaders }[] = [];
async function listen(server: http.Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
beforeEach(async () => {
  seen.length = 0;
  backend = http.createServer((req, res) => {
    seen.push({ path: req.url, headers: req.headers });
    res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "upstream-secret", Location: "https://elsewhere.invalid" });
    res.end(JSON.stringify({ path: req.url }));
  });
  const port = await listen(backend), get = http.get;
  vi.spyOn(http, "get").mockImplementation(((options: http.RequestOptions, callback: (r: http.IncomingMessage) => void) => {
    expect(options.hostname).toBe("127.0.0.1"); expect(options.port).toBe(8768);
    expect(options.headers).toBeUndefined();
    return get({ ...options, port }, callback);
  }) as typeof http.get);
  const proxy = createMmPnlProxy();
  const boundary = createProxyBoundary({ token: "a".repeat(32), publicOrigins: "https://office.example" });
  office = http.createServer((req, res) => {
    const rejected = boundary(req);
    if (rejected) { res.writeHead(rejected); res.end(); return; }
    if (!proxy(req, res)) { res.writeHead(418); res.end(); }
  });
  base = `http://127.0.0.1:${await listen(office)}`;
});
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks();
  for (const server of [office, backend]) {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
const auth = { "x-office-proxy-token": "a".repeat(32) };
it("protects the route before forwarding and strips all caller credentials", async () => {
  expect((await fetch(base + "/mm-pnl/")).status).toBe(401);
  expect(seen).toHaveLength(0);
  const response = await fetch(base + "/mm-pnl/api/pnl?strategy=MMRPI&start=1&end=2&step=1&host=evil", { headers: { ...auth, Cookie: "secret", Authorization: "Bearer secret", "x-office-owner": "private" } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ path: "/api/pnl?strategy=MMRPI&start=1&end=2&step=1&host=evil" });
  expect(seen[0].headers.cookie).toBeUndefined(); expect(seen[0].headers.authorization).toBeUndefined();
  expect(seen[0].headers["x-office-proxy-token"]).toBeUndefined(); expect(seen[0].headers["x-office-owner"]).toBeUndefined();
  expect(response.headers.get("set-cookie")).toBeNull(); expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
});
it("allows only explicit GET paths, bounds queries, redirects the slash and leaves existing routes alone", async () => {
  for (const path of ["/", "/index.html", "/plotly.js", "/live.js", "/api/config", "/api/pnl", "/healthz"]) {
    expect((await fetch(base + "/mm-pnl" + path, { headers: auth })).status).toBe(200);
  }
  const r = await fetch(base + "/mm-pnl?a=1", { headers: auth, redirect: "manual" });
  expect(r.status).toBe(308); expect(r.headers.get("location")).toBe("/mm-pnl/?a=1");
  for (const path of ["/config", "/api/sql", "/http://elsewhere.invalid/", "/%2fapi/config"]) {
    expect((await fetch(base + "/mm-pnl" + path, { headers: auth })).status).toBe(404);
  }
  expect((await fetch(base + "/mm-pnl/api/pnl", { method: "POST", headers: auth })).status).toBe(405);
  expect((await fetch(base + "/mm-pnl/api/pnl?a=" + "a".repeat(8200), { headers: auth })).status).toBe(414);
  expect((await fetch(base + "/account-history/", { headers: auth })).status).toBe(418);
  expect((await fetch(base + "/mm-pnl-other", { headers: auth })).status).toBe(418);
});
it("generalizes backend failures and never forwards redirects or backend secrets", async () => {
  backend.removeAllListeners("request");
  backend.on("request", (_req, res) => { res.writeHead(503, { "Set-Cookie": "private" }); res.end("private upstream stack"); });
  const r = await fetch(base + "/mm-pnl/api/pnl", { headers: auth });
  expect(r.status).toBe(503); expect(await r.text()).toBe("MM PnL dashboard temporarily unavailable");
  backend.removeAllListeners("request"); backend.on("request", (_req, res) => { res.writeHead(302, { Location: "http://other.invalid" }); res.end(); });
  expect((await fetch(base + "/mm-pnl/", { headers: auth })).status).toBe(502);
  await new Promise<void>(resolve => backend.close(() => resolve()));
  expect((await fetch(base + "/mm-pnl/", { headers: auth })).status).toBe(502);
});
it("bounds a stalled data request to 95 seconds and cancels work on client disconnect", async () => {
  backend.removeAllListeners("request"); let closed = false;
  let received!: () => void;
  const started = new Promise<void>(resolve => { received = resolve; });
  backend.on("request", req => { req.on("close", () => { closed = true; }); received(); });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const response = fetch(base + "/mm-pnl/api/pnl", { headers: auth });
  await started;
  await vi.advanceTimersByTimeAsync(95000);
  expect((await response).status).toBe(502);
  vi.useRealTimers();
  const aborted = new AbortController();
  const pending = fetch(base + "/mm-pnl/api/pnl", { headers: auth, signal: aborted.signal }).catch(() => null);
  await new Promise(resolve => setTimeout(resolve, 30)); closed = false; aborted.abort(); await pending;
  await vi.waitFor(() => expect(closed).toBe(true));
});
it("wires both HTTP and HTTPS only after existing authentication gates", () => {
  const source = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
  expect(source.match(/if \(mmPnl\(req, res\)\) return;/g)).toHaveLength(2);
  for (const block of source.split("const rejected = proxyBoundary(req);").slice(1)) {
    expect(block.indexOf("accessGate.handleHttp")).toBeLessThan(block.indexOf("mmPnl(req, res)"));
  }
});
