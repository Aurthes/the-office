import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/clawdbot/paths", () => ({ resolveStateDir: () => state.root }));
import { getParticipation, getParticipationSeries } from "@/lib/participation/source";
let root: string;
const H = 3_600_000;
const snapshot = (amount = 10) => ({ version: 1, hour: H, updatedAt: 2 * H, startedAt: H,
  market: [{ exchange: "venue", symbol: "btc", type: "rpi", notional: 100, count: 10, ready: true, reason: "" }],
  own: [{ exchange: "venue", account: "one", symbol: "btc", type: "rpi", notional: amount, count: 1, ready: true, reason: "" }],
});
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "participation-series-")); state.root = root;
  await fs.mkdir(path.join(root, "claw3d")); await fs.mkdir(path.join(root, "data/hours"), { recursive: true });
  await fs.writeFile(path.join(root, "claw3d/participation.json"), JSON.stringify({ directory: path.join(root, "data") }));
  await fs.writeFile(path.join(root, "data/index.json"), JSON.stringify({ version: 1, updatedAt: 3 * H, hours: [H] }));
  await fs.writeFile(path.join(root, `data/hours/${H}.json`), JSON.stringify(snapshot()));
  vi.spyOn(Date, "now").mockReturnValue(3 * H);
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
it("reuses unchanged facts but reloads an amended hourly file", async () => {
  const read = vi.spyOn(fs, "readFile");
  const first = await getParticipationSeries(24, "exchange", {}, "");
  expect(first.points.find(p => p.hour === H)?.rows[0].notionalShare).toBe(.1);
  expect((await getParticipationSeries(24, "exchange", {}, "")).points).toEqual(first.points);
  expect(read.mock.calls.filter(([file]) => String(file).endsWith(`${H}.json`))).toHaveLength(1);
  await fs.writeFile(path.join(root, `data/hours/${H}.json`), JSON.stringify(snapshot(200)));
  const changed = await getParticipationSeries(24, "exchange", {}, "");
  expect(changed.points.find(p => p.hour === H)?.rows[0].notionalShare).toBe(2);
  expect(changed.points.find(p => p.hour === 2 * H)?.available).toBe(false);
  expect((await getParticipation(H)).hour?.own[0].notional).toBe(200);
});
it("rejects a filename/hour mismatch instead of moving facts along the time axis", async () => {
  await fs.writeFile(path.join(root, `data/hours/${H}.json`), JSON.stringify({ ...snapshot(), hour: 2 * H }));
  await expect(getParticipationSeries(24, "exchange", {}, "")).rejects.toThrow("Invalid participation hour");
});
