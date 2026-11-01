import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { planCleanup, applyCleanup } from "./cleanup-workspace.mjs";

const idle = () => ({ commands: "", paths: [] });

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "office-cleanup-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "workspace", "office");
  const trees = path.join(root, "workspace", ".worktrees", "office");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(trees, { recursive: true });
  const git = (directory, ...args) => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(repo, "init", "-b", "main");
  fs.writeFileSync(path.join(repo, "package.json"), '{"name":"office-fixture"}');
  fs.writeFileSync(path.join(repo, ".gitignore"), ".next/\nnode_modules\n.env.local\n*.tsbuildinfo\n");
  git(repo, "add", ".");
  const commit = directory => git(directory, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-am", "fixture");
  commit(repo);
  const task = name => {
    const directory = path.join(trees, name);
    git(repo, "worktree", "add", "-b", name, directory);
    return directory;
  };
  const options = { repo, ref: "main", minAgeHours: 0 };
  const entry = (result, directory) => result.entries.find(row => row.path === directory);
  const releases = path.join(root, "releases");
  fs.mkdirSync(releases);
  const release = (name, age) => {
    const directory = path.join(releases, name);
    fs.mkdirSync(path.join(directory, ".next"), { recursive: true });
    fs.mkdirSync(path.join(directory, "server"));
    fs.writeFileSync(path.join(directory, "package.json"), '{"name":"office-fixture"}');
    fs.writeFileSync(path.join(directory, ".next", "BUILD_ID"), "fixture");
    fs.writeFileSync(path.join(directory, "server", "index.js"), "");
    const modified = new Date(Date.now() - age * 3600000);
    fs.utimesSync(directory, modified, modified);
    return directory;
  };
  return { repo, trees, task, options, entry, git, commit, releases, release, root };
}

test("report is read-only; apply retires only a clean merged task including generated artifacts", t => {
  const f = fixture(t), directory = f.task("done");
  fs.mkdirSync(path.join(directory, ".next"));
  fs.writeFileSync(path.join(directory, ".next", "BUILD_ID"), "generated");
  fs.mkdirSync(path.join(directory, "node_modules"));
  fs.writeFileSync(path.join(directory, "node_modules", "large"), "generated");
  assert.equal(f.entry(planCleanup(f.options, idle), directory).action, "remove");
  assert.ok(fs.existsSync(directory));
  assert.equal(f.entry(applyCleanup(f.options, idle), directory).action, "removed");
  assert.ok(!fs.existsSync(directory));
  assert.ok(fs.existsSync(f.repo));
  assert.match(f.git(f.repo, "branch", "--list", "done"), /done/);
});

test("uncommitted, untracked and ignored local data are retained", t => {
  const f = fixture(t);
  for (const [name, file] of [["dirty", "package.json"], ["untracked", "notes.txt"], ["config", ".env.local"]]) {
    const directory = f.task(name);
    fs.appendFileSync(path.join(directory, file), "private data");
    assert.equal(f.entry(applyCleanup(f.options, idle), directory).action, "keep");
    assert.ok(fs.readFileSync(path.join(directory, file), "utf8").includes("private data"));
  }
});

test("unmerged commits, locked trees and unfinished Git operations are retained", t => {
  const f = fixture(t), unmerged = f.task("unmerged");
  fs.writeFileSync(path.join(unmerged, "package.json"), '{"name":"changed"}');
  f.commit(unmerged);
  const locked = f.task("locked");
  f.git(f.repo, "worktree", "lock", locked);
  const merging = f.task("merging");
  const gitDir = f.git(merging, "rev-parse", "--absolute-git-dir").trim();
  fs.writeFileSync(path.join(gitDir, "MERGE_HEAD"), f.git(f.repo, "rev-parse", "HEAD"));
  const result = applyCleanup(f.options, idle);
  for (const directory of [unmerged, locked, merging]) assert.equal(f.entry(result, directory).action, "keep");
});

test("default grace period retains recently used tasks", t => {
  const f = fixture(t), directory = f.task("recent");
  assert.match(f.entry(planCleanup({ ...f.options, minAgeHours: 24 }, idle), directory).reason, /recent/);
});

