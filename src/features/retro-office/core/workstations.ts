import { AGENT_RADIUS } from "./constants";
import { CHAIR_SEAT, DESK_SURFACE_HEIGHT, WORKSTATION_SCALE, deskFrontPoint, getItemRotationRadians, workstationClearance, workstationPoint } from "./geometry";
import type { DeskWorkstation, FurnitureItem } from "./types";
import type { CollisionWorld } from "./collision";

// One workstation owns at most one chair. Navigation, final pose and the desk
// monitor all use the same result; no separate pixel offset or phantom seat.
export function getDeskWorkstations(items: FurnitureItem[], world?: CollisionWorld): DeskWorkstation[] {
  const desks = items.filter(item => item.type === "desk_cubicle");
  const result: DeskWorkstation[] = desks.map(desk => ({ ...deskFrontPoint(desk), deskUid: desk._uid,
    facing: getItemRotationRadians(desk) + Math.PI, pose: "standing", seatHeight: 0, surfaceHeight: DESK_SURFACE_HEIGHT + (desk.elevation ?? 0) }));
  const chairs = items.filter(item => item.type === "chair").map(chair => ({ item: chair,
    point: workstationPoint(chair, CHAIR_SEAT[0], CHAIR_SEAT[2]) }));
  const pairs = desks.flatMap((desk, index) => chairs.flatMap((chair, chairIndex) => {
    const distance = Math.hypot(chair.point.x - result[index].x, chair.point.y - result[index].y);
    if (distance > AGENT_RADIUS * 2) return [];
    // Never sit in a chair placed inside a desk, including a neighbouring desk.
    if (desks.some(desk => workstationClearance(chair.point, desk) < AGENT_RADIUS)) return [];
    return [{ index, chairIndex, distance }];
  })).sort((a, b) => a.distance - b.distance);
  const usedChairs = new Set<number>(), seatedDesks = new Set<number>();
  for (const { index, chairIndex } of pairs) {
    if (usedChairs.has(chairIndex) || seatedDesks.has(index)) continue;
    const chair = chairs[chairIndex];
    result[index] = { ...result[index], ...chair.point, chairUid: chair.item._uid, pose: "sitting",
      facing: getItemRotationRadians(chair.item), seatHeight: CHAIR_SEAT[1] * WORKSTATION_SCALE.chair + (chair.item.elevation ?? 0) };
    usedChairs.add(chairIndex); seatedDesks.add(index);
  }
  return result.map(work => {
    if (!world || world.clear(work, work.chairUid)) return work;
    // A neighbouring sofa/cabinet can occupy a valid desk's old approach.
    // Choose clear floor from the same scene geometry, never force the pose
    // through that neighbour or invent a seat there.
    const point = world.approach(work.deskUid) ?? world.resolve(work);
    const centre = world.ownerBounds(work.deskUid) ?? work;
    return { ...work, ...point, pose: "standing", chairUid: undefined, seatHeight: 0,
      facing: Math.atan2(centre.x - point.x, centre.y - point.y) };
  });
}
