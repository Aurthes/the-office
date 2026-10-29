// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { TotpStore } = await import("../../server/web-access/totp-store.js");
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // RFC 4226 test secret.
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "claw3d-totp-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

describe("persistent web two-factor credentials", () => {
  it("accepts RFC vectors, rejects replay across restart, and rejects expired codes", () => {
    const store = new TotpStore(directory);
    expect(store.activate(secret, "wrong", 59000)).toBeNull();
    expect(store.enabled).toBe(false);
    expect(store.activate(secret, "287082", 59000)).toHaveLength(8);
    expect(store.consume("287082", 59000)).toBe(false);
    expect(store.consume("359152", 60000)).toBe(true);
    expect(new TotpStore(directory).consume("359152", 60000)).toBe(false);
    expect(store.consume("755224", 180000)).toBe(false);
    expect(statSync(join(directory, "totp.json")).mode & 0o777).toBe(0o600);
    expect(() => store.activate(secret, "359152", 60000)).toThrow("already enabled");
  });
  it("allows a single clock step and consumes each recovery code once without storing it in plaintext", () => {
    const store = new TotpStore(directory);
    const codes = store.activate(secret, "755224", 0);
    expect(store.consume("359152", 90000)).toBe(true);
    expect(readFileSync(join(directory, "totp.json"), "utf8")).not.toContain(codes[0]);
    expect(store.consume(codes[0].toLowerCase(), 90000)).toBe(true);
    expect(new TotpStore(directory).consume(codes[0], 90000)).toBe(false);
    expect(store.consume("not a recovery code", 90000)).toBe(false);
  });
  it("fails closed if activated credentials are missing or corrupt", () => {
    const store = new TotpStore(directory);
    store.activate(secret, "287082", 59000);
    unlinkSync(join(directory, "totp.json"));
    expect(() => new TotpStore(directory)).toThrow("missing");
    writeFileSync(join(directory, "totp.json"), "{}");
    expect(() => new TotpStore(directory)).toThrow("Invalid");
  });
  it("generates a local Google Authenticator URI with a unique 160-bit secret", () => {
    const store = new TotpStore(directory);
    const first = store.enrollment("fixture");
    expect(first.uri).toMatch(/^otpauth:\/\/totp\/Claw3D:fixture\?/);
    expect(first.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(store.enrollment("fixture").secret).not.toBe(first.secret);
  });
});
