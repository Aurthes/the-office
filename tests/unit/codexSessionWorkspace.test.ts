import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { CodexSessionWorkspace, OUTPUT_BYTES } = require("../../server/codex-session-workspace.js");
const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claw-workspace-")); roots.push(root);
  const client = { ready: true, call: vi.fn(async (method: string) => method === "fs/readDirectory" ? { entries: [{ fileName: "a.ts", isFile: true }, { fileName: "src", isDirectory: true }, { fileName: "../bad", isFile: true }] } : method === "fs/readFile" ? { dataBase64: Buffer.from("const answer = 42;").toString("base64") } : {}) };
  return { root, row: { id: "original", workspace: root }, client, workspace: new CodexSessionWorkspace(client) };
};
describe("native Codex workspace", () => {
  it("lists and reads through Codex, and rejects parent traversal, symlinks and oversized files", async () => {
    const { root, row, client, workspace } = setup(); fs.writeFileSync(path.join(root, "a.ts"), "const answer = 42;");
    expect((await workspace.files(row)).entries).toEqual([{ name: "src", directory: true }, { name: "a.ts", directory: false }]);
    expect(await workspace.file(row, "a.ts")).toMatchObject({ content: "const answer = 42;" });
    expect(client.call).toHaveBeenCalledWith("fs/readFile", { path: fs.realpathSync(path.join(root, "a.ts")) });
    await expect(workspace.files(row, "..")).rejects.toThrow("outside");
    fs.symlinkSync(os.tmpdir(), path.join(root, "outside")); await expect(workspace.files(row, "outside")).rejects.toThrow("outside");
    fs.writeFileSync(path.join(root, "large.txt"), Buffer.alloc(300000, 65)); await expect(workspace.file(row, "large.txt")).rejects.toThrow("too large");
  });
  it("reuses the protected preview reference for supported files", async () => {
    const { root, row, workspace } = setup(); const prior = process.env.CLAW3D_GATEWAY_TOKEN; process.env.CLAW3D_GATEWAY_TOKEN = "test-only";
    try { fs.writeFileSync(path.join(root, "sample.html"), "<p>Preview</p>"); expect(await workspace.file(row, "sample.html")).toMatchObject({ asset: { kind: "html", url: expect.stringContaining("/api/session-assets?ref=") } }); }
    finally { if (prior === undefined) delete process.env.CLAW3D_GATEWAY_TOKEN; else process.env.CLAW3D_GATEWAY_TOKEN = prior; }
  });
  it("deduplicates terminal creation and reconnects to the same process without spawning again", async () => {
    const { row, client, workspace } = setup(); const first = await Promise.all([workspace.start(row), workspace.start(row)]);
    expect(first[0].handle).toBe(first[1].handle); expect(client.call.mock.calls.filter(([method]) => method === "process/spawn")).toHaveLength(1);
    const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() };
    workspace.subscribe(ws, row.id); workspace.disconnected(ws); expect(workspace.subscribe(ws, row.id).handle).toBe(first[0].handle);
    await expect(workspace.write("other-chat", first[0].handle, "YQ==")).rejects.toThrow("ended");
    await workspace.write(row.id, first[0].handle, "YQ=="); expect(client.call).toHaveBeenCalledWith("process/writeStdin", { processHandle: first[0].handle, deltaBase64: "YQ==" });
  });
  it("bounds and batches output, ignores unrelated processes and resynchronizes slow clients", async () => {
    vi.useFakeTimers(); const { row, workspace } = setup(); const state = await workspace.start(row);
    const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() }; workspace.subscribe(ws, row.id);
    const output = (handle: string, content: Buffer) => workspace.handle({ method: "process/outputDelta", params: { processHandle: handle, deltaBase64: content.toString("base64") } });
    output("other-owner", Buffer.from("private")); output(state.handle, Buffer.alloc(OUTPUT_BYTES * 3, 65)); output(state.handle, Buffer.from("last output"));
    expect(ws.send).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(30);
    expect(ws.send).toHaveBeenCalledTimes(1); const update = JSON.parse(ws.send.mock.calls[0][0]).payload;
    expect(Buffer.from(update.dataBase64, "base64")).toHaveLength(OUTPUT_BYTES); expect(update.reset).toBe(true);
    expect(Buffer.from(workspace.snapshot(row.id).dataBase64, "base64").toString().endsWith("last output")).toBe(true);
    ws.bufferedAmount = 1024 * 1024; output(state.handle, Buffer.from("backpressure")); await vi.advanceTimersByTimeAsync(30);
    expect(ws.close).toHaveBeenCalledWith(1013, expect.any(String)); expect(workspace.snapshot(row.id).running).toBe(true);
  });
  it("stops only its own manual terminals during gateway shutdown", async () => {
    const { row, client, workspace } = setup(); const terminal = await workspace.start(row); await workspace.close();
    expect(client.call).toHaveBeenCalledWith("process/kill", { processHandle: terminal.handle });
    expect(client.call.mock.calls.some(([method]) => method === "turn/interrupt")).toBe(false);
  });
  it("does not create another shell when a native spawn acknowledgement times out", async () => {
    const { row, client, workspace } = setup(); client.call.mockRejectedValueOnce(new Error("timeout; outcome unknown"));
    await expect(workspace.start(row)).rejects.toThrow("unknown");
    expect((await workspace.start(row)).running).toBe(true);
    expect(client.call.mock.calls.filter(([method]) => method === "process/spawn")).toHaveLength(1);
  });
  it("preserves stdin order and discards a queued suffix after an unknown write outcome", async () => {
    const { row, client, workspace } = setup(); const terminal = await workspace.start(row);
    let reject!: (error: Error) => void;
    client.call.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const first = workspace.write(row.id, terminal.handle, "YQ==");
    const second = workspace.write(row.id, terminal.handle, "Yg==");
    const settled = Promise.allSettled([first, second]);
    await Promise.resolve(); expect(client.call.mock.calls.filter(([method]) => method === "process/writeStdin")).toHaveLength(1);
    reject(new Error("unknown result")); expect((await settled).every(result => result.status === "rejected")).toBe(true);
    expect(client.call.mock.calls.filter(([method]) => method === "process/writeStdin")).toHaveLength(1);
    workspace.subscribe({}, row.id); await workspace.write(row.id, terminal.handle, "Yw==");
    expect(client.call.mock.calls.filter(([method]) => method === "process/writeStdin")).toHaveLength(2);
  });
  it("also bounds ended terminal previews when no browser is subscribed", async () => {
    const { row, workspace } = setup();
    for (let i = 0; i < 20; i++) {
      const terminal = await workspace.start({ ...row, id: `closed-${i}` });
      workspace.handle({ method: "process/exited", params: { processHandle: terminal.handle, exitCode: 0 } });
    }
    expect(workspace.terminals.size).toBe(16);
  });
});
