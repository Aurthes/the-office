import { circleHitsBox, collisionBounds, segmentHitsBox, type CollisionBox } from "./collision";
import { AGENT_RADIUS, CANVAS_H, CANVAS_W } from "@/features/retro-office/core/constants";
import {
  getNavigationBounds,
  getItemBounds,
  workstationClearance,
  segmentIntersectsBounds,
  segmentIntersectsWorkstation,
  ITEM_FOOTPRINT,
  ITEM_METADATA,
  snap,
} from "@/features/retro-office/core/geometry";
import type {
  FacingPoint,
  DeskWorkstation,
  CanvasPoint,
  FurnitureItem,
  GymWorkoutLocation,
  QaLabStationLocation,
} from "@/features/retro-office/core/types";
export {
  GYM_DEFAULT_TARGET,
  resolveGymRoute,
} from "@/features/retro-office/core/navigation/gymRoute";
export { getJanitorCleaningStops } from "@/features/retro-office/core/navigation/janitorStops";
export {
  resolveSmsBoothRoute,
  SMS_BOOTH_DEFAULT_TARGET,
} from "@/features/retro-office/core/navigation/smsBoothRoute";
export {
  PHONE_BOOTH_DEFAULT_TARGET,
  resolvePhoneBoothRoute,
} from "@/features/retro-office/core/navigation/phoneBoothRoute";
export {
  QA_LAB_DEFAULT_TARGET,
  resolveQaLabRoute,
} from "@/features/retro-office/core/navigation/qaLabRoute";
export {
  resolveServerRoomRoute,
  SERVER_ROOM_TARGET,
} from "@/features/retro-office/core/navigation/serverRoomRoute";

export const resolvePingPongTargets = (
  item: FurnitureItem,
  physical?: CollisionBox,
): [FacingPoint, FacingPoint] => {
  if (physical) {
    return [-1, 1].map(side => {
      const distance = side * (physical.halfX + AGENT_RADIUS + 8);
      const x = physical.x + Math.cos(physical.angle) * distance, y = physical.y + Math.sin(physical.angle) * distance;
      return { x, y, facing: Math.atan2(physical.x - x, physical.y - y) };
    }) as [FacingPoint, FacingPoint];
  }
  const width = item.w ?? 100;
  const depth = item.h ?? 60;
  const centerY = snap(item.y + depth / 2);
  return [
    { x: snap(item.x - 40), y: centerY, facing: Math.PI / 2 },
    { x: snap(item.x + width + 20), y: centerY, facing: -Math.PI / 2 },
  ];
};

export const ROAM_POINTS = [
  { x: 800, y: 200 },
  { x: 850, y: 500 },
  { x: 820, y: 580 },
  { x: 450, y: 420 },
  { x: 250, y: 420 },
  { x: 650, y: 420 },
  { x: 150, y: 620 },
];

export const JANITOR_ENTRY_POINTS: FacingPoint[] = [
  { x: 80, y: 360, facing: Math.PI / 2 },
  { x: 820, y: 70, facing: Math.PI },
  { x: 1540, y: 360, facing: -Math.PI / 2 },
];

export const JANITOR_EXIT_POINTS: FacingPoint[] = [
  { x: 110, y: 680, facing: Math.PI / 2 },
  { x: 820, y: 680, facing: Math.PI },
  { x: 1510, y: 680, facing: -Math.PI / 2 },
];

const GRID_CELL = 25;
const GRID_COLS = Math.ceil(CANVAS_W / GRID_CELL);
const GRID_ROWS = Math.ceil(CANVAS_H / GRID_CELL);

export type NavGrid = Uint8Array;
// Preserve precise obstacle volumes beside the conservative raster. A valid
// chair/standing point may share a raster cell with a desk edge.
type NavVolume = { contains: (x: number, y: number) => boolean; intersects: (from: CanvasPoint, to: CanvasPoint) => boolean };
const gridVolumes = new WeakMap<NavGrid, NavVolume[]>();
const gridMetrics = new WeakMap<NavGrid, { cell: number; cols: number; rows: number; offset: number; near: Map<number, NavVolume[]> }>();

