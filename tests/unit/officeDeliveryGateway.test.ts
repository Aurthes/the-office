// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
const { createGatewayClient } = createRequire(import.meta.url)("../../server/office-todo-mcp");

const nativeFixture = `#!/usr/bin/env node
const fs=require('node:fs');if(process.argv.includes('--version')){console.log('codex-cli 0.166.0');process.exit(0);}let serial=0, active=null;const seen=[],history=[];function input(p){const item={id:'user-'+p.clientUserMessageId,type:'userMessage',clientId:p.clientUserMessageId,content:p.input};const row={threadId:p.threadId,turnId:active.id,item};seen.push(row);if(process.env.FIXTURE_ECHO!=='0')emit(row);}function emit(row){if(row.sent)return;row.sent=true;history.push({type:'item',turnId:row.turnId,item:row.item});event('item/completed',row);}process.on('SIGUSR2',()=>seen.forEach(emit));
fs.writeFileSync(process.env.FIXTURE_PID,String(process.pid));
function event(method,params){console.log(JSON.stringify({method,params}));}
process.on('SIGUSR1',()=>{if(active){event('turn/completed',{threadId:active.threadId,turn:{id:active.id,status:process.env.FIXTURE_END_STATUS||'completed'}});active=null;}});
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const f=JSON.parse(line);if(f.id===undefined)return;fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify({method:f.method,params:f.params})+'\\n');let result={};
 if(f.method==='account/read')result={account:{type:'chatgpt',planType:'pro'},requiresOpenaiAuth:true};
 if(f.method==='thread/start')result={thread:{id:'native-'+(++serial)}};
 if(f.method==='thread/turns/list')result={data:active?[{id:active.id,status:'inProgress'}]:[]};
 if(f.method==='thread/timeline/list')result={data:history,nextCursor:null};
 if(f.method==='turn/start'){active={threadId:f.params.threadId,id:'turn-'+(++serial)};event('turn/started',{threadId:active.threadId,turn:{id:active.id}});result={turn:{id:active.id}};input(f.params);}
 if(f.method==='turn/steer'){result={turnId:active.id};input(f.params);}
 console.log(JSON.stringify({id:f.id,result}));
}).on('close',()=>process.exit(0));`;

