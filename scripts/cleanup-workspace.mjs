import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// No dependency installation or running application is needed for maintenance.
function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || (!allowFailure && result.status !== 0)) {
    throw result.error || new Error(`${command} failed: ${result.stderr.trim()}`);
  }
  return result;
}

const inside = (root, value) => value === root || value.startsWith(root + path.sep);
const stat = value => fs.statSync(value, { throwIfNoEntry: false });
const canonical = value => fs.realpathSync(value);
const git = (repo, ...args) => run("git", ["-C", repo, ...args]).stdout.trim();

function worktrees(repo) {
  return git(repo, "worktree", "list", "--porcelain", "-z").split("\0\0").filter(Boolean).map(block => {
    const row = {};
    for (const field of block.split("\0").filter(Boolean)) {
      const split = field.indexOf(" ");
      row[split < 0 ? field : field.slice(0, split)] = split < 0 ? true : field.slice(split + 1);
    }
    return row;
  });
}

// Inspect only managed roots. Never follow symlinks or read conversation stores.
function linksInto(roots) {
  const result = run("find", [...roots, "-type", "l", "-print0"]);
  const links = [];
  for (const source of result.stdout.split("\0").filter(Boolean)) {
    const target = path.resolve(path.dirname(source), fs.readlinkSync(source));
    links.push({ source, target });
    try { links.push({ source, target: canonical(source) }); } catch (error) {
      if (!["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code)) throw error;
    }
  }
  return links;
}

function strings(value) {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

function liveReferences() {
  const commands = run("ps", ["-axo", "command="]).stdout;
  const cwd = run("lsof", ["-n", "-P", "-a", "-u", String(process.getuid()), "-d", "cwd", "-Fn"]);
  const paths = cwd.stdout.split("\n").filter(line => line.startsWith("n/")).map(line => line.slice(1));
  if (!paths.length) throw new Error("Cannot inspect process working directories; refusing cleanup");
  if (process.platform === "darwin") {
    const directory = path.join(os.homedir(), "Library", "LaunchAgents");
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".plist"))) {
      const data = JSON.parse(run("plutil", ["-convert", "json", "-o", "-", path.join(directory, name)]).stdout);
      paths.push(...strings(data).filter(value => path.isAbsolute(value)));
    }
  }
  return { commands, paths };
}

function referenced(root, references, links, protectedPaths) {
  if (protectedPaths.some(value => inside(root, value))) return "explicitly protected";
  if (references.paths.some(value => inside(root, value))) return "process or service reference";
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`${escaped}(?=$|[/\\s\"'])`, "m").test(references.commands)) return "process command reference";
  if (links.some(link => !inside(root, link.source) && inside(root, link.target))) return "shared symlink target";
  return null;
}

function worktreeReason(row, options) {
  const root = row.worktree;
  if ("locked" in row || "prunable" in row) return "locked or missing worktree";
  if (fs.lstatSync(root).isSymbolicLink()) return "symlinked worktree";
  const directory = git(root, "rev-parse", "--absolute-git-dir");
  if (["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer", "BISECT_START"].some(name => stat(path.join(directory, name)))) return "unfinished Git operation";
  if (git(root, "status", "--porcelain", "--untracked-files=all")) return "uncommitted files";
  const merged = run("git", ["-C", options.repo, "merge-base", "--is-ancestor", row.HEAD, options.ref], { allowFailure: true });
  if (merged.status === 1) return "not merged into reference branch";
  if (merged.status !== 0) throw new Error("Cannot verify worktree ancestry");
  // Git ignores are not permission to delete local configuration or credentials.
  const ignored = git(root, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z").split("\0").filter(Boolean);
  const generated = /^(?:\.next(?:\/|$)|node_modules(?:\/|$)|next-env\.d\.ts$|tsconfig\.tsbuildinfo$|output\/playwright(?:\/|$)|playwright-report(?:\/|$)|test-results(?:\/|$)|coverage(?:\/|$))/;
  if (ignored.some(value => !generated.test(value))) return "local files outside generated artifact allowlist";
  const latest = Math.max(stat(root).mtimeMs, stat(path.join(directory, "logs", "HEAD"))?.mtimeMs || stat(path.join(directory, "HEAD")).mtimeMs);
  return Date.now() - latest < options.minAgeHours * 3600000 ? "recent worktree activity" : null;
}

function releaseDirs(options) {
  if (!options.releasesDir) return [];
  const name = JSON.parse(git(options.repo, "show", `${options.ref}:package.json`)).name;
  return fs.readdirSync(options.releasesDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(options.releasesDir, entry.name)).filter(root => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name === name &&
        stat(path.join(root, ".next", "BUILD_ID"))?.isFile() && stat(path.join(root, "server", "index.js"))?.isFile();
    } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }).sort((a, b) => stat(b).mtimeMs - stat(a).mtimeMs || a.localeCompare(b));
}