function buildCollisionGrid(boxes: CollisionBox[], bounds = { width: CANVAS_W, height: CANVAS_H }): NavGrid {
  const cell = 10, cols = Math.ceil(bounds.width / cell), rows = Math.ceil(bounds.height / cell);
  const grid = new Uint8Array(cols * rows), volumes: NavVolume[] = [], near = new Map<number, NavVolume[]>();
  for (const box of boxes) {
    const volume: NavVolume = { contains: (x, y) => circleHitsBox({ x, y }, box), intersects: (a, b) => segmentHitsBox(a, b, box) };
    volumes.push(volume);
    const bounds = collisionBounds(box, AGENT_RADIUS + cell);
    const c1 = Math.max(0, Math.floor(bounds.x / cell)), c2 = Math.min(cols - 1, Math.ceil((bounds.x + bounds.w) / cell));
    const r1 = Math.max(0, Math.floor(bounds.y / cell)), r2 = Math.min(rows - 1, Math.ceil((bounds.y + bounds.h) / cell));
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const index = r * cols + c, bucket = near.get(index);
      if (bucket) bucket.push(volume); else near.set(index, [volume]);
      if (volume.contains(c * cell, r * cell)) grid[index] = 1;
    }
  }
  for (let c = 0; c < cols; c++) { grid[c] = 1; grid[(rows - 1) * cols + c] = 1; }
  for (let r = 0; r < rows; r++) { grid[r * cols] = 1; grid[r * cols + cols - 1] = 1; }
  gridVolumes.set(grid, volumes);
  gridMetrics.set(grid, { cell, cols, rows, offset: 0, near });
  return grid;
}

// Only needed after a physical contact; moving people are not baked into the
// cached static grid every frame. The same swept-volume checks cover both.
export function withAgentObstacles(grid: NavGrid, positions: CanvasPoint[]): NavGrid {
  const copy = grid.slice(), metrics = gridMetrics.get(grid);
  if (!metrics) return grid;
  const volumes = [...(gridVolumes.get(grid) ?? [])], near = new Map([...metrics.near].map(([key, values]) => [key, [...values]]));
  const radius = AGENT_RADIUS * 2 + .001;
  for (const p of positions) {
    const volume: NavVolume = { contains: (x, y) => Math.hypot(x - p.x, y - p.y) < radius,
      intersects: (a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
        return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) < radius;
      } };
    volumes.push(volume);
    for (let r = Math.max(1, Math.floor((p.y - radius - metrics.cell) / metrics.cell)); r <= Math.min(metrics.rows - 2, Math.ceil((p.y + radius + metrics.cell) / metrics.cell)); r++) {
      for (let c = Math.max(1, Math.floor((p.x - radius - metrics.cell) / metrics.cell)); c <= Math.min(metrics.cols - 2, Math.ceil((p.x + radius + metrics.cell) / metrics.cell)); c++) {
        const index = r * metrics.cols + c, bucket = near.get(index);
        if (bucket) bucket.push(volume); else near.set(index, [volume]);
        if (volume.contains(c * metrics.cell, r * metrics.cell)) copy[index] = 1;
      }
    }
  }
  gridVolumes.set(copy, volumes); gridMetrics.set(copy, { ...metrics, near }); return copy;
}

/**
 * Returns true if the given item type should block pathfinding cells.
 * Only for non-rendered layout previews. Live scenes supply all measured
 * collision boxes, including new types absent from this legacy metadata.
 */
const itemBlocksNavigation = (type: string): boolean =>
  ITEM_METADATA[type]?.blocksNavigation ?? false;

