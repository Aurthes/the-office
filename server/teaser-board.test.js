const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readTeasers, postTeaser, updateTeaser } = require("./teaser-board");
const question = { title: "Two doors", prompt: "Which door is safe?", author: "teaser" };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-teaser-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "board");
}
test("empty reads do not create state and unfinished solutions stay private", t => {
  const dir = fixture(t);
  assert.deepEqual(readTeasers(dir), []); assert.equal(fs.existsSync(dir), false);
  const row = postTeaser({ ...question, answer: "Left", summary: "Check the invariant." }, dir);
  assert.equal(row.status, "open"); assert.equal(row.completedAt, null);
  assert.equal(readTeasers(dir)[0].answer, ""); assert.equal(readTeasers(dir)[0].summary, "");
  assert.equal(readTeasers(dir, true)[0].answer, "Left");
  assert.equal(fs.statSync(path.join(dir, `${row.id}.json`)).mode & 0o777, 0o600);
});
test("finishing requires both an answer and key idea without changing state on failure", t => {
  const dir = fixture(t), row = postTeaser(question, dir);
  assert.throws(() => updateTeaser(row.id, { revision: 1, status: "finished", answer: "Left" }, dir), /summary/);
  assert.throws(() => updateTeaser(row.id, { revision: 1, status: "finished", summary: "One invariant" }, dir), /answer/);
  assert.equal(readTeasers(dir)[0].revision, 1);
  assert.deepEqual(fs.readdirSync(dir), [`${row.id}.json`]);
});
test("one teaser progresses, survives rereads, rejects stale edits and can reopen", t => {
  const dir = fixture(t), row = postTeaser(question, dir);
  const active = updateTeaser(row.id, { revision: 1, status: "in_progress" }, dir);
  assert.equal(active.revision, 2);
  const done = updateTeaser(row.id, { revision: 2, status: "finished", answer: "Left", summary: "The invariant rules out right." }, dir);
  assert.equal(done.revision, 3); assert.ok(done.completedAt);
  assert.throws(() => updateTeaser(row.id, { revision: 2, title: "Stale" }, dir), /Revision changed/);
  assert.deepEqual(readTeasers(dir)[0], done);
  const edited = updateTeaser(row.id, { revision: 3, summary: "A clearer explanation." }, dir);
  assert.equal(edited.completedAt, done.completedAt);
  const reopened = updateTeaser(row.id, { revision: 4, status: "open" }, dir);
  assert.equal(reopened.completedAt, null); assert.equal(readTeasers(dir)[0].summary, "");
  assert.equal(readTeasers(dir, true)[0].summary, "A clearer explanation.");
});
test("invalid inputs, paths, corrupt records and competing writers fail safely", t => {
  const dir = fixture(t);
  for (const input of [{ ...question, title: " " }, { ...question, status: "done" }, { ...question, secret: "no" }, { ...question, summary: "x".repeat(2001) }]) assert.throws(() => postTeaser(input, dir));
  const row = postTeaser(question, dir), file = path.join(dir, `${row.id}.json`);
  assert.throws(() => updateTeaser("../../outside", { revision: 1 }, dir), /Invalid teaser ID/);
  fs.writeFileSync(`${file}.lock`, "test");
  assert.throws(() => updateTeaser(row.id, { revision: 1, title: "Other" }, dir), /being updated/);
  fs.unlinkSync(`${file}.lock`);
  fs.writeFileSync(file, "broken");
  assert.throws(() => readTeasers(dir));
  assert.throws(() => updateTeaser(row.id, { revision: 1, title: "Do not overwrite" }, dir));
  assert.equal(fs.readFileSync(file, "utf8"), "broken");
  assert.deepEqual(fs.readdirSync(dir), [`${row.id}.json`]);
});
test("the dependency-free publisher works across real CLI processes", t => {
  const dir = fixture(t), script = path.join(__dirname, "teaser-board.js");
  const run = (args, input) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, CLAW3D_TEASER_DIR: dir }, input: JSON.stringify(input), encoding: "utf8" });
  const created = run(["post"], question); assert.equal(created.status, 0, created.stderr);
  const row = JSON.parse(created.stdout);
  const update = run(["update", row.id], { revision: 1, status: "finished", answer: "Left", summary: "Keep the invariant." });
  assert.equal(update.status, 0, update.stderr);
  const listed = run(["list"]); assert.equal(JSON.parse(listed.stdout)[0].revision, 2);
  assert.equal(JSON.parse(run(["get", row.id]).stdout).summary, "Keep the invariant.");
  const stale = run(["update", row.id], { revision: 1, status: "open" });
  assert.notEqual(stale.status, 0); assert.match(stale.stderr, /Revision changed/);
  const badArgs = run(["post", "--unknown"]); assert.notEqual(badArgs.status, 0);
});
