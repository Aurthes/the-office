import { describe, expect, it } from "vitest";
import { composerMarkupIndex, encodeReference, prepareComposerMessage } from "../../src/features/office/components/inlineReferences";

describe("inline reference drafts", () => {
  it("keeps task UUIDs distinct for same-title references through serialization and edits", () => {
    const a = { kind: "task" as const, id: "first-task-uuid", name: "T1 同名任务" }, b = { ...a, id: "second-task-uuid", name: "T2 同名任务" };
    const draft = `${encodeReference(a)} then ${encodeReference(b)} and ${encodeReference(a)}`;
    const value = prepareComposerMessage(draft);
    expect(value.references.map(ref => ref.id)).toEqual([a.id, b.id, a.id]);
    const start = composerMarkupIndex(draft, value.references[1].start, "start"), end = composerMarkupIndex(draft, value.references[1].end, "end");
    expect(prepareComposerMessage(draft.slice(0, start) + draft.slice(end)).references.map(ref => ref.id)).toEqual([a.id, a.id]);
    expect(prepareComposerMessage("@T1 同名任务").references).toEqual([]);
  });
  it("preserves order, duplicate labels with different identities, Unicode and repeated targets", () => {
    const a = { kind: "chat" as const, id: "first", name: "同名 🙂" };
    const b = { ...a, id: "second" };
    const draft = `请 ${encodeReference(b)} 对照 ${encodeReference(a)} 再问 ${encodeReference(b)}。`;
    const result = prepareComposerMessage(draft);
    expect(result.message).toBe("请 @同名 🙂 对照 @同名 🙂 再问 @同名 🙂。");
    expect(result.references.map(ref => ref.id)).toEqual(["second", "first", "second"]);
    for (const ref of result.references) expect(result.message.slice(ref.start, ref.end)).toBe("@同名 🙂");
    const first = result.references[0];
    const start = composerMarkupIndex(draft, first.start, "start"), end = composerMarkupIndex(draft, first.end, "end");
    expect(draft.slice(start, end)).toBe(encodeReference(b));
    expect(prepareComposerMessage(draft.slice(0, start) + draft.slice(end)).references.map(ref => ref.id)).toEqual(["first", "second"]);
  });
  it("round trips punctuation and treats invalid markup as ordinary text", () => {
    const reference = { kind: "file" as const, id: '/workspace/a ] (x) {b}.ts', name: 'a ] (x) {b}.ts' };
    expect(prepareComposerMessage(encodeReference(reference)).references[0]).toMatchObject(reference);
    const literal = "{{office-ref:not-json}} {{office-ref:%7B%7D}}";
    expect(prepareComposerMessage(literal)).toEqual({ message: literal, references: [] });
  });
});
