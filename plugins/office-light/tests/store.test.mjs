import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { RoleStore } from "../src/store.mjs";
import { normalizeChatLink } from "../src/links.mjs";

const chatA = "codex://threads/10000000-0000-4000-8000-000000000001";
const chatB = "codex://threads/10000000-0000-4000-8000-000000000002";
async function withStore(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "office-light-test-"));
  try { await run(new RoleStore(directory), directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}
test("only canonical local Codex chat links or technical UUIDs can be saved", () => {
  assert.equal(normalizeChatLink(chatA + "/"), chatA);
  assert.equal(normalizeChatLink("10000000-0000-4000-8000-000000000001"), chatA);
  for (const link of ["https://example.com", "codex://threads/new", chatA + "?hostId=remote", chatA + "#fragment", "javascript:alert(1)", "codex://threads/../../config.toml"]) {
    assert.throws(() => normalizeChatLink(link));
  }
});
test("roles persist across fresh store instances; edits keep identity; removal keeps other roles", async () => withStore(async (store, directory) => {
  const first = await store.save({ name: "Research", chatLink: chatA });
  const second = await store.save({ name: "Writing", chatLink: chatB, accent: "blue" });
  const fresh = new RoleStore(directory);
  assert.equal((await fresh.list()).length, 2);
  const updated = await fresh.save({ id: first.id, name: "Review", chatLink: chatB, accent: "coral" });
  assert.equal(updated.id, first.id);
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(updated.chatLink, chatB);
  await fresh.remove(first.id);
  assert.deepEqual((await store.list()).map(role => role.id), [second.id]);
}));
test("invalid changes do not overwrite saved links or touch paths outside role storage", async () => withStore(async store => {
  const role = await store.save({ name: "Research", chatLink: chatA });
  await assert.rejects(store.save({ id: role.id, name: "Oops", chatLink: "https://example.com" }));
  assert.equal((await store.list())[0].chatLink, chatA);
  await assert.rejects(store.remove("../config"));
  await assert.rejects(store.save({ name: " ", chatLink: chatA }));
  await assert.rejects(store.save({ id: "10000000-0000-4000-8000-000000000099", name: "Missing", chatLink: chatA }));
}));
test("independent clients creating different roles preserve every record", async () => withStore(async (store, directory) => {
  await Promise.all(Array.from({ length: 12 }, (_, i) => new RoleStore(directory).save({ name: "Role " + i, chatLink: i % 2 ? chatA : chatB })));
  const roles = await store.list();
  assert.equal(roles.length, 12);
  assert.equal(new Set(roles.map(role => role.id)).size, 12);
}));
test("corrupt plugin-owned data is reported rather than silently reset", async () => withStore(async (store, directory) => {
  const role = await store.save({ name: "Research", chatLink: chatA });
  await fs.writeFile(path.join(directory, "roles", role.id + ".json"), "{bad");
  await assert.rejects(store.list(), /could not be read/);
}));
