import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveStateDir } from "@/lib/clawdbot/paths";
import { loadServerRegistry, sshTransportOptions } from "../../../server/server-registry";
import { parseParticipationHour, participationSeries, type ParticipationFilter, type ParticipationLevel } from "./model";

const exec = promisify(execFile);
type Source = { host?: string; directory: string };
type Cached = { version: string; value: unknown };
const cache = new Map<string, Cached>();
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
// One SSH round trip for all requested hours; transfer only changed files.
const batchRead = `import json,os,sys
root=sys.argv[1]
out=[]
for name,known in json.loads(sys.argv[2]):
 p=os.path.join(root,name)
 s=os.stat(p)
 if s.st_size>4*1024*1024: raise ValueError('snapshot too large')
 version=str(s.st_mtime_ns)+':'+str(s.st_size)
 r={'file':name,'version':version}
 if version!=known:
  with open(p) as f: r['value']=json.load(f)
 out.append(r)
print(json.dumps(out,separators=(',',':')))`;

async function readSnapshots(config: Source, files: string[]): Promise<unknown[]> {
  if (!files.length) return [];
  const key = (name: string) => `${config.host || "local"}:${config.directory}:${name}`;
  const previous = new Map(files.map(f => [f, cache.get(key(f))]));
  let replies: { file: string; version: string; value?: unknown }[];
  if (config.host) {
    const { hosts } = await loadServerRegistry();
    if (!hosts.some(host => host.alias === config.host && host.active && host.group === "online")) throw new Error("监控来源未注册或已停用");
    const options = await sshTransportOptions(config.host);
    const request = JSON.stringify(files.map(file => [file, previous.get(file)?.version || ""]));
    const command = `python3 -c ${quote(batchRead)} ${quote(config.directory)} ${quote(request)}`;
    const result = await exec("ssh", [...options, "-o", "ConnectTimeout=5", config.host, command], { cwd: os.homedir(), timeout: 20_000, maxBuffer: 64 * 1024 * 1024 });
    replies = JSON.parse(result.stdout);
  } else {
    replies = await Promise.all(files.map(async file => {
      const location = path.join(config.directory, file), stat = await fs.stat(location, { bigint: true });
      if (stat.size > BigInt(4 * 1024 * 1024)) throw new Error("监控快照过大");
      const version = `${stat.mtimeNs}:${stat.size}`;
      return { file, version, ...(version === previous.get(file)?.version ? {} : { value: JSON.parse(await fs.readFile(location, "utf8")) }) };
    }));
  }
  if (!Array.isArray(replies) || replies.length !== files.length) throw new Error("Invalid snapshot batch");
  return replies.map((reply, i) => {
    if (!reply || reply.file !== files[i] || typeof reply.version !== "string") throw new Error("Invalid snapshot batch");
    const value = Object.hasOwn(reply, "value") ? reply.value : previous.get(reply.file)?.value;
    if (value === undefined) throw new Error("Missing snapshot");
    cache.delete(key(reply.file)); cache.set(key(reply.file), { version: reply.version, value });
    if (cache.size > 192) cache.delete(cache.keys().next().value!);
    return value;
  });
}

async function loadSource() {
  const configFile = path.join(resolveStateDir(), "claw3d", "participation.json");
  let config: Source;
  try {
    if ((await fs.stat(configFile)).size > 4096) throw new Error("Invalid participation configuration");
    config = JSON.parse(await fs.readFile(configFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!config || typeof config.directory !== "string" || !path.posix.isAbsolute(config.directory) || /[\x00-\x1f]/.test(config.directory) || (config.host !== undefined && (typeof config.host !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(config.host)))) throw new Error("Invalid participation configuration");
  const [raw] = await readSnapshots(config, ["index.json"]);
  const index = raw as { version: number; hours: number[]; updatedAt: number };
  if (!Number.isFinite(index.updatedAt) || index.version !== 1 || !Array.isArray(index.hours) || index.hours.length > 336 || index.hours.some(h => !Number.isSafeInteger(h) || h < 0 || h % 3_600_000)) throw new Error("Invalid participation index");
  return { config, index, hours: [...new Set(index.hours)].sort((a, b) => b - a) };
}

export async function getParticipation(hour?: number) {
  const source = await loadSource();
  if (!source) return { configured: false, updatedAt: null, hours: [], hour: null };
  const { config, index, hours } = source;
  const selected = hour ?? hours.find(h => h + 3_600_000 <= Date.now()) ?? hours[0];
  if (selected === undefined) return { configured: true, updatedAt: index.updatedAt, hours, hour: null };
  if (!hours.includes(selected)) throw new Error("该小时尚无监控数据");
  const [raw] = await readSnapshots(config, [`hours/${selected}.json`]);
  const data = parseParticipationHour(raw);
  if (data.hour !== selected) throw new Error("Invalid participation hour");
  return { configured: true, updatedAt: index.updatedAt, hours, hour: data };
}

export async function getParticipationSeries(count: number, level: ParticipationLevel, filter: ParticipationFilter, focus: string) {
  const source = await loadSource(), now = Date.now();
  const end = Math.floor(now / 3_600_000) * 3_600_000, start = end - (count - 1) * 3_600_000;
  const hours = source?.hours.filter(h => h >= start && h <= end) || [];
  const raw = source ? await readSnapshots(source.config, hours.map(h => `hours/${h}.json`)) : [];
  const snapshots = raw.map((r, i) => {
    const h = parseParticipationHour(r);
    if (h.hour !== hours[i]) throw new Error("Invalid participation hour");
    return h;
  });
  return { configured: !!source, updatedAt: source?.index.updatedAt ?? null, ...participationSeries(snapshots, count, now, level, filter, focus) };
}
