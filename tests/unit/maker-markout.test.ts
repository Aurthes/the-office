import { it,expect } from "vitest";
import { makerMarkoutSeries,markoutQuantiles,type MarkoutRaw,type MarkoutRead,type MarkoutQuery } from "@/lib/maker-markout/model";
const now=Date.UTC(2026,10,7,12),start=now-3_600_000;
const query:MarkoutQuery={horizon:"60m",hours:1,level:"overall"};
function point(symbol:string,samples:number[],tif="rpi",time=start+1000):MarkoutRaw{return {time,strategy:"MMRPI",symbol,side:"buy",tif,run:"r",fields:{count:samples.length,sample_schema:1,sample_count:samples.length,sample_overflow:0,sample_invalid:0,...Object.fromEntries(samples.map((v,i)=>[`sample_${String(i).padStart(2,"0")}`,v]))}};}
function read(rows:MarkoutRaw[]):MarkoutRead{return {configured:true,sampledAt:now,sourceErrors:0,rows,quality:rows.flatMap(r=>[{...r,time:start-300000,fields:{missing:0,pending:0,settled:0}},{...r,time:Math.floor(r.time/300000)*300000,fields:{missing:0,pending:0,settled:r.fields.count!}}])};}
const bucket=(r:MarkoutRead,type="rpi",f=query)=>makerMarkoutSeries(r,f,now).points.find(p=>p.time===start && p.type===type)!;
it("uses type7 signed quantiles for odd/even/singleton and extreme finite values",()=>{
 expect(markoutQuantiles([-10,0,10])).toEqual([-9,-5,0,5,9]);expect(markoutQuantiles([3])).toEqual([3,3,3,3,3]);expect(markoutQuantiles([])).toBeNull();expect(markoutQuantiles([-1e308,1e308])!.every(Number.isFinite)).toBe(true);
});
it("pools strongly unequal raw groups instead of averaging their quantiles",()=>{
 const b=bucket(read([point("v.perp.a_usdt",[0]),point("v.perp.b_usdt",[10,11,12,13,14,15,16,17,18])]));expect(b.n).toBe(10);expect(b.quantiles![2]).toBe(13.5);expect(b.quantiles![2]).not.toBe(7);
});
it("pools known GTX/GTC and keeps unknown independent",()=>{
 const r=read([point("v.perp.a_usdt",[-2],"gtx"),point("v.perp.b_usdt",[4],"gtc"),point("v.perp.c_usdt",[1000],"unknown")]);expect(bucket(r,"non-rpi").quantiles![2]).toBe(1);expect(bucket(r,"unknown").quantiles![2]).toBe(1000);expect(bucket(r).quantiles).toBeNull();
});
it.each(["overflow","invalid","legacy","slot-missing","count-mismatch"])("marks %s distribution N/A rather than using its prefix",reason=>{
 const p=point("v.perp.a_usdt",[1,2]);const r=read([p]);
 if(reason==="overflow"){p.fields.count=3;p.fields.sample_overflow=1;r.quality[1].fields.settled=3;}
 if(reason==="invalid"){p.fields.count=3;p.fields.sample_invalid=1;r.quality[1].fields.settled=3;}
 if(reason==="legacy")delete p.fields.sample_schema;
 if(reason==="slot-missing")delete p.fields.sample_01;
 if(reason==="count-mismatch")p.fields.sample_count=1;
 expect(bucket(r).quantiles).toBeNull();expect(bucket(r).incomplete).toBe(true);
});
it("does not average or duplicate retransmitted interval identities",()=>{
 const p=point("v.perp.a_usdt",[1,2]);const r=read([p]);r.rows.push(structuredClone(p));expect(bucket(r).n).toBe(2);const clash=structuredClone(p);clash.fields.sample_00=99;r.rows.push(clash);expect(bucket(r).quantiles).toBeNull();
});
it("detects a missing whole export with original settled counters",()=>{
 const r=read([point("v.perp.a_usdt",[1])]);r.quality[1].fields.settled=2;expect(bucket(r).transportIncomplete).toBe(true);expect(bucket(r).quantiles).toBeNull();
});
it("reports missing cutoff prices and source failures honestly",()=>{
 const r=read([point("v.perp.a_usdt",[1])]);r.quality[1].fields.missing=1;expect(bucket(r).missing).toBe(1);expect(bucket(r).quantiles).toBeNull();r.sourceErrors=1;expect(bucket(r).quantiles).toBeNull();
});
it("does not confuse later young fills with already matured export-time samples",()=>{
 const r=read([point("v.perp.a_usdt",[7])]);r.quality[1].fields.pending=9;expect(bucket(r).pending).toBe(9);expect(bucket(r).quantiles).toEqual([7,7,7,7,7]);
});
it("keeps closed UTC buckets, filters symbols/strategy, and leaves empty buckets gaps",()=>{
 const r=read([point("one.perp.a_usdt",[1]),point("two.perp.b_usdt",[9])]);const a=makerMarkoutSeries(r,{...query,exchange:"one",symbol:"one.perp.a_usdt"},now);expect(a.points).toHaveLength(36);expect(a.end).toBe(now);expect(a.points.filter(p=>p.quantiles)).toHaveLength(1);expect(bucket(r,"rpi",{...query,strategy:"absent"}).quantiles).toBeNull();
});
