"use strict";
// One dependency-free module serves the dashboard and the local agent publisher.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const statuses = ["open", "in_progress", "finished"];
const validId = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const teaserDirectory = () => path.resolve(process.env.CLAW3D_TEASER_DIR || path.join(process.env.CLAW3D_DATA_DIR || path.join(os.homedir(), ".local/share/claw3d"), "teasers"));
const text = (value, name, limit, optional = false) => {
  if (typeof value !== "string" || value.length > limit || (!optional && !value.trim())) throw new Error(`${name} must contain ${optional ? "0" : "1"}–${limit} characters`);
  return value.trim();
};
function fields(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a JSON object");
  const allowed = ["title", "prompt", "author", "status", "answer", "summary", "revision"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error(`Only ${allowed.join(", ")} may be written`);
  return input;
}
function content(input) {
  if (!statuses.includes(input.status)) throw new Error(`status must be ${statuses.join(", ")}`);
  const row = {
    title: text(input.title, "title", 160), prompt: text(input.prompt, "prompt", 12000),
    author: text(input.author, "author", 120), status: input.status,
    answer: text(input.answer ?? "", "answer", 12000, input.status !== "finished"),
    summary: text(input.summary ?? "", "summary", 2000, input.status !== "finished"),
  };
  return row;
}
function readRecord(file, id) {
  const row = JSON.parse(fs.readFileSync(file, "utf8"));
  if (row.id !== id || !Number.isInteger(row.revision) || row.revision < 1 ||
      !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.updatedAt)) ||
      (row.status === "finished" ? !Number.isFinite(Date.parse(row.completedAt)) : row.completedAt !== null)) {
    throw new Error("Invalid teaser record; refusing to overwrite it");
  }
  content(row);
  return row;
}
/** @returns {import("../src/lib/office/teasers").Teaser[]} */
function readTeasers(directory = teaserDirectory(), includeDraftSolutions = false) {
  let names;
  try { names = fs.readdirSync(directory); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return names.filter(name => name.endsWith(".json") && validId(name.slice(0, -5))).map(name => {
    const row = readRecord(path.join(directory, name), name.slice(0, -5));
    return includeDraftSolutions || row.status === "finished" ? row : { ...row, answer: "", summary: "" };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
function save(file, row) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(row, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
  return row;
}
function postTeaser(input, directory = teaserDirectory()) {
  fields(input);
  if (input.revision !== undefined) throw new Error("New teasers do not take a revision");
  const values = content({ status: "open", ...input }), now = new Date().toISOString();
  const row = { id: randomUUID(), revision: 1, ...values, createdAt: now, updatedAt: now, completedAt: values.status === "finished" ? now : null };
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return save(path.join(directory, `${row.id}.json`), row);
}
function updateTeaser(id, input, directory = teaserDirectory()) {
  if (!validId(id)) throw new Error("Invalid teaser ID");
  fields(input);
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new Error("Use the current revision from list/get");
  const file = path.join(directory, `${id}.json`), lock = `${file}.lock`;
  // Bound serialization to this one record, only for its synchronous disk write.
  let lease;
  try { lease = fs.openSync(lock, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") throw new Error("This teaser is being updated; read it and retry"); throw error; }
  try {
    const previous = readRecord(file, id);
    if (previous.revision !== input.revision) throw new Error("Revision changed; read this teaser and retry");
    const values = content({ ...previous, ...input }), now = new Date().toISOString();
    return save(file, { ...previous, ...values, revision: previous.revision + 1, updatedAt: now,
      completedAt: values.status === "finished" ? previous.completedAt || now : null });
  } finally { fs.closeSync(lease); fs.rmSync(lock, { force: true }); }
}
module.exports = { teaserDirectory, readTeasers, postTeaser, updateTeaser };

if (require.main === module) {
  try {
    const [command, id, ...rest] = process.argv.slice(2);
    if (command === "--help" || !command) {
      console.log("Teaser board: list | get ID | post [--file JSON] | update ID [--file JSON]\n" +
        "post/update read JSON from stdin unless --file is supplied. update requires revision.\n" +
        "Fields: title, prompt, author, status (open|in_progress|finished), answer, summary.\n" +
        "Finished teasers require an answer and a concise key-idea summary (max 2000 characters).\n" +
        "State: CLAW3D_TEASER_DIR or $CLAW3D_DATA_DIR/teasers (default ~/.local/share/claw3d/teasers).");
    } else if (command === "list" || command === "get") {
      if (rest.length || (command === "list" && id) || (command === "get" && !validId(id))) throw new Error("Use list or get ID");
      const rows = readTeasers(teaserDirectory(), true), result = command === "list" ? rows : rows.find(row => row.id === id);
      if (!result) throw new Error("Teaser not found");
      console.log(JSON.stringify(result, null, 2));
    } else if (command === "post" || command === "update") {
      const args = command === "post" ? [id, ...rest].filter(value => value !== undefined) : rest;
      if (args.length && (args.length !== 2 || args[0] !== "--file")) throw new Error("Use --file JSON or pipe a JSON object to stdin");
      const raw = fs.readFileSync(args.length ? args[1] : 0, "utf8");
      if (Buffer.byteLength(raw) > 32768) throw new Error("Input is too large");
      const input = JSON.parse(raw);
      console.log(JSON.stringify(command === "post" ? postTeaser(input) : updateTeaser(id, input), null, 2));
    } else throw new Error("Unknown command; use --help");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