export function buildNavGrid(furniture: FurnitureItem[], measuredGeometry?: CollisionBox[], bounds?: { width: number; height: number }): NavGrid {
  // Live scenes always supply measured meshes. The footprint fallback remains
  // for non-rendered layout previews and callers that have no Three.js scene.
  if (measuredGeometry) return buildCollisionGrid(measuredGeometry, bounds);
  const grid = new Uint8Array(GRID_COLS * GRID_ROWS);
  const defaultPad = GRID_CELL * 0.6;
  const volumes: NavVolume[] = [];
  for (const item of furniture) {
    if (!itemBlocksNavigation(item.type)) continue;
    const itemPad = ITEM_METADATA[item.type]?.navPadding ?? defaultPad;
    const bounds = getNavigationBounds(item);
    const x1 = bounds.x - itemPad;
    const y1 = bounds.y - itemPad;
    const x2 = bounds.x + bounds.w + itemPad;
    const y2 = bounds.y + bounds.h + itemPad;
    volumes.push(item.type === "desk_cubicle"
      ? { contains: (x, y) => workstationClearance({ x, y }, item) <= itemPad,
          intersects: (from, to) => segmentIntersectsWorkstation(from, to, item, itemPad) }
      : { contains: (x, y) => x >= x1 && x <= x2 && y >= y1 && y <= y2,
          intersects: (from, to) => segmentIntersectsBounds(from, to, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }) });
    const c1 = Math.max(0, Math.floor(x1 / GRID_CELL));
    const c2 = Math.min(GRID_COLS - 1, Math.floor(x2 / GRID_CELL));
    const r1 = Math.max(0, Math.floor(y1 / GRID_CELL));
    const r2 = Math.min(GRID_ROWS - 1, Math.floor(y2 / GRID_CELL));
    for (let row = r1; row <= r2; row += 1) {
      for (let column = c1; column <= c2; column += 1) {
        grid[row * GRID_COLS + column] = 1;
      }
    }
  }

  for (let column = 0; column < GRID_COLS; column += 1) {
    grid[column] = 1;
    grid[(GRID_ROWS - 1) * GRID_COLS + column] = 1;
  }
  for (let row = 0; row < GRID_ROWS; row += 1) {
    grid[row * GRID_COLS] = 1;
    grid[row * GRID_COLS + GRID_COLS - 1] = 1;
  }
  gridVolumes.set(grid, volumes);
  return grid;
}

