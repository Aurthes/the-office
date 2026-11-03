import { describe, expect, it } from "vitest";
import { buildShipLayout, cabinAngle, routeBetweenCabins } from "@/features/ring-ship/layout";
import { BAR_LAYOUT, barPoint } from "@/features/ring-ship/barLayout";
import { footingRadius, isWalkable, walkableSegment } from "@/features/ring-ship/walkableSurface";
import { moveCharacter, occupiedWaypoint } from "@/features/ring-ship/characterCollision";

describe("separate listening bar",()=>{
  it("reserves one independent cabin next to the lounge and preserves every worker when upgrading an occupied bay",()=>{
    const roster={projects:[{id:"p",name:"P"}],members:[{id:"a",projectId:"p"}]};
    const previous={version:1 as const,sectors:8,projects:{p:{deck:0 as const,ring:0 as const,slot:7,span:1}}};
    const layout=buildShipLayout(roster,previous),bar=layout.cabins.find(c=>c.kind==="bar")!,lounge=layout.cabins.find(c=>c.kind==="lounge"&&c.deck===0)!;
    expect(layout.cabins.filter(c=>c.kind==="bar")).toHaveLength(1);
    expect(bar.deck).toBe(lounge.deck);expect(bar.ring).toBe(lounge.ring);
    expect((bar.slot+1)%layout.allocation.sectors).toBe(lounge.slot);
    expect(bar.agentIds).toEqual([]);expect(bar.projectId).toBeUndefined();
    expect(layout.seats.a.projectId).toBe("p");expect(layout.seats.a.cabinId).not.toBe(bar.id);
    expect(layout.allocation.sectors).toBe(previous.sectors);
    expect(buildShipLayout(roster,layout.allocation).allocation).toEqual(layout.allocation);
    const grown=buildShipLayout(roster,{...layout.allocation,sectors:9}),grownBar=grown.cabins.find(c=>c.kind==="bar")!;
    expect((grownBar.slot+1)%grown.allocation.sectors).toBe(lounge.slot);
  });
  it("keeps the counter, stools and turntable solid while leaving the front and staff aisles open",()=>{
    const layout=buildShipLayout({projects:[],members:[]}),bar=layout.cabins.find(c=>c.kind==="bar")!;
    expect(isWalkable(barPoint(layout,bar,0,0),layout,.4,bar.deck)).toBe(false);
    for(const x of BAR_LAYOUT.stoolXs)expect(isWalkable(barPoint(layout,bar,x,BAR_LAYOUT.stoolZ),layout,.4,bar.deck)).toBe(false);
    expect(isWalkable(barPoint(layout,bar,BAR_LAYOUT.turntable.x,BAR_LAYOUT.turntable.z),layout,.4,bar.deck)).toBe(false);
    expect(walkableSegment(barPoint(layout,bar,-1.65,BAR_LAYOUT.staffZ),barPoint(layout,bar,1.65,BAR_LAYOUT.staffZ),layout,.4,bar.deck)).toBe(true);
    expect(walkableSegment(barPoint(layout,bar,-4,-2.5),barPoint(layout,bar,4,-2.5),layout,.4,bar.deck)).toBe(true);
    expect(isWalkable(barPoint(layout,bar,0,0),layout,.4,1)).toBe(true);
    const center=barPoint(layout,bar,0,0),recovered=moveCharacter({id:"recovery",position:center,radius:.4,deck:bar.deck},center,0,[],true,layout);
    expect(isWalkable(recovered,layout,.4,bar.deck)).toBe(true);
  });
  it.each([[.524,.524],[.524,.8],[.8,.8]])("lets opposing characters (%s, %s) pass the bar without overlap or deadlock",(first,second)=>{
    const layout=buildShipLayout({projects:[],members:[]}),bar=layout.cabins.find(c=>c.kind==="bar")!,center=cabinAngle(layout,bar.slot);
    const paths=[-1,1].map(direction=>routeBetweenCabins(layout,{ring:bar.ring,angle:center-direction*.6},bar,center+direction*.6));
    const bodies=paths.map((path,i)=>({id:String(i),position:{...path[0]},radius:i?second:first,deck:bar.deck})),waypoints=[1,1];
    for(let frame=0;frame<2200&&waypoints.some((n,i)=>n<paths[i].length);frame++){
      bodies.forEach((body,i)=>{
        const target=paths[i][waypoints[i]];if(!target)return;
        body.position=moveCharacter(body,target,.035,bodies,true,layout);
        const distance=Math.hypot(body.position.x-target.x,body.position.z-target.z),following=paths[i][waypoints[i]+1];
        // Use the same occupied-waypoint rule as crew and companion routing:
        // pass an occupied intermediate point when the next segment is clear.
        if(distance<.01||(distance<body.radius*2+.15&&occupiedWaypoint(body,target,bodies)&&(!following||walkableSegment(body.position,following,layout,.4,bar.deck))))waypoints[i]++;
      });
      expect(Math.hypot(bodies[0].position.x-bodies[1].position.x,bodies[0].position.z-bodies[1].position.z)).toBeGreaterThanOrEqual(first+second-1e-6);
      bodies.forEach(body=>expect(isWalkable(body.position,layout,footingRadius(body.radius),bar.deck)).toBe(true));
    }
    expect(waypoints,JSON.stringify({bodies,targets:paths.map((path,i)=>{const target=path[waypoints[i]];return{target,walkable:target&&isWalkable(target,layout,.4),segment:target&&walkableSegment(bodies[i].position,target,layout,.4)}})})).toEqual(paths.map(path=>path.length));
  });
});
