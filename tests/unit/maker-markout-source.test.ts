import {expect,it,vi} from "vitest";
import {createMarkoutReader,parseMarkoutSources,parseMarkoutRead,type MarkoutSource} from "@/lib/maker-markout/source";
const spec:MarkoutSource={id:"one",strategies:[{name:"MMRPI",setting:"/private/instance/atom.json"}]};
it("uses one shared bounded read for concurrent requests and client-only dimensions",async()=>{
 const read=vi.fn(async()=>({rows:[],quality:[]}));const get=createMarkoutReader(read,()=>Date.UTC(2026,10,7,12));
 const query={horizon:"60m",hours:1,level:"overall" as const};await Promise.all([get([spec],query),get([spec],{...query,type:"rpi",symbol:"v.perp.a_usdt"})]);expect(read).toHaveBeenCalledTimes(1);await get([spec],{...query,horizon:"30m"});expect(read).toHaveBeenCalledTimes(2);
});
it("marks failed sources incomplete rather than returning partial quantiles",async()=>{
 const get=createMarkoutReader(async()=>{throw Error("offline");},()=>Date.UTC(2026,10,7,12));const r=await get([spec],{horizon:"60m",hours:1,level:"overall"});expect(r.sourceErrors).toBe(1);expect(r.points.every(p=>p.quantiles===null && p.incomplete)).toBe(true);
});
it("validates inventory and bounded scalar responses",()=>{
 expect(parseMarkoutSources({version:1,sources:[spec]})).toEqual([spec]);expect(()=>parseMarkoutSources({version:1,sources:[spec,spec]})).toThrow();expect(()=>parseMarkoutSources({version:1,sources:[{...spec,strategies:[{name:"bad';query",setting:"/x"}]}]})).toThrow();expect(()=>parseMarkoutRead({version:1,error:"cap",rows:[],quality:[]})).toThrow();expect(parseMarkoutRead({version:1,rows:[],quality:[]})).toEqual({rows:[],quality:[]});
});
