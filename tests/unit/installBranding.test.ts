// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { installBrand } from "../../server/install-branding";
import { createInstallAssets } from "../../server/install-assets";
import { createProxyBoundary } from "../../server/proxy-boundary";
import { createWebAccessServer } from "../../server/web-access";

const metadata = vi.hoisted(() => ({ host: "office.example" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: metadata.host, "x-forwarded-host": "localhost" }) }));
vi.mock("next/font/google", () => ({ Bebas_Neue: () => ({ variable: "" }), IBM_Plex_Mono: () => ({ variable: "" }), IBM_Plex_Sans: () => ({ variable: "" }) }));
import { generateMetadata } from "@/app/layout";

const lan = "192.168.50.10:8443", remote = "office.example", token = "install-assets-fixture-token".repeat(2);
const servers: http.Server[] = [];
let target: string, auth: string, directory: string;
async function listen(server: http.Server) {
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}
function request(base: string, host: string, route: string, method = "GET", headers: Record<string,string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = http.request(base + route, { method, headers: { host, ...headers } }, res => { const chunks: Buffer[]=[];res.on("data", c => chunks.push(c));res.on("end", () => resolve({ status:res.statusCode!, headers:res.headers, body:Buffer.concat(chunks) })); });
    req.on("error", reject);req.end();
  });
}
beforeEach(async () => {
  const boundary = createProxyBoundary({ token, publicOrigins: [`https://${lan}`, `https://${remote}`] });
  const assets = createInstallAssets();
  target = await listen(http.createServer((req,res) => { const denied=boundary(req);if(denied){res.writeHead(denied);res.end();return;}if(!assets(req,res)){res.writeHead(404);res.end();} }));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "office-install-assets-"));
  // Match the existing Auth fixture options seam; JS defaults otherwise infer publicOrigins as never[].
  const publicHosts: Record<string,unknown> = { publicOrigins:[`https://${lan}`,`https://${remote}`] };
  auth = await listen(createWebAccessServer({ dataDir:directory, credentials:{username:"fixture",password:"fixture-only-password"}, upstream:target, secureCookies:true, proxyToken:token, ...publicHosts }));
});
afterEach(async () => { for(const server of servers.splice(0).reverse()){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}fs.rmSync(directory,{recursive:true,force:true}); });

it.each([
 ["10.0.0.1:8443","lan"],["172.16.0.1","lan"],["172.31.255.255:80","remote"], // URL-normalized default port is not a canonical Host accepted by the original boundary.
 ["172.31.255.255:8443","lan"],["172.15.1.1","remote"],["172.32.0.1","remote"],["192.168.0.1:8443","lan"],["192.169.0.1","remote"],
 ["localhost:3033","lan"],["LOCALHOST:3033","lan"],["127.0.0.1:3033","lan"],["[::1]:3033","lan"],["[2001:db8::1]:8443","remote"],
 ["office.example","remote"],["localhost.evil.example","remote"],["127.1:8443","remote"],["192.168.1.1@evil.example","remote"],["192.168.1.1/evil","remote"],["192.168.1.1?mode=lan","remote"],[" localhost","remote"],["","remote"],
])("classifies only canonical display Host %s",(host,variant)=>expect(installBrand(host).variant).toBe(variant));

it("alternates real Auth-forwarded Host variants without changing install identity or accepting query/forwarded overrides",async()=>{
 const original=JSON.parse(fs.readFileSync("public/office.webmanifest","utf8"));
 for(const host of [lan,remote,lan,remote]){
  const r=await request(auth,host,"/office.webmanifest?variant=opposite&host=localhost","GET",{"x-forwarded-proto":"https","x-forwarded-host":host===lan?remote:lan});expect(r.status).toBe(200);expect(r.headers["content-type"]).toContain("application/manifest+json");expect(r.headers["cache-control"]).toBe("no-store");expect(Number(r.headers["content-length"])).toBe(r.body.length);
  const value=JSON.parse(r.body.toString());expect(value.name).toBe(host===lan?"Office · LAN":"Office · Remote");expect(value.short_name).toBe(value.name);expect({ ...value,name:original.name,short_name:original.short_name }).toEqual(original);
  const head=await request(auth,host,"/office.webmanifest?anything=1","HEAD",{"x-forwarded-proto":"https"});expect(head.status).toBe(200);expect(head.body.length).toBe(0);expect(head.headers["content-length"]).toBe(r.headers["content-length"]);expect(head.headers["cache-control"]).toBe("no-store");const conditional=await request(auth,host,"/office.webmanifest","GET",{"x-forwarded-proto":"https","if-none-match":"*"});expect(conditional.status).toBe(200);
 }
});
it("returns real pre-generated PNGs at only the old icon paths, with HEAD parity and no host cache bleed",async()=>{
 for(const size of [192,512]){
  const bytes:Buffer[]=[];
  for(const host of [lan,remote,lan]){
   const r=await request(auth,host,`/office-icon-${size}.png?v=1`,"GET",{"x-forwarded-proto":"https","x-forwarded-host":"bogus.example"});expect(r.status).toBe(200);expect(r.headers["content-type"]).toBe("image/png");expect(r.headers["cache-control"]).toBe("no-store");expect(await sharp(r.body).metadata()).toMatchObject({format:"png",width:size,height:size});const decoded=await sharp(r.body).raw().toBuffer({resolveWithObject:true});expect(decoded.info).toMatchObject({width:size,height:size});bytes.push(r.body);
   const h=await request(auth,host,`/office-icon-${size}.png`,"HEAD",{"x-forwarded-proto":"https"});expect(h.body.length).toBe(0);expect(Number(h.headers["content-length"])).toBe(r.body.length);
  }
  expect(bytes[0].equals(bytes[1])).toBe(false);expect(bytes[0].equals(bytes[2])).toBe(true);
 }
});
it("preserves original host/proxy/login boundaries and exact PWA allowlist",async()=>{
 expect((await request(target,lan,"/office.webmanifest")).status).toBe(401);
 expect((await request(target,"bogus.example","/office.webmanifest","GET",{"x-office-proxy-token":token})).status).toBe(403);
 expect((await request(auth,"bogus.example","/office.webmanifest","GET",{"x-forwarded-proto":"https"})).status).toBe(403);
 for(const route of ["/office-icon-256.png","/office-icon-192.png/extra","/server/assets/install/lan-192.png","/api/studio"]){expect((await request(auth,lan,route,"GET",{"x-forwarded-proto":"https"})).status).toBe(route.startsWith("/api/")?401:303);}
 expect((await request(auth,lan,"/office","GET",{"x-forwarded-proto":"https"})).status).toBe(303);
 const handler=createInstallAssets();for(const url of ["__proto__","constructor","/office-icon-192.png/extra"]){expect(handler({method:"GET",url,headers:{host:lan}},{})).toBe(false);}
 expect(handler({method:"POST",url:"/office.webmanifest",headers:{host:lan}},{})).toBe(false);
});
it("uses the same real Host for Apple install metadata while preserving normal title and old URLs",async()=>{
 for(const host of [lan,remote,lan]){metadata.host=host;const value=await generateMetadata();expect(value.title).toBe("Claw3D");expect(value.manifest).toBe("/office.webmanifest");expect(value.appleWebApp).toMatchObject({title:installBrand(host).name,capable:true});expect(value.icons).toEqual({apple:"/office-icon-192.png"});}
});
