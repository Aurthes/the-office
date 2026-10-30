import {
  CANVAS_H,
  CANVAS_W,
  AGENT_RADIUS,
  DOOR_LENGTH,
  DOOR_THICKNESS,
  MIN_WALL_LENGTH,
  SCALE,
  SNAP_GRID,
  WALL_THICKNESS,
} from "@/features/retro-office/core/constants";
import type {
  CanvasPoint,
  FurnitureItem,
} from "@/features/retro-office/core/types";
import workstationModels from "./workstation-models.json";

// Scale is shared with the GLB renderer. Bounds and the chair seat are generated
// from those exact meshes by scripts/generate-workstation-geometry.mjs.
export const WORKSTATION_SCALE = { desk_cubicle: 1.5, chair: 1.2 };
export const CHAIR_SEAT = workstationModels.chairDesk.seat;
export const DESK_SURFACE_HEIGHT = workstationModels.desk.max[1] * WORKSTATION_SCALE.desk_cubicle;

export const toWorld = (cx: number, cy: number): [number, number, number] => [
  cx * SCALE - CANVAS_W * SCALE * 0.5,
  0,
  cy * SCALE - CANVAS_H * SCALE * 0.5,
];

export const snap = (value: number) =>
  Math.round(value / SNAP_GRID) * SNAP_GRID;

let uidCounter = 0;

export const nextUid = () => `fi_${Date.now()}_${uidCounter++}`;

export const normalizeDegrees = (value: number) => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

export const resolveItemTypeKey = (item: FurnitureItem) =>
  item.type === "couch" && item.vertical ? "couch_v" : item.type;

export const ITEM_FOOTPRINT: Record<string, [number, number]> = {
  wall: [80, WALL_THICKNESS],
  door: [DOOR_LENGTH, DOOR_THICKNESS],
  desk_cubicle: [100, 55],
  chair: [24, 24],
  round_table: [120, 120],
  executive_desk: [130, 65],
  couch: [100, 40],
  couch_v: [40, 80],
  bookshelf: [80, 120],
  plant: [24, 24],
  beanbag: [40, 40],
  pingpong: [100, 60],
  table_rect: [80, 40],
  coffee_machine: [32, 34],
  fridge: [40, 80],
  water_cooler: [20, 54],
  atm: [42, 38],
  sms_booth: [58, 54],
  phone_booth: [78, 72],
  whiteboard: [10, 60],
  cabinet: [200, 40],
  computer: [30, 20],
  lamp: [30, 30],
  printer: [40, 35],
  stove: [40, 40],
  microwave: [30, 20],
  wall_cabinet: [80, 20],
  sink: [40, 40],
  vending: [40, 60],
  server_rack: [45, 90],
  server_terminal: [42, 34],
  qa_terminal: [54, 38],
  kanban_board: [130, 65],
  device_rack: [70, 36],
  test_bench: [90, 42],
  treadmill: [70, 35],
  weight_bench: [90, 45],
  dumbbell_rack: [80, 28],
  exercise_bike: [45, 65],
  punching_bag: [28, 28],
  jukebox: [60, 40],
  rowing_machine: [90, 34],
  kettlebell_rack: [70, 26],
  yoga_mat: [70, 30],
  keyboard: [30, 14],
  mouse: [16, 10],
  trash: [20, 20],
  mug: [14, 14],
  clock: [20, 20],
};

export const getItemBaseSize = (item: FurnitureItem) => {
  if (item.r !== undefined) {
    return { width: item.r * 2, height: item.r * 2 };
  }
  const [defaultWidth, defaultHeight] = ITEM_FOOTPRINT[
    resolveItemTypeKey(item)
  ] ?? [item.w ?? 40, item.h ?? 40];
  return {
    width: item.w ?? defaultWidth,
    height: item.h ?? defaultHeight,
  };
};

/**
 * Per-type metadata for furniture items.
 *
 * blocksNavigation: true  → solid floor-standing prop; marks grid cells as impassable.
 * blocksNavigation: false → desk decoration, wall-mounted, elevated, or passable item.
 *
 * This is the single source of truth for nav-blocking behaviour. `buildNavGrid` in
 * navigation.ts reads this instead of maintaining its own hardcoded type set.
 */
