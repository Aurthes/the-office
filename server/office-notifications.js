"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const webpush = require("web-push");
const { readIdentity, writePrivate } = require("./office-push-identity");
const DAY = 86400000;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function subscription(value) {
  if (!value || typeof value.endpoint !== "string" || value.endpoint.length > 2048) throw new Error("Invalid push subscription");
  let url; try { url = new URL(value.endpoint); } catch { throw new Error("Invalid push endpoint"); }
  const host = url.hostname;
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !(
    host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host === "push.services.mozilla.com" ||
    host === "web.push.apple.com" || /^[a-z0-9-]+\.push\.apple\.com$/.test(host) ||
    host === "wns2-par02p.notify.windows.com" || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host)
  )) throw new Error("Untrusted push provider");
  const keys = value.keys;
  if (!keys || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth) || Buffer.from(keys.p256dh, "base64url").length !== 65 || Buffer.from(keys.auth, "base64url").length !== 16) throw new Error("Invalid push keys");
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
class OfficeNotifications {
  constructor(directory, { actor, owner, now = Date.now, send = webpush.sendNotification, changed = () => {}, mergeMs = 1500 } = {}) {
    this.actor = actor; this.owner = owner; this.now = now; this.send = send; this.changed = changed; this.mergeMs = mergeMs;
    this.filename = path.join(directory, "important-notifications.json");
    const keysFile = path.join(directory, "push-vapid.json");
    try {
      if (!fs.existsSync(keysFile)) writePrivate(keysFile, webpush.generateVAPIDKeys());
      this.keys = JSON.parse(fs.readFileSync(keysFile, "utf8"));
      if (typeof this.keys.publicKey !== "string" || typeof this.keys.privateKey !== "string") throw new Error("Invalid keys");
      this.data = fs.existsSync(this.filename) ? JSON.parse(fs.readFileSync(this.filename, "utf8")) : { events: [], subscriptions: [] };
      if (!Array.isArray(this.data.events) || !Array.isArray(this.data.subscriptions) || this.data.events.length > 256 || this.data.subscriptions.length > 128) throw new Error("Invalid notification state");
      if (this.data.events.some(e => !e || typeof e.id !== "string" || !Number.isInteger(e.version) || !Number.isFinite(e.updatedAt) || !e.content || typeof e.content.brief !== "string" || !e.delivery || typeof e.delivery !== "object" || Object.values(e.delivery).some(d => !d || !Number.isFinite(d.due) || !Number.isInteger(d.attempts))) || this.data.subscriptions.some(s => !s || typeof s.id !== "string" || !s.subscription || typeof s.owner !== "string" || typeof s.device !== "string" || typeof s.origin !== "string")) throw new Error("Invalid notification records");
    } catch {
      // Broken optional reminder state must not prevent chat/Gateway startup.
      // Preserve the original files for recovery; never rotate keys silently.
      this.unavailable = true; this.data = { events: [], subscriptions: [] };
    }
    this.writes = Promise.resolve(); this.closed = false;
    this.wake();
  }
  assertReady() { if (this.unavailable) throw new Error("Reminder storage is unavailable; chat remains available"); }
  async persist() {
    this.assertReady();
    const snapshot = JSON.stringify(this.data);
    if (Buffer.byteLength(snapshot) > 2 * 1024 * 1024) throw new Error("Notification storage limit reached");
    const write = this.writes.then(async () => {
      const temporary = this.filename + "." + crypto.randomUUID() + ".tmp";
      try { await fsp.writeFile(temporary, snapshot, { mode: 0o600, flag: "wx" }); await fsp.rename(temporary, this.filename); }
      finally { await fsp.unlink(temporary).catch(() => {}); }
    });
    this.writes = write.catch(() => {}); return write;
  }
  async identity(raw, secret) {
    this.assertReady();
    const value = readIdentity(raw, secret);
    if (!value || !(await this.owner(value)).valid) throw new Error("Sign in to the website to manage reminders");
    return value;
  }
  async settings(identity) {
    this.assertReady();
    const row = this.data.subscriptions.find(s => s.owner === identity.owner && s.origin === identity.origin && s.device === identity.device);
    return { publicKey: this.keys.publicKey, enabled: Boolean(row), lastError: row?.lastError || null };
  }
  async subscribe(identity, raw) {
    this.assertReady();
    const value = subscription(raw);
    const key = hash(identity.owner + identity.origin + identity.device + this.keys.publicKey);
    const prior = this.data.subscriptions.find(s => s.id === key);
    const duplicate = this.data.subscriptions.find(s => s.subscription.endpoint === value.endpoint && s.id !== key);
    if (duplicate) {
      // A renewed login can reclaim the same browser subscription for this owner
      // and origin. Cross-owner moves require the former binding to be revoked.
      const sameInstallation = duplicate.owner === identity.owner && duplicate.origin === identity.origin && JSON.stringify(duplicate.subscription.keys) === JSON.stringify(value.keys);
      if (!sameInstallation && (await this.owner(duplicate)).valid) throw new Error("This subscription belongs to another login or installation; unsubscribe it first");
      this.data.subscriptions = this.data.subscriptions.filter(s => s.id !== duplicate.id);
    }
    if (!prior && this.data.subscriptions.length >= 128) throw new Error("Too many notification devices; remove an old subscription first");
    this.data.subscriptions = this.data.subscriptions.filter(s => s.id !== key);
    this.data.subscriptions.push({ ...identity, id: key, subscription: value, createdAt: prior?.createdAt || this.now(), lastError: null });
    await this.persist(); return this.settings(identity);
  }
  async unsubscribe(identity) {
    this.assertReady();
    this.data.subscriptions = this.data.subscriptions.filter(s => !(s.owner === identity.owner && s.origin === identity.origin && s.device === identity.device));
    await this.persist(); return { enabled: false };
  }
  async notify(input) {
    this.assertReady();
    const person = this.actor(input.actorId);
    if (!person?.head) throw new Error("Important reminders must come from a current department Head");
    for (const [key, limit] of [["eventId", 160], ["title", 120], ["brief", 2400]]) if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > limit) throw new Error(`Invalid ${key}`);
    if (!["result", "decision", "block"].includes(input.reason) || input.taskId !== undefined && (typeof input.taskId !== "string" || input.taskId.length > 100)) throw new Error("Invalid reminder context");
    const { owner } = await this.owner();
    if (!owner) throw new Error("Website notification identity is unavailable");
    const key = hash(input.actorId + "\n" + input.eventId + "\n" + owner);
    this.data.events = this.data.events.filter(e => e.updatedAt > this.now() - 14 * DAY);
    let event = this.data.events.find(e => e.key === key);
    const content = { title: input.title.trim(), brief: input.brief.trim(), reason: input.reason, taskId: input.taskId || null, headId: input.actorId, headName: person.name };
    if (event && JSON.stringify(event.content) === JSON.stringify(content)) { await this.persist(); return this.receipt(event); }
    if (!event) {
      if (this.data.events.length >= 256) throw new Error("Reminder history is full; retry after older entries expire");
      event = { id: crypto.randomUUID(), key, owner, version: 0, createdAt: this.now() };
      this.data.events.push(event);
    }
    Object.assign(event, { content, version: event.version + 1, updatedAt: this.now(), delivery: {} });
    for (const sub of this.data.subscriptions.filter(s => s.owner === owner)) event.delivery[sub.id] = { attempts: 0, due: this.now() + this.mergeMs };
    await this.persist(); this.changed(); this.wake(); return this.receipt(event);
  }
  receipt(event) { return { notificationId: event.id, version: event.version, recorded: true, devices: Object.keys(event.delivery).length, delivery: "queued; acceptance by a push service is not device display" }; }
  detail(identity, id) {
    this.assertReady();
    const event = this.data.events.find(e => e.id === id && e.owner === identity.owner);
    if (!event) throw new Error("Reminder unavailable for this login");
    return { id: event.id, version: event.version, updatedAt: event.updatedAt, ...event.content };
  }
  wake() {
    clearTimeout(this.timer); if (this.unavailable || this.closed || this.flushing) return;
    const due = this.data.events.flatMap(e => Object.values(e.delivery || {}).filter(d => !d.done && d.attempts < 4).map(d => d.due));
    if (due.length) { this.timer = setTimeout(() => void this.flush(), Math.max(0, Math.max(Math.min(...due), this.retryAt || 0) - this.now())); this.timer.unref?.(); }
  }
  async flush() {
    if (this.flushing || this.closed) return;
    this.flushing = true;
    try {
      for (const event of this.data.events) for (const [id, delivery] of Object.entries(event.delivery || {})) {
        if (this.closed || delivery.done || delivery.attempts >= 4 || delivery.due > this.now()) continue;
        const sub = this.data.subscriptions.find(s => s.id === id), version = event.version;
        if (!sub || event.updatedAt + DAY <= this.now()) { delivery.done = "expired"; continue; }
        let valid;
        try { valid = (await this.owner(sub)).valid; } catch { delivery.due = this.now() + 60000; continue; }
        if (this.closed || !this.data.subscriptions.includes(sub) || event.version !== version) continue;
        if (!valid) { this.data.subscriptions = this.data.subscriptions.filter(s => s.id !== id); delivery.done = "revoked"; continue; }
        delivery.attempts++; delivery.due = this.now() + [10000, 60000, 300000, DAY][delivery.attempts - 1];
        await this.persist(); // Durable before external I/O; replay replaces the same visible tag.
        try {
          await this.send(sub.subscription, JSON.stringify({ eventId: event.id }), { TTL: 3600, urgency: "normal", topic: hash(event.id).slice(0, 32), timeout: 10000,
            vapidDetails: { subject: sub.origin, publicKey: this.keys.publicKey, privateKey: this.keys.privateKey } });
          if (event.version === version) { delivery.done = "accepted"; sub.lastError = null; }
        } catch (error) {
          const status = Number(error.statusCode);
          if ([404, 410].includes(status)) { this.data.subscriptions = this.data.subscriptions.filter(s => s.id !== id); delivery.done = "retired"; }
          else if (event.version === version) {
            sub.lastError = status === 401 || status === 403 ? "Push authorization failed; enable this device again" : "Push delivery failed; retries are limited";
            if (status && status !== 429 && status < 500) delivery.done = "failed";
          }
        }
        await this.persist();
      }
      await this.persist();
    } catch { this.retryAt = this.now() + 60000; /* Storage failure must not spin or break chat. */ }
    finally { this.flushing = false; this.wake(); }
  }
  async close() { this.closed = true; clearTimeout(this.timer); await this.writes; }
}
module.exports = { OfficeNotifications, subscription };
