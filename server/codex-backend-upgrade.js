"use strict";
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const {pathToFileURL}=require('node:url');
const execute=(file,args,options={})=>promisify(execFile)(file,args,{timeout:15000,maxBuffer:65536,...options});const {atomic}=require('./codex-backend-state');const {backendRpc}=require('./codex-backend-rpc');const {installRuntime}=require('./codex-backend-install');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function launchUpgrade(job,patch,{directory,rpc=backendRpc,install=installRuntime,deploy,wait=pause,platform=process.platform}={}){
 if(platform!=='darwin')throw new Error('This Office installation does not support managed backend switching');
 const runtime=await install(job.target,directory);patch({phase:'waiting_idle',error:null});
 let reservation;
 // Same durable job waits for real idle; no model turn or permission guess.
 while(true){reservation=await rpc('office.backend.reserve',{jobId:job.id,expectedVersion:job.from});if(reservation.reserved)break;patch({phase:'waiting_idle',blockers:reservation.blockers});await wait(5000);}
 let launched=false;
 try{
  patch({phase:'switching',blockers:[],sessions:reservation.sessions});
  const run=deploy||managedDeploy;launched=true;const result=await run({job,runtime,home:reservation.home,nativePid:reservation.nativePid,directory,patch});
  if(result.phase!=='succeeded'){patch({phase:result.phase==='recovery_failed'?'recovery_failed':'failed',error:result.error||'Backend switch failed; see the private controller receipt'});if(result.phase!=='recovery_failed')await rpc('office.backend.release',{jobId:job.id});return;}
  const current=await rpc('office.backend.status');if(current.version!==job.target||!current.ready||current.reservation?.jobId!==job.id)throw new Error('The new backend identity or upgrade reservation did not match');
  const verified=await rpc('office.backend.verify',{jobId:job.id,sessions:reservation.sessions});if(!verified.verified||!verified.queueSourcesReady)throw new Error('Office thread and delivery state could not be verified');
  patch({verification:verified});await rpc('office.backend.release',{jobId:job.id});patch({phase:'succeeded',error:null});
 }catch(e){const uncertain=e.controllerMayHaveRun??launched;if(!uncertain){try{await rpc('office.backend.release',{jobId:job.id});}catch{patch({phase:'uncertain',error:'Preparation failed and releasing the upgrade reservation was not confirmed. No switch was replayed.'});return;}}patch({phase:uncertain?'uncertain':'failed',error:e.message});}
}
async function resumeUpgrade(job,patch,{rpc=backendRpc,directory,wait=pause}={}){
 const receipt=JSON.parse(fs.readFileSync(path.join(directory,'jobs',job.id,'controller-receipt.json'),'utf8'));
 if(receipt.directory!==job.controllerDirectory)throw new Error('Upgrade controller receipt changed; manual reconciliation required');
 for(;;){const archived=path.join(directory,'jobs',job.id,'result.json');const result=JSON.parse(fs.readFileSync(fs.existsSync(archived)?archived:path.join(receipt.directory,'result.json'),'utf8'));
  if(result.completedAt){if(result.phase==='succeeded'){const current=await rpc('office.backend.status');if(current.version!==job.target||!current.ready)throw new Error('Upgrade finished but running identity is unconfirmed');if(current.reservation?.jobId===job.id){const verified=await rpc('office.backend.verify',{jobId:job.id,sessions:job.sessions});if(!verified.verified||!verified.queueSourcesReady)throw new Error('Office state verification is unconfirmed');patch({verification:verified});await rpc('office.backend.release',{jobId:job.id});}else if(current.reservation)throw new Error('Another upgrade owns the backend');patch({phase:'succeeded',error:null});}else{patch({phase:result.phase==='recovery_failed'?'recovery_failed':'failed',error:result.error||'Backend upgrade failed'});if(result.phase!=='recovery_failed')await rpc('office.backend.release',{jobId:job.id});}return;}
  try{await execute('/bin/launchctl',['print',`gui/${process.getuid()}/${receipt.label}`]);}catch{throw new Error('Controller is not registered and its outcome is unknown. No upgrade was replayed.');}await wait(1000);
 }
}
async function managedDeploy({job,runtime,home,nativePid,directory,patch}){
 let controllerMayHaveRun=false;try {
 const root=path.dirname(__dirname),deploy=await import(pathToFileURL(path.join(root,'scripts/redeploy-office.mjs')));
 const service=path.join(os.homedir(),'Library/LaunchAgents/com.ys.claw3d.gateway.plist');const result=await execute('/usr/bin/plutil',['-convert','json','-o','-',service]);const value=JSON.parse(result.stdout);
 if(!value.EnvironmentVariables||!value.ProgramArguments?.[1]?.endsWith('/server/codex-office-gateway.js'))throw new Error('Unsupported managed Gateway service');
 const dir=path.join(directory,'jobs',job.id);fs.mkdirSync(dir,{recursive:true,mode:0o700});value.EnvironmentVariables.CLAW3D_CODEX_BIN=runtime.binary;
 const candidate=path.join(dir,'gateway.plist'),json=path.join(dir,'gateway.json');atomic(json,value);
 await execute('/usr/bin/plutil',['-convert','xml1','-o',candidate,json]);fs.unlinkSync(json);fs.chmodSync(candidate,0o600);
 const plan=path.join(dir,'plan.json');atomic(plan,{services:[{plist:service,candidate,health:`http://127.0.0.1:${value.EnvironmentVariables.CODEX_ADAPTER_PORT||18790}/health`}],readyTimeoutMs:30000});
 const controller=deploy.prepare(plan,path.join(dir,'controller'));controller.services[0].nativeUpgrade={jobId:job.id,home,nativePid,runtimePrefix:runtime.prefix,files:runtime.files,snapshotDirectory:path.join(dir,'native-state-snapshot')};
 if(controller.cleanup){controller.cleanup.protectedPaths=[...(controller.cleanup.protectedPaths||[]),path.join(directory,'runtimes'),dir,...fs.readdirSync(controller.cleanup.releasesDir).map(name=>path.join(controller.cleanup.releasesDir,name))];}
 atomic(path.join(controller.directory,'job.json'),controller);patch({controllerDirectory:controller.directory});atomic(path.join(dir,'controller-receipt.json'),{directory:controller.directory,label:controller.label});
 controllerMayHaveRun=true;await execute('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,path.join(controller.directory,'controller.plist')]);
 for(;;){const result=JSON.parse(fs.readFileSync(path.join(controller.directory,'result.json'),'utf8'));if(result.completedAt){
    atomic(path.join(dir,'result.json'),result);
    if(result.phase==='succeeded'){
      fs.copyFileSync(path.join(controller.directory,'0.before.plist'),path.join(dir,'prior-gateway.plist'));fs.chmodSync(path.join(dir,'prior-gateway.plist'),0o600);
      for(let i=0;i<20;i++){try{await execute('/bin/launchctl',['print',`gui/${process.getuid()}/${controller.label}`]);await pause(100);}catch{fs.rmSync(controller.directory,{recursive:true,force:true});break;}}
      for(const file of [candidate,plan])fs.rmSync(file,{force:true});
    }
    return result;}await pause(1000);}
 }catch(e){e.controllerMayHaveRun=controllerMayHaveRun;throw e;}
}
module.exports={launchUpgrade,managedDeploy,resumeUpgrade};