it("routes actual Gateway Agent input through the durable inbox while user input and urgent steering remain immediate", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-delivery-gateway-"));
  const native = path.join(root, "fake-native"), calls = path.join(root, "calls.jsonl"), pid = path.join(root, "native.pid");
  fs.writeFileSync(native, nativeFixture, { mode: 0o700 });
  const listener = net.createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = (listener.address() as net.AddressInfo).port; await new Promise<void>(resolve => listener.close(() => resolve()));
  const token = "synthetic-local-token", gateway = spawn(process.execPath, [path.resolve("server/codex-office-gateway.js")], { env: {
    ...process.env, HOME: root, NODE_ENV: "test", OPENAI_API_KEY: "", CODEX_API_KEY: "", CLAW3D_DATA_DIR: root,
    OPENCLAW_STATE_DIR: path.join(root, "studio"), CODEX_HOME: path.join(root, "source"), CLAW3D_CODEX_CONFIG_HOME: path.join(root, "source"),
    CLAW3D_OFFICE_DATA_DIR: path.join(root, "office"), CLAW3D_OFFICE_CODEX_HOME: path.join(root, "office/codex"),
    CLAW3D_GATEWAY_TOKEN: token, CLAW3D_CODEX_BIN: native, CODEX_ADAPTER_PORT: String(port), FIXTURE_CALLS: calls, FIXTURE_PID: pid,
  }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; gateway.stderr.on("data", data => { errors += data; });
  const exited = once(gateway, "exit"), client = createGatewayClient({ address: `ws://127.0.0.1:${port}`, token });
  const rows = () => fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  try {
    await vi.waitFor(async () => expect((await fetch(`http://127.0.0.1:${port}/health`)).ok, errors).toBe(true), { timeout: 8000 });
    const create = async (name: string) => (await client.call("session.create", { name, workspace: root, requestId: name })).threadId;
    const target = await create("Head"), a = await create("Contributor A"), b = await create("Contributor B");
    await client.call("session.send", { threadId: target, message: "user work", requestId: "user-first" });
    await client.call("session.send", { actorId: a, threadId: target, message: "result A", requestId: "mail-a" });
    await client.call("session.send", { actorId: b, threadId: target, message: "result B", requestId: "mail-b" });
    expect((await client.call("session.delivery", { actorId: target })).inbox.pending).toBe(2);
    expect(rows().filter(row => row.method === "turn/start")).toHaveLength(1);
    await expect(client.call("session.send", { actorId: a, threadId: target, message: "urgent", requestId: "bad-urgent", urgency: "urgent" })).rejects.toThrow(/urgentReason/);
    await client.call("session.send", { actorId: a, threadId: target, message: "change now", requestId: "urgent", urgency: "urgent", urgentReason: "Stop the incorrect action now" });
    await vi.waitFor(() => expect(rows().filter(row => row.method === "turn/steer")).toHaveLength(1));
    await client.call("session.send", { threadId: target, message: "user correction", requestId: "user-correction" });
    expect(rows().filter(row => row.method === "turn/steer")).toHaveLength(2);
    process.kill(Number(fs.readFileSync(pid, "utf8")), "SIGUSR1");
    await vi.waitFor(() => expect(rows().filter(row => row.method === "turn/start")).toHaveLength(2));
    const batch = rows().filter(row => row.method === "turn/start").at(-1);
    const body = JSON.stringify(batch.params.input);
    expect(body).toContain("From agent: Contributor A"); expect(body).toContain("result A");
    expect(body).toContain("From agent: Contributor B"); expect(body).toContain("result B");
    await vi.waitFor(async () => expect((await client.call("session.delivery", { actorId: target })).inbox.pending).toBe(0));
    expect(rows().some(row => ["thread/sample", "thread/realtime/start"].includes(row.method))).toBe(false);
  } finally {
    client.close(); gateway.kill("SIGTERM"); await exited; fs.rmSync(root, { recursive: true, force: true });
  }
}, 15000);
it('real Gateway preserves unconfirmed user payloads across restart, holds inbox/retry and dispatches only explicit stable recovery',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'user-journal-gateway-')),native=path.join(root,'fake-native'),calls=path.join(root,'calls.jsonl'),pid=path.join(root,'native.pid');fs.writeFileSync(native,nativeFixture,{mode:0o700});
 const rows=()=>fs.existsSync(calls)?fs.readFileSync(calls,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
 const launches:Array<{close:()=>Promise<void>}>=[];
 async function launch(){const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=(listener.address() as net.AddressInfo).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));const token='journal-fixture-token';const gateway=spawn(process.execPath,[path.resolve('server/codex-office-gateway.js')],{env:{...process.env,HOME:root,NODE_ENV:'test',OPENAI_API_KEY:'',CODEX_API_KEY:'',CLAW3D_DATA_DIR:root,OPENCLAW_STATE_DIR:path.join(root,'studio'),CODEX_HOME:path.join(root,'source'),CLAW3D_CODEX_CONFIG_HOME:path.join(root,'source'),CLAW3D_OFFICE_DATA_DIR:path.join(root,'office'),CLAW3D_OFFICE_CODEX_HOME:path.join(root,'office/codex'),CLAW3D_GATEWAY_TOKEN:token,CLAW3D_CODEX_BIN:native,CODEX_ADAPTER_PORT:String(port),FIXTURE_CALLS:calls,FIXTURE_PID:pid,FIXTURE_ECHO:'0',FIXTURE_END_STATUS:'interrupted'},stdio:['ignore','pipe','pipe']});let errors='';gateway.stderr.on('data',d=>{errors+=d;});gateway.stdout.resume();const exited=once(gateway,'exit'),client=createGatewayClient({address:`ws://127.0.0.1:${port}`,token});let closed=false;const handle={client,close:async()=>{if(closed)return;closed=true;client.close();gateway.kill('SIGTERM');await exited;}};launches.push(handle);await vi.waitFor(async()=>expect((await fetch(`http://127.0.0.1:${port}/health`)).ok,errors).toBe(true),{timeout:8000});return handle;}
 try{const first=await launch();const target=(await first.client.call('session.create',{name:'User target',workspace:root,requestId:'target'})).threadId,agent=(await first.client.call('session.create',{name:'Contributor',workspace:root,requestId:'contributor'})).threadId;
 await first.client.call('session.send',{threadId:target,message:'original body A',requestId:'input-a'});await expect(first.client.call('session.send',{threadId:target,message:'original body B',requestId:'input-b'})).rejects.toThrow(/not confirmed/);await first.client.call('session.send',{threadId:target,message:'original body B',requestId:'input-b',acknowledgeUnconfirmed:true});
 await first.client.call('session.send',{actorId:agent,threadId:target,message:'queued colleague',requestId:'mail'});expect((await first.client.call('session.delivery',{actorId:target})).inbox.pending).toBe(1);expect((await first.client.call('session.sends.list',{threadId:target})).items).toHaveLength(2);await expect(first.client.call('session.sends.read',{threadId:agent,requestId:'input-a'})).rejects.toThrow(/another session/);
 process.kill(Number(fs.readFileSync(pid,'utf8')),'SIGUSR1');await vi.waitFor(async()=>expect((await first.client.call('session.attach',{threadId:target})).turnStatus).toBe('interrupted'));expect((await first.client.call('session.attach',{threadId:target})).retryAt).toBeNull();await first.close();
 const second=await launch();const saved=await second.client.call('session.sends.list',{threadId:target});expect(saved.items.map((r:{id:string})=>r.id)).toEqual(['input-a','input-b']);expect((await second.client.call('session.sends.read',{threadId:target,requestId:'input-a'})).payload.message).toBe('original body A');await second.client.call('session.send',{threadId:target,message:'original body A',requestId:'input-a'});expect(rows().filter(r=>['turn/start','turn/steer'].includes(r.method))).toHaveLength(2);
 const request={threadId:target,originalId:'input-a',requestId:'recovered-a',confirmed:true};await second.client.call('session.sends.resend',request);await second.client.call('session.sends.resend',request);expect(rows().filter(r=>['turn/start','turn/steer'].includes(r.method))).toHaveLength(3);expect((await second.client.call('session.sends.read',{threadId:target,requestId:'recovered-a'})).payload.message).toBe('original body A');
 expect(rows().some(r=>['thread/sample','thread/realtime/start'].includes(r.method))).toBe(false);
 }finally{for(const h of launches.reverse())await h.close();fs.rmSync(root,{recursive:true,force:true});}
},20000);
