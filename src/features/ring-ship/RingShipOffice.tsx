"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three";
import { BrainCircuit, Monitor, Home, Layers3, Settings2, Users, X } from "lucide-react";
import type { RetroOffice3D } from "@/features/retro-office/RetroOffice3D";
import type { OfficeAgent, RenderAgent } from "@/features/retro-office/core/types";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import { AGENT_SCALE } from "@/features/retro-office/core/constants";
import { normalizeDuckAppearance } from "@/lib/avatars/duck";
import { DuckCrewModel } from "./DuckCrewModel";
import { CompanyWorkAreaMenu } from "@/features/office/components/CompanyWorkAreaMenu";
import { SettingsPanel } from "@/features/office/components/panels/SettingsPanel";
import { DECK_NAMES, DECK_STEP, DECKS, PUBLIC_DESCRIPTIONS, SHARED_PROJECT_ID, shipDeck, type DeckIndex, type ShipLayout, type ShipPoint } from "./layout";
import { buildShipGeometry, disposeShipGeometry, SHIP_MODELS, shipModelUrl, SHIP_WORKSTATION, type ModelTemplates } from "./geometry";
import { useShipLayout } from "./useShipLayout";
import { getAgentActivity, workChatter } from "@/features/retro-office/core/agentActivity";
import { paintCrewNameplate } from "./crewNameplate";
import { chatCameraPose } from "./chatCamera";
import { shipCameraPose } from "./cameraPose";
import { buildShell } from "./shell";
import { LiftEntry, LiftJourney, LiftOverlay, type LiftTrip } from "./ShipLift";
import { ReturnPodBay, ReturnPodJourney, type ReturnFlight } from "./ReturnPodBay";
import { returnRoute, RETURN_LABELS, type ArchiveResult, type ReturnStage, type ReturnTransfer } from "./returnPodMotion";
import { advanceCrew, canvasPoint, worldPoint, hash, type MovingAgent } from "./crewMotion";
import { useUiText } from "@/lib/i18n/ui-language";
import { MonitorRoomScreen } from "./MonitorRoom";
import { GalaxyBackdrop } from "./GalaxyBackdrop";
import { STAR_SYSTEMS, starSystem } from "./galaxy";
import { NavigationConsole, NavigationOverlay, navigationConsolePose, useStarNavigation } from "./StarNavigation";
import { WarpJourney } from "./WarpJourney";
import { MonitorDashboard } from "./MonitorDashboard";
import { SpaceActivity } from "./SpaceActivity";
import { SpaceTrafficNotice } from "./SpaceTrafficNotice";
import { emptySpaceMotion } from "./space-activity";
import { ListeningBar } from "./ListeningBar";
import { MusicPlayerDialog } from "./MusicPlayerDialog";
import { AiComputationCore } from "./AiComputationCore";
import { AiCenterDashboard } from "./AiCenterDashboard";
import { ShipObjectScene, ShipObjectCard } from "./ShipObjectInteraction";
import { shipObjectCameraPose, type ShipObject } from "./shipObjects";

