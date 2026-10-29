// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { PasswordStore } = await import("../../server/web-access/password-store.js");
const original = { username: "fixture", password: "temporary-fixture-password" };
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "claw3d-password-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

describe("initial password ownership", () => {
  it("requires a short-lived local-owner grant, validates confirmation, and stores only a salted password hash", async () => {
    const store = new PasswordStore(directory, original);
    expect(await store.verify(original.password)).toBe(true);
    const token = store.issueSetup();
    expect(readFileSync(join(directory, "password-setup.json"), "utf8")).not.toContain(token);
    expect(store.validToken(token, Date.now() + 31 * 60000)).toBe(false);
    await expect(store.completeSetup("wrong", "new-strong-password", "new-strong-password")).rejects.toThrow("失效");
    await expect(store.completeSetup(token, "short", "short")).rejects.toThrow("12");
    await expect(store.completeSetup(token, "new-strong-password", "mismatch")).rejects.toThrow("不一致");
    const version = store.version;
    await store.completeSetup(token, "new-strong-password", "new-strong-password");
    expect(store.version).not.toBe(version);
    expect(store.needsSetup).toBe(false);
    const stored = readFileSync(join(directory, "credentials.json"), "utf8");
    expect(stored).not.toContain("new-strong-password");
    expect(stored).not.toContain(original.password);
    expect(JSON.parse(stored).password).toBeUndefined();
    expect(statSync(join(directory, "credentials.json")).mode & 0o777).toBe(0o600);
    const restarted = new PasswordStore(directory, original);
    expect(await restarted.verify("new-strong-password")).toBe(true);
    expect(await restarted.verify(original.password)).toBe(false);
    expect(restarted.validToken(token)).toBe(false);
    expect(() => restarted.issueSetup()).toThrow("already");
  });
  it("invalidates an earlier invitation and permits only one concurrent password submission", async () => {
    const store = new PasswordStore(directory, original);
    const old = store.issueSetup(); const token = store.issueSetup();
    expect(store.validToken(old)).toBe(false);
    const results = await Promise.allSettled([
      store.completeSetup(token, "first-strong-password", "first-strong-password"),
      store.completeSetup(token, "other-strong-password", "other-strong-password"),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect([await store.verify("first-strong-password"), await store.verify("other-strong-password")].filter(Boolean)).toHaveLength(1);
  });
});
