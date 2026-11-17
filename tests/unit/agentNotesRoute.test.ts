import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/office/agents/[id]/notes/route";
let root: string;
const id = "10000000-0000-4000-8000-000000000001", other = "20000000-0000-4000-8000-000000000002";
const context = (value = id) => ({ params: Promise.resolve({ id: value }) });
const req = (body: unknown = { text: " \n 中文 notes\t", revision: 0 }, origin = "http://127.0.0.1:3033") => new Request("http://127.0.0.1:3033/api/office/agents/"+id+"/notes", { method: "PUT", headers: { Host: "127.0.0.1:3033", Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-notes-test-")); vi.stubEnv("CLAW3D_AGENT_NOTES_DIR", root); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
it("saves exact text across devices/reloads and keeps agents isolated with CAS", async () => {
 const get = await GET(new Request("http://localhost"), context()); expect(await get.json()).toMatchObject({ note: { id, text: "", revision: 0 } });
 expect((await PUT(req(), context())).status).toBe(200);
 const loaded = await GET(new Request("http://localhost"), context()); expect(await loaded.json()).toMatchObject({ note: { text: " \n 中文 notes\t", revision: 1 } });
 expect((await PUT(req({text:"stale overwrite",revision:0}), context())).status).toBe(409);
 expect(await (await GET(new Request("http://localhost"), context(other))).json()).toMatchObject({ note: { id: other, text: "", revision: 0 } });
 expect(get.headers.get("cache-control")).toBe("no-store");
 expect(fs.statSync(path.join(root,id+".json")).mode & 0o777).toBe(0o600);
 expect(fs.readdirSync(root)).toEqual([id+".json"]);
});
it.each([null,{text:4,revision:0},{text:"x",revision:-1},{text:"x",revision:true},{text:"x",revision:0,path:"/tmp/bad"},{text:"x".repeat(64001),revision:0}])("rejects invalid payload without writing",async body=>{expect((await PUT(req(body),context())).status).toBe(400);expect(fs.readdirSync(root)).toEqual([]);});
it("rejects traversal, foreign origin, missing origin and wrong content type",async()=>{
 expect((await GET(new Request("http://localhost"),context("../../bad"))).status).toBe(400);
 expect((await PUT(req(undefined,"https://evil.example"),context())).status).toBe(403);
 const noOrigin=req();noOrigin.headers.delete("Origin");expect((await PUT(noOrigin,context())).status).toBe(403);
 const badType=req();badType.headers.set("Content-Type","text/plain");expect((await PUT(badType,context())).status).toBe(415);
 expect(fs.readdirSync(root)).toEqual([]);
});
it("bounds streamed requests, ignores client length claims and rejects corrupt saved data",async()=>{
 const huge=req({text:"x".repeat(512*1024),revision:0});expect((await PUT(huge,context())).status).toBe(413);
 fs.writeFileSync(path.join(root,id+".json"),"not json");expect((await GET(new Request("http://localhost"),context())).status).toBe(503);
});
