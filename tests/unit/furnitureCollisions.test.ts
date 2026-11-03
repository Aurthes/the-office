// @vitest-environment node
import fs from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Builder, buildShipGeometry, disposeShipGeometry, FURNITURE_MODELS, type ModelTemplates } from "@/features/ring-ship/geometry";
import { furnitureNear, furnitureHitsSegment, registerFurniture, type FurnitureBox } from "@/features/ring-ship/furnitureCollisions";
import { buildShipLayout, cabinAngle, shipDeck, shipPoint } from "@/features/ring-ship/layout";
import { isWalkable, walkableSegment } from "@/features/ring-ship/walkableSurface";
import { advanceCrew, canvasPoint, crewBodies, hash, syncCrew, worldPoint } from "@/features/ring-ship/crewMotion";
import { insideHibernation } from "@/features/ring-ship/hibernationMotion";
import { BREAK_ROOM, breakSeatKey, breakSeatPose } from "@/features/ring-ship/breakRoomLayout";
import { freeBreakSeat } from "@/features/ring-ship/breakRoomMotion";
import { advanceCeo, ceoBody, createCeoState } from "@/features/ring-ship/ceoMotion";
import { companionBody, createCompanionState, advanceCompanion } from "@/features/ring-ship/companionMotion";
import { siteJourney } from "@/features/ring-ship/fieldwork";

let models: ModelTemplates;
const cleanup: Array<() => void> = [];
beforeAll(async () => {
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) });
  models = Object.fromEntries(await Promise.all(FURNITURE_MODELS.map(async name => {
    const bytes = await fs.readFile(`public/office-assets/models/furniture/${name}.glb`);
    return [name, (await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, "")).scene];
  })));
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); });
function fixture() {
  const full = buildShipLayout({ projects: [{ id: "p", name: "P" }], members: [{ id: "worker", projectId: "p" }] });
  const layout = shipDeck(full, 0), group = buildShipGeometry(layout, models);
  cleanup.push(() => disposeShipGeometry(group), registerFurniture(layout, group.userData.shipCollisionBoxes));
  return { layout, full, group, boxes: group.userData.shipCollisionBoxes as FurnitureBox[] };
}
const distance = (a: {x:number;z:number}, b: {x:number;z:number}) => Math.hypot(a.x-b.x,a.z-b.z);

