import type { Builder } from "./geometry";
import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";

export function aiCorePose(layout: ShipLayout, cabin: ShipCabin) {
  const angle = cabinAngle(layout, cabin.slot);
  return { point: shipPoint(layout.rings[cabin.ring].radius + 1.62, angle), angle };
}

export function addAiCenter(b: Builder, layout: ShipLayout, cabin: ShipCabin) {
  const { point } = aiCorePose(layout, cabin);
  // Keep the ring's central walking lane clear, with the core above a recessed plinth.
  b.cylinder(.93, .2, [point.x, .17, point.z], "#243e50", 48);
  b.cylinder(.82, .08, [point.x, .3, point.z], "#87ded6", 48, true);
  b.cylinder(.72, .2, [point.x, .4, point.z], "#d1dfdf", 32);
  b.cylinder(.6, .04, [point.x, .52, point.z], "#254a5b", 32);
  for (const side of [-1, 1]) {
    const u = side * 2.9;
    b.localBox(layout, cabin, u, 1.45, .57, [.88, .95, 1.0], "#3c5263");
    b.localBox(layout, cabin, u, 1.45, 1.08, [1.0, .13, 1.12], "#c4d5d8");
    b.localBox(layout, cabin, u, 1.75, 1.5, [.95, .68, .12], "#203747");
    b.localBox(layout, cabin, u, 1.67, 1.5, [.8, .51, .025], side < 0 ? "#79d8cb" : "#9cb7ec", 0, true);
    for (let row = 0; row < 4; row++) {
      b.localBox(layout, cabin, u, 1.63, 1.32 + row * .11, [.6 - row * .1, .025, .02], "#d2f4ec", 0, true);
    }
    b.localBox(layout, cabin, side * 1.95, 1.55, .09, [1.7, .025, .07], "#7eddd3", 0, true);
  }
}
