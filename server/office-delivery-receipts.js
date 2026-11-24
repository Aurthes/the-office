"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Historical receipts are not queue entries. Deterministic shards retain exact
// request-ID deduplication across restarts without growing the live inbox.
class DeliveryReceipts {
  constructor(directory) { this.directory = path.join(directory, "delivery-receipts"); }
  file(key) { return path.join(this.directory, crypto.createHash("sha256").update(key).digest("hex").slice(0, 2) + ".json"); }
  read(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}; }
  get(kind, id) { const key = kind + ":" + id; return this.read(this.file(key))[key]; }
  put(records) {
    const shards = new Map();
    for (const [kind, row] of records) {
      const key = kind + ":" + row.id, file = this.file(key);
      if (!shards.has(file)) shards.set(file, this.read(file));
      shards.get(file)[key] = row;
    }
    if (!shards.size) return;
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    for (const [file, rows] of shards) {
      const temp = file + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(rows), { mode: 0o600, flush: true });
      fs.renameSync(temp, file);
    }
  }
  list(kind) {
    if (!fs.existsSync(this.directory)) return [];
    return fs.readdirSync(this.directory).filter(name => /^[0-9a-f]{2}\.json$/.test(name))
      .flatMap(name => Object.entries(this.read(path.join(this.directory, name)))
        .filter(([key]) => key.startsWith(kind + ":")).map(([, row]) => row));
  }
}

function receiptContext(context) {
  if (!context) return context;
  return { ...Object.fromEntries(["taskId", "phaseId", "handoffId", "role"].filter(key => context[key] !== undefined).map(key => [key, context[key]])),
    ...(context.questions ? { questions: context.questions.map(q => ({ id: q.id,
      ...(q.sources ? { sources: q.sources.map(({ threadId, turnId, itemId }) => ({ threadId, turnId, itemId })) } : {}) })) } : {}) };
}
function compactReceipt(row) {
  const { context, members, ...receipt } = row;
  delete receipt.message;
  return { ...receipt, ...(context ? { context: receiptContext(context) } : {}),
    ...(members ? { members: members.map(compactReceipt) } : {}) };
}
module.exports = { DeliveryReceipts, compactReceipt };
