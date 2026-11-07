import { createRequire } from "node:module";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { prepareOfficeProfile } = require("../../server/codex-office-profile.js");
const { officeEnvironment } = require("../../server/codex-office-client.js");
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "office-profile-"))); roots.push(root);
  const source = path.join(root, "existing-codex"), home = path.join(root, "office");
  mkdirSync(source); mkdirSync(home);
  const environment = { CODEX_HOME: source, HOME: root };
  const prepare = () => prepareOfficeProfile(home, environment);
  const settings = () => parse(prepare().overrides.filter((_: string, i: number) => i % 2 === 1).join("\n"));
  return { root, source, home, environment, prepare, settings };
}
describe("automatic Office configuration discovery", () => {
  it("appends fixed Office instructions to the effective developer rules without editing either config", () => {
    const f = fixture(), source = path.join(f.source, "config.toml"), own = path.join(f.home, "config.toml");
    writeFileSync(source, 'developer_instructions="User rules"\n');
    const settings = () => parse(prepareOfficeProfile(f.home, f.environment, "Office rules").overrides.filter((_: string, i: number) => i % 2 === 1).join("\n"));
    expect(settings().developer_instructions).toBe("User rules\nOffice rules");
    writeFileSync(own, 'developer_instructions="Office-specific user rules"\n');
    expect(settings().developer_instructions).toBe("Office-specific user rules\nOffice rules");
    expect(readFileSync(source, "utf8")).toBe('developer_instructions="User rules"\n');
    expect(readFileSync(own, "utf8")).toBe('developer_instructions="Office-specific user rules"\n');
  });
  it("deduplicates same-name skills by Office, imported and user priority, preserving explicit choices and files", () => {
    const f = fixture();
    const skill = (root: string, folder: string, name: string, version: string) => {
      const dir = path.join(root, folder); mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "SKILL.md"); writeFileSync(file, `---\nname: ${name}\ndescription: ${version}\n---\n${version}\n`); return file;
    };
    const office = path.join(f.home, "skills"), imported = path.join(f.source, "skills"), user = path.join(f.root, ".agents/skills");
    const current = skill(office, "current", "same", "new required safeguards"), old = skill(imported, "old", "same", "old rules");
    const userCopy = skill(user, "same", "same", "user copy");
    symlinkSync(path.dirname(current), path.join(user, "alias"));
    const disabled = () => (f.settings().skills as { config: { path: string; enabled: boolean }[] }).config;
    expect(disabled()).toEqual([{ path: old, enabled: false }, { path: userCopy, enabled: false }]);
    expect(readFileSync(current, "utf8")).toContain("new required safeguards");
    expect(readFileSync(old, "utf8")).toContain("old rules");
    expect(readlinkSync(path.join(user, "alias"))).toBe(path.dirname(current));
    writeFileSync(path.join(f.home, "config.toml"), `[[skills.config]]\npath=${JSON.stringify(old)}\nenabled=true\n`);
    expect(disabled()).toEqual([{ path: old, enabled: true }, { path: current, enabled: false }, { path: userCopy, enabled: false }]);
    writeFileSync(path.join(f.home, "config.toml"), `[[skills.config]]\npath=${JSON.stringify(current)}\nenabled=false\n`);
    expect(disabled()).toEqual([{ path: current, enabled: false }, { path: userCopy, enabled: false }]);
    writeFileSync(path.join(f.home, "config.toml"), '[[skills.config]]\nname="same"\nenabled=true\n');
    expect(disabled()).toEqual([{ name: "same", enabled: true }]);
  });
  it("shares existing rule files and legacy skills while importing only ordinary defaults", () => {
    const f = fixture();
    writeFileSync(path.join(f.source, "AGENTS.md"), "shared rules");
    writeFileSync(path.join(f.source, "AGENTS.override.md"), "temporary override");
    mkdirSync(path.join(f.source, "skills"));
    writeFileSync(path.join(f.source, "auth.json"), "private credential sentinel");
    writeFileSync(path.join(f.source, "config.toml"), 'model="model-a"\nmodel_reasoning_effort="high"\ndeveloper_instructions="shared developer rules"\nsqlite_home="/native/db"\ncli_auth_credentials_store="keyring"\nsandbox_mode="danger-full-access"\nnotify=["native-only"]\n[mcp_servers.private]\ncommand="native-tool-bridge"\n');
    const before = readFileSync(path.join(f.source, "config.toml"));
    const result = f.prepare();
    expect(result.rules.every((r: { status: string }) => r.status === "shared")).toBe(true);
    expect(readlinkSync(path.join(f.home, "AGENTS.md"))).toBe(path.join(f.source, "AGENTS.md"));
    expect(result.skillRoots).toEqual([path.join(f.source, "skills")]);
    expect(f.settings()).toEqual({ model: "model-a", model_reasoning_effort: "high", developer_instructions: "shared developer rules" });
    expect(existsSync(path.join(f.home, "auth.json"))).toBe(false);
    expect(readFileSync(path.join(f.source, "config.toml"))).toEqual(before);
    expect(readFileSync(path.join(f.source, "auth.json"), "utf8")).toBe("private credential sentinel");
  });
  it("preserves Office-specific rules, defaults and per-skill overrides", () => {
    const f = fixture(), skill = path.join(f.source, "skill");
    writeFileSync(path.join(f.source, "AGENTS.md"), "source");
    writeFileSync(path.join(f.home, "AGENTS.md"), "Office-specific");
    writeFileSync(path.join(f.source, "config.toml"), `model="source-model"\nmodel_reasoning_effort="high"\n[[skills.config]]\npath=${JSON.stringify(skill)}\nenabled=false\n`);
    writeFileSync(path.join(f.home, "config.toml"), `model="office-model"\n[[skills.config]]\npath=${JSON.stringify(skill)}\nenabled=true\n`);
    expect(f.prepare().rules[0].status).toBe("office");
    expect(readFileSync(path.join(f.home, "AGENTS.md"), "utf8")).toBe("Office-specific");
    expect(f.settings()).toEqual({ model_reasoning_effort: "high", skills: { config: [{ path: skill, enabled: true }] } });
  });
  it("follows rule edits without copying and refreshes only links it owns", () => {
    const f = fixture(); writeFileSync(path.join(f.source, "AGENTS.md"), "version 1"); f.prepare();
    writeFileSync(path.join(f.source, "AGENTS.md"), "version 2");
    expect(readFileSync(path.join(f.home, "AGENTS.md"), "utf8")).toBe("version 2");
    const other = path.join(f.root, "custom-codex"); mkdirSync(other); writeFileSync(path.join(other, "AGENTS.md"), "new source");
    f.environment.CODEX_HOME = other; f.prepare();
    expect(readFileSync(path.join(f.home, "AGENTS.md"), "utf8")).toBe("new source");
    rmSync(path.join(other, "AGENTS.md")); f.prepare();
    expect(existsSync(path.join(f.home, "AGENTS.md"))).toBe(false);
    writeFileSync(path.join(other, "AGENTS.md"), "source"); f.prepare();
    rmSync(path.join(f.home, "AGENTS.md")); writeFileSync(path.join(f.home, "AGENTS.md"), "user replacement"); f.prepare();
    expect(readFileSync(path.join(f.home, "AGENTS.md"), "utf8")).toBe("user replacement");
  });
  it("honors an explicit source directory and rejects overlapping or aliased runtime homes", () => {
    const f = fixture(), environment = { CODEX_HOME: f.source, CLAW3D_CODEX_CONFIG_HOME: path.join(f.root, "explicit") };
    mkdirSync(environment.CLAW3D_CODEX_CONFIG_HOME); writeFileSync(path.join(environment.CLAW3D_CODEX_CONFIG_HOME, "AGENTS.md"), "explicit");
    expect(prepareOfficeProfile(f.home, environment).source).toBe(environment.CLAW3D_CODEX_CONFIG_HOME);
    expect(readFileSync(path.join(f.home, "AGENTS.md"), "utf8")).toBe("explicit");
    expect(() => officeEnvironment(environment.CLAW3D_CODEX_CONFIG_HOME, environment)).toThrow("separate");
    const alias = path.join(f.root, "alias"); symlinkSync(environment.CLAW3D_CODEX_CONFIG_HOME, alias);
    expect(() => officeEnvironment(alias, environment)).toThrow("separate");
  });
  it("starts independently when no existing configuration is installed", () => {
    const f = fixture(); rmSync(f.source, { recursive: true });
    expect(f.prepare()).toMatchObject({ defaults: [], skillRoots: [], warnings: [] });
    expect(f.settings()).toEqual({}); expect(existsSync(f.source)).toBe(false);
  });
  it("reports malformed source configuration without exposing its content or changing it", () => {
    const f = fixture(), file = path.join(f.source, "config.toml"); writeFileSync(file, 'private_secret="do-not-print"\nbroken=[');
    const result = f.prepare(); expect(result.warnings).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("do-not-print"); expect(f.settings()).toEqual({});
    expect(readFileSync(file, "utf8")).toContain("do-not-print");
  });
  it("does not apply a custom provider's model to Office's independently authenticated OpenAI provider", () => {
    const f = fixture(); writeFileSync(path.join(f.source, "config.toml"), 'model="local-only-model"\nmodel_provider="custom"\nmodel_reasoning_effort="high"\npersonality="pragmatic"\n');
    expect(f.prepare().warnings).toContain("Custom model providers require separate Office configuration.");
    expect(f.settings()).toEqual({ personality: "pragmatic" });
  });
});