export const ITEM_METADATA: Record<string, { blocksNavigation: boolean; navPadding?: number }> = {
  // ── structural ────────────────────────────────────────────────────────────
  wall:            { blocksNavigation: true  },
  door:            { blocksNavigation: false }, // passable
  // ── seating / lounge ──────────────────────────────────────────────────────
  chair:           { blocksNavigation: false }, // passable / agents sit on them
  couch:           { blocksNavigation: true  },
  couch_v:         { blocksNavigation: true  },
  beanbag:         { blocksNavigation: true  }, // large floor seat (issue #4)
  // ── desks / workstations ──────────────────────────────────────────────────
  desk_cubicle:    { blocksNavigation: true, navPadding: AGENT_RADIUS },
  executive_desk:  { blocksNavigation: true  },
  // ── tables ────────────────────────────────────────────────────────────────
  round_table:     { blocksNavigation: true  },
  table_rect:      { blocksNavigation: true  },
  pingpong:        { blocksNavigation: true  },
  // ── storage / shelving ────────────────────────────────────────────────────
  bookshelf:       { blocksNavigation: true  },
  cabinet:         { blocksNavigation: true  },
  wall_cabinet:    { blocksNavigation: false }, // wall-mounted; agents walk under
  // ── kitchen appliances ────────────────────────────────────────────────────
  fridge:          { blocksNavigation: true  },
  stove:           { blocksNavigation: true  },
  microwave:       { blocksNavigation: false }, // counter-top / elevated
  dishwasher:      { blocksNavigation: true  }, // floor appliance (issue #4)
  sink:            { blocksNavigation: true  },
  coffee_machine:  { blocksNavigation: false }, // elevated on counter
  // ── office equipment ──────────────────────────────────────────────────────
  printer:         { blocksNavigation: true  },
  vending:         { blocksNavigation: true  },
  atm:             { blocksNavigation: true  },
  whiteboard:      { blocksNavigation: true  },
  computer:        { blocksNavigation: false }, // desk item
  keyboard:        { blocksNavigation: false }, // desk decoration
  mouse:           { blocksNavigation: false }, // desk decoration
  // ── server room ───────────────────────────────────────────────────────────
  server_rack:     { blocksNavigation: true  },
  server_terminal: { blocksNavigation: true  }, // floor-standing terminal (issue #4)
  sms_booth:       { blocksNavigation: true  },
  phone_booth:     { blocksNavigation: true  },
  // ── QA lab ────────────────────────────────────────────────────────────────
  qa_terminal:     { blocksNavigation: true  },
  kanban_board:    { blocksNavigation: true  },
  device_rack:     { blocksNavigation: true  },
  test_bench:      { blocksNavigation: true  },
  // ── gym ───────────────────────────────────────────────────────────────────
  treadmill:       { blocksNavigation: true  },
  weight_bench:    { blocksNavigation: true  },
  dumbbell_rack:   { blocksNavigation: true  },
  exercise_bike:   { blocksNavigation: true  },
  punching_bag:    { blocksNavigation: true  },
  jukebox:         { blocksNavigation: true  },
  rowing_machine:  { blocksNavigation: true  },
  kettlebell_rack: { blocksNavigation: true  },
  yoga_mat:        { blocksNavigation: true  },
  // ── art room ──────────────────────────────────────────────────────────────
  easel:           { blocksNavigation: true  }, // floor-standing prop (issue #4)
  // ── water cooler ──────────────────────────────────────────────────────────
  water_cooler:    { blocksNavigation: true  }, // freestanding floor appliance (issue #4)
  // ── decorative / small ────────────────────────────────────────────────────
  plant:           { blocksNavigation: true  },
  lamp:            { blocksNavigation: false }, // floor lamp but thin; passable in practice
  trash:           { blocksNavigation: false }, // small bin
  clock:           { blocksNavigation: false }, // wall-mounted
  mug:             { blocksNavigation: false }, // desk item
};

export const FURNITURE_ROTATION: Record<string, number> = {
  couch: Math.PI,
  couch_v: Math.PI / 2,
  executive_desk: -Math.PI / 2,
  whiteboard: Math.PI / 2,
};

export const getItemRotationRadians = (item: FurnitureItem) =>
  ((item.facing ?? 0) * Math.PI) / 180 +
  (FURNITURE_ROTATION[resolveItemTypeKey(item)] ?? 0);

export const getItemBounds = (item: FurnitureItem) => {
  const { width, height } = getItemBaseSize(item);
  const rotation = getItemRotationRadians(item);
  const absCos = Math.abs(Math.cos(rotation));
  const absSin = Math.abs(Math.sin(rotation));
  const boundsWidth = width * absCos + height * absSin;
  const boundsHeight = width * absSin + height * absCos;
  const centerX = item.x + width / 2;
  const centerY = item.y + height / 2;
  return {
    x: centerX - boundsWidth / 2,
    y: centerY - boundsHeight / 2,
    w: boundsWidth,
    h: boundsHeight,
    width,
    height,
  };
};

