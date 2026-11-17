import { describe, expect, it } from "vitest";
import { createVoiceDiagnostics } from "../../src/features/office/components/voiceDiagnostics";

describe("opt-in voice envelope diagnostics", () => {
  it("starts disabled, keeps only fixed metadata and returns detached snapshots", () => {
    const diag = createVoiceDiagnostics();
    const packet = JSON.stringify({ type: "turn.created", event_id: "event-1", text: "PRIVATE", audio: "PRIVATE", tokens: 7,
      turn: { id: "turn-1", role: "user", status: "completed", transcript: "PRIVATE", content: [{ text: "PRIVATE" }] },
      response: { id: "response-1", role: "PRIVATE", phase: "PRIVATE" }, unknown: { id: "PRIVATE" } });
    diag.observe("peer", "thread", "voice", packet);
    expect(diag.snapshot().entries).toEqual([]);
    diag.start(); diag.observe("peer", "thread", "voice", packet);
    const result = diag.snapshot();
    expect(result.entries[0]).toMatchObject({ source: "peer", threadId: "thread", voiceId: "voice", fields: {
      type: "turn.created", event_id: "event-1", "turn.id": "turn-1", "turn.role": "user", "turn.status": "completed", "response.id": "response-1",
    } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(JSON.stringify(result)).not.toContain("tokens");
    result.entries[0].fields.type = "changed";
    expect(diag.snapshot().entries[0].fields.type).toBe("turn.created");
    diag.stop(); diag.observe("peer", "thread", "voice", packet);
    expect(diag.snapshot().entries).toHaveLength(1);
    diag.start(); expect(diag.snapshot().entries).toEqual([]);
  });
  it("bounds memory and parsing without recording invalid, audio or oversize bodies", () => {
    const diag = createVoiceDiagnostics(); diag.start();
    for (const data of ["not-json", "x".repeat(262145), new Uint8Array(4), "null", '{"type":"contains spaces"}']) diag.observe("peer", "t", "v", data);
    for (let i = 0; i < 260; i++) diag.observe("native", "t", "v", { type: "thread/realtime/transcript/done", role: "user", text: "PRIVATE" });
    expect(diag.snapshot()).toMatchObject({ rejected: 5, overwritten: 4 });
    expect(diag.snapshot().entries).toHaveLength(256);
    expect(diag.snapshot().entries[0].sequence).toBe(5);
    // A transcript completion is just an observed type, never a derived speech-end/played state.
    expect(diag.snapshot().entries[0].fields).toEqual({ type: "thread/realtime/transcript/done", role: "user" });
    diag.clear(); expect(diag.snapshot().entries).toEqual([]);
  });
});
