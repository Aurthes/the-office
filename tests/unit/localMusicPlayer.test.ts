import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MusicPlayerDialog, MUSIC_PROVIDER_KEY } from "@/features/ring-ship/MusicPlayerDialog";

const songs = [{ id: "one", name: "One", artists: "Duckov", album: "Coffee Shop" }, { id: "two", name: "Two", artists: "Duckov", album: "Coffee Shop" }];
const reply = (value: unknown) => ({ ok: true, json: async () => value });
const fetchMock = vi.fn();
beforeEach(() => {
  localStorage.clear(); vi.spyOn(Math, "random").mockReturnValue(.999);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(600);
  vi.spyOn(HTMLMediaElement.prototype, "buffered", "get").mockReturnValue({ length: 1, start: () => 0, end: () => 600 });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined); vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  fetchMock.mockReset().mockImplementation(async (url: string) => reply(url === "/api/music/local" ? { name: "Duckov Soundtrack", songs } : { configured: true, authorized: false })); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const props = { onOpen: vi.fn(), onClose: vi.fn() };
async function selectLocal() { fireEvent.click(screen.getByRole("button", { name: /Local music.*Local library/ })); await screen.findByRole("button", { name: "Play One" }); }
it("offers two real sources and streams the local selection in the existing player", async () => {
  render(createElement(MusicPlayerDialog, props)); expect(screen.getByRole("button", { name: /网易云音乐/ })).toBeInTheDocument();
  await selectLocal(); expect(screen.getByRole("dialog", { name: "Local music" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Play One" })); await waitFor(() => expect(document.querySelector("audio")).toHaveAttribute("src", "/api/music/local?id=one"));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce(); expect(localStorage.getItem(MUSIC_PROVIDER_KEY)).toBe("local");
});
it("preloads versioned audio and shows when playback is buffering", async () => {
  fetchMock.mockResolvedValue(reply({ name: "Duckov", songs: songs.map(song => ({ ...song, revision: "new-encoding" })) }));
  localStorage.setItem(MUSIC_PROVIDER_KEY, "local"); render(createElement(MusicPlayerDialog, { ...props, autoPlay: true, open: false }));
  const audio = await waitFor(() => { const a = document.querySelector("audio")!; expect(a).toHaveAttribute("src", "/api/music/local?id=one&v=new-encoding"); return a; });
  expect(audio.preload).toBe("auto"); expect(audio.play).toHaveBeenCalledOnce();
  fireEvent.waiting(audio); expect(screen.getAllByText("Buffering music…")).toHaveLength(2);
  fireEvent.playing(audio); expect(screen.queryAllByText("Buffering music…")).toHaveLength(0);
});
it("uses the saved provider on entry and avoids starting with the last heard local track", async () => {
  localStorage.setItem(MUSIC_PROVIDER_KEY, "local"); localStorage.setItem("claw3d:music:local:last-track", "one");
  render(createElement(MusicPlayerDialog, { ...props, autoPlay: true, open: false }));
  await waitFor(() => expect(document.querySelector("audio")).toHaveAttribute("src", "/api/music/local?id=two"));
  expect(fetchMock).toHaveBeenCalledOnce(); expect(fetchMock.mock.calls[0][0]).toBe("/api/music/local");
  const audio = document.querySelector("audio")!; fireEvent.loadedMetadata(audio); fireEvent.play(audio);
  expect(screen.getByRole("button", { name: "Pause music" })).toBeInTheDocument(); expect(localStorage.getItem("claw3d:music:local:last-track")).toBe("two");
});
it("continues when the dialog closes and advances to another track when the current one ends", async () => {
  const view = render(createElement(MusicPlayerDialog, props)); await selectLocal(); fireEvent.click(screen.getByRole("button", { name: "Play One" }));
  const audio = document.querySelector("audio")!; fireEvent.loadedMetadata(audio); fireEvent.play(audio);
  view.rerender(createElement(MusicPlayerDialog, { ...props, open: false })); expect(document.querySelector("audio")).toBe(audio);
  fireEvent.ended(audio); await waitFor(() => expect(audio).toHaveAttribute("src", "/api/music/local?id=two"));
});
it("does not revive paused playback on scene changes and uses the common volume/stop controls", async () => {
  localStorage.setItem(MUSIC_PROVIDER_KEY, "local"); const view = render(createElement(MusicPlayerDialog, { ...props, autoPlay: true, open: false }));
  const audio = await waitFor(() => { const a = document.querySelector("audio")!; expect(a).toHaveAttribute("src", "/api/music/local?id=one"); return a; });
  fireEvent.loadedMetadata(audio); fireEvent.play(audio); Object.defineProperty(audio, "paused", { configurable: true, value: false });
  fireEvent.click(screen.getByRole("button", { name: "Pause music" })); fireEvent.pause(audio); Object.defineProperty(audio, "paused", { value: true });
  const calls = vi.mocked(audio.play).mock.calls.length; view.rerender(createElement(MusicPlayerDialog, { ...props, autoPlay: true, open: false, scene: "blue-nebula" }));
  expect(audio.play).toHaveBeenCalledTimes(calls); fireEvent.click(screen.getByRole("button", { name: "Music volume" })); fireEvent.change(screen.getByRole("slider", { name: "Music volume" }), { target: { value: ".3" } }); expect(audio.volume).toBe(.3);
  fireEvent.click(screen.getByRole("button", { name: "Stop music" })); fireEvent.click(document.body); expect(document.querySelector("audio")).toBeNull();
});
it("pauses and unloads the old provider before mounting another", async () => {
  render(createElement(MusicPlayerDialog, props)); await selectLocal(); fireEvent.click(screen.getByRole("button", { name: "Play One" })); const old = document.querySelector("audio")!;
  const paused = vi.spyOn(old, "pause"); fireEvent.click(screen.getByRole("button", { name: "Players" })); expect(paused).toHaveBeenCalled(); expect(old).not.toHaveAttribute("src");
  fireEvent.click(screen.getByRole("button", { name: /网易云音乐/ })); await screen.findByRole("button", { name: "Sign in to NetEase" }); expect(document.querySelectorAll("audio")).toHaveLength(1); expect(old.isConnected).toBe(false);
});
it("shows a play hint for blocked autoplay, and cancels a late library response after switching sources", async () => {
  localStorage.setItem(MUSIC_PROVIDER_KEY, "local"); vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("Gesture required", "NotAllowedError"));
  const view = render(createElement(MusicPlayerDialog, { ...props, autoPlay: true, open: false })); await screen.findByText("Tap to start music");
  fireEvent.click(screen.getByRole("button", { name: "Resume music" })); expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2); view.unmount();
  let finish!: (value: unknown) => void; fetchMock.mockImplementation((url: string) => url === "/api/music/local" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(reply({ configured: true, authorized: false })));
  render(createElement(MusicPlayerDialog, props)); fireEvent.click(screen.getByRole("button", { name: /Local music.*Local library/ }));
  fireEvent.click(screen.getByRole("button", { name: "Players" })); fireEvent.click(screen.getByRole("button", { name: /网易云音乐/ }));
  await act(async () => finish(reply({ name: "Duckov", songs }))); await screen.findByRole("button", { name: "Sign in to NetEase" }); expect(document.querySelector("audio")).not.toHaveAttribute("src");
});

it.each([false, true])("gives an incomplete stream a download reserve and honors cancellation: %s", async canceled => {
  vi.mocked(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "readyState")!.get!).mockReturnValue(0);
  vi.mocked(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "buffered")!.get!).mockReturnValue({ length: 1, start: () => 0, end: () => 2 });
  localStorage.setItem(MUSIC_PROVIDER_KEY, "local"); render(createElement(MusicPlayerDialog, { ...props, autoPlay: true, open: false }));
  const audio = await waitFor(() => { const a = document.querySelector("audio")!; expect(a).toHaveAttribute("src", "/api/music/local?id=one"); return a; });
  vi.useFakeTimers(); fireEvent.loadedMetadata(audio); fireEvent.canPlay(audio); expect(audio.play).not.toHaveBeenCalled();
  if (canceled) { fireEvent.click(screen.getByRole("button", { name: "Stop music" })); }
  await act(async () => { vi.advanceTimersByTime(2000); }); expect(audio.play).toHaveBeenCalledTimes(canceled ? 0 : 1);
});
