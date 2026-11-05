import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveStateDir } from "@/lib/clawdbot/paths";
import { loadServerRegistry, sshTransportOptions } from "../../../server/server-registry";
import { parseParticipationHour } from "./model";

const exec = promisify(execFile);
const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

async function readSnapshot(config: { host?: string; directory: string }, file: string) {
  const location = path.posix.join(config.directory, file), key = `${config.host || "local"}:${location}`;
  const old = cache.get(key);
  if (old && old.expires > Date.now()) return old.value;
  const value = (async () => {
    let raw: string;
    if (config.host) {
      const { hosts } = await loadServerRegistry();
      if (!hosts.some(host => host.alias === config.host && host.active && host.group === "online")) throw new Error("监控来源未注册或已停用");
      const options = await sshTransportOptions(config.host);
      const result = await exec("ssh", [...options, "-o", "ConnectTimeout=5", config.host, `cat -- ${quote(location)}`], { timeout: 12_000, maxBuffer: 4 * 1024 * 1024 });
      raw = result.stdout;
    } else {
      if ((await fs.stat(location)).size > 4 * 1024 * 1024) throw new Error("监控快照过大");
      raw = await fs.readFile(location, "utf8");
    }
    return JSON.parse(raw) as unknown;
  })();
  cache.delete(key); cache.set(key, { value, expires: Date.now() + 15_000 });
  if (cache.size > 48) cache.delete(cache.keys().next().value!);
  try { return await value; } catch (error) { cache.delete(key); throw error; }
}

export async function getParticipation(hour?: number) {
  const configFile = path.join(resolveStateDir(), "claw3d", "participation.json");
  let config: { host?: string; directory: string };
  try {
    const stat = await fs.stat(configFile);
    if (stat.size > 4096) throw new Error("Invalid participation configuration");
    config = JSON.parse(await fs.readFile(configFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { configured: false, updatedAt: null, hours: [], hour: null };
    throw error;
  }
  if (!config || typeof config.directory !== "string" || !path.posix.isAbsolute(config.directory) || /[\x00-\x1f]/.test(config.directory) || (config.host !== undefined && (typeof config.host !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(config.host)))) throw new Error("Invalid participation configuration");
  const index = await readSnapshot(config, "index.json") as { version: number; hours: number[]; updatedAt: number };
  if (!Number.isFinite(index.updatedAt) || index.version !== 1 || !Array.isArray(index.hours) || index.hours.length > 336 || index.hours.some(h => !Number.isSafeInteger(h) || h < 0 || h % 3_600_000)) throw new Error("Invalid participation index");
  const hours = [...new Set(index.hours)].sort((a, b) => b - a);
  const selected = hour ?? hours.find(h => h + 3_600_000 <= Date.now()) ?? hours[0];
  if (selected === undefined) return { configured: true, updatedAt: index.updatedAt, hours, hour: null };
  if (!hours.includes(selected)) throw new Error("该小时尚无监控数据");
  const data = parseParticipationHour(await readSnapshot(config, `hours/${selected}.json`));
  if (data.hour !== selected) throw new Error("Invalid participation hour");
  return { configured: true, updatedAt: index.updatedAt, hours, hour: data };
}