export function astar(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  grid: NavGrid,
): { x: number; y: number }[] {
  const metrics = gridMetrics.get(grid);
  const cellSize = metrics?.cell ?? GRID_CELL, columns = metrics?.cols ?? GRID_COLS, rows = metrics?.rows ?? GRID_ROWS;
  const centreOffset = metrics?.offset ?? GRID_CELL / 2;
  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));
  const toCell = (x: number, y: number) => ({
    c: clamp(Math.round((x - centreOffset) / cellSize), 0, columns - 1),
    r: clamp(Math.round((y - centreOffset) / cellSize), 0, rows - 1),
  });
  const cellCx = (column: number) => column * cellSize + centreOffset;
  const cellCy = (row: number) => row * cellSize + centreOffset;
  const volumes = gridVolumes.get(grid);
  const exactPointIsSafe = (x: number, y: number) => {
    const cell = toCell(x, y);
    const insideFloor = x >= cellSize && y >= cellSize && x < (columns - 1) * cellSize && y < (rows - 1) * cellSize;
    return insideFloor && (volumes ? !volumes.some(volume => volume.contains(x, y)) : !grid[cell.r * columns + cell.c]);
  };
  const exactStartIsSafe = exactPointIsSafe(sx, sy), exactEndIsSafe = exactPointIsSafe(ex, ey);
  if (metrics && exactStartIsSafe && exactEndIsSafe && !volumes?.some(v => v.intersects({ x: sx, y: sy }, { x: ex, y: ey }))) return [{ x: ex, y: ey }];
  const connects = (point: CanvasPoint, c: number, r: number) => !volumes
    || !volumes.some(volume => volume.intersects({ x: cellCx(c), y: cellCy(r) }, point));

  const findFree = (column: number, row: number, accept: (c: number, r: number) => boolean = () => true) => {
    if (!grid[row * columns + column] && accept(column, row)) return { c: column, r: row };
    for (let distance = 1; distance < 10; distance += 1) {
      for (let rowOffset = -distance; rowOffset <= distance; rowOffset += 1) {
        for (
          let columnOffset = -distance;
          columnOffset <= distance;
          columnOffset += 1
        ) {
          if (
            Math.abs(rowOffset) !== distance &&
            Math.abs(columnOffset) !== distance
          ) {
            continue;
          }
          const nextRow = row + rowOffset;
          const nextColumn = column + columnOffset;
          if (
            nextRow < 0 ||
            nextRow >= rows ||
            nextColumn < 0 ||
            nextColumn >= columns
          ) {
            continue;
          }
          if (!grid[nextRow * columns + nextColumn] && accept(nextColumn, nextRow)) {
            return { c: nextColumn, r: nextRow };
          }
        }
      }
    }
    return null;
  };

  let { c: sc, r: sr } = toCell(sx, sy);
  let { c: ec, r: er } = toCell(ex, ey);
  const startFree = findFree(sc, sr, (c, r) => !exactStartIsSafe || connects({ x: sx, y: sy }, c, r));
  const endFree = findFree(ec, er, (c, r) => !exactEndIsSafe || connects({ x: ex, y: ey }, c, r));
  if (!startFree || !endFree) return [];
  sc = startFree.c;
  sr = startFree.r;
  ec = endFree.c;
  er = endFree.r;
  const destination = exactEndIsSafe ? { x: ex, y: ey } : { x: cellCx(ec), y: cellCy(er) };
  const finishPath = (path: CanvasPoint[]) => {
    // Keep the safe cell centres: replacing one with the exact pixel can cut
    // across a rotated desk, even when that pixel itself is outside the desk.
    if (volumes && exactStartIsSafe) path.unshift({ x: cellCx(sc), y: cellCy(sr) });
    const last = path.at(-1);
    if (!last || last.x !== destination.x || last.y !== destination.y) path.push(destination);
    return path;
  };
  // Same nav cell: start and end are close enough that A* has no grid edges
  // to traverse. The destination is still reachable — return a single-waypoint
  // path to the exact target pixel so the movement layer can make the final
  // fine-grained adjustment instead of staying put.
  if (sc === ec && sr === er) {
    return volumes?.some(volume => volume.intersects({ x: sx, y: sy }, destination))
      ? finishPath([]) : [destination];
  }

  const nodeCount = columns * rows;
  const gCost = new Float32Array(nodeCount).fill(Infinity);
  const parent = new Int32Array(nodeCount).fill(-1);
  const visited = new Uint8Array(nodeCount);
  const startIndex = sr * columns + sc;
  const endIndex = er * columns + ec;
  gCost[startIndex] = 0;

  const open: [number, number][] = [];
  const pushOpen = (entry: [number, number]) => {
    open.push(entry);
    let index = open.length - 1;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (open[parentIndex][1] <= entry[1]) break;
      open[index] = open[parentIndex];
      index = parentIndex;
    }
    open[index] = entry;
  };
  const popOpen = (): [number, number] | null => {
    if (open.length === 0) return null;
    const first = open[0];
    const last = open.pop();
    if (!last || open.length === 0) return first;
    let index = 0;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      if (leftIndex >= open.length) break;
      let smallestIndex = leftIndex;
      if (
        rightIndex < open.length &&
        open[rightIndex][1] < open[leftIndex][1]
      ) {
        smallestIndex = rightIndex;
      }
      if (open[smallestIndex][1] >= last[1]) break;
      open[index] = open[smallestIndex];
      index = smallestIndex;
    }
    open[index] = last;
    return first;
  };
  pushOpen([startIndex, Math.hypot(ec - sc, er - sr)]);
  const directions: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ];

  while (open.length) {
    const next = popOpen();
    if (!next) break;
    const [current] = next;
    if (visited[current]) continue;
    visited[current] = 1;

    if (current === endIndex) {
      const path: { x: number; y: number }[] = [];
      let node = current;
      while (node !== startIndex) {
        path.push({
          x: cellCx(node % columns),
          y: cellCy(Math.floor(node / columns)),
        });
        node = parent[node];
      }
      path.reverse();
      return finishPath(path);
    }

    const currentColumn = current % columns;
    const currentRow = Math.floor(current / columns);
    for (const [columnOffset, rowOffset, cost] of directions) {
      const nextColumn = currentColumn + columnOffset;
      const nextRow = currentRow + rowOffset;
      if (
        nextColumn < 0 ||
        nextColumn >= columns ||
        nextRow < 0 ||
        nextRow >= rows
      ) {
        continue;
      }
      const nextIndex = nextRow * columns + nextColumn;
      if (visited[nextIndex] || grid[nextIndex]) continue;
      if (metrics?.near.get(current)?.some(volume => volume.intersects(
        { x: cellCx(currentColumn), y: cellCy(currentRow) },
        { x: cellCx(nextColumn), y: cellCy(nextRow) }))) continue;

      // For diagonal moves, require both orthogonal neighbours to be free so
      // agents cannot clip through the corner of a blocked cell (issue #6).
      // E.g. moving NE (dc=+1, dr=-1) requires N (dc=0, dr=-1) and E (dc=+1, dr=0) to be clear.
      if (columnOffset !== 0 && rowOffset !== 0) {
        const orthogonalA =
          (currentRow + rowOffset) * columns + currentColumn;
        const orthogonalB =
          currentRow * columns + (currentColumn + columnOffset);
        if (grid[orthogonalA] || grid[orthogonalB]) continue;
      }
      const nextCost = gCost[current] + cost;
      if (nextCost < gCost[nextIndex]) {
        gCost[nextIndex] = nextCost;
        parent[nextIndex] = current;
        pushOpen([
          nextIndex,
          nextCost + Math.hypot(ec - nextColumn, er - nextRow),
        ]);
      }
    }
  }

  return [];
}

