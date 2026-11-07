import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/fill-probability/source", () => ({ getFillSnapshot: mocks.read }));
import { GET } from "@/app/api/monitoring/fill-probability/route";
it("serves same-origin read-only facts with no-store", async () => {
  mocks.read.mockResolvedValueOnce({ configured: false, serverTime: 123, rows: [] });
  const response = await GET(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ configured: false, rows: [] });
});
it("does not expose source error details", async () => {
  mocks.read.mockRejectedValueOnce(new Error("redis://private:password@host"));
  const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("password");
});
