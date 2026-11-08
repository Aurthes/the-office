// @vitest-environment node
import {beforeEach, expect, it, vi} from "vitest";
import {gzipSync} from "node:zlib";
import {fillTableFields,FILL_DEFAULT_COLUMNS} from "@/lib/fill-probability/model";
import {fillQuote,fillRow} from "../fixtures/fill-probability";
const mocks=vi.hoisted(()=>({exec:vi.fn()}));
vi.mock("node:child_process",()=>({execFile:Object.assign(vi.fn(),{[Symbol.for("nodejs.util.promisify.custom")]:mocks.exec})}));
vi.mock("../../server/server-registry",()=>({loadServerRegistry:async()=>({hosts:[{alias:"prod-a",active:true,group:"online"}]}),sshTransportOptions:async()=>["-o","ControlMaster=auto"]}));
import {readFillSource,type FillSource,type FillSourceTiming} from "@/lib/fill-probability/source";
const source:FillSource={id:"primary",host:"prod-a",strategies:[{name:"maker",setting:"/srv/maker/setting.json",sourceSha:"a".repeat(40),feedbackVersion:8}]};
beforeEach(()=>mocks.exec.mockReset());
it("measures preparation, whole SSH stdout and decoding without copying remote extras",async()=>{
  const raw={version:1,rows:[fillRow()],timing:{remoteTotalMs:3,remoteRedisMs:1,remoteFileKvMs:1,remoteEmaDecodeMs:0,remoteQuoteDecodeMs:0,remoteRedisCalls:1,remoteFileKvAttempts:1,secret:"redis://private:password@host",remoteUnexpected:99}};
  const stdout=JSON.stringify(raw);mocks.exec.mockResolvedValueOnce({stdout});let timing:FillSourceTiming|undefined;
  expect(await readFillSource(source,t=>{timing=t;})).toEqual([fillRow()]);
  expect(timing).toMatchObject({stdoutBytes:Buffer.byteLength(stdout)});
  for(const k of ["totalMs","prepareMs","execMs","decodeMs"] as const)expect(timing![k]).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(timing)).not.toContain("secret");expect(JSON.stringify(timing)).not.toContain("password");
  const [command,args,options]=mocks.exec.mock.calls[0];expect(command).toBe("ssh");expect(args).toContain("prod-a");expect(args.at(-1)).not.toContain('"timing":true');expect(options).toMatchObject({timeout:12000,maxBuffer:4*1024*1024});
});
it("ignores remote extras and retains the original failed-read rejection",async()=>{
  mocks.exec.mockResolvedValueOnce({stdout:JSON.stringify({version:1,rows:[fillRow()],timing:{remoteTotalMs:-1,remoteRedisMs:120001,remoteFileKvMs:"private",remoteRedisCalls:null}})});
  let timing:FillSourceTiming|undefined;await readFillSource(source,t=>{timing=t;});expect(timing).not.toHaveProperty("remoteTotalMs");expect(timing).not.toHaveProperty("remoteRedisMs");expect(timing).not.toHaveProperty("remoteFileKvMs");
  mocks.exec.mockRejectedValueOnce(new Error("private failure"));await expect(readFillSource(source,t=>{timing=t;})).rejects.toThrow("private failure");expect(timing!.execMs).toBeGreaterThanOrEqual(0);expect(JSON.stringify(timing)).not.toContain("private");
});


it("receives binary gzip with distinct wire/decoded counters and preserves exact table facts",async()=>{
 const fields=fillTableFields(FILL_DEFAULT_COLUMNS),row=fillRow({quote:fillQuote()}),projection={row:[...new Set(["id","producer","strategy","instance","account","exchange","market","symbol","side",...fields.row])].sort(),quote:[...fields.quote].sort()};
 const partial={...Object.fromEntries(projection.row.map(k=>[k,row[k as keyof typeof row]])),quote:Object.fromEntries(projection.quote.map(k=>[k,row.quote![k]]))};const text=JSON.stringify({version:1,projection,rows:[partial]}),wire=gzipSync(text);mocks.exec.mockResolvedValueOnce({stdout:wire});let trace:FillSourceTiming|undefined;
 const parsed=await readFillSource(source,t=>{trace=t;},fields);expect(parsed[0].actualEma).toBe(row.actualEma);expect(parsed[0].quote!.currentCaProbability).toBe(row.quote!.currentCaProbability);expect(trace).toMatchObject({wireBytes:wire.length,stdoutBytes:Buffer.byteLength(text),decodedBytes:Buffer.byteLength(text)});expect(mocks.exec.mock.calls[0][2]).toMatchObject({encoding:"buffer",maxBuffer:2*1024*1024});
});
it("rejects corrupted, oversized and UTF8-misdecoded gzip without leaking transport data",async()=>{
 const fields=fillTableFields(FILL_DEFAULT_COLUMNS),broken=gzipSync("{}");broken[broken.length-1]^=1;
 for(const stdout of [broken,Buffer.alloc(2*1024*1024+1),gzipSync(Buffer.alloc(4*1024*1024+1)),"wrong UTF8 mode"]){mocks.exec.mockResolvedValueOnce({stdout});await expect(readFillSource(source,undefined,fields)).rejects.toThrow("Invalid fill source data");}
});
