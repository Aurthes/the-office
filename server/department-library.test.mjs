import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDepartmentLibrary } from "./department-library.js";
import { createProxyBoundary } from "./proxy-boundary.js";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const token = "isolated-fixture-credential-value";
const boundary = createProxyBoundary({ token, publicOrigins: ["https://office.example"] });
const base = "/api/office/department-library/";

async function fixture(t, limits = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "department-library-"));
  const options = { root, lookupDepartments: async () => new Set([A, B]), ...limits };
  let library = createDepartmentLibrary(options);
  const server = http.createServer((req, res) => {
    const rejected = boundary(req);
    if (rejected) { res.writeHead(rejected).end(); return; }
    if (!library(req, res)) res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const origin = "http://127.0.0.1:" + server.address().port;
  const request = (scope, init = {}, authorize = true) => fetch(origin + base + scope, {
    ...init, headers: { ...(authorize ? { "x-office-proxy-token": token } : {}), ...init.headers },
  });
  const post = (scope, contentType, body, from = origin) => request(scope, { method: "POST", headers: { origin: from, "content-type": contentType }, body });
  return { root, request, post, port: server.address().port, origin, restart: () => { library = createDepartmentLibrary(options); } };
}

test("stores link and exact bytes across service recreation; serves active file types only as authenticated department attachments", async t => {
  const { root, request, post, restart } = await fixture(t);
  const text = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>text</script></svg>");
  const file = await post(A + "?name=" + encodeURIComponent("试验.svg"), "application/octet-stream", text);
  assert.equal(file.status, 201);
  const { entry } = await file.json();
  const named = await post(A, "application/json", JSON.stringify({ name: "Manual", url: "https://example.test/guide" }));
  assert.equal(named.status, 201);
  assert.equal(fs.statSync(path.join(root, A, entry.id, "content")).mode & 0o777, 0o600);
  restart();
  const rows = (await (await request(A)).json()).entries;
  assert.equal(rows.find(row => row.id === entry.id).name, "试验.svg");
  assert.equal(rows.find(row => row.kind === "link").url, "https://example.test/guide");
  assert.equal((await request(B + "/" + entry.id)).status, 404);
  assert.equal((await request(A + "/" + entry.id, {}, false)).status, 401);
  const download = await request(A + "/" + entry.id);
  assert.equal(download.headers.get("content-type"), "application/octet-stream");
  assert.match(download.headers.get("content-disposition"), /^attachment; filename\*=UTF-8''%E8/);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.equal(download.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), text);
  const content = path.join(root, A, entry.id, "content");
  fs.unlinkSync(content);
  fs.symlinkSync(path.join(root, A, entry.id, "entry.json"), content);
  assert.equal((await request(A + "/" + entry.id)).status, 404);
});

test("rejects unauthenticated and cross-origin writes, unknown departments, encoded traversal and unsafe metadata", async t => {
  const { request, post } = await fixture(t);
  assert.equal((await request(A, {}, false)).status, 401);
  assert.equal((await request(A, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await post(A, "application/json", "{}", "https://evil.example")).status, 403);
  assert.equal((await request("33333333-3333-4333-8333-333333333333")).status, 404);
  assert.equal((await request(A + "/%2e%2e%2fetc")).status, 404);
  assert.equal((await post(A + "?name=foo%0D%0A", "application/octet-stream", "x")).status, 400);
  for (const url of ["javascript:alert(1)", "https://user:pass@example.test", "file:///tmp/example"]) {
    assert.equal((await post(A, "application/json", JSON.stringify({ url }))).status, 400);
  }
});

test("bounds size, total capacity and concurrent uploads; aborted and crash-staged entries never publish", async t => {
  const { root, request, post, restart, port, origin } = await fixture(t, { maxFile: 8, maxTotal: 32, maxEntries: 5 });
  assert.equal((await post(A + "?name=large", "application/octet-stream", "123456789")).status, 413);
  const pending = [];
  for (let i = 0; i < 3; i++) {
    const req = http.request({ method: "POST", hostname: "127.0.0.1", port, path: base + A + "?name=partial", headers: {
      origin, "x-office-proxy-token": token, "content-type": "application/octet-stream", "content-length": 8,
    } });
    req.on("error", () => {});
    pending.push(req);
    req.write("1");
  }
  t.after(() => pending.forEach(req => req.destroy()));
  const staged = () => { try { return fs.readdirSync(path.join(root, A)); } catch { return []; } };
  async function waitFor(predicate) {
    const deadline = Date.now() + 1500;
    while (!predicate()) { assert.ok(Date.now() < deadline, "fixture did not settle"); await new Promise(resolve => setTimeout(resolve, 8)); }
  }
  await waitFor(() => staged().length === 3);
  assert.equal((await post(A + "?name=fourth", "application/octet-stream", "one")).status, 429);
  assert.deepEqual((await (await request(A)).json()).entries, []);
  for (const req of pending) req.destroy();
  await waitFor(() => staged().length === 0);
  fs.mkdirSync(path.join(root, A, ".pending-33333333-3333-4333-8333-333333333333"));
  restart();
  assert.deepEqual((await (await request(A)).json()).entries, []);
  assert.deepEqual(staged(), []);
  for (let i = 0; i < 4; i++) assert.equal((await post(A + "?name=full", "application/octet-stream", "12345678")).status, 201);
  assert.equal((await post(B + "?name=extra", "application/octet-stream", "1")).status, 507);
  assert.equal((await post(A, "application/json", '{"url":"http://example.test"}')).status, 201);
  assert.equal((await post(A, "application/json", '{"url":"http://example.test"}')).status, 507);
});