type Props = ComponentProps<typeof RetroOffice3D> & { navigationPreview?: boolean; musicPreview?: boolean };
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
      modelPromise = Promise.allSettled(SHIP_MODELS.map(name => loader.loadAsync(shipModelUrl(name)))).then(results => {
        modelCache = Object.fromEntries(results.flatMap((result, index) => result.status === "fulfilled" ? [[SHIP_MODELS[index], result.value.scene]] : [])) as ModelTemplates;
        return modelCache;
      });
    }
    void modelPromise.then(value => { if (active) setModels(value); });
    return () => { active = false; };
  }, []);
  return models;
}
function ShipHull({ layout, deck, whole, busy }: { layout: ShipLayout; deck: DeckIndex; whole: boolean; busy: boolean }) {
  const shells = useMemo(() => {
    const bottom=buildShell(shipDeck(layout,0)), upper=buildShell(shipDeck(layout,1));
    return { bottom, upper, copies:[bottom.group,upper.group,upper.group.clone(true)] };
  }, [layout]);
  const copies=shells.copies;
  useEffect(() => () => {disposeShipGeometry(shells.bottom.group);disposeShipGeometry(shells.upper.group);}, [shells]);
  return <>{copies.map((object, index) => <primitive key={index} object={object} position={[0, index * DECK_STEP, 0]} visible={whole || busy || index === deck} dispose={null} />)}
    <group visible={whole || busy}>
      <mesh position={[0, DECK_STEP - 2.5, 0]}><cylinderGeometry args={[2.05, 2.05, DECK_STEP * 2 + 8, 32]} /><meshStandardMaterial color="#9ab3ba" /></mesh>
      {DECKS.map(index => <mesh key={index} position={[0, index * DECK_STEP - 0.7, 0]}><cylinderGeometry args={[2.48, 2.48, 0.2, 32]} /><meshStandardMaterial color="#d6a466" /></mesh>)}
    </group>
  </>;
}
function StaticShip({ layout, enabled, selectedId, onSelect }: { layout: ShipLayout; enabled: boolean; selectedId?: string; onSelect: (object: ShipObject) => void }) {
  const t = useUiText();
  const models = useModels();
  const group = useMemo(() => buildShipGeometry(layout, models, t), [layout, models, t]);
  useEffect(() => () => disposeShipGeometry(group), [group]);
  return <ShipObjectScene group={group} enabled={enabled} selectedId={selectedId} onSelect={onSelect} />;
}
function Lighting({ radius, dimmed = false }: { radius: number; dimmed?: boolean }) {
  const intensity = dimmed ? .12 : 1;
  return <>
    <Environment resolution={64} frames={1} environmentIntensity={0.6 * intensity}>
      <Lightformer intensity={2} position={[0, 8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
      <Lightformer intensity={1.3} position={[-8, 3, 0]} rotation={[0, Math.PI / 2, 0]} scale={[8, 6, 1]} />
    </Environment>
    <hemisphereLight args={["#c9e4f1", "#667078", 0.85 * intensity]} />
    <directionalLight position={[-45, 80, 55]} intensity={2.6 * intensity} color="#ffe7c7" castShadow shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-radius - 3} shadow-camera-right={radius + 3} shadow-camera-top={radius + 3} shadow-camera-bottom={-radius - 3} shadow-camera-far={250} shadow-normalBias={0.035} />
    <directionalLight position={[25, 12, -25]} intensity={0.65 * intensity} color="#a0d7ed" />
  </>;
}
export function CameraRig({ layout, focus, controlsRef, lookupRef, chatAgentId, chatExpanded, deck, whole, busy, podFocus, navigationFocus, objectFocus }: { objectFocus?: ShipObject | null; navigationFocus?: { point: ShipPoint; deck: DeckIndex } | null; podFocus?: { point: ShipPoint; launch: boolean } | null; deck: DeckIndex; whole: boolean; busy: boolean; layout: ShipLayout; focus: { id: string; request: number }; controlsRef: RefObject<Controls | null>; lookupRef: RefObject<Map<string, RenderAgent>>; chatAgentId?: string | null; chatExpanded?: boolean }) {
  const { size, camera, gl } = useThree();
  const previousView = useRef<{ target: THREE.Vector3; position: THREE.Vector3; zoom: number } | null>(null);
  const previousNavigationView = useRef<{ target: THREE.Vector3; position: THREE.Vector3; zoom: number } | null>(null);
  const followed = useRef<{ id: string; x: number; z: number } | null>(null);
  const move = useRef<{ target: THREE.Vector3; position: THREE.Vector3; zoom: number } | null>(null);
  const followSpace = useRef(false);
  useEffect(() => {
    followSpace.current = !!objectFocus?.space;
    if (busy) { move.current = null; return; }
    const controls = controlsRef.current;
    if (navigationFocus && controls) {
      if (!previousNavigationView.current) previousNavigationView.current = { target: controls.target.clone(), position: camera.position.clone(), zoom: camera.zoom };
      const { point, deck: navigationDeck } = navigationFocus;
      const target = new THREE.Vector3(point.x, navigationDeck * DECK_STEP + 2.6, point.z);
      const offset = new THREE.Vector3(0, 9, 6).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(point.x, point.z));
      move.current = { target, position: target.clone().add(offset), zoom: Math.min(size.width / 7.8, size.height / 6.5, 110) };
      return;
    }
    if (previousNavigationView.current) { move.current = previousNavigationView.current; previousNavigationView.current = null; return; }
    const person = chatAgentId ? lookupRef.current.get(chatAgentId) : null;
    const point = person ? worldPoint(person) : chatAgentId ? layout.seats[chatAgentId] : null;
    if (chatAgentId && point && controls) {
      if (!previousView.current) previousView.current = { target: controls.target.clone(), position: camera.position.clone(), zoom: camera.zoom };
      const panel = document.querySelector(".office-session-chat")?.getBoundingClientRect();
      const left = panel ? panel.left - gl.domElement.getBoundingClientRect().left : size.width;
      move.current = chatCameraPose(point, size.width, size.height, left, deck * DECK_STEP);
      followed.current = { id: chatAgentId, x: point.x, z: point.z };
      return;
    }
    if (previousView.current) { move.current = previousView.current; previousView.current = null; followed.current = null; return; }
    if (podFocus) {
      const {point,launch}=podFocus;
      const target = new THREE.Vector3(point.x,launch?-8.3:1.1,point.z);
      const offset = (launch?new THREE.Vector3(-5,-2.8,9):new THREE.Vector3(-9,7,-11)).applyAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(point.x,point.z));
      move.current={target,position:target.clone().add(offset),zoom:Math.max(.2,Math.min(size.width/(launch?15:16),size.height/(launch?17:11),100))};return;
    }
    if (objectFocus && controls) {
      move.current = shipObjectCameraPose(objectFocus, size.width, size.height, camera.position, controls.target);
      return;
    }
    move.current = shipCameraPose(layout, size.width, size.height, deck, whole, focus.id);
  }, [layout, focus, size.width, size.height, camera, gl, controlsRef, lookupRef, chatAgentId, chatExpanded, deck, whole, busy, podFocus, navigationFocus, objectFocus]);
  useEffect(() => {
    const controls = controlsRef.current;
    const stop = () => { move.current = null; followSpace.current = false; };
    controls?.addEventListener("start", stop);
    return () => controls?.removeEventListener("start", stop);
  }, [controlsRef]);
  useFrame((state, delta) => {
    if (busy) return;
    if (objectFocus?.space && followSpace.current && controlsRef.current) move.current = shipObjectCameraPose(objectFocus, size.width, size.height, state.camera.position, controlsRef.current.target);
    const camera = state.camera;
    const person = followed.current && lookupRef.current.get(followed.current.id);
    if (person && followed.current) {
      const point = worldPoint(person);
      if (Math.hypot(point.x - followed.current.x, point.z - followed.current.z) > 0.1) {
        const panel = document.querySelector(".office-session-chat")?.getBoundingClientRect();
        move.current = chatCameraPose(point, size.width, size.height, panel ? panel.left - gl.domElement.getBoundingClientRect().left : size.width, deck * DECK_STEP);
        followed.current = { ...followed.current, x: point.x, z: point.z };
      }
    }
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
      onClick={event => { event.stopPropagation(); if (event.delta < 6) onSelect(cabin.projectId || cabin.id); }}>
      <ringGeometry args={[ring.radius - ring.depth / 2 + 0.1, ring.radius + ring.depth / 2 - 0.1, 24, 1, cabin.slot * step - Math.PI / 2, step]} />
      <meshBasicMaterial side={THREE.DoubleSide} color={cabin.color} transparent opacity={selected && cabin.kind!=="return" ? 0.15 : 0} depthWrite={false} />
    </mesh>;
  })}</>;
}

