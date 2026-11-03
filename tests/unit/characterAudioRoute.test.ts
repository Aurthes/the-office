import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/office/character-audio/route";

let root = "";
afterEach(async () => { vi.unstubAllEnvs(); if (root) await fs.rm(root, { recursive: true, force: true }); root = ""; });
async function bank(clips: Array<{ id: string; file: string }>) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "office-character-audio-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", root);
  const directory = path.join(root, "claw3d", "character-audio"); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "sources.json"), JSON.stringify({ clips })); return directory;
}
it("serves every installed call without exposing filesystem paths", async () => {
  const clips = [1, 2, 3, 4].map(id => ({ id: String(id), file: `${id}.mp3` })); const directory = await bank(clips);
  for (const clip of clips) await fs.writeFile(path.join(directory, clip.file), `audio-${clip.id}`);
  const response = await GET(); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ clips: clips.map(clip => ({ id: clip.id, base64: Buffer.from(`audio-${clip.id}`).toString("base64") })) });
});
it("leaves installations without private assets silent", async () => {
  await bank([]); await fs.rm(path.join(root, "claw3d", "character-audio"), { recursive: true });
  expect(await (await GET()).json()).toEqual({ clips: [] });
});
it("rejects a manifest that points outside the sound bank", async () => {
  await bank([{ id: "outside", file: "../private.mp3" }]);
  const response = await GET(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Character audio is unavailable" });
});
