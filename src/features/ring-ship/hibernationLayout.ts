import type { CollisionBox } from "@/features/retro-office/core/collision";
import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";

export const HIBERNATION = { columns: 10, spacing: 1.75, radial: 2.35, width: 1.42, length: 2.2, bedHeight: .64 } as const;
export const HIBERNATION_IDLE_MS = 60 * 60 * 1000;
export const HIBERNATION_CAPACITY = HIBERNATION.columns * 2;

// Follow the curved floor, leaving the ring's centre lane clear on both sides.
export function hibernationPod(layout: ShipLayout, cabin: ShipCabin, index: number) {
  const side = index < HIBERNATION.columns ? 1 : -1;
  const u = (index % HIBERNATION.columns - (HIBERNATION.columns - 1) / 2) * HIBERNATION.spacing;
  const radius = layout.rings[cabin.ring].radius;
  const angle = cabinAngle(layout, cabin.slot) + u / radius;
  return { index, side, angle, center: shipPoint(radius + side * HIBERNATION.radial, angle),
    entry: shipPoint(radius + side * .65, angle),
    rest: shipPoint(radius + side * (HIBERNATION.radial - .45), angle),
    facing: angle + (side > 0 ? Math.PI : 0) };
}

const cache = new WeakMap<ShipLayout, Map<number, CollisionBox[]>>();
export function hibernationCollisionBoxes(layout: ShipLayout, deck: number): CollisionBox[] {
  let decks = cache.get(layout);
  if (!decks) { decks = new Map(); cache.set(layout, decks); }
  const saved = decks.get(deck); if (saved) return saved;
  const boxes = layout.cabins.filter(c => c.kind === "quarters" && c.deck === deck).flatMap(cabin =>
    Array.from({ length: HIBERNATION_CAPACITY }, (_, index) => {
      const pod = hibernationPod(layout, cabin, index);
      return { owner: `${cabin.id}:sleep:${index}`, x: pod.center.x, y: pod.center.z,
        halfX: HIBERNATION.width / 2, halfY: HIBERNATION.length / 2, angle: -pod.angle, bottom: 0, top: 1.4 };
    }));
  decks.set(deck, boxes); return boxes;
}
