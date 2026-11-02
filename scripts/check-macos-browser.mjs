#!/usr/bin/env node
// Real packaged runtime and browser; only the model and initial folder are fixtures.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const source=fileURLToPath(new URL("..",import.meta.url));
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const application=path.resolve(option("--app")||path.join(source,"dist-macos/The Office.app"));
const resources=path.join(application,"Contents/Resources"),office=path.join(resources,"office"),node=path.join(resources,"node/bin/node");
if(fs.realpathSync(process.execPath)!==fs.realpathSync(node)){
 const result=spawnSync(node,[fileURLToPath(import.meta.url),...args],{env:{...process.env,PATH:"/usr/bin:/bin:/usr/sbin:/sbin"},stdio:"inherit"});
 if(result.error)throw result.error;
 process.exit(result.status??1);
}
const {LocalOffice}=createRequire(path.join(office,"package.json"))("./desktop/launcher.cjs");
const {chromium,webkit}=createRequire(path.join(source,"package.json"))("@playwright/test");
const browserName=option("--browser")||"chromium";
if(!["chromium","chrome","webkit"].includes(browserName))throw new Error("Choose --browser chromium, chrome or webkit");
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'office-mac-browser-')),data=path.join(root,'data'),foreign=path.join(root,'foreign'),workspace=path.join(root,'workspace');
 for(const dir of [foreign,workspace])fs.mkdirSync(dir);
 let local,browser,page;let requests=0;const errors=[];
 const provider=http.createServer((req,res)=>{let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{
  JSON.parse(raw);requests++;res.writeHead(200,{'content-type':'text/event-stream'});
  const id='response-'+requests,emit=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
  emit({type:'response.created',response:{id}});
  const item={id:'message-'+requests,type:'message',role:'assistant',content:[{type:'output_text',text:'OFFICE_MAC_PACKAGE_REPLY_OK'}]};
  emit({type:'response.output_item.done',output_index:0,item});emit({type:'response.completed',response:{id,output:[item],usage:{input_tokens:8,output_tokens:3,total_tokens:11}}});res.end();
 })});
 try{
  local=new LocalOffice({appDirectory:office,dataDirectory:data,environment:{PATH:'/usr/bin:/bin',CODEX_HOME:foreign}});
  const url=await local.start();
  // Use the desktop Chromium binary and its normal graphics backend, like real Mac users.
  // Forcing SwiftShader makes the animated scene saturate CI CPUs and stalls input.
  browser=await (browserName==='webkit'?webkit:chromium).launch({headless:true,...(browserName==='webkit'?{}:{channel:browserName==='chrome'?'chrome':'chromium'})});
  console.log(JSON.stringify({browser:browserName,version:browser.version()}));
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const origin=new URL(url).origin;
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  // Use the disposable folder as the file picker's initial location. All folder,
  // creation, settings, streaming and history calls go to the real bundled engine.
  await context.routeWebSocket('**/api/gateway/ws',ws=>{const server=ws.connectToServer();ws.onMessage(message=>{let frame;try{frame=JSON.parse(String(message))}catch{return server.send(message)}if(frame.method==='project.folders.list'&&!frame.params?.path)frame.params={...frame.params,path:workspace};server.send(JSON.stringify(frame))})});
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  if(browserName!=='webkit'){
   const diagnostics=await browser.newBrowserCDPSession();
   const {gpu}=await diagnostics.send('SystemInfo.getInfo');
   console.log(JSON.stringify({graphics:gpu.auxAttributes?.glRenderer,features:gpu.featureStatus}));
   await diagnostics.detach();
  }
  await page.getByRole('button',{name:'Sign in with ChatGPT',exact:true}).waitFor({timeout:30000});
  const welcome=page.getByRole('dialog',{name:'Welcome to The Office',exact:true});
  if(/OpenClaw|gateway token|Node.js/.test(await welcome.textContent()))throw Error('Legacy setup leaked into Office onboarding');
  console.log(JSON.stringify({freshAccountLogin:true,noManualGatewaySetup:true}));
  if(errors.length)throw Error(errors.join('\n'));
  page.removeAllListeners('pageerror');await page.close();
  await local.close();
  provider.listen(0,'127.0.0.1');await once(provider,'listening');
  fs.writeFileSync(path.join(data,'runtime/codex/config.toml'),'model="gpt-6.1-sol"\nmodel_provider="office_check"\n[model_providers.office_check]\nname="Local fixture"\nbase_url="http://127.0.0.1:'+provider.address().port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n');
  local=new LocalOffice({appDirectory:office,dataDirectory:data,environment:{PATH:'/usr/bin:/bin',CODEX_HOME:foreign}});await local.start();
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'+ Recruit agent',exact:true}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'+ Recruit agent',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Mac verification recruit');
  await page.getByRole('button',{name:'Choose folder',exact:true}).click();
  await page.getByRole('button',{name:'Use this folder',exact:true}).click();
  await page.getByRole('button',{name:'Recruit and create session',exact:true}).click();
  await page.getByLabel('Send to session',{exact:true}).waitFor({timeout:20000});
  await page.getByLabel('Send to session',{exact:true}).fill('Say hello for the disposable package check.');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('OFFICE_MAC_PACKAGE_REPLY_OK',{exact:true}).first().waitFor({timeout:30000});
  const state=JSON.parse(fs.readFileSync(path.join(data,'runtime/office.json')));
  if(state.sessions.length!==1||state.sessions[0].workspace!==fs.realpathSync(workspace))throw Error('Recruitment did not save its working folder');
  const settingsFile=path.join(data,'state/claw3d/settings.json'),settings=JSON.parse(fs.readFileSync(settingsFile));
  const profiles=Object.values(settings.avatars||{}).flatMap(gateway=>Object.values(gateway));const profile=profiles.find(p=>p.duck);
  if(!profile?.duck)throw Error('New recruit style was not persisted');
  const saved=JSON.stringify(profile.duck);
  await page.locator('summary[aria-label="Session information"]').click();await page.getByRole('button',{name:'Edit character',exact:true}).click();
  await page.getByRole('tab',{name:'Wings',exact:true}).click();await page.getByRole('button',{name:'Layered feathers',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Back to chat',exact:true}).click();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Open session: Mac verification recruit',exact:true}).first().waitFor({timeout:30000});
  await page.getByRole('button',{name:'Open session: Mac verification recruit',exact:true}).first().click();
  await page.getByText('OFFICE_MAC_PACKAGE_REPLY_OK',{exact:true}).first().waitFor({timeout:20000});
  const again=JSON.parse(fs.readFileSync(settingsFile));const reloaded=Object.values(again.avatars).flatMap(g=>Object.values(g)).find(p=>p.duck);
  if(JSON.stringify(reloaded.duck)!==saved)throw Error('Reload or canceled edit changed saved recruit style');
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify({browser:browserName,browserRecruitment:true,workingFolder:true,randomStyleSaved:true,realBundledCodexReply:true,historyAfterReload:true,canceledEditPreserved:true,paidEndpoints:false,modelRequests:requests,pageErrors:0}));
 }catch(error){console.error(error.stack);console.error(JSON.stringify({browser:browserName,pageErrors:errors,visiblePage:page?await page.locator('body').innerText().catch(()=>'(unavailable)'):null}));process.exitCode=1}
 finally{await browser?.close();await local?.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
})();
