// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { CodexSharedClient } = require("../../server/codex-shared-client.js");
const { CodexWorkspaceActions } = require("../../server/codex-workspace-actions.js");
const { CodexSessionIndex } = require("../../server/codex-session-index.js");
const { CodexRosterSync } = require("../../server/codex-roster-sync.js");
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(predicate: () => boolean) {
  const end = Date.now() + 10000;
  while (!predicate()) { if (Date.now() > end) throw new Error("Native fixture timed out"); await pause(); }
}
describe.skipIf(!process.env.CLAW3D_NATIVE_CODEX_BIN)("pinned native workspace creation", () => {
  it("persists a real project/session and notifies a second client without inference", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claw-native-workspace-"));
    const socket = path.join(root, "native.sock");
    const child = spawn(process.env.CLAW3D_NATIVE_CODEX_BIN!, ["app-server", "--listen", `unix://${socket}`], {
      env: { ...process.env, CODEX_HOME: root }, stdio: ["ignore", "ignore", "pipe"],
    });
    const exited = new Promise(resolve => child.once("exit", resolve));
    let writer: InstanceType<typeof CodexSharedClient>, observer: InstanceType<typeof CodexSharedClient>;
    let index: InstanceType<typeof CodexSessionIndex>, sync: InstanceType<typeof CodexRosterSync>;
    const nativeEvents: string[] = [], pushes: unknown[] = [];
    let stderr = ""; child.stderr.on("data", data => { stderr += String(data); });
    try {
      await until(() => fs.existsSync(socket));
      writer = new CodexSharedClient(socket); observer = new CodexSharedClient(socket, (frame: { method: string }) => {
        nativeEvents.push(frame.method); sync?.native(frame);
      });
      await Promise.all([writer.initialize(), observer.initialize()]);
      const actions = new CodexWorkspaceActions(writer);
      const { project } = await actions.createProject({ name: "Native fixture", workspace: root, requestId: "native-project" });
      index = new CodexSessionIndex(root); sync = new CodexRosterSync(index, (payload: unknown) => pushes.push(payload)); sync.start();
      const created = await actions.createSession({ name: "Empty recruited session", projectId: project.id, requestId: "native-session" });
      await until(() => pushes.length > 0);
      expect(nativeEvents).toContain("project/changed");
      expect(nativeEvents).toContain("thread/started");
      expect(index.list()).toEqual([expect.objectContaining({ id: created.threadId, name: "Empty recruited session", projectId: project.id })]);
      await actions.renameSession({ threadId: created.threadId, name: "Renamed fixture captain", requestId: "native-rename" });
      await until(() => index.list().some((row: { name: string }) => row.name === "Renamed fixture captain"));
      expect(nativeEvents).toContain("thread/name/updated");
      const stored = await observer.call("thread/read", { threadId: created.threadId });
      expect(stored.thread.projectId).toBe(project.id);
      expect((await observer.call("thread/turns/list", { threadId: created.threadId })).data).toEqual([]);
      const { project: destination } = await actions.createProject({ name: "Reassignment target", workspace: root, requestId: "native-target" });
      await actions.reassignSession({ threadId: created.threadId, projectId: destination.id, requestId: "native-reassign" });
      await until(() => index.list().some((row: { id: string; projectId: string }) => row.id === created.threadId && row.projectId === destination.id));
      const reassigned = await observer.call("thread/read", { threadId: created.threadId });
      expect(reassigned.thread).toMatchObject({ id: created.threadId, projectId: destination.id, cwd: stored.thread.cwd, name: stored.thread.name });
      expect(nativeEvents).toContain("thread/project/updated");
      expect((await observer.call("thread/turns/list", { threadId: created.threadId })).data).toEqual([]);
      expect(await actions.archiveSession({threadId:created.threadId,requestId:"native-archive"})).toEqual({threadId:created.threadId,archived:true});
      await until(() => index.list().length === 0 && nativeEvents.includes("thread/archived"));
      // Archive is recoverable and preserves native identity/project history.
      await writer.call("thread/unarchive", {threadId:created.threadId});
      await until(()=>index.list().some((thread:{id:string})=>thread.id===created.threadId));
      expect((await observer.call("thread/read",{threadId:created.threadId})).thread.projectId).toBe(destination.id);
      await actions.renameSession({threadId:created.threadId,name:"Restored captain",requestId:"restored-rename"});
      await until(()=>index.list().some((row:{id:string;name:string})=>row.id===created.threadId && row.name==="Restored captain"));
    } catch (error) { throw new Error(`${(error as Error).message}\n${stderr.slice(-1500)}`, { cause: error }); }
    finally {
      sync?.close(); index?.close(); writer?.close(); observer?.close(); child.kill("SIGTERM");
      await exited; fs.rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
});
