const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');
const {LocalOffice,desktopEnvironment}=require('./launcher.cjs');
const fixtures=[];
function fixture(gatewayFailure=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'office-desktop-test-')),app=path.join(root,'application'),data=path.join(root,'data'),foreign=path.join(root,'foreign');
 for(const name of ['.next','server','public','node_modules'])fs.mkdirSync(path.join(app,name),{recursive:true});
 fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'sentinel'),'untouched');
 fs.writeFileSync(path.join(app,'.next/BUILD_ID'),'fixture-build');fs.writeFileSync(path.join(app,'package.json'),'{}');fs.writeFileSync(path.join(app,'next.config.js'),'module.exports={}');
 const server=`const http=require('node:http');const port=process.env.ROLE==='gateway'?process.env.CODEX_ADAPTER_PORT:process.env.PORT;const s=http.createServer((q,r)=>{r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify({ok:true,runtime:'Office-owned Codex'}))});s.listen(port,'127.0.0.1');process.on('SIGTERM',()=>s.close());`;
 fs.writeFileSync(path.join(app,'server/codex-office-gateway.js'),gatewayFailure?'process.exit(2)':`process.env.ROLE='gateway';${server}`);
 fs.writeFileSync(path.join(app,'server/index.js'),server);
 const office=new LocalOffice({appDirectory:app,dataDirectory:data,environment:{PATH:'/usr/bin:/bin',CODEX_HOME:foreign},timeout:3000});
 const f={root,app,data,foreign,office};fixtures.push(f);return f;
}
afterEach(async()=>{for(const f of fixtures.splice(0)){await f.office.close();fs.rmSync(f.root,{recursive:true,force:true})}});
test('starts both local services with no user configuration, preserves resources and closes only its children',async()=>{
 const f=fixture();const filesBefore=fs.readdirSync(f.app);const url=await f.office.start();
 assert.equal((await fetch(url)).status,200);assert.equal(f.office.children.length,2);
 const settings=JSON.parse(fs.readFileSync(path.join(f.data,'state/claw3d/settings.json')));
 assert.equal(settings.gateway.token.length,64);assert.equal(settings.gateway.url,settings.gateway.lastKnownGood.url);
 assert.equal(fs.statSync(path.join(f.data,'desktop.json')).mode&0o777,0o600);
 assert.deepEqual(fs.readdirSync(f.app),filesBefore);assert.equal(fs.readFileSync(path.join(f.foreign,'sentinel'),'utf8'),'untouched');
 const children=[...f.office.children];await f.office.close();assert(children.every(child=>child.exitCode!==null||child.signalCode));
 assert(!fs.existsSync(path.join(f.data,'desktop.lock')));
});
test('keeps ports, token and existing character settings across reopening',async()=>{
 const f=fixture();const first=await f.office.start();const original=fs.readFileSync(path.join(f.data,'desktop.json'),'utf8');
 const file=path.join(f.data,'state/claw3d/settings.json'),saved=JSON.parse(fs.readFileSync(file));saved.avatars={keep:'appearance'};fs.writeFileSync(file,JSON.stringify(saved));
 await f.office.close();f.office=new LocalOffice({appDirectory:f.app,dataDirectory:f.data,environment:{CODEX_HOME:f.foreign},timeout:3000});
 assert.equal(await f.office.start(),first);assert.equal(fs.readFileSync(path.join(f.data,'desktop.json'),'utf8'),original);assert.deepEqual(JSON.parse(fs.readFileSync(file)).avatars,{keep:'appearance'});
});
test('does not replace or stop an already running Office instance',async()=>{
 const f=fixture();await f.office.start();const duplicate=new LocalOffice({appDirectory:f.app,dataDirectory:f.data,environment:{CODEX_HOME:f.foreign}});
 await assert.rejects(duplicate.start(),/already running/);await duplicate.close();assert.equal((await fetch(f.office.url)).status,200);
});
test('cleans up a failed start without starting the frontend or modifying foreign state',async()=>{
 const f=fixture(true);await assert.rejects(f.office.start(),/could not start/);assert.equal(f.office.children.length,1);assert(!fs.existsSync(path.join(f.data,'desktop.lock')));assert.equal(fs.readFileSync(path.join(f.foreign,'sentinel'),'utf8'),'untouched');
});
test('preserves malformed private configuration without printing or replacing its content',async()=>{
 const f=fixture();fs.mkdirSync(f.data);const file=path.join(f.data,'desktop.json');fs.writeFileSync(file,'{"token":"private-test-secret",broken');
 try{await f.office.start();assert.fail('expected failure')}catch(error){assert(!error.message.includes('private-test-secret'));assert.match(error.message,/preserved/)}
 assert.equal(fs.readFileSync(file,'utf8'),'{"token":"private-test-secret",broken');
});
test('refuses an existing Codex configuration directory before writing anything into it',async()=>{
 const f=fixture();f.office=new LocalOffice({appDirectory:f.app,dataDirectory:f.foreign,environment:{CODEX_HOME:f.foreign}});
 await assert.rejects(f.office.start(),/separate/);assert.deepEqual(fs.readdirSync(f.foreign),['sentinel']);
});
test('reports a saved port conflict rather than disconnecting another service',async()=>{
 const f=fixture();await f.office.start();await f.office.close();const config=JSON.parse(fs.readFileSync(path.join(f.data,'desktop.json')));
 const other=net.createServer();await new Promise(resolve=>other.listen(config.gatewayPort,'127.0.0.1',resolve));
 try{f.office=new LocalOffice({appDirectory:f.app,dataDirectory:f.data,environment:{CODEX_HOME:f.foreign}});await assert.rejects(f.office.start(),/in use/);assert(other.listening)}finally{await new Promise(resolve=>other.close(resolve))}
});
test('does not inherit a personal deployment, API key, native executable or public listener',()=>{
 const env=desktopEnvironment({PATH:'/bin',CLAW3D_CODEX_BIN:'/native/App',CLAW3D_PROXY_TOKEN:'private',CLAW3D_GATEWAY_URL:'ws://foreign',CLAW3D_ACCOUNT_MONITOR_URL:'http://private',OPENAI_API_KEY:'private',NODE_OPTIONS:'--require bad',HOST:'0.0.0.0'},'/office',{token:'a'.repeat(64),gatewayPort:12345,studioPort:12346});
 assert.equal(env.CLAW3D_CODEX_BIN,undefined);assert.equal(env.CLAW3D_PROXY_TOKEN,undefined);assert.equal(env.CLAW3D_ACCOUNT_MONITOR_URL,undefined);assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.HOST,'127.0.0.1');assert.equal(env.UPSTREAM_ALLOWLIST,'127.0.0.1');assert.equal(env.NEXT_PUBLIC_CLAW3D_WEB_ACCESS,'0');assert.equal(env.CLAW3D_GATEWAY_URL,'ws://127.0.0.1:12345');
});
test('the command-line owner closes its services when its native wrapper disappears',async()=>{
 const {spawn}=require('node:child_process');const {once}=require('node:events');const f=fixture();
 const child=spawn(process.execPath,[path.join(__dirname,'launcher.cjs'),'--app-dir',f.app,'--data-dir',f.data,'--parent-pid','2147483647'],{env:{PATH:'/usr/bin:/bin',CODEX_HOME:f.foreign},stdio:['ignore','pipe','pipe']});
 let output='',timedOut=false;child.stdout.on('data',chunk=>output+=chunk);
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM')},5000);
 try{const [code]=await once(child,'exit');assert.equal(timedOut,false);assert.equal(code,0);assert(output.includes('"phase":"ready"'));assert(!fs.existsSync(path.join(f.data,'desktop.lock')))}finally{clearTimeout(timer);if(child.exitCode===null&&!child.signalCode){child.kill('SIGTERM');await once(child,'exit')}}
});
