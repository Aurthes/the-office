"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, Stars } from "@react-three/drei";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three";
import { Home, Settings2, Users, X } from "lucide-react";
import type { RetroOffice3D } from "@/features/retro-office/RetroOffice3D";
import type { OfficeAgent, RenderAgent } from "@/features/retro-office/core/types";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import { CANVAS_W, CANVAS_H, SCALE } from "@/features/retro-office/core/constants";
import { AgentModel } from "@/features/retro-office/objects/agents";
import { CompanyWorkAreaMenu } from "@/features/office/components/CompanyWorkAreaMenu";
import { SettingsPanel } from "@/features/office/components/panels/SettingsPanel";
import { areaBounds, PUBLIC_DESCRIPTIONS, routeBetweenCabins, SHARED_PROJECT_ID, type ShipLayout, type ShipPoint } from "./layout";
import { buildShipGeometry, disposeShipGeometry, FURNITURE_MODELS, SHIP_WORKSTATION, type ModelTemplates } from "./geometry";
import { useShipLayout } from "./useShipLayout";

type Props = ComponentProps<typeof RetroOffice3D>;
type Controls = ComponentRef<typeof OrbitControls>;
const EMPTY_ROSTER: CompanyRoster = { projects: [], members: [] };
let modelCache: ModelTemplates | undefined;
let modelPromise: Promise<ModelTemplates> | undefined;
function useModels() {
  const [models, setModels] = useState<ModelTemplates>(() => modelCache || {});
  useEffect(() => {
    let active = true;
    if (!modelPromise) {
      const loader = new GLTFLoader();
      modelPromise = Promise.allSettled(FURNITURE_MODELS.map(name => loader.loadAsync(`/office-assets/models/furniture/${name}.glb`))).then(results => {
        modelCache = Object.fromEntries(results.flatMap((result, index) => result.status === "fulfilled" ? [[FURNITURE_MODELS[index], result.value.scene]] : [])) as ModelTemplates;
        return modelCache;
      });
    }
    void modelPromise.then(value => { if (active) setModels(value); });
    return () => { active = false; };
  }, []);
  return models;
}
function StaticShip({ layout }: { layout: ShipLayout }) {
  const models = useModels();
  const group = useMemo(() => buildShipGeometry(layout, models), [layout, models]);
  useEffect(() => () => disposeShipGeometry(group), [group]);
  return <primitive object={group} />;
}
function Lighting() {
  return <>
    <Environment resolution={64} frames={1} environmentIntensity={0.6}>
      <Lightformer intensity={2} position={[0, 8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
      <Lightformer intensity={1.3} position={[-8, 3, 0]} rotation={[0, Math.PI / 2, 0]} scale={[8, 6, 1]} />
    </Environment>
    <hemisphereLight args={["#c9e4f1", "#667078", 0.85]} />
    <directionalLight position={[-20, 35, 25]} intensity={2.6} color="#ffe7c7" castShadow shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45} shadow-camera-far={120} shadow-normalBias={0.035} />
    <directionalLight position={[25, 12, -25]} intensity={0.65} color="#a0d7ed" />
  </>;
}
function CameraRig({ layout, focus, controlsRef }: { layout: ShipLayout; focus: { id: string; request: number }; controlsRef: RefObject<Controls | null> }) {
  const { size } = useThree();
  const move = useRef<{ target: THREE.Vector3; position: THREE.Vector3; zoom: number } | null>(null);
  useEffect(() => {
    const bounds = areaBounds(layout, focus.id), target = new THREE.Vector3(bounds.x, 0, bounds.z);
    const span = Math.max(bounds.width, bounds.depth);
    const zoom = focus.id ? Math.min(size.width / (span * 1.35 + 7), size.height / (span * 0.8 + 8)) : Math.min(size.width / (layout.radius * 2.5), size.height / (layout.radius * 1.82));
    const offset = new THREE.Vector3(25, 40, 36);
    if (focus.id) offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(bounds.x, bounds.z));
    move.current = { target, position: target.clone().add(offset), zoom: Math.max(0.2, zoom * 0.92) };
  }, [layout, focus, size.width, size.height]);
  useEffect(() => {
    const controls = controlsRef.current;
    const stop = () => { move.current = null; };
    controls?.addEventListener("start", stop);
    return () => controls?.removeEventListener("start", stop);
  }, [controlsRef]);
  useFrame((state, delta) => {
    const camera = state.camera;
    const next = move.current, controls = controlsRef.current;
    if (!next || !controls) return;
    const rate = 1 - Math.exp(-delta * 7);
    camera.position.lerp(next.position, rate); controls.target.lerp(next.target, rate);
    camera.zoom = THREE.MathUtils.lerp(camera.zoom, next.zoom, rate); camera.updateProjectionMatrix();
    controls.update();
    if (camera.position.distanceToSquared(next.position) < 0.001 && Math.abs(camera.zoom - next.zoom) < 0.005) move.current = null;
  });
  return null;
}

