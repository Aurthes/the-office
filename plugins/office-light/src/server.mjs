import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { RoleStore } from "./store.mjs";
import { ACCENTS } from "./links.mjs";

const store = new RoleStore();
const uri = "ui://the-office/light.html";
const server = new McpServer({ name: "the-office-light", version: "0.1.0" }, {
  instructions: "The Office is a role launcher, not a chat backend. Store only role names, colors and user-supplied or App-tool-verified local chat links. Never invent chat IDs, read native databases, enumerate native history in the background, start Codex, or alter the native App. Removing a role only removes an Office shortcut; it does not delete its chat.",
});
const panelPath = fileURLToPath(new URL("./panel.html", import.meta.url));
registerAppResource(server, "the-office", uri, {}, async () => ({
  contents: [{
    uri, mimeType: RESOURCE_MIME_TYPE, text: await fs.readFile(panelPath, "utf8"),
    _meta: {
      ui: { csp: { connectDomains: [], resourceDomains: [] } },
      "openai/ui": { preferredDisplayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] },
    },
  }],
}));
async function snapshot() {
  return {
    content: [{ type: "text", text: "Office role shortcuts. Chat content and execution stay in the native Codex App." }],
    structuredContent: { roles: await store.list() },
  };
}
registerAppTool(server, "office_open", {
  title: "Open The Office",
  description: "Open the 3D Office and list its saved role shortcuts. Reads only Office-owned role metadata, not native chats or history.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: {
    ui: { resourceUri: uri, visibility: ["model", "app"] },
    "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
  },
}, snapshot);
server.registerTool("office_save_role", {
  title: "Save Office role",
  description: "Add or edit an Office role using an explicitly provided local Codex chat link. Stores its label and link only; does not create, read, rename or change the native chat.",
  inputSchema: {
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    chatLink: z.string().max(200),
    accent: z.enum(Object.keys(ACCENTS)).default("sage"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { visibility: ["model", "app"] } },
}, async args => { await store.save(args); return snapshot(); });
server.registerTool("office_remove_role", {
  title: "Remove Office role",
  description: "Remove only the specified Office shortcut. Its native Codex chat is kept.",
  inputSchema: { id: z.string().uuid() },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  _meta: { ui: { visibility: ["model", "app"] } },
}, async ({ id }) => { await store.remove(id); return snapshot(); });

await server.connect(new StdioServerTransport());
