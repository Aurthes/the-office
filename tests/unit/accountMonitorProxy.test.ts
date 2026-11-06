// @vitest-environment node
import http from "node:http";
import { gzipSync, gunzipSync } from "node:zlib";
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
async function rawRequest(encoding: string) {
  return new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    http.get(base + "/account-history/api/aggregate?hours=168", { headers: { "Accept-Encoding": encoding } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    }).on("error", reject);
  });
}
function largeResponse() {
  const data = Buffer.from(JSON.stringify({ pnl: "1.2500", points: Array(2000).fill({ t: 3600, pnl: "0.125", covered: 47 }) }));
  backend.removeAllListeners("request");
  backend.on("request", (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": data.length });
    res.end(data);
  });
  return data;
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

it("compresses large JSON before it enters the tunnel without changing its bytes", async () => {
  const data = largeResponse();
  const result = await rawRequest("br, gzip;q=0.8");
  expect(result.headers["content-encoding"]).toBe("gzip");
  expect(result.headers["content-length"]).toBeUndefined();
  expect(result.headers.vary).toBe("Accept-Encoding");
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(gunzipSync(result.body)).toEqual(data);
  expect(result.body.length).toBeLessThan(data.length / 5);
});

it("sends identity JSON when the client declines gzip", async () => {
  const data = largeResponse();
  for (const encoding of ["identity", "gzip;q=0, br", "gzip;q=0.000"]) {
    const result = await rawRequest(encoding);
    expect(result.headers["content-encoding"]).toBeUndefined();
    expect(result.headers["content-length"]).toBe(String(data.length));
    expect(result.body).toEqual(data);
  }
});

it("preserves an already compressed upstream body without double compression", async () => {
  const data = gzipSync(largeResponse());
  backend.removeAllListeners("request");
  backend.on("request", (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": data.length });
    res.end(data);
  });
  const result = await rawRequest("gzip");
  expect(result.headers["content-encoding"]).toBe("gzip");
  expect(result.body).toEqual(data);
});

it("allows a seven-day aggregate to finish beyond the ordinary eight-second timeout", async () => {
  backend.removeAllListeners("request");
  backend.on("request", (_req, res) => {
    const timer = setTimeout(() => res.end(JSON.stringify({ hours: 168, pnl: "1.25" })), 8200);
    res.once("close", () => clearTimeout(timer));
  });
  const response = await fetch(base + "/account-history/api/aggregate?hours=168");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ hours: 168, pnl: "1.25" });
}, 15000);
