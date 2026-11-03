import * as THREE from "three";
import type { RootState } from "@react-three/fiber";

export type ProbePhase = "normal" | "animations-paused" | "half-resolution" | "normal-repeat";
type Counter = { calls: number; totalMs: number; maxMs: number };
type Fiber = { memoizedProps?: Record<string, unknown>; memoizedState?: Hook; child?: Fiber; sibling?: Fiber };
type Hook = { memoizedState?: unknown; next?: Hook };
type FrameRef = RootState["internal"]["subscribers"][number]["ref"];
export type PhaseResult = { phase: ProbePhase; durationMs: number; frames: number; fps: number; frameIntervalMs: { mean: number | null; p95: number | null; max: number | null }; rendererCpuMsPerFrame: number | null; callbacks: Record<string, Counter>; drawGroups: Record<string, Counter & { triangles: number; timedCalls: number }>; timedDrawFrames: number; submissionsPerFrame: number | null; trianglesPerFrame: number | null; gpuIntervalMs: { mean: number | null; samples: number }; longTasks: number[]; actualDpr: number[]; errors: string[] };
type Sample = { phase: ProbePhase; start: number; frames: number; last: number; intervals: number[]; rendererMs: number; callbacks: Record<string, Counter>; drawGroups: Record<string, Counter & { triangles: number; timedCalls: number }>; submissions: number; timedDrawFrames: number; triangles: number; gpu: number[]; longTasks: number[]; dpr: Set<number>; errors: string[] };
export type ProbeReport = { schema: 1; id: string; createdAt: string; hardware: ReturnType<typeof hardwareInfo>; scene: ReturnType<typeof sceneInventory>; phases: PhaseResult[]; cameraStable: boolean; notes: string[] };
export const PROBE_PHASES: readonly ProbePhase[] = ["normal", "animations-paused", "half-resolution", "normal-repeat"];
const mean = (values: number[]) => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
export function intervalStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: mean(values), p95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] : null, max: sorted.at(-1) ?? null };
}
function addCounter(map: Record<string, Counter>, key: string, elapsed: number) {
  const entry = map[key] ||= { calls: 0, totalMs: 0, maxMs: 0 };
  entry.calls++; entry.totalMs += elapsed; entry.maxMs = Math.max(entry.maxMs, elapsed);
}
export function hardwareInfo(state: RootState) {
  const gl = state.gl, context = gl.getContext(), debug = context.getExtension("WEBGL_debug_renderer_info");
  return { userAgent: navigator.userAgent, vendor: debug ? context.getParameter(debug.UNMASKED_VENDOR_WEBGL) : context.getParameter(context.VENDOR), renderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER), version: context.getParameter(context.VERSION), contextLost: context.isContextLost(), attributes: context.getContextAttributes(), gpuTimerSupported: !!context.getExtension("EXT_disjoint_timer_query_webgl2"), cssSize: [gl.domElement.clientWidth, gl.domElement.clientHeight], bufferSize: [gl.domElement.width, gl.domElement.height], devicePixelRatio: window.devicePixelRatio, rendererPixelRatio: gl.getPixelRatio(), visibility: document.visibilityState };
}
function visible(object: THREE.Object3D) { for (let p: THREE.Object3D | null = object; p; p = p.parent) if (!p.visible) return false; return true; }
export function drawGroup(object: THREE.Object3D): string {
  for (let p: THREE.Object3D | null = object; p; p = p.parent) {
    if (p.name.startsWith("duck-crew:")) return "crew-models";
    if (p.name.startsWith("ship-companion:")) return p.name;
    if (p.name === "office-ceo") return "ceo";
    if (p.name.startsWith("hibernation-")) return "hibernation-pods";
    if (p.name.startsWith("space-")) return "space-activity";
    if (p.userData.shipCollisionBoxes) return "static-furniture-batches";
  }
  return "hull-and-other-equipment";
}
function modelOwner(object: THREE.Object3D) {
  for (let p: THREE.Object3D | null = object; p; p = p.parent) {
    if (/^(duck-crew:|ship-companion:|hibernation-pod:)/.test(p.name) || p.name === "office-ceo") return p;
  }
  return object;
}
export function sceneInventory(state: RootState) {
  const models = new Map<string, { objects: number; meshes: number; triangles: number; maxSingleObjectTriangles: number; sharedBatch: boolean }>();
  const singleObjects = new Map<object, { key: string; triangles: number }>(), counted = new Set<object>(), geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const clip = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse));
  let meshes = 0, submittedMeshes = 0, geometryBytes = 0, transparentMeshes = 0;
  state.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !visible(object)) return;
    meshes++; if (object.frustumCulled && !clip.intersectsObject(object)) return;
    submittedMeshes++;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    sourceMaterials.forEach(m => materials.add(m)); if (sourceMaterials.some(m => m.transparent)) transparentMeshes++;
    const geometry = object.geometry;
    if (!geometries.has(geometry)) { geometries.add(geometry); for (const name in geometry.attributes) geometryBytes += geometry.getAttribute(name).array.byteLength; geometryBytes += geometry.index?.array.byteLength || 0; }
    const ranges = object.userData.shipObjectRanges as Array<{ object: { kind: string }; count: number }> | undefined;
    if (ranges?.length) {
      for (const range of ranges) {
        const key = "furniture:" + range.object.kind, entry = models.get(key) || { objects: 0, meshes: 0, triangles: 0, maxSingleObjectTriangles: 0, sharedBatch: true };
        if (!counted.has(range.object)) { counted.add(range.object); entry.objects++; }
        entry.triangles += range.count / 3; models.set(key, entry); const single = singleObjects.get(range.object) || { key, triangles: 0 }; single.triangles += range.count / 3; singleObjects.set(range.object, single);
      }
    } else {
      const key = drawGroup(object), entry = models.get(key) || { objects: 0, meshes: 0, triangles: 0, maxSingleObjectTriangles: 0, sharedBatch: false };
      const triangles = (geometry.index?.count || geometry.getAttribute("position")?.count || 0) / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1);
      const owner = modelOwner(object);
      if (!counted.has(owner)) { counted.add(owner); entry.objects++; }
      const single = singleObjects.get(owner) || { key, triangles: 0 }; single.triangles += triangles; singleObjects.set(owner, single);
      entry.meshes++; entry.triangles += triangles; models.set(key, entry);
    }
  });
  for (const single of singleObjects.values()) { const entry = models.get(single.key)!; entry.maxSingleObjectTriangles = Math.max(entry.maxSingleObjectTriangles, single.triangles); }
  return { meshes, submittedMeshes, transparentMeshes, uniqueGeometries: geometries.size, uniqueMaterials: materials.size, geometryBufferBytes: geometryBytes, models: [...models].map(([model, values]) => ({ model, ...values })).sort((a, b) => b.triangles - a.triangles), rendererMemory: { ...state.gl.info.memory }, programs: state.gl.info.programs?.length, frameCallbacks: state.internal.subscribers.length };
}
function componentName(fiber: Fiber) {
  const p = fiber.memoizedProps || {};
  if ("agentId" in p && "agentsRef" in p) return "crew-model-animation";
  if ("agent" in p && "placement" in p) return "crew-nameplates";
  if ("agents" in p && "arrivalsRef" in p) return "crew-movement-and-collision";
  if (typeof p.kind === "string" && "companionsRef" in p) return "npc:" + p.kind;
  if ("profile" in p && "bodyRef" in p) return "ceo-routine";
  if ("trip" in p && "controlsRef" in p) return "render-controller-includes-renderer";
  if ("controlsRef" in p && "lookupRef" in p) return "camera";
  if ("layout" in p && "serverHosts" in p && "onSelect" in p) return "static-furniture-lights";
  if ("cabin" in p && "index" in p && "lookupRef" in p) return "hibernation-animation";
  if ("figure" in p && "stateRef" in p) return "character-figure-animation";
  if ("companionsRef" in p && "crewRef" in p) {
    for (let hook = fiber.memoizedState; hook; hook = hook.next) {
      const value = hook.memoizedState as { current?: unknown } | undefined, current = value?.current;
      if (current instanceof THREE.Object3D && /^ship-companion:(kirby|dumu|dufu)$/.test(current.name)) return current.name + "-controller";
      if (Array.isArray(current) && current.some(item => item instanceof THREE.Object3D && item.name === "ship-companion:dumu")) return "npc:dog-duo-controller";
    }
  }
  return "component:" + Object.keys(p).filter(key => key !== "children").slice(0, 6).join(",");
}
function frameOwners(root?: Fiber) {
  const owners = new Map<object, string>(), stack = [root], seen = new Set<Fiber>();
  while (stack.length) {
    const fiber = stack.pop(); if (!fiber || seen.has(fiber)) continue; seen.add(fiber);
    let hook = fiber.memoizedState;
    while (hook && typeof hook === "object") {
      const value = hook.memoizedState;
      if (value && typeof value === "object" && "current" in value && typeof value.current === "function") owners.set(value, componentName(fiber));
      hook = hook.next;
    }
    stack.push(fiber.child, fiber.sibling);
  }
  return owners;
}

