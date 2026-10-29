const { DatabaseSync } = require("node:sqlite");
const { Store } = require("express-session");
const fs = require("node:fs");

/** A small persistent session store for one local office. */
class SqliteSessionStore extends Store {
  constructor(filename) {
    super();
    this.db = new DatabaseSync(filename);
    fs.chmodSync(filename, 0o600);
    this.db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.read = this.db.prepare("SELECT data FROM sessions WHERE id = ? AND expires > ?");
    this.write = this.db.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)");
    this.remove = this.db.prepare("DELETE FROM sessions WHERE id = ?");
    this.clean = this.db.prepare("DELETE FROM sessions WHERE expires <= ?");
    this.clean.run(Date.now());
  }
  get(id, callback) {
    try { callback(null, JSON.parse(this.read.get(id, Date.now())?.data || "null")); }
    catch (error) { callback(error); }
  }
  set(id, value, callback) {
    try {
      this.clean.run(Date.now());
      this.write.run(id, JSON.stringify(value), new Date(value.cookie.expires).getTime());
      callback?.(null);
    } catch (error) { callback?.(error); }
  }
  destroy(id, callback) {
    try { this.remove.run(id); callback?.(null); }
    catch (error) { callback?.(error); }
  }
  // Use a fixed lifetime, matching the browser cookie; reads do not extend it.
  touch(_id, _value, callback) { callback?.(null); }
  close() { this.db.close(); }
}

module.exports = { SqliteSessionStore };
