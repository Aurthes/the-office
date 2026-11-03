import type { ShipCabin, ShipLayout } from "./layout";
import type { CollisionBox } from "@/features/retro-office/core/collision";

export const BAR_LAYOUT = {
  radial: 1.15,
  counter: 1.33,
  width: 4.75, depth: .92,
  staffZ: .9,
  stoolXs: [-1.55, -.05, 1.45], stoolZ: -.9, stoolRadius: .29,
  turntable: { x: -3.3, z: .6, width: .9, depth: 1.3 },
  aisle: -1.45, routeHalfWidth: 4.8,
  bottles: [
    { x: -1.95, height: .31, color: "#315b43" },
    { x: -1.67, height: .25, color: "#96552d" },
    { x: -1.4, height: .35, color: "#3a665b" },
  ],
} as const;

export function barPoint(layout: ShipLayout, cabin: ShipCabin, x: number, z: number) {
  const angle = (cabin.slot + .5) * Math.PI * 2 / layout.allocation.sectors, radius = layout.rings[cabin.ring].radius + BAR_LAYOUT.radial;
  const center = { x: Math.sin(angle)*radius, z: Math.cos(angle)*radius };
  return { x: center.x + Math.cos(angle) * x + Math.sin(angle) * z, z: center.z - Math.sin(angle) * x + Math.cos(angle) * z };
}

const collisionCache = new WeakMap<ShipLayout, Map<number, CollisionBox[]>>();
export function barCollisionBoxes(layout: ShipLayout, deck: number): CollisionBox[] {
  let decks=collisionCache.get(layout);if(!decks){decks=new Map();collisionCache.set(layout,decks);}
  const saved=decks.get(deck);if(saved)return saved;
  const boxes=layout.cabins.filter(c=>c.kind==="bar"&&c.deck===deck).flatMap(cabin=>{
    const fixtures=[{id:"counter",x:0,z:0,width:BAR_LAYOUT.width,depth:BAR_LAYOUT.depth},
      ...BAR_LAYOUT.stoolXs.map((x,i)=>({id:`stool:${i}`,x,z:BAR_LAYOUT.stoolZ,width:BAR_LAYOUT.stoolRadius*2,depth:BAR_LAYOUT.stoolRadius*2})),
      {id:"turntable",...BAR_LAYOUT.turntable}];
    return fixtures.map(f=>{const p=barPoint(layout,cabin,f.x,f.z);return{owner:`${cabin.id}:${f.id}`,x:p.x,y:p.z,halfX:f.width/2,halfY:f.depth/2,angle:-(cabin.slot+.5)*Math.PI*2/layout.allocation.sectors,bottom:0,top:BAR_LAYOUT.counter};});
  });
  decks.set(deck,boxes);return boxes;
}
