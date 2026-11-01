import {describe,it,expect} from "vitest";
import * as THREE from "three";
import {buildShipLayout,cabinAngle,shipDeck,shipPoint} from "@/features/ring-ship/layout";
import {returnRoute,returnStage,routePoint,returnLaunchDistance,RETURN_LAUNCH_DURATION} from "@/features/ring-ship/returnPodMotion";
import {cabinDeck} from "@/features/ring-ship/shell-shapes";
import {buildShell} from "@/features/ring-ship/shell";
import {disposeShipGeometry} from "@/features/ring-ship/geometry";
describe("return pod",()=>{
  it("never launches merely because walking and closing timers finished",()=>{
    expect(returnStage(60,4,{status:"pending"})).toEqual({stage:"waiting",launch:0});
    expect(returnStage(60,4,{status:"failed"})).toEqual({stage:"failed",launch:0});
    expect(returnStage(4,4,{status:"confirmed",at:1}).stage).toBe("boarding");
    expect(returnStage(5.5,4,{status:"confirmed",at:1}).stage).toBe("sealing");
    expect(returnStage(10,4,{status:"confirmed",at:10})).toEqual({stage:"launching",launch:0});
    expect(returnStage(10+RETURN_LAUNCH_DURATION/2,4,{status:"confirmed",at:10}).launch).toBeCloseTo(.5);
    expect(returnStage(10+RETURN_LAUNCH_DURATION+.01,4,{status:"confirmed",at:10}).stage).toBe("done");
    // Clear the whole launch tube within 200 ms and accelerate all the way
    // out, instead of drifting through a fixed-duration visual interpolation.
    expect(returnLaunchDistance(0)).toBe(0);
    expect(returnLaunchDistance(.2)).toBeGreaterThan(4.25);
    expect(returnLaunchDistance(.2)-returnLaunchDistance(.1)).toBeGreaterThan(returnLaunchDistance(.1));
    expect(RETURN_LAUNCH_DURATION).toBeLessThan(.6);
    expect(returnLaunchDistance(RETURN_LAUNCH_DURATION)).toBeCloseTo(16);
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
