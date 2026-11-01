"use strict";
// Audio travels on native Codex WebRTC. Only session control crosses the web gateway.
class CodexOfficeVoice {
  constructor(client, controls, emit) { this.client = client; this.controls = controls; this.emit = emit; this.active = null; }
  async choices() {
    const result = await this.client.call("thread/realtime/listVoices", {});
    return { voices: result.voices?.v3 || [] };
  }
  async start(owner, threadId, sdp, voiceId, voice) {
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > 64000 || typeof voiceId !== "string" || !/^[a-f\d-]{36}$/i.test(voiceId)) throw new Error("语音连接参数无效");
    if (this.active) {
      if (this.active.owner === owner && this.active.voiceId === voiceId && this.active.threadId === threadId) return { status: "starting", voiceId };
      throw new Error("已有网页语音通话，请先结束它");
    }
    const session = { owner, threadId, voiceId };
    this.active = session;
    session.starting = (async () => {
      if (voice !== undefined && (typeof voice !== "string" || !(await this.choices()).voices.includes(voice))) throw new Error("This voice is unavailable. Choose another voice.");
      await this.controls.attach(threadId);
      if (this.active !== session || session.cancelled) throw new Error("语音连接已取消");
      await this.client.call("thread/realtime/start", { threadId, version: "v3", outputModality: "audio", transport: { type: "webrtc", sdp }, voiceSessionId: voiceId, flushTranscriptTailOnSessionEnd: true, ...(voice === undefined ? {} : { voice }) });
    })();
    try {
      await session.starting;
      if (session.cancelled) throw new Error("语音连接已取消");
      return { status: "started", voiceId };
    } catch (error) { if (this.active === session) this.active = null; throw error; }
  }
  handle(frame) {
    const active = this.active;
    if (!active || frame.params?.threadId !== active.threadId || !["thread/realtime/sdp", "thread/realtime/started", "thread/realtime/error", "thread/realtime/closed", "thread/realtime/transcript/delta", "thread/realtime/transcript/done"].includes(frame.method)) return;
    this.emit(active.owner, { threadId: active.threadId, voiceId: active.voiceId, method: frame.method, params: frame.params });
    if (frame.method === "thread/realtime/closed") this.active = null;
  }
  async stop(owner, threadId, voiceId) {
    const session = this.active;
    if (!session) return { status: "closed" };
    if (session.owner !== owner || session.threadId !== threadId || session.voiceId !== voiceId) throw new Error("这不是当前网页发起的语音通话");
    session.cancelled = true;
    try { await session.starting; } catch { return { status: "closed" }; }
    // Keep ownership until the stop is submitted, so another tab cannot race a new start.
    await this.client.call("thread/realtime/stop", { threadId });
    if (this.active === session) this.active = null;
    return { status: "closed" };
  }
  disconnected(owner) {
    const active = this.active;
    if (active?.owner === owner && !active.cancelled) void this.stop(owner, active.threadId, active.voiceId).catch(() => {});
  }
}
module.exports = { CodexOfficeVoice };
