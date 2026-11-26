"use strict";
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const fail = (message, code = 'USER_SEND_NOT_SAVED') => Object.assign(new Error(message), { code });
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// One bounded, flushed atomic journal. Unconfirmed payloads are never evicted.
class OfficeUserSends {
  constructor(directory, { changed = () => {}, generation = () => null, maxBytes = 8 * 1024 * 1024, maxPending = 512, maxReceipts = 2048 } = {}) {
    this.file = path.join(directory, 'user-sends.json'); this.changed = changed; this.generation = generation;
    this.maxBytes = maxBytes; this.maxPending = maxPending; this.maxReceipts = maxReceipts;
    this.data = { version: 1, revision: 0, rows: [] };
    try { if (fs.existsSync(this.file)) { if (fs.statSync(this.file).size > maxBytes) throw new Error('Journal exceeds its bound'); const d = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (d.version !== 1 || !Number.isSafeInteger(d.revision) || d.revision < 0 || !Array.isArray(d.rows) || d.rows.some(r => typeof r.id !== 'string' || typeof r.threadId !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash || '') || !['saved','dispatching','accepted','unknown','confirmed','skipped'].includes(r.state) || (r.state !== 'confirmed' && (!r.payload || typeof r.payload.message !== 'string' || !Array.isArray(r.payload.attachments) || !Array.isArray(r.payload.references))))) throw new Error('Invalid user send journal'); this.data = d; } }
    catch { this.unavailable = true; }
  }
  commit(rows, threadId) {
    if (this.unavailable) throw fail('Message was not saved: user message storage needs recovery. Keep your draft.');
    const receipts = rows.filter(r => r.state === 'confirmed');
    const keep = new Set(receipts.slice(-this.maxReceipts).map(r => r.id));
    rows = rows.filter(r => r.state !== 'confirmed' || keep.has(r.id));
    const next = { version: 1, revision: this.data.revision + 1, rows }, bytes = JSON.stringify(next);
    if (rows.filter(r => r.state !== 'confirmed').length > this.maxPending || Buffer.byteLength(bytes) > this.maxBytes) throw fail('Message was not saved: saved-message capacity is full. Keep your draft and recover earlier messages.');
    const temp = this.file + '.tmp';
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 }); fs.writeFileSync(temp, bytes, { mode: 0o600, flush: true }); fs.renameSync(temp, this.file); }
    catch { try { fs.rmSync(temp, { force: true }); } catch {} throw fail('Message was not saved: writing user message storage failed. Keep your draft.'); }
    this.data = next; this.notify(threadId);
  }
  notify(id) { try { this.changed(id); } catch { /* Durability must not depend on UI notifications. */ } }
  get(threadId, id) { const row = this.data.rows.find(r => r.id === id); if (row && row.threadId !== threadId) throw fail('Send request ID belongs to another session', 'USER_SEND_CONFLICT'); return row; }
  pending(threadId) { return this.data.rows.filter(r => r.threadId === threadId && r.state !== 'confirmed' && r.state !== 'skipped' && !r.replacedBy); }
  blocked(threadId) { return this.unavailable || this.pending(threadId).length > 0; }
  summary(threadId) { return { version: this.data.revision, count: this.pending(threadId).length, retained: this.data.rows.filter(r => r.threadId === threadId && r.state !== 'confirmed').length, unavailable: Boolean(this.unavailable) }; }
  check(threadId, id, payload) { const r = this.get(threadId, id); if (r && r.hash !== digest(payload)) throw fail('Send request ID has different content', 'USER_SEND_CONFLICT'); return r; }
  admit(threadId, id, payload, { epoch, nativeThreadId, acknowledgeUnconfirmed, recoveryOf } = {}) {
    if (this.unavailable) throw fail('Message was not saved: user message storage needs recovery. Keep your draft.');
    if (typeof id !== 'string' || !id || id.length > 100) throw fail('Missing user send request ID');
    if (Buffer.byteLength(JSON.stringify(payload)) > 128 * 1024) throw fail('Message was not saved: recovery payload exceeds 128 KiB. Keep your draft.');
    const previous = this.check(threadId, id, payload); if (previous) { if ((previous.recoveryOf || null) !== (recoveryOf || null)) throw fail('Send request ID has a different recovery intent', 'USER_SEND_CONFLICT'); return { row: previous, created: false }; }
    if (this.blocked(threadId) && !acknowledgeUnconfirmed && !recoveryOf) throw fail('Earlier input is not confirmed in history. Review saved messages or explicitly acknowledge sending new input.', 'USER_INPUT_UNCONFIRMED');
    const origin = recoveryOf && this.get(threadId, recoveryOf);
    if (recoveryOf && (!origin || origin.state === 'confirmed' || origin.replacedBy || origin.hash !== digest(payload))) throw fail('The original recovery item changed. Reload saved messages.', 'USER_SEND_CONFLICT');
    const row = { id, threadId, nativeThreadId: nativeThreadId || null, epoch, hash: digest(payload), payload: structuredClone(payload), state: 'saved', createdAt: Date.now(), generation: this.generation(), ...(origin ? { recoveryOf } : {}) };
    this.commit([...this.data.rows.map(r => r === origin ? { ...r, replacedBy: id } : r), row], threadId); return { row, created: true };
  }
  update(threadId, id, patch) { const r = this.get(threadId, id); if (!r || r.state === 'confirmed' || r.state === 'skipped') return; this.commit(this.data.rows.map(row => row === r ? { ...row, ...patch } : row), threadId); }
  dispatch(threadId, id, turnId, nativeThreadId) { this.update(threadId, id, { state: 'dispatching', turnId: turnId || null, nativeThreadId: nativeThreadId || null, generation: this.generation(), dispatchedAt: Date.now() }); }
  accepted(threadId, id, result, nativeThreadId) { this.update(threadId, id, { state: this.get(threadId,id)?.ended ? 'unknown' : 'accepted', result, turnId: result.turnId, nativeThreadId: nativeThreadId || null, acceptedAt: Date.now() }); }
  unknown(threadId, id) { this.update(threadId, id, { state: 'unknown' }); }
  receipt(r) { if (!r) throw fail('Saved-message receipt is outside its retained window. Verify history; nothing was resent.', 'USER_SEND_CONFLICT'); if (r.state === 'skipped') return { status: 'confirmed', journalId: r.recoveryOf, recoverySkipped: true }; return (r.state === 'confirmed' || r.state === 'accepted' && r.generation === this.generation()) && r.result || (r.state === 'confirmed' ? { status: 'started', turnId: r.turnId } : { status: 'saved', journalId: r.id, delivery: r.state }); }
  skipRecovery(threadId, id, originalId) {
    const row = this.get(threadId,id), original = this.get(threadId,originalId);
    if (!row || row.recoveryOf !== originalId || original?.state !== 'confirmed' || row.dispatchedAt) throw fail('Recovery identity changed; no new dispatch was confirmed.', 'USER_SEND_CONFLICT');
    this.commit(this.data.rows.map(r => r === row ? { ...r, state: 'skipped' } : r), threadId);
    return this.receipt(this.get(threadId,id));
  }
  observe(threadId, items, epoch, nativeThreadId) {
    const exact = new Map(items.filter(i => i.role === 'user' && typeof i.clientId === 'string' && i.clientId && i.turnId).map(i => [i.clientId, i])); let changed = false;
    const rows = this.data.rows.map(r => { const i = exact.get(r.id); if (r.threadId !== threadId || r.state === 'confirmed' || !i || r.epoch !== epoch || (r.nativeThreadId && r.nativeThreadId !== nativeThreadId) || (r.turnId && r.turnId !== i.turnId)) return r;
      changed = true; const next = { ...r, state: 'confirmed', turnId: i.turnId, confirmedAt: Date.now() }; delete next.payload; return next; });
    if (changed) this.commit(rows, threadId);
  }
  terminal(threadId, turnId) { const rows = this.data.rows.map(r => r.threadId === threadId && r.state !== 'confirmed' && r.dispatchedAt && r.turnId === turnId ? { ...r, state: 'unknown', ended: true } : r); if (rows.some((r,i) => r !== this.data.rows[i] && r.state !== this.data.rows[i].state)) this.safeCommit(rows, threadId); }
  rewind(threadId) { const rows = this.data.rows.map(r => r.threadId === threadId && r.state !== 'confirmed' && r.state !== 'skipped' ? { ...r, state: 'unknown', historyChanged: true } : r); if (rows.some((r,i) => r !== this.data.rows[i])) this.safeCommit(rows, threadId); }
  safeCommit(rows, id) { try { this.commit(rows,id); } catch { this.unavailable = true; this.notify(id); } }
  list(threadId, cursor) { if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 100)) throw fail('Invalid saved-message cursor'); const all = this.data.rows.filter(r => r.threadId === threadId && r.state !== 'confirmed').sort((a,b) => Number(Boolean(a.replacedBy)) - Number(Boolean(b.replacedBy)) || a.createdAt - b.createdAt); const index = cursor ? all.findIndex(r => r.id === cursor) + 1 : 0; if (cursor && !index) throw fail('Saved messages changed. Reload the list.'); const page = all.slice(index, index + 20); return { ...this.summary(threadId), items: page.map(r => ({ id: r.id, createdAt: r.createdAt, state: r.generation !== this.generation() && !['saved','skipped'].includes(r.state) ? 'unknown' : r.state, preview: r.payload?.message?.slice(0,250) || '', turnId: r.turnId, replacedBy: r.replacedBy, skipped: r.state === 'skipped', historyChanged: r.historyChanged })), nextCursor: all.length > index + page.length ? page.at(-1)?.id : null }; }
  read(threadId, id) { const r = this.get(threadId,id); if (!r?.payload) throw fail('This input is already confirmed or no longer available.'); return structuredClone(r); }
}
module.exports = { OfficeUserSends };