function CabinTargets({ layout, focus, onSelect }: { layout: ShipLayout; focus: string; onSelect: (id: string) => void }) {
  const step = Math.PI * 2 / layout.allocation.sectors;
  return <>{layout.cabins.map(cabin => {
    const ring = layout.rings[cabin.ring], selected = cabin.id === focus || cabin.projectId === focus;
    return <mesh key={cabin.id} position={[0, 0.075, 0]} rotation={[-Math.PI / 2, 0, 0]}
      onClick={event => { event.stopPropagation(); onSelect(cabin.projectId || cabin.id); }}>
      <ringGeometry args={[ring.radius - ring.depth / 2 + 0.1, ring.radius + ring.depth / 2 - 0.1, 24, 1, cabin.slot * step - Math.PI / 2, step]} />
      <meshBasicMaterial side={THREE.DoubleSide} color={cabin.color} transparent opacity={selected ? 0.15 : 0} depthWrite={false} />
    </mesh>;
  })}</>;
}
type MovingAgent = RenderAgent & { route: ShipPoint[]; routeIndex: number; pauseUntil: number; home: ShipPoint; visiting: boolean };
function canvasPoint(point: ShipPoint) { return { x: point.x / SCALE + CANVAS_W / 2, y: point.z / SCALE + CANVAS_H / 2 }; }
function worldPoint(agent: RenderAgent): ShipPoint { return { x: (agent.x - CANVAS_W / 2) * SCALE, z: (agent.y - CANVAS_H / 2) * SCALE }; }
function hash(value: string) { let result = 0; for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0; return result; }
// These are mutable animation objects owned by Three.js, not React state.
function advanceCrew(crew: MovingAgent[], layout: ShipLayout, now: number, delta: number) {
  const dt = Math.min(delta, 0.05), amenities = layout.cabins.filter(c => ["garden", "lounge", "canteen", "gym", "observatory"].includes(c.kind));
  for (const a of crew) {
    const seat = layout.seats[a.id]; if (!seat) continue;
    a.frame += dt * 60;
    if (a.status === "working" || a.status === "error" || a.needsInput) {
      a.route = []; a.visiting = false; const p = canvasPoint(a.home); a.x = p.x; a.y = p.y; a.facing = seat.facing;
      a.state = a.status === "working" ? "sitting" : "standing"; a.interactionTarget = a.status === "working" ? "desk" : undefined; continue;
    }
    a.interactionTarget = undefined;
    if (!a.route.length && now > a.pauseUntil && amenities.length) {
      const destination = amenities[hash(a.id) % amenities.length];
      if (!a.visiting) a.route = routeBetweenCabins(layout, seat, destination);
      else a.route = [...routeBetweenCabins(layout, seat, destination)].reverse().concat([a.home]);
      a.visiting = !a.visiting; a.routeIndex = 0;
    }
    const target = a.route[a.routeIndex];
    if (!target) { a.state = "standing"; continue; }
    const p = worldPoint(a), dx = target.x - p.x, dz = target.z - p.z, distance = Math.hypot(dx, dz), stride = dt * 1.05;
    a.state = "walking"; a.facing = Math.atan2(dx, dz);
    const next = distance < stride ? target : { x: p.x + dx / distance * stride, z: p.z + dz / distance * stride };
    Object.assign(a, canvasPoint(next));
    if (distance < stride) {
      a.routeIndex += 1;
      if (a.routeIndex >= a.route.length) { a.route = []; a.pauseUntil = now + 16000 + hash(a.id) % 20000; a.state = "standing"; }
    }
  }
}
function Crew({ agents, layout, focus, onOpen }: { agents: OfficeAgent[]; layout: ShipLayout; focus: string; onOpen: (id: string) => void }) {
  const agentsRef = useRef<RenderAgent[]>([]), lookup = useRef(new Map<string, RenderAgent>());
  const statsAt = useRef(-3);
  const [hovered, setHovered] = useState<string | null>(null);
  const unhover = useCallback(() => setHovered(null), []);
  const initialPositions = useMemo(() => Object.fromEntries(Object.values(layout.seats).map(seat => [seat.agentId, [seat.x, 0, seat.z] as [number, number, number]])), [layout]);
  useEffect(() => {
    const old = lookup.current, now = performance.now();
    const values: MovingAgent[] = agents.flatMap(agent => {
      const seat = layout.seats[agent.id]; if (!seat) return [];
      const previous = old.get(agent.id) as MovingAgent | undefined, p = canvasPoint(seat);
      const unchanged = previous && Math.hypot(previous.home.x - seat.x, previous.home.z - seat.z) < 0.01;
      const keepRoute = unchanged && previous.status === agent.status;
      return [{ ...agent, x: unchanged ? previous.x : p.x, y: unchanged ? previous.y : p.y, targetX: p.x, targetY: p.y,
        path: [], facing: seat.facing, frame: previous?.frame || hash(agent.id) % 100, state: "standing" as const,
        walkSpeed: 1, phaseOffset: hash(agent.id) % 100, interactionTarget: agent.status === "working" ? "desk" as const : undefined,
        workstation: { ...p, deskUid: seat.cabinId + agent.id, facing: seat.facing, pose: "sitting" as const, seatHeight: SHIP_WORKSTATION.seatHeight, surfaceHeight: SHIP_WORKSTATION.surfaceHeight },
        home: { x: seat.x, z: seat.z }, route: keepRoute ? previous.route : [], routeIndex: keepRoute ? previous.routeIndex : 0,
        visiting: keepRoute ? previous.visiting : false, pauseUntil: keepRoute ? previous.pauseUntil : now + 7000 + hash(agent.id) % 18000 }];
    });
    agentsRef.current = values; lookup.current = new Map(values.map(a => [a.id, a]));
  }, [agents, layout]);
  useFrame((state, delta) => {
    advanceCrew(agentsRef.current as MovingAgent[], layout, performance.now(), delta);
    // Expose bounded renderer evidence to browser checks, outside product UI.
    if (state.clock.elapsedTime - statsAt.current >= 3) {
      state.gl.domElement.dataset.shipDrawCalls = String(state.gl.info.render.calls);
      statsAt.current = state.clock.elapsedTime;
    }
  });
  return <>{agents.map(agent => {
    const seat = layout.seats[agent.id]; if (!seat) return null;
    return <group key={agent.id}>
      <AgentModel agentId={agent.id} name={agent.name} status={agent.status} color={agent.color} appearance={agent.avatarProfile}
        agentsRef={agentsRef} agentLookupRef={lookup} initialPosition={initialPositions[agent.id]} hideLabels
        onHover={setHovered} onUnhover={unhover} onClick={onOpen} />
      <CrewLabel agent={agent} lookup={lookup} onOpen={onOpen} expanded={hovered === agent.id || focus === seat.projectId || !!agent.needsInput || !!agent.needsReview} />
    </group>;
  })}</>;
}
function CrewLabel({ agent, lookup, expanded, onOpen }: { agent: OfficeAgent; lookup: RefObject<Map<string, RenderAgent>>; expanded: boolean; onOpen: (id: string) => void }) {
  const ref = useRef<THREE.Sprite>(null);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = expanded ? 144 : 88;
    const c = canvas.getContext("2d")!; c.fillStyle = "#122733"; c.fillRect(0, 0, 640, canvas.height);
    c.fillStyle = agent.color; c.fillRect(0, 0, 10, canvas.height); c.font = expanded ? "600 42px system-ui" : "600 53px system-ui";
    const marker = agent.needsInput ? "!" : agent.needsReview ? "?" : "";
    if (marker) { c.fillStyle = "#facc15"; c.fillText(marker, 24, 58); }
    const limit = expanded ? 13 : 7, name = agent.name.length > limit ? `${agent.name.slice(0, limit)}…` : agent.name;
    c.fillStyle = "#f3ecdc"; c.fillText(name, marker ? 70 : 24, expanded ? 58 : 62, marker ? 545 : 595);
    if (expanded) { c.font = "28px system-ui"; c.fillStyle = "#9cb4c3"; c.fillText(agent.needsInput ? "等待你的回复" : agent.needsReview ? "有新结果" : agent.status === "working" ? "正在工作" : "空闲", 25, 110); }
    const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace; return result;
  }, [agent.name, agent.color, agent.needsInput, agent.needsReview, agent.status, expanded]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(() => {
    const value = lookup.current.get(agent.id); if (!ref.current) return;
    // Identity is always shown for every placed crew member. Alert state only
    // adds a marker/details; it must never decide whether a name exists.
    ref.current.visible = !!value;
    if (value) { const p = worldPoint(value); ref.current.position.set(p.x, expanded ? 1.9 : 1.55, p.z); }
  });
  return <sprite ref={ref} name="crew-nameplate" scale={expanded ? [3.4, 0.765, 1] : [2.2, 0.303, 1]} visible={false} renderOrder={100}
    onClick={event => { event.stopPropagation(); onOpen(agent.id); }}>
    <spriteMaterial map={texture} depthTest={false} depthWrite={false} toneMapped={false} />
  </sprite>;
}

