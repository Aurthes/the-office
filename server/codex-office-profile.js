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

// Office-local standalone skills win over discovered copies. Only the child
// process's supported per-path enablement changes; source files/links stay put.
function duplicateSkills(roots, configured) {
  const groups = new Map(), seen = new Set();
  const canonical = file => fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file);
  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const entry of entries.sort()) {
      try {
        const file = fs.realpathSync(path.join(root, entry, "SKILL.md"));
        if (seen.has(file)) continue;
        const front = fs.readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
        const match = front?.match(/^name:[ \t]*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\r\n#]+))/m);
        const name = (match?.[1] || match?.[2] || match?.[3] || "").trim();
        if (!name) continue;
        seen.add(file); const group = groups.get(name) || []; group.push(file); groups.set(name, group);
      } catch { /* Missing or invalid skills remain the native loader's concern. */ }
    }
  }
  const disabled = [];
  for (const [name, files] of groups) {
    if (files.length < 2 || configured.some(entry => entry.name === name)) continue;
    const setting = file => configured.find(entry => entry.path && [file, path.dirname(file)].includes(canonical(entry.path)));
    const explicit = files.filter(file => setting(file)?.enabled === true);
    const winners = new Set(explicit.length ? explicit : files.filter(file => setting(file)?.enabled !== false).slice(0, 1));
    for (const file of files) if (!winners.has(file) && !setting(file)) disabled.push({ path: file, enabled: false });
  }
  return disabled;
}

// Read only public user-authored configuration. Never inspect App state or copy
// a whole config.toml: it can redirect credentials, databases and tool bridges.
function prepareOfficeProfile(home, environment = process.env, additionalInstructions = "") {
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
  {
    const merged = new Map();
    for (const [entries, root] of [[skillEntries || [], source], [own.skills?.config || [], home]]) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        if (typeof entry.enabled !== "boolean" || (!entry.path && !entry.name)) continue;
        const item = { ...(entry.path ? { path: path.resolve(root, entry.path) } : { name: entry.name }), enabled: entry.enabled };
        merged.set(item.path || item.name, item);
      }
    }
    const configured = [...merged.values()];
    const suppressed = duplicateSkills([path.join(home, "skills"), path.join(source, "skills"), path.join(environment.HOME || os.homedir(), ".agents/skills")], configured);
    if (Array.isArray(skillEntries) || Array.isArray(own.skills?.config) || suppressed.length) {
      assign(inherited, "skills.config", [...configured, ...suppressed]); defaults.push("skills.config");
    }
  }
  if (additionalInstructions) {
    const instructions = own.developer_instructions ?? native.developer_instructions ?? "";
    if (typeof instructions !== "string") throw new Error("developer_instructions must be text");
    assign(inherited, "developer_instructions", [instructions, additionalInstructions].filter(Boolean).join("\n"));
    if (!defaults.includes("developer_instructions")) defaults.push("developer_instructions");
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
