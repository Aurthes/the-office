import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const { CodexSessionIndex } = require("../../server/codex-session-index.js");
let root: string;
let index: InstanceType<typeof CodexSessionIndex>;
const event = (type: string, extra = {}) => JSON.stringify({ timestamp: "2026-10-29T10:00:00Z", ordinal: 1, type: "event_msg", payload: { type, ...extra } }) + "\n";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "claw-session-index-"));
  const db = new DatabaseSync(path.join(root, "state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT, name TEXT, title TEXT, cwd TEXT, rollout_path TEXT, updated_at INTEGER, model TEXT, reasoning_effort TEXT, is_pinned INTEGER, archived INTEGER, source TEXT)");
  for (const [id, archived, source] of [["existing", 0, "vscode"], ["archived", 1, "vscode"], ["child", 0, "subAgent"]]) {
    db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, "Original App title", "First message", root, path.join(root, `${id}.jsonl`), 123, null, null, 0, archived, source);
  }
  db.close();
  fs.writeFileSync(path.join(root, "existing.jsonl"), event("task_started"));
  index = new CodexSessionIndex(root);
});
afterEach(() => { index.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe("existing App session index", () => {
  it("preserves original IDs and titles, excludes archived/child threads and opens read-only", () => {
    const list = index.list();
    expect(list.map((r: { id: string }) => r.id)).toEqual(["existing"]);
    expect(list[0].name).toBe("Original App title");
    expect(() => index.db.exec("DELETE FROM threads")).toThrow();
  });
  it("follows real start, completion and subsequent start events without creating a session", () => {
    expect(index.list()[0].status).toBe("running");
    fs.appendFileSync(path.join(root, "existing.jsonl"), event("task_complete"));
    expect(index.list()[0].status).toBe("idle");
    fs.appendFileSync(path.join(root, "existing.jsonl"), event("task_started"));
    expect(index.list()[0].status).toBe("running");
  });
  it("recognizes completions with messages larger than a read chunk", () => {
    fs.appendFileSync(path.join(root, "existing.jsonl"), event("task_complete", { last_agent_message: "x".repeat(200000) }));
    expect(index.list()[0].status).toBe("idle");
  });
  it("does not treat task markers inside user or tool content as runtime events", () => {
    fs.appendFileSync(path.join(root, "existing.jsonl"), JSON.stringify({ timestamp: "2026-10-29T10:00:01Z", type: "response_item", payload: { text: event("task_complete") } }) + "\n");
    expect(index.list()[0].status).toBe("running");
  });
  it("reports missing or unsupported history as unknown", () => {
    fs.unlinkSync(path.join(root, "existing.jsonl"));
    expect(index.list()[0].status).toBe("unknown");
  });
});
