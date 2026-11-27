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
  for (let i = 0; i < 4; i++) assert.equal((await post(A + "?name=full", "application/octet-stream", String(i).repeat(8))).status, 201);
  assert.equal((await post(B + "?name=extra", "application/octet-stream", "1")).status, 507);
  assert.equal((await post(A, "application/json", '{"url":"http://example.test"}')).status, 201);
  assert.equal((await post(A, "application/json", '{"url":"http://example.test"}')).status, 200);
  assert.equal((await post(A, "application/json", '{"url":"http://different.test"}')).status, 507);
});

// Loopback HTTP integration: predeclared 5s case budget; no upstream connection.
test("legacy index archives derive distinct real titles, preview exact permanent copies and keep downloads isolated", {timeout:5000}, async t => {
  const {request,post,restart}=await fixture(t);
  const saved=[];
  for(const [name,body,title] of [['index.html','<title>Research &amp; results</title><script>window.test=1</script>','Research & results'],['index.html','<h1>Second report</h1>','Second report'],['notes.md','# Markdown report\n\nBody','Markdown report'],['notes.txt','Plain text title\n<data>','Plain text title']]) {
    const response=await post(A+'?name='+encodeURIComponent(name),'application/octet-stream',body);
    const {entry}=await response.json();saved.push(entry);assert.equal(entry.title,title);
    assert.equal(await (await request(A+'/'+entry.id)).text(),body);
    const json=await (await request(A+'/'+entry.id+'?format=json')).json();assert.equal(json.content,body);
    if(name.endsWith('html')) {const frame=await request(A+'/'+entry.id+'?preview=1');assert.match(frame.headers.get('content-type'),/^text\/html/);assert.match(frame.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.match(frame.headers.get('content-security-policy'),/connect-src 'none'/);assert.equal(await frame.text(),body);}
    assert.equal((await request(B+'/'+entry.id+'?preview=1')).status,404);
    assert.equal((await request(A+'/'+entry.id+'?format=json',{},false)).status,401);
  }
  restart();const rows=(await (await request(A)).json()).entries;assert.equal(rows.length,4);assert.deepEqual(new Set(rows.map(x=>x.title)),new Set(saved.map(x=>x.title)));
  const other=await (await post(A+'?name=binary.pdf','application/octet-stream','binary')).json();assert.equal((await request(A+'/'+other.entry.id+'?preview=1')).status,415);
});

// New mutation/legacy cases use isolated loopback HTTP; 5s hard connection budget, not a unit timing claim.
test('content identity survives rename, concurrency, full capacity and restart; changed bytes and other departments remain distinct',{timeout:5000},async t=>{
 const {root,post,request,restart}=await fixture(t,{maxEntries:3,maxTotal:20});
 const body='same bytes';const [a,b]=await Promise.all(['a.txt','renamed.html'].map(name=>post(A+'?name='+name,'application/octet-stream',body)));
 assert.deepEqual([a.status,b.status].sort(),[200,201]);const one=await a.json(),two=await b.json();assert.equal(one.entry.id,two.entry.id);assert.equal((await (await request(A)).json()).entries.length,1);
 const file=path.join(root,A,one.entry.id,'entry.json');const legacy=JSON.parse(fs.readFileSync(file));delete legacy.sha256;fs.writeFileSync(file,JSON.stringify(legacy));restart();
 const old=await (await post(A+'?name=legacy-renamed.txt','application/octet-stream',body)).json();assert.equal(old.alreadySaved,true);assert.equal(old.entry.id,one.entry.id);
 const changed=await (await post(A+'?name=a.txt','application/octet-stream','other byte')).json();assert.notEqual(changed.entry.id,one.entry.id);
 const full=await post(A+'?name=again.txt','application/octet-stream',body);assert.equal(full.status,200);
 assert.equal((await post(B+'?name=same.txt','application/octet-stream',body)).status,507);
 assert.equal(fs.readFileSync(path.join(root,A,one.entry.id,'content'),'utf8'),body);
});
test('normalizes link identity without dropping query or fragment, preserves old duplicates and department isolation',{timeout:5000},async t=>{
 const {root,post,request,restart}=await fixture(t);
 const first=await (await post(A,'application/json',JSON.stringify({name:'Old title',url:'HTTPS://EXAMPLE.TEST:443/a/../?x=1#part'}))).json();
 const again=await (await post(A,'application/json',JSON.stringify({name:'New title',url:'https://example.test/?x=1#part'}))).json();assert.equal(again.alreadySaved,true);assert.equal(again.entry.id,first.entry.id);assert.equal(again.entry.name,'Old title');
 for(const url of ['https://example.test/?x=2#part','https://example.test/?x=1#other'])assert.equal((await post(A,'application/json',JSON.stringify({url}))).status,201);
 assert.equal((await post(B,'application/json',JSON.stringify({url:'https://example.test/?x=1#part'}))).status,201);
 const id='99999999-9999-4999-8999-999999999999';fs.mkdirSync(path.join(root,A,id));fs.writeFileSync(path.join(root,A,id,'entry.json'),JSON.stringify({...first.entry,id}));restart();
 assert.equal((await post(A,'application/json',JSON.stringify({url:first.entry.url}))).status,200);assert.equal((await (await request(A)).json()).entries.length,4);
});
test('deletes only the addressed archived copy, is idempotent, and keeps auth/Origin/controlled ID boundaries',{timeout:5000},async t=>{
 const {root,post,request,restart,origin}=await fixture(t);const {entry}=await (await post(A+'?name=original.txt','application/octet-stream','source bytes')).json();
 const source=path.join(root,'source.txt');fs.writeFileSync(source,'source bytes');
 const del=(scope,headers={origin})=>request(scope,{method:'DELETE',headers});
 assert.equal((await del(A+'/'+entry.id,{})).status,403);assert.equal((await del(A+'/'+entry.id,{origin:'https://evil.example'})).status,403);
 assert.equal((await request(A+'/'+entry.id,{method:'DELETE',headers:{origin}},false)).status,401);
 assert.equal((await del(A+'/%2e%2e%2fsource.txt')).status,404);assert.equal((await del(B+'/'+entry.id)).status,200);assert.equal((await request(A+'/'+entry.id)).status,200);
 const receipts=await Promise.all([del(A+'/'+entry.id),del(A+'/'+entry.id)]);assert.ok(receipts.every(r=>r.status===200));assert.equal(fs.existsSync(path.join(root,A,entry.id)),false);assert.equal((await request(A+'/'+entry.id)).status,404);assert.equal(fs.readFileSync(source,'utf8'),'source bytes');
 const readded=await (await post(A+'?name=new.txt','application/octet-stream','source bytes')).json();assert.equal(readded.alreadySaved,false);assert.notEqual(readded.entry.id,entry.id);
 const tomb=path.join(root,A,'.deleted-'+readded.entry.id);fs.renameSync(path.join(root,A,readded.entry.id),tomb);restart();assert.equal((await (await request(A)).json()).entries.length,0);assert.equal(fs.existsSync(tomb),false);
});
test('concurrent same-content save/delete follows a single department order without resurrecting deleted IDs',{timeout:5000},async t=>{
 const {post,request,origin,restart}=await fixture(t);const {entry}=await (await post(A+'?name=first.txt','application/octet-stream','x')).json();
 const [saved,deleted]=await Promise.all([post(A+'?name=second.txt','application/octet-stream','x'),request(A+'/'+entry.id,{method:'DELETE',headers:{origin}})]);assert.equal(deleted.status,200);const result=await saved.json();restart();const rows=(await (await request(A)).json()).entries;
 if(result.entry.id===entry.id)assert.equal(rows.length,0);else {assert.equal(rows.length,1);assert.equal(rows[0].id,result.entry.id);}
});

test("company library uses the same write boundary and a separate persistent collection", async t => {
  const { origin, request, post, restart } = await fixture(t, { companyEnabled: true });
  const route = origin + "/api/office/company-library";
  const headers = { "x-office-proxy-token": token, "content-type": "application/json" };
  const body = JSON.stringify({ name: "Shared slides", url: "https://example.test/slides?v=2" });
  const save = (from = origin, auth = true) => fetch(route, {
    method: "POST",
    headers: { ...(auth ? headers : { "content-type": "application/json" }), origin: from },
    body,
  });
  assert.equal((await save(origin, false)).status, 401);
  assert.equal((await save("https://foreign.example")).status, 403);
  const created = await save();
  assert.equal(created.status, 201);
  const { entry } = await created.json();
  assert.equal((await post(A, "application/json", body)).status, 201);
  assert.equal((await request("company")).status, 404);
  assert.equal((await request(A + "/" + entry.id, { method: "DELETE", headers: { origin } })).status, 200);
  restart();
  const rows = await (await fetch(route, { headers })).json();
  assert.deepEqual(rows.entries.map(item => item.id), [entry.id]);
  const duplicate = await save();
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).entry.id, entry.id);
  assert.equal((await fetch(route + "/" + entry.id, { method: "DELETE", headers: { ...headers, origin } })).status, 200);
  assert.equal((await (await request(A)).json()).entries.length, 1);
});
