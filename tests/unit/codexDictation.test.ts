// @vitest-environment node
import { EventEmitter } from "node:events";
import { createServer, request } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { readPcm, transcribeNative, createDictationHandler, NativeDictationSessions } from "../../server/codex-dictation";
function wav() {
  const b = Buffer.alloc(6444); b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(6400, 40); return b;
}
const account = "test-account", token = "x." + Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url") + ".sig";
const native = () => ({ ready: true, userAgent: "native-owner/test", call: vi.fn(async () => ({ authMethod: "chatgpt", authToken: token })) });
describe("native dictation", () => {
  it("binds ordered audio chunks to their browser connection and releases on disconnect", async () => {
    const transport = { done: new Promise(() => {}), append: vi.fn(), finish: vi.fn(async () => ({ text: "native" })), cancel: vi.fn() };
    const sessions = new NativeDictationSessions(native(), async () => transport);
    const owner = {}, other = {}, p = { threadId: "original", id: "00000000-0000-0000-0000-000000000001", sequence: 0, audio: "AAAAAA==" };
    await sessions.start(owner, p.threadId, p.id);
    expect(() => sessions.append(other, p)).toThrow("当前网页");
    expect(() => sessions.append(owner, { ...p, sequence: 2 })).toThrow("不完整");
    sessions.append(owner, p); expect(transport.append).toHaveBeenCalledOnce();
    expect(await sessions.finish(owner, { ...p, sequence: 1 })).toEqual({ text: "native" });
    expect(sessions.sessions.size).toBe(0);
    await sessions.start(owner, p.threadId, p.id); sessions.disconnected(owner);
    expect(sessions.sessions.size).toBe(0); expect(transport.cancel).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed or non-native PCM before reading credentials", async () => {
    const client = native(), bad = wav(); bad.writeUInt16LE(2, 22);
    await expect(transcribeNative(client, bad, undefined)).rejects.toThrow("16 kHz");
    expect(client.call).not.toHaveBeenCalled(); expect(readPcm(wav()).length).toBe(6400);
    expect(() => readPcm(wav().subarray(0, 60))).toThrow("不完整");
  });
  it("uses native auth routing, orders utterances and waits for clean completion", async () => {
    let options: { headers: Record<string, string> }, url = "";
    class Socket extends EventEmitter {
      readyState = 1; bufferedAmount = 0;
      constructor(target: string, _protocols: string[], config: typeof options) { super(); options = config; url = target; queueMicrotask(() => this.emit("open")); }
      send(raw: string, done?: (error?: Error) => void) {
        const frame = JSON.parse(raw); done?.();
        if (frame.type === "session.start") queueMicrotask(() => this.emit("message", JSON.stringify({ type: "session.started" })));
        if (frame.type === "session.close") queueMicrotask(() => {
          const emit = (event: object) => this.emit("message", JSON.stringify(event));
          emit({ type: "speech.started", utterance_id: "first" }); emit({ type: "speech.started", utterance_id: "second" });
          emit({ type: "transcript.final", utterance_id: "second", revision: 1, text: "two" });
          emit({ type: "transcript.final", utterance_id: "first", revision: 2, text: "one" });
          emit({ type: "transcript.final", utterance_id: "first", revision: 1, text: "stale" });
          this.emit("close", 1000);
        });
      }
      terminate() {}
    }
    const client = native();
    const result = await transcribeNative(client, wav(), undefined, { Socket: Socket as never, proxy: "" });
    expect(result).toEqual({ text: "one two" }); expect(url).toContain("/backend-api/dictation/stream");
    expect(options!.headers["ChatGPT-Account-Id"]).toBe(account); expect(options!.headers.Authorization).toBe("Bearer " + token);
    expect(client.call).toHaveBeenCalledOnce(); expect(client.call).toHaveBeenCalledWith("getAuthStatus", { includeToken: true, refreshToken: false });
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it("does not return partial text after a broken connection", async () => {
    class Socket extends EventEmitter {
      constructor() { super(); queueMicrotask(() => { this.emit("message", JSON.stringify({ type: "transcript.final", utterance_id: "a", revision: 1, text: "partial" })); this.emit("close", 1006); }); }
      terminate() {}
    }
    await expect(transcribeNative(native(), wav(), undefined, { Socket: Socket as never, proxy: "" })).rejects.toThrow("提前结束");
  });
  it("authenticates HTTP uploads and rejects the wrong thread before transcription", async () => {
    const transcribe = vi.fn(async () => ({ text: "native text" }));
    const handler = createDictationHandler({ client: native(), token: "owner", findThread: (id: string) => { if (id !== "original") throw Error("missing"); }, transcribe });
    const server = createServer(handler); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const post = (auth: string, id: string) => new Promise<number>((resolve, reject) => {
      const q = request({ hostname: "127.0.0.1", port, path: "/dictation?threadId=" + id, method: "POST", headers: { Authorization: auth } }, r => { r.resume(); r.on("end", () => resolve(r.statusCode!)); }); q.on("error", reject); q.end(wav());
    });
    try {
      expect(await post("", "original")).toBe(401); expect(await post("Bearer owner", "wrong")).toBe(404); expect(transcribe).not.toHaveBeenCalled();
      expect(await post("Bearer owner", "original")).toBe(200); expect(transcribe).toHaveBeenCalledOnce();
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
