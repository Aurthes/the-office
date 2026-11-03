import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/music/local/route";

let root = "", directory = "";
afterEach(async () => { vi.unstubAllEnvs(); if (root) await fs.rm(root, { recursive: true, force: true }); root = ""; });
async function library() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "office-local-music-")); vi.stubEnv("OPENCLAW_STATE_DIR", root);
  directory = path.join(root, "claw3d/music-library"); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "track.mp3"), "0123456789");
  await fs.writeFile(path.join(directory, "library.json"), JSON.stringify({ name: "Music", tracks: [{ id: "one", name: "One", file: "track.mp3", artists: "Artist", sourcePage: "private metadata" }] }));
}
const request = (id = "", range?: string) => new Request("http://localhost/api/music/local" + id, { headers: range ? { Range: range } : {} });
it("lists track metadata without exposing paths or source records", async () => {
  await library(); const response = await GET(request()); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ name: "Music", songs: [{ id: "one", name: "One", artists: "Artist", album: "" }] });
});
it("versions playback URLs when an encoding changes and rejects stale explicit revisions", async () => {
  await library(); const p = path.join(directory, "library.json"), manifest = JSON.parse(await fs.readFile(p, "utf8")); manifest.tracks[0].sha256 = "new-sha"; await fs.writeFile(p, JSON.stringify(manifest));
  const catalog = await (await GET(request())).json(); expect(catalog.songs[0].revision).toBe("new-sha");
  const stale = await GET(request("?id=one&v=old-sha")); expect(stale.status).toBe(404); expect(stale.headers.get("cache-control")).toBe("no-store");
  const current = await GET(request("?id=one&v=new-sha")); expect(current.status).toBe(200); expect(await current.text()).toBe("0123456789");
});
it.each([
  [undefined, 200, "0123456789", null], ["bytes=0-1", 206, "01", "bytes 0-1/10"],
  ["bytes=7-", 206, "789", "bytes 7-9/10"], ["bytes=-3", 206, "789", "bytes 7-9/10"],
  ["bytes=8-999", 206, "89", "bytes 8-9/10"],
])("streams full and partial tracks: %s", async (range, status, content, contentRange) => {
  await library(); const response = await GET(request("?id=one", range)); expect(response.status).toBe(status);
  expect(response.headers.get("accept-ranges")).toBe("bytes"); expect(response.headers.get("content-type")).toBe("audio/mpeg");
  expect(response.headers.get("content-range")).toBe(contentRange); expect(response.headers.get("content-length")).toBe(String(content.length));
  expect(await response.text()).toBe(content);
});
it.each(["bytes=10-", "bytes=4-2", "bytes=-0", "bytes=", "bytes=0-1,4-5", "not-a-range"])("rejects invalid ranges: %s", async range => {
  await library(); const response = await GET(request("?id=one", range)); expect(response.status).toBe(416); expect(response.headers.get("content-range")).toBe("bytes */10");
});
it("rejects unknown IDs, directory traversal and links outside the library", async () => {
  await library(); expect((await GET(request("?id=../../private"))).status).toBe(404);
  await fs.writeFile(path.join(root, "private.mp3"), "not music"); await fs.unlink(path.join(directory, "track.mp3")); await fs.symlink(path.join(root, "private.mp3"), path.join(directory, "track.mp3"));
  expect((await GET(request("?id=one"))).status).toBe(404);
});
it("handles a missing installation and missing files without leaking filesystem errors", async () => {
  await library(); await fs.unlink(path.join(directory, "track.mp3")); expect((await GET(request("?id=one"))).status).toBe(404);
  await fs.unlink(path.join(directory, "library.json")); expect(await (await GET(request())).json()).toEqual({ name: "Local music", songs: [] });
});