export { getDeskWorkstations as getDeskLocations } from "./workstations";

export const getMeetingSeatLocations = (items: FurnitureItem[]) => {
  // Meeting seats are inferred from chair placement in the conference area so standup
  // gathering follows the authored layout instead of a hardcoded attendee list.
  const chairs = items
    .filter(
      (item) =>
        item.type === "chair" &&
        item.x >= 0 &&
        item.x <= 290 &&
        item.y >= 0 &&
        item.y <= 235,
    )
    .sort((left, right) => left.y - right.y || left.x - right.x);
  if (chairs.length === 0) return [];

  const chairCenters = chairs.map((item) => ({
    item,
    x: item.x + ITEM_FOOTPRINT.chair[0] / 2,
    y: item.y + ITEM_FOOTPRINT.chair[1] / 2,
  }));
  const centerX =
    chairCenters.reduce((sum, chair) => sum + chair.x, 0) / chairCenters.length;
  const centerY =
    chairCenters.reduce((sum, chair) => sum + chair.y, 0) / chairCenters.length;

  return chairCenters.map((chair) => {
    const offsetX = chair.x - centerX;
    const offsetY = chair.y - centerY;
    const distance = Math.hypot(offsetX, offsetY) || 1;
    const seatPullback = 14;
    return {
      x: chair.x + (offsetX / distance) * seatPullback,
      y: chair.y + (offsetY / distance) * seatPullback,
      facing: Math.atan2(centerX - chair.x, centerY - chair.y),
    };
  });
};

