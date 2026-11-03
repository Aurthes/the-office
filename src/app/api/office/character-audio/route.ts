import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "@/lib/clawdbot/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Optional, privately installed sound bank. Game assets are never bundled in
// this open-source repository, and requests cannot choose filesystem paths.
export async function GET() {
  const directory = path.join(resolveStateDir(), "claw3d", "character-audio");
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(directory, "sources.json"), "utf8")) as { clips: Array<{ id: string; file: string }> };
    const clips = await Promise.all(manifest.clips.map(async clip => {
      if (typeof clip.id !== "string" || typeof clip.file !== "string" || path.basename(clip.file) !== clip.file || !/\.(mp3|wav|ogg)$/i.test(clip.file)) throw new Error("Invalid clip");
      const bytes = await fs.readFile(path.join(directory, clip.file));
      return { id: clip.id, base64: bytes.toString("base64") };
    }));
    return Response.json({ clips }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return Response.json({ clips: [] }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "Character audio is unavailable" }, { status: 503 });
  }
}
