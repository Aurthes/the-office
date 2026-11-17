const fs = require("node:fs");
const path = require("node:path");
const { installBrand } = require("./install-branding");

function createInstallAssets() {
  const original = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/office.webmanifest"), "utf8"));
  const variants = {};
  for (const variant of ["lan", "remote"]) {
    const name = installBrand(variant === "lan" ? "localhost" : "example.com").name;
    variants[variant] = {
      "/office.webmanifest": { type: "application/manifest+json; charset=utf-8", bytes: Buffer.from(JSON.stringify({ ...original, name, short_name: name })) },
      "/office-icon-192.png": { type: "image/png", bytes: fs.readFileSync(path.join(__dirname, `assets/install/${variant}-192.png`)) },
      "/office-icon-512.png": { type: "image/png", bytes: fs.readFileSync(path.join(__dirname, `assets/install/${variant}-512.png`)) },
    };
  }
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const pathname = (req.url || "").split("?")[0];
    if (!Object.hasOwn(variants.lan, pathname)) return false;
    const asset = variants[installBrand(req.headers.host).variant][pathname];
    res.writeHead(200, { "Content-Type": asset.type, "Content-Length": asset.bytes.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : asset.bytes);
    return true;
  };
}
module.exports = { createInstallAssets };
