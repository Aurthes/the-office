import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const { CodexOfficeVoice } = createRequire(import.meta.url)("../../server/codex-office-voice.js");
const voiceId = "11111111-1111-4111-8111-111111111111";
const setup = () => { const client = { call: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async () => ({})) }, controls = { attach: vi.fn(async () => {}) }, emit = vi.fn(); return { client, controls, emit, voice: new CodexOfficeVoice(client, controls, emit) }; };
describe("Office realtime voice ownership", () => {
  it("starts native WebRTC on the original thread and routes SDP only to its owner", async () => {
    const { voice, client, controls, emit } = setup();
    await voice.start("tab1", "original", "v=0\no=offer", voiceId);
    expect(controls.attach).toHaveBeenCalledWith("original");
    expect(client.call).toHaveBeenCalledWith("thread/realtime/start", { threadId: "original", version: "v3", outputModality: "audio", transport: { type: "webrtc", sdp: "v=0\no=offer" }, voiceSessionId: voiceId, flushTranscriptTailOnSessionEnd: true });
    voice.handle({ method: "thread/realtime/sdp", params: { threadId: "other", sdp: "private" } });
    expect(emit).not.toHaveBeenCalled();
    voice.handle({ method: "thread/realtime/sdp", params: { threadId: "original", sdp: "answer" } });
    expect(emit).toHaveBeenCalledWith("tab1", expect.objectContaining({ voiceId, params: { threadId: "original", sdp: "answer" } }));
    await voice.start("tab1", "original", "v=0\no=offer", voiceId);
    expect(client.call).toHaveBeenCalledTimes(1);
  });
  it("lists native V3 voices and validates a selection before starting", async () => {
    const { voice, client } = setup();
    client.call.mockImplementation(async (method: string) => method === "thread/realtime/listVoices" ? { voices: { v3: ["cove", "juniper"] } } : {});
    expect(await voice.choices()).toEqual({ voices: ["cove", "juniper"] });
    await expect(voice.start("tab1", "original", "v=0", voiceId, "invented")).rejects.toThrow("unavailable");
    expect(voice.active).toBeNull();
    await voice.start("tab1", "original", "v=0", voiceId, "cove");
    expect(client.call).toHaveBeenLastCalledWith("thread/realtime/start", expect.objectContaining({ voice: "cove", threadId: "original" }));
  });
  it("prevents another tab from replacing or stopping a call, and never interrupts the Codex turn", async () => {
    const { voice, client } = setup();
    await voice.start("tab1", "original", "v=0", voiceId);
    await expect(voice.start("tab2", "other", "v=0", voiceId)).rejects.toThrow("已有");
    await expect(voice.stop("tab2", "original", voiceId)).rejects.toThrow("不是");
    await voice.stop("tab1", "original", voiceId);
    expect(client.call).toHaveBeenLastCalledWith("thread/realtime/stop", { threadId: "original" });
    expect(client.call.mock.calls.some(([method]) => method === "turn/interrupt")).toBe(false);
  });
  it("ends the owned call on disconnect and releases a failed start", async () => {
    const { voice, client } = setup();
    client.call.mockRejectedValueOnce(new Error("native unavailable"));
    await expect(voice.start("tab1", "original", "v=0", voiceId)).rejects.toThrow("unavailable");
    await voice.start("tab1", "original", "v=0", voiceId);
    voice.disconnected("unrelated"); expect(client.call).toHaveBeenCalledTimes(2);
    voice.disconnected("tab1");
    await vi.waitFor(() => expect(client.call).toHaveBeenCalledTimes(3));
    expect(client.call).toHaveBeenLastCalledWith("thread/realtime/stop", { threadId: "original" });
  });
  it("cancels a call when its tab disconnects during native startup", async () => {
    const { voice, client } = setup();
    let accept!: () => void;
    client.call.mockImplementationOnce(() => new Promise(resolve => { accept = () => resolve({}); }));
    const starting = voice.start("tab1", "original", "v=0", voiceId);
    const rejected = expect(starting).rejects.toThrow("取消");
    await vi.waitFor(() => expect(client.call).toHaveBeenCalledTimes(1));
    voice.disconnected("tab1");
    await expect(voice.start("tab2", "other", "v=0", voiceId)).rejects.toThrow("已有");
    accept(); await rejected;
    await vi.waitFor(() => expect(client.call).toHaveBeenLastCalledWith("thread/realtime/stop", { threadId: "original" }));
    expect(voice.active).toBeNull();
  });
  it("does not let another tab replace a call after an uncertain stop", async () => {
    const { voice, client } = setup();
    await voice.start("tab1", "original", "v=0", voiceId);
    client.call.mockRejectedValueOnce(new Error("timeout"));
    await expect(voice.stop("tab1", "original", voiceId)).rejects.toThrow("timeout");
    await expect(voice.start("tab2", "other", "v=0", voiceId)).rejects.toThrow("已有");
    voice.handle({ method: "thread/realtime/closed", params: { threadId: "original" } });
    await voice.start("tab2", "other", "v=0", voiceId);
  });
});

