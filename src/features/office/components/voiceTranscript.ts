import type { LiveSessionItem } from "./SessionControls";
export type VoiceCaption = { id?: string; role: string; text: string; committed?: boolean; truncated?: boolean };
// Identified segments are upserts, never a global text set. Repeated speech and
// identical words from different speakers are real dialogue.
export function appendVoiceCaption(previous: VoiceCaption[], next: VoiceCaption): VoiceCaption[] {
  if (!next.text.trim() || !["user", "assistant"].includes(next.role)) return previous;
  if (next.id) {
    const index = previous.findIndex(p => p.id === next.id && p.role === next.role);
    if (index >= 0) return previous.map((p, i) => i === index ? { ...p, ...next } : p);
  } else if (previous.at(-1)?.role === next.role && previous.at(-1)?.text === next.text) return previous;
  return [...previous, next];
}
export function callTimeline(items: readonly LiveSessionItem[], callId: string): VoiceCaption[] {
  return items.filter(item => item.source === "voice" && item.voiceCallId === callId).map(item => ({ id: item.voiceItemId || item.id, role: item.role, text: item.content, committed: true, truncated: item.truncated }));
}
// Merge exact item identities. A legacy unkeyed adjacent caption can be
// replaced by its committed copy; never collapse known IDs by body text.
export function mergeCallTimeline(previous: VoiceCaption[], committed: VoiceCaption[], prepend = false): VoiceCaption[] {
  const result = [...previous], added: VoiceCaption[] = [];
  for (const line of committed) {
    const index = line.id ? result.findIndex(p => p.id === line.id && p.role === line.role) : -1;
    if (index >= 0) { result[index] = { ...result[index], ...line }; continue; }
    const addedIndex = line.id ? added.findIndex(p => p.id === line.id && p.role === line.role) : -1;
    if (addedIndex >= 0) { added[addedIndex] = { ...added[addedIndex], ...line }; continue; }
    const last = result.at(-1);
    if (!prepend && !last?.id && last?.role === line.role && last.text === line.text) result[result.length - 1] = line;
    else if (prepend) added.push(line);
    else result.push(line);
  }
  return prepend ? [...added, ...result] : result;
}
