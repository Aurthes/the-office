const { isIP } = require("node:net");

const INSTALL_BRANDS = {
  lan: { variant: "lan", name: "Office · LAN", badge: "LAN", color: "#86e3ed" },
  remote: { variant: "remote", name: "Office · Remote", badge: "NET", color: "#f3c778" },
};

/** Display classification only. Call after the existing Host/auth boundary. Forwarded headers are not inputs.
 * @param {string | null | undefined} host
 */
function installBrand(host) {
  let hostname;
  try {
    if (typeof host !== "string" || /[\s/@\\?#]/.test(host)) return INSTALL_BRANDS.remote;
    const url = new URL("http://" + host);
    if (url.host !== host.toLowerCase()) return INSTALL_BRANDS.remote;
    hostname = url.hostname;
  } catch { return INSTALL_BRANDS.remote; }
  if (hostname === "localhost" || hostname === "[::1]") return INSTALL_BRANDS.lan;
  if (isIP(hostname) === 4) {
    const [a, b] = hostname.split(".").map(Number);
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return INSTALL_BRANDS.lan;
  }
  return INSTALL_BRANDS.remote;
}

module.exports = { installBrand, INSTALL_BRANDS };
