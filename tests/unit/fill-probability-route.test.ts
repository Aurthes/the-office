// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), benchmark: vi.fn() }));
vi.mock("@/lib/fill-probability/source", () => ({ getFillSnapshot: mocks.read }));
vi.mock("@/lib/fill-probability/read-benchmark", () => ({ readTaskPathBenchmark: mocks.benchmark }));
import { GET } from "@/app/api/monitoring/fill-probability/route";
it("serves same-origin read-only facts with no-store", async () => {
  mocks.read.mockResolvedValueOnce({ configured: false, serverTime: 123, rows: [] });
  const response = await GET(new Request("https://office.test/api/monitoring/fill-probability")); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ configured: false, rows: [] });
});
it("does not expose source error details", async () => {
  mocks.read.mockRejectedValueOnce(new Error("redis://private:password@host"));
  const response = await GET(new Request("https://office.test/api/monitoring/fill-probability")); expect(response.status).toBe(503); expect(await response.text()).not.toContain("password");
});


it("compresses the original large snapshot before the tunnel without changing facts", async () => {
  const snapshot = { configured: true, serverTime: 123, sourceErrors: 0, rows: Array.from({ length: 50 }, (_, id) => ({ id, actualEma: .0004, target: .001, quote: { finalProbability: .0009 } })) };
  mocks.read.mockResolvedValueOnce(snapshot);
  const response = await GET(new Request("https://office.test/api/monitoring/fill-probability", { headers: { "Accept-Encoding": "br, gzip" } }));
  expect(response.headers.get("content-encoding")).toBe("gzip");
  expect(response.headers.get("vary")).toBe("Accept-Encoding");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(bytes.length).toBeLessThan(JSON.stringify(snapshot).length / 2);
  expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(snapshot);
});

it("honors gzip refusal and retains the same uncompressed JSON", async () => {
  const snapshot = { configured: true, serverTime: 123, rows: [{ symbol: "a".repeat(2000) }] };
  mocks.read.mockResolvedValueOnce(snapshot);
  const response = await GET(new Request("https://office.test/api/monitoring/fill-probability", { headers: { "Accept-Encoding": "gzip;q=0, br" } }));
  expect(response.headers.get("content-encoding")).toBeNull();
  expect(await response.json()).toEqual(snapshot);
});

it("keeps task dispatch separate from the ordinary cached source", async () => {
  const data = { contract: "t85-html-read-v1", source: "disk", rows: [{ fields: [] }] };
  mocks.benchmark.mockResolvedValueOnce(data);
  const r = await GET(new Request("https://office.test/api/monitoring/fill-probability?benchmarkSource=disk&benchmarkRun=approved01", { headers: { "Accept-Encoding": "gzip" } }));
  expect(mocks.benchmark).toHaveBeenLastCalledWith("disk", "approved01");
  expect(r.headers.get("content-encoding")).toBe("gzip");
  expect(JSON.parse(gunzipSync(new Uint8Array(await r.arrayBuffer())).toString())).toEqual(data);
});
it("task failures are failed responses, never empty success or ordinary fallback", async () => {
  mocks.benchmark.mockRejectedValueOnce(Error("private password"));
  const r = await GET(new Request("https://office.test/api/monitoring/fill-probability?benchmarkSource=redis&benchmarkRun=approved01"));
  expect(r.status).toBe(503); const text = await r.text(); expect(text).not.toContain("password");
  expect(JSON.parse(text)).toMatchObject({ contract: "t85-html-read-v1", error: "Task benchmark unavailable" });
});
