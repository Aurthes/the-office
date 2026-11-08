"use strict";

const PROMPT = "Suggest one short, useful next message the user could send in this conversation, in the user's language. Return only that message, without quotes or explanation. Do not answer it, execute work, or use tools. If no useful next message is apparent, return no text.";

// Codex 0.166.0's experimental sampler uses the Office-owned thread's account
// and loaded context. It does not start a turn or append the sample to history.
class CodexSessionPredictions {
  constructor(store, controls, telemetry = {}) { this.store = store; this.controls = controls; this.telemetry = telemetry; this.cache = new Map(); }
  observe(method, value) {
    try { this.telemetry[method]?.(value)?.catch?.(() => {}); } catch { /* metering must not change suggestions */ }
  }

  async suggest(id) {
    const row = this.store.get(id);
    if (!row.codexThreadId || this.store.isBusy(id)) return null;
    await this.controls.attach(id);
    await this.controls.refreshTurn(id);
    const state = this.controls.state(id), turnId = state.lastTurnId;
    if (!turnId || this.store.isBusy(id) || state.activeTurnId || state.turnStatus !== "completed") return null;

    let entry = this.cache.get(id);
    if (entry?.turnId !== turnId) {
      const nativeThreadId = row.codexThreadId;
      entry = { turnId, result: this.store.call("thread/sample", {
        threadId: id, expectedTurnId: turnId, disableMcp: true, effort: "low", prompt: PROMPT,
      }).then(result => {
        // One native cache-miss promise, before empty/stale/text filtering.
        // Never await metering or retain the suggestion text in its callback.
        this.observe("sample", { officeAgentId: id, contextNativeThreadId: nativeThreadId, responseId: result.responseId, sourceTurnId: result.sourceTurnId,
          inputTokens: result.inputTokens, cachedInputTokens: result.cachedInputTokens, outputTokens: result.outputTokens });
        const text = typeof result.text === "string" ? result.text.trim() : "";
        return result.sourceTurnId === turnId && text && text.length <= 1000 ? { text, sourceTurnId: turnId } : null;
      }).catch(() => { this.observe("unavailable"); return null; }) };
      this.cache.delete(id); this.cache.set(id, entry);
      if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value);
    }
    // Reopening a chat or another browser must not incur another sample for the
    // same completed turn. A real send always takes precedence over a suggestion.
    const result = await entry.result;
    const latest = this.controls.state(id);
    return this.store.get(id).codexThreadId && !this.store.isBusy(id)
      && latest.lastTurnId === turnId && !latest.activeTurnId && latest.turnStatus === "completed" ? result : null;
  }
}

module.exports = { CodexSessionPredictions };
