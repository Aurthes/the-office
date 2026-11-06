import { expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/rate-limit-capacity/source",()=>({getCapacitySnapshot:mocks.read}));
import { GET } from "@/app/api/monitoring/rate-limit-capacity/route";
it("serves read-only, uncached capacity data",async()=>{
  mocks.read.mockResolvedValueOnce({configured:false,serverTime:123,rows:[]});
  const response=await GET();expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({configured:false,rows:[]});
});
it("does not echo private source errors",async()=>{
  mocks.read.mockRejectedValueOnce(new Error("redis://user:password@private"));
  const response=await GET();expect(response.status).toBe(503);expect(await response.text()).not.toContain("password");
});
