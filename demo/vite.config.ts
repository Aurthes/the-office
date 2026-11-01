import { defineConfig } from "vite";
import path from "node:path";
import { readFileSync } from "node:fs";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.DEMO_BASE_PATH || "/the-office/";
export default defineConfig({
  root: path.join(root, "demo"),
  base,
  publicDir: path.join(root, "public"),
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { include: ["@/lib/text/codex-visible-text"] },
  define: { "process.env.NEXT_PUBLIC_CLAW3D_GRAFANA_URL": "undefined" },
  // Production uses origin-root assets; Pages serves this preview in a subdirectory.
  plugins: [{ name: "demo-public-assets", transform(code, id) {
    if (id.startsWith(path.join(root, "src"))) return { code: code.replace(/^["']use client["'];\s*/m, "").replace(/(["'`])\/office-assets\//g, `$1${base}office-assets/`), map: null };
  }, generateBundle() {
    for (const fileName of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) this.emitFile({ type: "asset", fileName, source: readFileSync(path.join(root, fileName)) });
  } }],
  build: { outDir: path.join(root, "dist-demo"), emptyOutDir: true, commonjsOptions: { include: [/node_modules/, /src\/lib\/text/] } },
});
