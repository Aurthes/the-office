// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const { CodexRosterSync } = createRequire(import.meta.url)("../../server/codex-roster-sync.js");
let root: string, sync: InstanceType<typeof CodexRosterSync>;
afterEach(() => { sync?.close(); vi.useRealTimers(); if (root) fs.rmSync(root, { recursive: true, force: true }); });
function setup() {
  vi.useFakeTimers(); root = fs.mkdtempSync(path.join(os.tmpdir(), "claw-roster-"));
  const rows = [{ id: "t", name: "Original", projectId: "p", status: "idle", updatedAt: 1 }];
  const projects = [{ id: "p", name: "Project", rootPaths: [root] }];
  const index = { home: root, projects: () => projects, list: () => rows, handle: vi.fn() };
  const notify = vi.fn(); sync = new CodexRosterSync(index, notify); sync.start();
  return { index, notify, rows, projects };
}
describe("native roster push", () => {
  it("coalesces membership/status changes, ignores text deltas and omits unchanged snapshots", () => {
    const { index, notify, rows } = setup();
    sync.native({ method: "item/agentMessage/delta", params: { threadId: "t" } });
    vi.advanceTimersByTime(200); expect(notify).not.toHaveBeenCalled();
    rows[0].status = "running";
    for (let i = 0; i < 5; i++) sync.native({ method: "turn/started", params: { threadId: "t" } });
    vi.advanceTimersByTime(150); expect(notify).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    expect(index.handle).toHaveBeenCalled();
    rows[0].updatedAt++;
    vi.advanceTimersByTime(30000); expect(notify).toHaveBeenCalledTimes(1);
    rows.pop(); sync.native({ method: "thread/archived", params: { threadId: "t" } });
    vi.advanceTimersByTime(150); expect(notify).toHaveBeenLastCalledWith({ revision: 2 });
  });
  it("recovers a missed event in the server-side check and releases pending work on close", () => {
    const { notify, projects } = setup();
    projects.push({ id: "new", name: "Added elsewhere", rootPaths: [root] });
    vi.advanceTimersByTime(30000); expect(notify).toHaveBeenCalledTimes(1);
    projects.pop(); sync.changed(); sync.close();
    vi.advanceTimersByTime(30000); expect(notify).toHaveBeenCalledTimes(1);
  });
});
