import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const { createNeteaseMusic } = createRequire(import.meta.url)("../../server/netease-music");
const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
const privateKey = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const response = (data: unknown, code = 200, message = "") => ({ ok: true, json: async () => ({ code, data, message }) });
function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "office-music-test-")); roots.push(directory);
  const write = (name: string, value: unknown) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value), { mode: 0o600 });
  write("credentials.json", { appId: "test-app", privateKey });
  const auth = { appId: "test-app", device: { deviceId: "test-device", channel: "ncmcli" }, accessToken: "ACCOUNT_TOKEN_SECRET", refreshToken: "REFRESH_TOKEN_SECRET", expiresAt: Date.now() + 1000000 };
  write("authorization.json", auth);
  const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<ReturnType<typeof response>>>(async () => response({}));
  return { directory, write, auth, fetchImpl, music: createNeteaseMusic({ directory, fetchImpl }) };
}
it("reports configuration without returning credentials or contacting NetEase", async () => {
  const f = setup();
  expect(await f.music.status()).toEqual({ configured: true, authorized: true });
  expect(f.fetchImpl).not.toHaveBeenCalled();
  fs.unlinkSync(path.join(f.directory, "authorization.json"));
  expect(await f.music.status()).toEqual({ configured: true, authorized: false });
  fs.unlinkSync(path.join(f.directory, "credentials.json"));
  expect(await f.music.status()).toEqual({ configured: false, authorized: false });
});
it("signs official search requests and returns only song metadata", async () => {
  const f = setup();
  f.fetchImpl.mockImplementationOnce(async (url, init) => {
    expect(new URL(url).pathname).toBe("/openapi/music/basic/search/song/get/v3");
    const params = Object.fromEntries(new URLSearchParams(init.body as URLSearchParams));
    const signature = params.sign; delete params.sign;
    expect(crypto.verify("RSA-SHA256", Buffer.from(Object.keys(params).sort().map(key => `${key}=${params[key]}`).join("&")), pair.publicKey, Buffer.from(signature, "base64"))).toBe(true);
    expect(JSON.parse(params.bizContent)).toMatchObject({ keyword: "纯音乐", limit: 20 });
    expect(params.accessToken).toBe(f.auth.accessToken);
    return response({ accessToken: "DO_NOT_FORWARD", records: [{ id: "song-1", name: "Song", artists: [{ name: "Artist" }], album: { name: "Album" }, visible: true, playFlag: true }, { id: "song-2", name: "Unavailable", visible: false, playFlag: false }] });
  });
  expect(await f.music.search(" 纯音乐 ")).toEqual({ songs: [{ id: "song-1", name: "Song", artists: "Artist", album: "Album", playable: true }, { id: "song-2", name: "Unavailable", artists: "", album: "", playable: false }] });
});
it("uses song detail for personal apps, upgrades audio to HTTPS and preserves previews", async () => {
  const f = setup();
  f.fetchImpl.mockImplementationOnce(async (url, init) => {
    expect(new URL(url).pathname).toBe("/openapi/music/basic/song/detail/get/v2");
    expect(JSON.parse(new URLSearchParams(init.body as URLSearchParams).get("bizContent")!)).toEqual({ songId: "song-1", withUrl: true, bitrate: 128 });
    return response({ playUrl: "http://audio.music.126.net/song.mp3", freeTrail: { start: 10, end: 40 }, accessToken: "DO_NOT_FORWARD" });
  });
  expect(await f.music.track("song-1")).toEqual({ url: "https://audio.music.126.net/song.mp3", preview: { start: 10, end: 40 } });
});
it("builds a scene mix from fitting playlists, removes unavailable tracks and keeps playable VIP songs", async () => {
  const f = setup();
  f.fetchImpl.mockImplementation(async (url, init) => {
    const biz = JSON.parse(new URLSearchParams(init.body as URLSearchParams).get("bizContent")!);
    if (url.includes("/search/playlist/")) {
      expect(biz.keyword).toBe("太空 纯音乐");
      return response({ records: [{ id: "metal", name: "Space instrumental metal", tags: ["金属"] }, { id: "ambiguous", name: "Space soundtrack" }, { id: "ambient", name: "Space instrumental ambient" }, { id: "score", name: "No vocals space soundtrack" }] });
    }
    expect(url).toContain("/playlist/song/list/get/v3"); expect(["metal", "ambiguous"]).not.toContain(biz.playlistId);
    return response([{ id: "vip", name: "Playable VIP", visible: true, playFlag: true, vipFlag: true, freeTrailFlag: true }, { id: "blocked", name: "Blocked", visible: false, playFlag: false }]);
  });
  const result = await f.music.recommendations({ scene: "deep-space" });
  expect(result.songs).toEqual([{ id: "vip", name: "Playable VIP", artists: "", album: "", playable: true }]);
  expect(result.playlists.map((p: { id: string }) => p.id)).toEqual(["ambient", "score"]);
});
it("uses official daily recommendations and filters their array response without leaking playback URLs", async () => {
  const f = setup();
  f.fetchImpl.mockImplementationOnce(async url => {
    expect(url).toContain("/recommend/songlist/get/v2");
    return response([{ id: "daily", name: "Daily song", visible: true, playFlag: true, playUrl: "DO_NOT_FORWARD" }, { id: "blocked", name: "Blocked", playFlag: false }]);
  });
  expect(await f.music.recommendations({ source: "daily" })).toEqual({ songs: [{ id: "daily", name: "Daily song", artists: "", album: "", playable: true }], playlists: [] });
});
it("falls back to space ambient when a scene's matching playlists have no playable songs", async () => {
  const f = setup();
  f.fetchImpl.mockImplementation(async (url, init) => {
    const biz = JSON.parse(new URLSearchParams(init.body as URLSearchParams).get("bizContent")!);
    if (url.includes("/search/playlist/")) return response({ records: [{ id: biz.keyword === "desert ambient instrumental" ? "empty" : "space", name: biz.keyword }] });
    return response(biz.playlistId === "space" ? [{ id: "song", name: "Ambient", playFlag: true }] : []);
  });
  expect((await f.music.recommendations({ scene: "amber-nebula" })).songs).toMatchObject([{ name: "Ambient", playable: true }]);
  expect(f.fetchImpl).toHaveBeenCalledTimes(4);
});
it.each([{ pureMusic: true }, { pureMusic: false, noLyric: true }])("allows explicit instrumental metadata %j before requesting audio", async metadata => {
  const f = setup();
  f.fetchImpl.mockResolvedValueOnce(response(metadata)).mockResolvedValueOnce(response({ playUrl: "https://audio.music.126.net/song.mp3" }));
  expect(await f.music.track("song", { instrumentalOnly: true })).toMatchObject({ url: "https://audio.music.126.net/song.mp3" });
  expect(f.fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/openapi/music/basic/song/lyric/get/v2", "/openapi/music/basic/song/detail/get/v2"]);
});
it.each([{ pureMusic: false, noLyric: false }, { lyric: "" }, {}])("skips vocals or unconfirmed instrumental metadata %j without requesting audio", async metadata => {
  const f = setup(); f.fetchImpl.mockResolvedValueOnce(response(metadata));
  await expect(f.music.track("song", { instrumentalOnly: true })).rejects.toMatchObject({ status: 403, code: "NOT_INSTRUMENTAL" });
  expect(f.fetchImpl).toHaveBeenCalledOnce();
});
it("reports missing audio and authorization failures without exposing tokens", async () => {
  const f = setup();
  f.fetchImpl.mockResolvedValueOnce(response({ playUrl: null }));
  await expect(f.music.track("song")).rejects.toMatchObject({ status: 403, code: "TRACK_UNAVAILABLE", publicMessage: "This song is not available in this player." });
  f.fetchImpl.mockResolvedValueOnce(response(null, 1408, f.auth.accessToken));
  await expect(f.music.search("song")).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED", publicMessage: "Sign in to NetEase again." });
  f.fetchImpl.mockResolvedValueOnce(response(null, 500, "Failed with " + f.auth.accessToken));
  await expect(f.music.search("song")).rejects.toMatchObject({ publicMessage: "Failed with [redacted]" });
});
it("refreshes expired tokens once for concurrent requests and saves a complete private record", async () => {
  const f = setup(); f.write("authorization.json", { ...f.auth, expiresAt: 0 });
  f.fetchImpl.mockImplementation(async url => {
    expect(new URL(url).pathname).toBe("/openapi/music/basic/user/oauth2/token/refresh/v2");
    await new Promise(resolve => setTimeout(resolve, 20));
    return response({ accessToken: "NEW_TOKEN", refreshToken: "NEW_REFRESH", expiresTime: 86400 });
  });
  expect(await Promise.all([f.music.status(), f.music.status()])).toEqual([{ configured: true, authorized: true }, { configured: true, authorized: true }]);
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  const file = path.join(f.directory, "authorization.json");
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ accessToken: "NEW_TOKEN", refreshToken: "NEW_REFRESH", device: f.auth.device });
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
});
it("creates a QR and saves account tokens only after authorization", async () => {
  const f = setup(); fs.unlinkSync(path.join(f.directory, "authorization.json"));
  f.fetchImpl.mockResolvedValueOnce(response({ accessToken: "ANONYMOUS_SECRET" })).mockResolvedValueOnce(response({ uniKey: "QR_KEY", qrCodeUrl: "https://163cn.tv/test-login" }));
  const login = await f.music.startLogin();
  expect(login).toMatchObject({ state: "waiting", url: "https://163cn.tv/test-login", qrCode: expect.stringContaining("data:image/png;base64,") });
  expect(JSON.stringify(login)).not.toMatch(/ANONYMOUS_SECRET|QR_KEY|PRIVATE KEY/);
  expect(fs.statSync(path.join(f.directory, "pending-authorization.json")).mode & 0o777).toBe(0o600);
  f.fetchImpl.mockResolvedValueOnce(response({ status: 802 }));
  expect(await f.music.pollLogin()).toEqual({ state: "confirm" });
  expect(fs.existsSync(path.join(f.directory, "authorization.json"))).toBe(false);
  f.fetchImpl.mockImplementationOnce(async (_url, init) => {
    expect(new URLSearchParams(init.body as URLSearchParams).get("accessToken")).toBe("ANONYMOUS_SECRET");
    return response({ status: 803, accessToken: { accessToken: "ACCOUNT_SECRET", refreshToken: "REFRESH_SECRET", expireTime: 86400 } });
  });
  expect(await f.music.pollLogin()).toEqual({ state: "authorized" });
  expect(await f.music.status()).toEqual({ configured: true, authorized: true });
  expect(fs.existsSync(path.join(f.directory, "pending-authorization.json"))).toBe(false);
  expect(fs.statSync(path.join(f.directory, "authorization.json")).mode & 0o777).toBe(0o600);
});
it("expires old QR codes without repeatedly calling NetEase", async () => {
  const f = setup(); f.write("pending-authorization.json", { appId: "test-app", uniKey: "expired", expiresAt: 0 });
  expect(await f.music.pollLogin()).toEqual({ state: "expired" });
  expect(f.fetchImpl).not.toHaveBeenCalled();
});
