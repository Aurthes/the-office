#!/usr/bin/env node
// Real runtime and browser; model, initial folder and unconnected optional music are fixtures.
import fs from "node:fs";
import { checkOfficeTasks } from "./check-office-tasks.mjs";
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
const {chromium,webkit,expect}=createRequire(path.join(source,"package.json"))("@playwright/test");
const {WebSocket}=createRequire(path.join(source,"package.json"))("ws");
const browserName=option("--browser")||"chromium";
if(!["chromium","chrome","webkit"].includes(browserName))throw new Error("Choose --browser chromium, chrome or webkit");
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'office-mac-browser-')),data=path.join(root,'data'),foreign=path.join(root,'foreign'),workspace=path.join(root,'workspace');
 for(const dir of [foreign,workspace])fs.mkdirSync(dir);
 let local,browser,page,finishReply,liveSocket,lastStream,rosterSocket,attentionFixture;let requests=0,snapshotResponses=0,modelFixture=null;const errors=[],snapshotRequests=new Set();
 const provider=http.createServer((req,res)=>{let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{
  const payload=JSON.parse(raw);requests++;if(modelFixture)return void modelFixture(payload,res,requests);res.writeHead(200,{'content-type':'text/event-stream'});
  const id='response-'+requests,emit=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
  emit({type:'response.created',response:{id}});
  const item={id:'message-'+requests,type:'message',role:'assistant',content:[{type:'output_text',text:'OFFICE_MAC_PACKAGE_REPLY_OK'}]};
  finishReply=()=>{emit({type:'response.output_item.done',output_index:0,item});emit({type:'response.completed',response:{id,output:[item],usage:{input_tokens:8,output_tokens:3,total_tokens:11}}});res.end()};
 })});
 try{
  local=new LocalOffice({appDirectory:office,dataDirectory:data,environment:{PATH:'/usr/bin:/bin',CODEX_HOME:foreign}});
  const url=await local.start();
  // Use the desktop Chromium binary and its normal graphics backend, like real Mac users.
  // Forcing SwiftShader makes the animated scene saturate CI CPUs and stalls input.
  browser=await (browserName==='webkit'?webkit:chromium).launch({headless:true,...(browserName==='webkit'?{}:{channel:browserName==='chrome'?'chrome':'chromium'})});
  console.log(JSON.stringify({browser:browserName,version:browser.version()}));
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  // Silent PCM exercises the real browser audio engine without private assets.
  const wav=Buffer.alloc(44+1600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40);
  await context.addInitScript(()=>{const Engine=window.AudioContext||window.webkitAudioContext;if(!Engine)return;const original=Engine.prototype.createBufferSource;Engine.prototype.createBufferSource=function(...args){const source=original.apply(this,args),start=source.start.bind(source);source.start=(...values)=>{window.__officeDuckStarts=(window.__officeDuckStarts||0)+1;return start(...values)};return source}});
  const origin=new URL(url).origin;
  await context.addInitScript(()=>document.addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest('button'):null;if(target)console.info('OFFICE_CHECK_CLICK '+target.textContent?.trim());},true));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.route('**/api/office/character-audio',route=>route.fulfill({json:{clips:[{id:'silent-browser-fixture',base64:wav.toString('base64')}]}}));
  // A fresh user has no music account. Do not read the test host's music credentials.
  await context.route('**/api/music/netease**',route=>{
   const action=new URL(route.request().url()).searchParams.get('action');
   return route.fulfill({status:action?503:200,json:action?{error:'Music is not configured in this clean-user fixture.',code:'SETUP_REQUIRED'}:{configured:false,authorized:false}});
  });
  // Use the disposable folder as the file picker's initial location. All folder,
  // creation, settings, streaming and history calls go to the real bundled engine.
  await context.routeWebSocket('**/api/gateway/ws',ws=>{const server=ws.connectToServer();ws.onMessage(message=>{let frame;try{frame=JSON.parse(String(message))}catch{return server.send(message)}if(frame.method==='project.folders.list'&&!frame.params?.path)frame.params={...frame.params,path:workspace};if(frame.method==='office.snapshot')snapshotRequests.add(frame.id);server.send(JSON.stringify(frame))});server.onMessage(message=>{const frame=JSON.parse(String(message));if(frame.event==='session.stream'){liveSocket=ws;lastStream=frame.payload}if(snapshotRequests.delete(frame.id)&&frame.ok){snapshotResponses++;if(attentionFixture)frame.payload.agents=frame.payload.agents.map(agent=>agent.id===attentionFixture.id?{...agent,...attentionFixture}:agent)}ws.send(JSON.stringify(frame))})});
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.text().startsWith('OFFICE_CHECK_CLICK '))console.log(message.text());});
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
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.text().startsWith('OFFICE_CHECK_CLICK '))console.log(message.text());});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'+ Recruit agent',exact:true}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'+ Recruit agent',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Mac verification recruit');
  await page.getByRole('button',{name:'Choose a working folder',exact:true}).click();
  await page.getByRole('button',{name:'Use this folder',exact:true}).click();
  await page.getByRole('button',{name:'Recruit and create session',exact:true}).click();
  await page.getByLabel('Send to session',{exact:true}).waitFor({timeout:20000});
  await expect(page.locator('#session-chat-list')).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Organize agents',exact:true})).toHaveValue('activity');
  await page.getByLabel('Send to session',{exact:true}).fill('Say hello for the disposable package check.');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const timer=page.getByRole('timer');await timer.waitFor({timeout:30000});
  const initialTime=await timer.textContent();
  await expect(timer).not.toHaveText(initialTime,{timeout:5000});
  // Fit the real controls within the conversation panel, including when the
  // agent list takes up part of a phone or landscape viewport.
  const checkComposer=async scenario=>{
   const layout=await page.locator('.session-composer-actions').evaluate(actions=>{
    const row=actions.getBoundingClientRect(),tools=actions.querySelector('.session-composer-tools'),submit=actions.querySelector('.session-composer-submit'),status=actions.querySelector('.session-composer-status');
    const right=submit.getBoundingClientRect(),left=tools.getBoundingClientRect(),middle=status.getBoundingClientRect();
    const buttons=[...actions.querySelectorAll('button')],center=rect=>(rect.top+rect.bottom)/2;
    const inline=[left,right,middle].every(rect=>Math.abs(center(rect)-center(row))<1);
    const bounded=right.right<=row.right+1&&right.left>=row.left-1&&right.top>=row.top-1&&right.bottom<=row.bottom+1;
    const readable=buttons.every(button=>{const rect=button.getBoundingClientRect(),style=getComputedStyle(button);return rect.width>=32&&rect.height>=32&&parseFloat(style.fontSize)>=11;});
    const hitTests=[...submit.querySelectorAll('button')].every(button=>{const rect=button.getBoundingClientRect(),hit=document.elementFromPoint((rect.left+rect.right)/2,center(rect));return hit?.closest('button')===button;});
    const overlap=right.left<left.right-.5;
    const timer=actions.querySelector('[role="timer"]')?.getBoundingClientRect();
    const timerVisible=!timer||middle.width<timer.width||timer.left>=middle.left-1&&timer.right<=Math.min(middle.right,right.left)+1;
    return {inline,bounded,readable,hitTests,timerVisible,overlap,panel:row.width,toolSize:buttons[0].getBoundingClientRect().width,height:row.height};
   });
   if(!layout.inline||!layout.bounded||!layout.readable||!layout.hitTests||!layout.timerVisible)throw Error('Composer must stay in one readable, clickable row: '+JSON.stringify({scenario,...layout}));
   console.log(JSON.stringify({composerLayout:scenario,...layout}));
   if(option('--screenshots')){fs.mkdirSync(option('--screenshots'),{recursive:true});await page.screenshot({path:path.join(option('--screenshots'),browserName+'-composer-'+scenario+'.png')})}
   return layout;
  };
  let overlayChecked=false;
  for(const pointer of ['mouse','touch']){
   if(pointer==='touch'&&browserName==='webkit')continue;
   const touch=pointer==='touch'?await context.newCDPSession(page):null;
   try{
    if(touch){await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});expect(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches)).toBe(true);}
    for(const [width,height] of [[1440,1000],[844,390],[768,1000],[390,844],[320,740]]){
     await page.setViewportSize({width,height});
     // A voice-capable session has the fourth tool shown in the user's screenshot.
     // Add the identical-sized tool only to the browser layout fixture.
     const tools=page.locator('.session-composer-tools');
     await tools.evaluate(element=>{if(element.children.length<4){const button=element.firstElementChild.cloneNode(true);button.dataset.layoutFixture='true';button.setAttribute('aria-label','Voice settings layout fixture');element.append(button);}});
     const result=await checkComposer(pointer+'-'+width+'x'+height);
     overlayChecked ||= result.overlap;
    }
   }finally{if(touch){await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});await touch.detach();}}
  }
  if(!overlayChecked)throw Error('The narrowest panel must exercise right-hand overlap at minimum button size');
  await page.locator('[data-layout-fixture]').evaluateAll(elements=>elements.forEach(element=>element.remove()));
  // Exercise progressive disclosure in the real UI without extra model calls.
  // Fractional fixture versions sit between the native hold and completion.
  await page.setViewportSize({width:1440,height:1000});
  const turnId=lastStream.activeTurnId,workItems=[
   {id:'work-ui-comment-1',turnId,role:'assistant',phase:'commentary',content:'OFFICE_PROGRESS_BEFORE_TOOLS'},
   {id:'work-ui-tool-1',turnId,role:'tool',content:'First command\nOFFICE_TOOL_DETAIL'},
   {id:'work-ui-tool-2',turnId,role:'tool',content:'Second command'},
   {id:'work-ui-comment-2',turnId,role:'assistant',phase:'commentary',content:'OFFICE_PROGRESS_AFTER_TOOLS'},
   {id:'work-ui-tool-3',turnId,role:'tool',content:'Third command'},
  ];
  const pushWork=(step,items)=>liveSocket.send(JSON.stringify({type:'event',event:'session.stream',payload:{...lastStream,version:lastStream.version+step,items}}));
  pushWork(.1,workItems);
  const workProcess=page.getByLabel('Work process',{exact:true});
  await expect(workProcess).toHaveAttribute('open','');
  await expect(page.getByText('OFFICE_PROGRESS_BEFORE_TOOLS',{exact:true})).toBeVisible();
  await expect(page.getByText('OFFICE_PROGRESS_AFTER_TOOLS',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Tool calls',{exact:true})).toHaveCount(2);
  await expect(page.getByText('First command',{exact:true})).toHaveCount(0);
  await page.getByText('Tool calls · 2 items',{exact:true}).click();
  await expect(page.locator('pre').filter({hasText:'OFFICE_TOOL_DETAIL'})).toBeVisible();
  await expect(page.getByText('Third command',{exact:true})).toHaveCount(0);
  if(option('--screenshots')){fs.mkdirSync(option('--screenshots'),{recursive:true});await page.screenshot({path:path.join(option('--screenshots'),browserName+'-working-process.png')})}
  pushWork(.2,[...workItems,{id:'work-ui-final',turnId,role:'assistant',phase:'final_answer',content:'OFFICE_OFFICIAL_RESPONSE_START'}]);
  await expect(workProcess).not.toHaveAttribute('open','');
  await expect(page.getByText('OFFICE_OFFICIAL_RESPONSE_START',{exact:true})).toBeVisible();
  await expect(timer).toHaveCount(1); // Fold on answer start while the turn is still active.
  await expect.poll(()=>typeof finishReply).toBe('function');finishReply();
  await page.getByText('OFFICE_MAC_PACKAGE_REPLY_OK',{exact:true}).first().waitFor({timeout:30000});
  await expect(timer).toHaveCount(0);
  const readMessageTimes=()=>page.locator('article .session-message-time').evaluateAll(elements=>elements.map(element=>({role:element.closest('article').getAttribute('aria-label'),time:element.getAttribute('datetime'),title:element.title})));
  await expect.poll(async()=> (await readMessageTimes()).length).toBe(2);
  const messageTimes=await readMessageTimes();
  if(!messageTimes.some(item=>item.role==='You')||!messageTimes.some(item=>item.role==='Codex')||messageTimes.some(item=>!Number.isFinite(Date.parse(item.time))||!item.title))throw Error('User or Codex message time is missing');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   const clear=await page.locator('article .session-message-time').evaluateAll(elements=>elements.every(element=>{
    const article=element.closest('article'),time=element.getBoundingClientRect(),text=article.querySelector('.session-user-text, .agent-markdown').getBoundingClientRect();
    return time.top>=text.bottom&&time.left>=0&&time.right<=innerWidth;
   }));
   if(!clear)throw Error('Message time overlaps text or leaves the viewport at '+width+'px');
   if(option('--screenshots')){fs.mkdirSync(option('--screenshots'),{recursive:true});await page.screenshot({path:path.join(option('--screenshots'),browserName+'-'+width+'.png')})}
  }
  await page.setViewportSize({width:1440,height:1000});
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
  await page.getByRole('button',{name:'CHAT',exact:true}).click();
  await page.getByRole('button',{name:'Open session: Mac verification recruit',exact:true}).first().waitFor({timeout:30000});
  await page.getByRole('button',{name:'Open session: Mac verification recruit',exact:true}).first().click();
  await page.getByText('OFFICE_MAC_PACKAGE_REPLY_OK',{exact:true}).first().waitFor({timeout:20000});
  await expect.poll(readMessageTimes).toEqual(messageTimes);
  const again=JSON.parse(fs.readFileSync(settingsFile));const reloaded=Object.values(again.avatars).flatMap(g=>Object.values(g)).find(p=>p.duck);
  if(JSON.stringify(reloaded.duck)!==saved)throw Error('Reload or canceled edit changed saved recruit style');
  // Create metadata-only agents in this disposable Office; no extra model calls.
  const config=JSON.parse(fs.readFileSync(path.join(data,'desktop.json'))),pending=new Map();let serial=0;
  rosterSocket=new WebSocket('ws://127.0.0.1:'+config.gatewayPort);
  rosterSocket.on('message',raw=>{const frame=JSON.parse(String(raw)),request=pending.get(frame.id);if(!request)return;clearTimeout(request.timer);pending.delete(frame.id);if(frame.ok)request.resolve(frame.payload);else request.reject(Error(frame.error?.message))});
  await once(rosterSocket,'open');
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=String(++serial),timer=setTimeout(()=>{pending.delete(id);reject(Error('Roster fixture RPC timed out: '+method))},5000);pending.set(id,{resolve,reject,timer});rosterSocket.send(JSON.stringify({type:'req',id,method,params}))});
  await call('connect',{auth:{token:config.token}});
  const alpha=(await call('project.create',{name:'Alpha team',rootPaths:[workspace],requestId:'roster-alpha-project'})).project;
  const zebra=(await call('project.create',{name:'Zebra team',rootPaths:[workspace],requestId:'roster-zebra-project'})).project;
  for(const [name,projectId] of [['Roster Alpha Old',alpha.id],['Roster Zebra',zebra.id],['Roster Alpha New',alpha.id]]){
   await call('session.create',{name,projectId,requestId:name});await new Promise(resolve=>setTimeout(resolve,10));
  }
  const list=page.locator('#session-chat-list'),order=page.getByRole('combobox',{name:'Organize agents',exact:true});
  const names=()=>list.getByRole('button',{name:/^Open session: Roster /}).evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label').replace('Open session: ','')));
  await expect.poll(names).toEqual(['Roster Alpha New','Roster Zebra','Roster Alpha Old']);
  await order.selectOption('project');
  await expect(list.getByRole('heading')).toHaveText(['Alpha team2','Open Workspace1','Zebra team1']);
  await expect.poll(names).toEqual(['Roster Alpha New','Roster Alpha Old','Roster Zebra']);
  await expect(page.getByRole('heading',{name:'Mac verification recruit',exact:true})).toBeVisible();
  await page.getByRole('searchbox',{name:'Search sessions',exact:true}).fill('Alpha team');
  await expect.poll(names).toEqual(['Roster Alpha New','Roster Alpha Old']);
  await order.selectOption('activity');
  await expect.poll(names).toEqual(['Roster Alpha New','Roster Alpha Old']);
  await page.getByRole('searchbox',{name:'Search sessions',exact:true}).fill('');
  await expect.poll(names).toEqual(['Roster Alpha New','Roster Zebra','Roster Alpha Old']);
  await order.selectOption('project');
  await page.getByRole('button',{name:'Close session list',exact:true}).click();
  await expect(list).toBeHidden();
  await page.getByRole('button',{name:'Close chat and return to office',exact:true}).click();
  await page.getByRole('button',{name:'CHAT',exact:true}).click();
  await page.getByRole('button',{name:'Open session: Mac verification recruit',exact:true}).first().click();
  await expect(list).toBeVisible();await expect(order).toHaveValue('activity');
  await order.selectOption('project');
  if(option('--screenshots'))await page.screenshot({path:path.join(option('--screenshots'),browserName+'-agent-projects.png')});
  await page.getByRole('button',{name:'Close chat and return to office',exact:true}).click();
  if(args.includes('--office-tasks-only')){
   await checkOfficeTasks({page,call,expect,setModelFixture:value=>{modelFixture=value},screenshots:option('--screenshots'),browserName,fs,path});
   if(errors.length)throw Error(errors.join('\n'));
   return;
  }
  const wholeShip=page.getByRole('button',{name:'Whole ship',exact:true});
  if(await wholeShip.getAttribute('aria-pressed')!=='true')await wholeShip.click();
  await expect(wholeShip).toHaveAttribute('aria-pressed','true');
  const target=(await call('office.snapshot')).agents.find(agent=>agent.name==='Roster Alpha Old');
  const soundCount=()=>page.evaluate(()=>window.__officeDuckStarts||0);
  const baselineSounds=await soundCount();
  const pushAttention=async patch=>{
   attentionFixture={id:target.id,status:'idle',needsInput:false,completedResult:null,...patch};
   const before=snapshotResponses;liveSocket.send(JSON.stringify({type:'event',event:'roster.updated',payload:{ts:Date.now()}}));
   await expect.poll(()=>snapshotResponses).toBeGreaterThan(before);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  // Exercise hidden-page delivery while keeping the browser test observable.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))});
  await pushAttention({needsInput:true});await expect.poll(soundCount).toBe(baselineSounds+1);
  await pushAttention({needsInput:true});expect(await soundCount()).toBe(baselineSounds+1);
  await pushAttention({completedResult:{key:'attention-review-1',unread:true}});await expect.poll(soundCount).toBe(baselineSounds+2);
  await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))});
  await page.getByRole('button',{name:'Mute duck voices',exact:true}).click();
  await pushAttention({});await pushAttention({needsInput:true});expect(await soundCount()).toBe(baselineSounds+2);
  await page.getByRole('button',{name:'Unmute duck voices',exact:true}).click();
  expect(await soundCount()).toBe(baselineSounds+2);
  await checkOfficeTasks({page,call,expect,setModelFixture:value=>{modelFixture=value},screenshots:option('--screenshots'),browserName,fs,path});
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify({browser:browserName,browserRecruitment:true,workingFolder:true,randomStyleSaved:true,realBundledCodexReply:true,historyAfterReload:true,messageTimesPersisted:true,runningTimerTicks:true,composerSingleRow:true,composerButtonSizeBounded:true,composerRightControlsClickable:true,composerNarrowOverlap:true,timesDoNotOverlap:true,workProcessAutoOpens:true,toolBatchesDefaultClosed:true,workProcessFoldsOnOfficialReply:true,workUiStreamFixture:true,canceledEditPreserved:true,agentListDefaultsOpen:true,agentOrderSwitches:true,departmentOrderAlphabetical:true,searchInBothOrders:true,yellowInputQuacks:true,yellowReviewQuacks:true,hiddenPageDelivery:true,repeatedMarkersStayQuiet:true,duckMuteRespected:true,paidEndpoints:false,modelRequests:requests,pageErrors:0}));
 }catch(error){console.error(error.stack);console.error(JSON.stringify({browser:browserName,pageErrors:errors,visiblePage:page?await page.locator('body').innerText().catch(()=>'(unavailable)'):null}));process.exitCode=1}
 finally{rosterSocket?.terminate();await browser?.close();await local?.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
})();
