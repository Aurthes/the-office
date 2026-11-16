const http = require("node:http");

// A single read-only viewer behind Office authentication, never an open proxy.
function createMmPnlProxy() {
  const prefix = "/mm-pnl";
  const paths = new Set(["/", "/index.html", "/plotly.js", "/live.js", "/api/config", "/api/pnl", "/healthz"]);
  return (req, res) => {
    const url = new URL(req.url, "http://office.local");
    if (url.pathname !== prefix && !url.pathname.startsWith(prefix + "/")) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    if (req.method !== "GET") { res.writeHead(405, { Allow: "GET" }); res.end(); return true; }
    if (req.url.length > 8192) { res.writeHead(414); res.end(); return true; }
    if (url.pathname === prefix) {
      res.writeHead(308, { Location: prefix + "/" + url.search }); res.end(); return true;
    }
    const pathname = url.pathname.slice(prefix.length);
    if (!paths.has(pathname)) { res.writeHead(404); res.end(); return true; }
    const fail = status => {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("MM PnL dashboard temporarily unavailable");
    };
    // No incoming headers: cookies, authorization, proxy identity and client
    // configuration can never become credentials or select another upstream.
    const upstream = http.get({ hostname: "127.0.0.1", port: 8768, path: pathname + url.search }, response => {
      if ((response.statusCode || 502) >= 500 || (response.statusCode >= 300 && response.statusCode < 400)) {
        response.resume(); fail(response.statusCode === 503 ? 503 : 502); return;
      }
      res.statusCode = response.statusCode || 502;
      for (const name of ["content-type", "content-length", "content-encoding"]) {
        if (response.headers[name]) res.setHeader(name, response.headers[name]);
      }
      response.on("error", () => res.destroy());
      response.pipe(res);
    });
    const timer = setTimeout(() => upstream.destroy(new Error("Dashboard timeout")), pathname === "/api/pnl" ? 95000 : 8000);
    upstream.on("error", () => fail(502));
    res.on("close", () => { clearTimeout(timer); upstream.destroy(); });
    return true;
  };
}
module.exports = { createMmPnlProxy };
