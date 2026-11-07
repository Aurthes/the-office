import { expect, it } from "vitest";
import { fillState, quoteState, gapColor, probabilityGap } from "@/lib/fill-probability/model";
import { FILL_NOW, fillQuote, fillRow } from "../fixtures/fill-probability";

it("compares one-second probabilities with signed absolute and relative gaps", () => {
  expect(probabilityGap(0.0012, 0.001, false)).toMatchObject({ absolute: expect.closeTo(0.0002), relative: expect.closeTo(0.2) });
  expect(probabilityGap(0.0008, 0.001, false)).toMatchObject({ absolute: expect.closeTo(-0.0002), relative: expect.closeTo(-0.2) });
  expect(probabilityGap(0, 0.001, true)).toMatchObject({ absolute: -0.001, relative: -1 });
  for (const [value, target] of [[null, 0.001], [NaN, 0.001], [0.001, 0], [0.001, null], [2, 0.001], [0.001, 1]] as const) expect(probabilityGap(value, target, true)).toBeNull();
});
it("uses a monotonic symmetric distance color and neutral unknown evidence", () => {
  const distances = [0, 0.1, 0.25, 0.5, 1, 2];
  const hues = distances.map(d => Number(gapColor(d, true).match(/hsl\(([0-9.]+)/)![1]));
  expect(hues).toEqual([120, 108, 90, 60, 0, 0]);
  for (const d of distances) {
    expect(gapColor(d, true)).toBe(gapColor(-d, true));
    expect(gapColor(d, false)).toBe("#a8b5bd");
  }
  expect(gapColor(Infinity, true)).toBe("#a8b5bd");
});
it("keeps fresh supported cache values historical because observation readiness is absent", () => {
  expect(fillState(fillRow(), FILL_NOW)).toBe("snapshot");
  expect(fillState(fillRow({ schema: 9, clock: "trials" }), FILL_NOW)).toBe("snapshot");
  expect(fillState(fillRow({ schema: 8, clock: "trials" }), FILL_NOW)).toBe("unknown");
  expect(fillState(fillRow({ sourceSha: null }), FILL_NOW)).toBe("unknown");
  expect(fillState(fillRow({ savedAt: null }), FILL_NOW)).toBe("unknown");
  expect(fillState(fillRow({ heartbeatAt: null }), FILL_NOW)).toBe("unknown");
  expect(fillState(fillRow({ schema: null, reason: "cache-not-exported" }), FILL_NOW)).toBe("unknown");
  expect(fillState(fillRow({ enabled: false }), FILL_NOW)).toBe("disabled");
  expect(fillState(fillRow({ weightedExposureSeconds: 0 }), FILL_NOW)).toBe("empty");
});
it("expires cached evidence without relying on another API response", () => {
  expect(fillState(fillRow(), FILL_NOW + 29_999)).toBe("snapshot");
  expect(fillState(fillRow(), FILL_NOW + 30_000)).toBe("stale");
  expect(fillState(fillRow({ heartbeatAt: FILL_NOW - 30_000 }), FILL_NOW)).toBe("stale");
  expect(fillState(fillRow({ savedAt: FILL_NOW + 6_000 }), FILL_NOW)).toBe("stale");
  expect(fillState(fillRow(), FILL_NOW, true)).toBe("stale");
  expect(fillState(fillRow({ error: true }), FILL_NOW)).toBe("stale");
});
it("uses the original ready flag and actual observation time without inventing a confidence threshold", () => {
  expect(fillState(fillRow({ ready: true, observedAt: FILL_NOW }), FILL_NOW)).toBe("ready");
  expect(fillState(fillRow({ ready: false, observedAt: FILL_NOW }), FILL_NOW)).toBe("not-ready");
  expect(fillState(fillRow({ ready: true, observedAt: null }), FILL_NOW)).toBe("snapshot");
  expect(fillState(fillRow({ ready: true, observedAt: FILL_NOW - 30_000 }), FILL_NOW)).toBe("stale");
  expect(fillState(fillRow({ ready: true, observedAt: FILL_NOW + 6_000 }), FILL_NOW)).toBe("stale");
});
it("ages current quote and historical EMA independently", () => {
  const current = fillRow({ quote: fillQuote(), ready: true, observedAt: FILL_NOW - 30_000 });
  expect(fillState(current, FILL_NOW)).toBe("stale");
  expect(quoteState(current, FILL_NOW)).toBe("ready");
  expect(quoteState(fillRow({ savedAt: null, schema: null, quote: fillQuote() }), FILL_NOW)).toBe("ready");
  for (const quote of [fillQuote({ at: FILL_NOW - 30_000 }), fillQuote({ exportedAt: FILL_NOW - 30_000 })])
    expect(quoteState(fillRow({ quote }), FILL_NOW)).toBe("stale");
  expect(quoteState(fillRow({ quote: fillQuote({ available: false }) }), FILL_NOW)).toBe("unknown");
  expect(quoteState(fillRow({ quote: fillQuote(), sourceSha: null }), FILL_NOW)).toBe("unknown");
  expect(quoteState(current, FILL_NOW, true)).toBe("stale");
});
