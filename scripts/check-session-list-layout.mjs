#!/usr/bin/env node
// Source-backed browser regression, no Office state, gateway, model or build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { build as bundle } from "esbuild";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "test-results/adaptive-session-list-20261107/browser");
const source = fs.readFileSync(path.join(root, "src/features/office/screens/OfficeScreen.tsx"), "utf8");
const contentClass = source.match(/<div className="([^"]+)">\s*\{messageTarget\?\.archived \?/)?.[1];
if (!contentClass) throw Error("Could not read the actual archived/live chat wrapper");
for (const name of ["focusLocalAgent", "focusChatTarget"]) {
  const start = source.indexOf(`const ${name} = useCallback(`), end = source.indexOf("\n  );", start);
  const body = source.slice(start, end);
  if (!body.includes("openSpecificChat();") || body.includes("setChatRosterCollapsed(false)")) throw Error(name + " bypasses centralized specific-chat opening");
}
if (!source.includes("onAgentChatSelect={handleOpenAgentChat}")) throw Error("External agent selection must use the central chat handler");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "fixture.html"), `<html><body><div id="root"></div><script>window.sessionListFixtureContentClass=${JSON.stringify(contentClass)}</script><script type="module" src="/tests/browser/sessionListLayout.tsx"></script></body></html>`);
// Vite dev leaves local CommonJS untouched; bundle only these existing shared
// helpers for the fixture, as Next's production bundler does. Source stays intact.
const commonJs = new Map(), require = createRequire(import.meta.url);
for (const name of ["office/organization-structure", "office/department-structure", "text/codex-visible-text"]) {
  const file = path.join(root, "src/lib", name + ".js");
  const names = Object.keys(require(file));
  const result = await bundle({ stdin: { contents: `import shared from ${JSON.stringify(file)}; export const {${names.join(",")}} = shared;`, resolveDir: root }, bundle: true, write: false, format: "esm", platform: "browser" });
  commonJs.set(file, result.outputFiles[0].text);
}
let server, browser, page;
const errors = [];
try {
  server = await createServer({ root, configFile: false, cacheDir: path.join(output, "vite-cache"), logLevel: "error",
    plugins: [{ name: "fixture-shared-commonjs", enforce: "pre", load: id => commonJs.get(id.split("?")[0]) }],
    resolve: { alias: { "@": path.join(root, "src") } }, esbuild: { jsx: "automatic" }, optimizeDeps: { entries: [path.join(output, "fixture.html")] }, server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
  await page.goto(origin + "/test-results/adaptive-session-list-20261107/browser/fixture.html");
  const layout = page.locator(".session-chat-layout"), list = page.locator("#session-chat-list"), content = page.getByTestId("chat-content");
  const external = page.getByRole("button", { name: "Open specific chat externally", exact: true });
  expect(await layout.evaluate(node => node.getBoundingClientRect().width)).toBe(0);
  await external.click(); await expect(layout).toHaveAttribute("data-session-list-mode", "overlay"); await expect(list).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "Preserved draft" }); await input.fill("Keep this draft"); const original = await input.elementHandle();
  await page.getByRole("button", { name: "Open session list", exact: true }).click(); await expect(list).toBeVisible();
  await expect.poll(() => content.evaluate(node => node.getBoundingClientRect().width)).toBe(500);
  await external.click(); await expect(list).toHaveCount(0); await expect(input).toHaveValue("Keep this draft");
  await external.click(); await expect(list).toHaveCount(0);
  await page.getByRole("button", { name: "Close chat", exact: true }).click(); await external.click(); await expect(list).toHaveCount(0);
  if (!await original.evaluate(node => node.isConnected)) throw Error("Reopening remounted the existing draft");
  await page.getByRole("button", { name: "Open session list", exact: true }).click();
  await page.getByRole("button", { name: "Open session: Fixture worker", exact: true }).click(); await expect(list).toHaveCount(0);
  await page.getByRole("button", { name: "Open archived result", exact: true }).click();
  const viewer = page.getByRole("region", { name: "Message location", exact: true }); await expect(viewer).toBeVisible();
  await expect(viewer.getByText("Archived answer", { exact: true }).last()).toBeVisible();
  await viewer.getByRole("button", { name: "Open session list", exact: true }).click(); await expect(list).toBeVisible();
  const choice = list.getByRole("button", { name: "Open session: Fixture worker", exact: true });
  const hit = locator => locator.evaluate(node => { const r = node.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("button") === node; });
  if (!await hit(choice)) throw Error("Archived viewer intercepts directory clicks");
  // Negative control: removing the source wrapper's isolation reproduces P2.
  await content.evaluate(node => { node.style.isolation = "auto"; });
  if (await hit(choice)) throw Error("Stacking regression fixture did not reproduce the original defect");
  await content.evaluate(node => { node.style.isolation = ""; });
  if (!await hit(choice)) throw Error("Restored isolation did not restore directory hit testing");
  const backdrop = page.locator(".session-list-backdrop");
  const outsideHits = await backdrop.evaluate(node => { const r = node.getBoundingClientRect(); return document.elementFromPoint(r.right - 12, r.bottom - 12) === node; });
  if (!outsideHits) throw Error("Archived viewer intercepts backdrop clicks");
  await page.screenshot({ path: path.join(output, "archived-overlay.png") });
  await choice.click(); await expect(list).toHaveCount(0); await expect(viewer).toHaveCount(0);
  await page.getByRole("button", { name: "Open archived result", exact: true }).click();
  await viewer.getByRole("button", { name: "Open session list", exact: true }).click();
  await backdrop.click({ position: { x: 488, y: 588 } }); await expect(list).toHaveCount(0); await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "Back to conversation", exact: true }).click(); await expect(input).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "Open session list", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Container width", exact: true }).fill("960"); await expect(layout).toHaveAttribute("data-session-list-mode", "split"); await expect(list).toBeVisible();
  await page.getByRole("spinbutton", { name: "Container width", exact: true }).fill("500"); await expect(layout).toHaveAttribute("data-session-list-mode", "overlay"); await expect(list).toBeVisible();
  if (errors.length) throw Error(errors.join("\n"));
  const result = { firstNarrowHiddenOpen: true, nonDirectorySpecificOpen: true, repeatedSameTargetAndReopen: true, draftDomRetained: true, deliberateListOpeningPreserved: true,
    archivedViewerAndHeaderToggle: true, overlayHitTesting: true, backdropHitTesting: true, negativeControlReproducesOldStackingBug: true, viewerControlsPreserved: true, actualViewport: 1400, containerWidths: [500, 960], pageErrors: 0, productionBuild: false };
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ pageErrors: errors, visiblePage: await page?.locator("body").innerText().catch(() => "unavailable") }));
  throw error;
} finally {
  await browser?.close(); await server?.close();
  fs.rmSync(path.join(output, "vite-cache"), { recursive: true, force: true });
  fs.rmSync(path.join(output, "fixture.html"), { force: true });
}
