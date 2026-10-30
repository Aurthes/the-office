// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { CodexWorkspaceActions } = createRequire(import.meta.url)("../../server/codex-workspace-actions.js");
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "claw-create-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function setup() {
  const client = { ready: true, call: vi.fn(async (method: string) => {
    if (method === "project/create" || method === "project/read") return { project: { id: "p", roots: [{ path: root }] } };
    if (method === "thread/start") return { thread: { id: "native-id" } };
    return {};
  }) };
  return { client, actions: new CodexWorkspaceActions(client) };
}
describe("native workspace creation", () => {
  it("creates a Project using native idempotency without writing App state", async () => {
    const { client, actions } = setup();
    const input = { name: " A project ", workspace: root, requestId: "project-key" };
    await Promise.all([actions.createProject(input), actions.createProject(input)]);
    expect(client.call).toHaveBeenCalledExactlyOnceWith("project/create", { name: "A project", roots: [{ path: root }], idempotencyKey: "project-key" });
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it("starts one original session in the chosen project without a model request or permission override", async () => {
    const { client, actions } = setup();
    const input = { name: "Research", projectId: "p", requestId: "session-key" };
    expect(await actions.createSession(input)).toEqual({ threadId: "native-id" });
    await actions.createSession(input);
    expect(client.call.mock.calls).toEqual([
      ["project/read", { projectId: "p" }],
      ["thread/start", { cwd: root, projectId: "p", serviceName: "claw3d" }],
      ["thread/name/set", { threadId: "native-id", name: "Research" }],
    ]);
  });
  it("rejects invalid paths, missing projects, unavailable ownership and reused conflicting IDs", async () => {
    const { client, actions } = setup();
    expect(() => actions.createProject({ name: "A", workspace: "relative", requestId: "x" })).toThrow("绝对路径");
    expect(() => actions.createSession({ name: "A", projectId: "", requestId: "x" })).toThrow("Project");
    await actions.createSession({ name: "A", projectId: "p", requestId: "x" });
    expect(() => actions.createSession({ name: "B", projectId: "p", requestId: "x" })).toThrow("冲突");
    client.ready = false;
    expect(() => actions.createProject({ name: "A", workspace: root, requestId: "y" })).toThrow("未就绪");
  });
  it("never retries an uncertain session creation and preserves partial naming success", async () => {
    const { client, actions } = setup();
    client.call.mockImplementation(async (method: string) => {
      if (method === "project/read") return { project: { id: "p", roots: [{ path: root }] } };
      throw new Error("connection lost");
    });
    const input = { name: "A", projectId: "p", requestId: "uncertain" };
    await expect(actions.createSession(input)).rejects.toThrow("connection lost");
    await expect(actions.createSession(input)).rejects.toThrow("connection lost");
    expect(client.call.mock.calls.filter(([method]) => method === "thread/start")).toHaveLength(1);
    client.call.mockImplementation(async (method: string) => {
      if (method === "project/read") return { project: { id: "p", roots: [{ path: root }] } };
      if (method === "thread/start") return { thread: { id: "created" } };
      throw new Error("name failed");
    });
    expect(await actions.createSession({ ...input, requestId: "next" })).toMatchObject({ threadId: "created", warning: expect.stringContaining("已创建") });
  });
});
