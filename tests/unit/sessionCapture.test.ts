import React, { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionCapture, type CaptureUpload } from "../../src/features/office/components/useSessionCapture";
import type { SessionClient } from "../../src/features/office/components/SessionControls";

afterEach(cleanup);
function fixture() {
  const handlers = new Set<(event: { event: string; payload?: unknown }) => void>(), statuses = new Set<(status: "connected" | "disconnected") => void>();
  let binding = { pageId: "", bindingGeneration: "generation", bootEpoch: "epoch", resumeProof: "private-proof" };
  const call = vi.fn(async (method: string, p: unknown) => {
    if (method === "session.capture.bind") binding = { ...binding, pageId: (p as { pageId: string }).pageId };
    return method === "session.capture.ack" ? {} : binding;
  });
  const client = { call, onEvent: (handler: typeof handlers extends Set<infer T> ? T : never) => { handlers.add(handler); return () => { handlers.delete(handler); }; },
    onStatus: (handler: typeof statuses extends Set<infer T> ? T : never) => { statuses.add(handler); return () => { statuses.delete(handler); }; } };
  const emit = (event: string, payload: object = {}) => act(async () => handlers.forEach(handler => handler({ event, payload: { requestId: "capture-1", threadId: "A", subscriptionId: "sub-A", expiresAt: Date.now() + 60000, ...binding, ...payload } })));
  const status = (value: "connected" | "disconnected") => act(async () => statuses.forEach(handler => handler(value)));
  return { call, client, emit, status };
}
const original = [{ id: "old", name: "Old.pdf", size: 7316, ref: "old-ref" }];
const markup = 'Keep exact @[T82](task://stable-reference-id) 中文 draft';
function Composer({ client, id, active, blocked = false, eligible = true, seed = original }: { client: SessionClient; id: string; active: boolean; blocked?: boolean; eligible?: boolean; seed?: CaptureUpload[] }) {
  const [items, setItems] = useState(seed), uploads = useRef(items), subscription = useRef("sub-" + id), [text, setText] = useState(markup), [error, setError] = useState("");
  const updateUploads = (next: CaptureUpload[]) => { uploads.current = next; setItems(next); };
  const capture = useSessionCapture({ client, threadId: id, enabled: true, active, blocked, eligible, subscription, uploads, updateUploads, onError: setError });
  return React.createElement("section", { "data-testid": id },
    React.createElement("textarea", { "aria-label": "draft-" + id, value: text, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value) }),
    React.createElement("output", { "data-testid": "files-" + id }, JSON.stringify(items)),
    React.createElement("button", { onClick: () => void capture.bind() }, capture.conflict ? "Replace " + id : "Bind " + id),
    React.createElement("button", { onClick: () => updateUploads([...uploads.current, { id: "manual", name: "Manual.txt", size: 5, ref: "manual-ref" }]) }, "Manual " + id),
    React.createElement("button", { onClick: () => { capture.cancel("capture-1"); updateUploads(uploads.current.filter(x => x.id !== "capture-1")); } }, "Remove " + id),
    React.createElement("button", { onClick: () => updateUploads([]) }, "Clear " + id), React.createElement("p", null, error));
}
const files = (id = "A") => JSON.parse(screen.getByTestId("files-" + id).textContent || "[]");
async function bind() { fireEvent.click(screen.getByRole("button", { name: "Bind A" })); await act(async () => {}); }
describe("capture attachment drafts", () => {
  it("reserves capacity, preserves exact text/refs/attachments, and updates hidden A after switching B", async () => {
    const f = fixture();
    const view = render(React.createElement(React.Fragment, null, React.createElement(Composer, { client: f.client, id: "A", active: true }), React.createElement(Composer, { client: f.client, id: "B", active: false })));
    await bind(); await f.emit("session.capture.prepare");
    expect(files()).toHaveLength(2); expect(files()[0]).toEqual(original[0]); expect(files()[1].ref).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Manual A" }));
    view.rerender(React.createElement(React.Fragment, null, React.createElement(Composer, { client: f.client, id: "A", active: false }), React.createElement(Composer, { client: f.client, id: "B", active: true })));
    await f.emit("session.capture.ready", { ref: "capture-ref", name: "Screenshot.png", size: 68 });
    expect(files()).toEqual([original[0], { id: "capture-1", ref: "capture-ref", name: "Screenshot.png", size: 68 }, { id: "manual", ref: "manual-ref", name: "Manual.txt", size: 5 }]);
    expect(files("B")).toEqual(original); expect(screen.getByRole("textbox", { name: "draft-A" })).toHaveValue(markup); expect(screen.getByRole("textbox", { name: "draft-B" })).toHaveValue(markup);
    expect(f.call.mock.calls.every(([method]) => method.startsWith("session.capture."))).toBe(true);
  });
  it.each(["blocked", "ineligible", "inactive", "full", "selection-race"])("rejects %s before reserving any attachment", async reason => {
    const f = fixture(), seed = reason === "full" ? Array.from({ length: 8 }, (_, n) => ({ id: "old-" + n, name: "Old", size: 1, ref: "ref-" + n })) : original;
    render(React.createElement(Composer, { client: f.client, id: "A", active: reason !== "inactive", eligible: reason !== "ineligible", blocked: reason === "blocked", seed }));
    await bind(); await f.emit("session.capture.prepare", reason === "selection-race" ? { subscriptionId: "new-selection" } : {});
    expect(files()).toEqual(seed); expect(f.call).toHaveBeenCalledWith("session.capture.ack", expect.objectContaining({ result: "rejected" }));
  });
  it("does not reattach after removal, replay or a later manual send clearing attachments", async () => {
    const f = fixture(); render(React.createElement(Composer, { client: f.client, id: "A", active: true })); await bind();
    await f.emit("session.capture.prepare"); fireEvent.click(screen.getByRole("button", { name: "Remove A" }));
    await f.emit("session.capture.ready", { ref: "cancelled-ref", size: 68 }); expect(files()).toEqual(original);
    await f.emit("session.capture.prepare", { requestId: "capture-2" });
    await f.emit("session.capture.ready", { requestId: "capture-2", ref: "new-ref", size: 68 }); expect(files()).toHaveLength(2);
    await f.emit("session.capture.ready", { requestId: "capture-2", ref: "new-ref", size: 68 }); expect(files()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Clear A" }));
    await f.emit("session.capture.ready", { requestId: "capture-2", ref: "new-ref", size: 68 }); expect(files()).toEqual([]);
    expect(f.call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
  });
  it("resumes only with its in-memory proof and re-ACKs without duplicate append", async () => {
    const f = fixture(); render(React.createElement(Composer, { client: f.client, id: "A", active: true })); await bind(); await f.emit("session.capture.prepare");
    await f.emit("session.capture.ready", { ref: "new-ref", size: 68 }); await f.status("disconnected"); await f.status("connected");
    await waitFor(() => expect(f.call).toHaveBeenCalledWith("session.capture.resume", expect.objectContaining({ resumeProof: "private-proof", bootEpoch: "epoch" })));
    await f.emit("session.capture.ready", { ref: "new-ref", size: 68 }); expect(files()).toHaveLength(2);
  });
  it("drops only its placeholder on failure or explicit page replacement", async () => {
    const f = fixture(); render(React.createElement(Composer, { client: f.client, id: "A", active: true })); await bind(); await f.emit("session.capture.prepare");
    await f.emit("session.capture.failed", { error: "Synthetic capture failed" }); expect(files()).toEqual(original);
    await f.emit("session.capture.prepare", { requestId: "capture-2" });
    await f.emit("session.capture.unbound"); expect(files()).toEqual(original);
    expect(screen.getByRole("textbox")).toHaveValue(markup);
  });
  it("requires a second explicit click to replace an existing recipient", async () => {
    const f = fixture(), originalCall = f.call.getMockImplementation()!; let first = true;
    f.call.mockImplementation(async (method: string, p: unknown) => { if (method === "session.capture.bind" && first) { first = false; return { conflict: true }; } return originalCall(method, p); });
    render(React.createElement(Composer, { client: f.client, id: "A", active: true })); await bind();
    fireEvent.click(await screen.findByRole("button", { name: "Replace A" })); await act(async () => {});
    expect(f.call.mock.calls.filter(([method]) => method === "session.capture.bind").map(([, p]) => (p as { replace: boolean }).replace)).toEqual([false, true]);
  });
});
