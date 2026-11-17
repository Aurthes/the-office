// Opt-in, tab-local transport observation. These are facts about received
// envelopes, not evidence that speech ended or that audio was played.
type Fields = Record<string, string>;
type Entry = { sequence: number; at: number; source: "peer" | "native"; threadId: string; voiceId: string; fields: Fields };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const identifier = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,160}$/.test(value) ? value : undefined;
const roles = new Set(["user", "assistant", "developer", "system", "tool"]);
const stages = new Set(["started", "starting", "created", "in_progress", "completed", "done", "failed", "cancelled", "canceled", "closed", "stopped", "speaking", "listening", "final", "partial"]);

function metadata(value: unknown): Fields | null {
  const envelope = record(value);
  const type = identifier(envelope.type);
  if (!type) return null;
  const fields: Fields = { type };
  // Fixed shallow whitelist: never copy content, audio, token counts, errors,
  // arguments, or arbitrary nested keys. Unknown event types remain observable.
  for (const [prefix, object] of [["", envelope], ["turn.", record(envelope.turn)], ["item.", record(envelope.item)], ["response.", record(envelope.response)]] as const) {
    for (const key of ["id", "event_id", "turn_id", "item_id", "response_id", "realtimeSessionId", "type"]) {
      const id = identifier(object[key]);
      if (id) fields[prefix + key] = id;
    }
    if (typeof object.role === "string" && roles.has(object.role)) fields[prefix + "role"] = object.role;
    for (const key of ["phase", "status"]) if (typeof object[key] === "string" && stages.has(object[key])) fields[prefix + key] = object[key];
  }
  return fields;
}

export function createVoiceDiagnostics() {
  let enabled = false, sequence = 0, overwritten = 0, rejected = 0;
  const entries: Entry[] = [];
  const snapshot = () => ({ enabled, overwritten, rejected, entries: entries.map(entry => ({ ...entry, fields: { ...entry.fields } })) });
  const clear = () => { entries.length = 0; sequence = 0; overwritten = 0; rejected = 0; };
  return {
    start() { clear(); enabled = true; },
    stop() { enabled = false; return snapshot(); },
    clear,
    snapshot,
    observe(source: Entry["source"], threadId: string, voiceId: string, value: unknown) {
      if (!enabled) return;
      // Datachannel messages can contain audio; bound parsing and never retain
      // the packet. Binary/oversize/invalid envelopes are counted, not logged.
      if (source === "peer") {
        if (typeof value !== "string" || value.length > 262144) { rejected++; return; }
        try { value = JSON.parse(value); } catch { rejected++; return; }
      }
      const fields = metadata(value);
      if (!fields) { rejected++; return; }
      if (entries.length === 256) { entries.shift(); overwritten++; }
      entries.push({ sequence: ++sequence, at: Date.now(), source, threadId, voiceId, fields });
    },
  };
}

declare global {
  interface Window {
    officeVoiceDiagnostics?: Pick<ReturnType<typeof createVoiceDiagnostics>, "start" | "stop" | "clear" | "snapshot">;
  }
}
