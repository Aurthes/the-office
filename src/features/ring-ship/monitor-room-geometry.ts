import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";
import type { Builder } from "./geometry";
import workstationModels from "@/features/retro-office/core/workstation-models.json";

export function monitorChairPose(layout: Pick<ShipLayout, "allocation" | "rings">, cabin: ShipCabin) {
  const model = workstationModels.chairDesk;
  return { point: shipPoint(layout.rings[cabin.ring].radius + .2, cabinAngle(layout, cabin.slot)),
    facing: cabinAngle(layout, cabin.slot) + Math.PI, surfaceHeight: 1.175,
    seatHeight: .08 + (model.seat[1] - model.min[1]) * .8 / (model.max[0] - model.min[0]) };
}

export function monitorScreenPose(layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring];
  return { point: shipPoint(ring.radius - ring.depth / 2 + .86, cabinAngle(layout, cabin.slot)), angle: cabinAngle(layout, cabin.slot), width: Math.min(6, ring.radius * Math.PI * 2 / layout.allocation.sectors * .45) };
}

// A separate whiteboard on the rear wall, away from the PNL screen and desks.
export function monitorTaskBoardPose(layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring], width = ring.radius * Math.PI * 2 / layout.allocation.sectors;
  const tangent = -Math.min(3.4, width * .28), radial = ring.depth / 2 - .4;
  const angle = cabinAngle(layout, cabin.slot) + tangent / ring.radius;
  return { tangent, radial, angle: angle + Math.PI, point: shipPoint(ring.radius + radial - .09, angle) };
}

export function monitorDepartmentBoardPose(layout: ShipLayout, cabin: ShipCabin) {
  const board = monitorTaskBoardPose(layout, cabin), ring = layout.rings[cabin.ring];
  const angle = cabinAngle(layout, cabin.slot) + (board.tangent + 1.7) / ring.radius;
  return { point: shipPoint(ring.radius + board.radial - .09, angle), angle: angle + Math.PI };
}

export function addMonitorRoom(b: Builder, layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring], width = ring.radius * Math.PI * 2 / layout.allocation.sectors;
  const edge = -ring.depth / 2 + .65, main = monitorScreenPose(layout, cabin);
  const box = (u: number, v: number, y: number, size: [number, number, number], color: string, glow = false) => b.localBox(layout, cabin, u, v, y, size, color, 0, glow);
  const board = monitorTaskBoardPose(layout, cabin);
  b.object("taskWhiteboard", () => {
    box(board.tangent, board.radial, 1.7, [1.8, 1.18, .1], "#6d8f88");
    box(board.tangent, board.radial - .06, 1.7, [1.65, 1.04, .025], "#e1e9df");
    box(board.tangent, board.radial - .12, 1.1, [1.8, .06, .16], "#9cb9b3");
  });
  // Raised central command desk, a large screen and banks of smaller displays.
  box(0, -1.5, .25, [5.3, .32, 2.4], "#435e6b");
  b.object("controlDesk", () => {
    box(0, -1.15, .75, [3.4, .72, 1.15], "#d8e0dc");
    box(0, -1.15, 1.13, [3.55, .09, 1.25], "#30495b");
  });
  for (const u of [-1.05, 0, 1.05]) {
    b.object("monitor", () => {
      box(u, -.83, 1.55, [.95, .65, .12], "#182e3d");
      box(u, -.755, 1.55, [.83, .51, .025], "#71d3c8", true);
      box(u, -1.4, 1.19, [.6, .04, .28], "#7da6ad");
    });
  }
  const chair = monitorChairPose(layout, cabin);
  b.furniture("chairDesk", .8, chair.point, .08, chair.facing);
  box(0, edge, 1.9, [main.width + .3, 2.1, .3], "#30495b");
  box(0, edge + .18, 1.9, [main.width, 1.8, .04], "#153f4c", true);
  for (const side of [-1, 1]) for (const row of [0, 1]) for (const column of [0, 1]) {
    const u = side * (main.width / 2 + 1 + column * 1.4);
    if (Math.abs(u) + .7 > width * .43) continue;
    b.object("monitor", () => {
      box(u, edge - .2, 1.2 + row * 1.05, [1.3, .9, .2], "#30495b");
      box(u, edge - .32, 1.2 + row * 1.05, [1.14, .73, .025], row ? "#81aee0" : "#71d3c8", true);
      // Simple instrument traces, decorative rather than invented live readings.
      for (const n of [-.35, 0, .35]) box(u + n, edge - .345, 1.1 + row * 1.05 + n * .35, [.06, .22 + Math.abs(n), .02], "#c7eee2", true);
    });
  }
  for (const side of [-1, 1]) {
    b.object("controlDesk", () => {
      box(side * 2.65, -.95, .75, [1.05, .95, 2.1], "#d8e0dc");
      box(side * 2.65, -.95, 1.26, [.95, .08, 2], "#30495b");
      box(side * 2.65, -.47, 1.65, [.85, .65, .12], "#71d3c8", true);
    });
  }
}
