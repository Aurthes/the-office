"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { readAgentNote, saveAgentNote } = require("./agent-notes");
const KEYS = ["focus", "decisions", "followUp", "links"];
const MAX_CHARS = 6000, MAX_BYTES = 18000, MAX_SECTION = 2400;
const EMPTY = () => Object.fromEntries(KEYS.map(key => [key, ""]));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function sections(value, status = 400) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== KEYS.length
    || KEYS.some(key => !Object.hasOwn(value, key) || typeof value[key] !== "string" || value[key].length > MAX_SECTION)
    || Object.values(value).join("").length > MAX_CHARS || Buffer.byteLength(Object.values(value).join(""), "utf8") > MAX_BYTES) {
    fail(status, "Agent State requires four text sections, at most 2,400 characters each and 6,000 characters / 18,000 UTF-8 bytes in total.");
  }
  return Object.fromEntries(KEYS.map(key => [key, value[key]]));
}
class AgentStates {
  constructor(directory, agent) { this.directory = directory; this.agent = agent; }
  check(id) {
    if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) fail(400, "A stable Office employee ID is required.");
    this.agent(id); // Resolve Office identity, never a display name or native ID.
    for (const file of [this.directory, path.join(this.directory, `${id}.json`)]) {
      try { if (fs.lstatSync(file).isSymbolicLink()) fail(503, "Agent State storage is unavailable."); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  read(id) {
    this.check(id);
    let note;
    try { note = readAgentNote(id, this.directory); }
    catch { fail(503, "Agent State could not be read. Try again."); }
    let value = EMPTY();
    if (note.revision) {
      try { value = sections(JSON.parse(note.text), 503); }
      catch { fail(503, "Saved Agent State is invalid. It has not been replaced."); }
    }
    return { id, sections: value, revision: note.revision, updatedAt: note.updatedAt };
  }
  save(id, input) {
    this.check(id);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["sections", "revision"].includes(key))
      || !Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, "A valid Agent State revision and sections are required.");
    const value = sections(input.sections);
    this.read(id); // Reject corrupt state instead of overwriting it through Notes.
    let note;
    try { note = saveAgentNote(id, { text: JSON.stringify(value), revision: input.revision }, this.directory); }
    catch (error) {
      fail(error.status === 409 ? 409 : 503, error.status === 409 ? "Agent State changed. Read the saved revision before saving again." : "Agent State could not be saved. Read it before retrying.");
    }
    return { id, sections: value, revision: note.revision, updatedAt: note.updatedAt };
  }
  context(id) {
    try { return { status: "available", ...this.read(id) }; }
    catch { return { id, status: "unavailable", message: "Agent State could not be read. Do not assume a saved memory exists." }; }
  }
}
module.exports = { AgentStates, KEYS, MAX_CHARS, MAX_BYTES, MAX_SECTION };
