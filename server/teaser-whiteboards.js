"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { teaserDirectory, readTeaser, save } = require("./teaser-board");
const fail = status => { throw Object.assign(new Error("Whiteboard is unavailable"), { status }); };
function question(id, directory) {
  if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) fail(400);
  try { readTeaser(id, directory); }
  catch (error) { fail(error.code === "ENOENT" ? 404 : 503); }
}
/** @returns {import("../src/lib/office/teasers").TeaserWhiteboard} */
function readNote(id, directory) {
  let row;
  try { row = JSON.parse(fs.readFileSync(path.join(directory, `${id}.json`), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { id, text: "", revision: 0, updatedAt: null }; fail(503); }
  if (!row || row.id !== id || typeof row.text !== "string" || row.text.length > 12000 ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt)) ||
      Object.keys(row).some(key => !["id", "text", "revision", "updatedAt"].includes(key))) fail(503);
  return row;
}
function readWhiteboard(id, directory = teaserDirectory()) {
  question(id, directory);
  return readNote(id, `${directory}-whiteboards`);
}
/** @returns {import("../src/lib/office/teasers").TeaserWhiteboard} */
function saveWhiteboard(id, input, directory = teaserDirectory()) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["text", "revision"].includes(key)) ||
      typeof input.text !== "string" || input.text.length > 12000 ||
      !Number.isSafeInteger(input.revision) || input.revision < 0) fail(400);
  question(id, directory);
  const notes = `${directory}-whiteboards`, file = path.join(notes, `${id}.json`), lock = `${file}.lock`;
  let lease;
  try {
    fs.mkdirSync(notes, { recursive: true, mode: 0o700 });
    try { lease = fs.openSync(lock, "wx", 0o600); }
    catch (error) { if (error.code === "EEXIST") fail(409); throw error; }
    const previous = readNote(id, notes);
    if (previous.revision !== input.revision) fail(409);
    if (previous.revision === Number.MAX_SAFE_INTEGER) fail(503);
    return save(file, { id, text: input.text, revision: previous.revision + 1, updatedAt: new Date().toISOString() });
  } catch (error) { if ([400, 404, 409, 503].includes(error.status)) throw error; fail(503); }
  finally { if (lease !== undefined) { fs.closeSync(lease); fs.rmSync(lock, { force: true }); } }
}
module.exports = { readWhiteboard, saveWhiteboard };
