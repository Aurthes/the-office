import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MusicPlayerDialog } from "@/features/ring-ship/MusicPlayerDialog";
import { setUiLanguage } from "@/lib/i18n/ui-language";
const song = { id: "song-1", name: "Track One", artists: "Artist", album: "Album", playable: true };
const reply = (data: unknown, ok = true) => ({ ok, json: async () => data });
const fetchMock = vi.fn();
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  fetchMock.mockReset().mockImplementation(async (input: string) => reply(input.includes("action=search") ? { songs: [song, { ...song, id: "unavailable", name: "Locked Song", playable: false }] } : input.includes("action=track") ? { url: "https://audio.music.126.net/test.mp3", preview: null } : { configured: true, authorized: true }));
  vi.stubGlobal("fetch", fetchMock); setUiLanguage("en");
});
afterEach(() => { cleanup(); setUiLanguage("en"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function selectTrack() {
  fireEvent.click(screen.getByRole("button", { name: /网易云音乐.*NetEase Cloud Music/ }));
  const input = await screen.findByRole("searchbox", { name: "Search songs or artists" });
  fireEvent.change(input, { target: { value: "test song" } }); fireEvent.submit(input.closest("form")!);
  fireEvent.click(await screen.findByRole("button", { name: "Play Track One" }));
  await waitFor(() => expect(document.querySelector("audio")).toHaveAttribute("src", "https://audio.music.126.net/test.mp3"));
  return document.querySelector("audio")!;
}
it("opens and searches the API player without embedding or opening the NetEase website", async () => {
  const openWindow = vi.spyOn(window, "open"); render(createElement(MusicPlayerDialog, { onOpen: vi.fn(), onClose: vi.fn() }));
  expect(fetchMock).not.toHaveBeenCalled(); await selectTrack();
  expect(screen.getByRole("dialog", { name: "网易云音乐" })).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("action=search&query=test%20song"))).toBe(true);
  expect(screen.getByRole("button", { name: "Play Locked Song" })).toBeDisabled();
  expect(document.querySelector("iframe")).toBeNull(); expect(openWindow).not.toHaveBeenCalled();
});
it.each(["close", "Escape", "backdrop"])("keeps the same audio playing after %s and reopens from the floating controls", async action => {
  const onClose = vi.fn(), onOpen = vi.fn(), view = render(createElement(MusicPlayerDialog, { open: true, onOpen, onClose }));
  const audio = await selectTrack(); fireEvent.play(audio);
  if (action === "close") fireEvent.click(screen.getByRole("button", { name: "Close music player" }));
  else if (action === "Escape") fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  else fireEvent.click(screen.getByRole("dialog"));
  expect(onClose).toHaveBeenCalledOnce(); view.rerender(createElement(MusicPlayerDialog, { open: false, onOpen, onClose }));
  expect(document.querySelector("dialog")?.open).toBe(false); expect(document.querySelector("audio")).toBe(audio); expect(audio.pause).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Background music" }).closest("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Pause music" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open music player" })); expect(onOpen).toHaveBeenCalledOnce();
  view.rerender(createElement(MusicPlayerDialog, { open: true, onOpen, onClose })); expect(document.querySelector("audio")).toBe(audio);
  expect(screen.queryByRole("region", { name: "Background music" })).toBeNull(); expect(audio.pause).not.toHaveBeenCalled();
});
it("stops and removes the audio only when Stop is selected in the floating controls", async () => {
  const onClose = vi.fn(), onOpen = vi.fn(), view = render(createElement(MusicPlayerDialog, { open: true, onOpen, onClose }));
  const audio = await selectTrack(); view.rerender(createElement(MusicPlayerDialog, { open: false, onOpen, onClose }));
  fireEvent.click(screen.getByRole("button", { name: "Stop music" }));
  expect(audio.pause).toHaveBeenCalledOnce(); expect(document.querySelector("audio")).toBeNull();
  expect(screen.queryByRole("region", { name: "Background music" })).toBeNull();
});
it("controls playback and volume on the existing audio and follows native playback events", async () => {
  const onClose = vi.fn(), onOpen = vi.fn(), view = render(createElement(MusicPlayerDialog, { open: true, onOpen, onClose }));
  const audio = await selectTrack(); view.rerender(createElement(MusicPlayerDialog, { open: false, onOpen, onClose }));
  Object.defineProperty(audio, "paused", { configurable: true, writable: true, value: false }); fireEvent.play(audio);
  fireEvent.click(screen.getByRole("button", { name: "Pause music" })); expect(audio.pause).toHaveBeenCalledOnce();
  Object.defineProperty(audio, "paused", { value: true }); fireEvent.pause(audio);
  const before = vi.mocked(audio.play).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Resume music" })); expect(audio.play).toHaveBeenCalledTimes(before + 1);
  fireEvent.change(screen.getByRole("slider", { name: "Music volume" }), { target: { value: "0.25" } }); expect(audio.volume).toBe(.25);
  audio.muted = true; fireEvent.volumeChange(audio); expect(screen.getByRole("slider", { name: "Music volume" })).toHaveValue("0");
  fireEvent.change(screen.getByRole("slider", { name: "Music volume" }), { target: { value: "0.7" } }); expect(audio.volume).toBe(.7); expect(audio.muted).toBe(false);
  fireEvent.play(audio); fireEvent.ended(audio); expect(screen.getByRole("button", { name: "Resume music" })).toBeInTheDocument();
});
it("restarts on reload and stops when returning to the chooser", async () => {
  render(createElement(MusicPlayerDialog, { onOpen: vi.fn(), onClose: vi.fn() })); const original = await selectTrack();
  fireEvent.click(screen.getByRole("button", { name: "Reload music player" })); await screen.findByRole("searchbox", { name: "Search songs or artists" });
  expect(document.querySelector("audio")).not.toBe(original); expect(original.pause).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Players" })); expect(document.querySelector("audio")).toBeNull();
});
it("keeps previews inside their allowed time range", async () => {
  fetchMock.mockImplementation(async (input: string) => reply(input.includes("action=search") ? { songs: [song] } : input.includes("action=track") ? { url: "https://audio.music.126.net/test.mp3", preview: { start: 10, end: 40 } } : { configured: true, authorized: true }));
  render(createElement(MusicPlayerDialog, { onOpen: vi.fn(), onClose: vi.fn() })); const audio = await selectTrack();
  audio.currentTime = 50; fireEvent.seeking(audio); expect(audio.currentTime).toBe(10);
  audio.currentTime = 40; fireEvent.timeUpdate(audio); expect(audio.pause).toHaveBeenCalledOnce(); expect(screen.getByText(/Preview · 30s/)).toBeInTheDocument();
});
it("offers QR sign-in and a same-phone authorization link", async () => {
  fetchMock.mockResolvedValue(reply({ configured: true, authorized: false })); render(createElement(MusicPlayerDialog, { onOpen: vi.fn(), onClose: vi.fn() }));
  fireEvent.click(screen.getByRole("button", { name: /网易云音乐.*NetEase Cloud Music/ })); const button = await screen.findByRole("button", { name: "Sign in to NetEase" });
  fetchMock.mockResolvedValueOnce(reply({ state: "waiting", url: "https://163cn.tv/test-login", qrCode: "data:image/png;base64,test", expiresAt: Date.now() + 300000 })); fireEvent.click(button);
  expect(await screen.findByRole("img", { name: "NetEase sign-in QR code" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Authorize in NetEase" })).toHaveAttribute("href", "https://163cn.tv/test-login");
});
it("closes on Escape and localizes the chooser", () => {
  setUiLanguage("zh-CN"); const onClose = vi.fn(); render(createElement(MusicPlayerDialog, { onOpen: vi.fn(), onClose }));
  expect(screen.getByRole("dialog", { name: "选择音乐播放器" })).toBeInTheDocument();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true })); expect(onClose).toHaveBeenCalledOnce();
});
