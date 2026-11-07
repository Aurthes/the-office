// @vitest-environment node
import {expect,it} from "vitest";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {parseMarkoutRead} from "@/lib/maker-markout/source";
it("reads protected numeric sample fields and tag identities through the actual Python probe",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"maker-markout-probe-"));const requests:{q:string;db:string|null;auth:boolean}[]=[];
 const server=http.createServer((req,res)=>{const u=new URL(req.url!,"http://localhost");requests.push({q:u.searchParams.get("q")||"",db:u.searchParams.get("db"),auth:req.headers.authorization===`Basic ${Buffer.from("fixture:secret").toString("base64")}`});res.setHeader("Content-Type","application/json");res.end(JSON.stringify({results:[{series:[{tags:{strategy:"MMRPI",symbol:"bybit.perp.btc_usdt",side:"buy",tif:"rpi",run:"fixture"},columns:["time","count","sample_schema","sample_count","sample_overflow","sample_invalid","sample_00"],values:[[600001,1,1,1,0,0,-2.5]]}]},{series:[{tags:{strategy:"MMRPI",symbol:"bybit.perp.btc_usdt",side:"buy",tif:"rpi",run:"fixture"},columns:["time","missing","pending","settled"],values:[[600000,0,2,1]]}]}]}));});
 try{
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as {port:number}).port;
  const setting=path.join(root,"setting.json");await fs.writeFile(setting,JSON.stringify({system:{influx:{url:`http://127.0.0.1:${port}/write`,database:"fixture",username:"fixture",password:"secret"}}}));
  const request={strategies:[{name:"MMRPI",setting}],horizon:"60m",start:300000,end:3900000,until:4000000,bucketMs:300000};
  const {stdout}=await promisify(execFile)("python3",[path.resolve("server/maker-markout-probe.py"),JSON.stringify(request)]);const read=parseMarkoutRead(JSON.parse(stdout));
  expect(read.rows[0]).toMatchObject({strategy:"MMRPI",symbol:"bybit.perp.btc_usdt",tif:"rpi",fields:{sample_00:-2.5}});expect(read.quality[0].fields).toEqual({missing:0,pending:2,settled:1});expect(stdout).not.toContain("secret");expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({db:"fixture",auth:true});expect(requests[0].q).toContain('GROUP BY "strategy","symbol","side","tif","run"');expect(requests[0].q).toContain('"sample_63"');expect(requests[0].q).toContain('LIMIT 20001');
  const failed=await promisify(execFile)("python3",[path.resolve("server/maker-markout-probe.py"),JSON.stringify({...request,horizon:"2h"})]);expect(JSON.parse(failed.stdout)).toEqual({version:1,error:"source-unavailable",rows:[],quality:[]});
 }finally{await new Promise<void>(r=>server.close(()=>r()));await fs.rm(root,{recursive:true,force:true});}
});
