import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

const iframe = document.getElementById("office");
async function callTool(params) {
  const response = await fetch("/api/tool", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error("Preview server request failed.");
  return response.json();
}
const bridge = new AppBridge(null,
  { name: "office-development-preview", version: "0.1.0" },
  { serverTools: {}, openLinks: {}, logging: {} },
  { hostContext: { theme: "dark", displayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"], platform: "desktop" } });
bridge.oncalltool = params => callTool(params);
bridge.onopenlink = async ({ url }) => {
  document.getElementById("last-link").textContent = "Preview captured chat link: " + url;
  return {};
};
bridge.onrequestdisplaymode = async ({ mode }) => ({ mode });
bridge.oninitialized = async () => {
  try {
    await bridge.sendToolInput({ arguments: {} });
    await bridge.sendToolResult(await callTool({ name: "office_open", arguments: {} }));
  } catch (error) { document.getElementById("last-link").textContent = error.message; }
};
async function start() {
  await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
  iframe.src = "/panel";
}
void start();
