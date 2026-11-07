// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/office/teasers/[id]/whiteboard/route";
import { postTeaser } from "../../server/teaser-board";

let root: string, directory: string, id: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "teaser-whiteboard-route-")); directory = path.join(root, "questions");
  vi.stubEnv("CLAW3D_TEASER_DIR", directory); vi.stubEnv("CLAW3D_PUBLIC_ORIGINS", "https://office.example");
  id = postTeaser({ title: "Fixture", prompt: "Synthetic", author: "fixture", answer: "HIDDEN ANSWER", summary: "HIDDEN IDEA" }, directory).id;
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const context = (value = id) => ({ params: Promise.resolve({ id: value }) });
const request = (body = JSON.stringify({ text: "\n Note \t", revision: 0 }), extra: Record<string, string> = {}) => new Request(`http://127.0.0.1:3033/api/office/teasers/${id}/whiteboard`, {
  method: "PUT", headers: { Host: "office.example", Origin: "https://office.example", "Content-Type": "application/json", ...extra }, body,
});
const noNotes = () => expect(fs.existsSync(`${directory}-whiteboards`)).toBe(false);

it("serves and saves only note fields with no-store and independent revision conflicts", async () => {
  const before = fs.readFileSync(path.join(directory, `${id}.json`));
  const get = await GET(new Request("http://localhost"), context());
  expect(await get.json()).toEqual({ whiteboard: { id, text: "", revision: 0, updatedAt: null } }); noNotes();
  const put = await PUT(request(), context()); expect(put.status).toBe(200);
  expect(await put.json()).toMatchObject({ whiteboard: { id, text: "\n Note \t", revision: 1 } });
  const stale = await PUT(request(), context()); expect(stale.status).toBe(409);
  expect(fs.readFileSync(path.join(directory, `${id}.json`))).toEqual(before);
  for (const response of [get, put, stale]) expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each(["", "null", "https://evil.example", "https://office.example/", "https://office.example/path", "https://user@office.example", "http://office.example"])("rejects noncanonical/untrusted Origin %s with no write", async origin => {
  const req = request(); if (origin) req.headers.set("Origin", origin); else req.headers.delete("Origin");
  expect((await PUT(req, context())).status).toBe(403); noNotes();
});

it("rejects mismatched Host and untrusted matching Host/Origin, but keeps exact loopback development usable", async () => {
  expect((await PUT(request(undefined, { Host: "evil.example" }), context())).status).toBe(403);
  expect((await PUT(request(undefined, { Host: "evil.example", Origin: "https://evil.example" }), context())).status).toBe(403); noNotes();
  const local = request(undefined, { Host: "127.0.0.1:3033", Origin: "http://127.0.0.1:3033" });
  expect((await PUT(local, context())).status).toBe(200);
});

it.each(["text/plain", "application/x-www-form-urlencoded", "application/jsonp", ""])("rejects non-JSON Content-Type %s with no write", async type => {
  const req = request(); if (type) req.headers.set("Content-Type", type); else req.headers.delete("Content-Type");
  expect((await PUT(req, context())).status).toBe(415); noNotes();
});

it("bounds the stream even with a false Content-Length and cancels excess bytes", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(16384).fill(97)); }, cancel });
  const req = new Request("http://127.0.0.1:3033/api", { method: "PUT", headers: { Host: "office.example", Origin: "https://office.example", "Content-Type": "application/json", "Content-Length": "1" }, body: stream, duplex: "half" } as RequestInit & { duplex: string });
  expect((await PUT(req, context())).status).toBe(413); expect(cancel).toHaveBeenCalledOnce(); noNotes();
});

it("rejects declared oversize, malformed JSON, excessive text, unknown fields and invalid IDs without writes", async () => {
  expect((await PUT(request(undefined, { "Content-Length": "98305" }), context())).status).toBe(413);
  expect((await PUT(request("{"), context())).status).toBe(400);
  expect((await PUT(request(JSON.stringify({ text: "x".repeat(12001), revision: 0 })), context())).status).toBe(400);
  expect((await PUT(request(JSON.stringify({ text: "x", revision: 0, answer: "not allowed" })), context())).status).toBe(400);
  expect((await PUT(request(), context("../escape"))).status).toBe(400);
  expect((await GET(new Request("http://localhost"), context("../escape"))).status).toBe(400); noNotes();
});

it("returns safe failures without filesystem paths and never reveals unfinished solutions", async () => {
  const missing = await GET(new Request("http://localhost"), context("00000000-0000-4000-8000-000000000000")); expect(missing.status).toBe(404);
  fs.mkdirSync(`${directory}-whiteboards`); fs.writeFileSync(path.join(`${directory}-whiteboards`, `${id}.json`), "broken");
  const failure = await GET(new Request("http://localhost"), context()); expect(failure.status).toBe(503);
  const text = await failure.text(); expect(text).not.toContain(root); expect(text).not.toMatch(/HIDDEN ANSWER|HIDDEN IDEA/);
  expect(failure.headers.get("cache-control")).toBe("no-store");
});
