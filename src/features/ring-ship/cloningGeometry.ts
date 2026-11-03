import { cabinAngle, cloningPoint, CLONING_POD, type ShipLayout } from "./layout";
import type { CollisionBox } from "@/features/retro-office/core/collision";
export { cloningPoint, CLONING_POD } from "./layout";

// One footprint for rendering and collision, including the two boarding steps.
export const CLONING_STEPS = [
  { v: -1.8, y: .28, width: 1.3, height: .16, length: .5 },
  { v: -2.15, y: .11, width: 1.3, height: .12, length: .35 },
] as const;
const collisionCache = new WeakMap<ShipLayout, Map<number, CollisionBox[]>>();
export function cloningCollisionBoxes(layout: ShipLayout, deck: number): CollisionBox[] {
  let decks = collisionCache.get(layout);
  if (!decks) { decks = new Map(); collisionCache.set(layout, decks); }
  const saved = decks.get(deck); if (saved) return saved;
  const boxes = layout.cabins.filter(c => c.kind === "cloning" && c.deck === deck).flatMap(cabin => [-1,1].flatMap(side => {
    const parts = [{ v: 0, width: CLONING_POD.width, length: CLONING_POD.length, top: 1.2 }, ...CLONING_STEPS.map(step=>({...step,top:step.y+step.height/2}))];
    return parts.map((part,index) => {
      const p = cloningPoint(layout,cabin,side*CLONING_POD.spacing,CLONING_POD.v+part.v);
      return { owner: `${cabin.id}:pod:${side<0?0:1}:${index}`, x: p.x, y: p.z, halfX: part.width/2, halfY: part.length/2, angle: -cabinAngle(layout,cabin.slot), bottom: 0, top: part.top };
    });
  }));
  decks.set(deck,boxes);return boxes;
}
