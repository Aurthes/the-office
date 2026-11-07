// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createFillReader, parseFillSources, parseFillReply, type FillSource } from "@/lib/fill-probability/source";
import { FILL_NOW, fillRow } from "../fixtures/fill-probability";

const source: FillSource = { id: "primary", host: "prod-a", strategies: [{ name: "maker", setting: "/srv/maker/setting.json", sourceSha: "a".repeat(40), feedbackVersion: 8 }] };
it("pins the source and schema and rejects unsafe or ambiguous private configuration", () => {
  expect(parseFillSources({ version: 1, sources: [source] })).toEqual([source]);
  const spec = source.strategies[0];
  for (const s of [{ ...source, host: "-oProxyCommand=bad" }, { ...source, python: "python3;bad" },
    { ...source, strategies: [{ ...spec, sourceSha: "main" }] }, { ...source, strategies: [{ ...spec, feedbackVersion: 7 }] },
    { ...source, strategies: [{ ...spec, setting: "relative" }] }]) expect(() => parseFillSources({ version: 1, sources: [s] })).toThrow();
  expect(() => parseFillSources({ version: 1, sources: [source, source] })).toThrow();
});
it("projects only scalar facts and rejects cross-source or duplicate rows", () => {
  const row = fillRow();
  const result = parseFillReply({ version: 1, rows: [{ ...row, credential: "secret", config: { url: "redis://private" } }] }, source);
  expect(result).toEqual([row]); expect(JSON.stringify(result)).not.toContain("secret");
  for (const rows of [[{ ...row, producer: "other:maker" }], [row, row], [{ ...row, target: NaN }], [{ ...row, sourceSha: "b".repeat(40) }], [{ ...row, schema: 9 }]])
    expect(() => parseFillReply({ version: 1, rows }, source)).toThrow();
});
it("coalesces reads for ten seconds without changing evidence timestamps", async () => {
  let now = FILL_NOW; const load = vi.fn(async () => [fillRow()]); const read = createFillReader(load, () => now);
  const [a,b] = await Promise.all([read([source]), read([source])]);
  expect(load).toHaveBeenCalledTimes(1); expect(a.rows).toEqual(b.rows);
  now += 9_999; expect((await read([source])).rows[0].savedAt).toBe(FILL_NOW); expect(load).toHaveBeenCalledTimes(1);
  now++; await read([source]); expect(load).toHaveBeenCalledTimes(2);
});
it("keeps last facts unverified on transport failure and reports failure even before a first row", async () => {
  let now = FILL_NOW; const load = vi.fn(async () => [fillRow()]); const read = createFillReader(load, () => now);
  await read([source]); now += 10_000; load.mockRejectedValueOnce(new Error("redis://user:password@private"));
  const failed = await read([source]); expect(failed.sourceErrors).toBe(1); expect(failed.rows[0].error).toBe(true);
  expect(failed.rows[0].savedAt).toBe(FILL_NOW); expect(JSON.stringify(failed)).not.toContain("password");
  const firstFailure = await createFillReader(async () => { throw new Error(); })([source]);
  expect(firstFailure).toMatchObject({ sourceErrors: 1, rows: [] });
});
it("changing source configuration during an in-flight read cannot return the previous source", async () => {
  let finish: (value: ReturnType<typeof fillRow>[]) => void = () => undefined;
  const pending = new Promise<ReturnType<typeof fillRow>[]>(resolve => { finish = resolve; });
  const read = createFillReader(() => pending, () => FILL_NOW);
  const old = read([source]); expect(await read([])).toMatchObject({ configured: false, rows: [] });
  finish([fillRow()]); await old;
  expect(await read([])).toMatchObject({ configured: false, rows: [] });
});
