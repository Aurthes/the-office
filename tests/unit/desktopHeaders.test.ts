import { afterEach, expect, it, vi } from "vitest";
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules()});
async function policy(desktop:string,publicAccess:string){
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("CLAW3D_OFFICE_DESKTOP",desktop);vi.stubEnv("NEXT_PUBLIC_CLAW3D_WEB_ACCESS",publicAccess);vi.resetModules();
 const config=(await import("../../next.config")).default;
 const headers=await config.headers!();
 return headers.find(route=>route.source==="/:path*")!.headers.find(header=>header.key==="Content-Security-Policy")!.value;
}
it("keeps the local desktop's HTTP and WebSocket resources usable in WebKit",async()=>{expect(await policy("1","0")).not.toContain("upgrade-insecure-requests")});
it("retains HTTPS upgrades for ordinary and public web deployments",async()=>{expect(await policy("","0")).toContain("upgrade-insecure-requests");expect(await policy("1","1")).toContain("upgrade-insecure-requests")});
