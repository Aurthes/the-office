import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.resolve(root, "../../build/office-light");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "office-light-preview-"));
const client = new Client({ name: "office-development-preview", version: "0.1.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath, args: [path.join(artifacts, "plugin/server.mjs")],
  env: { PATH: process.env.PATH, OFFICE_LIGHT_DATA_DIR: temporary }, stderr: "pipe",
});
transport.stderr?.on("data", data => process.stderr.write(data));
await client.connect(transport);
const document = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Office — development preview</title><style>body{margin:0;background:#0b1410;color:#d7e7db;font:12px system-ui}header{padding:11px 20px;border-bottom:1px solid #526b55;background:#263429}strong{color:#d2d7a3}p{margin:4px 0}iframe{display:block;width:100%;height:calc(100vh - 72px);border:0}</style><header><strong>Development preview · not the native Codex App</strong><p id="last-link">Temporary role data. Chat links are captured here and never opened.</p></header><iframe id="office" title="Office plugin UI"></iframe><script src="/host.js"></script></html>';
const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return response.end(document);
    }
    if (request.method === "GET" && request.url === "/panel") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return response.end(await fs.readFile(path.join(artifacts, "plugin/panel.html")));
    }
    if (request.method === "GET" && request.url === "/host.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" }); return response.end(await fs.readFile(path.join(artifacts, "preview-host.js")));
    }
    if (request.method === "POST" && request.url === "/api/tool") {
      const origin = request.headers.origin;
      if ((origin && origin !== "http://127.0.0.1:" + server.address().port) ||
          request.headers["content-type"] !== "application/json") {
        response.writeHead(403); return response.end();
      }
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 16384) { response.writeHead(413); return response.end(); }
      }
      const params = JSON.parse(body);
      if (!["office_open", "office_save_role", "office_remove_role"].includes(params.name)) {
        response.writeHead(400); return response.end();
      }
      const result = await client.callTool(params);
      response.writeHead(200, { "Content-Type": "application/json" }); return response.end(JSON.stringify(result));
    }
    response.writeHead(404); response.end();
  } catch {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Preview request failed." }));
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const state = { pid: process.pid, port: server.address().port, dataDirectory: temporary, previewOnly: true };
await fs.writeFile(path.join(artifacts, "preview-state.json"), JSON.stringify(state));
console.log(JSON.stringify({ ...state, url: "http://127.0.0.1:" + state.port }));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  server.close();
  await client.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
process.on("SIGINT", close); process.on("SIGTERM", close);