export const workstationPoint = (item: FurnitureItem, x: number, z: number) => {
  const scale = WORKSTATION_SCALE[item.type as keyof typeof WORKSTATION_SCALE];
  const { width, height } = getItemBaseSize(item), angle = getItemRotationRadians(item);
  const dx = x * scale / SCALE - width / 2, dy = z * scale / SCALE - height / 2;
  // Same pivot and Three.js Y rotation as buildFurnitureItemMatrix.
  return { x: item.x + width / 2 + dx * Math.cos(angle) + dy * Math.sin(angle),
    y: item.y + height / 2 - dx * Math.sin(angle) + dy * Math.cos(angle) };
};

export const getNavigationBounds = (item: FurnitureItem) => {
  if (item.type !== "desk_cubicle" && item.type !== "chair") return getItemBounds(item);
  const model = item.type === "chair" ? workstationModels.chairDesk : workstationModels.desk;
  const points = [workstationPoint(item, model.min[0], model.min[2]), workstationPoint(item, model.min[0], model.max[2]),
    workstationPoint(item, model.max[0], model.min[2]), workstationPoint(item, model.max[0], model.max[2])];
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, w: Math.max(...points.map(p => p.x)) - x, h: Math.max(...points.map(p => p.y)) - y };
};

const workstationLocalPoint = (point: CanvasPoint, item: FurnitureItem) => {
  const scale = WORKSTATION_SCALE[item.type as keyof typeof WORKSTATION_SCALE];
  const { width, height } = getItemBaseSize(item), angle = getItemRotationRadians(item);
  const dx = point.x - item.x - width / 2, dy = point.y - item.y - height / 2;
  const x = (dx * Math.cos(angle) - dy * Math.sin(angle) + width / 2) * SCALE / scale;
  const z = (dx * Math.sin(angle) + dy * Math.cos(angle) + height / 2) * SCALE / scale;
  return { x, y: z };
};

export const workstationClearance = (point: CanvasPoint, item: FurnitureItem) => {
  const model = item.type === "chair" ? workstationModels.chairDesk : workstationModels.desk;
  const scale = WORKSTATION_SCALE[item.type as keyof typeof WORKSTATION_SCALE];
  const { x, y: z } = workstationLocalPoint(point, item);
  return Math.hypot(Math.max(model.min[0] - x, 0, x - model.max[0]), Math.max(model.min[2] - z, 0, z - model.max[2])) * scale / SCALE;
};

export const segmentIntersectsBounds = (from: CanvasPoint, to: CanvasPoint, bounds: { x: number; y: number; w: number; h: number }) => {
  let enter = 0, exit = 1;
  for (const axis of ["x", "y"] as const) {
    const delta = to[axis] - from[axis], min = bounds[axis], max = min + (axis === "x" ? bounds.w : bounds.h);
    if (Math.abs(delta) < 1e-10) { if (from[axis] < min || from[axis] > max) return false; continue; }
    const a = (min - from[axis]) / delta, b = (max - from[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
};

export const segmentIntersectsWorkstation = (from: CanvasPoint, to: CanvasPoint, item: FurnitureItem, padding: number) => {
  const model = item.type === "chair" ? workstationModels.chairDesk : workstationModels.desk;
  const scale = WORKSTATION_SCALE[item.type as keyof typeof WORKSTATION_SCALE], pad = padding * SCALE / scale;
  return segmentIntersectsBounds(workstationLocalPoint(from, item), workstationLocalPoint(to, item),
    { x: model.min[0] - pad, y: model.min[2] - pad, w: model.max[0] - model.min[0] + 2 * pad, h: model.max[2] - model.min[2] + 2 * pad });
};

export const deskFrontPoint = (item: FurnitureItem) => {
  const model = workstationModels.desk;
  return workstationPoint(item, (model.min[0] + model.max[0]) / 2,
    model.max[2] + (AGENT_RADIUS + 2) * SCALE / WORKSTATION_SCALE.desk_cubicle);
};

export const createWallItem = (
  start: CanvasPoint,
  end: CanvasPoint,
  uid: string,
): FurnitureItem => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (horizontal) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    return {
      _uid: uid,
      type: "wall",
      x: snap(minX),
      y: snap(start.y) - WALL_THICKNESS / 2,
      w: Math.max(MIN_WALL_LENGTH, snap(maxX - minX) + WALL_THICKNESS),
      h: WALL_THICKNESS,
      facing: 0,
    };
  }

  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return {
    _uid: uid,
    type: "wall",
    x: snap(start.x) - WALL_THICKNESS / 2,
    y: snap(minY),
    w: WALL_THICKNESS,
    h: Math.max(MIN_WALL_LENGTH, snap(maxY - minY) + WALL_THICKNESS),
    facing: 0,
  };
};
