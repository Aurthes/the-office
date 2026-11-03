import type { CollisionBox } from "@/features/retro-office/core/collision";
import type { ShipCabin, ShipLayout, ShipPoint } from "./layout";

export const BREAK_ROOM = {
  aisle: -1.1, routeHalfWidth: 4.05,
  tables: [-2.15, 2.15], tableRadius: .54, tableHeight: .83,
  seats: [-3.2, -1.1, 1.1, 3.2], radial: 1.05, seatHeight: .48,
  counter: { x: 0, z: 2.05, width: 3.4, depth: .65, height: 1.05 },
} as const;
export type BreakAction = "coffee" | "tea" | "snack" | "chat";
export const BREAK_ACTIONS: readonly BreakAction[] = ["coffee", "tea", "snack", "chat"];
export const BREAK_ACTIVITIES: Record<BreakAction, string> = {
  coffee: "Coffee break. The ship runs on beans.", tea: "Taking a quiet tea break",
  snack: "Quality-testing the snack supply", chat: "Trading stories around the break-room table",
};
export const BREAK_CHATTER: Record<BreakAction, readonly string[]> = {
  coffee: ["Refuelling…", "One more cup?"], tea: ["Let it steep.", "Tea time."],
  snack: ["Who ate the last biscuit?", "Saving one for the CEO."], chat: ["Any weekend plans?", "You had to be there."],
};
export type BreakVisit = { cabinId: string; seat: number; action: BreakAction; outward: ShipPoint[]; chatting?: boolean };
export function breakAction(visit: BreakVisit): BreakAction { return visit.action === "chat" && !visit.chatting ? "tea" : visit.action; }

export function breakRoomPoint(layout: ShipLayout, cabin: ShipCabin, x: number, z: number): ShipPoint {
  const angle = (cabin.slot + .5) * Math.PI * 2 / layout.allocation.sectors;
  const radius = layout.rings[cabin.ring].radius;
  return { x: Math.sin(angle) * (radius + z) + Math.cos(angle) * x,
    z: Math.cos(angle) * (radius + z) - Math.sin(angle) * x };
}
export function breakSeatKey(cabinId: string, seat: number) { return `${cabinId}:seat:${seat}`; }
export function breakSeatPose(layout: ShipLayout, cabin: ShipCabin, seat: number) {
  const x = BREAK_ROOM.seats[seat], table = BREAK_ROOM.tables[Math.floor(seat / 2)];
  const angle = (cabin.slot + .5) * Math.PI * 2 / layout.allocation.sectors;
  return { point: breakRoomPoint(layout, cabin, x, BREAK_ROOM.radial),
    approach: breakRoomPoint(layout, cabin, x, BREAK_ROOM.aisle), facing: angle + (x < table ? Math.PI / 2 : -Math.PI / 2) };
}

const collisionCache = new WeakMap<ShipLayout, Map<number, CollisionBox[]>>();
export function breakRoomCollisionBoxes(layout: ShipLayout, deck: number): CollisionBox[] {
  let decks = collisionCache.get(layout);
  if (!decks) { decks = new Map(); collisionCache.set(layout, decks); }
  const saved = decks.get(deck); if (saved) return saved;
  const boxes = layout.cabins.filter(c => c.kind === "break" && c.deck === deck).flatMap(cabin => {
    const fixtures = [BREAK_ROOM.counter, ...BREAK_ROOM.tables.map(x => ({ x, z: BREAK_ROOM.radial,
      width: BREAK_ROOM.tableRadius * 2, depth: BREAK_ROOM.tableRadius * 2, height: BREAK_ROOM.tableHeight }))];
    return fixtures.map((f, i) => {
      const p = breakRoomPoint(layout, cabin, f.x, f.z);
      return { owner: `${cabin.id}:fixture:${i}`, x: p.x, y: p.z, halfX: f.width / 2, halfY: f.depth / 2,
        angle: -(cabin.slot + .5) * Math.PI * 2 / layout.allocation.sectors, bottom: 0, top: f.height };
    });
  });
  decks.set(deck, boxes); return boxes;
}
