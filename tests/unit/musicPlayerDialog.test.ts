import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MusicPlayerDialog, NETEASE_PLAYER_URL } from "@/features/ring-ship/MusicPlayerDialog";
import { setUiLanguage } from "@/lib/i18n/ui-language";
import nextConfig from "../../next.config";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  setUiLanguage("en");
});
afterEach(() => { cleanup(); setUiLanguage("en"); vi.restoreAllMocks(); });

it("opens the full official player inside the office only after selection", () => {
  const openWindow = vi.spyOn(window, "open");
  render(createElement(MusicPlayerDialog, { onClose: vi.fn() }));
  expect(screen.getByRole("dialog", { name: "Choose your player" })).toBeInTheDocument();
  expect(document.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /网易云音乐.*NetEase Cloud Music/ }));
  expect(screen.getByTitle("网易云音乐")).toHaveAttribute("src", NETEASE_PLAYER_URL);
  expect(screen.getByRole("dialog", { name: "网易云音乐" })).toBeInTheDocument();
  expect(openWindow).not.toHaveBeenCalled();
  expect(screen.queryByRole("link")).toBeNull();
});

it("preserves the same player while minimized and stops it on explicit close", () => {
  const onClose = vi.fn();
  const view = render(createElement(MusicPlayerDialog, { open: true, onClose }));
  fireEvent.click(screen.getByRole("button", { name: /网易云音乐.*NetEase Cloud Music/ }));
  const frame = screen.getByTitle("网易云音乐");
  fireEvent.click(screen.getByRole("button", { name: "Minimize music player" }));
  expect(onClose).toHaveBeenCalledOnce();
  view.rerender(createElement(MusicPlayerDialog, { open: false, onClose }));
  expect(document.querySelector("dialog")?.open).toBe(false);
  expect(screen.getByTitle("网易云音乐")).toBe(frame);
  view.rerender(createElement(MusicPlayerDialog, { open: true, onClose }));
  expect(screen.getByTitle("网易云音乐")).toBe(frame);
  fireEvent.click(screen.getByRole("button", { name: "Stop and close music player" }));
  expect(document.querySelector("iframe")).toBeNull();
});

it("reloads on request and unloads the player when returning to the chooser", () => {
  render(createElement(MusicPlayerDialog, { onClose: vi.fn() }));
  fireEvent.click(screen.getByRole("button", { name: /网易云音乐.*NetEase Cloud Music/ }));
  const original = screen.getByTitle("网易云音乐");
  fireEvent.click(screen.getByRole("button", { name: "Reload music player" }));
  expect(screen.getByTitle("网易云音乐")).not.toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "Players" }));
  expect(document.querySelector("iframe")).toBeNull();
});

it("closes on Escape and the close button", () => {
  const onClose = vi.fn();
  const view = render(createElement(MusicPlayerDialog, { onClose }));
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Close music player" }));
  expect(onClose).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("localizes the chooser while keeping the provider's proper name", () => {
  setUiLanguage("zh-CN");
  render(createElement(MusicPlayerDialog, { onClose: vi.fn() }));
  expect(screen.getByRole("dialog", { name: "选择音乐播放器" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /网易云音乐.*打开播放器/ })).toBeInTheDocument();
});

it("allows the official frame origin in the office content policy", async () => {
  const routes = await nextConfig.headers?.();
  const policy = routes?.find(route => route.source === "/:path*")?.headers.find(header => header.key === "Content-Security-Policy")?.value;
  expect(policy?.split("; ").find(directive => directive.startsWith("frame-src "))).toBe("frame-src 'self' https://music.163.com");
});
