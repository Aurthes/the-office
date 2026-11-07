import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { createDuckAppearanceFromSeed, normalizeDuckAppearance, DEFAULT_DUCK_APPEARANCE, FIREFIGHTER_DUCK_APPEARANCE } from "@/lib/avatars/duck";
import baseline from "../fixtures/duck-appearance-baseline.json";
const shared = createRequire(import.meta.url)("../../src/lib/avatars/duck-appearance.js");
it("preserves the original generator and normalization behavior through the Node CommonJS implementation and TS facade", () => {
  for (const row of baseline.seeds) {
    expect(shared.createDuckAppearanceFromSeed(row.seed)).toEqual(row.value);
    expect(createDuckAppearanceFromSeed(row.seed)).toEqual(row.value);
  }
  for (const row of baseline.normalized) {
    expect(shared.normalizeDuckAppearance(row.input)).toEqual(row.value);
    expect(normalizeDuckAppearance(row.input)).toEqual(row.value);
  }
  expect(DEFAULT_DUCK_APPEARANCE).toEqual(shared.DEFAULT_DUCK_APPEARANCE);
  expect(FIREFIGHTER_DUCK_APPEARANCE).toEqual(shared.FIREFIGHTER_DUCK_APPEARANCE);
  expect(Object.isFrozen(FIREFIGHTER_DUCK_APPEARANCE)).toBe(true);
});
