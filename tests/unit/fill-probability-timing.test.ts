// @vitest-environment node
import {beforeEach, expect, it, vi} from "vitest";
import {fillRow} from "../fixtures/fill-probability";
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
