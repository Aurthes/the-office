// @vitest-environment node
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { saveUpload, resolveUpload, messageInput, MAX_UPLOAD_BYTES } = createRequire(import.meta.url)("../../server/codex-session-uploads.js");
const { referenceForPath, readSessionAsset } = createRequire(import.meta.url)("../../server/codex-session-assets.js");
const thread = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let root: string;
const request = (bytes: Uint8Array) => new Request("http://localhost/api/session-uploads", { method: "POST", body: bytes as BodyInit });
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "claw-upload-"))); vi.stubEnv("CLAW3D_UPLOAD_DIR", root); vi.stubEnv("CLAW3D_GATEWAY_TOKEN", "upload-test-key"); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
describe("original-session uploads", () => {
  it("keeps bytes private, sanitizes the filename, and binds references to the original thread", async () => {
    const uploaded = await saveUpload(request(Buffer.from("# report\n")), thread, "../../报告.md");
    const file = await resolveUpload(uploaded.ref, thread);
    expect(file.name).toBe("报告.md"); expect(file.path.startsWith(root + path.sep)).toBe(true);
    expect(await fs.readFile(file.path, "utf8")).toBe("# report\n");
    expect((await fs.stat(file.path)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(file.path))).mode & 0o777).toBe(0o700);
    await expect(resolveUpload(uploaded.ref, other)).rejects.toThrow("不属于");
    await expect(resolveUpload(uploaded.ref.slice(0, -4) + "abcd", thread)).rejects.toThrow("无效");
  });
  it("enforces actual streamed bytes and removes an incomplete oversized file", async () => {
    await expect(saveUpload(request(new Uint8Array(MAX_UPLOAD_BYTES + 1)), thread, "large.bin")).rejects.toThrow("20 MB");
    expect(await fs.readdir(path.join(root, thread))).toEqual([]);
    await expect(saveUpload(request(new Uint8Array()), thread, "empty.txt")).rejects.toThrow("为空");
  });
  it("rejects changed or replaced files before sending", async () => {
    const uploaded = await saveUpload(request(Buffer.from("hello")), thread, "note.txt");
    const file = await resolveUpload(uploaded.ref, thread);
    await fs.writeFile(file.path, "different");
    await expect(resolveUpload(uploaded.ref, thread)).rejects.toThrow("改变");
    await fs.unlink(file.path); await fs.symlink(path.join(root, "outside.txt"), file.path);
    await fs.writeFile(path.join(root, "outside.txt"), "hello");
    await expect(resolveUpload(uploaded.ref, thread)).rejects.toThrow("改变");
  });
  it("uses native image input and App-style document references, including attachment-only messages", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=", "base64");
    const image = await saveUpload(request(png), thread, "image.png");
    const doc = await saveUpload(request(Buffer.from("%PDF-1.7\n")), thread, "report.pdf");
    const input = await messageInput("", [image.ref, doc.ref], thread);
    expect(input[0].text).toContain("# Files mentioned by the user:");
    expect(input[0].text).toContain("report.pdf"); expect(input[0].text).toContain("请查看这些附件");
    expect(input[1]).toMatchObject({ type: "localImage" });
    const file = await resolveUpload(doc.ref, thread), asset = referenceForPath(file.path);
    expect(asset.kind).toBe("file");
    expect((await readSessionAsset(new URL(asset.url, "http://localhost").searchParams.get("ref"))).bytes.toString()).toBe("%PDF-1.7\n");
    expect(referenceForPath(path.join(os.tmpdir(), "arbitrary-secret.txt"))).toBe(null);
    await expect(messageInput("", Array(9).fill(doc.ref), thread)).rejects.toThrow("8");
  });
});
