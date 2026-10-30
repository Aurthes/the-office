// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { expect, it, vi } from "vitest";

const { CodexSharedClient } = createRequire(import.meta.url)("../../server/codex-shared-client.js");

it("detects missing native pongs and rejects uncertain requests without replay or touching the owner", async () => {
  const root = mkdtempSync(join(tmpdir(), "claw3d-pong-")), socket = join(root, "rpc.sock");
  const owner = createServer(), server = new WebSocketServer({ server: owner, autoPong: false });
  const methods: string[] = [], onFrame = vi.fn();
  let pulse!: () => void, client: InstanceType<typeof CodexSharedClient> | undefined;
  server.on("connection", ws => ws.on("message", raw => {
    const frame = JSON.parse(String(raw)); methods.push(frame.method);
    if (frame.method === "initialize") ws.send(JSON.stringify({ id: frame.id, result: {} }));
  }));
  owner.listen(socket); await once(owner, "listening"); chmodSync(socket, 0o600);
  const timer = vi.spyOn(globalThis, "setInterval").mockImplementation(callback => {
    pulse = callback as () => void;
    return { unref() {} } as ReturnType<typeof setInterval>;
  });
  try {
    client = new CodexSharedClient(socket, onFrame); await client.initialize();
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 30_000);
    const failed = expect(client.call("project/create", { name: "Uncertain" })).rejects.toThrow("未自动重试");
    const ws = [...server.clients][0];
    const ping = once(ws, "ping"); pulse(); await ping;
    const closed = once(client.ws, "close"); pulse(); await closed; await failed;
    expect(client.ready).toBe(false);
    expect(onFrame).toHaveBeenCalledExactlyOnceWith({ method: "connection/closed" });
    expect(methods.filter(method => method === "project/create")).toHaveLength(1);
    expect(owner.listening).toBe(true); // Only the adapter's client was terminated.
  } finally {
    client?.close(); timer.mockRestore();
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => owner.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
