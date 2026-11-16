import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/features/office/components/panels/SettingsPanel";
import { VoicePreviews } from "@/features/office/components/VoicePreviews";
import { SessionVoiceSettings } from "@/features/office/components/SessionVoice";
import { useSessionVoice, type SessionVoiceController } from "@/features/office/components/useSessionVoice";
import type { SessionClient } from "@/features/office/components/SessionControls";
import { setUiLanguage } from "@/lib/i18n/ui-language";
class AudioFixture {
  static all: AudioFixture[] = [];
  src = ""; volume = 1; preload = ""; crossOrigin = ""; autoplay = false; srcObject = null;
  onended: (() => void) | null = null; onerror: (() => void) | null = null;
  pause = vi.fn(); load = vi.fn(); play = vi.fn(async () => {}); setAttribute() {}
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  constructor() { AudioFixture.all.push(this); }
}
const urls = (name: string) => `https://persistent.oaistatic.com/voice/previews/${name}.en.fixture.m4a`;
const catalog = { source: "openai-prerecorded", language: "en", previews: [{ voice: "juniper", url: urls("juniper"), language: "en" }, { voice: "arbor", url: urls("fathom"), language: "en" }], unavailable: ["porto"] };
const settings = { voice: "arbor", echoCancellation: true, noiseSuppression: true, autoGainControl: true };
function setup() {
  const events = new Set<(event: { event: string; payload?: unknown }) => void>();
  const call = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async method => method === "session.voice.options" ? { voices: ["juniper", "arbor", "porto"] } : catalog);
  const client: SessionClient = { call, onEvent: h => { events.add(h); return () => { events.delete(h); }; } };
  const voice = { settings, updateSettings: vi.fn(), start: vi.fn(), stop: vi.fn(), status: "connected", muted: false } as unknown as SessionVoiceController;
  const panel = () => React.createElement(SettingsPanel, { officeTitle: "Office", officeTitleLoaded: true, onOfficeTitleChange: vi.fn(), voiceSettings: React.createElement(SessionVoiceSettings, { client, voice }) });
  return { client, call, voice, panel, push: () => events.forEach(h => h({ event: "office.account" })) };
}
beforeEach(() => { AudioFixture.all = []; vi.stubGlobal("Audio", AudioFixture); setUiLanguage("en"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setUiLanguage("en"); });
async function openVoice() { fireEvent.click(screen.getByRole("tab", { name: "Voice" })); await screen.findByRole("button", { name: "Preview: juniper" }); }
it("moves voice settings to its own accessible local tab and does not add tabs where voice settings are absent", async () => {
 const f = setup(), view = render(f.panel()); expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true"); expect(f.call).not.toHaveBeenCalled(); expect(screen.queryByRole("combobox", { name: "Select voice" })).toBeNull();
 await openVoice(); expect(screen.queryByLabelText("Language")).toBeNull(); expect(screen.getByRole("combobox", { name: "Select voice" })).toHaveValue("arbor"); expect(screen.getByText("No official preview available")).toBeTruthy(); expect(screen.getByRole("combobox", { name: "Select voice" }).querySelector('option[value="porto"]')).not.toBeDisabled(); expect(screen.queryByRole("button", { name: /Preview: (default|porto)/i })).toBeNull(); expect(AudioFixture.all).toHaveLength(0);
 fireEvent.keyDown(screen.getByRole("tab", { name: "Voice" }), { key: "ArrowLeft" }); expect(screen.getByRole("tab", { name: "General" })).toHaveFocus(); expect(screen.getByLabelText("Language")).toBeTruthy(); view.unmount();
 render(React.createElement(SettingsPanel, { officeTitle: "Other Office", officeTitleLoaded: true, onOfficeTitleChange: vi.fn() })); expect(screen.queryByRole("tablist")).toBeNull();
});
it("plays one preview at a time and never changes selected voice, mic settings or a connected call", async () => {
 const f = setup(); render(f.panel()); await openVoice(); fireEvent.click(screen.getByRole("button", { name: "Preview: juniper" })); const a = AudioFixture.all[0]; const ended = a.onended!, failed = a.onerror!;
 expect(a.src).toBe(urls("juniper")); expect(a.preload).toBe("none"); expect(a.crossOrigin).toBe("anonymous");
 fireEvent.click(screen.getByRole("button", { name: "Preview: arbor" })); expect(AudioFixture.all).toHaveLength(1); expect(a.pause).toHaveBeenCalled(); expect(a.src).toBe(urls("fathom"));
 act(() => { ended(); failed(); }); expect(screen.getByRole("button", { name: "Stop preview: arbor" })).toBeTruthy(); expect(screen.queryByText("Preview could not play. Retry.")).toBeNull();
 expect(screen.getByRole("combobox", { name: "Select voice" })).toHaveValue("arbor"); expect(f.voice.updateSettings).not.toHaveBeenCalled(); expect(f.voice.start).not.toHaveBeenCalled(); expect(f.voice.stop).not.toHaveBeenCalled(); expect(f.voice.settings).toEqual(settings);
 fireEvent.click(screen.getByRole("button", { name: "Stop preview: arbor" })); expect(a.src).toBe(""); expect(a.load).toHaveBeenCalled();
});
it("ignores a late rejected play promise from A after B starts; B errors can be retried", async () => {
 const f = setup(); render(f.panel()); await openVoice(); fireEvent.click(screen.getByRole("button", { name: "Preview: juniper" })); const a = AudioFixture.all[0]; fireEvent.click(screen.getByRole("button", { name: "Stop preview: juniper" }));
 let reject!: (e: Error) => void; a.play.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
 fireEvent.click(screen.getByRole("button", { name: "Preview: juniper" })); fireEvent.click(screen.getByRole("button", { name: "Preview: arbor" }));
 await act(async () => reject(new Error("blocked A"))); expect(screen.getByRole("button", { name: "Stop preview: arbor" })).toBeTruthy();
 act(() => a.onerror!()); expect(screen.getByText("Preview could not play. Retry.")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Preview: arbor" })); expect(screen.queryByText("Preview could not play. Retry.")).toBeNull();
});
it("releases audio on General/tab closure and ignores late catalog responses and old account options", async () => {
 const f = setup(); const base = f.call.getMockImplementation()!; let resolve!: (value: unknown) => void;
 const view = render(f.panel()); await openVoice(); fireEvent.click(screen.getByRole("button", { name: "Preview: juniper" })); const a = AudioFixture.all[0];
 fireEvent.click(screen.getByRole("tab", { name: "General" })); expect(a.src).toBe(""); expect(a.pause).toHaveBeenCalled();
 f.call.mockImplementation((method, params) => method === "session.voice.previews" ? new Promise(r => { resolve = r; }) : base(method, params)); fireEvent.click(screen.getByRole("tab", { name: "Voice" })); await waitFor(() => expect(resolve).toBeDefined());
 fireEvent.click(screen.getByRole("tab", { name: "General" })); await act(async () => resolve(catalog)); expect(screen.queryByRole("button", { name: "Preview: juniper" })).toBeNull(); view.unmount();
});
it("handles catalog failure/retry and account change without leaking stale samples", async () => {
 const f = setup(), base = f.call.getMockImplementation()!; let fail = true;
 f.call.mockImplementation(async (method, params) => { if (method === "session.voice.previews" && fail) throw new Error("upstream"); return base(method, params); });
 render(f.panel()); fireEvent.click(screen.getByRole("tab", { name: "Voice" })); await screen.findByText("Official voice previews are temporarily unavailable."); fail = false; fireEvent.click(screen.getByRole("button", { name: "Retry" })); await screen.findByRole("button", { name: "Preview: juniper" });
 fireEvent.click(screen.getByRole("button", { name: "Preview: juniper" })); const a = AudioFixture.all[0]; let resolve!: (value: unknown) => void;
 f.call.mockImplementation((method, params) => method === "session.voice.options" ? new Promise(r => { resolve = r; }) : base(method, params)); act(() => f.push()); expect(a.src).toBe(""); expect(screen.queryByRole("button", { name: "Preview: juniper" })).toBeNull();
 await act(async () => resolve({ voices: ["porto"] })); expect(screen.queryByRole("button", { name: "Preview: juniper" })).toBeNull();
});
it("keeps an actual shared voice controller and its call audio alive when preview settings unmount", async () => {
 const f = setup(); const close = vi.fn(), trackStop = vi.fn();
 vi.stubGlobal("RTCPeerConnection", class { createDataChannel() { return {}; } async createOffer() { return { sdp: "v=0" }; } async setLocalDescription() {} addTrack() {} close = close; });
 Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }], getAudioTracks: () => [] })) } });
 let current!: SessionVoiceController;
 function Host() { const voice = useSessionVoice(f.client); current = voice; return React.createElement(SettingsPanel, { officeTitle: "Office", officeTitleLoaded: true, onOfficeTitleChange: vi.fn(), voiceSettings: React.createElement(SessionVoiceSettings, { client: f.client, voice }) }); }
 render(React.createElement(Host)); await act(async () => current.start("original")); const callAudio = AudioFixture.all[0]; await openVoice(); fireEvent.click(screen.getByRole("button", { name: "Preview: juniper" })); const preview = AudioFixture.all[1];
 fireEvent.click(screen.getByRole("tab", { name: "General" })); expect(preview.pause).toHaveBeenCalled(); expect(callAudio.pause).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(trackStop).not.toHaveBeenCalled(); expect(current.status).not.toBe("off"); expect(f.call.mock.calls.filter(([method]) => method === "session.voice.start")).toHaveLength(1); expect(f.call.mock.calls.some(([method]) => method === "session.voice.stop")).toBe(false);
});

