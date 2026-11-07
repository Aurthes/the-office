import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveStateDir } from "@/lib/clawdbot/paths";
import { loadServerRegistry, sshTransportOptions } from "../../../server/server-registry";
import { MARKOUT_HORIZONS, makerMarkoutSeries, markoutBucketMs, type MarkoutRead, type MarkoutQuery, type MarkoutRaw } from "./model";
const exec=promisify(execFile);
export type MarkoutSource = { id:string; host?:string; python?:string; strategies:{name:string;setting:string}[] };
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
export function parseMarkoutSources(raw:unknown):MarkoutSource[] {
  const c=raw as {version:number;sources:MarkoutSource[]};
  if(c?.version!==1 || !Array.isArray(c.sources) || c.sources.length>4)throw Error("Invalid markout sources");
  const ids=new Set<string>(),names=new Set<string>();
  const absolute=(v:unknown):v is string=>typeof v==="string" && path.posix.isAbsolute(v) && v.length<=1024 && !/[\x00-\x1f\x7f]/.test(v);
  for(const s of c.sources){
    if(!s || !/^[\w.-]{1,64}$/.test(s.id) || ids.has(s.id) || s.host!==undefined && !/^[\w.-]{1,64}$/.test(s.host) || s.python!==undefined && s.python!=="python3" && !absolute(s.python) || !Array.isArray(s.strategies) || !s.strategies.length || s.strategies.length>16)throw Error("Invalid markout source");
    ids.add(s.id);
    for(const p of s.strategies){if(!/^[\w.:-]{1,128}$/.test(p.name) || names.has(p.name) || !absolute(p.setting))throw Error("Invalid markout strategy");names.add(p.name);}
  }
  return c.sources;
}
export function parseMarkoutRead(raw:unknown):Pick<MarkoutRead,"rows"|"quality"> {
  const r=raw as {version:number;error?:string;rows:MarkoutRaw[];quality:MarkoutRaw[]};
  if(r?.version!==1 || r.error || !Array.isArray(r.rows) || !Array.isArray(r.quality) || r.rows.length>20000 || r.quality.length>20000)throw Error("Incomplete markout source");
  for(const p of [...r.rows,...r.quality])if(!p || !Number.isSafeInteger(p.time) || p.time<0 || [p.strategy,p.symbol,p.side,p.tif,p.run].some(v=>typeof v!=="string" || v.length>512) || !p.fields || typeof p.fields!=="object" || Object.values(p.fields).some(v=>v!==null && (typeof v!=="number" || !Number.isFinite(v))))throw Error("Invalid markout row");
  return {rows:r.rows,quality:r.quality};
}
export async function readMarkoutSource(source:MarkoutSource,horizon:string,start:number,end:number,until:number,bucketMs:number){
  const script=await fs.readFile(path.join(process.cwd(),"server/maker-markout-probe.py"),"utf8");
  const request=JSON.stringify({strategies:source.strategies,horizon,start,end,until,bucketMs});let stdout:string;
  if(source.host){
    const {hosts}=await loadServerRegistry();if(!hosts.some(h=>h.alias===source.host && h.active && h.group==="online"))throw Error("Markout source unavailable");
    ({stdout}=await exec("ssh",[...await sshTransportOptions(source.host),"-o","ConnectTimeout=3",source.host,`timeout 55s ${quote(source.python||"python3")} -c ${quote(script)} ${quote(request)}`],{cwd:os.homedir(),timeout:60_000,maxBuffer:16*1024*1024}));
  }else({stdout}=await exec(source.python||"python3",["-c",script,request],{cwd:os.homedir(),timeout:60_000,maxBuffer:16*1024*1024}));
  return parseMarkoutRead(JSON.parse(stdout));
}
export function createMarkoutReader(reader=readMarkoutSource,now=Date.now){
  const cache=new Map<string,{at:number;value?:MarkoutRead;pending?:Promise<MarkoutRead>}>();let active=0;
  return async(sources:MarkoutSource[],query:MarkoutQuery)=>{
    const time=now(),bucket=markoutBucketMs(query.hours),end=Math.floor(time/bucket)*bucket,start=end-query.hours*3_600_000;
    const key=JSON.stringify([sources,query.horizon,query.hours,end]);let hit=cache.get(key);
    if(!hit?.pending && (!hit?.value || time-hit.at>=30_000)){
      if(active>=2)throw Error("Markout reader busy");active++;
      hit={at:time};const entry=hit;
      entry.pending=Promise.all(sources.map(s=>reader(s,query.horizon,start,end,time,bucket).then(v=>({...v,error:false})).catch(()=>({rows:[],quality:[],error:true})))).then(parts=>{
        const v={rows:parts.flatMap(p=>p.rows),quality:parts.flatMap(p=>p.quality),sourceErrors:parts.filter(p=>p.error).length,sampledAt:now(),configured:sources.length>0};entry.value=v;return v;
      }).finally(()=>{active--;entry.pending=undefined;});
      cache.set(key,entry);
      for(const [old,v] of cache)if(cache.size>4 && old!==key && !v.pending)cache.delete(old);
    }
    return makerMarkoutSeries(await (hit!.pending||Promise.resolve(hit!.value!)),query,time);
  };
}
const read=createMarkoutReader();
export async function getMakerMarkout(query:MarkoutQuery){
  if(!MARKOUT_HORIZONS.includes(query.horizon as typeof MARKOUT_HORIZONS[number]))throw Error("Invalid horizon");
  const root=path.join(resolveStateDir(),"claw3d");let raw:string;
  // The current configured strategy inventory already holds the protected
  // instance-setting paths used by capacity monitoring. No credentials in UI.
  const config=async(name:string)=>{const file=path.join(root,name);if((await fs.stat(file)).size>64*1024)throw Error("Invalid markout config");return fs.readFile(file,"utf8");};
  try{raw=await config("maker-markout.json");}
  catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;try{raw=await config("rate-limit-capacity.json");}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return read([],query);throw e;}}
  if(raw.length>64*1024)throw Error("Invalid markout config");return read(parseMarkoutSources(JSON.parse(raw)),query);
}