// Opt-in, disposable instrumentation. Never persists quality settings or samples content.
export function createRenderProbe(getState: () => RootState, getFiber: () => unknown) {
  const state = getState(), renderer = state.gl, context = renderer.getContext() as WebGL2RenderingContext, initialDpr = renderer.getPixelRatio();
  const originalRender = renderer.render, originalDirect = renderer.renderBufferDirect;
  const wrappers = new Map<FrameRef, { original: FrameRef["current"]; wrapper: FrameRef["current"] }>(), labels = new WeakMap<THREE.Object3D, string>();
  const gpuExtension = context.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const pending: Array<{ query: WebGLQuery; sample: Sample }> = [];
  let sample: Sample | null = null, phase: ProbePhase | null = null, frame = 0, depth = 0, disposed = false, abortReason = "", warmed = false;
  const fail = (reason: string) => { abortReason = reason; };
  const visibility = () => { if (document.hidden) fail("采样期间切到了后台，请保持 Office 在前台重测。"); };
  const lost = () => fail("采样期间 WebGL 上下文丢失，报告需要进一步检查驱动或浏览器。");
  document.addEventListener("visibilitychange", visibility); renderer.domElement.addEventListener("webglcontextlost", lost);
  const resize = () => fail("采样期间屏幕尺寸变化，请固定展开状态和方向后重测。");
  window.addEventListener("resize", resize);
  let observer: PerformanceObserver | undefined;
  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    observer = new PerformanceObserver(list => { if (sample) for (const entry of list.getEntries()) sample.longTasks.push(entry.duration); });
    observer.observe({ entryTypes: ["longtask"] });
  }
  const cameraPose = () => [...getState().camera.matrixWorld.elements, ...getState().camera.projectionMatrix.elements];
  const pose = cameraPose();
  function wrapFrames() {
    const owners = frameOwners(getFiber() as Fiber);
    for (const sub of getState().internal.subscribers) {
      if (wrappers.get(sub.ref)?.wrapper === sub.ref.current) continue;
      const original = sub.ref.current, name = owners.get(sub.ref) || "unmapped-frame-callback";
      const wrapper: FrameRef["current"] = (...args) => {
        if (phase === "animations-paused" && sub.priority <= 0) return;
        const start = performance.now();
        try { return original(...args); }
        finally { if (sample) addCounter(sample.callbacks, name, performance.now() - start); }
      };
      wrappers.set(sub.ref, { original, wrapper }); sub.ref.current = wrapper;
    }
  }
  renderer.renderBufferDirect = function (...args) {
    const current = sample;
    if (!current || !depth) return originalDirect.apply(this, args);
    const object = args[4], key = labels.get(object) || drawGroup(object); labels.set(object, key);
    const entry = current.drawGroups[key] ||= { calls: 0, totalMs: 0, maxMs: 0, triangles: 0, timedCalls: 0 };
    const geometry = args[2], count = Math.min(geometry.index?.count || geometry.getAttribute("position")?.count || 0, args[5]?.count ?? Infinity, geometry.drawRange.count);
    current.submissions++;
    if (object instanceof THREE.Mesh) entry.triangles += count / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1);
    entry.calls++;
    if (frame % 8 !== 0) return originalDirect.apply(this, args);
    const start = performance.now();
    try { return originalDirect.apply(this, args); }
    finally { const elapsed = performance.now() - start; entry.timedCalls++; entry.totalMs += elapsed; entry.maxMs = Math.max(entry.maxMs, elapsed); }
  };
  renderer.render = function (scene, camera) {
    const main = scene === getState().scene && depth === 0, current = sample;
    if (main) {
      frame++; if (current && frame % 8 === 0) current.timedDrawFrames++;
      const desiredDpr = phase === "half-resolution" ? initialDpr * .5 : initialDpr;
      if (this.getPixelRatio() !== desiredDpr) this.setPixelRatio(desiredDpr);
      // Sampling and asynchronous polling avoid gl.finish/readback stalls.
      if (gpuExtension && frame % 5 === 0) while (pending.length && context.getQueryParameter(pending[0].query, context.QUERY_RESULT_AVAILABLE)) {
        const item = pending.shift()!;
        if (!context.getParameter(gpuExtension.GPU_DISJOINT_EXT)) item.sample.gpu.push(context.getQueryParameter(item.query, context.QUERY_RESULT) / 1e6);
        context.deleteQuery(item.query);
      }
    }
    let query: WebGLQuery | null = null;
    if (main && current && gpuExtension && frame % 15 === 0 && pending.length < 2) {
      query = context.createQuery(); if (query) context.beginQuery(gpuExtension.TIME_ELAPSED_EXT, query);
    }
    const start = performance.now(); depth++;
    try { return originalRender.call(this, scene, camera); }
    catch (cause) { fail("渲染期间出现异常：" + (cause instanceof Error ? cause.message : "unknown")); throw cause; }
    finally {
      depth--;
      if (query) { context.endQuery(gpuExtension!.TIME_ELAPSED_EXT); pending.push({ query, sample: current! }); }
      if (main && current) {
        const now = performance.now(); current.frames++; current.rendererMs += now - start; current.triangles += this.info.render.triangles; current.dpr.add(this.getPixelRatio());
        if (current.last) current.intervals.push(now - current.last); current.last = now;
      }
    }
  };
  wrapFrames(); const timer = setInterval(wrapFrames, 500);
  function dispose() {
    if (disposed) return; disposed = true; sample = null; phase = null; clearInterval(timer); observer?.disconnect();
    document.removeEventListener("visibilitychange", visibility); window.removeEventListener("resize", resize); renderer.domElement.removeEventListener("webglcontextlost", lost);
    for (const [ref, entry] of wrappers) if (ref.current === entry.wrapper) ref.current = entry.original;
    renderer.render = originalRender; renderer.renderBufferDirect = originalDirect;
    if (!context.isContextLost()) { if (renderer.getPixelRatio() !== initialDpr) renderer.setPixelRatio(initialDpr); for (const item of pending) context.deleteQuery(item.query); }
  }
  return {
    dispose,
    async capture(progress: (phase: ProbePhase, seconds: number) => void, durationMs = 5000): Promise<ProbeReport> {
      const report: ProbeReport = { schema: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), hardware: hardwareInfo(getState()), scene: sceneInventory(getState()), phases: [], cameraStable: true, notes: ["FPS measures the render loop, not Android compositor presentation.", "Renderer CPU timing includes command submission and possible driver waits; it is not GPU utilization.", "Callback timers are inclusive. The render controller includes renderer time and must not be added to it.", "Draw CPU timings sample every eighth root frame; totalMs uses timedDrawFrames, not all frames. Calls/triangles count all frames.", "Model triangle counts are geometry rankings, not proof of GPU cost. Shared material batches contain multiple furniture kinds.", "Half resolution and paused animations are temporary diagnostic controls, restored before upload. No quality preference is saved."] };
      try {
        if (document.hidden || context.isContextLost()) throw new Error("请保持 Office 在前台，等飞船正常显示后再采样。");
        for (const next of PROBE_PHASES) {
          phase = next; progress(next, Math.ceil(durationMs / 1000));
          // Let resize/material/animation transitions settle before counting frames.
          if (!warmed || next !== "normal") await new Promise(resolve => setTimeout(resolve, 700)); warmed = true;
          if (disposed || abortReason) throw new Error(abortReason || "采样已取消。");
          const current: Sample = { phase: next, start: performance.now(), frames: 0, last: 0, intervals: [], rendererMs: 0, callbacks: {}, drawGroups: {}, submissions: 0, timedDrawFrames: 0, triangles: 0, gpu: [], longTasks: [], dpr: new Set(), errors: [] }; sample = current;
          const countdown = setInterval(() => progress(next, Math.max(0, Math.ceil((durationMs - performance.now() + current.start) / 1000))), 1000);
          try { await new Promise(resolve => setTimeout(resolve, durationMs)); } finally { clearInterval(countdown); sample = null; }
          if (disposed || abortReason) throw new Error(abortReason || "采样已取消。");
          const elapsed = performance.now() - current.start, n = current.frames;
          report.phases.push({ phase: next, durationMs: elapsed, frames: n, fps: n / elapsed * 1000, frameIntervalMs: intervalStats(current.intervals), rendererCpuMsPerFrame: n ? current.rendererMs / n : null, callbacks: current.callbacks, drawGroups: current.drawGroups, timedDrawFrames: current.timedDrawFrames, submissionsPerFrame: n ? current.submissions / n : null, trianglesPerFrame: n ? current.triangles / n : null, gpuIntervalMs: { mean: mean(current.gpu), samples: current.gpu.length }, longTasks: current.longTasks, actualDpr: [...current.dpr], errors: current.errors });
        }
        const finalPose = cameraPose(); report.cameraStable = pose.every((n, i) => Math.abs(n - finalPose[i]) < .01);
        if (!report.cameraStable) report.notes.push("Camera changed during capture; controlled comparisons may not be comparable.");
        if (!report.hardware.gpuTimerSupported) report.notes.push("This device does not expose GPU timer queries. GPU time is unavailable; CPU render duration is not a substitute.");
        if (report.phases.some(p => p.frames < 5)) throw new Error("有效渲染帧不足，请关闭监控面板并回到飞船后重试。");
        return report;
      } finally { dispose(); }
    },
  };
}
