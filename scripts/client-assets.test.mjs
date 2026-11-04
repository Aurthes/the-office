import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { retainClientAssets } from "./redeploy-office.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-client-assets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releases = ["a", "b", "c"].map(name => path.join(root, name));
  const write = (release, file, data) => {
    const destination = path.join(release, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, data);
    return destination;
  };
  return { releases, write };
}

test("keeps old deferred terminal assets through successive releases and deletion of the original releases", t => {
  const { releases: [a, b, c], write } = fixture(t);
  const old = write(a, ".next/static/chunks/terminal-old.js", "export const version = 'old';");
  write(a, ".next/static/css/terminal-old.css", "old-css");
  write(a, ".next/server/private.json", "private-server-data");
  write(b, ".next/static/chunks/terminal-new.js", "new-js");
  const first = retainClientAssets(a, b);
  assert.equal(first.files, 2);
  assert.equal(fs.statSync(old).ino, fs.statSync(path.join(b, ".next/static/chunks/terminal-old.js")).ino);
  assert.ok(!fs.existsSync(path.join(b, ".next/server/private.json")));
  assert.equal(retainClientAssets(a, b).files, 0);
  write(c, ".next/static/chunks/newest.js", "newest-js");
  assert.equal(retainClientAssets(b, c).files, 3);
  fs.rmSync(a, { recursive: true }); fs.rmSync(b, { recursive: true });
  assert.equal(fs.readFileSync(path.join(c, ".next/static/chunks/terminal-old.js"), "utf8"), "export const version = 'old';");
  assert.equal(fs.readFileSync(path.join(c, ".next/static/chunks/terminal-new.js"), "utf8"), "new-js");
  assert.equal(fs.readFileSync(path.join(c, ".next/static/chunks/newest.js"), "utf8"), "newest-js");
});

test("rejects content collisions and links before changing a running service", t => {
  const { releases: [a, b], write } = fixture(t);
  write(a, ".next/static/chunks/shared.js", "old");
  const newer = write(b, ".next/static/chunks/shared.js", "new");
  assert.throws(() => retainClientAssets(a, b), /different contents/);
  assert.equal(fs.readFileSync(newer, "utf8"), "new");
  fs.unlinkSync(newer); fs.unlinkSync(path.join(a, ".next/static/chunks/shared.js"));
  const secret = write(a, ".next/server/private.json", "private");
  fs.symlinkSync(secret, path.join(a, ".next/static/chunks/link.js"));
  assert.throws(() => retainClientAssets(a, b), /non-regular static asset/);
  assert.ok(!fs.existsSync(path.join(b, ".next/static/chunks/link.js")));
});

test("copies public assets when releases are on different filesystems", t => {
  const { releases: [a, b], write } = fixture(t);
  write(a, ".next/static/chunks/terminal.js", "terminal");
  t.mock.method(fs, "linkSync", () => { throw Object.assign(new Error("Cross-device"), { code: "EXDEV" }); });
  assert.equal(retainClientAssets(a, b).files, 1);
  assert.equal(fs.readFileSync(path.join(b, ".next/static/chunks/terminal.js"), "utf8"), "terminal");
});
