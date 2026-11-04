import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";
export function departmentBoardPose(layout: ShipLayout, cabin: ShipCabin) {
  const angle = cabinAngle(layout, cabin.slot), radial = layout.rings[cabin.ring].depth / 2 - .3;
  return { point: shipPoint(layout.rings[cabin.ring].radius + radial - .09, angle), angle: angle + Math.PI, radial };
}
