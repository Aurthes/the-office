const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const httpProxy = require("http-proxy");
const { SqliteSessionStore } = require("./session-store");
const { TotpStore } = require("./totp-store");
const { PasswordStore } = require("./password-store");
const { loginView, enrollmentView, recoveryView, passwordSetupView } = require("./views");
const { createRequestPolicy, PROXY_HEADER } = require("../proxy-boundary");

const WEEK = 7 * 24 * 60 * 60 * 1000;
const digest = value => crypto.createHash("sha256").update(String(value || "")).digest();
const equal = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

function createWebAccessServer({ dataDir, credentials, upstream = "http://127.0.0.1:3033", secureCookies = true, requireTotp = false, proxyToken = "", publicOrigins = [] }) {
  const target = new URL(upstream);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1") throw new Error("The office upstream must be loopback HTTP");
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const passwords = new PasswordStore(dataDir, credentials);
  const secretFile = path.join(dataDir, "session-secret");
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48).toString("base64url"), { mode: 0o600, flag: "wx" });
  const cookieName = secureCookies ? "__Host-claw3d_session" : "claw3d_session_test";
  const store = new SqliteSessionStore(path.join(dataDir, "sessions.sqlite"));
  const totp = new TotpStore(dataDir);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  const sessionMiddleware = session({
    name: cookieName, secret: fs.readFileSync(secretFile, "utf8"), store,
    resave: false, saveUninitialized: false,
    cookie: { path: "/", httpOnly: true, secure: secureCookies, sameSite: "lax", maxAge: 10 * 60 * 1000 },
  });
  const sockets = new Map();
  const template = fs.readFileSync(path.join(__dirname, "login.html"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "login.css"), "utf8");
  const clientScript = fs.readFileSync(path.join(__dirname, "login.js"), "utf8");
  const sameOrigin = createRequestPolicy(publicOrigins);
  const authorized = req => !passwords.needsSetup && req.session?.user === passwords.username && req.session.passwordVersion === passwords.version && (totp.enabled
    ? req.session.mfaVersion === totp.id && req.session.mfaVerified === true
    : !requireTotp);
  const enrolling = req => !passwords.needsSetup && !totp.enabled && req.session?.pendingUser === passwords.username && req.session.passwordVersion === passwords.version && Date.now() < req.session.enrollmentExpires;
  const csrfValid = req => sameOrigin(req) && Boolean(req.session?.csrf) && typeof req.body?.csrf === "string" && equal(req.body.csrf, req.session.csrf);
  const page = (res, content, status = 200) => res.status(status).type("html").send(template.replace("{{CONTENT}}", () => content));
  const renderLogin = (req, res, error = "", status = 200) => {
    req.session.csrf ||= crypto.randomBytes(24).toString("base64url");
    return page(res, loginView({ username: passwords.username, csrf: req.session.csrf, enabled: totp.enabled, required: requireTotp, error }), status);
  };
  const renderSetup = async (req, res, error = "", status = 200) => {
    if (!enrolling(req)) return res.redirect(303, "/login");
    req.session.enrollmentSecret ||= totp.enrollment(passwords.username).secret;
    return page(res, await enrollmentView({ username: passwords.username, csrf: req.session.csrf, secret: req.session.enrollmentSecret, uri: totp.uri(req.session.enrollmentSecret, passwords.username), error }), status);
  };
  const renderPasswordSetup = (req, res, error = "", status = 200) => {
    req.session.csrf ||= crypto.randomBytes(24).toString("base64url");
    const active = Boolean(passwords.setupGrant());
    return page(res, passwordSetupView({ username: passwords.username, csrf: req.session.csrf, active, error, enrollNext: requireTotp && !totp.enabled }), active ? status : 410);
  };
  const failures = new Map();
  let passwordChecks = 0;
  const failureBucket = req => {
    const key = req.ip || req.socket.remoteAddress;
    let bucket = failures.get(key);
    if (!bucket || Date.now() - bucket.started >= 60_000) {
      if (failures.size >= 1024) failures.delete(failures.keys().next().value);
      bucket = { started: Date.now(), count: 0 }; failures.set(key, bucket);
    }
    return bucket;
  };
  const limited = req => failureBucket(req).count >= 10;
  const failed = req => { failureBucket(req).count++; };
  const resetFailures = req => { failures.delete(req.ip || req.socket.remoteAddress); };
  const beginEnrollment = (req, res, next, version) => req.session.regenerate(error => {
    if (error) return next(error);
    req.session.pendingUser = passwords.username;
    req.session.passwordVersion = version;
    req.session.enrollmentExpires = Date.now() + 10 * 60 * 1000;
    req.session.csrf = crypto.randomBytes(24).toString("base64url");
    req.session.save(error => error ? next(error) : res.redirect(303, "/auth/totp/setup"));
  });
  const finishLogin = (req, res, next, codes, version = passwords.version) => req.session.regenerate(error => {
    if (error) return next(error);
    req.session.user = passwords.username;
    req.session.passwordVersion = version;
    req.session.csrf = crypto.randomBytes(24).toString("base64url");
    if (totp.enabled) { req.session.mfaVerified = true; req.session.mfaVersion = totp.id; }
    req.session.cookie.maxAge = WEEK;
    req.session.save(error => error ? next(error) : codes ? page(res, recoveryView(codes)) : res.redirect(303, "/office"));
  });
  const proxy = httpProxy.createProxyServer({ target: upstream, ws: true });
  const removeCredentials = proxyReq => {
    proxyReq.removeHeader("authorization"); proxyReq.removeHeader("cookie");
    proxyReq.removeHeader(PROXY_HEADER);
    if (proxyToken) proxyReq.setHeader(PROXY_HEADER, proxyToken);
  };
  proxy.on("proxyReq", removeCredentials);
  proxy.on("proxyReqWs", removeCredentials);
  proxy.on("error", (_error, _req, res) => {
    if (typeof res.writeHead === "function") { if (!res.headersSent) res.writeHead(502); res.end("Office temporarily unavailable"); }
    else res.end();
  });
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    // Preserve Origin on same-site form POSTs; no-referrer turns it into "null".
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!sameOrigin(req)) return res.status(403).type("text").send("Origin rejected");
    if (secureCookies && !req.secure) {
      if (!["GET", "HEAD"].includes(req.method)) return res.status(403).type("text").send("HTTPS required");
      return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    }
    if (secureCookies) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    if (req.path.startsWith("/auth/") || req.path === "/login") res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  app.get("/auth/style.css", (_req, res) => res.type("css").send(styles));
  app.get("/auth/ui.js", (_req, res) => res.type("js").send(clientScript));
  app.use(sessionMiddleware);
  app.get("/login", (req, res) => authorized(req) ? res.redirect(303, "/office") : enrolling(req) ? res.redirect(303, "/auth/totp/setup") : renderLogin(req, res));
  app.get("/auth/password/setup", (req, res) => renderPasswordSetup(req, res));
  app.post("/auth/password/setup", express.urlencoded({ extended: false, limit: "4kb" }), async (req, res, next) => {
    if (!csrfValid(req)) return renderPasswordSetup(req, res, "页面已过期，请重新打开设置链接。", 403);
    if (limited(req)) { res.setHeader("Retry-After", "60"); return renderPasswordSetup(req, res, "尝试次数较多，请稍等一分钟再试。", 429); }
    failed(req);
    try { await passwords.completeSetup(req.body.setupToken, req.body.password, req.body.confirmation); }
    catch (error) { return renderPasswordSetup(req, res, error.code ? "暂时无法保存密码，请稍后重试。" : error.message, error.code ? 500 : 400); }
    resetFailures(req);
    for (const clients of sockets.values()) for (const socket of clients) socket.end();
    if (requireTotp && !totp.enabled) return beginEnrollment(req, res, next, passwords.version);
    return req.session.regenerate(error => error ? next(error) : req.session.save(error => error ? next(error) : res.redirect(303, "/login")));
  });
  app.post("/auth/login", express.urlencoded({ extended: false, limit: "4kb" }), async (req, res, next) => {
    if (!csrfValid(req)) {
      console.warn("[web-access] login request rejected", JSON.stringify({ origin: req.headers.origin, host: req.headers.host, sessionCsrf: Boolean(req.session?.csrf), formCsrf: Boolean(req.body?.csrf), nonceMatches: Boolean(req.session?.csrf) && equal(req.body?.csrf, req.session.csrf) }));
      return renderLogin(req, res, "登录页面已过期，请重新输入密码。", 403);
    }
    if (limited(req)) { res.setHeader("Retry-After", "60"); return renderLogin(req, res, "尝试次数较多，请稍等一分钟再试。", 429); }
    if (passwords.needsSetup) return renderLogin(req, res, "请先通过收到的一次性链接设置自己的密码。", 403);
    if (passwordChecks >= 4) { res.setHeader("Retry-After", "1"); return renderLogin(req, res, "服务器繁忙，请稍后重试。", 429); }
    failed(req);
    const version = passwords.version;
    let passwordMatches;
    passwordChecks++;
    try { passwordMatches = req.body.username === passwords.username && await passwords.verify(req.body.password); }
    finally { passwordChecks--; }
    if (!passwordMatches || passwords.version !== version) return renderLogin(req, res, "用户名或密码不正确，请再试一次。", 401);
    if (totp.enabled && !totp.consume(req.body.code)) return renderLogin(req, res, "验证码无效、已过期或已使用，请等待新码；也可使用恢复码。", 401);
    resetFailures(req);
    if (requireTotp && !totp.enabled) return beginEnrollment(req, res, next, version);
    return finishLogin(req, res, next, undefined, version);
  });
  app.get("/auth/totp/setup", (req, res) => renderSetup(req, res));
  app.post("/auth/totp/confirm", express.urlencoded({ extended: false, limit: "4kb" }), async (req, res, next) => {
    if (!enrolling(req) || !req.session.enrollmentSecret) return res.redirect(303, "/login");
    if (!csrfValid(req)) return renderSetup(req, res, "绑定页面已过期，请重试。", 403);
    if (limited(req)) { res.setHeader("Retry-After", "60"); return renderSetup(req, res, "尝试次数较多，请稍等一分钟再试。", 429); }
    const codes = totp.activate(req.session.enrollmentSecret, req.body.code);
    if (!codes) { failed(req); return renderSetup(req, res, "验证码不正确，请检查手机时间和验证器账号后重试。", 401); }
    resetFailures(req);
    for (const clients of sockets.values()) for (const socket of clients) socket.end();
    return finishLogin(req, res, next, codes);
  });
  app.use((req, res, next) => {
    if (authorized(req)) return next();
    if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) return res.status(401).json({ error: "Sign in required" });
    return res.redirect(303, "/login");
  });
  app.get("/auth/session", (req, res) => res.json({ username: req.session.user, csrf: req.session.csrf, twoFactorEnabled: totp.enabled }));
  app.post("/auth/logout", express.urlencoded({ extended: false, limit: "4kb" }), (req, res, next) => {
    if (!csrfValid(req)) return res.status(403).json({ error: "Invalid logout request" });
    const id = req.sessionID;
    req.session.destroy(error => {
      if (error) return next(error);
      for (const socket of sockets.get(id) || []) socket.end();
      res.clearCookie(cookieName, { path: "/", secure: secureCookies, httpOnly: true, sameSite: "lax" });
      res.status(204).end();
    });
  });
  app.use((req, res) => {
    if (!sameOrigin(req)) return res.status(403).send("Origin rejected");
    proxy.web(req, res);
  });
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    console.error("[web-access]", error.message);
    res.status(500).send("Unable to complete this request");
  });
  const server = http.createServer(app);
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.split("?")[0] !== "/api/gateway/ws" || !req.headers.origin || !sameOrigin(req)) return socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    if (secureCookies && req.headers["x-forwarded-proto"]?.split(",")[0].trim() !== "https") return socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    sessionMiddleware(req, new http.ServerResponse(req), () => {
      if (!authorized(req)) return socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      const id = req.sessionID;
      const clients = sockets.get(id) || new Set();
      sockets.set(id, clients); clients.add(socket);
      const expiry = setTimeout(() => socket.end(), Math.max(0, new Date(req.session.cookie.expires).getTime() - Date.now()));
      expiry.unref();
      socket.on("close", () => { clearTimeout(expiry); clients.delete(socket); if (!clients.size) sockets.delete(id); });
      proxy.ws(req, socket, head);
    });
  });
  server.on("close", () => { proxy.close(); store.close(); });
  server.shutdown = callback => { for (const clients of sockets.values()) for (const socket of clients) socket.end(); server.close(callback); };
  return server;
}

if (require.main === module) {
  const dataDir = process.env.CLAW3D_ACCESS_DIR;
  if (!dataDir) throw new Error("CLAW3D_ACCESS_DIR is required");
  const credentials = JSON.parse(fs.readFileSync(path.join(dataDir, "credentials.json"), "utf8"));
  const port = Number(process.env.CLAW3D_ACCESS_PORT || 3035);
  const proxyToken = process.env.CLAW3D_PROXY_TOKEN, publicOrigins = process.env.CLAW3D_PUBLIC_ORIGINS;
  if (!proxyToken || proxyToken.length < 32 || !publicOrigins?.trim()) throw new Error("CLAW3D_PROXY_TOKEN and CLAW3D_PUBLIC_ORIGINS are required");
  const server = createWebAccessServer({ dataDir, credentials, requireTotp: process.env.CLAW3D_REQUIRE_TOTP === "1", proxyToken, publicOrigins });
  server.listen(port, "127.0.0.1", () => console.log(`[web-access] form login on loopback:${port}`));
  process.on("SIGTERM", () => server.shutdown(() => process.exit(0)));
}
module.exports = { createWebAccessServer };
