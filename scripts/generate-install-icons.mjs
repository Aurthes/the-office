// Offline asset generation only; no image rendering in the HTTP request path.
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import branding from "../server/install-branding.js";
const source = await readFile(new URL("../public/office-icon-512.png", import.meta.url));
const directory = new URL("../server/assets/install/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const { variant, badge, color } of Object.values(branding.INSTALL_BRANDS)) {
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect x="244" y="350" width="244" height="94" rx="24" fill="#0b1721" stroke="${color}" stroke-width="6"/><text x="366" y="420" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="72" fill="${color}">${badge}</text></svg>`);
  const full = await sharp(source).composite([{ input: overlay }]).png().toBuffer();
  for (const size of [192, 512]) await sharp(full).resize(size, size).png().toFile(fileURLToPath(new URL(`${variant}-${size}.png`, directory)));
}
