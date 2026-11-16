"use strict";
// Audio travels on native Codex WebRTC. Only session control crosses the web gateway.
class CodexOfficeVoice {
  constructor(client, controls, emit) { this.client = client; this.controls = controls; this.emit = emit; this.active = null; this.last = null; this.nativeOwners = new Map(); }
  identify(session, nativeId) {
    const key = `${session.threadId}:${nativeId}`;
    const previous = this.nativeOwners.get(key);
    session.reused = session.reused || Boolean(previous && previous !== session.voiceId);
    session.realtimeSessionId = nativeId;
    this.nativeOwners.set(key, session.voiceId);
    if (this.nativeOwners.size > 64) this.nativeOwners.delete(this.nativeOwners.keys().next().value);
  }
  async choices() {
    const result = await this.client.call("thread/realtime/listVoices", {});
    return { voices: result.voices?.v3 || [] };
  }
  async start(owner, threadId, sdp, voiceId, voice, brief) {
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > 64000 || typeof voiceId !== "string" || !/^[a-f\d-]{36}$/i.test(voiceId)) throw new Error("语音连接参数无效");
    if (this.active) {
      if (this.active.owner === owner && this.active.voiceId === voiceId && this.active.threadId === threadId) return { status: "starting", voiceId };
      throw new Error("已有网页语音通话，请先结束它");
    }
    const session = { owner, threadId, voiceId, items: new Set(), pending: [] };
    this.active = session;
    session.starting = (async () => {
      if (voice !== undefined && (typeof voice !== "string" || !(await this.choices()).voices.includes(voice))) throw new Error("This voice is unavailable. Choose another voice.");
      await this.controls.attach(threadId);
      if (this.active !== session || session.cancelled) throw new Error("语音连接已取消");
      await this.client.call("thread/realtime/start", { threadId, version: "v3", outputModality: "audio", transport: { type: "webrtc", sdp }, voiceSessionId: voiceId, flushTranscriptTailOnSessionEnd: true, ...(brief ? { officeNotificationBrief: { id: brief.id, title: brief.title, brief: brief.brief } } : {}), ...(voice === undefined ? {} : { voice }) });
    })();
    try {
      await session.starting;
      if (session.cancelled) throw new Error("语音连接已取消");
      return { status: "started", voiceId };
    } catch (error) { if (this.active === session) this.active = null; throw error; }
  }
  handle(frame) {
    if (frame.method === "thread/realtime/item/completed") {
      const item = frame.params?.item, threadId = frame.params?.threadId;
      if (!item || typeof item.id !== "string" || typeof item.realtimeSessionId !== "string") return;
      const candidates = [this.active, this.last].filter(s => s && s.threadId === threadId);
      const known = candidates.find(s => s.items.has(item.id));
      const active = this.active?.threadId === threadId ? this.active : null;
      let session = known;
      if (!session && item.type === "realtimeSessionStarted" && active && !active.boundaryId) {
        session = active; session.boundaryId = item.id; this.identify(session, item.realtimeSessionId);
      }
      if (!session && active && !active.realtimeSessionId) {
        if (active.pending.length < 128) active.pending.push(frame);
        return;
      }
      const matching = candidates.filter(s => s.realtimeSessionId === item.realtimeSessionId);
      if (!session && matching.length === 1 && !matching[0].reused) session = matching[0];
      if (!session && matching.length) {
        // A reused native ID cannot identify an unseen late segment. The ordered
        // canonical timeline, including started/closed items, can resolve it.
        for (const target of matching) this.emit(target.owner, { threadId, voiceId: target.voiceId, method: "thread/realtime/transcript/refresh", params: {} });
        return;
      }
      if (session && ["transcriptSegment", "realtimeSessionStarted", "realtimeSessionClosed"].includes(item.type)) {
        session.items.add(item.id);
        if (session.items.size > 512) session.items.delete(session.items.values().next().value);
        this.emit(session.owner, { threadId, voiceId: session.voiceId, method: frame.method, params: frame.params });
        if (item.type === "realtimeSessionStarted") {
          const pending = session.pending.splice(0); for (const entry of pending) this.handle(entry);
        }
      }
      return;
    }
    const active = this.active;
    if (!active || frame.params?.threadId !== active.threadId || !["thread/realtime/sdp", "thread/realtime/started", "thread/realtime/error", "thread/realtime/closed", "thread/realtime/transcript/delta", "thread/realtime/transcript/done"].includes(frame.method)) return;
    if (frame.method === "thread/realtime/closed" && this.last?.threadId === active.threadId && this.last.realtimeSessionId && this.last.realtimeSessionId === active.realtimeSessionId) {
      // Anonymous close has no generation identity. Verify the canonical
      // boundary rather than terminating a newer call on a late old close.
      this.emit(active.owner, { threadId: active.threadId, voiceId: active.voiceId, method: "thread/realtime/transcript/refresh", params: {} });
      return;
    }
    if (frame.method === "thread/realtime/started" && active.boundaryId && active.realtimeSessionId !== frame.params.realtimeSessionId) return;
    if (frame.method === "thread/realtime/started" && typeof frame.params.realtimeSessionId === "string") this.identify(active, frame.params.realtimeSessionId);
    this.emit(active.owner, { threadId: active.threadId, voiceId: active.voiceId, method: frame.method, params: frame.params });
    if (frame.method === "thread/realtime/started") { const pending = active.pending.splice(0); for (const entry of pending) this.handle(entry); }
    if (frame.method === "thread/realtime/closed") { this.last = active; this.active = null; }
  }
  async stop(owner, threadId, voiceId) {
    const session = this.active;
    if (!session) return { status: "closed" };
    if (session.owner !== owner || session.threadId !== threadId || session.voiceId !== voiceId) throw new Error("这不是当前网页发起的语音通话");
    session.cancelled = true;
    try { await session.starting; } catch { return { status: "closed" }; }
    // Keep ownership until the stop is submitted, so another tab cannot race a new start.
    await this.client.call("thread/realtime/stop", { threadId });
    if (this.active === session) { this.last = session; this.active = null; }
    return { status: "closed" };
  }
  disconnected(owner) {
    const active = this.active;
    if (active?.owner === owner && !active.cancelled) void this.stop(owner, active.threadId, active.voiceId).catch(() => {});
  }
}
module.exports = { CodexOfficeVoice };
