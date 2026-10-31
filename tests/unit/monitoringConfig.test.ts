import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadMonitorLinks, parseMonitorLinks, saveMonitorLinks } from "@/lib/monitoring/config";
import { GET, PUT } from "@/app/api/monitoring/route";

const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); directories.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })); directories.length = 0; });
const link = { id: "grafana", label: "My dashboard", url: "https://grafana.example.com/d/test?var-id=1&var-id=3", visual: "chart" };

it("saves shared monitor settings without touching other Studio state and does not lose URL filters", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-config-")); directories.push(directory);
  vi.stubEnv("OPENCLAW_STATE_DIR", directory);
  vi.stubEnv("CLAW3D_GRAFANA_URL", link.url);
  const file = path.join(directory, "claw3d", "settings.json"); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, '{"unrelated":true}');
  expect(loadMonitorLinks()[0]).toMatchObject({ id: "grafana", url: link.url });
  expect((await GET()).headers.get("cache-control")).toBe("no-store");
  const response = await PUT(new Request("http://localhost/api/monitoring", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ links: [link] }) }));
  expect(response.status).toBe(200);
  expect(loadMonitorLinks()).toEqual([link]);
  expect(fs.readFileSync(file, "utf8")).toBe('{"unrelated":true}');
  expect(fs.readdirSync(path.dirname(file)).some(name => name.endsWith(".tmp"))).toBe(false);
  expect(saveMonitorLinks([])).toEqual([]); expect(loadMonitorLinks()).toEqual([]);
});

it("rejects credential-bearing and executable URLs, duplicate IDs, and oversized configurations", () => {
  for (const url of ["javascript:alert(1)", "file:///tmp/x", "https://secret:token@example.com", "not a URL"]) expect(() => parseMonitorLinks([{ ...link, url }])).toThrow();
  expect(() => parseMonitorLinks([link, link])).toThrow();
  expect(() => parseMonitorLinks(Array.from({ length: 9 }, (_, i) => ({ ...link, id: `m${i}` })))).toThrow();
  expect(() => parseMonitorLinks([{ ...link, id: "../config" }])).toThrow();
  expect(() => parseMonitorLinks([{ ...link, label: " " }])).toThrow();
});

it("does not accept cross-site form content as a settings update", async () => {
  expect((await PUT(new Request("http://localhost/api/monitoring", { method: "PUT", body: "links=bad" }))).status).toBe(415);
});