export function planCleanup(input, inspectLive = liveReferences, onlyPath = null) {
  const options = {
    ref: "origin/main", minAgeHours: 24, protectedPaths: [], ...input,
    repo: canonical(input.repo),
  };
  if (!Number.isFinite(options.minAgeHours) || options.minAgeHours < 0) throw new Error("Invalid minimum age");
  git(options.repo, "rev-parse", "--verify", `${options.ref}^{commit}`);
  const rows = worktrees(options.repo);
  // Only direct children of the conventional worktree directory are eligible.
  const base = rows[0].worktree;
  const worktreesDir = path.join(path.dirname(base), ".worktrees", path.basename(base));
  const roots = [base, ...rows.slice(1).map(row => row.worktree).filter(root => stat(root) && !inside(worktreesDir, root))];
  if (stat(worktreesDir)) roots.push(worktreesDir); // Includes unregistered backups as reference sources, never deletion targets.
  if (options.releasesDir) {
    options.releasesDir = canonical(options.releasesDir);
    if (options.releasesDir === base || inside(options.releasesDir, base) || inside(base, options.releasesDir) ||
        inside(worktreesDir, options.releasesDir) || inside(options.releasesDir, worktreesDir)) {
      throw new Error("Release directory must be separate from source worktrees");
    }
    roots.push(options.releasesDir);
  }
  options.protectedPaths = [base, process.cwd(), fileURLToPath(import.meta.url), ...options.protectedPaths].map(value => path.resolve(value));
  const references = inspectLive();
  const links = linksInto([...new Set(roots)]);
  const entries = [];
  for (const row of rows.slice(1)) {
    const root = row.worktree;
    if (path.dirname(root) !== worktreesDir || (onlyPath && root !== onlyPath)) continue;
    const reason = referenced(root, references, links, options.protectedPaths) || worktreeReason(row, options);
    entries.push({ kind: "worktree", path: root, action: reason ? "keep" : "remove", reason: reason || "merged, clean and idle" });
  }
  let rollbackKept = false;
  for (const root of releaseDirs(options)) {
    let reason = referenced(root, references, links, options.protectedPaths);
    if (!reason && !rollbackKept) { reason = "latest unused release retained for rollback"; rollbackKept = true; }
    if (!reason && Date.now() - stat(root).mtimeMs < options.minAgeHours * 3600000) reason = "recent release";
    if (!onlyPath || root === onlyPath) entries.push({ kind: "release", path: root, action: reason ? "keep" : "remove", reason: reason || "superseded release" });
  }
  return { options, entries };
}

export function applyCleanup(input, inspectLive = liveReferences) {
  const first = planCleanup(input, inspectLive);
  const results = [];
  for (const candidate of first.entries.filter(entry => entry.action === "remove")) {
    // Refresh references and Git state immediately before each deletion. No --force.
    const current = planCleanup(input, inspectLive, candidate.path).entries.find(entry => entry.path === candidate.path);
    if (!current || current.action !== "remove") {
      results.push({ ...candidate, action: "keep", reason: current?.reason || "changed during cleanup" });
      continue;
    }
    if (current.kind === "worktree") git(first.options.repo, "worktree", "remove", current.path);
    else fs.rmSync(current.path, { recursive: true });
    results.push({ ...current, action: "removed" });
  }
  return { entries: first.entries.filter(entry => entry.action === "keep").concat(results) };
}

function main() {
  const args = process.argv.slice(2), input = { repo: process.cwd(), protectedPaths: [] };
  let apply = false, report;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--apply") { apply = true; continue; }
    if (!["--repo", "--ref", "--releases-dir", "--protect", "--min-age-hours", "--report"].includes(flag) || !args[i + 1]) throw new Error(`Unknown or missing argument: ${flag}`);
    const value = args[++i];
    if (flag === "--repo") input.repo = value;
    if (flag === "--ref") input.ref = value;
    if (flag === "--releases-dir") input.releasesDir = value;
    if (flag === "--protect") input.protectedPaths.push(value);
    if (flag === "--min-age-hours") input.minAgeHours = Number(value);
    if (flag === "--report") report = value;
  }
  const result = apply ? applyCleanup(input) : planCleanup(input);
  const data = { timestamp: new Date().toISOString(), mode: apply ? "apply" : "report", entries: result.entries };
  if (report) fs.writeFileSync(report, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(data, null, report ? 0 : 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
