import type { Builder } from "./geometry";
import { cabinAngle, type ShipCabin, type ShipLayout } from "./layout";
import { BREAK_ROOM, breakRoomPoint, breakSeatPose } from "./breakRoomLayout";

export function addBreakRoom(b: Builder, layout: ShipLayout, cabin: ShipCabin) {
  const angle = cabinAngle(layout, cabin.slot);
  const box = (x: number, z: number, y: number, size: [number, number, number], color: string, glow = false) => {
    const p = breakRoomPoint(layout, cabin, x, z); b.box(size, [p.x, y, p.z], color, angle, glow);
  };
  const cylinder = (x: number, z: number, y: number, radius: number, height: number, color: string) => {
    const p = breakRoomPoint(layout, cabin, x, z); b.cylinder(radius, height, [p.x, y, p.z], color);
  };
  const mug = (x: number, z: number, y: number, color: string, tea = false) => {
    cylinder(x, z, y + .08, .075, .15, color);
    cylinder(x, z, y + .157, .06, .006, tea ? "#b78840" : "#5b3829");
    const p = breakRoomPoint(layout, cabin, x + .085, z);
    b.curve([[p.x, y + .04, p.z], [p.x + Math.cos(angle) * .05, y + .08, p.z - Math.sin(angle) * .05], [p.x, y + .13, p.z]], .014, color);
  };
  b.object("teaserBoard", () => {
    const c = BREAK_ROOM.teaserBoard;
    box(c.x, c.z, c.y, [c.width, c.height, .12], "#c5a477");
    box(c.x, c.z - .075, c.y, [c.width - .14, c.height - .14, .04], "#183832");
    for (const side of [-1, 1]) box(c.x + side * .76, c.z, .59, [.07, 1.1, .09], "#60756c");
    box(c.x, c.z - .1, c.y - c.height / 2, [c.width, .06, .2], "#d3b37a");
  });
  b.object("refreshmentCounter", () => {
    const c = BREAK_ROOM.counter;
    box(0, c.z, .54, [c.width, .92, c.depth], "#c9ae8d");
    box(0, c.z, c.height, [c.width + .08, .1, c.depth + .06], "#f2e1c5");
    for (const x of [-1.08, 0, 1.08]) { box(x, c.z - .34, .55, [.96, .74, .03], "#b69271"); box(x, c.z - .365, .79, [.3, .035, .035], "#596c69"); }
    box(0, c.z + .31, 1.14, [3.65, .16, .09], "#536f65");
    box(0, c.z + .35, 1.0, [3.4, .035, .035], "#e6c48a", true);
  });
  b.object("kitchenCoffeeMachine", () => {
    box(-1.05, 2.03, 1.37, [.62, .5, .42], "#314b50");
    box(-1.05, 1.8, 1.38, [.51, .3, .06], "#9fb7b0");
    box(-1.05, 1.74, 1.33, [.07, .11, .09], "#344c4b");
    box(-1.05, 1.7, 1.13, [.5, .045, .3], "#536965");
    box(-.88, 1.759, 1.48, [.045, .045, .015], "#e5c184", true);
    mug(-1.05, 1.68, 1.15, "#f1dcb6");
  });
  b.object("teaStation", () => {
    cylinder(.02, 2.0, 1.17, .19, .08, "#3c5e56");
    cylinder(.02, 2.0, 1.35, .16, .3, "#d6dfc7");
    cylinder(.02, 2.0, 1.52, .17, .04, "#597d68");
    box(.21, 2.0, 1.35, [.18, .06, .07], "#d6dfc7");
    for (const [i, color] of ["#749570", "#cda66a", "#a890a6"].entries()) box(.4 + i * .22, 2.1, 1.2, [.16, .22, .15], color);
    mug(.15, 1.65, 1.1, "#acc3a1", true);
  });
  b.object("snackTray", () => {
    box(1.2, 1.97, 1.13, [.66, .045, .45], "#f4e8d1");
    for (let i = 0; i < 5; i++) {
      const p = breakRoomPoint(layout, cabin, 1 + (i % 3) * .16, 1.85 + Math.floor(i / 3) * .18);
      b.ball(.095, [p.x, 1.21, p.z], i % 2 ? "#d9a957" : "#ad7547", [1, .48, .75]);
    }
    box(1.33, 2.04, 1.23, [.2, .05, .17], "#e7c78e");
    box(1.33, 2.04, 1.27, [.19, .025, .16], "#7d9e5d");
    box(1.33, 2.04, 1.3, [.2, .04, .17], "#e7c78e");
  });
  b.object("dish", () => {
    cylinder(.66, 1.65, 1.15, .18, .075, "#c29165");
    for (const [i, color] of ["#d78a48", "#9eac62", "#c16852"].entries()) {
      const p = breakRoomPoint(layout, cabin, .57 + i * .08, 1.64 + (i % 2) * .08);
      b.ball(.075, [p.x, 1.23, p.z], color);
    }
  });
  for (const [i, x] of BREAK_ROOM.tables.entries()) {
    b.object("breakTable", () => {
      cylinder(x, BREAK_ROOM.radial, .43, .1, .7, "#60756c");
      cylinder(x, BREAK_ROOM.radial, .13, .32, .08, "#60756c");
      cylinder(x, BREAK_ROOM.radial, BREAK_ROOM.tableHeight, BREAK_ROOM.tableRadius, .09, "#dec29a");
      mug(x - .14, BREAK_ROOM.radial - .12, .88, i ? "#acc3a1" : "#e9c588", !!i);
      cylinder(x + .15, BREAK_ROOM.radial + .12, .89, .15, .025, "#f2e6cf");
      const p = breakRoomPoint(layout, cabin, x + .15, BREAK_ROOM.radial + .12);
      b.ball(.09, [p.x, .95, p.z], i ? "#dcab54" : "#b47443", [1, .4, .7]);
    });
  }
  for (let i = 0; i < BREAK_ROOM.seats.length; i++) {
    const pose = breakSeatPose(layout, cabin, i), p = pose.point;
    b.object("breakChair", () => {
      b.cylinder(.29, .12, [p.x, BREAK_ROOM.seatHeight - .06, p.z], i % 2 ? "#728d79" : "#cf9e70");
      b.cylinder(.065, .3, [p.x, .23, p.z], "#526a64");
      b.cylinder(.24, .045, [p.x, .11, p.z], "#526a64");
      b.box([.56, .36, .075], [p.x - Math.sin(pose.facing) * .24, .64, p.z - Math.cos(pose.facing) * .24], i % 2 ? "#728d79" : "#cf9e70", pose.facing);
    });
  }
  b.object("pottedPlant", () => {
    cylinder(0, .95, .29, .2, .42, "#b8916c");
    for (const side of [-1, 0, 1]) { const p = breakRoomPoint(layout, cabin, side * .13, .95); b.ball(.24, [p.x, .68 + Math.abs(side) * .1, p.z], "#6c9470", [.65, 1.3, .75]); }
  });
  // Warm pendant bars stay low enough for the room to read from overhead.
  for (const x of BREAK_ROOM.tables) box(x, BREAK_ROOM.radial, 2.25, [.95, .07, .1], "#f4d5a0", true);
}
