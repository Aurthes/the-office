"use strict";
const fs = require("node:fs");
const path = require("node:path");

class CodexWorkspaceActions {
  constructor(client) { this.client = client; this.requests = new Map(); }
  requireReady() { if (!this.client?.ready) throw new Error("Codex 共享连接未就绪，暂时不能执行操作"); }
  once(requestId, input, work) {
    this.requireReady();
    if (typeof requestId !== "string" || !requestId || requestId.length > 128) throw new Error("缺少操作请求 ID");
    const hash = JSON.stringify(input), previous = this.requests.get(requestId);
    if (previous) {
      if (previous.hash !== hash) throw new Error("操作请求 ID 冲突");
      return previous.promise;
    }
    const promise = Promise.resolve().then(work);
    this.requests.set(requestId, { hash, promise });
    if (this.requests.size > 128) this.requests.delete(this.requests.keys().next().value);
    return promise;
  }
  name(value) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new Error("名称须为 1–120 个字符");
    return value.trim();
  }
  directory(value) {
    if (typeof value !== "string" || !path.isAbsolute(value) || !fs.statSync(value, { throwIfNoEntry: false })?.isDirectory())
      throw new Error("请填写运行 Codex 的电脑上已有的项目绝对路径");
    return path.resolve(value);
  }
  createProject(input) {
    const name = this.name(input.name), workspace = this.directory(input.workspace);
    return this.once(input.requestId, { type: "project", name, workspace }, async () => {
      const result = await this.client.call("project/create", { name, roots: [{ path: workspace }], idempotencyKey: input.requestId });
      return { project: result.project };
    });
  }
  renameSession(input) {
    const { threadId, requestId } = input, name = this.name(input.name);
    if (typeof threadId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(threadId)) throw new Error("无效的原会话 ID");
    return this.once(requestId, { type: "rename", threadId, name }, async () => {
      await this.client.call("thread/name/set", { threadId, name });
      return { threadId, name };
    });
  }
  reassignSession(input) {
    const { threadId, projectId, requestId } = input;
    if (typeof threadId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(threadId)) throw new Error("Invalid session ID");
    if (typeof projectId !== "string" || !projectId || projectId.length > 128) throw new Error("Choose a project");
    return this.once(requestId, { type: "reassign", threadId, projectId }, async () => {
      const { project } = await this.client.call("project/read", { projectId });
      if (project?.id !== projectId) throw new Error("Project not found. Please choose another project.");
      const { thread } = await this.client.call("thread/metadata/update", { threadId, projectId });
      if (thread?.id !== threadId || thread.projectId !== projectId) throw new Error("Reassignment was not confirmed. Check the current project before retrying.");
      return { threadId, projectId, project: project.name };
    });
  }
  archiveSession(input) {
    const { threadId, requestId } = input;
    if (typeof threadId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(threadId)) throw new Error("无效的原会话 ID");
    return this.once(requestId, { type: "archive", threadId }, async () => {
      const { thread } = await this.client.call("thread/read", { threadId, includeTurns: false });
      if (thread?.id !== threadId) throw new Error("原会话不匹配");
      if (thread.status?.type === "active") throw new Error("这位员工还在工作，请先停止当前任务再返航");
      await this.client.call("thread/archive", { threadId });
      return { threadId, archived: true };
    });
  }
  createSession(input) {
    const name = this.name(input.name);
    if (typeof input.projectId !== "string" || !input.projectId) throw new Error("请先选择或创建一个 Project");
    return this.once(input.requestId, { type: "session", name, projectId: input.projectId }, async () => {
      const { project } = await this.client.call("project/read", { projectId: input.projectId });
      const cwd = this.directory(project.roots[0]?.path);
      // Native project assignment is atomic with creation. No prompt is sent and
      // execution permissions, model and tools inherit the native project config.
      const result = await this.client.call("thread/start", { cwd, projectId: project.id, serviceName: "claw3d" });
      const threadId = result.thread.id;
      try { await this.client.call("thread/name/set", { threadId, name }); }
      catch { return { threadId, warning: "会话已创建，命名未确认；请先核对已有会话，勿重复招募。" }; }
      return { threadId };
    });
  }
}
module.exports = { CodexWorkspaceActions };
