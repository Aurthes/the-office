// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { WebSocket } from "ws";

const { createGatewayClient } = createRequire(import.meta.url)("../../server/office-todo-mcp.js");

it("disables prediction discovery, streams and repeated legacy requests at the real gateway without sampling", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-prediction-off-"));
  const native = path.join(root, "fake-native"), calls = path.join(root, "calls.jsonl");
  fs.writeFileSync(native, `#!/usr/bin/env node
const fs=require("node:fs"),readline=require("node:readline");
readline.createInterface({input:process.stdin}).on("line",line=>{
  const f=JSON.parse(line);if(f.id===undefined)return;
  fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify({method:f.method})+"\\n");
  const result=f.method==="account/read"?{account:{type:"chatgpt",planType:"pro"},requiresOpenaiAuth:true}:f.method==="model/list"?{data:[]}:{};
  process.stdout.write(JSON.stringify({id:f.id,result})+"\\n");
}).on("close",()=>process.exit(0));
`, { mode: 0o700 });
  const listener = net.createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = (listener.address() as net.AddressInfo).port; await new Promise<void>(resolve => listener.close(() => resolve()));
  const token = "fixture-only-token", gateway = spawn(process.execPath, [path.resolve("server/codex-office-gateway.js")], {
    env: { ...process.env, HOME: root, NODE_ENV: "test", OPENAI_API_KEY: "", CODEX_API_KEY: "", CODEX_HOME: path.join(root, "source"), CLAW3D_CODEX_CONFIG_HOME: path.join(root, "source"), CLAW3D_OFFICE_DATA_DIR: path.join(root, "office"), CLAW3D_OFFICE_CODEX_HOME: path.join(root, "office/codex"), CLAW3D_GATEWAY_TOKEN: token, CLAW3D_CODEX_BIN: native, CODEX_ADAPTER_PORT: String(port), FIXTURE_CALLS: calls },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = ""; gateway.stderr.on("data", bytes => { errors += bytes; });
  const exited = once(gateway, "exit");
  const client = createGatewayClient({ address: `ws://127.0.0.1:${port}`, token });
  let socket: WebSocket | undefined;
  try {
    const deadline = Date.now() + 8000;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      if (gateway.exitCode !== null) throw new Error(`Fixture gateway exited: ${errors}`);
      try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { /* wait for own fixture */ }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(ready, errors).toBe(true);
    const status = await client.call("status", {});
    expect(status.features.prediction).toBe(false);
    expect(status.features.composer).toBe(true);
    const id = status.sessions.recent[0].key.split(":")[1];
    const events: Array<{ event?: string; payload?: { features?: { prediction?: boolean } } }> = [];
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.on("message", bytes => { events.push(JSON.parse(String(bytes))); });
    await once(socket, "open");
    socket.send(JSON.stringify({ type: "req", id: "connect", method: "connect", params: { auth: { token } } }));
    await new Promise(resolve => setTimeout(resolve, 20));
    socket.send(JSON.stringify({ type: "req", id: "subscribe", method: "session.subscribe", params: { threadId: id, subscriptionId: "fixture-stream" } }));
    const streamDeadline = Date.now() + 2000;
    while (!events.some(e => e.event === "session.stream") && Date.now() < streamDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    expect(events.find(e => e.event === "session.stream")?.payload?.features?.prediction).toBe(false);
    for (let n = 0; n < 6; n++) {
      expect(await client.call("session.prediction", { threadId: id, requestId: `old-tab-${n}`, generationTrigger: n % 2 ? "live" : "catch_up" })).toBeNull();
    }
    client.close();
    const reopened = createGatewayClient({ address: `ws://127.0.0.1:${port}`, token });
    try { expect(await reopened.call("session.prediction", { threadId: id, requestId: "reconnected-tab" })).toBeNull(); }
    finally { reopened.close(); }
    const methods = fs.readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line).method);
    expect(methods).not.toContain("thread/sample");
    expect(methods).not.toContain("turn/start");
  } finally {
    client.close(); socket?.terminate();
    if (gateway.exitCode === null) gateway.kill("SIGTERM");
    const timer = setTimeout(() => { if (gateway.exitCode === null) gateway.kill("SIGKILL"); }, 3000);
    await exited; clearTimeout(timer); fs.rmSync(root, { recursive: true, force: true });
  }
}, 15000);
