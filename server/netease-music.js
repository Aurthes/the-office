"use strict";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const QRCode = require("qrcode");

// Scenes describe a place to inhabit, rather than a genre or a song title.
const SCENE_PROFILES = {
  "deep-space": { queries: ["太空 宇宙 氛围 配乐", "space ambient cinematic instrumental"], match: /太空|宇宙|星际|银河|深空|space|cosmic|interstellar/i },
  "blue-nebula": { queries: ["冰川 极地 氛围 纯音乐", "arctic glacier ambient soundscape"], match: /冰川|极地|冰雪|雪原|冰原|glacier|arctic|polar|frost|ice/i },
  "amber-nebula": { queries: ["沙漠 风声 氛围 配乐", "desert ambient soundscape"], match: /沙漠|荒漠|沙丘|desert|dune/i },
  "jade-nebula": { queries: ["热带雨林 自然 白噪音", "森林 鸟鸣 氛围 纯音乐"], match: /雨林|森林|丛林|林间|鸟鸣|自然|rainforest|forest|jungle|nature|wildlife/i },
  "violet-rift": { queries: ["异星 神秘 科幻 氛围 配乐", "mysterious sci-fi ambient soundtrack"], match: /异星|神秘|科幻|裂隙|sci.?fi|myster|rift|void/i },
  "black-hole": { queries: ["黑洞 深空 暗黑 氛围 配乐", "dark space ambient soundtrack"], match: /黑洞|深空|暗黑|黑暗|black.?hole|dark|space|cosmic/i },
};
const AMBIENCE = /氛围|环境|声景|音景|白噪|自然|实录|电影|影视|游戏|配乐|原声|ambient|soundscape|field.?recording|nature|cinematic|soundtrack|score/i;
const UNSUITABLE_STYLE = /摇滚|金属|说唱|流行|舞曲|劲爆|蹦迪|电音|鼓打贝斯|双耳节拍|机械|\b(metal|rock|rap|dance|pop|DJ|EDM|dnb|binaural)\b|\b\d+(?:\.\d+)?\s*hz\b|hip.?hop|k.?pop|drum.?and.?bass/i;
const description = item => [item.name, item.album?.name || item.albumName, ...(item.tags || [])].filter(Boolean).join(" ");
const backgroundStyle = item => !UNSUITABLE_STYLE.test(description(item));
function hasSungLyrics(data) {
  const texts = [data?.lyric, data?.lyric?.lyric, data?.lrc?.lyric, data?.txtLyric].filter(value => typeof value === "string");
  return texts.some(text => text.split(/\r?\n/).some(line => {
    const content = line.replace(/\[[^\]]*\]/g, "").trim();
    return content && !/^(纯音乐|此歌曲为没有填词的纯音乐|instrumental|no lyrics|作词|作曲|编曲|制作|音乐|混音|母带|录音|出品|发行|词[：:]|曲[：:]|lyrics?\s*[:：]|compos|arrang|produc|copyright)/i.test(content);
  }));
}
const songView = song => ({ id: song.id, name: song.name, artists: (song.artists?.length ? song.artists : song.fullArtists || []).map(artist => artist.name).filter(Boolean).join(" / "), album: song.album?.name || song.albumName || "", playable: song.visible !== false && song.playFlag !== false });

function musicError(message, status = 502, code = "MUSIC_UNAVAILABLE") {
  return Object.assign(new Error(message), { publicMessage: message, status, code });
}