it("does not let a stale account's options overwrite the current account", async () => {
 const f=setup(), base=f.call.getMockImplementation()!; const options: ((value:unknown)=>void)[]=[];
 f.call.mockImplementation((method,params)=>method==='session.voice.options'?new Promise(r=>options.push(r)):base(method,params));
 render(f.panel()); fireEvent.click(screen.getByRole('tab',{name:'Voice'})); await waitFor(()=>expect(options).toHaveLength(1)); act(()=>f.push()); await waitFor(()=>expect(options).toHaveLength(2));
 await act(async()=>options[1]({voices:['porto']})); await act(async()=>options[0]({voices:['juniper','arbor']}));
 expect(screen.queryByRole('button',{name:'Preview: juniper'})).toBeNull(); expect(screen.getByRole('combobox',{name:'Select voice'}).querySelector('option[value="juniper"]')).toBeNull();
});

it('labels catalog sample-language fallback or absence without pretending it matches the request',async()=>{
 const f=setup();f.call.mockResolvedValue({...catalog,previews:[{voice:'juniper',url:urls('juniper'),language:'zh'},{voice:'arbor',url:urls('fathom'),language:null}]});
 render(React.createElement(VoicePreviews,{client:f.client,voices:['juniper','arbor']}));
 await screen.findByText('Sample language label: zh');expect(screen.getByText('Sample language not specified')).toBeTruthy();expect(AudioFixture.all).toHaveLength(0);
});
