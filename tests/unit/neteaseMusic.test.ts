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
      expect(biz.keyword).toBe("太空 宇宙 氛围 配乐");
      return response({ records: [{ id: "metal", name: "Space instrumental metal", tags: ["金属"] }, { id: "ambiguous", name: "Forest ambient" }, { id: "ambient", name: "Space instrumental ambient" }, { id: "score", name: "No vocals space soundtrack" }] });
    }
    if (url.includes("/lyric/")) return response({ pureMusic: true });
    expect(url).toContain("/playlist/song/list/get/v3"); expect(["metal", "ambiguous"]).not.toContain(biz.playlistId);
    return response([{ id: "vip", name: "Playable VIP", visible: true, playFlag: true, vipFlag: true, freeTrailFlag: true }, { id: "blocked", name: "Blocked", visible: false, playFlag: false }]);
  });
  const result = await f.music.recommendations({ scene: "deep-space" });
  expect(result.songs).toEqual([{ id: "vip", name: "Playable VIP", artists: "", album: "", playable: true }]);
  expect(result.playlists.map((p: { id: string }) => p.id)).toEqual(["ambient", "score"]);
});
it("filters daily recommendations by the current scene and checks lyrics before displaying them", async () => {
  const f = setup();
  f.fetchImpl.mockImplementation(async (url, init) => {
    if (url.includes("/recommend/songlist/")) return response([
      { id: "daily", name: "Space ambient", visible: true, playFlag: true, playUrl: "DO_NOT_FORWARD" },
      { id: "pop", name: "Space pop", playFlag: true },
      { id: "vocal", name: "Space ambient vocal song", playFlag: true },
      { id: "wrong-scene", name: "Rainforest soundscape", playFlag: true },
    ]);
    expect(url).toContain("/lyric/");
    const { songId } = JSON.parse(new URLSearchParams(init.body as URLSearchParams).get("bizContent")!);
    expect(["pop", "wrong-scene"]).not.toContain(songId);
    return response(songId === "vocal" ? { noLyric: true, lyric: "[00:01.00]I sing these words" } : { pureMusic: true });
  });
  expect(await f.music.recommendations({ source: "daily" })).toEqual({ songs: [{ id: "daily", name: "Space ambient", artists: "", album: "", playable: true }], playlists: [] });
});
it("does not replace an empty rainforest catalog with music from another galaxy", async () => {
  const f = setup();
  f.fetchImpl.mockImplementation(async (url, init) => {
    expect(url).toContain("/search/playlist/");
    const { keyword } = JSON.parse(new URLSearchParams(init.body as URLSearchParams).get("bizContent")!);
    expect(keyword).toMatch(/雨林|森林/);
    return response({ records: [{ id: "wrong", name: "Space ambient instrumental" }, { id: "jungle-dnb", name: "Jungle drum and bass" }] });
  });
  expect(await f.music.recommendations({ scene: "jade-nebula" })).toEqual({ songs: [], playlists: [] });
  expect(f.fetchImpl).toHaveBeenCalledTimes(2);
});
it("recommends verified nature recordings and quiet forest scores, not mechanical beats or songs in a misleading playlist", async () => {
  const f = setup();
  f.fetchImpl.mockImplementation(async (url, init) => {
    if (url.includes("/search/playlist/")) return response({ records: [{ id: "forest", name: "雨林 鸟鸣 自然环境声" }, { id: "rock", name: "森林摇滚纯音乐" }] });
    const biz = JSON.parse(new URLSearchParams(init.body as URLSearchParams).get("bizContent")!);
    if (url.includes("/playlist/song/")) {
      expect(biz.playlistId).toBe("forest");
      return response([{ id: "rain", name: "Rain in the forest" }, { id: "birds", name: "Birds and leaves" }, { id: "score", name: "Quiet exploration" }, { id: "sung", name: "回音沙漠" }, { id: "unknown", name: "Unconfirmed" }, { id: "beat", name: "10 Hz Alpha Forest" }, { id: "rock-song", name: "Rock anthem" }]);
    }
    expect(url).toContain("/lyric/");
    expect(["beat", "rock-song"]).not.toContain(biz.songId);
    return response(biz.songId === "unknown" ? {} : biz.songId === "sung" ? { pureMusic: true, lyric: { lyric: "[00:01.00]这是一句演唱歌词" } } : { pureMusic: true, lyric: "[99:00.00]纯音乐，请欣赏" });
  });
  const result = await f.music.recommendations({ scene: "jade-nebula" });
  expect(result.songs.map((song: { id: string }) => song.id)).toEqual(["rain", "birds", "score"]);
  expect(result.playlists.map((list: { id: string }) => list.id)).toEqual(["forest"]);
  // Playback reuses the recent verification, keeping continuous playback within the provider quota.
  const before = f.fetchImpl.mock.calls.length;
  f.fetchImpl.mockResolvedValueOnce(response({ playUrl: "https://audio.music.126.net/rain.mp3" }));
  await expect(f.music.track("rain", { instrumentalOnly: true })).resolves.toMatchObject({ url: "https://audio.music.126.net/rain.mp3" });
  expect(f.fetchImpl.mock.calls.length).toBe(before + 1);
});
it("uses the current scene when personal daily picks contain only pop", async () => {
  const f = setup();
  f.fetchImpl.mockImplementation(async url => {
    if (url.includes("/recommend/songlist/")) return response([{ id: "pop", name: "Popular song" }]);
    if (url.includes("/search/playlist/")) return response({ records: [{ id: "forest", name: "森林 自然 白噪音" }] });
    if (url.includes("/playlist/song/")) return response([{ id: "birds", name: "Birds" }]);
    return response({ pureMusic: true });
  });
  expect((await f.music.recommendations({ scene: "jade-nebula", source: "daily" })).songs).toMatchObject([{ id: "birds" }]);
});
it.each([{ pureMusic: true }, { pureMusic: false, noLyric: true }])("allows explicit instrumental metadata %j before requesting audio", async metadata => {
  const f = setup();
  f.fetchImpl.mockResolvedValueOnce(response(metadata)).mockResolvedValueOnce(response({ playUrl: "https://audio.music.126.net/song.mp3" }));
  expect(await f.music.track("song", { instrumentalOnly: true })).toMatchObject({ url: "https://audio.music.126.net/song.mp3" });
  expect(f.fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/openapi/music/basic/song/lyric/get/v2", "/openapi/music/basic/song/detail/get/v2"]);
});
it.each([{ pureMusic: false, noLyric: false }, { lyric: "" }, {}, { pureMusic: true, lyric: "[00:02]Sung words" }, { noLyric: true, lrc: { lyric: "[00:02]Sung words" } }, { pureMusic: true, txtLyric: "Sung words" }])("skips vocals or unconfirmed instrumental metadata %j without requesting audio", async metadata => {
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
