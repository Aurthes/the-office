"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const {STABLE,compare,atomic}=require("./codex-backend-state");
const {backendRpc}=require("./codex-backend-rpc");
const SIX_HOURS=6*60*60*1000;
async function officialJson(url,fetcher=fetch){
 const res=await fetcher(url,{headers:{Accept:"application/json","User-Agent":"Office-backend-updates"},redirect:"error",signal:AbortSignal.timeout(8000)});
 if(!res.ok){const e=new Error(`Official release lookup returned HTTP ${res.status}`);if(res.status===429){const value=res.headers.get("retry-after");const seconds=/^\d+$/.test(value||"")?Number(value)*1000:Date.parse(value)-Date.now();e.retryAfter=Number.isFinite(seconds)?Math.max(0,seconds):SIX_HOURS;}throw e;}
 if(Number(res.headers.get("content-length"))>2*1024*1024)throw new Error("Official release response too large");
 let size=0;const chunks=[];for await(const chunk of res.body){size+=chunk.length;if(size>2*1024*1024)throw new Error("Official release response too large");chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString());
}
function releaseRow(row){const version=row.tag_name?.replace(/^rust-v/,"");if(row.draft||row.prerelease||!STABLE.test(version||""))return null;
 const url=`https://github.com/openai/codex/releases/tag/rust-v${version}`;
 const notes=String(row.body||"No release notes provided.");
 return {version,url,publishedAt:row.published_at,notes:notes.slice(0,18000),notesTruncated:notes.length>18000};
}
class BackendUpdates {
 constructor({directory=path.join(process.env.CLAW3D_DATA_DIR||path.join(os.homedir(),".local/share/claw3d"),"backend-updates"),rpc=backendRpc,fetcher=fetch,upgrade,now=Date.now}={}){
  this.directory=directory;this.file=path.join(directory,"state.json");this.rpc=rpc;this.fetcher=fetcher;this.upgrade=upgrade||((job,patch)=>require("./codex-backend-upgrade").launchUpgrade(job,patch,{directory}));this.now=now;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,"utf8")):{version:1,lastCheckedAt:null,nextCheckAt:0,releases:[],job:null};
  if(this.state.version!==1)throw new Error("Unsupported backend update state");
 }
 save(){atomic(this.file,this.state);}
 async running(){if(!this.runtimeRead||this.now()-this.runtimeRead.at>15000){if(!this.reading)this.reading=this.rpc("office.backend.status").then(value=>this.runtimeRead={at:this.now(),value}).catch(()=>{throw new Error('Could not verify the running backend. Check the Office connection.');}).finally(()=>this.reading=null);await this.reading;}return this.runtimeRead.value;}
 start(){if(this.started)return;this.started=true;const tick=()=>{void this.scan().catch(()=>{}).finally(()=>{if(!this.started)return;this.timer=setTimeout(tick,Math.min(2147483647,Math.max(1,this.state.nextCheckAt-this.now())));this.timer.unref?.();});};tick();if(this.state.job&&!['succeeded','failed','recovery_failed','uncertain'].includes(this.state.job.phase)){
   const job=this.state.job;if(job.phase==='waiting_idle'&&!job.controllerDirectory)void this.begin(job);
   else if(job.controllerDirectory)void require('./codex-backend-upgrade').resumeUpgrade(job,patch=>this.patchJob(job,patch),{directory:this.directory,rpc:this.rpc}).catch(e=>this.failJob(job,e,'uncertain'));
   else if(job.phase==='preparing')this.patchJob(job,{phase:'failed',error:'Office restarted during preparation. The current backend was not switched; click Upgrade to retry.'});
   else void this.rpc('office.backend.status').then(async current=>{if(current.version!==job.from||current.reservation?.jobId!==job.id)throw new Error('Upgrade outcome needs reconciliation');await this.rpc('office.backend.release',{jobId:job.id});this.patchJob(job,{phase:'failed',error:'Preparation stopped before controller launch; current backend unchanged.'});}).catch(e=>this.failJob(job,e,'uncertain'));
  }}
 close(){this.started=false;clearTimeout(this.timer);}
 scan(){if(this.scanning)return this.scanning;if(this.now()<this.state.nextCheckAt)return Promise.resolve();
  this.scanning=this.check().finally(()=>this.scanning=null);return this.scanning;
 }
 async check(){this.state.lastCheckedAt=this.now();this.state.nextCheckAt=this.now()+SIX_HOURS;
  try{const runtime=await this.running();if(!STABLE.test(runtime.version||""))throw new Error("Current runtime is not a verified stable version");
   const [npm,latest]=await Promise.all([officialJson('https://registry.npmjs.org/@openai/codex/latest',this.fetcher),officialJson('https://api.github.com/repos/openai/codex/releases/latest',this.fetcher)]);
   const newest=releaseRow(latest);if(npm.name!=="@openai/codex"||!STABLE.test(npm.version||"")||!newest||newest.version!==npm.version)throw new Error("Official stable channels disagree; upgrade is unavailable");
   const rows=[];let complete=false;
   if(compare(newest.version,runtime.version)>0){for(let page=1;page<=4;page++){const releases=await officialJson(`https://api.github.com/repos/openai/codex/releases?per_page=100&page=${page}`,this.fetcher);if(!Array.isArray(releases))throw new Error("Invalid official release list");for(const row of releases){const r=releaseRow(row);if(!r)continue;if(compare(r.version,runtime.version)>0&&compare(r.version,newest.version)<=0)rows.push(r);}if(releases.length<100){complete=true;break;}}}
   const allReleases=[...new Map(rows.map(r=>[r.version,r])).values()].sort((a,b)=>compare(a.version,b.version));
   const releases=allReleases.slice(-64);if(allReleases.length>64)complete=false;
   if(compare(newest.version,runtime.version)>0&&!releases.some(r=>r.version===newest.version))throw new Error("Latest release missing from official details");
   this.state={...this.state,target:newest.version,releaseId:crypto.createHash('sha256').update(`${runtime.version}:${newest.version}:${newest.url}`).digest('hex'),baseVersion:runtime.version,releases,detailsComplete:(complete||compare(newest.version,runtime.version)<=0)&&!releases.some(r=>r.notesTruncated),lastSuccessAt:this.now(),error:null};
  }catch(e){this.state.error=e.message;this.state.nextCheckAt=Math.max(this.state.nextCheckAt,this.now()+(e.retryAfter||0));}this.save();
 }
 async status(){let current;try{current=await this.running();}catch(e){current={version:null,error:e.message};}
  const s=this.state;return {current,upgradeSupported:process.platform==='darwin',latest:s.target||null,releaseId:s.releaseId||null,available:!s.error&&s.baseVersion===current.version&&Boolean(s.target&&STABLE.test(current.version||"")&&compare(s.target,current.version)>0),lastCheckedAt:s.lastCheckedAt,lastSuccessAt:s.lastSuccessAt||null,nextCheckAt:s.nextCheckAt,error:s.error||current.error||null,detailsComplete:s.detailsComplete??false,releases:s.releases,job:s.job?{id:s.job.id,requestId:s.job.requestId,phase:s.job.phase,target:s.job.target,from:s.job.from,error:s.job.error?(s.job.phase==='recovery_failed'?'Native data may have migrated. Automatic downgrade is blocked; manual recovery is required.':s.job.phase==='uncertain'?'The upgrade result is unconfirmed. No switch will be repeated automatically; inspect the private operation record.':'Backend preparation or switching failed. No upgrade completed; inspect the private operation record.'):null,blockers:s.job.blockers||[],updatedAt:s.job.updatedAt}:null};}
 patchJob(job,patch){if(this.state.job?.id!==job.id||Object.entries(patch).every(([key,value])=>JSON.stringify(job[key])===JSON.stringify(value)))return;const previous={...job};Object.assign(job,patch,{updatedAt:this.now()});try{this.save();}catch{for(const key of Object.keys(job))delete job[key];Object.assign(job,previous);throw new Error('Could not persist the upgrade state. Current outcome requires reconciliation.');}if(patch.phase==='succeeded')this.runtimeRead=null;}
 failJob(job,error,phase='failed'){try{this.patchJob(job,{phase,error:error.message});}catch{this.state.error='Backend update state could not be saved. Inspect the private operation record before retrying.';}}
 begin(job){return Promise.resolve().then(()=>this.upgrade(job,patch=>this.patchJob(job,patch))).catch(e=>this.failJob(job,e));}
 async request(input){const status=await this.status();if(!input||!/^[-a-f\d]{36}$/.test(input.requestId||""))throw new Error("Choose a valid upgrade request ID");
  if(this.state.job?.requestId===input.requestId){if(input.releaseId!==this.state.job.releaseId||input.expectedVersion!==this.state.job.from)throw new Error('Upgrade request ID has a different intent');return this.status();}
  if(this.state.job&&!['succeeded','failed'].includes(this.state.job.phase))throw new Error("An upgrade is already pending; check its current status");
  if(!status.available||input.releaseId!==status.releaseId||input.expectedVersion!==status.current.version)throw new Error("Release or running version changed. Refresh before upgrading.");
  const job={id:crypto.randomUUID(),requestId:input.requestId,releaseId:input.releaseId,phase:'preparing',target:status.latest,from:status.current.version,createdAt:this.now(),updatedAt:this.now()};const previous=this.state.job;this.state.job=job;try{this.save();}catch{this.state.job=previous;throw new Error('Could not record the upgrade request. No upgrade was started.');}
  void this.begin(job);return this.status();
 }
}
function createBackendUpdates({updates,...options}={}){try{updates ||= new BackendUpdates(options);updates.start();}catch{
 try{updates?.close?.();}catch{}
 const disabled=(req,res)=>{if(req.url?.split('?')[0]!=="/api/office/backend-updates")return false;res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Backend update state needs recovery. Chat remains available.'}));return true;};disabled.close=()=>{};return disabled;
 }
 const handler=(req,res)=>{const name=req.url?.split('?')[0];if(name!=="/api/office/backend-updates")return false;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.method==='GET')void updates.status().then(v=>send(200,v)).catch(e=>send(503,{error:e.message}));
  else if(req.method==='POST'){let origin;try{origin=new URL(req.headers.origin);}catch{}if(!origin||origin.host!==req.headers.host||!['http:','https:'].includes(origin.protocol)){send(403,{error:'Same-origin upgrade request required'});return true;}
   let body='',size=0;req.on('data',chunk=>{size+=chunk.length;if(size<=2048)body+=chunk;});req.on('end',()=>{if(size>2048)return send(413,{error:'Request too large'});void Promise.resolve().then(()=>updates.request(JSON.parse(body))).then(v=>send(202,v)).catch(e=>send(409,{error:e.message}));});
  }else send(405,{error:'Method not allowed'});return true;
 };handler.close=()=>updates.close();return handler;
}
module.exports={BackendUpdates,createBackendUpdates,officialJson,releaseRow,SIX_HOURS};
