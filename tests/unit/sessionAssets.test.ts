// @vitest-environment node
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/session-assets/route";
const { describeSessionAssets, referenceForPath, readSessionAsset } = createRequire(import.meta.url)("../../server/codex-session-assets");
const key = "isolated-fixture-signing-key";
let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "claw3d-assets-"));
  vi.stubEnv("CLAW3D_GATEWAY_TOKEN", key); vi.stubEnv("CLAW3D_CODEX_GATEWAY", "1");
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const ref = (url: string) => new URL(url, "https://office.test").searchParams.get("ref");

describe("conversation file references", () => {
  it("resolves original Markdown destinations, spaces, file URLs and line citations", async () => {
    const filename = path.join(directory, "中文 report.md"); fs.writeFileSync(filename, "# Result");
    const assets = describeSessionAssets(`[报告](<${filename}:29>)\n[Same](${new URL('file://' + filename).href})\n[remote](https://example.com/a.html)`);
    expect(assets).toHaveLength(2); expect(assets[0].kind).toBe("markdown");
    expect((await readSessionAsset(ref(assets[0].url))).bytes.toString()).toBe("# Result");
    expect((await readSessionAsset(ref(assets[1].url))).path).toBe(fs.realpathSync(filename));
  });
  it("rejects forged references, arbitrary path queries, unsafe types, changed symlinks and oversized files", async () => {
    const filename = path.join(directory, "report.md"); fs.writeFileSync(filename, "safe");
    const asset = referenceForPath(filename); const reference = ref(asset.url);
    await expect(readSessionAsset(reference, "wrong key")).rejects.toThrow("Invalid");
    await expect(readSessionAsset("invalid")).rejects.toThrow("Invalid");
    expect(referenceForPath(path.join(directory, "auth.json"))).toBeNull();
    expect((await GET(new Request("https://office.test/api/session-assets?path=/etc/passwd"))).status).toBe(400);
    fs.unlinkSync(filename); fs.writeFileSync(path.join(directory, "secret.md"), "secret"); fs.symlinkSync(path.join(directory, "secret.md"), filename);
    await expect(readSessionAsset(reference)).rejects.toThrow("location changed");
    fs.unlinkSync(filename); fs.writeFileSync(filename, ""); fs.truncateSync(filename, 1024 * 1024 + 1);
    await expect(readSessionAsset(reference)).rejects.toThrow("too large");
  });
  it("moves native data images out of history payloads into private generated previews", async () => {
    const cacheDir = path.join(directory, "cache");
    const assets = describeSessionAssets("photo", [{ type: "image", url: "data:image/png;base64," + Buffer.alloc(10000, 7).toString("base64") }], { cacheDir });
    expect(assets).toHaveLength(1); expect(assets[0]).toMatchObject({ inline: true, kind: "image" });
    expect(JSON.stringify(assets).length).toBeLessThan(2000);
    const asset = await readSessionAsset(ref(assets[0].url));
    expect(asset.bytes.length).toBe(10000);
    expect(fs.statSync(asset.path).mode & 0o777).toBe(0o600);
    expect(fs.statSync(cacheDir).mode & 0o777).toBe(0o700);
    const duplicate = describeSessionAssets('# Files mentioned by the user:\n## photo.jpg: /tmp/photo.jpg\n## My request:\nphoto', [{ type: "image", url: "data:image/png;base64," + Buffer.alloc(10000, 7).toString("base64") }], { cacheDir });
    expect(duplicate).toHaveLength(1);
  });
  it("serves interactive HTML with an opaque sandbox and resolves relative Markdown images on demand", async () => {
    const html = path.join(directory, "report.html"); fs.writeFileSync(html, '<button onclick="this.textContent=2">1</button>');
    const response = await GET(new Request("https://office.test" + referenceForPath(html).url));
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(await response.text()).toContain("onclick");
    fs.writeFileSync(path.join(directory, "chart.png"), "fixture");
    const markdown = path.join(directory, "report.md"); fs.writeFileSync(markdown, "# Report\n![chart](chart.png)");
    const md = await GET(new Request("https://office.test" + referenceForPath(markdown).url + "&format=json"));
    const body = await md.json(); expect(body.content).toContain("# Report");
    expect(body.assets[0]).toMatchObject({ source: "chart.png", kind: "image" });
    expect((await readSessionAsset(ref(body.assets[0].url))).bytes.toString()).toBe("fixture");
    vi.stubEnv("CLAW3D_CODEX_GATEWAY", "0");
    expect((await GET(new Request("https://office.test" + referenceForPath(html).url))).status).toBe(404);
  });
  it("compresses large HTML when accepted, while retaining the sandbox and signed-reference checks", async () => {
    const html = path.join(directory, "large.html"), body = "<!doctype html><h1>Sample</h1>" + "<!-- repeated model data -->".repeat(1000);
    fs.writeFileSync(html, body);
    const url = "https://office.test" + referenceForPath(html).url;
    const response = await GET(new Request(url, { headers: { "Accept-Encoding": "br, gzip" } }));
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(gunzipSync(bytes).toString()).toBe(body); expect(bytes.length).toBeLessThan(Buffer.byteLength(body) / 4);
    const plain = await GET(new Request(url, { headers: { "Accept-Encoding": "gzip;q=0, identity" } }));
    expect(plain.headers.get("content-encoding")).toBeNull(); expect(await plain.text()).toBe(body);
  });
  it("delegates embedded self-refresh without changing downloads, authentication references, or sandbox policy", async () => {
    const filename = path.join(directory, "progress.html");
    const body = '<!doctype html><meta http-equiv="refresh" content="2"><h1>Current progress</h1>';
    fs.writeFileSync(filename, body);
    const url = "https://office.test" + referenceForPath(filename).url;
    const response = await GET(new Request(url + "&preview=1"));
    const embedded = await response.text();
    expect(embedded).not.toContain('<meta http-equiv="refresh"');
    expect(embedded).toContain('claw3d:session-asset-refresh');
    expect(embedded).toContain('data-claw3d-preview-refresh');
    expect(embedded).toContain("2000");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(await (await GET(new Request(url))).text()).toBe(body);
    expect((await GET(new Request("https://office.test/api/session-assets?ref=forged&preview=1"))).status).toBe(400);
  });
});
