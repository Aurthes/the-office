const http = require("node:http");
const { pipeline } = require("node:stream");
const { createGzip } = require("node:zlib");

function acceptsGzip(header = "") {
  return header.split(",").some(part => {
    const [encoding, ...parameters] = part.trim().split(";");
    const quality = parameters.find(value => /^\s*q\s*=/i.test(value));
    const weight = quality === undefined ? 1 : Number(quality.split("=")[1]);
    return encoding.trim().toLowerCase() === "gzip" && weight > 0 && weight <= 1;
  });
}

// Only the read-only dashboard is exposed. Collection and account credentials
// stay outside the Office process.
function createAccountMonitorProxy(origin) {
  if (!origin) return () => false;
  const target = new URL(origin);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" ||
      target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("The account monitor must use a loopback HTTP origin");
  }
  const prefix = "/account-history";
  const paths = new Set(["/", "/index.html", "/app.js", "/aggregate.js", "/api/latest", "/api/curve", "/api/aggregate"]);
  return (req, res) => {
    const url = new URL(req.url, "http://office.local");
    if (url.pathname !== prefix && !url.pathname.startsWith(prefix + "/")) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET") { res.writeHead(405, { Allow: "GET" }); res.end(); return true; }
    if (url.pathname === prefix) {
      res.writeHead(308, { Location: prefix + "/" + url.search }); res.end(); return true;
    }
    const pathname = url.pathname.slice(prefix.length);
    if (!paths.has(pathname) || req.url.length > 8192) { res.writeHead(404); res.end(); return true; }
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'self'; base-uri 'none'");
    // Construct the request from the fixed origin; never forward cookies,
    // authorization or a client-supplied host to the dashboard service.
    // A week of local JSONL can need more than eight seconds on a cold disk.
    const timeout = pathname === "/api/aggregate" ? 30000 : 8000;
    const upstream = http.get({ hostname: target.hostname, port: target.port || 80,
      path: pathname + url.search, timeout }, response => {
      res.statusCode = response.statusCode || 502;
      const compressible = response.statusCode === 200 &&
        /^application\/json(?:;|$)/i.test(response.headers["content-type"] || "") &&
        !response.headers["content-encoding"] && Number(response.headers["content-length"]) >= 1024;
      const gzip = compressible && acceptsGzip(req.headers["accept-encoding"]);
      for (const name of ["content-type", "content-length", "content-encoding"]) {
        if (response.headers[name]) res.setHeader(name, response.headers[name]);
      }
      if (compressible) res.setHeader("Vary", "Accept-Encoding");
      response.on("error", () => res.destroy());
      if (gzip) {
        // Compress before the tunnel, rather than sending raw JSON to its edge.
        res.removeHeader("Content-Length");
        res.setHeader("Content-Encoding", "gzip");
        pipeline(response, createGzip(), res, () => {});
      } else {
        response.pipe(res);
      }
    });
    upstream.on("timeout", () => upstream.destroy(new Error("Dashboard timeout")));
    upstream.on("error", () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Account dashboard temporarily unavailable");
    });
    res.on("close", () => upstream.destroy());
    return true;
  };
}

module.exports = { createAccountMonitorProxy };
