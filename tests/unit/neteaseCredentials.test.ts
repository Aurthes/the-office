import { afterEach, describe, expect, it } from "vitest";
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const { normalizeCredentials, saveCredentials } = createRequire(import.meta.url)("../../scripts/setup-netease-credentials.js");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const temporary: string[] = [];

function configRoot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "office-netease-test-"));
  temporary.push(directory);
  return directory;
}

function runPrompts(appIds: string[], keyInput = pem, pasteTogether = false) {
  const root = configRoot();
  const result = spawnSync(process.execPath, ["-e", `
    const fs = require("node:fs"), { PassThrough } = require("node:stream");
    const config = JSON.parse(fs.readFileSync(0, "utf8"));
    const input = new PassThrough();
    input.isTTY = true; input.setRawMode = () => {};
    Object.defineProperty(process, "stdin", { value: input });
    Object.defineProperty(process.stdout, "isTTY", { value: true });
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => {
      const result = write(chunk, ...args);
      if (String(chunk) === "appId: ") {
        const value = config.appIds.shift();
        if (value === undefined) throw new Error("Unexpected App ID prompt");
        setImmediate(() => input.write(value + "\\r" + (config.pasteTogether ? config.keyInput + "\\n" : "")));
      }
      if (String(chunk) === "privateKey: " && !config.pasteTogether) setImmediate(() => input.write(config.keyInput + "\\n"));
      return result;
    };
    require(config.script).main(config.root).catch(error => { console.error(error.message); process.exitCode = 1; });
  `], {
    input: JSON.stringify({ appIds, keyInput, pasteTogether, root, script: path.resolve("scripts/setup-netease-credentials.js") }),
    encoding: "utf8", timeout: 5000,
  });
  return { root, result };
}

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("NetEase local credential setup", () => {
  it("shows App ID while typing and before asking for the hidden private key", () => {
    const { root, result } = runPrompts(["test-visible-app"]);
    expect(result.status).toBe(0);
    expect(result.stdout.split("Using App ID:")[0]).toContain("test-visible-app");
    expect(result.stdout).toContain("Using App ID: test-visible-app");
    expect(result.stdout.indexOf("Using App ID:")).toBeLessThan(result.stdout.indexOf("privateKey: "));
    expect(result.stdout).not.toContain(pem.split("\n")[1]);
    expect(JSON.parse(fs.readFileSync(path.join(root, "the-office/netease/credentials.json"), "utf8")))
      .toEqual({ appId: "test-visible-app", privateKey: pem });
  });

  it("retries empty and spaced App IDs before asking for the private key", () => {
    const { result } = runPrompts(["", "bad app id", " corrected-app "]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("App ID is empty");
    expect(result.stdout).toContain("App ID contains spaces");
    expect(result.stdout).toContain("Using App ID: corrected-app");
    expect(result.stdout.match(/privateKey: /g)).toHaveLength(1);
  });

  it("does not echo private key lines pasted in the same input chunk as App ID", () => {
    const { result } = runPrompts(["batch-paste-app"], pem, true);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(pem.split("\n")[1]);
  });

  it("cancels from the private key prompt without saving", () => {
    const { root, result } = runPrompts(["cancel-app"], "\u0003");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cancelled. No credentials were saved.");
    expect(fs.existsSync(path.join(root, "the-office/netease/credentials.json"))).toBe(false);
  });

  it("accepts PEM, escaped PEM and both single-line RSA formats", () => {
    const variants = [pem, pem.replace(/\n/g, "\\n"), ...(["pkcs8", "pkcs1"] as const).map(
      (type) => privateKey.export({ format: "der", type }).toString("base64"),
    )];
    for (const variant of variants) {
      const result = normalizeCredentials(" test-app ", variant);
      expect(result.appId).toBe("test-app");
      expect(createPublicKey(createPrivateKey(result.privateKey)).export({ format: "pem", type: "spki" }))
        .toBe(publicKey.export({ format: "pem", type: "spki" }));
    }
  });

  it("rejects bad inputs and public keys without repeating the input", () => {
    for (const value of ["SECRET-invalid-key", publicKey.export({ format: "pem", type: "spki" }).toString()]) {
      expect(() => normalizeCredentials("app", value)).toThrow("Invalid RSA privateKey.");
      try { normalizeCredentials("app", value); } catch (error) {
        expect((error as Error).message).not.toContain(value);
      }
    }
    expect(() => normalizeCredentials("", pem)).toThrow("App ID is empty");
    expect(() => normalizeCredentials("app id", pem)).toThrow("App ID contains spaces");
  });

  it("saves only app credentials with private directory and file permissions", () => {
    const root = configRoot();
    const saved = saveCredentials(root, "test-app", pem);
    expect(saved).toBe(path.join(root, "the-office", "netease", "credentials.json"));
    expect(JSON.parse(fs.readFileSync(saved, "utf8"))).toEqual({ appId: "test-app", privateKey: pem });
    expect(fs.statSync(saved).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(saved)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(root, "the-office")).mode & 0o777).toBe(0o700);
    expect(fs.readdirSync(path.dirname(saved))).toEqual(["credentials.json"]);
  });

  it("preserves existing files and removes its temporary file on refusal", () => {
    const root = configRoot();
    const saved = saveCredentials(root, "first-app", pem);
    const before = fs.readFileSync(saved, "utf8");
    expect(() => saveCredentials(root, "second-app", pem)).toThrow();
    expect(fs.readFileSync(saved, "utf8")).toBe(before);
    expect(fs.readdirSync(path.dirname(saved))).toEqual(["credentials.json"]);
  });

  it("refuses redirected directories and never overwrites a symlink target", () => {
    const root = configRoot();
    const elsewhere = configRoot();
    fs.symlinkSync(elsewhere, path.join(root, "the-office"));
    expect(() => saveCredentials(root, "app", pem)).toThrow("real directories");
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    fs.unlinkSync(path.join(root, "the-office"));
    const saved = saveCredentials(root, "app", pem);
    fs.unlinkSync(saved);
    const target = path.join(elsewhere, "existing.txt");
    fs.writeFileSync(target, "leave this alone");
    fs.symlinkSync(target, saved);
    expect(() => saveCredentials(root, "app", pem)).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("leave this alone");
  });

  it("refuses piped secrets and command-line arguments without echoing them", () => {
    const script = path.resolve("scripts/setup-netease-credentials.js");
    const piped = spawnSync(process.execPath, [script], { input: "SECRET-piped-value\n", encoding: "utf8" });
    expect(piped.status).toBe(1);
    expect(piped.stderr).toContain("interactive terminal");
    expect(piped.stdout + piped.stderr).not.toContain("SECRET-piped-value");
    const args = spawnSync(process.execPath, [script, "SECRET-argument-value"], { encoding: "utf8" });
    expect(args.status).toBe(1);
    expect(args.stdout + args.stderr).not.toContain("SECRET-argument-value");
  });
});
