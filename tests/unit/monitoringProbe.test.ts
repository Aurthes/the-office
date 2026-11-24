// @vitest-environment node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";
it("keeps all mounts and bounds statfs, including an unkillable fake query, without waiting or duplicate workers", () => {
  const output = execFileSync("python3", ["tests/fixtures/monitoring_probe_cases.py", path.resolve("server/monitoring-probe.py"), "-v"], {
    encoding: "utf8", timeout: 5000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  expect(output).toBe("");
});
