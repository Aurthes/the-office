import { expect, it } from "vitest";
// Documentation reference arithmetic only; scheduler behavior/permissions are unchanged.
function points(t0:number,d:number) {
 if(d<=300000)return [];
 const e=t0+d, result:number[]=[];let p=t0;
 while(true){const gap=(e-p)/2;if(gap<15000){if(result.at(-1)!==e)result.push(e);return result;}p=Math.round(p+gap);result.push(p);if(p===e)return result;}
}
it("keeps five minutes direct, and just over five as integer UTC instants",()=>{
 const t=Date.parse("2026-11-12T10:00:00.123Z");expect(points(t,300000)).toEqual([]);
 const a=points(t,300001);expect(a[0]).toBe(t+150001);expect(a.at(-1)).toBe(t+300001);expect(a.every(Number.isSafeInteger)).toBe(true);
});
it("matches the ten-minute sequence without duplicating the endpoint",()=>{
 const t=Date.parse("2026-11-12T10:00:00.123Z"),a=points(t,600000);
 expect(a.map(v=>v-t)).toEqual([300000,450000,525000,562500,581250,600000]);expect(new Set(a).size).toBe(a.length);expect(new Date(a[3]).toISOString()).toBe("2026-11-12T10:09:22.623Z");
});
it("permits exactly fifteen seconds but rejects an unrounded gap below fifteen",()=>{
 expect(points(0,480000)).toEqual([240000,360000,420000,450000,465000,480000]);
 expect(points(0,479999)).toEqual([240000,360000,420000,450000,479999]);
});