function createNeteaseMusic({ directory = path.join(os.homedir(), ".config/the-office/netease"), fetchImpl = fetch, now = Date.now } = {}) {
  let refreshing = null;
  const backgroundChecks = new Map();
  async function read(name) {
    try { return JSON.parse(await fs.readFile(path.join(directory, name), "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") return null;
      throw musicError("Could not read the NetEase configuration.", 500);
    }
  }
  async function save(name, value) {
    const temporary = path.join(directory, `.${name}-${crypto.randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, path.join(directory, name));
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  async function credentials() {
    const value = await read("credentials.json");
    if (!value?.appId || !value.privateKey) return null;
    try { crypto.createPrivateKey(value.privateKey); }
    catch { throw musicError("The NetEase private key is invalid.", 503, "SETUP_REQUIRED"); }
    return value;
  }
  async function requireCredentials() {
    const value = await credentials();
    if (!value) throw musicError("NetEase developer credentials are not configured.", 503, "SETUP_REQUIRED");
    return value;
  }
  function device(appId) {
    // Personal developer apps use the descriptors from @music163/ncm-cli 0.1.7.
    return { deviceType: "openapi", os: "ncmcli", appVer: "0.1.7", channel: "ncmcli", brand: "ncmcli", model: "the-office", osVer: os.release(), clientIp: "127.0.0.1",
      deviceId: crypto.createHash("sha256").update("the-office-netease-local:" + appId).digest("hex") };
  }
  async function request(app, endpoint, business, clientDevice, token) {
    const params = { appId: app.appId, signType: "RSA_SHA256", timestamp: String(now()), device: JSON.stringify(clientDevice), bizContent: JSON.stringify(business), ...(token ? { accessToken: token } : {}) };
    const content = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join("&");
    try { params.sign = crypto.sign("RSA-SHA256", Buffer.from(content), app.privateKey).toString("base64"); }
    catch { throw musicError("The NetEase private key is invalid.", 503, "SETUP_REQUIRED"); }
    let result;
    try {
      const response = await fetchImpl("https://openapi.music.163.com" + endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      result = await response.json();
    } catch { throw musicError("Could not reach NetEase. Please retry."); }
    if (Number(result.code) !== 200) {
      if ([301, 1406, 1407, 1408].includes(Number(result.code))) throw musicError("Sign in to NetEase again.", 401, "AUTH_REQUIRED");
      let message = typeof result.message === "string" && result.message ? result.message.slice(0, 300) : "NetEase could not complete this request.";
      if (token) message = message.split(token).join("[redacted]");
      throw musicError(message, [-444, -445, -446].includes(Number(result.code)) ? 429 : 502);
    }
    return result.data;
  }
  async function authorization(app) {
    const auth = await read("authorization.json");
    if (!auth || auth.appId !== app.appId || !auth.accessToken || !auth.device) return null;
    if (auth.expiresAt > now() + 30000) return auth;
    if (!auth.refreshToken) return null;
    if (!refreshing) refreshing = (async () => {
      try {
        const data = await request(app, "/openapi/music/basic/user/oauth2/token/refresh/v2", { clientId: app.appId, clientSecret: "", refreshToken: auth.refreshToken }, auth.device, auth.accessToken);
        if (!data?.accessToken) return null;
        const updated = { ...auth, accessToken: data.accessToken, refreshToken: data.refreshToken || auth.refreshToken, expiresAt: now() + Number(data.expiresTime || data.expireTime || 86400) * 1000 };
        await save("authorization.json", updated); return updated;
      } catch (error) { if (error.code === "AUTH_REQUIRED") return null; throw error; }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function session() {
    const app = await requireCredentials(), auth = await authorization(app);
    if (!auth) throw musicError("Sign in to NetEase to listen.", 401, "AUTH_REQUIRED");
    return { app, auth };
  }
  async function status() {
    const app = await credentials();
    return { configured: Boolean(app), authorized: Boolean(app && await authorization(app)) };
  }
  async function search(query) {
    if (typeof query !== "string" || !query.trim() || query.length > 200) throw musicError("Enter a song or artist name.", 400);
    const { app, auth } = await session();
    const data = await request(app, "/openapi/music/basic/search/song/get/v3", { keyword: query.trim(), limit: 20, offset: 0 }, auth.device, auth.accessToken);
    return { songs: (data?.records || []).map(songView) };
  }
  async function isBackground(songId, app, auth) {
    const cached = backgroundChecks.get(songId);
    if (cached && cached.expiresAt > now()) return cached.allowed;
    const data = await request(app, "/openapi/music/basic/song/lyric/get/v2", { songId }, auth.device, auth.accessToken);
    // An explicit flag is required; missing lyrics alone do not establish a soundscape.
    // Actual lyrics override a contradictory flag. Wordless/ambient voices are fine.
    const allowed = (data?.pureMusic === true || data?.noLyric === true) && !hasSungLyrics(data);
    if (backgroundChecks.size >= 512) backgroundChecks.delete(backgroundChecks.keys().next().value);
    backgroundChecks.set(songId, { allowed, expiresAt: now() + 300000 });
    return allowed;
  }
  async function backgroundSongs(records, app, auth) {
    const candidates = [...new Map(records.filter(song => song.visible !== false && song.playFlag !== false && backgroundStyle(song)).map(song => [song.id, song])).values()].slice(0, 24);
    const accepted = [];
    // Bound provider requests and check before showing a recommendation, not only at play time.
    for (let index = 0; index < candidates.length && accepted.length < 12; index += 4) {
      const group = candidates.slice(index, index + 4);
      const checks = await Promise.all(group.map(song => isBackground(song.id, app, auth)));
      accepted.push(...group.filter((_, item) => checks[item]).map(songView));
    }
    return accepted.slice(0, 12);
  }
  async function recommendations({ scene = "deep-space", source = "scene", batch = 0 } = {}) {
    const { app, auth } = await session();
    const call = (endpoint, business) => request(app, endpoint, business, auth.device, auth.accessToken);
    const profile = Object.hasOwn(SCENE_PROFILES, scene) ? SCENE_PROFILES[scene] : SCENE_PROFILES["deep-space"];
    if (source === "daily") {
      const data = await call("/openapi/music/basic/recommend/songlist/get/v2", { limit: 30 });
      const candidates = (Array.isArray(data) ? data : data?.records || []).filter(song => profile.match.test(description(song)) && AMBIENCE.test(description(song)));
      const songs = await backgroundSongs(candidates, app, auth);
      if (songs.length) return { songs, playlists: [] };
      // Account taste must not replace the current setting with pop when no daily soundscapes fit.
    }
    const page = Math.trunc(Math.max(0, Math.min(10000, Number(batch) || 0)));
    for (const keyword of profile.queries) {
      const found = await call("/openapi/music/basic/search/playlist/get/v2", { keyword, limit: 10, offset: 0 });
      const playlists = (found?.records || []).filter(list => profile.match.test(description(list)) && AMBIENCE.test(description(list)) && backgroundStyle(list));
      const start = (page * 2) % (playlists.length || 1);
      const chosen = playlists.length ? [playlists[start], playlists[(start + 1) % playlists.length]].filter((list, index, all) => all.findIndex(item => item.id === list.id) === index) : [];
      const lists = await Promise.all(chosen.map(async list => {
        const data = await call("/openapi/music/basic/playlist/song/list/get/v3", { playlistId: list.id, limit: 60, offset: 0 });
        const songs = Array.isArray(data) ? data : data?.records || [];
        const offset = (page * 12) % (songs.length || 1);
        return [...songs.slice(offset), ...songs.slice(0, offset)];
      }));
      const songs = await backgroundSongs(lists.flat(), app, auth);
      if (songs.length) return { songs, playlists: chosen.map(list => ({ id: list.id, name: list.name })) };
    }
    // Silence is preferable to switching to unrelated music from another scene.
    return { songs: [], playlists: [] };
  }
  async function track(songId, { instrumentalOnly = false } = {}) {
    if (typeof songId !== "string" || !songId || songId.length > 128) throw musicError("Choose a song to play.", 400);
    const { app, auth } = await session();
    if (instrumentalOnly && !await isBackground(songId, app, auth)) throw musicError("This track is not marked as instrumental.", 403, "NOT_INSTRUMENTAL");
    // Personal apps receive audio through song detail; the standalone playurl API may be unavailable.
    const data = await request(app, "/openapi/music/basic/song/detail/get/v2", { songId, withUrl: true, bitrate: 128 }, auth.device, auth.accessToken);
    if (instrumentalOnly && !backgroundStyle(data || {})) throw musicError("This track is not marked as instrumental.", 403, "NOT_INSTRUMENTAL");
    let url;
    try { url = new URL(data?.playUrl); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); url.protocol = "https:"; }
    catch { throw musicError("This song is not available in this player.", 403, "TRACK_UNAVAILABLE"); }
    const preview = data.freeTrail;
    return { url: url.href, preview: preview && Number(preview.end) > Number(preview.start) ? { start: Number(preview.start), end: Number(preview.end) } : null };
  }
  async function loginView(pending) {
    return { state: "waiting", url: pending.qrCodeUrl, qrCode: await QRCode.toDataURL(pending.qrCodeUrl, { width: 224, margin: 1 }), expiresAt: pending.expiresAt };
  }
  async function startLogin() {
    const app = await requireCredentials(), pending = await read("pending-authorization.json");
    if (pending?.appId === app.appId && pending.expiresAt > now() + 15000) return loginView(pending);
    const prior = await read("authorization.json"), clientDevice = prior?.appId === app.appId && prior.device ? prior.device : device(app.appId);
    const anonymous = await request(app, "/openapi/music/basic/oauth2/login/anonymous", { clientId: app.appId }, clientDevice);
    const qr = await request(app, "/openapi/music/basic/user/oauth2/qrcodekey/get/v2", { type: 2, expiredKey: "300" }, clientDevice, anonymous?.accessToken);
    if (!anonymous?.accessToken || !qr?.uniKey || !/^https:\/\//.test(qr.qrCodeUrl)) throw musicError("Could not create a NetEase login code.");
    const value = { appId: app.appId, device: clientDevice, anonymousToken: anonymous.accessToken, uniKey: qr.uniKey, qrCodeUrl: qr.qrCodeUrl, expiresAt: now() + 300000 };
    await save("pending-authorization.json", value); return loginView(value);
  }
  async function clearPending(key) {
    if ((await read("pending-authorization.json"))?.uniKey === key) await fs.unlink(path.join(directory, "pending-authorization.json")).catch(() => {});
  }
  async function pollLogin() {
    const app = await requireCredentials(), pending = await read("pending-authorization.json");
    if (!pending || pending.appId !== app.appId) return { state: await authorization(app) ? "authorized" : "expired" };
    if (pending.expiresAt <= now()) { await clearPending(pending.uniKey); return { state: "expired" }; }
    const data = await request(app, "/openapi/music/basic/oauth2/device/login/qrcode/get", { key: pending.uniKey, clientId: app.appId }, pending.device, pending.anonymousToken);
    if (data?.status === 803 && data.accessToken?.accessToken && data.accessToken.accessToken !== "null") {
      const token = data.accessToken;
      await save("authorization.json", { appId: app.appId, device: pending.device, accessToken: token.accessToken, refreshToken: token.refreshToken, createdAt: now(), expiresAt: now() + Number(token.expireTime || 86400) * 1000 });
      await clearPending(pending.uniKey); return { state: "authorized" };
    }
    if (data?.status === 800) { await clearPending(pending.uniKey); return { state: "expired" }; }
    if (![801, 802].includes(data?.status)) throw musicError("NetEase sign-in failed. Please retry.");
    return { state: data.status === 802 ? "confirm" : "waiting" };
  }
  return { status, search, recommendations, track, startLogin, pollLogin };
}
module.exports = { createNeteaseMusic };