it("routes committed tail after stop only with exact native call identity, including while another call is active", async()=>{
 const {voice,emit}=setup();await voice.start('tab1','original','v=0',voiceId);
 voice.handle({method:'thread/realtime/started',params:{threadId:'original',realtimeSessionId:'native-one'}});await voice.stop('tab1','original',voiceId);emit.mockClear();
 const committed=(callId:string)=>({method:'thread/realtime/item/completed',params:{threadId:'original',item:{type:'transcriptSegment',id:'tail',realtimeSessionId:callId,role:'assistant',text:'Committed tail'}}});
 voice.handle(committed('other'));expect(emit).not.toHaveBeenCalled();voice.handle(committed('native-one'));expect(emit).toHaveBeenCalledWith('tab1',expect.objectContaining({voiceId,method:'thread/realtime/item/completed'}));
 await voice.start('tab2','second','v=0','22222222-2222-4222-8222-222222222222');emit.mockClear();voice.handle(committed('native-one'));expect(emit).toHaveBeenCalledWith('tab1',expect.objectContaining({voiceId}));
});

it('retains the early first segment until native started identifies this browser call',async()=>{
 const {voice,emit}=setup();await voice.start('tab','original','v=0',voiceId);
 const frame={method:'thread/realtime/item/completed',params:{threadId:'original',item:{type:'transcriptSegment',id:'early',realtimeSessionId:'native',role:'user',text:'First'}}};
 voice.handle(frame);expect(emit).not.toHaveBeenCalled();voice.handle({method:'thread/realtime/started',params:{threadId:'original',realtimeSessionId:'native'}});expect(emit.mock.calls.filter(([,p])=>p.method==='thread/realtime/item/completed')).toHaveLength(1);
});
it('uses canonical boundary IDs and refuses to guess unseen late segments when a native ID is reused',async()=>{
 const {voice,emit}=setup();const frame=(type:string,id:string)=>({method:'thread/realtime/item/completed',params:{threadId:'original',item:{type,id,realtimeSessionId:'reused',role:'user',text:'Again'}}});
 await voice.start('old','original','v=0',voiceId);voice.handle(frame('realtimeSessionStarted','boundary-old'));voice.handle(frame('transcriptSegment','known-old'));await voice.stop('old','original',voiceId);
 const next='22222222-2222-4222-8222-222222222222';await voice.start('new','original','v=0',next);voice.handle(frame('realtimeSessionStarted','boundary-new'));emit.mockClear();voice.handle(frame('transcriptSegment','known-old'));
 expect(emit).toHaveBeenCalledWith('old',expect.objectContaining({voiceId}));emit.mockClear();voice.handle(frame('transcriptSegment','unseen'));expect(emit.mock.calls.every(([,p])=>p.method==='thread/realtime/transcript/refresh')).toBe(true);expect(emit).toHaveBeenCalledTimes(2);
});

it('does not terminate the newer reused-ID call on an anonymous late closed notification',async()=>{
 const {voice,emit}=setup();const started=(id:string)=>({method:'thread/realtime/item/completed',params:{threadId:'original',item:{type:'realtimeSessionStarted',id,realtimeSessionId:'same'}}});
 await voice.start('old','original','v=0',voiceId);voice.handle(started('old-boundary'));await voice.stop('old','original',voiceId);await voice.start('new','original','v=0','22222222-2222-4222-8222-222222222222');voice.handle(started('new-boundary'));emit.mockClear();voice.handle({method:'thread/realtime/closed',params:{threadId:'original'}});expect(voice.active.owner).toBe('new');expect(emit).toHaveBeenCalledWith('new',expect.objectContaining({method:'thread/realtime/transcript/refresh'}));
});

it('does not send an early new segment to the old call before the new started boundary',async()=>{
 const {voice,emit}=setup();const frame=(type:string,id:string)=>({method:'thread/realtime/item/completed',params:{threadId:'original',item:{type,id,realtimeSessionId:'same',role:'user',text:'First new sentence'}}});
 await voice.start('old','original','v=0',voiceId);voice.handle(frame('realtimeSessionStarted','old'));await voice.stop('old','original',voiceId);await voice.start('new','original','v=0','22222222-2222-4222-8222-222222222222');emit.mockClear();voice.handle(frame('transcriptSegment','early-new'));expect(emit).not.toHaveBeenCalled();voice.handle(frame('realtimeSessionStarted','new'));expect(emit.mock.calls.filter(([,p])=>p.params?.item?.id==='early-new')).toHaveLength(0);expect(emit.mock.calls.some(([owner,p])=>owner==='new'&&p.method==='thread/realtime/transcript/refresh')).toBe(true);
});
