// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
const {createGatewayClient}=createRequire(import.meta.url)("../../server/office-todo-mcp");
const {signIdentity}=createRequire(import.meta.url)("../../server/office-push-identity");
it("uses the real Gateway methods with fake native: explicit Head notify, signed browser detail and no inference",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"office-notify-gateway-")),native=path.join(root,"fake-native"),calls=path.join(root,"calls.jsonl"),secret="fixture-private-proxy-token-".repeat(2),owner="a".repeat(64);
 fs.writeFileSync(native,`#!/usr/bin/env node
const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const f=JSON.parse(line);if(f.id===undefined)return;fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify({method:f.method})+'\\n');const result=f.method==='account/read'?{account:{type:'chatgpt',planType:'pro'},requiresOpenaiAuth:true}:f.method==='thread/start'?{thread:{id:'fake-native-thread'}}:{};console.log(JSON.stringify({id:f.id,result}));}).on('close',()=>process.exit(0));`,{mode:0o700});
 let malformed=false;
 const auth=http.createServer((req,res)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify(malformed?{ok:true}:{owner,valid:req.headers["x-office-proxy-token"]===secret}));});auth.listen(0,"127.0.0.1");await once(auth,"listening");const authPort=(auth.address() as net.AddressInfo).port;
 const listener=net.createServer();listener.listen(0,"127.0.0.1");await once(listener,"listening");const port=(listener.address() as net.AddressInfo).port;await new Promise<void>(r=>listener.close(()=>r()));
 const token="fixture-gateway-token",gateway=spawn(process.execPath,[path.resolve("server/codex-office-gateway.js")],{env:{...process.env,HOME:root,NODE_ENV:"test",OPENAI_API_KEY:"",CODEX_API_KEY:"",CLAW3D_DATA_DIR:root,OPENCLAW_STATE_DIR:path.join(root,"studio"),CODEX_HOME:path.join(root,"source"),CLAW3D_CODEX_CONFIG_HOME:path.join(root,"source"),CLAW3D_OFFICE_DATA_DIR:path.join(root,"office"),CLAW3D_OFFICE_CODEX_HOME:path.join(root,"office/codex"),CLAW3D_GATEWAY_TOKEN:token,CLAW3D_PROXY_TOKEN:secret,CLAW3D_PUBLIC_ORIGINS:"https://office.example",CLAW3D_ACCESS_PORT:String(authPort),CLAW3D_CODEX_BIN:native,CODEX_ADAPTER_PORT:String(port),FIXTURE_CALLS:calls},stdio:["ignore","pipe","pipe"]});
 let errors="";gateway.stderr.on("data",b=>{errors+=b;});const exited=once(gateway,"exit"),client=createGatewayClient({address:`ws://127.0.0.1:${port}`,token});const sockets:WebSocket[]=[];
 try{
  const deadline=Date.now()+8000;let ready=false;while(!ready&&Date.now()<deadline){try{ready=(await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,20));}expect(ready,errors).toBe(true);
  const head=await client.call("session.create",{name:"Fixture Head",workspace:root,requestId:"fixture-head"});
  const threadId=head.threadId;expect(typeof threadId).toBe("string");
  const settings=path.join(root,"studio/claw3d/settings.json");fs.mkdirSync(path.dirname(settings),{recursive:true});fs.writeFileSync(settings,JSON.stringify({office:{[`ws://127.0.0.1:${port}`]:{organization:{[threadId]:{title:"Head",reportsTo:[]}}}}}));
  const event=await client.call("office.notify",{actorId:threadId,eventId:"ready",title:"Ready",brief:"Synthetic verified result",reason:"result"});expect(event.recorded).toBe(true);expect(event.devices).toBe(0);
  await expect(client.call("office.notifications.detail",{notificationId:event.notificationId})).rejects.toThrow(/Sign in/);
  const proof=signIdentity({owner,device:"11111111-1111-4111-8111-111111111111",origin:"https://office.example",port:authPort},secret);
  const ws=new WebSocket(`ws://127.0.0.1:${port}`,{headers:{"x-office-push-identity":proof}});sockets.push(ws);await once(ws,"open");
  let serial=0;const rpc=(method:string,params:unknown)=>new Promise<unknown>((resolve,reject)=>{const id=String(++serial),receive=(raw:Buffer)=>{const f=JSON.parse(String(raw));if(f.id!==id)return;ws.off("message",receive);if(f.ok)resolve(f.payload);else reject(Error(f.error.message));};ws.on("message",receive);ws.send(JSON.stringify({type:"req",id,method,params}));});
  await rpc("connect",{auth:{token}});expect(await rpc("office.notifications.detail",{notificationId:event.notificationId})).toMatchObject({headId:threadId,brief:"Synthetic verified result"});
  expect(await rpc("office.notifications.settings",{})).toMatchObject({enabled:false,publicKey:expect.any(String)});
  malformed=true;await expect(rpc("office.notifications.settings",{})).rejects.toThrow(/identity is unavailable/);
  const methods=fs.readFileSync(calls,"utf8").trim().split("\n").map(line=>JSON.parse(line).method);expect(methods).not.toContain("turn/start");expect(methods).not.toContain("thread/sample");expect(methods).not.toContain("thread/realtime/start");
 }finally{client.close();for(const ws of sockets)ws.terminate();gateway.kill("SIGTERM");await exited;auth.closeAllConnections();await new Promise<void>(r=>auth.close(()=>r()));fs.rmSync(root,{recursive:true,force:true});}
},15000);
