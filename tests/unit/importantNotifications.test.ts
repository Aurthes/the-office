// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportantNotificationBrief, NotificationSettings } from "@/features/office/components/ImportantNotifications";
import { SettingsPanel } from "@/features/office/components/panels/SettingsPanel";
import type { SessionVoiceController } from "@/features/office/components/useSessionVoice";
const id = "11111111-1111-4111-8111-111111111111";
const brief = { id, title: "Verified result", brief: "Saved exact brief", headId: "real-head", headName: "Head", taskId: "T161", updatedAt: 1 };
let permission: ReturnType<typeof vi.fn>, subscribe: ReturnType<typeof vi.fn>, unsubscribe: ReturnType<typeof vi.fn>;
const messages = new Set<(event: MessageEvent) => void>();
beforeEach(() => {
  history.replaceState(null, "", "/");
  messages.clear();
  permission = vi.fn(async () => "granted");
  subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: "fixture" }) }));
  unsubscribe = vi.fn(async () => true);
  const reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe, unsubscribe } };
  vi.stubGlobal("Notification", { requestPermission: permission });
  vi.stubGlobal("PushManager", class {
  });
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: vi.fn(async () => ({ pushManager: { getSubscription: async () => ({ unsubscribe }) } })), addEventListener: (_: string, h: (event: MessageEvent) => void) => messages.add(h), removeEventListener: (_: string, h: (event: MessageEvent) => void) => messages.delete(h) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup() {
  const call = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => method === "office.notifications.detail" ? brief : { publicKey: Buffer.alloc(65, 4).toString("base64url"), enabled: false, lastError: null });
  const client = { call };
  const voice = { status: "off", start: vi.fn() } as unknown as SessionVoiceController;
  const open = vi.fn(), task = vi.fn();
  return { call, client, voice, open, task };
}
it("requests permission only on click, registers the subscription and preserves explicit opt-out", async () => {
  const f = setup();
  render(React.createElement(NotificationSettings, { client: f.client, connected: true }));
  await screen.findByText("Not enabled on this installation");
  expect(permission).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("office.notifications.subscribe", { subscription: { endpoint: "fixture" } }));
  expect(permission).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
});
it("denied permission never subscribes or sends a model request", async () => {
  const f = setup();
  permission.mockResolvedValue("denied");
  render(React.createElement(NotificationSettings, { client: f.client, connected: true }));
  await screen.findByText("Not enabled on this installation");
  fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));
  await screen.findByRole("alert");
  expect(subscribe).not.toHaveBeenCalled();
  expect(f.call.mock.calls.map((c) => c[0])).toEqual(["office.notifications.settings"]);
});
it("opens a saved brief with zero model input; voice needs a separate click and carries the exact event", async () => {
  history.replaceState(null, "", `/office?notification=${id}`);
  const f = setup();
  render(React.createElement(ImportantNotificationBrief, { client: f.client, connected: true, voice: f.voice, onOpenHead: f.open, onOpenTask: f.task }));
  await screen.findByText(brief.brief);
  expect(f.voice.start).not.toHaveBeenCalled();
  expect(f.call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Voice briefing" }));
  expect(f.voice.start).toHaveBeenCalledWith("real-head", id);
  expect(f.open).toHaveBeenCalledWith("real-head");
});
it("does not take an existing call; service-worker clicks preserve the page and acknowledge receipt", async () => {
  const f = setup();
  f.voice.status = "connected";
  render(React.createElement(ImportantNotificationBrief, { client: f.client, connected: true, voice: f.voice, onOpenHead: f.open, onOpenTask: f.task }));
  const ack = vi.fn();
  for (const receive of messages) receive({ data: { type: "office-notification", eventId: id }, ports: [{ postMessage: ack }] } as unknown as MessageEvent);
  await screen.findByText(brief.brief);
  expect(screen.getByRole("button", { name: "Voice briefing" })).toBeDisabled();
  expect(ack).toHaveBeenCalledWith("received");
  expect(location.search).toContain(id);
  expect(f.voice.start).not.toHaveBeenCalled();
});
it("ignores old detail replies after another notification and shows sign-in recovery when disconnected", async () => {
  const f = setup();
  let resolve!: (value: unknown) => void;
  f.call.mockImplementationOnce(() => new Promise((r) => {
    resolve = r;
  }));
  history.replaceState(null, "", `/office?notification=${id}`);
  const v = render(React.createElement(ImportantNotificationBrief, { client: f.client, connected: true, voice: f.voice, onOpenHead: f.open, onOpenTask: f.task }));
  await waitFor(() => expect(f.call).toHaveBeenCalledTimes(1));
  v.rerender(React.createElement(ImportantNotificationBrief, { client: f.client, connected: false, voice: f.voice, onOpenHead: f.open, onOpenTask: f.task }));
  resolve(brief);
  await screen.findByText("Reconnect to read this brief.");
  expect(screen.queryByText(brief.brief)).toBeNull();
  expect(screen.getByRole("link")).toHaveAttribute("href", `/office?notification=${id}`);
});
it("adds one accessible settings tab without changing the voice/general contents", async () => {
  const f = setup();
  render(React.createElement(SettingsPanel, { officeTitle: "Office", officeTitleLoaded: true, onOfficeTitleChange: () => {
  }, voiceSettings: React.createElement("p", null, "Original voice"), notificationSettings: React.createElement(NotificationSettings, { client: f.client, connected: true }) }));
  fireEvent.click(screen.getByRole("tab", { name: "Notifications" }));
  expect(screen.getByRole("tabpanel")).toHaveTextContent("temporary address");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Notifications" }), { key: "ArrowLeft" });
  expect(screen.getByText("Original voice")).toBeTruthy();
});
