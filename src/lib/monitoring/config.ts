import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveStateDir } from "@/lib/clawdbot/paths";
import type { MonitorLink } from "./types";

export function parseMonitorLinks(value: unknown): MonitorLink[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("Use up to eight monitor links.");
  const ids = new Set<string>();
  return value.map(link => {
    if (!link || typeof link !== "object" || typeof link.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(link.id) || ids.has(link.id)) throw new Error("Invalid monitor link.");
    ids.add(link.id);
    if (typeof link.label !== "string" || !link.label.trim() || link.label.trim().length > 60) throw new Error("Give each monitor a name of up to 60 characters.");
    let url: URL;
    try { url = new URL(link.url); } catch { throw new Error("Use a valid HTTP or HTTPS dashboard URL."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 4096) throw new Error("Use a valid HTTP or HTTPS dashboard URL.");
    if (!["chart", "servers", "globe"].includes(link.visual)) throw new Error("Invalid monitor illustration.");
    return { id: link.id, label: link.label.trim(), url: url.href, visual: link.visual };
  });
}

const configPath = () => path.join(resolveStateDir(), "claw3d", "monitoring.json");

export function loadMonitorLinks(): MonitorLink[] {
  const file = configPath();
  if (fs.existsSync(file)) return parseMonitorLinks(JSON.parse(fs.readFileSync(file, "utf8")).links);
  const url = process.env.CLAW3D_GRAFANA_URL || process.env.NEXT_PUBLIC_CLAW3D_GRAFANA_URL;
  return url ? parseMonitorLinks([{ id: "grafana", label: "Grafana", url, visual: "chart" }]) : [];
}

export function saveMonitorLinks(value: unknown): MonitorLink[] {
  const links = parseMonitorLinks(value), file = configPath(), temporary = `${file}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(temporary, JSON.stringify({ links }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
  return links;
}