export const getGymWorkoutLocations = (
  items: FurnitureItem[],
): GymWorkoutLocation[] =>
  items
    .filter((item) =>
      [
        "treadmill",
        "weight_bench",
        "dumbbell_rack",
        "exercise_bike",
        "punching_bag",
        "rowing_machine",
        "kettlebell_rack",
        "yoga_mat",
      ].includes(item.type),
    )
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map((item) => {
      // Each workout target is an agent standing point plus a facing direction toward equipment.
      const bounds = getItemBounds(item);
      const equipmentCenterX = bounds.x + bounds.w / 2;
      const equipmentCenterY = bounds.y + bounds.h / 2;
      const facingTowardEquipment = (targetX: number, targetY: number) =>
        Math.atan2(equipmentCenterX - targetX, equipmentCenterY - targetY);
      if (item.type === "treadmill") {
        const x = item.x + 35;
        const y = item.y + 65;
        return {
          x,
          y,
          facing: facingTowardEquipment(x, y),
          workoutStyle: "run",
        };
      }
      if (item.type === "weight_bench") {
        const x = item.x + 38;
        const y = item.y + 20;
        return {
          x,
          y,
          facing: facingTowardEquipment(x, y),
          workoutStyle: "lift",
        };
      }
      if (item.type === "dumbbell_rack" || item.type === "kettlebell_rack") {
        const x = item.x - 18;
        const y = item.y + 14;
        return {
          x,
          y,
          facing: facingTowardEquipment(x, y),
          workoutStyle: "lift",
        };
      }
      if (item.type === "exercise_bike") {
        const x = item.x + 18;
        const y = item.y + 28;
        return {
          x,
          y,
          facing: facingTowardEquipment(x, y),
          workoutStyle: "bike",
        };
      }
      if (item.type === "rowing_machine") {
        const x = item.x + 28;
        const y = item.y + 16;
        return {
          x,
          y,
          facing: facingTowardEquipment(x, y),
          workoutStyle: "row",
        };
      }
      if (item.type === "yoga_mat") {
        const x = item.x + 35;
        const y = item.y + 15;
        return {
          x,
          y,
          facing: facingTowardEquipment(x, y),
          workoutStyle: "stretch",
        };
      }
      const x = item.x - 18;
      const y = item.y + 14;
      return {
        x,
        y,
        facing: facingTowardEquipment(x, y),
        workoutStyle: "box",
      };
    });

export const getQaLabStations = (
  items: FurnitureItem[],
): QaLabStationLocation[] =>
  items
    .filter((item) =>
      ["qa_terminal", "device_rack", "test_bench"].includes(item.type),
    )
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map((item) => {
      // QA stations follow the same pattern as gym targets: derive a nearby standing point
      // from authored furniture so scene motion stays data-driven.
      const bounds = getItemBounds(item);
      const stationCenterX = bounds.x + bounds.w / 2;
      const stationCenterY = bounds.y + bounds.h / 2;
      const facingTowardStation = (targetX: number, targetY: number) =>
        Math.atan2(stationCenterX - targetX, stationCenterY - targetY);

      if (item.type === "qa_terminal") {
        const x = item.x + 26;
        const y = item.y + 56;
        return {
          x,
          y,
          facing: facingTowardStation(x, y),
          stationType: "console" as const,
        };
      }
      if (item.type === "device_rack") {
        const x = item.x - 18;
        const y = item.y + 18;
        return {
          x,
          y,
          facing: facingTowardStation(x, y),
          stationType: "device_rack" as const,
        };
      }
      const x = item.x + 45;
      const y = item.y + 58;
      return {
        x,
        y,
        facing: facingTowardStation(x, y),
        stationType: "bench" as const,
      };
    });

export const MEETING_OVERFLOW_LOCATIONS = [
  { x: 18, y: 118, facing: Math.PI / 2 },
  { x: 270, y: 118, facing: -Math.PI / 2 },
  { x: 145, y: 24, facing: Math.PI },
  { x: 145, y: 220, facing: 0 },
];

export const resolveDeskIndexForItem = (
  item: FurnitureItem,
  deskLocations: DeskWorkstation[],
): number => {
  if (deskLocations.length === 0) return -1;
  if (item.type === "desk_cubicle") {
    return deskLocations.findIndex(
      (desk) => desk.deskUid === item._uid,
    );
  }

  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < deskLocations.length; index += 1) {
    const desk = deskLocations[index];
    if (!desk) continue;
    const distance = Math.hypot(item.x - desk.x, item.y - desk.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestDistance <= 80 ? bestIndex : -1;
};
