import { describe, expect, it } from "vitest";
import { areaBounds, buildShipLayout, cabinAngle, CLONING_AISLE_V, CLONING_POD, parseShipAllocation, routeBetweenCabins } from "@/features/ring-ship/layout";
import { CLONE_DURATION, cloneAnatomy, clonePose, cloneStage, cloningPoint, rejoinCrewAfterClone } from "@/features/ring-ship/cloneMotion";
import { advanceCrew, syncCrew, worldPoint } from "@/features/ring-ship/crewMotion";
import type { OfficeAgent } from "@/features/retro-office/core/types";
import { defaultStudioSettings, mergeStudioSettings, sanitizeStudioSettings } from "@/lib/studio/settings";
import { createDefaultAgentAvatarProfile } from "@/lib/avatars/profile";
import { createDuckAppearanceFromSeed } from "@/lib/avatars/duck";
import { cloneAgentPreferences } from "@/lib/office/clone";
import { CEO_ID } from "@/lib/office/organization";
import { footingRadius, isWalkable, walkableSegment } from "@/features/ring-ship/walkableSurface";
import { moveCharacter } from "@/features/ring-ship/characterCollision";

const roster = { projects: [{ id: "p", name: "Department" }], members: [{ id: "source", projectId: "p" }, { id: "clone", projectId: "p" }] };
describe("cloning laboratory",()=>{
  it("adopts one ready cabin and protects it across growth without moving existing projects",()=>{
    const old=buildShipLayout(roster),legacy={...old.allocation,cloningRoom:undefined};
    const upgraded=buildShipLayout(roster,legacy),lab=upgraded.cabins.find(c=>c.kind==="cloning")!;
    expect(lab.deck).toBe(0);expect(upgraded.allocation.projects).toEqual(old.allocation.projects);
    const grown=buildShipLayout({projects:[...roster.projects,{id:"other",name:"Other"}],members:[...roster.members,{id:"new",projectId:"other"}]},upgraded.allocation);
    expect(grown.allocation.cloningRoom).toEqual(upgraded.allocation.cloningRoom);
    expect(grown.cabins.filter(c=>c.kind==="cloning")).toHaveLength(1);
    expect(parseShipAllocation(JSON.stringify({...grown.allocation,cloningRoom:{deck:4,ring:1,slot:0}}))).toBeUndefined();
  });
  it("focuses only the compact lab while keeping the saved bay and department placements",()=>{
    const layout=buildShipLayout(roster),lab=layout.cabins.find(c=>c.kind==="cloning")!;
    const fullBay={...layout,cabins:layout.cabins.map(c=>c===lab?{...c,kind:"reserve" as const}:c)};
    const compact=areaBounds(layout,lab.id),wide=areaBounds(fullBay,lab.id);
    expect(compact.width*compact.depth/(wide.width*wide.depth)).toBeLessThan(.5);
    expect(buildShipLayout(roster,layout.allocation).allocation).toEqual(layout.allocation);
  });
  it("fits the full-size pods and pad on the floor and leaves a walkable exit aisle",()=>{
    const layout=buildShipLayout(roster),lab=layout.cabins.find(c=>c.kind==="cloning")!;
    const empty={...layout,cabins:layout.cabins.filter(c=>c!==lab)};
    for(const u of [-3.25,3.25])for(const v of [-2.45,3.15])expect(isWalkable(cloningPoint(layout,lab,u,v),empty,0,lab.deck)).toBe(true);
    for(const side of [-1,1])for(const du of [-1,1])for(const dv of [-1,1]){
      const p=cloningPoint(layout,lab,side*CLONING_POD.spacing+du*CLONING_POD.width/2,CLONING_POD.v+dv*CLONING_POD.length/2);
      expect(isWalkable(p,empty,0,lab.deck)).toBe(true);
    }
    expect(walkableSegment(cloningPoint(layout,lab,-3.5,CLONING_AISLE_V),cloningPoint(layout,lab,3.5,CLONING_AISLE_V),layout,.4,lab.deck)).toBe(true);
  });
  it.each([[.524,.524],[.524,.8],[.8,.8]])("lets opposing characters (%s, %s) pass the lab without overlap or deadlock",(first,second)=>{
    const layout=buildShipLayout(roster),lab=layout.cabins.find(c=>c.kind==="cloning")!,center=cabinAngle(layout,lab.slot);
    const paths=[-1,1].map(direction=>routeBetweenCabins(layout,{ring:lab.ring,angle:center-direction*.3},lab,center+direction*.3));
    const bodies=paths.map((path,i)=>({id:String(i),position:{...path[0]},radius:i?second:first,deck:lab.deck}));
    const waypoints=[1,1];
    for(let frame=0;frame<1800&&waypoints.some((n,i)=>n<paths[i].length);frame++){
      bodies.forEach((body,i)=>{const target=paths[i][waypoints[i]];if(!target)return;body.position=moveCharacter(body,target,.035,bodies,true,layout);if(Math.hypot(body.position.x-target.x,body.position.z-target.z)<.01)waypoints[i]++;});
      expect(Math.hypot(bodies[0].position.x-bodies[1].position.x,bodies[0].position.z-bodies[1].position.z)).toBeGreaterThanOrEqual(first+second-1e-6);
      bodies.forEach(body=>expect(isWalkable(body.position,layout,footingRadius(body.radius),lab.deck)).toBe(true));
    }
    expect(waypoints).toEqual(paths.map(path=>path.length));
  });
  it("holds both pods until a real fork is confirmed, and never treats a delay as success",()=>{
    expect(cloneStage(10000,{status:"pending"})).toBe("synchronizing");
    expect(cloneStage(10000,{status:"failed",error:"lost acknowledgement"})).toBe("failed");
    const confirmed={status:"confirmed" as const,threadId:"clone",at:123};
    expect([0,4,7,9.5,11,13,15,CLONE_DURATION].map(t=>cloneStage(t,confirmed))).toEqual(["skeleton","tissue","skin","opening","waking","stepping","returning","complete"]);
  });
  it("finishes internal layers before skin and keeps passengers lying down until the lid is fully open",()=>{
    expect(cloneAnatomy(0)).toEqual({bone:0,tissue:0,skin:0});
    expect(cloneAnatomy(3.4)).toEqual({bone:1,tissue:0,skin:0});
    expect(cloneAnatomy(6.2)).toEqual({bone:1,tissue:1,skin:0});
    expect(cloneAnatomy(9.2)).toEqual({bone:1,tissue:1,skin:1});
    for(let t=0;t<=10.5;t+=.1){expect(clonePose(t,0).tilt).toBeCloseTo(-Math.PI/2);expect(clonePose(t,1).tilt).toBeCloseTo(-Math.PI/2);}
    expect(clonePose(9,0).door).toBe(0);
    expect(clonePose(11,0).door).toBe(1);
  });
  it("gets both passengers off separate beds and rejoins collision-aware daily movement continuously",()=>{
    const layout=buildShipLayout(roster),lab=layout.cabins.find(c=>c.kind==="cloning")!;
    expect(clonePose(0,0).tilt).toBe(-Math.PI/2);expect(clonePose(0,0).door).toBe(0);
    expect(clonePose(10.5,0).door).toBe(1);expect(clonePose(CLONE_DURATION,0).tilt).toBeCloseTo(0);expect(clonePose(CLONE_DURATION,0).y).toBeCloseTo(.08);
    const agents=syncCrew(roster.members.map(({id})=>({id,name:id,status:"idle",color:"#abc",item:""} as OfficeAgent)),layout,new Map(),0);
    const exits=agents.map((a,i)=>{const p=clonePose(CLONE_DURATION,i),point=cloningPoint(layout,lab,p.u,p.v);rejoinCrewAfterClone(a,layout,{point,deck:lab.deck,cabinId:lab.id});return point;});
    expect(Math.hypot(exits[0].x-exits[1].x,exits[0].z-exits[1].z)).toBeCloseTo(4);
    for(let i=0;i<agents.length;i++){expect(worldPoint(agents[i]).x).toBeCloseTo(exits[i].x);expect(worldPoint(agents[i]).z).toBeCloseTo(exits[i].z);}
    const before=agents.map(worldPoint);advanceCrew(agents,layout,1,1/60);
    for(let i=0;i<agents.length;i++)expect(Math.hypot(worldPoint(agents[i]).x-before[i].x,worldPoint(agents[i]).z-before[i].z)).toBeLessThan(.1);
  });
  it("randomizes appearance like a new agent while copying title and upward reporting lines without changing the source",()=>{
    const profile={...createDefaultAgentAvatarProfile("source"),duck:createDuckAppearanceFromSeed("source")};
    const settings=mergeStudioSettings(defaultStudioSettings(),{avatars:{gateway:{source:profile}},office:{gateway:{organization:{[CEO_ID]:{title:"CEO",reportsTo:[]},source:{title:"Manager",reportsTo:[CEO_ID]},peer:{title:"Worker",reportsTo:["source"]}}}}});
    const snapshot=JSON.stringify(settings),patch=cloneAgentPreferences(sanitizeStudioSettings(settings),"gateway","source","clone");
    expect(patch.avatars?.gateway?.clone).toEqual({...createDefaultAgentAvatarProfile("clone"),duck:createDuckAppearanceFromSeed("clone")});
    expect(patch.avatars?.gateway?.clone).not.toEqual(profile);
    expect(cloneAgentPreferences(sanitizeStudioSettings(settings),"gateway","source","clone")).toEqual(patch);
    expect(patch.office?.gateway?.organization).toEqual({clone:{title:"Manager",reportsTo:[CEO_ID]}});
    expect(Object.keys(patch).sort()).toEqual(["avatars","office"]);
    expect(JSON.stringify(settings)).toBe(snapshot);
    expect(patch.avatars?.gateway?.clone).not.toBe(profile);
  });
  it("blocks the pod bodies and steps without blocking the aisle, another deck or a swept crossing",()=>{
    const layout=buildShipLayout(roster),lab=layout.cabins.find(c=>c.kind==="cloning")!;
    for(const u of [-2,2])for(const v of [1.05,-.75,-1.1])expect(isWalkable(cloningPoint(layout,lab,u,v),layout,.4,lab.deck)).toBe(false);
    const start=cloningPoint(layout,lab,-4,1.05),end=cloningPoint(layout,lab,4,1.05);
    expect(walkableSegment(start,end,layout,.4,lab.deck)).toBe(false);
    expect(walkableSegment(cloningPoint(layout,lab,-4,-2.1),cloningPoint(layout,lab,4,-2.1),layout,.4,lab.deck)).toBe(true);
    expect(isWalkable(cloningPoint(layout,lab,-2,1.05),layout,.4,(lab.deck+1)%3)).toBe(true);
    const inside=cloningPoint(layout,lab,-2,1.05),recovered=moveCharacter({id:"recovery",position:inside,radius:.4,deck:lab.deck},inside,0,[],true,layout);
    expect(isWalkable(recovered,layout,.4,lab.deck)).toBe(true);
    expect(Math.hypot(recovered.x-inside.x,recovered.z-inside.z)).toBeLessThan(2);
  });
  it("returns both cloned actors to their desks around solid equipment without teleporting",()=>{
    const layout=buildShipLayout(roster),lab=layout.cabins.find(c=>c.kind==="cloning")!;
    const agents=syncCrew(roster.members.map(({id})=>({id,name:id,status:"working",color:"#abc",item:""} as OfficeAgent)),layout,new Map(),0);
    agents.forEach((a,i)=>{const p=clonePose(CLONE_DURATION,i);rejoinCrewAfterClone(a,layout,{point:cloningPoint(layout,lab,p.u,p.v),deck:lab.deck,cabinId:lab.id});});
    for(let frame=0;frame<5000;frame++){
      const before=agents.map(worldPoint);advanceCrew(agents,layout,frame*1000/30,1/30);
      agents.forEach((a,i)=>{const p=worldPoint(a);expect(isWalkable(p,layout,.4,lab.deck)).toBe(true);expect(Math.hypot(p.x-before[i].x,p.z-before[i].z)).toBeLessThan(.15);});
      if(agents.every(a=>a.state==="sitting"))break;
    }
    expect(agents.map(a=>a.state)).toEqual(["sitting","sitting"]);
  });
  it("routes normal ring traffic around the pods in either direction",()=>{
    const layout=buildShipLayout(roster),lab=layout.cabins.find(c=>c.kind==="cloning")!,center=cabinAngle(layout,lab.slot);
    for(const direction of [-1,1]){
      const points=routeBetweenCabins(layout,{ring:lab.ring,angle:center-direction*.35},lab,center+direction*.35);
      for(let i=1;i<points.length;i++)expect(walkableSegment(points[i-1],points[i],layout,.4,lab.deck)).toBe(true);
    }
  });
});
