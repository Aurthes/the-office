"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const directory = () => path.resolve(process.env.CLAW3D_AGENT_NOTES_DIR || path.join(process.env.CLAW3D_DATA_DIR || path.join(os.homedir(), ".local/share/claw3d"), "agent-notes"));
const fail = status => { throw Object.assign(new Error("Notes unavailable"), { status }); };
function validId(id) { if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) fail(400); }
function readAgentNote(id, root = directory()) {
  validId(id);
  let row;
  try { row = JSON.parse(fs.readFileSync(path.join(root, `${id}.json`), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { id, text: "", revision: 0, updatedAt: null }; fail(503); }
  if (!row || row.id !== id || typeof row.text !== "string" || row.text.length > 64000 || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt)) || Object.keys(row).some(key => !["id", "text", "revision", "updatedAt"].includes(key))) fail(503);
  return row;
}
function saveAgentNote(id, input, root = directory()) {
  validId(id);
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["text", "revision"].includes(key)) || typeof input.text !== "string" || input.text.length > 64000 || !Number.isSafeInteger(input.revision) || input.revision < 0) fail(400);
  const file = path.join(root, `${id}.json`), lock = `${file}.lock`, temporary = `${file}.${randomUUID()}.tmp`;
  let lease;
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    try { lease = fs.openSync(lock, "wx", 0o600); } catch (error) { if (error.code === "EEXIST") fail(409); throw error; }
    const before = readAgentNote(id, root);
    if (before.revision !== input.revision) fail(409);
    if (before.revision === Number.MAX_SAFE_INTEGER) fail(503);
    const row = { id, text: input.text, revision: before.revision + 1, updatedAt: new Date().toISOString() };
    fs.writeFileSync(temporary, JSON.stringify(row) + "\n", { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
    return row;
  } catch (error) { if ([400, 409, 503].includes(error.status)) throw error; fail(503); }
  finally { fs.rmSync(temporary, { force: true }); if (lease !== undefined) { fs.closeSync(lease); fs.rmSync(lock, { force: true }); } }
}
module.exports = { readAgentNote, saveAgentNote };
