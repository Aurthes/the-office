"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { WebSocket } = require("ws");

// Connect to an existing owner. This client never spawns or stops app-server.
class CodexSharedClient {
  constructor(socketPath, onFrame = () => {}) {
    if (!path.isAbsolute(socketPath)) throw new Error("Shared socket must be absolute");
    const stat = fs.statSync(socketPath);
    if (!stat.isSocket() || stat.uid !== process.getuid() || (stat.mode & 0o077))
      throw new Error("Shared socket must belong to this user with private permissions");
    this.pending = new Map(); this.serial = 0; this.ready = false;
    this.ws = new WebSocket(`ws+unix://${socketPath}:/rpc`, { handshakeTimeout: 3000 });
    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", resolve); this.ws.once("error", reject);
    });
    this.ws.on("error", () => {});
    this.ws.on("close", () => {
      this.ready = false;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("共享连接断开；操作结果需核对，未自动重试")); }
      this.pending.clear(); onFrame({ method: "connection/closed" });
    });
    this.ws.on("message", raw => {
      let frame; try { frame = JSON.parse(String(raw)); } catch { return; }
      if (frame.method) return onFrame(frame);
      const request = this.pending.get(frame.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(frame.id);
      if (frame.error) request.reject(new Error(frame.error.message)); else request.resolve(frame.result);
    });
  }
  async initialize() {
    await this.opened;
    const result = await this.call("initialize", { clientInfo: { name: "claw3d_shared_client", title: "Claw3D", version: "1" }, capabilities: { experimentalApi: true } });
    this.ws.send(JSON.stringify({ method: "initialized" })); this.ready = true;
    return result;
  }
  call(method, params = {}) {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("共享连接尚未就绪"));
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("请求超时；结果需核对，未自动重试")); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  respond(id, result) {
    if (!this.ready) throw new Error("共享连接断开");
    this.ws.send(JSON.stringify({ id, result }));
  }
  close() { this.ready = false; this.ws.terminate(); }
}
module.exports = { CodexSharedClient };
