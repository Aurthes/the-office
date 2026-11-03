import type { MeshStandardMaterial } from "three";
import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";

export const SERVER_ACTIVITY_COLORS = ["#67edc7", "#68edc7", "#69edc7", "#6aedc7"] as const;
export const SERVER_RACK = { width: .84, depth: .88, height: 2.16, pitch: 1.04 } as const;

export function machineRoomPoint(layout: ShipLayout, cabin: ShipCabin, u: number, v: number) {
  const ring = layout.rings[cabin.ring];
  return shipPoint(ring.radius + v, cabinAngle(layout, cabin.slot) + u / ring.radius);
}

export function machineRoomPlan(layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring], width = ring.radius * Math.PI * 2 / layout.allocation.sectors;
  const count = Math.max(3, Math.floor(width * .56 / SERVER_RACK.pitch) + 1);
  const rows = ring.depth >= 6.4
    ? [{ v: -2.45, face: -1 }, { v: -1.45, face: 1 }, { v: 1.45, face: -1 }, { v: 2.45, face: 1 }]
    : [{ v: -1.58, face: 1 }, { v: 1.58, face: -1 }];
  const racks = rows.flatMap((row, rowIndex) => Array.from({ length: count }, (_, column) => ({
    ...row, u: -width * .4 + column * SERVER_RACK.pitch, row: rowIndex, column,
  })));
  const consoleWidth = Math.min(2.8, ring.depth * .38);
  const console = { u: width * .34, v: ring.depth / 2 - consoleWidth / 2 - .3, width: consoleWidth,
    angle: cabinAngle(layout, cabin.slot) + width * .34 / ring.radius };
  return { width, racks, rows, console };
}

export function serverConsoleScreenPose(layout: ShipLayout, cabin: ShipCabin) {
  const console = machineRoomPlan(layout, cabin).console;
  const point = machineRoomPoint(layout, cabin, console.u, console.v);
  return { point: { x: point.x + Math.sin(console.angle) * .18, z: point.z + Math.cos(console.angle) * .18 },
    angle: console.angle, height: 1.62, tilt: 0, width: .72, screenHeight: .49 };
}


export function updateServerActivity(materials: MeshStandardMaterial[], time: number) {
  for (const material of materials) material.emissiveIntensity = Math.sin(time * 5 + material.userData.serverActivityPhase) > .25 ? 2.3 : .12;
}
