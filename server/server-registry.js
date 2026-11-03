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
async function loadServerRegistry() {
  const file = process.env.CLAW3D_SERVER_POOL_FILE?.trim();
  let hosts = [];
  if (file) {
    const stat = await fs.stat(file);
    if (stat.size > 80_000) throw new Error("Server registry is too large.");
    hosts = parseServerPool(await fs.readFile(file, "utf8"));
  }
  if (process.platform === "darwin") hosts.unshift({ alias: "Local Mac", group: "local", active: true });
  return { configured: Boolean(file || hosts.length), hosts };
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
module.exports = { parseServerPool, loadServerRegistry, sshTransportOptions };
