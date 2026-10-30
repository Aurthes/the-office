import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { CodexSessionControls } = require("../../server/codex-session-controls.js");
const { sessionSettings, settingsPatch } = require("../../server/codex-session-settings.js");
const native = { model: "native-a", reasoningEffort: "ultra", cwd: "/project", approvalPolicy: "on-request", activePermissionProfile: { id: ":workspace" } };
const choices = { models: [{ id: "native-a", efforts: ["high", "ultra"], defaultEffort: "high" }, { id: "native-b", efforts: ["medium", "high"], defaultEffort: "medium" }],
  accessModes: [{ id: ":workspace", allowed: true }, { id: ":danger-full-access", allowed: true }, { id: ":read-only", allowed: false }] };
function setup() {
  const client = { ready: true, call: vi.fn(async (method: string) => {
    if (method === "thread/loaded/list") return { data: ["original"] };
    if (method === "thread/resume") return native;
    if (method === "thread/turns/list") return { data: [{ id: "active", status: "inProgress" }] };
    if (method === "model/list") return { data: [{ model: "native-a", displayName: "Native A", supportedReasoningEfforts: [{ reasoningEffort: "high" }, { reasoningEffort: "ultra" }], defaultReasoningEffort: "high" }] };
    if (method === "permissionProfile/list") return { data: choices.accessModes };
    return {};
  }) };
  return { client, controls: new CodexSessionControls(client) };
}
describe("original Codex thread settings", () => {
  it("reads native choices in the thread's project without changing any setting or starting a turn", async () => {
    const { client, controls } = setup();const result = await controls.choices("original");
    expect(result.models).toEqual([{ id: "native-a", name: "Native A", efforts: ["high", "ultra"], defaultEffort: "high" }]);
    expect(client.call).toHaveBeenCalledWith("permissionProfile/list", { cwd: "/project" });
    expect(client.call.mock.calls.some(([method]) => ["thread/settings/update", "turn/start", "turn/interrupt"].includes(method))).toBe(false);
    expect(controls.snapshot("original").settings).toEqual({ model: "native-a", effort: "ultra", accessMode: ":workspace" });
  });
  it("patches only requested native fields and waits for the authoritative settings event", async () => {
    const { client, controls } = setup();await controls.updateSettings("original", { effort: "high" });
    expect(client.call).toHaveBeenCalledWith("thread/settings/update", { threadId: "original", effort: "high" });
    const before = controls.snapshot("original");expect(before.settings.effort).toBe("ultra");
    controls.handle({ method: "thread/settings/updated", params: { threadId: "original", threadSettings: { ...native, effort: "high" } } });
    const after = controls.snapshot("original");expect(after.version).toBeGreaterThan(before.version);expect(after.settings.effort).toBe("high");
    expect(after.activeTurnId).toBe("active");expect(client.call.mock.calls.some(([method]) => ["turn/start", "turn/interrupt"].includes(method))).toBe(false);
  });
  it("keeps supported effort and falls back to the new model's actual default only when incompatible", () => {
    const current = sessionSettings(native);
    expect(settingsPatch({ model: "native-a" }, current, choices)).toEqual({ model: "native-a" });
    expect(settingsPatch({ model: "native-b" }, current, choices)).toEqual({ model: "native-b", effort: "medium" });
    expect(() => settingsPatch({ model: "invented" }, current, choices)).toThrow("可选列表");
    expect(() => settingsPatch({ effort: "max" }, current, choices)).toThrow("推理强度");
  });
  it("requires explicit Full access confirmation, honors denied profiles and rejects arbitrary native settings", () => {
    const current = sessionSettings(native);
    expect(() => settingsPatch({ accessMode: ":danger-full-access" }, current, choices)).toThrow("确认");
    expect(settingsPatch({ accessMode: ":danger-full-access", confirmFullAccess: true }, current, choices)).toEqual({ permissions: ":danger-full-access", approvalPolicy: "never" });
    expect(settingsPatch({ accessMode: ":workspace" }, current, choices)).toEqual({ permissions: ":workspace", approvalPolicy: "on-request" });
    expect(() => settingsPatch({ accessMode: ":read-only" }, current, choices)).toThrow("不可选");
    expect(() => settingsPatch({ cwd: "/elsewhere" }, current, choices)).toThrow("不支持");
    expect(() => settingsPatch({ sandboxPolicy: { type: "dangerFullAccess" } }, current, choices)).toThrow("不支持");
    expect(sessionSettings({ ...native, approvalPolicy: "never" }).accessMode).toBe("custom");
  });
  it("does not overwrite a newer native settings notification with a late initial resume response", async () => {
    const { client, controls } = setup();const initial = client.call.getMockImplementation()!;
    client.call.mockImplementation(async (method: string) => {
      if (method === "thread/resume") {
        controls.handle({ method: "thread/settings/updated", params: { threadId: "original", threadSettings: { ...native, model: "native-b", effort: "high" } } });
      }
      return initial(method);
    });
    await controls.attach("original");expect(controls.snapshot("original").settings.model).toBe("native-b");
  });
});
