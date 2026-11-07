import type { MentionSerializer } from "react-mentions-ts";

export type ComposerReference = { kind: "chat" | "file" | "skill" | "app" | "task"; id: string; name: string };
export type InlineReference = ComposerReference & { start: number; end: number };
const pattern = /\{\{office-ref:([^{}]+)\}\}/g;
export const referenceLabel = (reference: ComposerReference) => (reference.kind === "skill" ? "$" : "@") + reference.name.replace(/[\r\n]/g, " ");

function decode(id: string): ComposerReference | null {
  try {
    const reference = JSON.parse(decodeURIComponent(id)) as ComposerReference;
    return reference && ["chat", "file", "skill", "app", "task"].includes(reference.kind) && typeof reference.id === "string" && typeof reference.name === "string" ? reference : null;
  } catch { return null; }
}

// Identity lives with each occurrence in the draft, so editing/copying text
// cannot leave a separate, stale list of attached references behind.
export const referenceSerializer: MentionSerializer = {
  id: "office-reference",
  insert: ({ id }) => `{{office-ref:${id}}}`,
  findAll: value => Array.from(value.matchAll(pattern)).flatMap(match => {
    const reference = decode(match[1]);
    return reference ? [{ markup: match[0], index: match.index!, id: match[1], display: referenceLabel(reference) }] : [];
  }),
};
export const encodeReference = (reference: ComposerReference) => referenceSerializer.insert({ id: encodeURIComponent(JSON.stringify(reference)), display: referenceLabel(reference) });

export function prepareComposerMessage(value: string): { message: string; references: InlineReference[] } {
  let message = "", previous = 0;
  const references: InlineReference[] = [];
  for (const match of referenceSerializer.findAll(value)) {
    message += value.slice(previous, match.index);
    const reference = decode(match.id)!;
    const start = message.length;
    message += referenceLabel(reference);
    references.push({ ...reference, start, end: message.length });
    previous = match.index + match.markup.length;
  }
  return { message: message + value.slice(previous), references };
}

export function composerMarkupIndex(value: string, position: number, edge: "start" | "end") {
  let offset = 0;
  for (const match of referenceSerializer.findAll(value)) {
    const start = match.index - offset, end = start + (match.display || "").length;
    if (position <= start) break;
    if (position < end) return match.index + (edge === "end" ? match.markup.length : 0);
    offset += match.markup.length - (match.display || "").length;
  }
  return position + offset;
}
