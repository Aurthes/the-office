"use strict";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

/** @returns {Array<{alias:string,group:"online"|"offline"|"local",active:boolean}>} */
function parseServerPool(text) {
  const hosts = [], seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const [alias, group, params = ""] = line.split("|").map(value => value.trim());
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(alias) || !["online", "offline"].includes(group) || seen.has(alias)) throw new Error("Invalid server registry.");
    seen.add(alias);
    hosts.push({ alias, group, active: !params.split(",").some(value => /^active\s*=\s*no$/i.test(value.trim())) });
  }
  if (hosts.length > 128) throw new Error("Server registry is too large.");
  return hosts;
}
function serverRegistryFile() {
  return process.env.CLAW3D_SERVER_REGISTRY_FILE?.trim() || path.join(process.env.CLAW3D_DATA_DIR || path.join(os.homedir(), ".local/share/claw3d"), "server-registry.json");
}
/** @param {unknown} value @returns {Array<{alias:string,group:"online"|"offline"|"local",active:boolean,family?:string}>} */
function validateRegisteredHosts(value) {
  if (!Array.isArray(value) || value.length > 128) throw new Error("Register up to 128 machines.");
  const seen = new Set(); let local = false;
  return value.map(host => {
    if (!host || typeof host !== "object" || typeof host.alias !== "string" || !["online", "offline", "local"].includes(host.group) || typeof host.active !== "boolean") throw new Error("Each machine needs an alias, purpose, and enabled state.");
    if (host.family != null && typeof host.family !== "string") throw new Error("Group names must be at most 64 characters.");
    const alias = host.alias.trim(), family = typeof host.family === "string" ? host.family.trim() : "";
    if (!alias || alias.length > 64 || /[\x00-\x1f\x7f]/.test(alias) || (host.group !== "local" && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(alias))) throw new Error("Use an SSH alias for remote machines.");
    if (seen.has(alias)) throw new Error("Each machine alias must be unique.");
    if (family.length > 64 || /[\x00-\x1f\x7f]/.test(family)) throw new Error("Group names must be at most 64 characters.");
    if (host.group === "local") { if (local) throw new Error("Register the local machine only once."); local = true; }
    seen.add(alias);
    return { alias, group: host.group, active: host.active, ...(family ? { family } : {}) };
  });
}
async function loadServerRegistry(file = serverRegistryFile()) {
  try {
    const stat = await fs.stat(file);
    if (stat.size > 80_000) throw new Error("Server registry is too large.");
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    if (data.version !== 1) throw new Error("Invalid server registry version.");
    const hosts = validateRegisteredHosts(data.hosts);
    return { configured: hosts.length > 0, hosts };
  } catch (error) {
    if (error.code === "ENOENT") {
      // An explicitly supplied legacy pool can seed the editor once. A saved
      // instance registry, including an empty one, always takes precedence.
      const legacy = file === serverRegistryFile() && process.env.CLAW3D_SERVER_POOL_FILE?.trim();
      if (legacy) {
        if ((await fs.stat(legacy)).size > 80_000) throw new Error("Server registry is too large.");
        const hosts = parseServerPool(await fs.readFile(legacy, "utf8"));
        return { configured: hosts.length > 0, hosts };
      }
      return { configured: false, hosts: [] };
    }
    throw error;
  }
}
async function saveServerRegistry(value, file = serverRegistryFile()) {
  const hosts = validateRegisteredHosts(value);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${require("node:crypto").randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({ version: 1, hosts }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
  return { configured: hosts.length > 0, hosts };
}
async function sshTransportOptions(alias) {
  const { stdout } = await exec("ssh", ["-G", alias], { timeout: 1500, maxBuffer: 128_000 });
  const configured = /^controlpath (.+)$/m.exec(stdout)?.[1];
  const options = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ControlMaster=auto", "-o", "ControlPersist=600"];
  if (!configured || configured === "none") {
    const directory = path.join(os.homedir(), ".ssh", "controlmasters");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    options.push("-o", `ControlPath=${path.join(directory, "%C")}`);
  }
  await exec("ssh", [...options, "-O", "check", alias], { timeout: 1000 }).catch(() => undefined);
  return options;
}
module.exports = { parseServerPool, loadServerRegistry, saveServerRegistry, validateRegisteredHosts, serverRegistryFile, sshTransportOptions };
