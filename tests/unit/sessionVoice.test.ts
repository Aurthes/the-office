import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionVoice, type SessionVoiceController } from "../../src/features/office/components/useSessionVoice";
import { SessionControls, type SessionClient } from "../../src/features/office/components/SessionControls";
import { SettingsPanel } from "../../src/features/office/components/panels/SettingsPanel";
import { FloatingSessionVoice, SessionVoiceCall, SessionVoiceSettings } from "../../src/features/office/components/SessionVoice";

class Peer {
  static all: Peer[] = [];
  connectionState = "new";
  ontrack: unknown;
  onconnectionstatechange?: () => void;
  channel = { onmessage: null as ((event: { data: string }) => void) | null };
  close = vi.fn(); addTrack = vi.fn(); setRemoteDescription = vi.fn(async () => {});
  constructor() { Peer.all.push(this); }
  createDataChannel() { return this.channel; }
  async createOffer() { return { sdp: "v=0" }; }
  async setLocalDescription() {}
  message(value: unknown) { this.channel.onmessage?.({ data: JSON.stringify(value) }); }
}
const track = () => ({ enabled: true, stop: vi.fn() });
let microphone: ReturnType<typeof track>;
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear(); Peer.all = []; microphone = track();
  getUserMedia = vi.fn(async () => ({ getTracks: () => [microphone], getAudioTracks: () => [microphone] }));
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal("Audio", class { autoplay = false; srcObject = null; setAttribute() {} pause = vi.fn(); play = vi.fn(async () => {}); });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
});
afterEach(() => { cleanup(); delete window.OfficeAndroid; vi.unstubAllGlobals(); });
const makeClient = () => {
  const handlers = new Set<(event: { event: string; payload?: unknown }) => void>();
  const call = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async method => method === "session.voice.options" ? { voices: ["juniper", "cove"] } : { connected: true, version: 1, items: [], approvals: [], features: { voice: true, prediction: false } });
  const client: SessionClient = { call, onEvent: handler => { handlers.add(handler); return () => { handlers.delete(handler); }; } };
  return { client, call, push: (payload: unknown) => handlers.forEach(h => h({ event: "session.voice", payload })) };
};

function commit(push: (value: unknown) => void, call: ReturnType<typeof makeClient>["call"], role: string, text: string, id: string) {
  const params = call.mock.calls.filter(([method]) => method === "session.voice.start").at(-1)![1] as { threadId: string; voiceId: string };
  push({ ...params, method: "thread/realtime/item/completed", params: { item: { type: "transcriptSegment", id, realtimeSessionId: "native-one", role, text } } });
}

