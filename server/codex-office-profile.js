"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parse } = require("smol-toml");

const DEFAULTS = ["model", "model_reasoning_effort", "model_verbosity", "personality", "service_tier", "developer_instructions", "project_doc_max_bytes", "project_doc_fallback_filenames", "skills.max_context_tokens"];
const valueAt = (object, key) => key.split(".").reduce((value, part) => value?.[part], object);
function literal(value) {
  if (Array.isArray(value)) return `[${value.map(literal).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${literal(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function assign(object, key, value) {
  const parts = key.split("."), last = parts.pop();
  for (const part of parts) object = object[part] ||= {};
  object[last] = value;
}
function readConfig(file, warnings) {
  try { return parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") warnings.push(`Could not read ${path.basename(file)}; its defaults were not imported.`); return {}; }
}
function sourceHome(environment = process.env) {
  return path.resolve(environment.CLAW3D_CODEX_CONFIG_HOME || environment.CODEX_HOME || path.join(os.homedir(), ".codex"));
}

// Read only public user-authored configuration. Never inspect App state or copy
// a whole config.toml: it can redirect credentials, databases and tool bridges.
function prepareOfficeProfile(home, environment = process.env) {
  const source = sourceHome(environment), warnings = [], links = {}, rules = [];
  const record = path.join(home, "office-rule-links.json");
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(record, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") warnings.push("Rule link ownership could not be read; existing files will be preserved."); }
  for (const name of ["AGENTS.md", "AGENTS.override.md"]) {
    const from = path.join(source, name), to = path.join(home, name);
    let status = "missing";
    try {
      const existing = fs.lstatSync(to, { throwIfNoEntry: false });
      const target = existing?.isSymbolicLink() ? fs.readlinkSync(to) : null;
      const managed = target && previous[name] === target;
      const available = fs.statSync(from, { throwIfNoEntry: false })?.isFile();
      if (existing && !managed && target !== from) status = "office";
      else {
        if (managed && (!available || target !== from)) fs.unlinkSync(to);
        if (available) {
          if (!fs.lstatSync(to, { throwIfNoEntry: false })) fs.symlinkSync(from, to, "file");
          links[name] = from; status = "shared";
        }
      }
    } catch {
      status = "unavailable"; warnings.push(`${name} could not be linked; check file permissions and symlink support.`);
    }
    rules.push({ name, status });
  }
  fs.writeFileSync(record, JSON.stringify(links) + "\n", { mode: 0o600 });
  const native = readConfig(path.join(source, "config.toml"), warnings);
  const own = readConfig(path.join(home, "config.toml"), warnings);
  const inherited = {}, defaults = [];
  const customProvider = native.model_provider && native.model_provider !== "openai";
  for (const key of DEFAULTS) {
    const value = valueAt(native, key);
    if (value === undefined || valueAt(own, key) !== undefined || (customProvider && key.startsWith("model"))) continue;
    assign(inherited, key, value); defaults.push(key);
  }
  // Carry per-skill overrides; Codex interprets their enablement semantics.
  // Office's own entries come last, as the deliberate local override.
  const skillEntries = native.skills?.config;
  if (Array.isArray(skillEntries)) {
    const merged = new Map();
    for (const [entries, root] of [[skillEntries, source], [own.skills?.config || [], home]]) {
      for (const entry of entries) {
        if (typeof entry.enabled !== "boolean" || (!entry.path && !entry.name)) continue;
        const item = { ...(entry.path ? { path: path.resolve(root, entry.path) } : { name: entry.name }), enabled: entry.enabled };
        merged.set(item.path || item.name, item);
      }
    }
    assign(inherited, "skills.config", [...merged.values()]); defaults.push("skills.config");
  }
  const legacy = path.join(source, "skills");
  let skillRoots = [];
  try { if (fs.statSync(legacy, { throwIfNoEntry: false })?.isDirectory()) skillRoots = [legacy]; }
  catch { warnings.push("The existing Codex skill directory could not be read."); }
  if (customProvider) warnings.push("Custom model providers require separate Office configuration.");
  const overrides = defaults.flatMap(key => ["-c", `${key}=${literal(valueAt(inherited, key))}`]);
  return { source, rules, defaults, overrides, skillRoots, warnings };
}
module.exports = { prepareOfficeProfile, sourceHome };
