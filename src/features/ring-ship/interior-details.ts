import type { Builder } from './geometry';
import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from './layout';

// Repeated small props are merged with the existing geometry by material.
// The middle circulation lane remains free in every room.
export function addCabinDetails(b: Builder, layout: ShipLayout, c: ShipCabin) {
  const ring = layout.rings[c.ring], width = ring.radius * Math.PI * 2 / layout.allocation.sectors;
  const angle = cabinAngle(layout, c.slot), edge = ring.depth / 2 - .65;
  const p = (u: number, v: number) => shipPoint(ring.radius + v, angle + u / ring.radius);
  const box = (u: number, v: number, y: number, size: [number, number, number], color: string, glow = false) => b.localBox(layout, c, u, v, y, size, color, 0, glow);
  const model = (name: Parameters<Builder['furniture']>[0], size: number, u: number, v: number, y = .08, rotate = 0) => b.furniture(name, size, p(u, v), y, angle + u / ring.radius + rotate);
  const bookcase = (u: number, v: number) => model('bookcaseClosed', .85, u, v, .08, v < 0 ? Math.PI : 0);
  const plant = (u: number, v: number, size = .5) => model('pottedPlant', size, u, v);
  const locker = (u: number, v: number, color = '#bac7c7') => b.object('locker', () => {
    box(u, v, .66, [.65, 1.2, .48], color);
    box(u + .16, v - .25, .68, [.035, .22, .035], '#405766');
    box(u, v - .25, 1.05, [.4, .025, .03], '#82a5ae');
  });
  const console = (u: number, v: number) => b.object('terminal', () => {
    box(u, v, .43, [.88, .68, .48], '#d8e0dc');
    box(u, v, .9, [.76, .39, .06], '#304b5d');
    for (const j of [-.2, 0, .2]) box(u + j, v - .04, .92, [.11, .025, .03], j ? '#6abeb6' : '#edbc79', true);
  });
  const flower = (u: number, v: number) => b.object('flowers', () => {
    const q = p(u, v); b.cylinder(.24, .28, [q.x, .22, q.z], '#cbb794', 9);
    for (const n of [-.15, 0, .15]) b.ball(.13, [q.x + n, .52 + Math.abs(n), q.z], n > 0 ? '#d5ab6f' : '#dca7a1');
  });
  // Door-side storage, lights and service hardware make the bays inhabited.
  for (const side of [-1, 1]) {
    const u = side * width * .4;
    b.object('serviceLight', () => {
      box(u, edge, .4, [.5, .62, .55], '#d3dddc');
      box(u, edge, .74, [.24, .045, .25], '#f3cf8c', true);
    });
  }
  if (c.kind === 'reserve') {
    for (const side of [-1, 1]) {
      locker(side * width * .34, edge, '#9baeb4');
      b.object('crate', () => {
        box(side * width * .34, -edge, .22, [1.1, .32, .7], '#a9b9bb');
        box(side * width * .34, -edge, .4, [.8, .03, .04], '#75b8b9', true);
      });
    }
    console(0, edge);
    return;
  }
  if (c.kind === 'work') {
    for (const side of [-1, 1]) {
      bookcase(side * width * .39, -edge);
      plant(side * width * .39, edge - .35);
      plant(side * width * .25, -edge, .38);
    }
    // Keep small teams' cabins compact; larger cabins have a break corner.
    if (c.ring === 0) {
      model('tableCoffee', .95, 0, -1.55);
      model('loungeDesignChair', .55, -.95, -1.7, .08, .7);
      model('loungeDesignChair', .55, .95, -1.7, .08, -.7);
    } else {
      for (const side of [-1, 1]) {
        locker(side * width * .43, -edge);
        console(side * width * .43, edge - .1);
      }
      b.object('kitchenCabinet', () => box(0, edge, .34, [Math.min(2.8, width * .2), .5, .48], '#b9c9c6'));
      model('kitchenCoffeeMachine', .3, -.45, edge, .61);
      flower(.5, edge);
      for (const side of [-1, 1]) {
        const u = side * width * .35;
        model('loungeSofa', 1.8, u, -1.7, .08, Math.PI);
        model('tableCoffee', 1.1, u, -2.9);
        model('table', 1.65, u, 1.7);
        model('chairModernCushion', .42, u - .95, 1.7, .08, Math.PI / 2);
        model('chairModernCushion', .42, u + .95, 1.7, .08, -Math.PI / 2);
        plant(u - 1.3, -2.5, .55); plant(u + 1.3, -2.5, .55);
      }
    }
  } else if (c.kind === 'hydroponics') {
    for (const side of [-1, 1]) {
      const u = side * width * .41;
      locker(u, -edge); console(u, edge);
      b.object('waterTank', () => {
        const q = p(u, -1.15); b.cylinder(.36, .9, [q.x, .55, q.z], '#87a6a5', 14);
        b.cylinder(.38, .08, [q.x, 1.04, q.z], '#d9e4da', 14);
      });
    }
    for (const u of [-width * .13, width * .13]) {
      b.object('growingBed', () => box(u, 2.65, .4, [2.3, .6, .65], '#d4dfd4'));
      for (const j of [-.75, -.25, .25, .75]) {
        b.object('seedling', () => { const q = p(u + j, 2.65); b.ball(.25, [q.x, .8, q.z], '#82b46b', [.7, .9, .7]); });
      }
    }
  } else if (c.kind === 'canteen') {
    for (const u of [-width * .36, -width * .12, width * .12, width * .36]) {
      model('tableRound', 1.05, u, -1.85);
      for (const side of [-1, 1]) model('chairModernCushion', .42, u + side * .8, -1.85, .08, -side * Math.PI / 2);
      b.object('dish', () => { const q = p(u, -1.85); b.cylinder(.16, .08, [q.x, .88, q.z], '#e4d9bf', 12); });
    }
    model('kitchenFridgeSmall', .8, width * .42, 2.2);
    model('kitchenCabinet', 2.4, -width * .33, 2.2);
    model('kitchenCoffeeMachine', .4, -width * .33, 2.2, 1.1);
    for (const u of [-width * .1, width * .1]) plant(u, 2.6);
  } else if (c.kind === 'gym') {
    for (const u of [-width * .38, -width * .13, width * .13, width * .38]) {
      b.object('exerciseMat', () => box(u, -2.6, .08, [2, .045, 1.2], '#8ba9ac'));
      b.object('weights', () => {
        box(u, -2.6, .22, [.9, .2, .32], '#e1a761');
        for (const j of [-.55, .55]) {
          const q = p(u + j, -2.6); b.cylinder(.18, .25, [q.x, .18, q.z], '#334e60', 10);
        }
      });
    }
    for (const u of [-width * .42, width * .42]) { locker(u, 2.6); locker(u + .8, 2.6); console(u, -1.1); }
    for (const u of [-width * .37, width * .37]) {
      b.object('bench', () => {
        box(u, 1.1, .35, [1.2, .55, 1.1], '#8da9b2');
        box(u, 1.1, .8, [.22, .4, .65], '#d2e0df');
      });
    }
  } else if (c.kind === 'cargo') {
    for (const u of [-width * .39, -width * .13, width * .13, width * .39]) {
      b.object('crate', () => {
        box(u, 2.7, .55, [2, .9, 1.3], '#acbdbb');
        box(u, 2.7, 1.04, [2.05, .08, 1.35], '#d8ab70');
      });
      b.object('crate', () => box(u, -2.7, .4, [1.3, .6, .9], '#bcc9bd'));
      for (const v of [-1.5, 1.5]) locker(u, v);
    }
  } else if (c.kind === 'quarters') {
    for (const u of [-width * .4, -width * .13, width * .13, width * .4]) {
      model('bookcaseClosed', 1, u, 3);
      model('loungeDesignChair', .7, u, -2.6);
      model('tableCoffee', .8, u + 1.2, -2.6);
      plant(u - 1.2, -2.6, .4);
    }
  } else if (c.kind === 'observatory') {
    for (const u of [-width * .36, 0, width * .36]) {
      console(u, 2.6); model('loungeDesignChair', .75, u, -2.6, .08, Math.PI);
      model('tableCoffee', 1, u + 1.8, -2.6); plant(u - 1.4, -2.6, .55);
    }
  } else if (c.kind === 'maintenance') {
    for (const u of [-width * .4, -width * .13, width * .13, width * .4]) {
      bookcase(u, 3); locker(u, -2.6); console(u + 1, -2.6);
      for (const j of [-.5, 0, .5]) b.object('tools', () => box(u + j, 2.2, .67, [.2, .12, .15], j ? '#729793' : '#dca66b'));
    }
  } else if (c.kind === 'lounge') {
    model('tableCoffee', 1.05, 0, -1.35);
    model('loungeDesignChair', .65, -1.1, -1.5, .08, .5);
    model('loungeDesignChair', .65, 1.1, -1.5, .08, -.5);
    for (const side of [-1, 1]) { bookcase(side * width * .37, -edge); plant(side * width * .37, edge); }
  }
}
