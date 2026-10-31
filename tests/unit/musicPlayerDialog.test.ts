import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MusicPlayerDialog, NETEASE_PLAYER_URL } from "@/features/ring-ship/MusicPlayerDialog";
import { setUiLanguage } from "@/lib/i18n/ui-language";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  setUiLanguage("en");
});
afterEach(() => { cleanup(); setUiLanguage("en"); vi.restoreAllMocks(); });

it("offers the official player in a separate tab without embedding provider content", () => {
  render(createElement(MusicPlayerDialog, { onClose: vi.fn() }));
  expect(screen.getByRole("dialog", { name: "Choose your player" })).toBeInTheDocument();
  expect(document.querySelector("iframe")).toBeNull();
  const player = screen.getByRole("link", { name: /网易云音乐.*NetEase Cloud Music/ });
  expect(player).toHaveAttribute("href", NETEASE_PLAYER_URL);
  expect(player).toHaveAttribute("target", "_blank");
  expect(player).toHaveAttribute("rel", "noopener noreferrer");
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
  expect(screen.getByRole("link", { name: /网易云音乐.*打开播放器/ })).toBeInTheDocument();
});
