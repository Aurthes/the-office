// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { CodexSharedClient } = require("../../server/codex-shared-client.js");
const { CodexSessionControls } = require("../../server/codex-session-controls.js");
type UserMessage = { type: string; id: string; clientId?: string; content?: { type: string; text: string }[] };
type Frame = { method: string; params?: { item?: UserMessage } };
async function until(predicate: () => boolean) {
  const end = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Native message fixture timed out");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
describe.skipIf(!process.env.CLAW3D_NATIVE_CODEX_BIN)("pinned native message identity", () => {
  it("broadcasts an external steer identity and keeps it in the original turn's history without duplicate sends", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claw-native-messages-"));
    const socket = path.join(root, "native.sock"), events: Frame[] = [];
    let releaseFirst: (() => void) | undefined, requests = 0;
    // A local Responses fixture holds the first request so steering happens
    // inside the active turn. It uses no real account or model service.
    const provider = http.createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        const id = `response_${++requests}`;
        response.writeHead(200, { "content-type": "text/event-stream" });
        const event = (value: unknown) => response.write(`data: ${JSON.stringify(value)}\n\n`);
        event({ type: "response.created", response: { id } });
        const finish = () => {
          const item = { id: `message_${requests}`, type: "message", role: "assistant", content: [{ type: "output_text", text: "Fixture reply" }] };
          event({ type: "response.output_item.done", output_index: 0, item });
          event({ type: "response.completed", response: { id, output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
          response.end();
        };
        if (requests === 1) releaseFirst = finish; else finish();
      });
    });
    await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
    const port = (provider.address() as { port: number }).port;
    fs.writeFileSync(path.join(root, "config.toml"), `model = "fixture"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[model_providers.fixture]\nname = "Local fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
    const child = spawn(process.env.CLAW3D_NATIVE_CODEX_BIN!, ["app-server", "--listen", `unix://${socket}`], {
      cwd: root, env: { ...process.env, CODEX_HOME: root }, stdio: ["ignore", "ignore", "pipe"],
    });
    const exited = new Promise(resolve => child.once("exit", resolve));
    let writer: InstanceType<typeof CodexSharedClient>, observer: InstanceType<typeof CodexSharedClient>;
    let stderr = ""; child.stderr.on("data", data => { stderr += String(data); });
    try {
      await until(() => fs.existsSync(socket));
      writer = new CodexSharedClient(socket);
      observer = new CodexSharedClient(socket, (frame: Frame) => events.push(frame));
      await Promise.all([writer.initialize(), observer.initialize()]);
      const { thread } = await writer.call("thread/start", { cwd: root });
      // Native threads are persisted lazily on their first prompt. Start that
      // prompt before attaching a second client to the existing conversation.
      const { turn } = await writer.call("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Initial prompt" }], clientUserMessageId: "native-start" });
      await until(() => releaseFirst !== undefined);
      await observer.call("thread/resume", { threadId: thread.id, excludeTurns: true });
      const controls = new CodexSessionControls(writer);
      const steered = await controls.send(thread.id, "The duck is yellow", "office-steer");
      expect(steered).toEqual({ status: "steered", turnId: turn.id });
      releaseFirst!();
      await until(() => events.some(frame => frame.method === "turn/completed"));
      const liveUsers = events.filter(frame => frame.method === "item/completed" && frame.params?.item?.type === "userMessage").map(frame => frame.params!.item!);
      expect(liveUsers.map(item => item.clientId)).toEqual(["office-steer"]);
      expect(liveUsers[0].content).toEqual([expect.objectContaining({ type: "text", text: "The duck is yellow" })]);
      const history = await observer.call("thread/turns/list", { threadId: thread.id, limit: 1, itemsView: "full" });
      const users = history.data[0].items.filter((item: UserMessage) => item.type === "userMessage");
      expect(history.data[0].id).toBe(turn.id);
      expect(users.map((item: UserMessage) => item.clientId)).toEqual(["native-start", "office-steer"]);
      const requestCount = requests;
      expect(await controls.send(thread.id, "The duck is yellow", "office-steer")).toEqual(steered);
      expect(requests).toBe(requestCount);
      expect(events.filter(frame => frame.method === "turn/started")).toHaveLength(0);
    } catch (error) { throw new Error(`${(error as Error).message}\n${stderr.slice(-1500)}`, { cause: error }); }
    finally {
      writer?.close(); observer?.close(); child.kill("SIGTERM"); await exited;
      provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
});
