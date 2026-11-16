import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { createOfficeVoicePreviews, previewURL } = createRequire(import.meta.url)("../../server/office-voice-previews.js");
let home: string;
const pending: { close: () => Promise<void> }[] = [];
const sample = (name: string) => `https://persistent.oaistatic.com/voice/previews/${name}.en.fixture.m4a`;
const native = ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol", "cove", "aube", "bubbie", "haetsal", "hanul", "himari", "leher", "miko", "neer", "porto", "rindo", "rio", "rivage", "selva", "sonna", "tinta", "viola"];
const aliases: Record<string, string> = { arbor: "fathom", sol: "glimmer", spruce: "orbit" };
const catalog = native.filter(name => !["porto", "selva"].includes(name)).map(name => ({ voice: aliases[name] || name, preview_url: sample(aliases[name] || name) }));
const login = (token: string) => fs.writeFileSync(path.join(home, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: token, account_id: "fixture-account" } }));
const response = (voices: unknown[]) => new Response(JSON.stringify({ voices }), { headers: { "content-type": "application/json" } });
function setup(fetchImpl = vi.fn(async () => response(catalog)), refreshAuth?: () => Promise<void>) {
  const dispatcher = { close: vi.fn(async () => {}) }, readVoices = vi.fn(async () => native);
  const service = createOfficeVoicePreviews({ home, readVoices, fetchImpl, refreshAuth, dispatcherFactory: () => dispatcher });
  pending.push(service); return { service, fetchImpl, dispatcher, readVoices };
}
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "office-voice-previews-")); login("fixture-token"); });
afterEach(async () => { await Promise.all(pending.splice(0).map(service => service.close())); fs.rmSync(home, { recursive: true, force: true }); vi.unstubAllEnvs(); });
it("returns only exact native intersections with explicit aliases and leaves default/unknown voices unmapped", async () => {
  const { service, fetchImpl } = setup(); const result = await service.read({ language: "zh" });
  expect(result.language).toBe("zh"); expect(result.previews).toHaveLength(23); expect(result.unavailable).toEqual(["porto", "selva"]);
  expect(result.previews.find((p: { voice: string }) => p.voice === "arbor")).toEqual({ voice: "arbor", url: sample("fathom"), language: "en" });
  expect(result.previews.some((p: { voice: string }) => ["", "default", "faro", "arrullo"].includes(p.voice))).toBe(false);
  expect(fetchImpl).toHaveBeenCalledOnce();
  const [url, options] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://chatgpt.com/backend-api/settings/voices?voice_mode=wingman&spoken_language=zh"); expect(options.method).toBe("GET"); expect(options.redirect).toBe("error");
  expect(JSON.stringify(result)).not.toContain("fixture-token"); expect(JSON.stringify(result)).not.toContain("fixture-account");
});
it.each(["http://persistent.oaistatic.com/voice/previews/test.m4a", "https://evil.example/voice/previews/test.m4a", "https://persistent.oaistatic.com.evil.example/voice/previews/test.m4a", "https://secret@persistent.oaistatic.com/voice/previews/test.m4a", "https://persistent.oaistatic.com/voice/previews/test.m4a?token=secret", "https://persistent.oaistatic.com/voice/previews/%2e%2e/secret.m4a", "file:///tmp/test.m4a"])("rejects untrusted or credential-bearing sample URL: %s", value => { expect(previewURL(value)).toBeNull(); });
it("ignores extra catalog voices, unsafe samples and conflicting aliases without guessing another sound", async () => {
  const rows = [...catalog, { voice: "faro", preview_url: sample("faro") }, { voice: "arrullo", preview_url: sample("arrullo") }, { voice: "arbor", preview_url: sample("different") }, { voice: "porto", preview_url: "https://evil.example/test.m4a" }];
  const { service } = setup(vi.fn(async () => response(rows))); const result = await service.read();
  expect(result.unavailable).toEqual(["arbor", "porto", "selva"]); expect(result.previews).toHaveLength(22);
});
it("uses only the Office subscription credential, never an unrelated API key or another auth home", async () => {
  vi.stubEnv("OPENAI_API_KEY", "unrelated-api-key"); fs.unlinkSync(path.join(home, "auth.json")); const { service, fetchImpl } = setup();
  await expect(service.read()).rejects.toThrow("Sign in with ChatGPT"); expect(fetchImpl).not.toHaveBeenCalled();
  fs.writeFileSync(path.join(home, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "wrong" })); await expect(service.read()).rejects.toThrow("Sign in with ChatGPT");
});
it("renews once through the existing Office callback on a 401, not through a new login flow", async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("denied", { status: 401 })).mockResolvedValueOnce(response(catalog));
  const refreshAuth = vi.fn(async () => login("renewed-fixture-token")); const { service } = setup(fetchImpl, refreshAuth); await service.read();
  expect(refreshAuth).toHaveBeenCalledOnce(); expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer renewed-fixture-token"); expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it("does not pin old account credentials or catalog URLs in a persisted cache", async () => {
  const { service, fetchImpl } = setup(); await service.read(); login("second-account-token"); await service.read();
  const calls = vi.mocked(fetchImpl).mock.calls as unknown as [string, { headers: { Authorization: string } }][];
  expect(calls[0][1].headers.Authorization).toBe("Bearer fixture-token"); expect(calls[1][1].headers.Authorization).toBe("Bearer second-account-token");
});
it("bounds response bytes, sanitizes failures and refuses arbitrary request languages before network calls", async () => {
  const fetchImpl = vi.fn(async () => new Response("x".repeat(512 * 1024 + 1), { headers: { "content-type": "application/json" } })); const { service } = setup(fetchImpl);
  await expect(service.read({ language: "https://evil.example" })).rejects.toThrow("Unsupported"); expect(fetchImpl).not.toHaveBeenCalled();
  await expect(service.read()).rejects.toThrow("Official voice previews are temporarily unavailable");
});
it("does not leak transport errors or use authenticated sample-download proxying", async () => {
  const { service, fetchImpl } = setup(vi.fn(async () => { throw new Error("fixture-secret-cookie"); }));
  await expect(service.read()).rejects.not.toThrow("fixture-secret-cookie"); expect(fetchImpl).toHaveBeenCalledOnce();
});
