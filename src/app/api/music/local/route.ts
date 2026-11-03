import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { resolveStateDir } from "@/lib/clawdbot/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Track = { id: string; file: string; name: string; artists?: string; album?: string };
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  try {
    const directory = path.join(resolveStateDir(), "claw3d", "music-library");
    const library = JSON.parse(await fs.readFile(path.join(directory, "library.json"), "utf8")) as { name?: string; tracks: Track[] };
    const types: Record<string, string> = { ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4" };
    if (!Array.isArray(library.tracks) || library.tracks.some(track => typeof track.id !== "string" || typeof track.name !== "string" || typeof track.file !== "string" || path.basename(track.file) !== track.file || !types[path.extname(track.file).toLowerCase()])) throw new Error("Invalid library");
    if (id === null) return Response.json({ name: library.name || "Local music", songs: library.tracks.map(track => ({ id: track.id, name: track.name, artists: track.artists || "", album: track.album || "" })) }, { headers: noStore });
    const track = library.tracks.find(song => song.id === id);
    if (!track) return new Response("Track not found", { status: 404, headers: noStore });
    const root = await fs.realpath(directory), file = await fs.realpath(path.join(directory, track.file));
    if (path.dirname(file) !== root) return new Response("Track not found", { status: 404, headers: noStore });
    const size = (await fs.stat(file)).size;
    let start = 0, end = size - 1;
    const range = request.headers.get("range");
    if (range !== null) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...noStore, "Content-Range": `bytes */${size}` } });
      if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
      else start = Math.max(0, size - Number(match[2]));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return new Response(null, { status: 416, headers: { ...noStore, "Content-Range": `bytes */${size}` } });
    }
    if (!size) return new Response("Track not found", { status: 404, headers: noStore });
    const body = Readable.toWeb(createReadStream(file, { start, end, signal: request.signal })) as ReadableStream<Uint8Array>;
    return new Response(body, { status: range === null ? 200 : 206, headers: {
      "Content-Type": types[path.extname(track.file).toLowerCase()], "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1), "Cache-Control": "private, max-age=3600",
      ...(range === null ? {} : { "Content-Range": `bytes ${start}-${end}/${size}` }),
    } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return id === null ? Response.json({ name: "Local music", songs: [] }, { headers: noStore }) : new Response("Track not found", { status: 404, headers: noStore });
    return Response.json({ error: "Local music is unavailable. Please retry." }, { status: 503, headers: noStore });
  }
}
