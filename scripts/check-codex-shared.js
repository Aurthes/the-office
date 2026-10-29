"use strict";
const os = require("node:os");
const path = require("node:path");
const { CodexSharedClient } = require("../server/codex-shared-client");
const socket = process.env.CLAW3D_CODEX_CONTROL_SOCKET || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "app-server-control/app-server-control.sock");
const expectedThread = process.argv[2];
const oldOwner = process.argv[3] && Number(process.argv[3]);
(async () => {
  let client;
  try {
    if (oldOwner) {
      let alive = true;
      try { process.kill(oldOwner, 0); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
      if (alive) throw new Error("旧 App 执行端仍在运行，拒绝切换网页控制");
    }
    client = new CodexSharedClient(socket);
    await client.initialize();
    const loaded = await client.call("thread/loaded/list", {});
    if (expectedThread && !loaded.data.includes(expectedThread)) throw new Error("尚未检测到原 App 在共享后台打开指定会话");
    process.stdout.write(JSON.stringify({ ok: true, socket, loadedThreads: loaded.data.length, expectedThreadLoaded: expectedThread ? true : null }) + "\n");
  } catch (error) { process.stderr.write(error.message + "\n"); process.exitCode = 1; }
  finally { client?.close(); }
})();