describe("voice lifetime and original session ownership", () => {
  it("keeps the same call and captions while keyed chat panels switch, and mutes without hanging up", async () => {
    const { client, call, push } = makeClient();
    let current!: SessionVoiceController;
    const onItems = vi.fn();
    function Office({ selected }: { selected: string }) {
      const voice = useSessionVoice(client);
      React.useEffect(() => { current = voice; });
      return React.createElement(React.Fragment, null,
        React.createElement(SessionControls, { key: selected, client, threadId: selected, onItems, voice }),
        voice.status !== "off" && voice.threadId !== selected ? React.createElement(SessionVoiceCall, { voice, owner: "Original worker", onReturn: () => {} }) : null,
      );
    }
    const view = render(React.createElement(Office, { selected: "original" }));
    const subscribe = call.mock.calls.find(([method]) => method === "session.subscribe");
    expect(subscribe).toBeDefined();
    // Starting via the shared controller isolates call lifetime from chat readiness.
    await act(async () => current.start("original"));
    const first = Peer.all[0];
    await act(async () => { first.connectionState = "connected"; first.onconnectionstatechange?.(); first.message({ type: "turn.created", turn: { role: "user", transcript: "Only" } }); commit(push, call, "user", "The entire spoken sentence", "sentence"); });
    expect(screen.queryByText("Only")).toBeNull();
    expect(screen.getByText("The entire spoken sentence")).toBeTruthy();
    const voiceId = (call.mock.calls.find(([method]) => method === "session.voice.start")?.[1] as { voiceId: string }).voiceId;
    view.rerender(React.createElement(Office, { selected: "other" }));
    expect(Peer.all).toHaveLength(1); expect(first.close).not.toHaveBeenCalled();
    expect(microphone.stop).not.toHaveBeenCalled();
    expect(screen.getByText(/Original worker/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mute microphone" }));
    expect(microphone.enabled).toBe(false);
    expect(call.mock.calls.some(([method]) => method === "session.voice.stop")).toBe(false);
    await act(async () => push({ threadId: "other", voiceId, method: "thread/realtime/sdp", params: { sdp: "wrong" } }));
    expect(first.setRemoteDescription).not.toHaveBeenCalled();
    await act(async () => push({ threadId: "original", voiceId, method: "thread/realtime/sdp", params: { sdp: "answer" } }));
    expect(first.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer" });
    view.rerender(React.createElement(Office, { selected: "original" }));
    expect(screen.getByText("The entire spoken sentence")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unmute microphone" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Unmute microphone" }));
    expect(microphone.enabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(first.close).toHaveBeenCalledTimes(1); expect(microphone.stop).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenLastCalledWith("session.voice.stop", { threadId: "original", voiceId });
  });
  it("waits for the Android foreground service and handles notification mute and hangup on the original session", async () => {
    const { client, call } = makeClient();
    const postMessage = vi.fn();
    window.OfficeAndroid = { postMessage, onmessage: null };
    const { result } = renderHook(() => useSessionVoice(client));
    let starting!: Promise<void>;
    act(() => { starting = result.current.start("original"); });
    expect(getUserMedia).not.toHaveBeenCalled();
    const request = JSON.parse(postMessage.mock.calls[0][0]);
    expect(request).toMatchObject({ type: "voice.prepare", threadId: "original" });
    await act(async () => { window.OfficeAndroid!.onmessage?.({ data: JSON.stringify({ type: "voice.prepared", id: request.id }) }); await starting; });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    act(() => window.OfficeAndroid!.onmessage?.({ data: JSON.stringify({ type: "voice.command", id: request.id, command: "toggleMute" }) }));
    expect(microphone.enabled).toBe(false);
    act(() => window.OfficeAndroid!.onmessage?.({ data: JSON.stringify({ type: "voice.command", id: request.id, command: "stop" }) }));
    expect(result.current.status).toBe("off");
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(call).toHaveBeenLastCalledWith("session.voice.stop", { threadId: "original", voiceId: request.id });
    expect(postMessage.mock.calls.map(([text]) => JSON.parse(text).type)).toContain("voice.release");
  });
  it("applies mute while microphone permission is pending and releases late tracks after hangup", async () => {
    const { client, call } = makeClient();
    let accept!: (value: unknown) => void;
    getUserMedia.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    const { result } = renderHook(() => useSessionVoice(client));
    let pending!: Promise<void>;
    act(() => { pending = result.current.start("owner"); });
    act(() => result.current.toggleMute());
    await act(async () => { accept({ getTracks: () => [microphone], getAudioTracks: () => [microphone] }); await pending; });
    expect(microphone.enabled).toBe(false);
    act(() => result.current.stop());
    getUserMedia.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    act(() => { pending = result.current.start("second"); });
    act(() => result.current.stop());
    const late = track();
    await act(async () => { accept({ getTracks: () => [late], getAudioTracks: () => [late] }); await pending; });
    expect(late.stop).toHaveBeenCalledTimes(1);
    expect(call.mock.calls.filter(([method]) => method === "session.voice.start")).toHaveLength(1);
  });
  it("keeps the complete call captions and roles distinct, prevents a second call and cleans up on page exit", async () => {
    const { client, call, push } = makeClient();
    const { result } = renderHook(() => useSessionVoice(client));
    await act(async () => result.current.start("owner"));
    await act(async () => result.current.start("other"));
    act(() => {
      for (let i = 0; i < 8; i++) commit(push, call, "user", String(i), String(i));
      commit(push, call, "assistant", "7", "reply");
    });
    expect(result.current.captions).toHaveLength(9);
    expect(result.current.captions.slice(-2).map(c => c.role)).toEqual(["user", "assistant"]);
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(result.current.status).toBe("off");
    expect(call.mock.calls.filter(([method]) => method === "session.voice.start")).toHaveLength(1);
    expect(call).toHaveBeenLastCalledWith("session.voice.stop", expect.objectContaining({ threadId: "owner" }));
  });
  it("saves supported settings for the next call and sends the chosen native voice", async () => {
    const { client, call } = makeClient();
    let current!: SessionVoiceController;
    function Office({ selected }: { selected: string }) {
      const voice = useSessionVoice(client); React.useEffect(() => { current = voice; });
      return React.createElement(React.Fragment, null,
        React.createElement(SettingsPanel, { officeTitle: "Office", officeTitleLoaded: true, onOfficeTitleChange: () => {}, voiceSettings: React.createElement(SessionVoiceSettings, { client, voice }) }),
        React.createElement(SessionControls, { key: selected, client, threadId: selected, onItems: () => {}, voice }));
    }
    const view = render(React.createElement(Office, { selected: "original" }));
    expect(screen.queryByRole("button", { name: "Voice settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close voice settings" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Voice" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Select voice" })).not.toBeDisabled());
    fireEvent.change(screen.getByRole("combobox", { name: "Select voice" }), { target: { value: "cove" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Noise suppression" }));
    view.rerender(React.createElement(Office, { selected: "other" }));
    expect(screen.getByRole("combobox", { name: "Select voice" })).toHaveValue("cove");
    expect(screen.getByRole("checkbox", { name: "Noise suppression" })).not.toBeChecked();
    await act(async () => current.start("owner"));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
    expect(call).toHaveBeenCalledWith("session.voice.start", expect.objectContaining({ threadId: "owner", voice: "cove" }));
    expect(JSON.parse(localStorage.getItem("claw3d:voice-settings") || "{}")).toMatchObject({ voice: "cove", noiseSuppression: false });
  });
});

it("keeps identified repeated words across roles, committed stop tails and timeline pages bound to the exact call", async () => {
 const { client,call,push }=makeClient();const original=call.getMockImplementation()!;
 call.mockImplementation(async(method,params)=>method==='session.history'?{threadId:'owner',messages:[{id:'r:start',source:'voice',voiceCallId:'native-one',voiceItemId:'start',voiceBoundary:'started',role:'tool',content:''},{id:'r:tail',source:'voice',voiceCallId:'native-one',voiceItemId:'tail',role:'assistant',content:'Final tail'}],nextCursor:'older'}:original(method,params));
 const {result}=renderHook(()=>useSessionVoice(client));await act(async()=>result.current.start('owner'));
 const voiceId=(call.mock.calls.find(([m])=>m==='session.voice.start')![1] as {voiceId:string}).voiceId;
 act(()=>{push({threadId:'owner',voiceId,method:'thread/realtime/item/completed',params:{item:{type:'realtimeSessionStarted',id:'start',realtimeSessionId:'native-one'}}});for(const id of ['a','b'])commit(push,call,'user','Same',id);commit(push,call,'assistant','Same','c');commit(push,call,'user','Same','a');});
 expect(result.current.captions).toHaveLength(3);
 await act(async()=>result.current.stop());expect(result.current.captions.map(c=>c.text)).toContain('Final tail');expect(result.current.visible).toBe(true);expect(result.current.transcriptCursor).toBe('older');
 act(()=>push({threadId:'owner',voiceId,method:'thread/realtime/item/completed',params:{item:{type:'transcriptSegment',id:'later',realtimeSessionId:'native-one',role:'user',text:'After stop'}}}));
 expect(result.current.captions.at(-1)?.text).toBe('After stop');
 await act(async()=>result.current.start('other'));
 act(()=>push({threadId:'owner',voiceId,method:'thread/realtime/item/completed',params:{item:{type:'transcriptSegment',id:'wrong',realtimeSessionId:'native-one',role:'user',text:'Wrong call'}}}));
 expect(result.current.captions).toEqual([]);expect(result.current.threadId).toBe('other');
});
it("shares output volume in both panels and reconnects at that level without changing microphone constraints or mute", async()=>{
 const audios: {volume:number;srcObject:unknown;play:ReturnType<typeof vi.fn>}[]=[];
 vi.stubGlobal('Audio',class{volume=1;srcObject=null;autoplay=false;play=vi.fn(async()=>{});pause=vi.fn();setAttribute(){}constructor(){audios.push(this)}});
 const {client}=makeClient();const {result}=renderHook(()=>useSessionVoice(client));
 await act(async()=>result.current.start('owner'));act(()=>result.current.setVolume(.25));expect(audios[0].volume).toBe(.25);expect(microphone.enabled).toBe(true);
 for(const invalid of [NaN,Infinity,-1,1.1])act(()=>result.current.setVolume(invalid));expect(result.current.outputVolume).toBe(.25);
 act(()=>result.current.setVolume(0));expect(audios[0].volume).toBe(0);act(()=>result.current.setVolume(1));expect(audios[0].volume).toBe(1);
 act(()=>result.current.setVolume(.4));act(()=>result.current.stop());await act(async()=>result.current.start('next'));expect(audios[1].volume).toBe(.4);
 expect(getUserMedia).toHaveBeenLastCalledWith({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 const view=render(React.createElement(React.Fragment,null,React.createElement(SessionVoiceCall,{voice:result.current}),React.createElement(SessionVoiceCall,{voice:result.current,onReturn:()=>{}})));
 expect(screen.queryAllByRole('slider')).toHaveLength(0);for(const button of screen.getAllByRole('button',{name:'Call volume'}))fireEvent.click(button);expect(screen.getAllByRole('slider',{name:'Call volume'})).toHaveLength(2);view.unmount();
});
it("does not merge a late history response from an ended call into a newer call",async()=>{
 const {client,call,push}=makeClient();const base=call.getMockImplementation()!;let resolve!:(v:unknown)=>void;
 call.mockImplementation(async(method,params)=>method==='session.history'?new Promise(r=>resolve=r):base(method,params));
 const {result}=renderHook(()=>useSessionVoice(client));await act(async()=>result.current.start('owner'));const voiceId=(call.mock.calls.find(([m])=>m==='session.voice.start')![1] as {voiceId:string}).voiceId;
 act(()=>push({threadId:'owner',voiceId,method:'thread/realtime/started',params:{realtimeSessionId:'call-one'}}));
 await act(async()=>result.current.stop());await act(async()=>result.current.start('second'));
 await act(async()=>resolve({threadId:'owner',messages:[{id:'x',source:'voice',voiceCallId:'call-one',role:'assistant',content:'Stale'}],nextCursor:null}));
 expect(result.current.threadId).toBe('second');expect(result.current.captions).toEqual([]);
});
it("does not attribute anonymous native transcript text to the new call",async()=>{
 const {client,call,push}=makeClient();const {result}=renderHook(()=>useSessionVoice(client));await act(async()=>result.current.start('owner'));
 const voiceId=(call.mock.calls.find(([m])=>m==='session.voice.start')![1] as {voiceId:string}).voiceId;
 act(()=>push({threadId:'owner',voiceId,method:'thread/realtime/transcript/done',params:{role:'assistant',text:'Unattributable flat old transcript'}}));
 expect(result.current.captions).toEqual([]);act(()=>Peer.all[0].message({type:'turn.done',turn:{id:'current',role:'assistant',transcript:'Actual peer dialogue'}}));expect(result.current.captions).toEqual([]);
});

it("uses canonical authority regardless of peer echoes, preserves real repeated speech, and accepts first commit before started", async () => {
 const {client,call,push}=makeClient(); const {result}=renderHook(()=>useSessionVoice(client)); await act(async()=>result.current.start('owner'));
 const peer=Peer.all[0];
 act(()=>{ peer.message({type:'turn.done',turn:{id:'peer-turn',role:'user',transcript:'Again'}}); peer.message({type:'conversation.item.input_audio_transcription.completed',item_id:'peer-item',transcript:'Again'}); commit(push,call,'user','Again','canonical-1'); });
 expect(result.current.captions.map(p=>p.id)).toEqual(['canonical-1']);
 const request=call.mock.calls.find(([m])=>m==='session.voice.start')![1] as {threadId:string;voiceId:string};
 act(()=>{push({...request,method:'thread/realtime/started',params:{realtimeSessionId:'native-one'}});commit(push,call,'user','Again','canonical-1');commit(push,call,'user','Again','canonical-2');commit(push,call,'assistant','Again','canonical-3');peer.message({type:'response.audio_transcript.done',item_id:'peer-reply',transcript:'Again'});});
 expect(result.current.captions.map(p=>p.id)).toEqual(['canonical-1','canonical-2','canonical-3']);
});
it('floating controls do not expand; a new floating mount starts compact, and return stays separate',async()=>{
 const {client}=makeClient();const {result}=renderHook(()=>useSessionVoice(client));await act(async()=>result.current.start('owner'));const onReturn=vi.fn();
 let view=render(React.createElement(FloatingSessionVoice,{voice:result.current,onReturn}));
 expect(screen.queryByLabelText('Call dialogue')).toBeNull();expect(screen.queryByRole('slider')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Mute microphone'}));expect(microphone.enabled).toBe(false);expect(screen.getByRole('button',{name:'Expand voice call'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Call volume'}));fireEvent.change(screen.getByRole('slider'),{target:{value:'.3'}});expect(result.current.outputVolume).toBe(.3);expect(screen.getByRole('button',{name:'Expand voice call'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Expand voice call'}));fireEvent.click(screen.getByRole('button',{name:'Return to voice conversation'}));expect(onReturn).toHaveBeenCalledOnce();
 view.unmount();view=render(React.createElement(FloatingSessionVoice,{voice:result.current,onReturn}));expect(screen.getByRole('button',{name:'Expand voice call'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'End call'}));expect(result.current.status).toBe('off');view.unmount();
});

it('resolves reused IDs from ordered history boundaries and closes only the exact ended call',async()=>{
 const {client,call,push}=makeClient();const base=call.getMockImplementation()!;const row=(id:string,boundary?:'started'|'closed')=>({id,source:'voice',voiceCallId:'native-one',voiceItemId:id,voiceBoundary:boundary,role:boundary?'tool':'user',content:boundary?'':'Repeated'});
 call.mockImplementation(async(method,params)=>method==='session.history'?{threadId:'owner',messages:[row('old','started'),row('old-speech'),row('old-end','closed'),row('new','started'),row('new-speech')],nextCursor:null}:base(method,params));
 const {result}=renderHook(()=>useSessionVoice(client));await act(async()=>result.current.start('owner'));const request=call.mock.calls.find(([m])=>m==='session.voice.start')![1] as {threadId:string;voiceId:string};
 act(()=>push({...request,method:'thread/realtime/item/completed',params:{item:{id:'new',type:'realtimeSessionStarted',realtimeSessionId:'native-one'}}}));
 await act(async()=>push({...request,method:'thread/realtime/transcript/refresh',params:{}}));expect(result.current.captions.map(p=>p.id)).toEqual(['new-speech']);expect(result.current.status).not.toBe('off');
 call.mockImplementation(async(method,params)=>method==='session.history'?{threadId:'owner',messages:[row('new','started'),row('new-speech'),row('new-end','closed')],nextCursor:null}:base(method,params));
 await act(async()=>result.current.loadTranscript());expect(result.current.status).toBe('off');expect(result.current.captions.map(p=>p.id)).toEqual(['new-speech']);
});
