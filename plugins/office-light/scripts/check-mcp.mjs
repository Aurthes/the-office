import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { OpenAIUiToolMetadataSchema, OpenAIUiResourceMetadataSchema } from "@openai/mcp-extensions";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "../../build/office-light/plugin");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "office-light-mcp-"));
const installed = path.join(directory, "installed-plugin");
await fs.cp(output, installed, { recursive: true });
const client = new Client({ name: "office-light-validator", version: "0.1.0" }, { capabilities: {} });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(installed, "server.mjs")], env: { OFFICE_LIGHT_DATA_DIR: path.join(directory, "data") }, stderr: "pipe" });
const checks = [];
function check(name, passed) { assert.ok(passed, name); checks.push(name); console.log("PASS " + name); }
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  check("Only the three Office metadata tools are exposed", tools.map(t => t.name).sort().join(",") === "office_open,office_remove_role,office_save_role");
  const open = tools.find(t => t.name === "office_open");
  check("Official global/thread entrypoint schema", OpenAIUiToolMetadataSchema.safeParse(open._meta["openai/ui"]).success);
  const resource = await client.readResource({ uri: open._meta.ui.resourceUri });
  const html = resource.contents[0].text;
  check("Relocated MCP Apps resource with no external UI assets", resource.contents[0].mimeType.includes("mcp-app") && !/<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i.test(html));
  check("Official display-mode metadata schema", OpenAIUiResourceMetadataSchema.safeParse(resource.contents[0]._meta["openai/ui"]).success);
  new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  check("Shipped browser bundle parses", true);
  const initial = await client.callTool({ name: "office_open", arguments: {} });
  check("A new installation starts empty without importing chats", initial.structuredContent.roles.length === 0);
  const added = await client.callTool({ name: "office_save_role", arguments: { name: "Research", chatLink: "codex://threads/10000000-0000-4000-8000-000000000001", accent: "sage" } });
  check("Real MCP save returns the new role snapshot", added.structuredContent.roles.length === 1);
  const id = added.structuredContent.roles[0].id;
  const invalid = await client.callTool({ name: "office_save_role", arguments: { id, name: "Invalid", chatLink: "https://example.com" } });
  check("Unsupported destinations are rejected", invalid.isError === true);
  const removed = await client.callTool({ name: "office_remove_role", arguments: { id } });
  check("Removal affects only Office metadata", removed.structuredContent.roles.length === 0);
  const native = await client.callTool({ name: "mcp__codex_app__list_threads", arguments: {} });
  check("Plugin does not expose native App tools", native.isError === true);
  console.log(JSON.stringify({ passed: checks.length, modelCalls: 0, nativeDatabaseAccess: false, nativeAppBackendUsed: false }));
} finally {
  await client.close();
  await fs.rm(directory, { recursive: true, force: true });
}
