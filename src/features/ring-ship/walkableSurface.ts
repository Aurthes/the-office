import { cabinAngle, SHIP_CORRIDOR_START, SHIP_CORRIDOR_WIDTH, shipPoint, type ShipLayout, type ShipPoint } from "./layout";
import { hullProfile } from "./shell-shapes";

const EDGE = .02, TAU = Math.PI * 2;
const DIAGONAL = Math.SQRT1_2;
const FOOT_SAMPLES = [[1, 0], [-1, 0], [0, 1], [0, -1], [DIAGONAL, DIAGONAL], [DIAGONAL, -DIAGONAL], [-DIAGONAL, DIAGONAL], [-DIAGONAL, -DIAGONAL]];

// Support the feet on the existing narrow walkways. The larger character
// collision circle still keeps bodies and outstretched arms apart.
export function footingRadius(radius: number) { return Math.min(radius, .4); }

function floorPoint(point: ShipPoint, layout: ShipLayout, deck: number) {
  for (const angle of layout.spokes) {
    const along = point.x * Math.sin(angle) + point.z * Math.cos(angle);
    const across = point.x * Math.cos(angle) - point.z * Math.sin(angle);
    if (along >= SHIP_CORRIDOR_START + EDGE && along <= layout.radius - EDGE && Math.abs(across) <= SHIP_CORRIDOR_WIDTH / 2 - EDGE) return true;
  }
  const radius = Math.hypot(point.x, point.z), angle = Math.atan2(point.x, point.z);
  const sector = ((angle / TAU * layout.allocation.sectors) % 1 + 1) % 1;
  if (!layout.rings.some(ring => Math.abs(radius - ring.radius) <= ring.depth / 2 * hullProfile(sector) - EDGE)) return false;
  for (const cabin of layout.cabins) {
    if (cabin.kind !== "return" || cabin.deck !== deck) continue;
    const opening = shipPoint(layout.rings[cabin.ring].radius + 1.8, cabinAngle(layout, cabin.slot));
    if (Math.hypot(point.x - opening.x, point.z - opening.z) < 1.02 + EDGE) return false;
  }
  return true;
}

export function isWalkable(point: ShipPoint, layout: ShipLayout, padding = 0, deck = 0) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z) || !floorPoint(point, layout, deck)) return false;
  if (!padding) return true;
  return FOOT_SAMPLES.every(([x, z]) => floorPoint({ x: point.x + x * padding, z: point.z + z * padding }, layout, deck));
}

export function walkableSegment(start: ShipPoint, end: ShipPoint, layout: ShipLayout, padding = 0, deck = 0) {
  const distance = Math.hypot(end.x - start.x, end.z - start.z), samples = Math.max(1, Math.ceil(distance / .1));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    if (!isWalkable({ x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t }, layout, padding, deck)) return false;
  }
  return true;
}

// Recovery is only for an already invalid pose. Normal movement rejects unsafe
// steps; it never projects a route across a gap between two valid endpoints.
export function nearestWalkablePoint(point: ShipPoint, layout: ShipLayout, padding = 0, deck = 0, free: (point: ShipPoint) => boolean = () => true): ShipPoint {
  const candidates: ShipPoint[] = [], radius = Math.hypot(point.x, point.z), angle = Math.atan2(point.x, point.z);
  const sector = ((angle / TAU * layout.allocation.sectors) % 1 + 1) % 1;
  for (const ring of layout.rings) {
    const half = Math.max(0, ring.depth / 2 * hullProfile(sector) - padding - EDGE * 2);
    candidates.push(shipPoint(Math.max(ring.radius - half, Math.min(ring.radius + half, radius)), angle), shipPoint(ring.radius, angle));
  }
  for (const direction of layout.spokes) {
    const along = Math.max(SHIP_CORRIDOR_START + padding + EDGE * 2, Math.min(layout.radius - padding - EDGE * 2, point.x * Math.sin(direction) + point.z * Math.cos(direction)));
    const half = Math.max(0, SHIP_CORRIDOR_WIDTH / 2 - padding - EDGE * 2);
    const across = Math.max(-half, Math.min(half, point.x * Math.cos(direction) - point.z * Math.sin(direction)));
    candidates.push({ x: Math.sin(direction) * along + Math.cos(direction) * across, z: Math.cos(direction) * along - Math.sin(direction) * across });
  }
  const valid = candidates.filter(candidate => isWalkable(candidate, layout, padding, deck))
    .sort((a, b) => Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z));
  return valid.find(free) || valid[0] || shipPoint(layout.rings[0].radius, 0);
}
