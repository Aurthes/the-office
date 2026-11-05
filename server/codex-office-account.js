"use strict";

// Account identity belongs to the shared native connection. Refresh on account
// notifications or an explicit user retry, rather than before every turn.
class CodexOfficeAccount {
  constructor(client) { this.client = client; this.entry = null; }
  invalidate() { this.entry = null; }
  async read({ refresh = false } = {}) {
    if (refresh && this.entry?.settled) this.invalidate();
    if (!this.entry) {
      const entry = { settled: false };
      this.entry = entry;
      entry.pending = this.client.call("account/read", { refreshToken: false }).then(status => {
        entry.settled = true;
        return this.entry === entry ? status : this.read();
      }, error => {
        if (this.entry !== entry) return this.read();
        this.invalidate(); throw error;
      });
    }
    return this.entry.pending;
  }
}
module.exports = { CodexOfficeAccount };
