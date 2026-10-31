import { App } from "@modelcontextprotocol/ext-apps";
import { ACCENTS, normalizeChatLink } from "./links.mjs";
import { createOfficeScene } from "./scene.js";

const element = id => document.getElementById(id);
const app = new App({ name: "the-office-light", version: "0.1.0" }, {});
let connected = false, roles = [], editing = null, busy = false;
const scene = createOfficeScene(element("scene"), element("labels"), openChat);
const dialog = element("role-dialog");

function notice(text, error = false) {
  element("notice").textContent = text;
  element("notice").dataset.error = String(error);
}
function showSnapshot(data) {
  if (!data || !Array.isArray(data.roles)) return;
  roles = data.roles;
  element("count").textContent = roles.length + (roles.length === 1 ? " role" : " roles");
  element("empty").hidden = roles.length > 0;
  element("role-list").replaceChildren();
  for (const role of roles) {
    const item = document.createElement("li"); item.className = "role-row";
    const open = document.createElement("button"); open.className = "role-open";
    open.setAttribute("aria-label", "Open " + role.name + " in Codex");
    const icon = document.createElement("span"); icon.className = "role-icon";
    icon.style.background = ACCENTS[role.accent].color; icon.textContent = "◈";
    const name = document.createElement("span"); name.className = "role-name"; name.textContent = role.name;
    open.append(icon, name); open.onclick = () => openChat(role);
    const edit = document.createElement("button"); edit.className = "edit-role";
    edit.textContent = "⋯"; edit.setAttribute("aria-label", "Edit " + role.name);
    edit.onclick = () => showEditor(role);
    item.append(open, edit); element("role-list").append(item);
  }
  scene?.updateRoles(roles);
}
async function call(name, args = {}) {
  const result = await app.callServerTool({ name, arguments: args }, { timeout: 10000 });
  if (result.isError) {
    throw new Error(result.content?.filter(item => item.type === "text").map(item => item.text).join(" ") || "Office could not save this change.");
  }
  showSnapshot(result.structuredContent);
  return result;
}
async function openChat(role) {
  if (!connected) return;
  try {
    const result = await app.openLink({ url: normalizeChatLink(role.chatLink) }, { timeout: 10000 });
    if (result.isError) throw new Error("Codex could not open this chat.");
    notice("Requested “" + role.name + "” in Codex.");
  } catch (error) { notice(error.message, true); }
}
function showEditor(role = null) {
  editing = role;
  element("dialog-title").textContent = role ? "Edit role" : "Add a role";
  element("role-name").value = role?.name || "";
  element("chat-link").value = role?.chatLink || "";
  element("form-error").textContent = "";
  element("remove-role").hidden = !role;
  document.querySelector('input[name="accent"][value="' + (role?.accent || "sage") + '"]').checked = true;
  dialog.showModal(); element("role-name").focus();
}
for (const [key, accent] of Object.entries(ACCENTS)) {
  const label = document.createElement("label"); label.className = "swatch";
  const input = document.createElement("input"); input.type = "radio"; input.name = "accent";
  input.value = key; input.setAttribute("aria-label", accent.label);
  const circle = document.createElement("span"); circle.style.setProperty("--swatch", accent.color);
  label.append(input, circle); element("swatches").append(label);
}
element("add-role").onclick = () => showEditor();
element("cancel").onclick = () => { if (!busy) dialog.close(); };
dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
function setBusy(value) {
  busy = value;
  for (const button of dialog.querySelectorAll("button")) button.disabled = value;
}
element("role-form").onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  setBusy(true); element("form-error").textContent = "";
  try {
    const chatLink = normalizeChatLink(element("chat-link").value);
    const name = element("role-name").value.trim();
    if (!name) throw new Error("Give this role a name.");
    const accent = document.querySelector('input[name="accent"]:checked').value;
    await call("office_save_role", { ...(editing ? { id: editing.id } : {}), name, chatLink, accent });
    dialog.close(); notice(editing ? "Role updated." : "Role added. Click its character to open the chat.");
  } catch (error) { element("form-error").textContent = error.message; }
  finally { setBusy(false); }
};
element("remove-role").onclick = async () => {
  if (!editing || busy) return;
  setBusy(true);
  try {
    await call("office_remove_role", { id: editing.id });
    dialog.close(); notice("Role removed from Office. Its Codex chat is kept.");
  } catch (error) { element("form-error").textContent = error.message; }
  finally { setBusy(false); }
};
element("reload").onclick = async () => {
  try { await call("office_open"); notice("Office reloaded."); }
  catch (error) { notice(error.message, true); }
};
element("expand").onclick = async () => {
  try { await app.requestDisplayMode({ mode: "fullscreen" }, { timeout: 10000 }); }
  catch (error) { notice(error.message, true); }
};
app.ontoolresult = result => showSnapshot(result.structuredContent);
async function connect() {
try {
  await app.connect(undefined, { timeout: 12000 });
  connected = true;
  const host = app.getHostVersion();
  element("connection").textContent = host?.name === "office-development-preview" ? "Preview" : "Connected";
  for (const id of ["add-role", "reload", "expand"]) element(id).disabled = false;
  await call("office_open");
} catch {
  element("connection").textContent = "Not connected";
  notice("Open The Office from its installed plugin to add roles and open Codex chats.", true);
}
}
void connect();