type NameplatePlacement = { frame: number; rects: Array<{ x: number; y: number; width: number; height: number }> };
// A small per-frame animation buffer, independent of React state and props.
function placeNameplate(frame: NameplatePlacement, time: number, x: number, y: number, width: number, height: number) {
  if (frame.frame !== time) { frame.frame = time; frame.rects = []; }
  let lift = 0;
  for (let attempt = 0; attempt <= frame.rects.length; attempt++) {
    if (!frame.rects.some(r => x < r.x + r.width + 3 && x + width + 3 > r.x && y - lift < r.y + r.height + 3 && y - lift + height + 3 > r.y)) break;
    lift += height + 4;
  }
  frame.rects.push({ x, y: y - lift, width, height });
  return lift;
}

function Crew({ agents, layout, focus, onOpen, lookupRef, chatAgentId }: { agents: OfficeAgent[]; layout: ShipLayout; focus: string; onOpen: (id: string) => void; lookupRef: RefObject<Map<string, RenderAgent>>; chatAgentId?: string | null }) {
  const agentsRef = useRef<RenderAgent[]>([]);
  const nameplatePlacement = useRef<NameplatePlacement>({ frame: -1, rects: [] });
  const [hovered, setHovered] = useState<string | null>(null);
  const unhover = useCallback(() => setHovered(null), []);
  const initialPositions = useMemo(() => Object.fromEntries(Object.values(layout.seats).map(seat => [seat.agentId, [seat.x, 0, seat.z] as [number, number, number]])), [layout]);
  useEffect(() => {
    const old = lookupRef.current, now = performance.now();
    const values: MovingAgent[] = agents.flatMap(agent => {
      const seat = layout.seats[agent.id]; if (!seat) return [];
      const previous = old.get(agent.id) as MovingAgent | undefined, p = canvasPoint(seat);
      const unchanged = previous && Math.hypot(previous.home.x - seat.x, previous.home.z - seat.z) < 0.01;
      const keepRoute = unchanged;
      return [{ ...agent, x: unchanged ? previous.x : p.x, y: unchanged ? previous.y : p.y, targetX: p.x, targetY: p.y,
        path: [], facing: unchanged ? previous.facing : seat.facing, frame: previous?.frame || hash(agent.id) % 100, state: unchanged ? previous.state : "standing" as const,
        walkSpeed: unchanged ? previous.walkSpeed : 1, phaseOffset: hash(agent.id) % 100, interactionTarget: undefined,
        workstation: { ...p, deskUid: seat.cabinId + agent.id, facing: seat.facing, pose: "sitting" as const, seatHeight: SHIP_WORKSTATION.seatHeight, surfaceHeight: SHIP_WORKSTATION.surfaceHeight },
        home: { x: seat.x, z: seat.z }, route: keepRoute ? previous.route : [], routeIndex: keepRoute ? previous.routeIndex : 0,
        visiting: keepRoute ? previous.visiting : false, pauseUntil: keepRoute ? previous.pauseUntil : now + 7000 + hash(agent.id) % 18000 }];
    });
    agentsRef.current = values; lookupRef.current = new Map(values.map(a => [a.id, a]));
  }, [agents, layout, lookupRef]);
  useFrame((state, delta) => {
    advanceCrew(agentsRef.current as MovingAgent[], layout, performance.now(), delta, chatAgentId);
  });
  return <>{agents.map(agent => {
    const seat = layout.seats[agent.id]; if (!seat) return null;
    return <group key={agent.id}>
      <DuckCrewModel agentId={agent.id} appearance={agent.avatarProfile?.duck}
        agentsRef={agentsRef} agentLookupRef={lookupRef} initialPosition={initialPositions[agent.id]}
        onHover={setHovered} onUnhover={unhover} onClick={onOpen} />
      <CrewLabel deck={seat.deck} agent={agent} lookupRef={lookupRef} placement={nameplatePlacement} onOpen={onOpen} expanded={hovered === agent.id || focus === seat.projectId || !!agent.needsInput || !!agent.needsReview} />
    </group>;
  })}</>;
}
function CrewLabel({ agent, lookupRef, placement, expanded, onOpen, deck }: { deck: DeckIndex; agent: OfficeAgent; lookupRef: RefObject<Map<string, RenderAgent>>; placement: RefObject<NameplatePlacement>; expanded: boolean; onOpen: (id: string) => void }) {
  const ref = useRef<THREE.Sprite>(null);
  const leader = useRef<THREE.BufferGeometry>(null);
  const vectors = useMemo(() => ({ anchor: new THREE.Vector3(), up: new THREE.Vector3(), projected: new THREE.Vector3(), bottom: new THREE.Vector3() }), []);
  const t = useUiText();
  const activity = getAgentActivity(agent);
  const { name, color, status, needsInput, needsReview } = agent;
  const { bodyHeight, headwear, eyeHeight } = normalizeDuckAppearance(agent.avatarProfile?.duck);
  const lastBubble = useRef("");
  const lastPaint = useRef(-1);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    paintCrewNameplate(canvas, { name, color, status, needsInput, needsReview }, expanded, activity.kind === "working" ? "" : activity.marker, 0, t);
    const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace; return result;
  }, [name, color, status, needsInput, needsReview, activity, expanded, t]);
  useEffect(() => { textureRef.current = texture; lastBubble.current = ""; return () => texture.dispose(); }, [texture]);
  useFrame(state => {
    const value = lookupRef.current.get(agent.id); if (!ref.current) return;
    // Identity is always shown for every placed crew member. Alert state only
    // adds a marker/details; it must never decide whether a name exists.
    ref.current.visible = !!value;
    if (!value) return;
    if (activity.kind === "working") {
      const bubble = t(workChatter(agent.id, state.clock.elapsedTime * 1000));
      const currentTexture = textureRef.current, tick = Math.floor(state.clock.elapsedTime * 10);
      if (currentTexture && (bubble !== lastBubble.current || (!bubble && tick !== lastPaint.current))) {
        paintCrewNameplate(currentTexture.image as HTMLCanvasElement, agent, expanded, bubble, state.clock.elapsedTime * Math.PI * 2 / 3, t);
        currentTexture.needsUpdate = true; lastBubble.current = bubble; lastPaint.current = tick;
      }
    }
    const p = worldPoint(value), width = expanded ? 160 : 84;
    const height = expanded ? 36 : 21;
    const zoom = state.camera.zoom;
    const seatedLift = value.state === "sitting" ? Math.max(0, (value.workstation?.seatHeight ?? .4) - .08 - .065 * AGENT_SCALE) : 0;
    const headY = .16 + (headwear === "none" ? .65 : .72 + Math.max(0, eyeHeight - 1) * .3) * bodyHeight * AGENT_SCALE + seatedLift;
    vectors.anchor.set(p.x, headY, p.z);
    vectors.projected.set(p.x, headY + deck * DECK_STEP, p.z).project(state.camera);
    const x = (vectors.projected.x + 1) * state.size.width / 2 - width / 2;
    const y = (1 - vectors.projected.y) * state.size.height / 2 - height - 6;
    const lift = placeNameplate(placement.current, state.clock.elapsedTime, x, y, width, height);
    vectors.up.setFromMatrixColumn(state.camera.matrixWorld, 1).normalize();
    ref.current.scale.set(width / zoom, height / zoom, 1);
    ref.current.position.copy(vectors.anchor).addScaledVector(vectors.up, (6 + height / 2 + lift) / zoom);
    vectors.bottom.copy(vectors.anchor).addScaledVector(vectors.up, (6 + lift) / zoom);
    const line = leader.current?.getAttribute("position");
    if (line) { line.setXYZ(0, vectors.anchor.x, vectors.anchor.y, vectors.anchor.z); line.setXYZ(1, vectors.bottom.x, vectors.bottom.y, vectors.bottom.z); line.needsUpdate = true; }
  });
  return <><sprite ref={ref} name="crew-nameplate" visible={false} renderOrder={100}
    onPointerOver={event => { const canvas = event.nativeEvent.target; if (canvas instanceof HTMLCanvasElement) canvas.title = agent.name; }}
    onPointerOut={event => { const canvas = event.nativeEvent.target; if (canvas instanceof HTMLCanvasElement) canvas.removeAttribute("title"); }}
    onClick={event => { event.stopPropagation(); onOpen(agent.id); }}>
    <spriteMaterial map={texture} depthTest={false} depthWrite={false} toneMapped={false} />
  </sprite><lineSegments frustumCulled={false} renderOrder={99}>
    <bufferGeometry ref={leader}><bufferAttribute attach="attributes-position" args={[new Float32Array(6), 3]} /></bufferGeometry>
    <lineBasicMaterial color={agent.color} transparent opacity={0.6} depthTest={false} depthWrite={false} />
  </lineSegments></>;
}

