import * as THREE from "three";
import type { RootState } from "@react-three/fiber";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderProbe, intervalStats, sceneInventory } from "@/features/ring-ship/renderProbe";

function fixture(disjointTimer = false) {
  const canvas = document.createElement("canvas"), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const actor = new THREE.Group(); actor.name="duck-crew:private-agent-id"; actor.add(mesh); scene.add(actor); camera.position.z=5;camera.updateMatrixWorld();scene.updateMatrixWorld(true);
  const context = { getExtension: (name: string) => name === "EXT_disjoint_timer_query_webgl2" && disjointTimer ? { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 } : null, getParameter: (value: number) => value === 2 ? true : "test GPU", isContextLost: () => false, getContextAttributes: () => ({ antialias: true }), QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4, createQuery: () => ({}), beginQuery: vi.fn(), endQuery: vi.fn(), deleteQuery: vi.fn(), getQueryParameter: (_: unknown, value: number) => value === 3 ? true : 2_000_000 };
  let pixelRatio = 1.5;
  const renderer = { domElement: canvas, shadowMap: { enabled: true, autoUpdate: true, type: THREE.PCFSoftShadowMap }, getContext: () => context, getPixelRatio: () => pixelRatio, setPixelRatio: (value: number) => {pixelRatio=value;}, info: { render: { triangles: 12 }, memory: { geometries: 1, textures: 0 }, programs: [] }, renderBufferDirect: vi.fn(), render: (view: THREE.Scene, lens: THREE.Camera) => { renderer.renderBufferDirect(lens, view, mesh.geometry, mesh.material, mesh, null); } };
  const motion = { current: vi.fn() }, host = { current: () => renderer.render(scene, camera) };
  const state = { gl: renderer, scene, camera, internal: { subscribers: [{ref:motion,priority:0},{ref:host,priority:1}] } } as unknown as RootState;
  const fiber = { memoizedProps: { agents: [{ name: "PRIVATE CONVERSATION", id:"private-agent-id" }], arrivalsRef: {} }, memoizedState: { memoizedState: motion } };
  const original = { render: renderer.render, direct: renderer.renderBufferDirect, motion: motion.current, host: host.current };
  const frames = setInterval(() => { for (const sub of state.internal.subscribers) sub.ref.current(state,.016,undefined); },16);
  return { state, renderer, context, fiber, original, motion, host, canvas, frames, mesh };
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document,"hidden","get").mockReturnValue(false); });
afterEach(() => {vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();});

