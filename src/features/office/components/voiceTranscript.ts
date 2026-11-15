import type { LiveSessionItem } from "./SessionControls";
export type VoiceCaption = { id?: string; role: string; text: string; committed?: boolean; truncated?: boolean };
// A bounded history page must not replace already received full speech with
// its shorter clipped prefix. Untruncated canonical corrections still win.
const mergeCaption = (old: VoiceCaption, next: VoiceCaption): VoiceCaption => next.truncated && !old.truncated && old.text.startsWith(next.text)
  ? { ...old, ...next, text: old.text, truncated: false } : { ...old, ...next };
// Identified segments are upserts, never a global text set. Repeated speech and
// identical words from different speakers are real dialogue.
export function appendVoiceCaption(previous: VoiceCaption[], next: VoiceCaption): VoiceCaption[] {
  if (!next.text.trim() || !["user", "assistant"].includes(next.role)) return previous;
  if (next.id) {
    const index = previous.findIndex(p => p.id === next.id && p.role === next.role);
    if (index >= 0) return previous.map((p, i) => i === index ? mergeCaption(p, next) : p);
  } else if (previous.at(-1)?.role === next.role && previous.at(-1)?.text === next.text) return previous;
  return [...previous, next];
}
// Native session IDs may be reused. A canonical started item is the call
// boundary; do not join two calls merely because their native ID matches.
export function callTimeline(items: readonly LiveSessionItem[], callId: string, boundaryId?: string): VoiceCaption[] {
  let selected = boundaryId === undefined;
  const lines: VoiceCaption[] = [];
  for (const item of items) {
    if (item.source !== "voice" || item.voiceCallId !== callId) continue;
    if (item.voiceBoundary === "started") {
      if (selected && boundaryId !== undefined) break;
      selected = boundaryId === undefined || item.voiceItemId === boundaryId;
    } else if (item.voiceBoundary === "closed") {
      if (selected && boundaryId !== undefined) break;
    } else if (selected) lines.push({ id: item.voiceItemId || item.id, role: item.role, text: item.content, committed: true, truncated: item.truncated });
  }
  return lines;
}
// Merge exact item identities. A legacy unkeyed adjacent caption can be
// replaced by its committed copy; never collapse known IDs by body text.
export function mergeCallTimeline(previous: VoiceCaption[], committed: VoiceCaption[], prepend = false): VoiceCaption[] {
  const result = [...previous], added: VoiceCaption[] = [];
  for (const line of committed) {
    const index = line.id ? result.findIndex(p => p.id === line.id && p.role === line.role) : -1;
    if (index >= 0) { result[index] = mergeCaption(result[index], line); continue; }
    const addedIndex = line.id ? added.findIndex(p => p.id === line.id && p.role === line.role) : -1;
    if (addedIndex >= 0) { added[addedIndex] = mergeCaption(added[addedIndex], line); continue; }
    const last = result.at(-1);
    if (!prepend && !last?.id && last?.role === line.role && last.text === line.text) result[result.length - 1] = line;
    else if (prepend) added.push(line);
    else result.push(line);
  }
  return prepend ? [...added, ...result] : result;
}

export function voiceTimelineGroups(items: readonly LiveSessionItem[]) {
  const groups: { id: string; callId: string; boundaryId?: string; lines: VoiceCaption[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  for (const item of items) {
    if (item.source !== "voice" || !item.voiceCallId) continue;
    if (item.voiceBoundary === "started") {
      current = { id: item.id, callId: item.voiceCallId, boundaryId: item.voiceItemId, lines: [] }; groups.push(current);
    } else if (item.voiceBoundary === "closed") current = undefined;
    else {
      if (!current || current.callId !== item.voiceCallId) {
        current = { id: item.id, callId: item.voiceCallId, lines: [] }; groups.push(current);
      }
      current.lines = appendVoiceCaption(current.lines, { id: item.voiceItemId || item.id, role: item.role, text: item.content, committed: true, truncated: item.truncated });
    }
  }
  return groups.filter(group => group.lines.length);
}
