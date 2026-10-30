import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const { CodexSessionVoice } = createRequire(import.meta.url)("../../server/codex-session-voice.js");
const voiceId = "11111111-1111-4111-8111-111111111111";
const setup = () => { const client = { call: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async () => ({})) }, controls = { attach: vi.fn(async () => {}) }, emit = vi.fn(); return { client, controls, emit, voice: new CodexSessionVoice(client, controls, emit) }; };
describe("native realtime voice ownership", () => {
  it("starts native WebRTC on the original thread and routes SDP only to its owner", async () => {
    const { voice, client, controls, emit } = setup();
    await voice.start("tab1", "original", "v=0\no=offer", voiceId);
    expect(controls.attach).toHaveBeenCalledWith("original");
    expect(client.call).toHaveBeenCalledWith("thread/realtime/start", { threadId: "original", version: "v3", outputModality: "audio", transport: { type: "webrtc", sdp: "v=0\no=offer" }, voiceSessionId: voiceId, flushTranscriptTailOnSessionEnd: true });
    voice.handle({ method: "thread/realtime/sdp", params: { threadId: "other", sdp: "private" } });
    expect(emit).not.toHaveBeenCalled();
    voice.handle({ method: "thread/realtime/sdp", params: { threadId: "original", sdp: "answer" } });
    expect(emit).toHaveBeenCalledWith("tab1", expect.objectContaining({ voiceId, params: { threadId: "original", sdp: "answer" } }));
    await voice.start("tab1", "original", "v=0\no=offer", voiceId);
    expect(client.call).toHaveBeenCalledTimes(1);
  });
  it("prevents another tab from replacing or stopping a call, and never interrupts the Codex turn", async () => {
    const { voice, client } = setup();
    await voice.start("tab1", "original", "v=0", voiceId);
    await expect(voice.start("tab2", "other", "v=0", voiceId)).rejects.toThrow("已有");
    await expect(voice.stop("tab2", "original", voiceId)).rejects.toThrow("不是");
    await voice.stop("tab1", "original", voiceId);
    expect(client.call).toHaveBeenLastCalledWith("thread/realtime/stop", { threadId: "original" });
    expect(client.call.mock.calls.some(([method]) => method === "turn/interrupt")).toBe(false);
  });
  it("ends the owned call on disconnect and releases a failed start", async () => {
    const { voice, client } = setup();
    client.call.mockRejectedValueOnce(new Error("native unavailable"));
    await expect(voice.start("tab1", "original", "v=0", voiceId)).rejects.toThrow("unavailable");
    await voice.start("tab1", "original", "v=0", voiceId);
    voice.disconnected("unrelated"); expect(client.call).toHaveBeenCalledTimes(2);
    voice.disconnected("tab1");
    expect(client.call).toHaveBeenLastCalledWith("thread/realtime/stop", { threadId: "original" });
  });
  it("does not let another tab replace a call after an uncertain stop", async () => {
    const { voice, client } = setup();
    await voice.start("tab1", "original", "v=0", voiceId);
    client.call.mockRejectedValueOnce(new Error("timeout"));
    await expect(voice.stop("tab1", "original", voiceId)).rejects.toThrow("timeout");
    await expect(voice.start("tab2", "other", "v=0", voiceId)).rejects.toThrow("已有");
    voice.handle({ method: "thread/realtime/closed", params: { threadId: "original" } });
    await voice.start("tab2", "other", "v=0", voiceId);
  });
});
