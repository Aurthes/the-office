// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
const { scopeMetadata, cleanScopeRecord, parentScope, nativeScopeLogReader, SCOPE_LOG_FILTER } = createRequire(import.meta.url)("../../server/codex-scope-metadata");
const { OfficeTokenUsage } = createRequire(import.meta.url)("../../server/office-token-usage");
const parent = { kind: "create", generation: "p1", nativeThreadId: "native", turnId: "turn", cellId: "1", callId: "exec-call" };
const child = { kind: "child", generation: "p1", nativeThreadId: "native", cellId: "1", callId: "exec-child", runtimeCallId: "tool-1", tool: "todo_get", namespace: "office_tasks" };
const raw = (type = "exec") => ({ level: "INFO", target: "codex_code_mode::timing", fields: { "event.name": "codex.code_mode.host_timing", conversation_id: "native", turn_id: "turn", cell_id: "1", call_id: "exec-call", tool_name: type, message: "SECRET", arguments: "SECRET" }, span: { code: "SECRET" } });
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it("projects only real timing/receipt identity fields and distinguishes wait from create", () => {
 expect(scopeMetadata(raw(), "p1")).toEqual(parent);
 expect(scopeMetadata(raw("wait"), "p1")).toMatchObject({ kind: "wait" });
 expect(scopeMetadata(raw("other"), "p1")).toBeNull();
 expect(scopeMetadata({ ...raw(), target: "wrong" }, "p1")).toBeNull();
 expect(scopeMetadata({ ...raw(), level: "ERROR" }, "p1")).toBeNull();
 const receipt = { level: "INFO", target: "codex_otel.trace_safe", fields: { "event.name": "codex.tool_call_received", "conversation.id": "native", "cell.id": "1", call_id: "exec-child", runtime_tool_call_id: "tool-1", tool_name: "todo_get", tool_namespace: "office_tasks", tool_source: "code_mode" } };
 expect(scopeMetadata(receipt, "p1")).toEqual(child);
 expect(scopeMetadata({ ...receipt, fields: { ...receipt.fields, tool_source: "direct" } }, "p1")).toBeNull();
 expect(cleanScopeRecord({ ...child, arguments: "SECRET", span: {} })).toEqual(child);
 expect(SCOPE_LOG_FILTER).not.toMatch(/debug|trace$/);
});
it("joins explicit same-process thread/cell identity despite out-of-order logs, parallel cells and later wait", () => {
 const other = { ...parent, cellId: "2", callId: "parallel" };
 expect(parentScope([child, other, { ...parent, kind: "wait", callId: "wait-call" }, parent], child)).toMatchObject({ status: "linked", parent });
 expect(parentScope([{ ...parent, kind: "wait" }, child], child)).toMatchObject({ status: "unlinked", reason: "missingCellCreator" });
});
it("rejects missing, conflicting, cross-thread and reused-after-restart identities", () => {
 expect(parentScope([child], child).status).toBe("unlinked");
 expect(parentScope([parent, child, { ...parent, callId: "different" }], child).reason).toBe("conflictingCellCreator");
 expect(parentScope([parent, child, { ...child, cellId: "2" }], child).reason).toBe("conflictingChildIdentity");
 expect(parentScope([{ ...parent, generation: "p2" }, child], child).status).toBe("unlinked");
 expect(parentScope([{ ...parent, nativeThreadId: "other" }, child], child).status).toBe("unlinked");
 expect(parentScope([parent, child, { ...parent, generation: "p2" }, { ...child, generation: "p2" }], { nativeThreadId: "native", callId: child.callId }).reason).toBe("conflictingChildIdentity");
});
it("drains split JSON, discards spans/raw INFO/oversize/malformed JSON and retains ordinary errors", () => {
 const metadata: unknown[] = [], errors: string[] = [], gaps: string[] = [];
 const reader = nativeScopeLogReader({ generation: "p1", onMetadata: (x: unknown) => metadata.push(x), onGap: (x: string) => gaps.push(x), writeError: (x: string) => errors.push(x) });
 const data = Buffer.from(JSON.stringify(raw()) + "\n" + JSON.stringify({ level: "ERROR", fields: { message: "native failure", secret: "SECRET" }, span: { secret: "SECRET" } }) + "\nlegacy error\n");
 for (let i = 0; i < data.length; i += 7) reader.feed(data.subarray(i, i + 7));
 reader.feed(Buffer.from("null\n[]\n")); reader.feed(Buffer.from("{" + "X".repeat(40000) + "\n{broken}\n")); reader.end();
 expect(metadata).toEqual([parent]); expect(errors).toEqual(["[ERROR] native failure\n", "legacy error\n"]);
 expect(JSON.stringify({ metadata, errors })).not.toContain("SECRET"); expect(gaps).toContain("scopeOversizeLog"); expect(gaps).toContain("scopeMalformedLog");
});
it("does not let observer failure break stderr drain or native error handling", () => {
 const errors: string[] = [], gaps: string[] = [];
 const reader = nativeScopeLogReader({ generation: "p1", onMetadata: () => { throw Error("observer failure"); }, onGap: (x: string) => gaps.push(x), writeError: (x: string) => errors.push(x) });
 reader.feed(Buffer.from(JSON.stringify(raw()) + "\nlegacy error\n")); reader.end(); expect(gaps).toEqual(["scopeCallbackFailure"]); expect(errors).toEqual(["legacy error\n"]);
});
it("keeps unresolved scope evidence bounded without persisting a raw event archive", async () => {
 const directory = await mkdtemp(path.join(tmpdir(), "office-scope-test-")); roots.push(directory);
 const usage = new OfficeTokenUsage({directory,home:directory,sessions:()=>[{id:"agent",codexThreadId:"native"}],resolveSource:async()=>null});await usage.init();
 usage.observeScope(parent);usage.observeScope(child);await usage.running;await usage.close();
 const file=JSON.parse(await readFile(path.join(directory,"token-usage/communication.json"),"utf8"));expect(file.scopeRecords).toBeUndefined();expect(usage.storageLimit).toBeFalsy();expect(usage.actions.pending.size).toBeLessThanOrEqual(4096);
});
