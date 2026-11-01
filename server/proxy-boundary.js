const crypto = require("node:crypto");

const PROXY_HEADER = "x-office-proxy-token";
const hash = value => crypto.createHash("sha256").update(String(value || "")).digest();

/** @param {string | string[]} [origins] */
function createRequestPolicy(origins = []) {
  const values = Array.isArray(origins) ? origins : String(origins).split(",").filter(Boolean);
  const publicOrigins = new Set(values.map(value => {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Public origins must be HTTPS origins");
    return url.origin;
  }));
  const publicHosts = new Set([...publicOrigins].map(value => new URL(value).host));
  return req => {
    const host = req.headers.host;
    if (typeof host !== "string" || /[\s/@\\?#]/.test(host)) return false;
    let target;
    try { target = new URL("http://" + host); } catch { return false; }
    if (target.host !== host.toLowerCase()) return false;
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) &&
      (target.port || "80") === String(req.socket.localPort);
    if (!local && !publicHosts.has(target.host)) return false;
    if (!req.headers.origin) return true;
    try {
      const origin = new URL(req.headers.origin);
      return origin.origin === req.headers.origin && origin.host === target.host &&
        (publicOrigins.has(origin.origin) || (local && ["http:", "https:"].includes(origin.protocol)));
    } catch { return false; }
  };
}

/** @param {{token?: string, publicOrigins?: string | string[], required?: boolean}} [options] */
function createProxyBoundary({ token = "", publicOrigins = [], required = false } = {}) {
  const valid = createRequestPolicy(publicOrigins);
  const protectedBackend = required || Boolean(token);
  if (protectedBackend && (typeof token !== "string" || token.length < 32 || !String(publicOrigins).trim())) {
    throw new Error("Public web access requires CLAW3D_PROXY_TOKEN (32+ characters) and CLAW3D_PUBLIC_ORIGINS");
  }
  return (req, upgrade = false) => {
    if (!valid(req) || (upgrade && !req.headers.origin)) return 403;
    // Public-mode backend access always requires the proxy credential, including
    // health checks. The deploy controller supplies it from private service config.
    if (protectedBackend && !crypto.timingSafeEqual(hash(req.headers[PROXY_HEADER]), hash(token))) return 401;
    return 0;
  };
}

module.exports = { createProxyBoundary, createRequestPolicy, PROXY_HEADER };
