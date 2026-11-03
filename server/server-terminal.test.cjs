const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');
const { createServerTerminals } = require('./server-terminal');
const hosts = [{ alias: 'S13', group: 'offline', active: true }, { alias: 'S12', group: 'offline', active: false }];
async function fixture(t, overrides = {}) {
  const children = [], commands = [];
  const terminals = createServerTerminals({ verifyClient: info => info.req.headers['x-test-auth'] === 'ok', registry: async () => ({ hosts }), transportOptions: async () => ['-o', 'ControlMaster=auto'],
    spawnPty: (command, args) => {
      commands.push([command, ...args]);
      const child = new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',0);
      child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('close',0)));children.push(child);return child;
    }, ...overrides });
  const server = http.createServer();server.on('upgrade', (req,socket,head)=>void terminals.handleUpgrade(req,socket,head));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{terminals.close();await new Promise(r=>server.close(r));});
  return { children, commands, url: 'ws://127.0.0.1:'+server.address().port+'/api/gateway/ws' };
}
async function connect(url, auth='ok') {const ws=new WebSocket(url,{headers:{'x-test-auth':auth}});await once(ws,'open');return ws;}
let sequence=0;
function call(ws, method, params) {const id=String(++sequence);return new Promise((resolve,reject)=>{const listener=raw=>{const frame=JSON.parse(String(raw));if(frame.id!==id)return;ws.off('message',listener);frame.ok?resolve(frame.payload):reject(new Error(frame.error));};ws.on('message',listener);ws.send(JSON.stringify({id,method,params}));});}
async function denied(url, auth='ok') {const ws=new WebSocket(url,{headers:{'x-test-auth':auth}});return new Promise(resolve=>{ws.on('error',e=>resolve(e.message));});}

test('rejects unauthenticated, unknown, disabled and injected host aliases before spawning a shell', async t=>{
 const f=await fixture(t);
 for(const [alias,auth] of [['S13','bad'],['S12','ok'],['unknown','ok'],['S13; touch /tmp/injected','ok']]) assert.match(await denied(f.url+'?terminalHost='+encodeURIComponent(alias),auth),/403|404/);
 assert.equal(f.commands.length,0);
});
test('opens exactly the selected allowlisted host, deduplicates start, streams bytes and validates handles and sizes', async t=>{
 const f=await fixture(t),ws=await connect(f.url+'?terminalHost=S13');t.after(()=>ws.close());
 const [a,b]=await Promise.all([call(ws,'session.terminal.subscribe',{threadId:'S13'}),call(ws,'session.terminal.start',{threadId:'S13'})]);assert.equal(a.handle,b.handle);assert.equal(f.commands.length,1);assert.equal(f.commands[0].at(-1),'S13');assert(f.commands[0].includes('-tt'));
 await assert.rejects(call(ws,'session.terminal.write',{threadId:'S12',handle:a.handle,dataBase64:'YQ=='}),/Invalid/);
 await assert.rejects(call(ws,'session.terminal.write',{threadId:'S13',handle:'wrong',dataBase64:'YQ=='}),/ended/);
 await assert.rejects(call(ws,'session.terminal.resize',{threadId:'S13',handle:a.handle,cols:10000,rows:24}),/size/);
 await assert.rejects(call(ws,'session.terminal.write',{threadId:'S13',handle:a.handle,dataBase64:'!bad'}),/input/);
 const event=once(ws,'message');f.children[0].stdout.write(JSON.stringify({dataBase64:Buffer.from('hello\r\n').toString('base64')})+'\n');const [raw]=await event;const frame=JSON.parse(String(raw));assert.equal(frame.event,'session.terminal');assert.equal(Buffer.from(frame.payload.dataBase64,'base64').toString(),'hello\r\n');assert.equal(frame.payload.offset,7);
 await call(ws,'session.terminal.stop',{threadId:'S13',handle:a.handle});ws.close();await once(ws,'close');
});
test('enforces the shared terminal limit and releases only connection-owned shells', async t=>{
 const f=await fixture(t),clients=[];t.after(()=>clients.forEach(ws=>ws.close()));
 for(let i=0;i<8;i++){const ws=await connect(f.url+'?terminalHost=S13');clients.push(ws);await call(ws,'session.terminal.subscribe',{threadId:'S13'});}
 const ninth=await connect(f.url+'?terminalHost=S13');clients.push(ninth);await assert.rejects(call(ninth,'session.terminal.subscribe',{threadId:'S13'}),/Too many/);
 clients[0].close();await once(clients[0],'close');await new Promise(r=>setTimeout(r,30));await call(ninth,'session.terminal.subscribe',{threadId:'S13'});assert.equal(f.commands.length,9);
});
test('the real disposable PTY supports interactive input, resize and exits without a shell process left behind', {timeout:10000}, async()=>{
 const child=spawn('python3',[path.join(__dirname,'server-terminal-pty.py'),'/bin/sh','-l'],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',chunk=>{for(const line of String(chunk).trim().split('\n')){try{const f=JSON.parse(line);if(f.dataBase64)output+=Buffer.from(f.dataBase64,'base64').toString();}catch{}}});
 child.stdin.write(JSON.stringify({type:'resize',cols:101,rows:31})+'\n');child.stdin.write(JSON.stringify({type:'write',dataBase64:Buffer.from("printf 'PTY_CHECK_OK\\n'; stty size; exit\n").toString('base64')})+'\n');const [code]=await once(child,'close');assert.equal(code,0);assert.match(output,/PTY_CHECK_OK/);assert.match(output,/31 101/);
});
