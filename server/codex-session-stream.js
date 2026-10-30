"use strict";

// A selected chat owns one bounded subscription per authenticated WebSocket.
// All content travels in server events; the browser never polls session.live.
class CodexSessionStream {
  constructor(controls, { delay = 40, maxBufferedBytes = 1024 * 1024 } = {}) {
    this.controls = controls;
    this.delay = delay;
    this.maxBufferedBytes = maxBufferedBytes;
    this.subscriptions = new Map();
  }
  async subscribe(ws, threadId, subscriptionId) {
    if (typeof subscriptionId !== "string" || !subscriptionId || subscriptionId.length > 100) throw new Error("Invalid session subscription");
    this.disconnected(ws);
    const entry = { ws, threadId, subscriptionId, version: -1, items: new Map(), ready: false, timer: null };
    this.subscriptions.set(ws, entry);
    try { await this.controls.attach(threadId); }
    catch (error) { if (this.subscriptions.get(ws) === entry) this.disconnected(ws); throw error; }
    if (this.subscriptions.get(ws) !== entry) return { subscribed: false, subscriptionId };
    entry.ready = true;
    // Bootstrap is an event too. Scheduling yields until the subscribe RPC ack
    // has been sent, and captures native changes received during attachment.
    this.schedule(entry, 0);
    return { subscribed: true, subscriptionId };
  }
  unsubscribe(ws, subscriptionId) {
    if (this.subscriptions.get(ws)?.subscriptionId === subscriptionId) this.disconnected(ws);
    return { unsubscribed: true };
  }
  disconnected(ws) {
    const entry = this.subscriptions.get(ws);
    if (entry?.timer) clearTimeout(entry.timer);
    this.subscriptions.delete(ws);
  }
  changed(threadId) {
    for (const entry of this.subscriptions.values()) if (entry.threadId === threadId && entry.ready) this.schedule(entry, this.delay);
  }
  schedule(entry, delay) {
    if (entry.timer || this.subscriptions.get(entry.ws) !== entry) return;
    entry.timer = setTimeout(() => { entry.timer = null; this.flush(entry); }, delay);
  }
  refresh() { for (const entry of this.subscriptions.values()) if (entry.ready) this.schedule(entry); }
  flush(entry) {
    const { ws, threadId, subscriptionId } = entry;
    if (this.subscriptions.get(ws) !== entry) return;
    if (ws.readyState !== 1) return this.disconnected(ws);
    try {
      const snapshot = this.controls.snapshot(threadId, Math.max(0, entry.version));
      if (snapshot.version === entry.version) return;
      const items = snapshot.items.map(item => {
        const previous = entry.items.get(item.id);
        entry.items.set(item.id, item);
        // Native completion is authoritative, including shorter replacement
        // text. Only an in-progress prefix extension may travel as an append.
        if (previous && item.role === "assistant" && item.status !== "completed" && item.content.startsWith(previous.content)) {
          const patch = { ...item, append: item.content.slice(previous.content.length), baseVersion: previous.version };
          delete patch.content;
          return patch;
        }
        return item;
      });
      while (entry.items.size > 128) entry.items.delete(entry.items.keys().next().value);
      const frame = JSON.stringify({ type: "event", event: "session.stream", payload: { ...snapshot, threadId, subscriptionId, items } });
      if (ws.bufferedAmount + Buffer.byteLength(frame) > this.maxBufferedBytes) {
        this.disconnected(ws); ws.close(1013, "Session stream backpressure; reconnect to resync"); return;
      }
      ws.send(frame); entry.version = snapshot.version;
      // Drain one bounded frame per event-loop turn, never asking the browser
      // to pull another chunk or advancing past omitted items.
      if (snapshot.hasMore) this.schedule(entry, 0);
    } catch {
      this.disconnected(ws); ws.close(1011, "Session stream unavailable; reconnect to resync");
    }
  }
}
module.exports = { CodexSessionStream };
