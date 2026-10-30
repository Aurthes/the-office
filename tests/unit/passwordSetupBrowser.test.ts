// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
const { passwordSetupView } = await import("../../server/web-access/views.js");
const script = readFileSync(new URL("../../server/web-access/login.js", import.meta.url), "utf8");
const token = "a".repeat(43);
const html = passwordSetupView({ username: "fixture", csrf: "fixture", active: true, error: "", enrollNext: true });
describe("password setup invitation in the browser", () => {
  it("takes the token from the fragment, removes it from the address, and supports refresh without exposing it in HTML", () => {
    expect(html).not.toContain(token);
    const page = new JSDOM(html, { url: `https://office.test/auth/password/setup#token=${token}`, runScripts: "outside-only" });
    page.window.eval(script);
    expect(page.window.location.hash).toBe("");
    expect((page.window.document.querySelector("#setup-token") as HTMLInputElement).value).toBe(token);
    expect((page.window.document.querySelector("#save-password") as HTMLButtonElement).disabled).toBe(false);
    const refresh = new JSDOM(html, { url: "https://office.test/auth/password/setup", runScripts: "outside-only" });
    refresh.window.sessionStorage.setItem("initial-password-token", page.window.sessionStorage.getItem("initial-password-token")!);
    refresh.window.eval(script);
    expect((refresh.window.document.querySelector("#setup-token") as HTMLInputElement).value).toBe(token);
    const next = new JSDOM("<h1>Next step</h1>", { url: "https://office.test/auth/totp/setup", runScripts: "outside-only" });
    next.window.sessionStorage.setItem("initial-password-token", token); next.window.eval(script);
    expect(next.window.sessionStorage.getItem("initial-password-token")).toBeNull();
    page.window.close(); refresh.window.close(); next.window.close();
  });
  it("keeps submission disabled when opened without an invitation", () => {
    const page = new JSDOM(html, { url: "https://office.test/auth/password/setup", runScripts: "outside-only" });
    page.window.eval(script);
    expect((page.window.document.querySelector("#save-password") as HTMLButtonElement).disabled).toBe(true);
    page.window.close();
  });
});