describe("rendered ship furniture collisions", () => {
  it("blocks actual table, chair and sofa models at their rotated positions, on their own deck", () => {
    const { layout, full, boxes } = fixture();
    for (const kind of ["workstation", "chairDesk", "loungeSofa", "tableRound", "tableCoffee", "loungeDesignChair"]) {
      const matches = boxes.filter(box => box.owner.includes(`:${kind}:`));
      expect(matches.length, kind).toBeGreaterThan(0);
      for (const box of matches) {
        expect(isWalkable({ x:box.x,z:box.y }, layout, .1), box.owner).toBe(false);
        expect(furnitureNear(full, 0, {x:box.x,z:box.y}, .1)).toContain(box);
        expect(furnitureNear(full, 1, {x:box.x,z:box.y}, .1)).not.toContain(box);
      }
    }
  });
  it("keeps floor mats and overhead decorations out of the walking volume", () => {
    const { layout } = fixture(), b = new Builder({}); b.cabin=layout.cabins[0];
    b.object("exerciseMat",()=>b.box([2,.045,1.2],[0,.08,0],"#fff"));
    b.object("serviceLight",()=>b.box([2,.1,2],[0,2,0],"#fff"));
    b.object("rainforestTree",()=>{ b.box([.2,2,.2],[0,1,0],"#fff"); b.box([3,.3,3],[0,2.5,0],"#fff"); });
    const group=b.finish(); cleanup.push(()=>disposeShipGeometry(group));
    const boxes=group.userData.shipCollisionBoxes as FurnitureBox[];
    expect(boxes).toHaveLength(1); expect(boxes[0].halfX).toBeCloseTo(.1); expect(boxes[0].halfY).toBeCloseTo(.1);
  });
  it("lets only the seat owner sit down, without opening a path through the desk", () => {
    const { layout }=fixture(), seat=layout.seats.worker, actor={id:"worker"};
    expect(isWalkable(seat,layout,.4,0,actor)).toBe(true);
    expect(isWalkable(seat,layout,.4)).toBe(false);
    const through={x:seat.x+Math.sin(seat.facing)*1.5,z:seat.z+Math.cos(seat.facing)*1.5};
    expect(walkableSegment(seat,through,layout,.4,0,actor)).toBe(false);
    const room=layout.cabins.find(c=>c.kind==="break")!;
    for(let i=0;i<BREAK_ROOM.seats.length;i++){
      const pose=breakSeatPose(layout,room,i), visitor={id:"visitor",reservedSeat:breakSeatKey(room.id,i)};
      expect(isWalkable(pose.point,layout,.4,0,visitor),`seat ${i}`).toBe(true);
      expect(walkableSegment(pose.approach,pose.point,layout,.4,0,visitor),`approach ${i} ${JSON.stringify(furnitureNear(layout,0,pose.approach,.4,pose.point).filter(b=>furnitureHitsSegment(b,pose.approach,pose.point,.4,visitor)))}`).toBe(true);
      expect(isWalkable(pose.point,layout,.4)).toBe(false);
    }
    expect(freeBreakSeat(layout,room,{id:"visitor",position:seat,radius:.43,deck:0},[],0)).toBe(0);
  });
  it("takes a break and returns to work with real furniture present", () => {
    const {layout}=fixture();
    const a=syncCrew([{id:"worker",name:"Worker",status:"idle",color:"#abc",item:""}],layout,new Map(),0)[0];
    a.pauseUntil=0; a.outings=(1-hash(a.id)%3+3)%3;
    advanceCrew([a],layout,1,.05);
    expect(a.breakVisit).toBeDefined();
    for(let i=0;i<9000&&a.route.length;i++){
      const before=worldPoint(a); advanceCrew([a],layout,2,.05);
      expect(distance(before,worldPoint(a))).toBeLessThanOrEqual(.052501);
    }
    expect(a.route.length,JSON.stringify({p:worldPoint(a),target:a.route[a.routeIndex],index:a.routeIndex})).toBe(0);
    expect(a.state).toBe("sitting");
    a.status="working";
    for(let i=0;i<9000&&(i===0||a.route.length);i++){
      const before=worldPoint(a); advanceCrew([a],layout,3,.05);
      expect(distance(before,worldPoint(a))).toBeLessThanOrEqual(.105001);
    }
    expect(distance(worldPoint(a),a.home),JSON.stringify({p:worldPoint(a),target:a.route[a.routeIndex]})).toBeLessThan(.001);
    expect(a.interactionTarget).toBe("desk");
    const homeCabin=layout.cabins.find(c=>c.id===layout.seats.worker.cabinId)!;
    const journey=siteJourney(layout,worldPoint(a),0,homeCabin,a.home,{id:a.id});
    expect(distance(journey[0].points.at(-1)!,a.home)).toBeLessThan(.001);
  },15000);
  it("keeps the CEO and roaming pets on clear floor through their routines", () => {
    const {layout}=fixture(),ceo=createCeoState(layout,123),dog=createCompanionState("dog",layout,456);
    // Start away from the chairs, as a newly loaded model may require one recovery step.
    const lounge=layout.cabins.find(c=>c.kind==="lounge")!;
    dog.position=shipPoint(layout.rings[lounge.ring].radius,cabinAngle(layout,lounge.slot));
    const actions=new Set<string>(), rooms=new Set<string>();
    for(let i=0;i<9000;i++){
      advanceCeo(ceo,layout,.05); advanceCompanion(dog,layout,.05);
      expect(isWalkable(ceo.position,layout,.4,0,ceoBody(ceo)),`CEO ${i} ${JSON.stringify(ceo)}`).toBe(true);
      expect(isWalkable(dog.position,layout,.4,0,companionBody(dog)),`dog ${i}`).toBe(true);
      actions.add(ceo.action); rooms.add(dog.cabinId);
    }
    expect(actions.size,JSON.stringify({ceo,actions:[...actions]})).toBeGreaterThan(4);
    expect(rooms.size).toBeGreaterThan(1);
  },20000);
  it.each(["desk", "break chair"])("goes to sleep from a %s and wakes back to work with real furniture present", start => {
    const { layout } = fixture(), wall = 1_800_000_000_000;
    const a = syncCrew([{ id: "worker", name: "Worker", status: "idle", color: "#abc", item: "", lastActivityAt: wall - 3_600_001 }], layout, new Map(), 0)[0];
    if (start === "break chair") {
      const room = layout.cabins.find(c => c.kind === "break")!;
      Object.assign(a, canvasPoint(breakSeatPose(layout, room, 0).point));
      a.breakVisit = { cabinId: room.id, seat: 0, action: "tea", outward: [] }; a.visiting = true;
    }
    const until = (done: () => boolean) => {
      for (let i = 0; i < 9000 && !done(); i++) {
        const before = worldPoint(a); advanceCrew([a], layout, i * 50, .05, undefined, [], wall);
        expect(distance(before, worldPoint(a))).toBeLessThan(.14);
        if (!insideHibernation(a.hibernation)) expect(isWalkable(worldPoint(a), layout, .35, a.deck, crewBodies([a], layout)[0])).toBe(true);
      }
      expect({ done: done(), phase: a.hibernation?.phase, point: worldPoint(a), next: a.route[a.routeIndex] }).toMatchObject({ done: true });
    };
    until(() => a.hibernation?.phase === "sleeping");
    a.status = "working"; until(() => !a.hibernation && a.interactionTarget === "desk");
    expect(distance(worldPoint(a), a.home)).toBeLessThan(.001);
  }, 15000);
});
