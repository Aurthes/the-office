import { createRequire } from "node:module";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { AgentStates } = require("../../server/agent-state");
const { readAgentNote, saveAgentNote } = require("../../server/agent-notes");
const id = "10000000-0000-4000-8000-000000000001", other = "20000000-0000-4000-8000-000000000002";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(x => fs.rmSync(x, { recursive: true, force: true })));
const content = () => ({ focus: "当前方向", decisions: "决定：保留身份，因为对话可替换", followUp: "等待独立验收；下一步由负责人决定", links: "T247 / evidence" });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-state-test-")); roots.push(root);
  const dir = path.join(root, "states");
  const agent = (key: string) => { if (![id, other].includes(key)) throw Error("Missing employee"); };
  return { root, dir, states: new AgentStates(dir, agent), agent };
}
it("persists exact bounded sections with CAS, restart and independent employee/Notes isolation", () => {
  const f = fixture(); expect(f.states.read(id)).toMatchObject({ id, revision: 0, updatedAt: null });
  expect(fs.existsSync(f.dir)).toBe(false);
  const notes = path.join(f.root, "user-notes"); saveAgentNote(id, { text: "User personal notes", revision: 0 }, notes);
  const saved = f.states.save(id, { revision: 0, sections: content() });
  expect(saved).toEqual({ id, revision: 1, updatedAt: expect.any(String), sections: content() });
  expect(new AgentStates(f.dir, f.agent).read(id)).toEqual(saved);
  expect(f.states.read(other).revision).toBe(0); expect(readAgentNote(id, notes).text).toBe("User personal notes");
  expect(() => f.states.save(id, { revision: 0, sections: { ...content(), focus: "overwrite" } })).toThrow(/changed/);
  expect(f.states.read(id)).toEqual(saved);
  expect(f.states.save(id, { revision: 1, sections: { focus: "", decisions: "", followUp: "", links: "" } }).revision).toBe(2);
  expect(fs.statSync(path.join(f.dir, id + ".json")).mode & 0o777).toBe(0o600);
  expect(fs.readdirSync(f.dir)).toEqual([id + ".json"]);
});
it.each([null, {}, { revision: -1, sections: content() }, { revision: 0, sections: { ...content(), evil: "x" } }, { revision: 0, sections: { ...content(), focus: "x".repeat(2401) } }, { revision: 0, sections: { focus: "x".repeat(2000), decisions: "x".repeat(2000), followUp: "x".repeat(2000), links: "a" } }, { revision: 0, sections: content(), path: "../../other" }])("rejects schema/size without saving (%j)", input => {
 const f=fixture();expect(()=>f.states.save(id,input)).toThrow();expect(fs.existsSync(f.dir)).toBe(false);
});
it("rejects paths, names, missing employees, corrupt state and symlinks without overwriting", () => {
 const f=fixture();for(const key of ["../../bad","worker4","30000000-0000-4000-8000-000000000003"])expect(()=>f.states.read(key)).toThrow();
 fs.mkdirSync(f.dir);fs.writeFileSync(path.join(f.dir,id+".json"),"not valid JSON");
 expect(()=>f.states.read(id)).toThrow(/could not be read/);expect(()=>f.states.save(id,{revision:0,sections:content()})).toThrow();
 fs.rmSync(path.join(f.dir,id+".json"));const outside=path.join(f.root,"outside");fs.writeFileSync(outside,"private");fs.symlinkSync(outside,path.join(f.dir,id+".json"));
 expect(()=>f.states.read(id)).toThrow(/unavailable/);expect(()=>f.states.save(id,{revision:0,sections:content()})).toThrow();expect(fs.readFileSync(outside,"utf8")).toBe("private");
 expect(f.states.context(id)).toMatchObject({id,status:"unavailable"});
});
it("retains CAS contention and does not clean another writer lock",()=>{
 const f=fixture();f.states.save(id,{revision:0,sections:content()});fs.writeFileSync(path.join(f.dir,id+".json.lock"),"");
 expect(()=>f.states.save(id,{revision:1,sections:content()})).toThrow(/changed/);expect(fs.existsSync(path.join(f.dir,id+".json.lock"))).toBe(true);expect(f.states.read(id).revision).toBe(1);
});

it("reads saved state after an actual isolated writer process exits",()=>{
 const f=fixture(),modulePath=path.resolve("server/agent-state.js");
 const script="const {AgentStates}=require(process.argv[1]);const s=new AgentStates(process.argv[2],()=>{});const id=process.argv[3];if(process.argv[4]==='write')s.save(id,{revision:0,sections:JSON.parse(process.argv[5])});else process.stdout.write(JSON.stringify(s.read(id)));";
 execFileSync(process.execPath,["-e",script,modulePath,f.dir,id,"write",JSON.stringify(content())],{encoding:"utf8"});
 const value=JSON.parse(execFileSync(process.execPath,["-e",script,modulePath,f.dir,id,"read"],{encoding:"utf8"}));
 expect(value).toMatchObject({id,revision:1,sections:content()});
});
