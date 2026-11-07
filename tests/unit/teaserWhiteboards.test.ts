// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";
import { postTeaser, updateTeaser, readTeasers } from "../../server/teaser-board";
import { readWhiteboard, saveWhiteboard } from "../../server/teaser-whiteboards";

let root: string, directory: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "teaser-whiteboard-test-")); directory = path.join(root, "questions"); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const question = (title = "Question") => postTeaser({ title, prompt: "A synthetic question", author: "fixture", answer: "UNPUBLISHED ANSWER", summary: "UNPUBLISHED IDEA" }, directory);
const status = (fn: () => unknown, expected: number) => { try { fn(); throw Error("Expected rejection"); } catch (error) { expect(error).toHaveProperty("status", expected); } };

it("keeps two independent notes, exact text and empty saves across a separate process", () => {
  const a = question("A"), b = question("B");
  expect(readWhiteboard(a.id, directory)).toEqual({ id: a.id, text: "", revision: 0, updatedAt: null });
  const text = "\n  Draft\t<script>not executable</script>\n\n ";
  saveWhiteboard(a.id, { text, revision: 0 }, directory);
  saveWhiteboard(b.id, { text: "Other note", revision: 0 }, directory);
  const raw = execFileSync(process.execPath, ["-e", "const m=require(process.argv[1]);process.stdout.write(JSON.stringify(m.readWhiteboard(process.argv[2],process.argv[3])))", path.resolve("server/teaser-whiteboards.js"), a.id, directory], { encoding: "utf8" });
  expect(JSON.parse(raw)).toMatchObject({ id: a.id, text, revision: 1 });
  saveWhiteboard(a.id, { text: "", revision: 1 }, directory);
  expect(readWhiteboard(a.id, directory)).toMatchObject({ text: "", revision: 2 });
  expect(readWhiteboard(b.id, directory)).toMatchObject({ text: "Other note", revision: 1 });
  expect(fs.readdirSync(`${directory}-whiteboards`).sort()).toEqual([`${a.id}.json`, `${b.id}.json`].sort());
});

it("does not alter questions or reveal unfinished answers, and publisher updates never overwrite notes", () => {
  const a = question(), file = path.join(directory, `${a.id}.json`), before = fs.readFileSync(file);
  saveWhiteboard(a.id, { text: "My own note", revision: 0 }, directory);
  expect(fs.readFileSync(file)).toEqual(before);
  expect(readTeasers(directory)[0]).toMatchObject({ answer: "", summary: "" });
  expect(Object.keys(readWhiteboard(a.id, directory)).sort()).toEqual(["id", "revision", "text", "updatedAt"]);
  updateTeaser(a.id, { status: "in_progress", revision: 1 }, directory);
  expect(readWhiteboard(a.id, directory)).toMatchObject({ text: "My own note", revision: 1 });
  saveWhiteboard(a.id, { text: "Still independent", revision: 1 }, directory);
  expect(readTeasers(directory)[0].revision).toBe(2);
});

it("rejects stale and leased saves without changing notes, and refuses corrupt records", () => {
  const a = question(); saveWhiteboard(a.id, { text: "Current", revision: 0 }, directory);
  const file = path.join(`${directory}-whiteboards`, `${a.id}.json`), before = fs.readFileSync(file);
  status(() => saveWhiteboard(a.id, { text: "Stale", revision: 0 }, directory), 409);
  expect(fs.readFileSync(file)).toEqual(before);
  fs.writeFileSync(`${file}.lock`, "fixture");
  status(() => saveWhiteboard(a.id, { text: "Busy", revision: 1 }, directory), 409);
  expect(fs.readFileSync(file)).toEqual(before); fs.unlinkSync(`${file}.lock`);
  fs.writeFileSync(file, "invalid JSON");
  status(() => saveWhiteboard(a.id, { text: "Overwrite", revision: 1 }, directory), 503);
  expect(fs.readFileSync(file, "utf8")).toBe("invalid JSON");
  expect(fs.existsSync(`${file}.lock`)).toBe(false);
});

it("rejects invalid fields, revisions, IDs and text before creating note storage", () => {
  const a = question();
  for (const input of [null, [], {}, { text: "x", revision: -1 }, { text: "x", revision: .5 }, { text: "x", revision: "0" }, { text: "x".repeat(12001), revision: 0 }, { text: "x", revision: 0, path: "/tmp/not-allowed" }]) status(() => saveWhiteboard(a.id, input, directory), 400);
  status(() => saveWhiteboard("../escape", { text: "x", revision: 0 }, directory), 400);
  status(() => saveWhiteboard("00000000-0000-4000-8000-000000000000", { text: "x", revision: 0 }, directory), 404);
  expect(fs.existsSync(`${directory}-whiteboards`)).toBe(false);
});

it("serializes only the same note across real concurrent processes", async () => {
  const a = question();
  const run = (text: string) => new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", "try{require(process.argv[1]).saveWhiteboard(process.argv[2],{text:process.argv[4],revision:0},process.argv[3]);process.stdout.write('200')}catch(e){process.stdout.write(String(e.status));}", path.resolve("server/teaser-whiteboards.js"), a.id, directory, text]);
    let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.on("error", reject); child.on("close", code => code ? reject(Error("Fixture process failed")) : resolve(Number(output)));
  });
  expect((await Promise.all([run("Left"), run("Right")])).sort()).toEqual([200, 409]);
  expect(readWhiteboard(a.id, directory).revision).toBe(1);
  expect(["Left", "Right"]).toContain(readWhiteboard(a.id, directory).text);
  expect(fs.readdirSync(`${directory}-whiteboards`)).toEqual([`${a.id}.json`]);
});
