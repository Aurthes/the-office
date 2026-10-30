import {describe,it,expect,vi} from "vitest";
import {createRequire} from "node:module";
import * as THREE from "three";
import {buildShipLayout,cabinAngle,shipDeck,shipPoint} from "@/features/ring-ship/layout";
import {returnRoute,returnStage,routePoint} from "@/features/ring-ship/returnPodMotion";
import {cabinDeck} from "@/features/ring-ship/shell-shapes";
import {buildShell} from "@/features/ring-ship/shell";
import {disposeShipGeometry} from "@/features/ring-ship/geometry";
const {CodexWorkspaceActions}=createRequire(import.meta.url)("../../server/codex-workspace-actions.js");
describe("return pod and native archive",()=>{
  it("uses native archive for the exact original id, without a prompt, delete, or local DB writes",async()=>{
    const client={ready:true,call:vi.fn(async(method:string)=>method==="thread/read"?{thread:{id:"original",status:{type:"idle"}}}:{})};
    const actions=new CodexWorkspaceActions(client), input={threadId:"original",requestId:"return-1"};
    await expect(actions.archiveSession(input)).resolves.toEqual({threadId:"original",archived:true});
    await actions.archiveSession(input);
    expect(client.call.mock.calls).toEqual([["thread/read",{threadId:"original",includeTurns:false}],["thread/archive",{threadId:"original"}]]);
  });
  it("rejects active work and never reports a failed/uncertain native archive as success",async()=>{
    const client={ready:true,call:vi.fn(async(method:string)=>{expect(method).toBe("thread/read");return {thread:{id:"original",status:{type:"active"}}};})};
    const actions=new CodexWorkspaceActions(client);
    await expect(actions.archiveSession({threadId:"original",requestId:"busy"})).rejects.toThrow("还在工作");
    expect(client.call).toHaveBeenCalledTimes(1);
    client.call.mockImplementation(async(method?:string)=>{
      if(method==="thread/read") return {thread:{id:"original",status:{type:"idle"}}};
      throw new Error("response lost");
    });
    const uncertain={threadId:"original",requestId:"uncertain"};
    await expect(actions.archiveSession(uncertain)).rejects.toThrow("response lost");
    await expect(actions.archiveSession(uncertain)).rejects.toThrow("response lost");
    expect(client.call.mock.calls.filter(c=>c[0]==="thread/archive")).toHaveLength(1);
  });
  it("never launches merely because walking and closing timers finished",()=>{
    expect(returnStage(60,4,{status:"pending"})).toEqual({stage:"waiting",launch:0});
    expect(returnStage(60,4,{status:"failed"})).toEqual({stage:"failed",launch:0});
    expect(returnStage(4,4,{status:"confirmed",at:1}).stage).toBe("boarding");
    expect(returnStage(5.5,4,{status:"confirmed",at:1}).stage).toBe("sealing");
    expect(returnStage(10,4,{status:"confirmed",at:10})).toEqual({stage:"launching",launch:0});
    expect(returnStage(10.8,4,{status:"confirmed",at:10}).launch).toBeCloseTo(.5);
    expect(returnStage(12,4,{status:"confirmed",at:10}).stage).toBe("done");
  });
  it("provides one return room below all other decks, with walkable routes and lift transfer",()=>{
    const layout=buildShipLayout({projects:[{id:"p",name:"Project"}],members:[{id:"a",projectId:"p"}]});
    expect(layout.cabins.filter(c=>c.kind==="return").map(c=>c.deck)).toEqual([0]);
    const seat=layout.seats.a, route=returnRoute(layout,seat,seat);
    expect(route.legs[0].points[0]).toEqual({x:seat.x,z:seat.z});
    expect(routePoint(route.legs[0].points,1)).toEqual(route.entry);
    expect(Math.hypot(route.pod.x-route.entry.x,route.pod.z-route.entry.z)).toBeCloseTo(1.95);
    expect(route.duration).toBeLessThanOrEqual(10);
    const bay=layout.cabins.find(c=>c.id===route.bayId)!;
    expect(bay.agentIds).toEqual([]);expect(bay.projectId).toBeUndefined();
    const upstairs=returnRoute(layout,{...seat,deck:2},seat);
    expect(upstairs.legs.map(l=>l.deck)).toEqual([2,0]);
    expect(upstairs.legs[0].points.at(-1)).toEqual(upstairs.legs[1].points[0]);
    expect(Math.hypot(upstairs.legs[1].points[0].x,upstairs.legs[1].points[0].z)).toBeCloseTo(3.8);
    expect(upstairs.legs[1].points.at(-1)).toEqual(route.entry);
    for(const leg of upstairs.legs)for(let i=1;i<leg.points.length;i++)for(let n=0;n<=8;n++){
      const a=leg.points[i-1],b=leg.points[i],x=a.x+(b.x-a.x)*n/8,z=a.z+(b.z-a.z)*n/8,r=Math.hypot(x,z);
      const onRing=layout.rings.some(ring=>Math.abs(r-ring.radius)<ring.depth/2);
      const onSpoke=layout.spokes.some(t=>Math.abs(x*Math.cos(t)-z*Math.sin(t))<.63);
      expect(onRing||onSpoke).toBe(true);
    }
  });
  it("opens the real deck and curved belly so a full-width pod can pass without clipping",()=>{
    const layout=buildShipLayout({projects:[],members:[]}), bay=layout.cabins.find(c=>c.kind==="return")!;
    const angle=cabinAngle(layout,bay.slot), ring=layout.rings[bay.ring], point=shipPoint(ring.radius+1.8,angle);
    const step=2*Math.PI/layout.allocation.sectors;
    const deck=new THREE.Mesh(cabinDeck(ring.radius,ring.depth/2,bay.slot*step,(bay.slot+1)*step,{...point,radius:1.02}),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    const shell=buildShell(shipDeck(layout,0));shell.group.updateMatrixWorld(true);deck.updateMatrixWorld(true);
    for(const dx of [-.8,0,.8])for(const dz of [-.8,0,.8]){
      if(Math.hypot(dx,dz)>.8)continue;
      const ray=new THREE.Raycaster(new THREE.Vector3(point.x+dx,.5,point.z+dz),new THREE.Vector3(0,-1,0),0,9);
      expect(ray.intersectObject(deck)).toHaveLength(0);
      expect(ray.intersectObject(shell.group,true)).toHaveLength(0);
    }
    const side=shipPoint(ring.radius-1.3,angle);
    expect(new THREE.Raycaster(new THREE.Vector3(side.x,2,side.z),new THREE.Vector3(0,-1,0)).intersectObject(deck)).toHaveLength(1);
    deck.geometry.dispose();(deck.material as THREE.Material).dispose();disposeShipGeometry(shell.group);
  });
});