function ActivityBadge({ agent }: { agent: OfficeAgent }) {
  const t = useUiText();
  const activity = getAgentActivity(agent);
  return activity.marker ? <span aria-label={t(activity.label)} title={t(activity.label)} className="absolute -right-1 -top-2 px-1 text-sm leading-5" style={{ color: activity.color }}>
    <span className={activity.kind === "working" ? "inline-block motion-safe:animate-spin" : undefined} style={{ animationDuration: "3s" }}>{activity.marker}</span>
  </span> : null;
}

export function RingShipOffice(props: Props) {
  const t = useUiText();
  const { agents, companyRoster, companyActions, gatewayStatus = "disconnected", officeTitle = "Orbital Headquarters", storageNamespace = "default", gatewayUrl = "", officeCenterSignal = 0, navigationPreview = true } = props;
  const roster = companyRoster || EMPTY_ROSTER;
  const layout = useShipLayout(companyRoster || null, `claw3d:ship:v1:${storageNamespace}:${gatewayUrl}`);
  const { state: navigation, dispatch: navigate } = useStarNavigation(`claw3d:star-system:${storageNamespace}`);
  const system = navigationPreview ? starSystem(navigation.current) : STAR_SYSTEMS[0];
  const activityEnabled = navigationPreview;
  const spaceMotion = useRef(emptySpaceMotion()), spaceCaption = useRef<HTMLElement | null>(null);
  const navigationOpen = navigationPreview && navigation.phase !== "idle";
  const commandCabin = layout.cabins.find(cabin => cabin.kind === "monitor");
  const navigationFocus = useMemo(() => navigationOpen && navigation.phase !== "warp" && commandCabin ? { point: navigationConsolePose(layout, commandCabin).point, deck: commandCabin.deck } : null, [navigationOpen, navigation.phase, commandCabin, layout]);
  const completeWarp = useCallback(() => navigate({ type: "complete" }), [navigate]);
  const [deck, setDeck] = useState<DeckIndex>(0), [whole, setWhole] = useState(false), [liftOpen, setLiftOpen] = useState(false);
  const [trip, setTrip] = useState<LiftTrip | null>(null);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [inspectedObject, setInspectedObject] = useState<ShipObject | null>(null);
  const closeObject = useCallback(() => setInspectedObject(null), []);
  const openMonitor = () => { closeObject(); setMonitorOpen(true); };
  const openAiCenter = () => { closeObject(); setAiOpen(true); };
  const overlayRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef("");
  const busy = !!trip;
  const chatDeck = props.activeChatAgentId ? layout.seats[props.activeChatAgentId]?.deck : undefined;
  const visibleDeck = !busy && chatDeck !== undefined ? chatDeck : deck;
  const shipView = whole && !props.activeChatAgentId;
  const decks = useMemo(() => DECKS.map(d => shipDeck(layout, d)), [layout]);
  const currentLayout = decks[visibleDeck];
  const visibleAgents = useMemo(() => agents.filter(a => currentLayout.seats[a.id]), [agents, currentLayout]);
  const counts = decks.map(d => agents.filter(a => d.seats[a.id]).length);
  // Only the explicit preview starts at the console; the office keeps its overview.
  const [focus, setFocus] = useState({ id: props.musicPreview ? "public:lounge" : props.navigationPreview ? commandCabin?.id ?? "" : "", request: 0 });
  const arriveSystem = useCallback(() => {
    setWhole(false);
    setFocus(previous => ({ id: "", request: previous.request + 1 }));
    navigate({ type: "arrive" });
  }, [navigate]);
  const [menuOpen, setMenuOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [fleetOpen, setFleetOpen] = useState(false);
  const controlsRef = useRef<Controls>(null);
  const crewLookupRef = useRef(new Map<string, RenderAgent>());
  const [returnFlight, setReturnFlight] = useState<ReturnFlight | null>(null);
  const [returnStage, setReturnStage] = useState<ReturnStage>("walking");
  const [returnError, setReturnError] = useState("");
  const archiveResultRef = useRef<ArchiveResult>({status:"pending"});
  const returnTransferRef = useRef<ReturnTransfer>({});
  const returnRideRef = useRef<string|null>(null);
  const returnSeenRef = useRef("");
  const request = props.returnRequest, archive = props.onArchiveSession, onReturnFinished = props.onReturnFinished;
  useEffect(() => {
    if (!request || request.requestId === returnSeenRef.current || !archive || busy) return;
    // Sample the external scene's current pose after its frame is committed.
    const frame = requestAnimationFrame(() => {
    returnSeenRef.current = request.requestId;
    const agent = agents.find(a => a.id === request.agentId), seat = layout.seats[request.agentId];
    if (!agent || !seat) { onReturnFinished?.(); return; }
    const rendered = crewLookupRef.current.get(agent.id);
    const route = returnRoute(layout, seat, rendered ? worldPoint(rendered) : seat);
    setInspectedObject(null);setDeck(seat.deck);setWhole(false);setFleetOpen(false);setLiftOpen(false);
    setReturnFlight({...route,agentId:agent.id,requestId:request.requestId,name:agent.name,appearance:agent.avatarProfile?.duck});
    setReturnStage("walking");setReturnError("");archiveResultRef.current={status:"pending"};
    returnTransferRef.current={};returnRideRef.current=null;
    // The real operation starts independently of visual frame rate. A removed
    // roster row must not remove the captured passenger before launch finishes.
    void archive(agent.id,request.requestId).then(()=>{
      archiveResultRef.current={status:"confirmed",at:performance.now()};
    },error=>{
      const message=error instanceof Error?error.message:"请在 Codex 中核对归档结果";
      archiveResultRef.current={status:"failed",error:message};setReturnError(message);
    });
    });
    return () => cancelAnimationFrame(frame);
  }, [request, archive, agents, layout, onReturnFinished, busy]);
  const returnComplete = useCallback(() => {
    setFocus(previous=>previous.id===returnFlight?.bayId?{id:"",request:previous.request+1}:previous);
    setReturnFlight(null);onReturnFinished?.();
  }, [onReturnFinished,returnFlight]);
  const returnPhaseChanged = useCallback((stage:ReturnStage)=>{
    setReturnStage(stage);
    if (stage==="transferring" && returnFlight) {
      if (props.activeChatAgentId || busy) returnTransferRef.current.completedAt=performance.now();
      else {
        returnRideRef.current=returnFlight.requestId;
        setTrip({from:returnFlight.sourceDeck,to:0,id:performance.now()});
      }
    }
    if (["boarding","sealing","waiting","launching"].includes(stage) && !props.activeChatAgentId && !busy && returnFlight) {
      setDeck(0);setWhole(false);setFocus(previous=>({id:returnFlight.bayId,request:previous.request+1}));
    }
  }, [props.activeChatAgentId,returnFlight,busy]);
  const returnCamera=useMemo(()=>returnFlight && ["boarding","sealing","waiting","launching","done"].includes(returnStage) && visibleDeck===0 && !shipView
    // Frame the exit while the hatch seals, before the short muzzle flash.
    ? {point:returnFlight.pod,launch:["sealing","waiting","launching","done"].includes(returnStage)}:null,[returnFlight,returnStage,visibleDeck,shipView]);
  const validFocus = currentLayout.cabins.some(c => c.id === focus.id || c.projectId === focus.id) ? focus.id : "";
  const cameraFocus = useMemo(() => ({ id: validFocus, request: focus.request + officeCenterSignal }), [validFocus, focus.request, officeCenterSignal]);
  const selected = currentLayout.cabins.find(c => c.id === validFocus || c.projectId === validFocus);
  const objectEnabled = !busy && !navigationOpen && !props.activeChatAgentId && !returnFlight && !monitorOpen && !musicOpen && !settingsOpen && !aiOpen;
  const objectFocus = objectEnabled && inspectedObject && (inspectedObject.space ? inspectedObject.space.seed === system.seed : !shipView && inspectedObject.deck === visibleDeck && currentLayout.cabins.some(c => c.id === inspectedObject.cabinId)) ? inspectedObject : null;
  const inspectObject = useCallback((object: ShipObject) => {
    setInspectedObject(object); if (!object.space) setDeck(object.deck); setWhole(false); setLiftOpen(false); setFleetOpen(false);
  }, []);
  const reserveCount = layout.cabins.filter(c => c.kind === "reserve").length;
  const travel = useCallback((destination: DeckIndex, id = "") => {
    if (busy || destination === visibleDeck) return;
    setInspectedObject(null);
    pendingFocus.current = id; setLiftOpen(false); setMenuOpen(false); setFleetOpen(false);
    setTrip({ from: visibleDeck, to: destination, id: performance.now() });
  }, [busy, visibleDeck]);
  const select = useCallback((id: string) => {
    if (busy) return;
    setInspectedObject(null);
    const cabin = layout.cabins.find(c => c.id === id || c.projectId === id);
    if (cabin && cabin.deck !== visibleDeck) { travel(cabin.deck, id); return; }
    if (cabin?.kind === "monitor") setMonitorOpen(true);
    if (cabin?.kind === "ai") setAiOpen(true);
    setWhole(false); setLiftOpen(false); setFocus(previous => ({ id, request: previous.request + 1 }));
  }, [busy, layout, visibleDeck, travel]);
  const arrive = useCallback((destination: DeckIndex) => { setDeck(destination); setWhole(false); }, []);
  const complete = useCallback(() => {
    setTrip(null);
    if(returnRideRef.current){returnTransferRef.current.completedAt=performance.now();returnRideRef.current=null;}
    else setFocus(previous => ({ id: pendingFocus.current, request: previous.request + 1 }));
  }, []);
  const onAgentChatSelect = props.onAgentChatSelect;
  const open = useCallback((id: string) => { if (busy) return; setInspectedObject(null); setFleetOpen(false); setLiftOpen(false); onAgentChatSelect?.(id); }, [onAgentChatSelect, busy]);
  const areas = [
    ...[SHARED_PROJECT_ID, ...roster.projects.map(p => p.id)].map(id => {
      const cabins = layout.cabins.filter(c => c.projectId === id);
      return cabins[0] ? { id, name: `${id === SHARED_PROJECT_ID ? t(cabins[0].name) : cabins[0].name} · L${cabins[0].deck + 1}`, agentIds: cabins.flatMap(c => c.agentIds) } : null;
    }).filter((a): a is { id: string; name: string; agentIds: string[] } => !!a),
    ...currentLayout.cabins.filter(c => c.kind !== "work" && c.kind !== "reserve").map(c => ({ id: c.id, name: t(c.name), agentIds: [] as string[], countLabel: t(" · Common cabin") })),
    ...layout.rings.flatMap(ring => {
      const cabin = currentLayout.cabins.find(c => c.ring === ring.index && c.kind === "reserve");
      return cabin ? [{ id: cabin.id, name: t(["Inner ring reserve cabins", "Middle ring reserve cabins", "Outer ring reserve cabins"][ring.index]), agentIds: [] as string[], countLabel: t(" · Standby") }] : [];
    }),
  ];
  const button = "flex h-9 min-w-9 items-center justify-center rounded-lg border border-white/15 bg-[#122735]/90 px-2 text-xs text-[#b8cccf] hover:border-[#d7af77]/70";
  return <div className={`ship-office relative h-full w-full overflow-hidden bg-[#081421] text-[#deebea]${navigationOpen ? " star-navigation-active" : ""}`} data-star-system={system.id} data-navigation-phase={navigationPreview ? navigation.phase : undefined} data-ship-deck={visibleDeck} data-ship-mode={shipView ? "ship" : "deck"} data-ship-travelling={busy} data-ship-visible-crew={visibleAgents.length} data-ship-sectors={layout.allocation.sectors} data-ship-reserves={reserveCount} data-ship-projects={roster.projects.length} data-ship-placed={agents.filter(agent => layout.seats[agent.id]).length}>
    <Canvas orthographic dpr={[0.85, 1.5]} camera={{ position: [25, 40, 36], zoom: 12, near: 0.1, far: 5000 }} shadows
      gl={{ antialias: true, powerPreference: "high-performance" }} onPointerMissed={() => { setLiftOpen(false); closeObject(); }} onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.95; gl.domElement.dataset.shipReady = "true"; }}>
      <GalaxyBackdrop system={system} motion={activityEnabled ? spaceMotion : undefined} />
      {activityEnabled ? <SpaceActivity radius={layout.radius} seed={system.seed} paused={navigationOpen || busy} motion={spaceMotion} caption={spaceCaption} enabled={objectEnabled} selected={objectFocus} onSelect={inspectObject} onExpire={closeObject} /> : null}
      <Lighting radius={layout.radius} dimmed={navigationOpen && navigation.phase !== "warp"} />
      <ShipHull layout={layout} deck={visibleDeck} whole={shipView} busy={busy} />
      {decks.map((value, index) => <group key={index} position={[0, index * DECK_STEP, 0]} visible={shipView || busy || index === visibleDeck}>
        <StaticShip layout={value} enabled={objectEnabled && (shipView || index === visibleDeck)} selectedId={objectFocus?.id} onSelect={inspectObject} /><ReturnPodBay layout={value} active={!!returnFlight}/>
        {value.cabins.filter(c => c.kind === "ai").map(cabin => <AiComputationCore key={cabin.id} layout={value} cabin={cabin} interactive={objectEnabled && !shipView && index === visibleDeck} onOpen={() => select(cabin.id)} />)}
      </group>)}
      {!shipView && !busy ? <group position={[0, visibleDeck * DECK_STEP, 0]}>
        <CabinTargets layout={currentLayout} focus={validFocus} onSelect={select} />
        {visibleDeck === 0 ? currentLayout.cabins.filter(c => c.kind === "lounge").map(cabin => <ListeningBar key={cabin.id} layout={currentLayout} cabin={cabin} onOpen={() => { closeObject(); setMusicOpen(true); }} />) : null}
        {currentLayout.cabins.filter(c => c.kind === "monitor").map(cabin => <group key={cabin.id}>
          {!navigationOpen ? <MonitorRoomScreen layout={currentLayout} cabin={cabin} onOpen={openMonitor} /> : null}
          {navigationPreview ? <NavigationConsole layout={currentLayout} cabin={cabin} state={navigation} onAction={action => { closeObject(); navigate(action); }} disabled={busy || !!returnFlight || !!props.activeChatAgentId || navigation.phase === "warp"} /> : null}
        </group>)}
        <Crew agents={visibleAgents.filter(a=>a.id!==returnFlight?.agentId)} layout={currentLayout} focus={validFocus} onOpen={open} lookupRef={crewLookupRef} chatAgentId={props.activeChatAgentId} />
      </group> : null}
      {returnFlight ? <group visible={!shipView}>
        <ReturnPodJourney key={returnFlight.requestId} flight={returnFlight} resultRef={archiveResultRef} transferRef={returnTransferRef} displayDeck={visibleDeck} onStage={returnPhaseChanged} onComplete={returnComplete}/>
      </group>:null}
      <OrbitControls ref={controlsRef} makeDefault enabled={!busy && !(navigationPreview && (navigation.phase === "confirm" || navigation.phase === "warp"))} enableDamping={!busy} dampingFactor={0.15} minZoom={0.15} maxZoom={110} minPolarAngle={0.12} maxPolarAngle={Math.PI * 0.72} />
      <CameraRig layout={currentLayout} focus={cameraFocus} controlsRef={controlsRef} lookupRef={crewLookupRef} chatAgentId={props.activeChatAgentId} chatExpanded={props.chatExpanded} deck={visibleDeck} whole={shipView} busy={busy}
        podFocus={returnCamera} navigationFocus={navigationFocus} objectFocus={objectFocus}/>
      <LiftEntry deck={visibleDeck} whole={shipView} open={liftOpen} disabled={busy || !!props.activeChatAgentId || navigationOpen} counts={counts} onOpen={() => { closeObject(); setLiftOpen(true); }} onClose={() => setLiftOpen(false)} onTravel={travel} />
      <LiftJourney trip={trip} layout={layout} controlsRef={controlsRef} overlayRef={overlayRef} onArrive={arrive} onComplete={complete} />
    </Canvas>
    {objectFocus ? <ShipObjectCard object={objectFocus} customRoom={currentLayout.cabins.some(c => c.id === objectFocus.cabinId && !!c.projectId && c.projectId !== SHARED_PROJECT_ID)} onClose={closeObject} /> : null}
    {activityEnabled ? <SpaceTrafficNotice key={system.id} motion={spaceMotion} seed={system.seed} paused={!objectEnabled} /> : null}
    <fieldset className="contents" disabled={busy}>
    <div className="ship-heading pointer-events-none absolute left-1/2 top-5 z-10 -translate-x-1/2 text-center">
      <div className="truncate text-xs font-semibold uppercase tracking-[0.28em] text-[#e3c894]">{officeTitle}</div>
      <div className="mt-1 text-[9px] tracking-[0.3em] text-[#9bb8bf]">{shipView ? t("Whole ship · 3 decks") : t("L{0} · {1} · {2} sessions", { "0": visibleDeck + 1, "1": t(DECK_NAMES[visibleDeck]), "2": visibleAgents.length })}</div>
    </div>
    <div className="ship-toolbar absolute right-3 top-3 z-20 flex items-center gap-2">
      <div title={`Runtime: Codex (${gatewayStatus})`} className={`rounded-lg border px-2 py-2 text-[10px] uppercase tracking-wider ${gatewayStatus === "connected" ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200" : "border-amber-300/25 bg-amber-400/10 text-amber-100"}`}><span className="max-md:hidden">CODEX · </span>{t(gatewayStatus)}</div>
      <button className={button} title={t("Deck overview")} aria-label={t("Deck overview")} onClick={() => select("")}><Home size={15} /></button>
      <button className={button} title={t("Whole ship")} aria-label={t("Whole ship")} aria-pressed={shipView} onClick={() => { closeObject(); setWhole(value => !value); setLiftOpen(false); setFocus(previous => ({ id: "", request: previous.request + 1 })); }}><Layers3 size={15} /></button>
      <button className={button} title={t("Open AI Center")} aria-label={t("Open AI Center")} onClick={openAiCenter}><BrainCircuit size={15} /></button>
      <button className={button} title={t("Voice reply settings")} aria-label={t("Settings")} onClick={() => { closeObject(); setSettingsOpen(true); }}><Settings2 size={15} /></button>
    </div>
    <div className="ship-sidebar">
      <CompanyWorkAreaMenu areas={areas} activeId={validFocus} sessionCount={agents.length} open={menuOpen} onOpenChange={setMenuOpen} onSelect={select} actions={companyActions} description={t("Use the central lift to change decks · Empty cabins are ready to use")} />
      <div className="ship-crew-dock">
        <div className="ship-crew-bar grid grid-cols-6 gap-1 rounded-xl border border-white/15 bg-[#102734]/95 p-1.5">
          {agents.slice(0, 6).map(agent => <button key={agent.id} title={agent.name} aria-label={t("Open session: {0}", { "0": agent.name })} onClick={() => open(agent.id)}
            className="ship-crew-avatar relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-[#102531]" style={{ background: agent.color }}>
            {agent.name.slice(0, 2)}<ActivityBadge agent={agent} />
          </button>)}
          <button onClick={() => setFleetOpen(value => !value)} className="col-span-full flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[10px]" aria-expanded={fleetOpen} aria-label={t("Session list")}><Users size={13} />{agents.length} {t("AGENTS")}</button>
        </div>
        {fleetOpen ? <div className="ship-fleet mt-2 max-h-[60vh] overflow-auto rounded-xl border border-white/15 bg-[#0d2431]/98 p-2 shadow-xl">
          {agents.map(agent => <button key={agent.id} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-white/10" onClick={() => open(agent.id)}>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: agent.color }} /><span className="min-w-0 flex-1 truncate text-xs">{agent.name}</span><span className="text-[10px]" style={{ color: getAgentActivity(agent).color }}>{getAgentActivity(agent).marker} {t(getAgentActivity(agent).label)}</span>
          </button>)}
        </div> : null}
      </div>
    </div>
    <div className="ship-summary pointer-events-none absolute bottom-4 left-4 z-10 max-w-[min(70vw,460px)] rounded-xl border border-white/10 bg-[#102531]/90 px-4 py-3">
      <div className="text-xs text-[#e1cb9f]">{selected ? (selected.kind === "work" && selected.projectId !== SHARED_PROJECT_ID ? selected.name : t(selected.name)) : shipView ? t("Three-ring ship · Whole ship") : `L${visibleDeck + 1} · ${t(DECK_NAMES[visibleDeck])}`}</div>
      <div className="mt-1 text-[11px] text-[#9fb9c2]">{selected ? t(PUBLIC_DESCRIPTIONS[selected.kind]) : t("{0} projects · {1} sessions · {2} reserve cabins", { "0": roster.projects.length, "1": agents.length, "2": reserveCount })}</div>
      {selected?.kind === "monitor" ? <button type="button" onClick={openMonitor} className="pointer-events-auto mt-2 flex min-h-10 items-center gap-2 rounded-lg border border-[#71d3c8]/40 px-3 text-xs text-[#b7eee0] hover:bg-white/10">{t("Open monitoring dashboard")} <Monitor size={13} /></button> : null}
      {selected?.kind === "ai" ? <button type="button" onClick={openAiCenter} className="pointer-events-auto mt-2 flex min-h-10 items-center gap-2 rounded-lg border border-[#86e6de]/40 px-3 text-xs text-[#b7eee0] hover:bg-white/10">{t("Open AI Center")} <BrainCircuit size={13} /></button> : null}
      {navigationPreview && selected?.kind === "monitor" ? <button type="button" onClick={() => { closeObject(); navigate({ type: "open" }); }} className="pointer-events-auto mt-2 min-h-10 rounded-lg border border-[#9dc7d3]/40 px-3 text-xs text-[#c6e0e9]">{t("Open star chart")}</button> : null}
      <div className="mt-1 text-[9px] text-[#829da9]">{t("{working} working · {idle} idle · Drag to rotate · Scroll to zoom · Use the central lift to change decks", { working: agents.filter(a => a.status === "working").length, idle: agents.filter(a => a.status === "idle").length })}</div>
    </div>
    </fieldset>
    {navigationPreview && !navigationOpen ? <div className="star-location"><span style={{ color: system.color }}>{t(system.name)}</span><small>{t(system.description)}</small>{activityEnabled ? <small ref={spaceCaption} className="star-cruise-status">{t("Cruising")}</small> : null}</div> : null}
    {navigationOpen && navigation.phase !== "warp" ? <NavigationOverlay state={navigation} onAction={navigate} /> : null}
    {navigationPreview && navigation.phase === "warp" && navigation.destination ? <WarpJourney destination={starSystem(navigation.destination)} onArrive={arriveSystem} onComplete={completeWarp} /> : null}
    <MonitorDashboard open={monitorOpen} onClose={() => setMonitorOpen(false)} />
    <AiCenterDashboard open={aiOpen} onClose={() => setAiOpen(false)} client={props.atmAnalytics?.client} connected={gatewayStatus === "connected"} />
    <MusicPlayerDialog open={musicOpen} onOpen={() => setMusicOpen(true)} onClose={() => setMusicOpen(false)} />
    <LiftOverlay trip={trip} overlayRef={overlayRef} />
    {returnFlight ? <div role="status" aria-live="polite" className="absolute bottom-20 sm:bottom-4 left-1/2 z-30 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-amber-200/25 bg-[#101e29]/95 px-4 py-3 text-center shadow-xl">
      <div className="truncate text-xs text-amber-100">{returnFlight.name}</div>
      <p className="mt-1 text-xs text-amber-100">{t(RETURN_LABELS[returnStage])}</p>
      {returnError ? <><p className="mt-2 text-xs text-rose-200">{t(returnError)}</p><button className="mt-2 text-xs underline" onClick={returnComplete}>{t("Return to office · Check the session")}</button></>:<p className="mt-1 text-[10px] text-white/45">{t("History is preserved.")}</p>}
    </div>:null}
    {settingsOpen ? <div className="absolute inset-0 z-40 flex justify-end bg-black/40 p-3 backdrop-blur-sm" onKeyDown={event => { if (event.key === "Escape") setSettingsOpen(false); }}>
      <div className="w-full max-w-sm overflow-auto rounded-xl border border-white/15 bg-[#071522] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs"><span>{t("Settings")}</span><button className={button} aria-label={t("Close studio settings")} onClick={() => setSettingsOpen(false)}><X size={14} /></button></div>
        <SettingsPanel {...props} officeTitle={officeTitle} officeTitleLoaded={!!props.officeTitleLoaded} onOfficeTitleChange={value => props.onOfficeTitleChange?.(value)}
        />
      </div>
    </div> : null}
  </div>;
}
