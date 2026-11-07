// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/fill-probability/source", () => ({ getFillSnapshot: mocks.read }));
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
