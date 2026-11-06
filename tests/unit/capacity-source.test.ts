// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createCapacityReader, parseCapacitySources, type CapacitySource } from "@/lib/rate-limit-capacity/source";
import { capacityDisplay, type ProducerReply } from "@/lib/rate-limit-capacity/model";
import { NOW, producer } from "../fixtures/capacity";
const source: CapacitySource={id:"primary",host:"prod-a",strategies:[{name:"maker",setting:"/srv/maker/setting.json"}]};
it("validates private sources without browser-provided Redis URLs", () => {
  expect(parseCapacitySources({version:1,sources:[source]})).toEqual([source]);
  for(const s of [{...source,host:"-oProxyCommand=bad"},{...source,python:"python3;bad"},{...source,strategies:[{name:"maker",setting:"relative"}]}])
    expect(()=>parseCapacitySources({version:1,sources:[s]})).toThrow();
  expect(()=>parseCapacitySources({version:1,sources:[source,source]})).toThrow();
});
it("coalesces requests and caches for five seconds without restamping heartbeat facts", async () => {
  let now=NOW; const load=vi.fn(async()=>[producer()]); const read=createCapacityReader(load,()=>now);
  const [a,b]=await Promise.all([read([source]),read([source])]);
  expect(load).toHaveBeenCalledTimes(1); expect(a.rows).toEqual(b.rows);
  now+=1000; const cached=await read([source]);
  expect(load).toHaveBeenCalledTimes(1);expect(cached.rows[0].evidence[0].heartbeatAt).toBe(NOW);
  now+=4000;await read([source]);expect(load).toHaveBeenCalledTimes(2);
});
it("keeps known accounts but marks transport failure rather than refreshing old green status", async () => {
  let now=NOW; const load=vi.fn(async()=>[producer()]); const read=createCapacityReader(load,()=>now);
  await read([source]); now+=5000;load.mockRejectedValueOnce(new Error("private credential must never escape"));
  const failed=await read([source]);expect(failed.sourceErrors).toBe(1);
  expect(capacityDisplay(failed.rows[0],now)).toMatchObject({state:"stale",reason:"read"});
  expect(JSON.stringify(failed)).not.toContain("credential");
});
it("preserves old scope/evidence on a producer read error and clears disabled configuration", async () => {
  let now=NOW;const load=vi.fn(async():Promise<ProducerReply[]>=>[producer("low")]);const read=createCapacityReader(load,()=>now);
  await read([source]);now+=5000;
  load.mockResolvedValueOnce([{id:"primary:maker",strategy:"maker",error:"read-failed",heartbeat:null,expected:[]}]);
  const failed=await read([source]);expect(failed.rows).toHaveLength(1);
  expect(capacityDisplay(failed.rows[0],now)).toMatchObject({state:"stale",lastState:"low"});
  expect(await read([])).toMatchObject({configured:false,rows:[]});
});
