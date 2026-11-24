"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DeliveryReceipts, compactReceipt } = require("./office-delivery-receipts");

const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function urgency(input) {
  const value = input.urgency === undefined ? "normal" : input.urgency;
  if (!["normal", "urgent"].includes(value)) throw new Error("Choose normal or urgent delivery");
  if (value === "urgent" && (typeof input.urgentReason !== "string" || !input.urgentReason.trim() || input.urgentReason.length > 500)) throw new Error("Explain the action that must change now in urgentReason");
  return { urgency: value, ...(value === "urgent" ? { urgentReason: input.urgentReason.trim() } : {}) };
}

class OfficeDelivery {
  constructor({ directory, sources, update, canSend, send, receipt, stopping = () => false, changed = () => {} }) {
    Object.assign(this, { sources, update, canSend, send, receipt, stopping, changed });
    this.file = path.join(directory, "delivery-inbox.json");
    this.archive = new DeliveryReceipts(directory);
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) : { version: 1, messages: {}, batches: {} };
    if (this.data.version !== 1) throw new Error("Unsupported Office delivery inbox");
    this.inflight = new Map();
    this.urgentInflight = new Map();
    this.wake = new Set();
    this.closed = false;
    // Sending never becomes pending merely because the process restarted.
    for (const batch of Object.values(this.data.batches)) if (batch.state === "sending") batch.state = "uncertain";
    for (const source of this.sources()) if (source.state === "sending" &&
        !Object.values(this.data.batches).some(batch => batch.members.some(member => member.id === source.id && member.handoffId === source.handoffId))) {
      this.update(source, "uncertain", "Recovered an unconfirmed pre-batch send; inspect the original conversation");
    }
    this.save();
  }
  save() {
    // Archive only after the positive native receipt AND every source update
    // have committed. Uncertain/sending and partial task-file updates stay live.
    const settled = Object.values(this.data.batches).filter(batch => batch.state === "sent" && batch.appliedState === "sent" && batch.result?.turnId);
    const messages = settled.flatMap(batch => batch.members.filter(member => !member.taskId)
      .map(member => this.data.messages[member.id]).filter(row => row?.state === "sent"));
    this.archive.put([...messages.map(row => ["message", compactReceipt(row)]), ...settled.map(row => ["batch", compactReceipt(row)])]);
    for (const row of messages) delete this.data.messages[row.id];
    for (const row of settled) delete this.data.batches[row.id];
    if (Buffer.byteLength(JSON.stringify(this.data)) > 8 * 1024 * 1024) throw new Error("Office delivery storage is full; message was not accepted");
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = this.file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600, flush: true });
    fs.renameSync(temp, this.file);
  }
  receipts(actorId) {
    return this.records("batch", this.data.batches).filter(batch => batch.recipient === actorId ||
      batch.members.some(member => member.sender?.id === actorId)).slice(-100)
      .map(({ id, recipient, state, members, result, error }) => ({ batchId: id, recipient, status: state,
        deliveryIds: members.map(member => member.id), result, error }));
  }
  summary(recipient) {
    const rows = [...Object.values(this.data.messages), ...this.sources()].filter(row => row.recipient === recipient);
    return { pending: rows.filter(row => row.state === "pending").length,
      uncertain: rows.filter(row => ["sending", "uncertain"].includes(row.state)).length,
      statusTool: "office_tasks.delivery_status", ...(this.lastError ? { error: this.lastError } : {}) };
  }
  status(actorId, recipient) {
    const direct = this.records("message", this.data.messages).filter(row => row.sender.id === actorId && (!recipient || row.recipient === recipient));
    return direct.slice(-100).map(({ id, recipient, state, batchId, result, error }) => ({ deliveryId: id, recipient, status: state, batchId, result, error }));
  }
  records(kind, live) {
    // A crash between archive and inbox commit can leave both copies. Prefer
    // the live source and expose one receipt, never two deliveries.
    return [...new Map([...this.archive.list(kind), ...Object.values(live)].map(row => [row.id, row])).values()]
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  enqueue(input) {
    if (typeof input.requestId !== "string" || !input.requestId || input.requestId.length > 100 || ["__proto__", "prototype", "constructor"].includes(input.requestId)) throw new Error("Choose a stable delivery requestId");
    if (typeof input.message !== "string" || !input.message.trim() || Buffer.byteLength(input.message) > 16000) throw new Error("Agent messages must contain 1–16000 bytes");
    const payload = { recipient: input.recipient, sender: input.sender, message: input.message, context: input.context || null, ...urgency(input) };
    const fingerprint = hash({ recipient: input.recipient, senderId: input.sender.id, message: input.originalMessage || input.message, ...urgency(input) });
    const previous = this.data.messages[input.requestId] || this.archive.get("message", input.requestId);
    if (previous) {
      if (previous.hash !== fingerprint) throw new Error("Delivery requestId conflict; reuse the original payload");
      return { deliveryId: previous.id, status: previous.state, ...(previous.result || {}), deliveryState: previous.state, error: previous.error };
    }
    if (Object.keys(this.data.messages).length >= 2048 || Buffer.byteLength(JSON.stringify(this.data)) > 6 * 1024 * 1024) throw new Error("Office inbox is full; message was not accepted");
    const row = { ...payload, id: input.requestId, hash: fingerprint, createdAt: Date.now(), state: "pending" };
    this.data.messages[row.id] = row;
    try { this.save(); } catch (error) { delete this.data.messages[row.id]; throw error; }
    this.notify(row.recipient);
    return { deliveryId: row.id, status: "queued" };
  }
  pending(recipient) {
    return [...Object.values(this.data.messages).filter(row => row.state === "pending"),
      ...this.sources().filter(row => row.state === "pending")].filter(row => row.recipient === recipient)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  current(member) {
    if (!member.taskId) return this.data.messages[member.id];
    return this.sources().find(source => source.taskId === member.taskId && source.handoffId === member.handoffId && source.id === member.id);
  }
  apply(batch) {
    if (batch.appliedState === batch.state) return;
    let changed = false;
    for (const member of batch.members) {
      const current = this.current(member);
      if (!current || (current.state === batch.state && current.error === batch.error)) continue; // A recalled/replaced handoff remains historical.
      changed = true;
      if (current.hash !== member.hash) {
        if (member.taskId) this.update(member, "uncertain", "Source changed after dispatch; inspect its original delivery receipt");
        continue;
      }
      if (member.taskId) this.update(member, batch.state, batch.error);
      else Object.assign(current, { state: batch.state, batchId: batch.id, result: batch.result, error: batch.error });
    }
    batch.appliedState = batch.state;
    this.save();
    if (changed) this.changed(batch.recipient);
  }
  notify(recipient) {
    if (this.closed || this.stopping()) return;
    this.wake.add(recipient);
    if (this.inflight.has(recipient)) {
      if (!this.urgentInflight.has(recipient) && this.pending(recipient).some(row => row.urgency === "urgent")) {
        const urgent = Promise.resolve().then(() => this.drain(recipient, true)).catch(error => {
          this.lastError = error.message; this.changed(recipient);
        }).finally(() => { this.urgentInflight.delete(recipient); if (this.wake.has(recipient)) this.notify(recipient); });
        this.urgentInflight.set(recipient, urgent);
      }
      return;
    }
    const promise = Promise.resolve().then(async () => {
      while (this.wake.delete(recipient) && !this.closed && !this.stopping()) await this.drain(recipient);
    }).catch(error => { this.lastError = error.message; this.changed(recipient); console.warn("Office inbox remains available:", error.message); }).finally(() => {
      this.inflight.delete(recipient);
      if (this.wake.has(recipient) && !this.closed) this.notify(recipient);
    });
    this.inflight.set(recipient, promise);
  }
  async drain(recipient, urgentOnly = false) {
    // Complete cross-file task receipts before considering another dispatch.
    for (const batch of Object.values(this.data.batches).filter(row => row.recipient === recipient)) {
      if (batch.state === "uncertain") {
        const result = await this.receipt(recipient, batch.id);
        if (result?.turnId) { batch.state = "sent"; batch.result = result; delete batch.error; this.save(); }
      }
      this.apply(batch);
    }
    const pending = this.pending(recipient);
    if (!pending.length || this.closed || this.stopping()) return;
    const urgent = pending.find(row => row.urgency === "urgent");
    if (urgentOnly && !urgent) return;
    if (!urgent && !await this.canSend(recipient)) return;
    const members = [];
    let bytes = 0;
    for (const row of urgent ? [urgent] : pending) {
      const length = Buffer.byteLength(JSON.stringify(row));
      if (members.length >= 8 || bytes + length > 128 * 1024) break;
      members.push(structuredClone(row)); bytes += length;
    }
    if (!members.length) throw new Error("Queued message metadata exceeds the batch limit; original message remains pending");
    // Revalidate after the asynchronous idle check, before claiming any member.
    if (members.some(member => this.current(member)?.hash !== member.hash || this.current(member)?.state !== "pending")) { this.wake.add(recipient); return; }
    if (Object.keys(this.data.batches).length >= 4096) throw new Error("Office delivery receipt capacity reached; pending messages remain queued");
    const id = "delivery-" + crypto.randomUUID();
    const batch = { id, recipient, members, state: "sending", createdAt: Date.now() };
    this.data.batches[id] = batch;
    try { this.save(); } catch (error) { delete this.data.batches[id]; throw error; }
    this.apply(batch);
    const questions = [...new Map(members.flatMap(row => row.context?.questions || []).map(q => [q.id, q])).values()];
    const context = { questions, deliveries: members.map(row => ({ ...(row.context || {}), deliveryId: row.id, sender: row.sender, urgency: row.urgency || "normal", ...(row.urgentReason ? { urgentReason: row.urgentReason } : {}),
      ...(row.taskId ? { taskId: row.taskId, phaseId: row.phaseId, handoffId: row.handoffId } : {}) })) };
    const remaining = this.pending(recipient).length;
    const message = members.map(row => row.message).join("\n\n---\n\n") + (remaining ? "\n\nOffice inbox: " + remaining + " additional message(s) remain queued." : "");
    let result;
    try {
      result = await this.send(recipient, message, id, context, Boolean(urgent));
    } catch (error) {
      // A transport failure is not evidence that native did not receive it.
      batch.state = "uncertain"; batch.error = String(error.message).slice(0, 500);
      this.save(); this.apply(batch); return;
    }
    if (result?.status === "busy" || result?.status === "cancelled") {
      batch.state = "pending"; this.save(); this.apply(batch);
      delete this.data.batches[id]; this.save(); return;
    }
    if (!result?.turnId) {
      batch.state = "uncertain"; batch.error = "Native receipt did not identify the accepted turn; inspect the original batch client ID";
      this.save(); this.apply(batch); return;
    }
    // Persist the positive native receipt before touching any task file. A task
    // write failure must not downgrade that known result or resend its message.
    batch.state = "sent"; batch.result = result; this.save(); this.apply(batch);
  }
  flush() {
    const recipients = new Set([...this.sources(), ...Object.values(this.data.messages),
      ...Object.values(this.data.batches)].map(row => row.recipient));
    for (const recipient of recipients) this.notify(recipient);
    return Promise.all([...this.inflight.values(), ...this.urgentInflight.values()]);
  }
  close() { this.closed = true; }
}
module.exports = { OfficeDelivery, urgency, hash };
