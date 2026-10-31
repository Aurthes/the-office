import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";
import type { Builder } from "./geometry";

export function monitorScreenPose(layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring];
  return { point: shipPoint(ring.radius - ring.depth / 2 + .86, cabinAngle(layout, cabin.slot)), angle: cabinAngle(layout, cabin.slot), width: Math.min(6, ring.radius * Math.PI * 2 / layout.allocation.sectors * .45) };
}

export function addMonitorRoom(b: Builder, layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring], width = ring.radius * Math.PI * 2 / layout.allocation.sectors;
  const edge = -ring.depth / 2 + .65, main = monitorScreenPose(layout, cabin);
  const box = (u: number, v: number, y: number, size: [number, number, number], color: string, glow = false) => b.localBox(layout, cabin, u, v, y, size, color, 0, glow);
  // Raised central command desk, a large screen and banks of smaller displays.
  box(0, -.85, .25, [5.3, .32, 2.4], "#435e6b");
  box(0, -.5, .75, [3.4, .72, 1.15], "#d8e0dc");
  box(0, -.5, 1.13, [3.55, .09, 1.25], "#30495b");
  for (const u of [-1.05, 0, 1.05]) {
    box(u, -.18, 1.55, [.95, .65, .12], "#182e3d");
    box(u, -.105, 1.55, [.83, .51, .025], "#71d3c8", true);
    box(u, -.75, 1.19, [.6, .04, .28], "#7da6ad");
  }
  const chair = shipPoint(ring.radius + .85, main.angle);
  b.furniture("chairDesk", .8, chair, .08, main.angle + Math.PI);
  box(0, edge, 1.9, [main.width + .3, 2.1, .3], "#30495b");
  box(0, edge + .18, 1.9, [main.width, 1.8, .04], "#153f4c", true);
  for (const side of [-1, 1]) for (const row of [0, 1]) for (const column of [0, 1]) {
    const u = side * (main.width / 2 + 1 + column * 1.4);
    if (Math.abs(u) + .7 > width * .43) continue;
    box(u, edge - .2, 1.2 + row * 1.05, [1.3, .9, .2], "#30495b");
    box(u, edge - .32, 1.2 + row * 1.05, [1.14, .73, .025], row ? "#81aee0" : "#71d3c8", true);
    // Simple instrument traces, decorative rather than invented live readings.
    for (const n of [-.35, 0, .35]) box(u + n, edge - .345, 1.1 + row * 1.05 + n * .35, [.06, .22 + Math.abs(n), .02], "#c7eee2", true);
  }
  for (const side of [-1, 1]) {
    box(side * 2.65, -.3, .75, [1.05, .95, 2.1], "#d8e0dc");
    box(side * 2.65, -.3, 1.26, [.95, .08, 2], "#30495b");
    box(side * 2.65, .18, 1.65, [.85, .65, .12], "#71d3c8", true);
  }
}
