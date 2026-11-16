// @vitest-environment node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
function fixture(windows: unknown[] = []) {
 const listeners = new Map<string,(event: Record<string,unknown>)=>void>();
 const showNotification=vi.fn(async()=>{}),openWindow=vi.fn(async()=>{});
 const context={self:{addEventListener:(name:string,fn:(event:Record<string,unknown>)=>void)=>listeners.set(name,fn),registration:{showNotification},location:{origin:"https://office.example"},clients:{matchAll:async()=>windows,openWindow}},URL,MessageChannel,setTimeout,clearTimeout};
 vm.runInNewContext(readFileSync("public/office-sw.js","utf8"),context);
 const fire=async(name:string,extra:Record<string,unknown>)=>{let work=Promise.resolve();listeners.get(name)?.({...extra,waitUntil:(value:Promise<void>)=>{work=value;}});await work;};
 return {listeners,showNotification,openWindow,fire};
}
it("always shows visible generic notifications, stable replacement tags, and never caches fetches",async()=>{
 const f=fixture(),id="11111111-1111-4111-8111-111111111111";
 await f.fire("push",{data:{json:()=>({eventId:id,title:"private",brief:"secret"})}});
 expect(f.showNotification).toHaveBeenCalledWith("Office · Important update",expect.objectContaining({tag:`office-${id}`,data:{eventId:id}}));
 expect(JSON.stringify(f.showNotification.mock.calls)).not.toContain("secret");expect(f.listeners.has("fetch")).toBe(false);
 await f.fire("push",{data:{json:()=>{throw Error("bad")}}});expect(f.showNotification).toHaveBeenCalledTimes(2);
});
it("opens only a fixed same-origin route even with a malicious notification payload",async()=>{
 const f=fixture();await f.fire("notificationclick",{notification:{close:vi.fn(),data:{eventId:"https://evil.example",url:"https://evil.example"}}});
 expect(f.openWindow).toHaveBeenCalledWith("https://office.example/office");
});
it("focuses an existing Office without navigating when its live listener acknowledges",async()=>{
 const focus=vi.fn(async()=>{}),navigate=vi.fn(async()=>{});
 const postMessage=vi.fn((_message:unknown,ports:MessagePort[])=>ports[0].postMessage("received"));
 const f=fixture([{url:"https://office.example/office",focus,navigate,postMessage}]);
 await f.fire("notificationclick",{notification:{close:vi.fn(),data:{eventId:"11111111-1111-4111-8111-111111111111"}}});
 expect(focus).toHaveBeenCalledTimes(1);expect(navigate).not.toHaveBeenCalled();expect(f.openWindow).not.toHaveBeenCalled();
});
