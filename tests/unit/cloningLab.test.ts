import { describe, expect, it } from "vitest";
import { buildShipLayout, parseShipAllocation } from "@/features/ring-ship/layout";
import { clonePose, cloneStage, cloningPoint, rejoinCrewAfterClone } from "@/features/ring-ship/cloneMotion";
import { advanceCrew, syncCrew, worldPoint } from "@/features/ring-ship/crewMotion";
import type { OfficeAgent } from "@/features/retro-office/core/types";
import { defaultStudioSettings, mergeStudioSettings, sanitizeStudioSettings } from "@/lib/studio/settings";
import { createDefaultAgentAvatarProfile } from "@/lib/avatars/profile";
import { createDuckAppearanceFromSeed } from "@/lib/avatars/duck";
import { cloneAgentPreferences } from "@/lib/office/clone";
import { CEO_ID } from "@/lib/office/organization";

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
  it("holds both pods until a real fork is confirmed, and never treats a delay as success",()=>{
    expect(cloneStage(10000,{status:"pending"})).toBe("synchronizing");
    expect(cloneStage(10000,{status:"failed",error:"lost acknowledgement"})).toBe("failed");
    const confirmed={status:"confirmed" as const,threadId:"clone",at:123};
    expect([0,1,2.5,4.5,6].map(t=>cloneStage(t,confirmed))).toEqual(["opening","waking","stepping","returning","complete"]);
  });
  it("gets both passengers off separate beds and rejoins collision-aware daily movement continuously",()=>{
    const layout=buildShipLayout(roster),lab=layout.cabins.find(c=>c.kind==="cloning")!;
    expect(clonePose(0,0).tilt).toBe(-Math.PI/2);expect(clonePose(0,0).door).toBe(0);
    expect(clonePose(1,0).door).toBe(1);expect(clonePose(6,0).tilt).toBeCloseTo(0);expect(clonePose(6,0).y).toBeCloseTo(.08);
    const agents=syncCrew(roster.members.map(({id})=>({id,name:id,status:"idle",color:"#abc",item:""} as OfficeAgent)),layout,new Map(),0);
    const exits=agents.map((a,i)=>{const p=clonePose(6,i),point=cloningPoint(layout,lab,p.u,p.v);rejoinCrewAfterClone(a,layout,{point,deck:lab.deck});return point;});
    expect(Math.hypot(exits[0].x-exits[1].x,exits[0].z-exits[1].z)).toBeCloseTo(4);
    for(let i=0;i<agents.length;i++){expect(worldPoint(agents[i]).x).toBeCloseTo(exits[i].x);expect(worldPoint(agents[i]).z).toBeCloseTo(exits[i].z);}
    const before=agents.map(worldPoint);advanceCrew(agents,layout,1,1/60);
    for(let i=0;i<agents.length;i++)expect(Math.hypot(worldPoint(agents[i]).x-before[i].x,worldPoint(agents[i]).z-before[i].z)).toBeLessThan(.1);
  });
  it("copies appearance, title and upward reporting lines without changing the source or copying other agents",()=>{
    const profile={...createDefaultAgentAvatarProfile("source"),duck:createDuckAppearanceFromSeed("source")};
    const settings=mergeStudioSettings(defaultStudioSettings(),{avatars:{gateway:{source:profile}},office:{gateway:{organization:{[CEO_ID]:{title:"CEO",reportsTo:[]},source:{title:"Manager",reportsTo:[CEO_ID]},peer:{title:"Worker",reportsTo:["source"]}}}}});
    const snapshot=JSON.stringify(settings),patch=cloneAgentPreferences(sanitizeStudioSettings(settings),"gateway","source","clone");
    expect(patch.avatars?.gateway?.clone).toEqual(profile);
    expect(patch.office?.gateway?.organization).toEqual({clone:{title:"Manager",reportsTo:[CEO_ID]}});
    expect(Object.keys(patch).sort()).toEqual(["avatars","office"]);
    expect(JSON.stringify(settings)).toBe(snapshot);
    expect(patch.avatars?.gateway?.clone).not.toBe(profile);
  });
});
