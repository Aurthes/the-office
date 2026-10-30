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
    expect(index.list()[0].completedResult.key).toBe("2026-10-29T10:00:00Z");
  });
  it("does not treat task markers inside user or tool content as runtime events", () => {
    fs.appendFileSync(path.join(root, "existing.jsonl"), JSON.stringify({ timestamp: "2026-10-29T10:00:01Z", type: "response_item", payload: { text: event("task_complete") } }) + "\n");
    expect(index.list()[0].status).toBe("running");
  });
  it("reports missing or unsupported history as unknown", () => {
    fs.unlinkSync(path.join(root, "existing.jsonl"));
    expect(index.list()[0].status).toBe("unknown");
  });
  it("reads original App unread flags only for completed local results and never writes them", () => {
    const filename = path.join(root, ".codex-global-state.json");
    const state = { "electron-thread-read-state-v1": { version: 1, unreadByIdentity: {
      account: { "local:instance": ["existing"], "ssh:remote": ["remote-thread"] },
    } } };
    const original = JSON.stringify(state); fs.writeFileSync(filename, original);
    expect(index.list()[0].completedResult).toBeNull(); // Still working.
    fs.appendFileSync(path.join(root, "existing.jsonl"), event("task_complete"));
    expect(index.list()[0].completedResult).toEqual({ key: "2026-10-29T10:00:00Z", unread: true });
    expect(fs.readFileSync(filename, "utf8")).toBe(original);
    state["electron-thread-read-state-v1"].unreadByIdentity.account["local:instance"] = [];
    state["electron-thread-read-state-v1"].unreadByIdentity.account["ssh:remote"] = ["existing"];
    fs.writeFileSync(filename, JSON.stringify(state));
    expect(index.list()[0].completedResult.unread).toBe(false); // Read in App; remote flags do not leak.
    fs.appendFileSync(path.join(root, "existing.jsonl"), event("turn_aborted"));
    expect(index.list()[0].completedResult).toBeNull();
  });
  it("treats missing, malformed, or unknown-version App read state as no unread signal", () => {
    fs.appendFileSync(path.join(root, "existing.jsonl"), event("task_complete"));
    for (const value of ["{", "{}", JSON.stringify({ "electron-thread-read-state-v1": { version: 2 } }),
      JSON.stringify({ "electron-thread-read-state-v1": { version: 1, unreadByIdentity: { malformed: null } } })]) {
      fs.writeFileSync(path.join(root, ".codex-global-state.json"), value);
      expect(index.list()[0].completedResult.unread).toBe(false);
    }
  });
  it("uses App project assignment for worktrees and keeps explicit projectless chats in Open Workspace", () => {
    const filename = path.join(root, ".codex-global-state.json");
    const state = { "local-projects": { repo: { id: "repo", name: "Repo project", rootPaths: [root] },
      moved: { id: "moved", name: "Worktree project", rootPaths: ["/another/repo"] } },
      "thread-project-assignments": { existing: { projectKind: "local", projectId: "moved" } },
      "projectless-thread-ids": [] as string[] };
    fs.writeFileSync(filename, JSON.stringify(state));
    expect(index.list()[0]).toMatchObject({ projectId: "moved", project: "Worktree project" });
    state["projectless-thread-ids"] = ["existing"];
    fs.writeFileSync(filename, JSON.stringify(state));
    expect(index.list()[0]).toMatchObject({ projectId: null, project: "Open Workspace" });
  });
  it("recognizes an ordinary project root and tracks App membership changes on the next read", () => {
    const filename = path.join(root, ".codex-global-state.json");
    fs.writeFileSync(filename, JSON.stringify({ "local-projects": { repo: { id: "repo", name: "Repo project", rootPaths: [root] } } }));
    expect(index.list()[0].projectId).toBe("repo");
    fs.writeFileSync(filename, JSON.stringify({ "local-projects": {} }));
    expect(index.list()[0].projectId).toBeNull();
  });
  it("reads native Projects and atomic thread assignments ahead of legacy App caches", () => {
    index.close();
    const db = new DatabaseSync(path.join(root, "state_5.sqlite"));
    db.exec("ALTER TABLE threads ADD COLUMN project_id TEXT; CREATE TABLE projects(id TEXT, name TEXT, position INTEGER); CREATE TABLE project_roots(project_id TEXT, path TEXT, position INTEGER)");
    db.prepare("INSERT INTO projects VALUES (?, ?, 0)").run("native", "Native Project");
    db.prepare("INSERT INTO project_roots VALUES (?, ?, 0)").run("native", root);
    db.exec("UPDATE threads SET project_id='native' WHERE id='existing'"); db.close();
    fs.writeFileSync(path.join(root, ".codex-global-state.json"), JSON.stringify({ "projectless-thread-ids": ["existing"], "local-projects": { stale: { id: "stale", name: "Stale", rootPaths: [root] } } }));
    index = new CodexSessionIndex(root);
    expect(index.projects()).toEqual([{ id: "native", name: "Native Project", rootPaths: [root] }]);
    expect(index.list()[0].projectId).toBe("native");
  });
  it("uses immediate native lifecycle state before delayed log persistence", () => {
    index.handle({ method: "turn/completed", params: { threadId: "existing" } });
    expect(index.list()[0].status).toBe("idle");
    index.handle({ method: "thread/status/changed", params: { threadId: "existing", status: { type: "active" } } });
    expect(index.list()[0].status).toBe("running");
  });
  it("maps the App's legacy project IDs to native IDs while thread migration is incomplete", () => {
    index.close();
    const db = new DatabaseSync(path.join(root, "state_5.sqlite"));
    db.exec("ALTER TABLE threads ADD COLUMN project_id TEXT; CREATE TABLE projects(id TEXT, name TEXT, position INTEGER); CREATE TABLE project_roots(project_id TEXT, path TEXT, position INTEGER)");
    db.prepare("INSERT INTO projects VALUES (?, ?, 0)").run("native", "Moved Project");
    db.prepare("INSERT INTO project_roots VALUES (?, ?, 0)").run("native", "/another/root"); db.close();
    fs.writeFileSync(path.join(root, ".codex-global-state.json"), JSON.stringify({
      "thread-project-assignments": { existing: { projectId: "legacy-id" } },
      "app-server-project-id-by-legacy-project-id-by-host": { [`local:${root}`]: { "legacy-id": "native" } },
    }));
    index = new CodexSessionIndex(root);
    expect(index.list()[0]).toMatchObject({ projectId: "native", project: "Moved Project", workspace: root });
  });
});
