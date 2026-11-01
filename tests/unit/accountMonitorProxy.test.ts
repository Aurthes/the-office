// @vitest-environment node
import http from "node:http";
import { afterEach, beforeEach, expect, it } from "vitest";
const { createAccountMonitorProxy } = await import("../../server/account-monitor-proxy.js");

let backend: http.Server, office: http.Server, base: string, target: string;
const seen: { path: string | undefined; cookie: string | undefined; authorization: string | undefined }[] = [];
async function listen(server: http.Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return `http://127.0.0.1:${address.port}`;
}
beforeEach(async () => {
  seen.length = 0;
  backend = http.createServer((req, res) => {
    seen.push({ path: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ path: req.url }));
  });
  target = await listen(backend);
  const proxy = createAccountMonitorProxy(target);
  office = http.createServer((req, res) => { if (!proxy(req, res)) { res.writeHead(418); res.end(); } });
  base = await listen(office);
});
afterEach(async () => {
  await Promise.all([office, backend].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

it("proxies only dashboard reads and preserves queries without account/session credentials", async () => {
  const response = await fetch(base + "/account-history/api/curve?source=fixture&metric=account_equity&begin=1&end=2", {
    headers: { Cookie: "private-session", Authorization: "private-authorization" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  expect(seen).toEqual([{ path: "/api/curve?source=fixture&metric=account_equity&begin=1&end=2", cookie: undefined, authorization: undefined }]);
  expect(await response.json()).toEqual({ path: seen[0].path });
  expect((await fetch(base + "/account-history/app.js")).status).toBe(200);
  expect((await fetch(base + "/account-history/aggregate.js")).status).toBe(200);
  expect(await (await fetch(base + "/account-history/api/aggregate?hours=168")).json()).toEqual({ path: "/api/aggregate?hours=168" });
});
it("canonicalizes the root and leaves unrelated Office routes alone", async () => {
  const root = await fetch(base + "/account-history?window=1h", { redirect: "manual" });
  expect(root.status).toBe(308); expect(root.headers.get("location")).toBe("/account-history/?window=1h");
  expect((await fetch(base + "/account-history/")).status).toBe(200);
  expect((await fetch(base + "/office")).status).toBe(418);
  expect((await fetch(base + "/account-history-other")).status).toBe(418);
});
it("rejects writes, unknown paths and attempts to select a different upstream", async () => {
  expect((await fetch(base + "/account-history/api/latest", { method: "POST", body: "write" })).status).toBe(405);
  expect((await fetch(base + "/account-history/config.json")).status).toBe(404);
  expect((await fetch(base + "/account-history/http://other.invalid/")).status).toBe(404);
  expect(seen).toEqual([]);
  for (const origin of ["https://127.0.0.1:8766", "http://other.invalid:8766", "http://user:password@127.0.0.1:8766", "http://127.0.0.1:8766/path"]) {
    expect(() => createAccountMonitorProxy(origin)).toThrow();
  }
});
it("returns a bounded failure when the local viewer is unavailable", async () => {
  await new Promise<void>(resolve => backend.close(() => resolve()));
  expect((await fetch(base + "/account-history/api/latest")).status).toBe(502);
});