export function RingShipOffice(props: Props) {
  const { agents, companyRoster, companyActions, gatewayStatus = "disconnected", officeTitle = "Orbital Headquarters", storageNamespace = "default", gatewayUrl = "", officeCenterSignal = 0 } = props;
  const roster = companyRoster || EMPTY_ROSTER;
  const layout = useShipLayout(companyRoster || null, `claw3d:ship:v1:${storageNamespace}:${gatewayUrl}`);
  const [focus, setFocus] = useState({ id: "", request: 0 });
  const [menuOpen, setMenuOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [fleetOpen, setFleetOpen] = useState(false);
  const controlsRef = useRef<Controls>(null);
  const validFocus = layout.cabins.some(c => c.id === focus.id || c.projectId === focus.id) ? focus.id : "";
  const cameraFocus = useMemo(() => ({ id: validFocus, request: focus.request + officeCenterSignal }), [validFocus, focus.request, officeCenterSignal]);
  const selected = layout.cabins.find(c => c.id === validFocus || c.projectId === validFocus);
  const reserveCount = layout.cabins.filter(c => c.kind === "reserve").length;
  const select = useCallback((id: string) => setFocus(previous => ({ id, request: previous.request + 1 })), []);
  const onAgentChatSelect = props.onAgentChatSelect;
  const open = useCallback((id: string) => { setFleetOpen(false); onAgentChatSelect?.(id); }, [onAgentChatSelect]);
  const areas = [
    ...[SHARED_PROJECT_ID, ...roster.projects.map(p => p.id)].map(id => {
      const cabins = layout.cabins.filter(c => c.projectId === id);
      return cabins[0] ? { id, name: cabins[0].name, agentIds: cabins.flatMap(c => c.agentIds) } : null;
    }).filter((a): a is { id: string; name: string; agentIds: string[] } => !!a),
    ...layout.cabins.filter(c => c.kind !== "work" && c.kind !== "reserve").map(c => ({ id: c.id, name: c.name, agentIds: [] as string[], countLabel: " · 公共舱" })),
    ...layout.rings.flatMap(ring => {
      const cabin = layout.cabins.find(c => c.ring === ring.index && c.kind === "reserve");
      return cabin ? [{ id: cabin.id, name: `${["内", "中", "外"][ring.index]}圈预留舱`, agentIds: [] as string[], countLabel: " · 待启用" }] : [];
    }),
  ];
  const button = "flex h-9 min-w-9 items-center justify-center rounded-lg border border-white/15 bg-[#122735]/90 px-2 text-xs text-[#b8cccf] hover:border-[#d7af77]/70";
  return <div className="ship-office relative h-full w-full overflow-hidden bg-[#081421] text-[#deebea]" data-ship-sectors={layout.allocation.sectors} data-ship-reserves={reserveCount} data-ship-projects={roster.projects.length} data-ship-placed={agents.filter(agent => layout.seats[agent.id]).length}>
    <Canvas orthographic dpr={[0.85, 1.5]} camera={{ position: [25, 40, 36], zoom: 12, near: 0.1, far: 5000 }} shadows
      gl={{ antialias: true, powerPreference: "high-performance" }} onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.95; gl.domElement.dataset.shipReady = "true"; }}>
      <color attach="background" args={["#081421"]} />
      <Lighting />
      <Stars radius={100} depth={50} count={1800} factor={15} saturation={0} fade speed={0} />
      <StaticShip layout={layout} />
      <CabinTargets layout={layout} focus={validFocus} onSelect={select} />
      <Crew agents={agents} layout={layout} focus={validFocus} onOpen={open} />
      <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.15} minZoom={0.15} maxZoom={110} minPolarAngle={0.12} maxPolarAngle={Math.PI / 2.2} />
      <CameraRig layout={layout} focus={cameraFocus} controlsRef={controlsRef} />
    </Canvas>
    <div className="ship-heading pointer-events-none absolute left-1/2 top-5 z-10 -translate-x-1/2 text-center">
      <div className="truncate text-xs font-semibold uppercase tracking-[0.28em] text-[#e3c894]">{officeTitle}</div>
      <div className="mt-1 text-[9px] tracking-[0.3em] text-[#9bb8bf]">ORBITAL HABITAT</div>
      <div className="pointer-events-auto mt-3 flex items-center justify-center gap-1 rounded-full border border-white/15 bg-[#102734]/95 p-1.5">
        {agents.slice(0, 6).map(agent => <button key={agent.id} title={agent.name} aria-label={`打开会话：${agent.name}`} onClick={() => open(agent.id)}
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-[#102531]" style={{ background: agent.color }}>
          {agent.name.slice(0, 2)}{agent.needsInput || agent.needsReview ? <span className="absolute -right-0.5 -top-1 text-sm text-[#ffd177]">{agent.needsInput ? "!" : "?"}</span> : null}
        </button>)}
        <button onClick={() => setFleetOpen(value => !value)} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[10px]" aria-expanded={fleetOpen} aria-label="会话列表"><Users size={13} />{agents.length} AGENTS</button>
      </div>
    </div>
    <div className="ship-toolbar absolute right-3 top-3 z-20 flex items-center gap-2">
      <div title={`Runtime: Codex App (${gatewayStatus})`} className={`rounded-lg border px-2 py-2 text-[10px] uppercase tracking-wider ${gatewayStatus === "connected" ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200" : "border-amber-300/25 bg-amber-400/10 text-amber-100"}`}><span className="max-md:hidden">CODEX APP · </span>{gatewayStatus}</div>
      <button className={button} title="全船概览" aria-label="全船概览" onClick={() => select("")}><Home size={15} /></button>
      <button className={button} title="Voice reply settings" aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /></button>
    </div>
    <CompanyWorkAreaMenu areas={areas} activeId={validFocus} sessionCount={agents.length} open={menuOpen} onOpenChange={setMenuOpen} onSelect={select} actions={companyActions} description="公共舱常驻 · 空舱随时可启用" />
    {fleetOpen ? <div className="ship-fleet absolute left-1/2 top-28 z-30 max-h-[60vh] w-80 max-w-[90vw] -translate-x-1/2 overflow-auto rounded-xl border border-white/15 bg-[#0d2431]/98 p-2 shadow-xl">
      {agents.map(agent => <button key={agent.id} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-white/10" onClick={() => open(agent.id)}>
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: agent.color }} /><span className="min-w-0 flex-1 truncate text-xs">{agent.name}</span><span className="text-[10px] text-[#d7bc80]">{agent.needsInput ? "待回复" : agent.needsReview ? "新结果" : agent.status === "working" ? "工作中" : "空闲"}</span>
      </button>)}
    </div> : null}
    <div className="ship-summary pointer-events-none absolute bottom-4 left-4 z-10 max-w-[min(70vw,460px)] rounded-xl border border-white/10 bg-[#102531]/90 px-4 py-3">
      <div className="text-xs text-[#e1cb9f]">{selected ? selected.name : "三环飞船 · 全船概览"}</div>
      <div className="mt-1 text-[11px] text-[#9fb9c2]">{selected ? PUBLIC_DESCRIPTIONS[selected.kind] : `${roster.projects.length} 个 Project · ${agents.length} 个会话 · ${reserveCount} 个预留舱`}</div>
      <div className="mt-1 text-[9px] text-[#829da9]">{agents.filter(a => a.status === "working").length} working · {agents.filter(a => a.status === "idle").length} idle · 拖动旋转 · 滚轮缩放 · 点击舱段靠近</div>
    </div>
    {settingsOpen ? <div className="absolute inset-0 z-40 flex justify-end bg-black/40 p-3 backdrop-blur-sm" onKeyDown={event => { if (event.key === "Escape") setSettingsOpen(false); }}>
      <div className="w-full max-w-sm overflow-auto rounded-xl border border-white/15 bg-[#071522] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs"><span>飞船与语音设置</span><button className={button} aria-label="Close studio settings" onClick={() => setSettingsOpen(false)}><X size={14} /></button></div>
        <SettingsPanel {...props} officeTitle={officeTitle} officeTitleLoaded={!!props.officeTitleLoaded} onOfficeTitleChange={value => props.onOfficeTitleChange?.(value)}
          remoteOfficeEnabled={!!props.remoteOfficeEnabled} remoteOfficeSourceKind={props.remoteOfficeSourceKind || "presence_endpoint"} remoteOfficeLabel={props.remoteOfficeLabel || "Remote Office"}
          remoteOfficePresenceUrl={props.remoteOfficePresenceUrl || ""} remoteOfficeGatewayUrl={props.remoteOfficeGatewayUrl || ""} remoteOfficeTokenConfigured={!!props.remoteOfficeTokenConfigured}
          onRemoteOfficeEnabledChange={v => props.onRemoteOfficeEnabledChange?.(v)} onRemoteOfficeSourceKindChange={v => props.onRemoteOfficeSourceKindChange?.(v)}
          onRemoteOfficeLabelChange={v => props.onRemoteOfficeLabelChange?.(v)} onRemoteOfficePresenceUrlChange={v => props.onRemoteOfficePresenceUrlChange?.(v)}
          onRemoteOfficeGatewayUrlChange={v => props.onRemoteOfficeGatewayUrlChange?.(v)} onRemoteOfficeTokenChange={v => props.onRemoteOfficeTokenChange?.(v)}
          voiceRepliesEnabled={!!props.voiceRepliesEnabled} voiceRepliesVoiceId={props.voiceRepliesVoiceId || null} voiceRepliesSpeed={props.voiceRepliesSpeed || 1} voiceRepliesLoaded={!!props.voiceRepliesLoaded}
          onVoiceRepliesToggle={v => props.onVoiceRepliesToggle?.(v)} onVoiceRepliesVoiceChange={v => props.onVoiceRepliesVoiceChange?.(v)}
          onVoiceRepliesSpeedChange={v => props.onVoiceRepliesSpeedChange?.(v)} onVoiceRepliesPreview={(id, name) => props.onVoiceRepliesPreview?.(id, name)} />
      </div>
    </div> : null}
  </div>;
}
