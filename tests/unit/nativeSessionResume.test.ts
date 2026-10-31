// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { CodexSharedClient } = require("../../server/codex-shared-client.js");
const { CodexSessionControls } = require("../../server/codex-session-controls.js");

it.skipIf(!process.env.CLAW3D_NATIVE_CODEX_BIN)("restores a cold native chat with its identity, permissions and tools, using a local model fixture", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claw-native-resume-"));
  const socket = path.join(root, "native.sock");
  const requests: string[] = [], completed = new Set<string>();
  // Legacy threads persist lazily on their first prompt. Use a local Responses
  // fixture for both prompts; no real account or external model is contacted.
  const provider = http.createServer((request, response) => {
    let body = ""; request.on("data", chunk => { body += String(chunk); });
    request.on("end", () => {
      requests.push(body); const id = `response_${requests.length}`;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const event = (value: unknown) => response.write(`data: ${JSON.stringify(value)}\n\n`);
      event({ type: "response.created", response: { id } });
      const item = { id: `message_${requests.length}`, type: "message", role: "assistant", content: [{ type: "output_text", text: "Fixture reply" }] };
      event({ type: "response.output_item.done", output_index: 0, item });
      event({ type: "response.completed", response: { id, output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
      response.end();
    });
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const port = (provider.address() as { port: number }).port;
  fs.writeFileSync(path.join(root, "config.toml"), `model = "fixture"\nmodel_provider = "fixture"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\n[model_providers.fixture]\nname = "Local fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
  let child: ReturnType<typeof spawn> | undefined, exited: Promise<unknown> | undefined;
  let client: InstanceType<typeof CodexSharedClient> | undefined;
  let stderr = "";
  async function start() {
    child = spawn(process.env.CLAW3D_NATIVE_CODEX_BIN!, ["app-server", "--listen", `unix://${socket}`], {
      cwd: root, env: { ...process.env, CODEX_HOME: root }, stdio: ["ignore", "ignore", "pipe"],
    });
    exited = new Promise(resolve => child!.once("exit", resolve));
    child.stderr!.on("data", data => { stderr += String(data); });
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(socket)) {
      if (Date.now() > deadline) throw new Error("Native fixture did not start");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    client = new CodexSharedClient(socket, (frame: { method: string; params?: { turn?: { id: string } } }) => {
      if (frame.method === "turn/completed" && frame.params?.turn) completed.add(frame.params.turn.id);
    }); await client.initialize();
    return client;
  }
  async function stop() {
    client?.close(); client = undefined;
    child?.kill("SIGTERM"); await exited; child = undefined;
    fs.rmSync(socket, { force: true });
  }
  async function finish(turnId: string) {
    const deadline = Date.now() + 10000;
    while (!completed.has(turnId)) {
      if (Date.now() > deadline) throw new Error("Local model fixture did not finish");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  try {
    const first = await start();
    const created = await first.call("thread/start", {
      cwd: root, permissions: ":read-only", approvalPolicy: "on-request",
      dynamicTools: [{ name: "fixture_lookup", description: "Read-only fixture lookup", inputSchema: { type: "object", properties: {} } }],
    });
    expect(created.activePermissionProfile.id).toBe(":read-only");
    const id = created.thread.id;
    const firstTurn = await first.call("turn/start", { threadId: id, input: [{ type: "text", text: "Persist fixture" }] });
    await finish(firstTurn.turn.id);
    await stop();
    const second = await start();
    expect((await second.call("thread/loaded/list", {})).data).not.toContain(id);
    const controls = new CodexSessionControls(second);
    await controls.attach(id);
    const restored = await second.call("thread/resume", { threadId: id, excludeTurns: true });
    expect(restored.thread.id).toBe(id);
    expect(restored.cwd).toBe(root);
    expect(restored.model).toBe(created.model);
    expect(restored.approvalPolicy).toEqual(created.approvalPolicy);
    expect(restored.activePermissionProfile.id).toBe(":read-only");
    expect(controls.snapshot(id)).toMatchObject({ connected: true, activeTurnId: null, settings: { model: created.model, accessMode: ":read-only" } });
    const next = await controls.send(id, "Continue fixture", "cold-resume-fixture");
    await finish(next.turnId);
    expect((await second.call("thread/turns/list", { threadId: id })).data.map((turn: { id: string }) => turn.id)).toContain(firstTurn.turn.id);
    expect(requests).toHaveLength(2);
    for (const body of requests) expect(JSON.stringify(JSON.parse(body).tools)).toContain("fixture_lookup");
  } catch (error) { throw new Error(`${(error as Error).message}\n${stderr.slice(-1500)}`, { cause: error }); }
  finally {
    await stop(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);