describe("opt-in real-device render capture", () => {
  it("keeps rendering while animations pause, records actual DPR, then restores every patch", async () => {
    const f=fixture(),probe=createRenderProbe(()=>f.state,()=>f.fiber);
    const promise=probe.capture(()=>{},160);await vi.advanceTimersByTimeAsync(4000);const report=await promise;
    expect(report.phases.map(p=>p.phase)).toEqual(["normal","animations-paused","half-resolution","normal-repeat"]);
    expect(report.phases.every(p=>p.frames>=5)).toBe(true);
    expect(report.phases[0].callbacks["crew-movement-and-collision"].calls).toBeGreaterThan(0);
    expect(report.phases[1].callbacks["crew-movement-and-collision"]).toBeUndefined();
    expect(report.phases[2].actualDpr).toEqual([.75]);expect(report.phases[3].actualDpr).toEqual([1.5]);
    expect(f.renderer.getPixelRatio()).toBe(1.5);expect(f.renderer.render).toBe(f.original.render);expect(f.renderer.renderBufferDirect).toBe(f.original.direct);
    expect(f.motion.current).toBe(f.original.motion);expect(f.host.current).toBe(f.original.host);
    expect(report.hardware.gpuTimerSupported).toBe(false);expect(report.phases.every(p=>p.gpuIntervalMs.mean===null)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE CONVERSATION|private-agent-id/);
    probe.dispose();clearInterval(f.frames);
  });
  it("aborts and restores after context loss instead of uploading a misleading result", async () => {
    const f=fixture(),probe=createRenderProbe(()=>f.state,()=>f.fiber),promise=probe.capture(()=>{},160);
    const rejection=expect(promise).rejects.toThrow("上下文丢失");
    f.canvas.dispatchEvent(new Event("webglcontextlost"));await vi.advanceTimersByTimeAsync(1000);await rejection;
    expect(f.renderer.render).toBe(f.original.render);expect(f.motion.current).toBe(f.original.motion);expect(f.renderer.getPixelRatio()).toBe(1.5);
  });
  it("compares only shadows without pausing motion or changing resolution, and restores shader variants", async () => {
    const f=fixture(), version=f.mesh.material.version, probe=createRenderProbe(()=>f.state,()=>f.fiber);
    const promise=probe.capture(()=>{},160,"shadows");await vi.advanceTimersByTimeAsync(3000);const report=await promise;
    expect(report.mode).toBe("shadows");
    expect(report.phases.map(p=>p.phase)).toEqual(["normal","shadows-off","normal-repeat"]);
    expect(report.phases.map(p=>p.shadowMapEnabled)).toEqual([[true],[false],[true]]);
    expect(report.phases.every(p=>p.actualDpr.length===1 && p.actualDpr[0]===1.5)).toBe(true);
    expect(report.phases.every(p=>p.callbacks["crew-movement-and-collision"].calls>0)).toBe(true);
    expect(f.renderer.shadowMap).toEqual({enabled:true,autoUpdate:true,type:THREE.PCFSoftShadowMap});
    expect(f.mesh.material.version).toBe(version+2);
    expect(f.renderer.render).toBe(f.original.render);expect(f.motion.current).toBe(f.original.motion);
  });
  it("restores shadows when capture is interrupted during the shadows-off phase", async () => {
    const f=fixture(),probe=createRenderProbe(()=>f.state,()=>f.fiber),promise=probe.capture(()=>{},160,"shadows");
    const rejection=expect(promise).rejects.toThrow("上下文丢失");
    await vi.advanceTimersByTimeAsync(1600);expect(f.renderer.shadowMap.enabled).toBe(false);
    f.canvas.dispatchEvent(new Event("webglcontextlost"));await vi.advanceTimersByTimeAsync(1000);await rejection;
    expect(f.renderer.shadowMap.enabled).toBe(true);expect(f.renderer.getPixelRatio()).toBe(1.5);
    expect(f.renderer.render).toBe(f.original.render);expect(f.motion.current).toBe(f.original.motion);
  });
  it("refuses an already-disabled baseline rather than reporting a false comparison", async () => {
    const f=fixture();f.renderer.shadowMap.enabled=false;
    const probe=createRenderProbe(()=>f.state,()=>f.fiber);
    await expect(probe.capture(()=>{},160,"shadows")).rejects.toThrow("阴影已经关闭");
    expect(f.renderer.shadowMap.enabled).toBe(false);expect(f.renderer.render).toBe(f.original.render);
  });
  it("discards disjoint GPU timer results", async () => {
    const f=fixture(true),probe=createRenderProbe(()=>f.state,()=>f.fiber),promise=probe.capture(()=>{},160);
    await vi.advanceTimersByTimeAsync(4000);const report=await promise;
    expect(f.context.beginQuery).toHaveBeenCalled();expect(f.context.deleteQuery).toHaveBeenCalled();
    expect(report.hardware.gpuTimerSupported).toBe(true);expect(report.phases.every(p=>p.gpuIntervalMs.mean===null)).toBe(true);
  });
  it("ranks merged furniture geometry without pretending each prop has a separate draw call", () => {
    const f=fixture(),owner={kind:"chairDesk",privateName:"SECRET"};
    const merged=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
    merged.userData.shipObjectRanges=[{object:owner,count:18},{object:owner,count:18}];f.state.scene.add(merged);f.state.scene.updateMatrixWorld(true);
    const row=sceneInventory(f.state).models.find(m=>m.model==="furniture:chairDesk")!;
    expect(row).toMatchObject({objects:1,triangles:12,maxSingleObjectTriangles:12,sharedBatch:true});
    expect(JSON.stringify(row)).not.toContain("SECRET");
  });
  it("uses frame intervals for percentiles and leaves missing data unavailable", () => {
    expect(intervalStats([])).toEqual({mean:null,p95:null,max:null});
    expect(intervalStats([8,8,16,32])).toEqual({mean:16,p95:32,max:32});
  });
});