test("process cwd, service paths, process commands and explicit references are retained", t => {
  const f = fixture(t), cwd = f.task("cwd"), service = f.task("service"), command = f.task("command"), explicit = f.task("explicit");
  const result = applyCleanup({ ...f.options, protectedPaths: [path.join(explicit, "future.txt")] }, () => ({
    paths: [path.join(cwd, "src"), path.join(service, "server", "index.js")],
    commands: `node "${command}/server/index.js"`,
  }));
  for (const directory of [cwd, service, command, explicit]) assert.equal(f.entry(result, directory).action, "keep");
});

test("shared dependency symlink chains protect both intermediate and final targets", t => {
  const f = fixture(t), a = f.task("a"), b = f.task("b"), c = f.task("c");
  fs.mkdirSync(path.join(c, "node_modules"));
  fs.symlinkSync(path.join(c, "node_modules"), path.join(b, "node_modules"));
  fs.symlinkSync(path.join(b, "node_modules"), path.join(a, "node_modules"));
  const result = planCleanup(f.options, idle);
  for (const directory of [b, c]) assert.match(f.entry(result, directory).reason, /symlink/);
  // The base checkout is also a reference source, but never a removal target.
  fs.symlinkSync(path.join(b, "node_modules"), path.join(f.repo, "node_modules"));
  applyCleanup(f.options, idle);
  assert.ok(fs.existsSync(path.join(f.repo, "node_modules")));
});

test("references created after the report are rechecked before deleting", t => {
  const f = fixture(t), directory = f.task("became-active");
  let scans = 0;
  const result = applyCleanup(f.options, () => ({ commands: "", paths: scans++ ? [directory] : [] }));
  assert.equal(f.entry(result, directory).action, "keep");
  assert.ok(fs.existsSync(directory));
});

test("releases retain live versions and one rollback; unrelated data stays untouched", t => {
  const f = fixture(t), old = f.release("old", 80), live = f.release("live", 70), rollback = f.release("rollback", 60);
  const uploads = path.join(f.releases, "uploads");
  fs.mkdirSync(uploads);
  fs.writeFileSync(path.join(uploads, "photo.jpg"), "user data");
  const result = applyCleanup({ ...f.options, releasesDir: f.releases }, () => ({ commands: "", paths: [path.join(live, "server", "index.js")] }));
  assert.equal(f.entry(result, old).action, "removed");
  for (const directory of [live, rollback]) assert.equal(f.entry(result, directory).action, "keep");
  assert.equal(fs.readFileSync(path.join(uploads, "photo.jpg"), "utf8"), "user data");
});

test("shared dependencies inside an old release retain that release", t => {
  const f = fixture(t), old = f.release("shared", 80);
  f.release("rollback", 60);
  fs.mkdirSync(path.join(old, "node_modules"));
  fs.symlinkSync(path.join(old, "node_modules"), path.join(f.repo, "node_modules"));
  assert.match(f.entry(applyCleanup({ ...f.options, releasesDir: f.releases }, idle), old).reason, /symlink/);
  assert.ok(fs.existsSync(path.join(f.repo, "node_modules")));
});

test("unregistered backups are never deletion targets but protect their dependency targets", t => {
  const f = fixture(t), directory = f.task("dependency"), backup = path.join(f.trees, "backup");
  fs.mkdirSync(path.join(directory, "node_modules"));
  fs.mkdirSync(backup);
  fs.symlinkSync(path.join(directory, "node_modules"), path.join(backup, "node_modules"));
  assert.match(f.entry(applyCleanup(f.options, idle), directory).reason, /symlink/);
  assert.ok(fs.existsSync(backup));
});

test("invalid reference, live inspection failure and overlapping release roots fail closed", t => {
  const f = fixture(t), directory = f.task("safe");
  assert.throws(() => applyCleanup({ ...f.options, ref: "missing" }, idle));
  assert.throws(() => applyCleanup(f.options, () => { throw new Error("cannot inspect"); }));
  assert.throws(() => applyCleanup({ ...f.options, releasesDir: f.trees }, idle), /separate/);
  assert.throws(() => applyCleanup({ ...f.options, minAgeHours: -1 }, idle), /age/);
  assert.ok(fs.existsSync(directory));
});
