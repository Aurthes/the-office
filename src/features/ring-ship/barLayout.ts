import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";

export const BAR_LAYOUT = {
  radial: 1.65,
  counter: 1.33,
  bottles: [
    { x: -1.95, height: .31, color: "#315b43" },
    { x: -1.67, height: .25, color: "#96552d" },
    { x: -1.4, height: .35, color: "#3a665b" },
  ],
} as const;

export function barPoint(layout: ShipLayout, cabin: ShipCabin, x: number, z: number) {
  const angle = cabinAngle(layout, cabin.slot), center = shipPoint(layout.rings[cabin.ring].radius + BAR_LAYOUT.radial, angle);
  return { x: center.x + Math.cos(angle) * x + Math.sin(angle) * z, z: center.z - Math.sin(angle) * x + Math.cos(angle) * z };
}
