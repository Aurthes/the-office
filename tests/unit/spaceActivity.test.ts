import { expect, it } from "vitest";
import { emptySpaceEncounter, emptySpacePose, sampleAsteroid, samplePassingShip, sampleSpaceEncounter, SPACE_ACTIVITY_BUDGET, writeSpaceDust } from "@/features/ring-ship/space-activity";

it("varies quiet, traffic, and planetary encounters within fixed, bounded pools", () => {
  const state = emptySpaceEncounter(), labels = new Set<string>(), routes = new Set<string>();
  for (let seed = 0; seed < 5; seed++) for (let time = 0; time < 600; time += .5) {
    expect(sampleSpaceEncounter(time, seed, state)).toBe(state);
    expect(state.trafficCount).toBeGreaterThanOrEqual(0);
    expect(state.trafficCount).toBeLessThanOrEqual(SPACE_ACTIVITY_BUDGET.ships);
    expect(state.planetApproach).toBeGreaterThanOrEqual(0);
    expect(state.planetApproach).toBeLessThanOrEqual(1);
    expect(Math.abs(state.planetPass)).toBeLessThanOrEqual(1);
    if (seed === 0) expect(state.planetApproach).toBe(0);
    labels.add(state.label);
    if (state.trafficCount) routes.add(`${state.trafficCount}:${state.trafficDirection}`);
  }
  expect(labels).toEqual(new Set(["Cruising", "Passing ship", "Convoy passing", "Planetary approach"]));
  expect(routes.size).toBeGreaterThan(3);
  const a = { ...sampleSpaceEncounter(105, 2, state) };
  expect(sampleSpaceEncounter(105, 2, emptySpaceEncounter())).toEqual(a);
});

it("keeps passing objects behind the entire ship instead of flying through cabins", () => {
  const pose = emptySpacePose(), encounter = emptySpaceEncounter();
  const normal = Math.hypot(70, 73, 94);
  const depth = () => -(pose.x * 70 + pose.y * 73 + pose.z * 94) / normal;
  for (const radius of [46, 120]) for (let time = 0; time < 240; time += 2) {
    for (let i = 0; i < SPACE_ACTIVITY_BUDGET.asteroids; i++) {
      sampleAsteroid(i, time, 3, radius, pose);
      expect(depth()).toBeGreaterThanOrEqual(radius + 49.9);
      expect([pose.x, pose.y, pose.z, pose.sx, pose.sy, pose.sz].every(Number.isFinite)).toBe(true);
    }
    sampleSpaceEncounter(time, 3, encounter);
    for (let i = 0; i < SPACE_ACTIVITY_BUDGET.ships; i++) {
      samplePassingShip(i, encounter, radius, pose);
      expect(depth()).toBeGreaterThanOrEqual(radius + 69.9);
      if (i >= encounter.trafficCount) expect(pose.sx).toBe(0);
    }
  }
});

it("only recycles asteroid positions while the object is invisible", () => {
  const a = emptySpacePose(), b = emptySpacePose(); let recycled = 0;
  for (let i = 0; i < SPACE_ACTIVITY_BUDGET.asteroids; i++) for (let time = 0; time < 140; time += .1) {
    sampleAsteroid(i, time, 1, 46, a); sampleAsteroid(i, time + .1, 1, 46, b);
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 60) {
      recycled++; expect(Math.max(a.sx, b.sx)).toBeLessThan(.01);
    }
  }
  expect(recycled).toBeGreaterThan(10);
});

it("updates the same small dust buffers without changing their capacity", () => {
  const positions = new Float32Array(SPACE_ACTIVITY_BUDGET.dust * 3), colors = new Float32Array(positions.length);
  writeSpaceDust(0, 1, 46, positions, colors); const first = positions.slice();
  writeSpaceDust(1, 1, 46, positions, colors);
  expect(positions).not.toEqual(first);
  expect(positions.length).toBe(SPACE_ACTIVITY_BUDGET.dust * 3);
  expect([...positions, ...colors].every(Number.isFinite)).toBe(true);
  expect(colors.every(value => value >= 0 && value <= 1)).toBe(true);
});
