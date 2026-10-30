"use client";

import { useMemo, useRef, useState, type ComponentRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { ArrowRight, DoorClosed, X } from "lucide-react";
import { DECK_NAMES, DECK_STEP, DECKS, type DeckIndex, type ShipLayout } from "./layout";
import { shipCameraPose } from "./cameraPose";

type Controls = ComponentRef<typeof OrbitControls>;
export type LiftTrip = { from: DeckIndex; to: DeckIndex; id: number };
const ease = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function LiftEntry({ deck, whole, open, disabled, counts, onOpen, onClose, onTravel }: {
  deck: DeckIndex; whole: boolean; open: boolean; disabled: boolean; counts: number[];
  onOpen: () => void; onClose: () => void; onTravel: (deck: DeckIndex) => void;
}) {
  const entry = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const showMenu = () => { setHovered(false); onOpen(); };
  const close = (restoreFocus = false) => { onClose(); if (restoreFocus) entry.current?.focus({ preventScroll: true }); };
  return <group position={[0, whole ? DECK_STEP : deck * DECK_STEP, 0]} visible={!disabled}>
    <mesh onPointerOver={event => { if (event.pointerType === "mouse") { event.stopPropagation(); setHovered(true); } }}
      onPointerOut={() => setHovered(false)}
      onClick={event => { if (event.delta < 6) { event.stopPropagation(); showMenu(); } }}>
      <cylinderGeometry args={[3.6, 3.6, whole ? DECK_STEP * 2 + 8 : 8, 24]} />
      <meshBasicMaterial visible={false} />
    </mesh>
    {!disabled ? <Html position={[0, 2.5, 0]} center zIndexRange={[15, 14]} style={{ pointerEvents: "none" }}>
      <div className="ship-lift-anchor" data-hovered={hovered} data-open={open} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        <button ref={entry} className="ship-lift-entry" aria-label="乘坐中央升降梯" aria-expanded={open} aria-controls="ship-lift-menu" onClick={showMenu}>
          <span className="ship-lift-mark" aria-hidden="true"><DoorClosed size={19} strokeWidth={1.25} /></span>
          <span className="ship-lift-entry-copy">中央升降梯<small>CENTRAL SHUTTLE</small></span>
          <span className="ship-lift-deck" aria-hidden="true"><small>DECK</small>L{deck + 1}</span>
        </button>
        {open ? <section id="ship-lift-menu" role="dialog" aria-label="中央升降梯" className="ship-lift-menu"
          onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } }}>
          <div className="ship-lift-heading"><span>CENTRAL SHUTTLE</span><button aria-label="关闭升降梯菜单" onClick={event => close(event.detail === 0)}><X size={16} strokeWidth={1.5} /></button></div>
          <h2>前往哪一层？</h2><p>当前位置：L{deck + 1} · {DECK_NAMES[deck]}</p>
          {/* Html mounts its own DOM root: focus the button there, not from the scene effect. */}
          {DECKS.map((destination, index) => <button key={destination} autoFocus={destination === DECKS.find(d => d !== deck)}
            className="ship-lift-destination" disabled={destination === deck} aria-current={destination === deck ? "location" : undefined}
            aria-label={`穿梭到 L${destination + 1}`} onClick={() => onTravel(destination)}>
            <b>L{destination + 1}</b><span>{DECK_NAMES[index]}<small>{counts[index]} 个会话 · 三环甲板</small></span><em>{destination === deck ? "当前" : <ArrowRight size={15} strokeWidth={1.25} aria-hidden="true" />}</em>
          </button>)}
          <p>从中央轴乘梯，到站后展开目的甲板。</p>
        </section> : null}
      </div>
    </Html> : null}
  </group>;
}

function resizeRideCamera(camera: THREE.PerspectiveCamera, width: number, height: number) {
  camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
}

// One renderer and one scene. A second camera is used only during the short
// first-person ride; the ordinary orbit camera and controls stay intact.
export function LiftJourney({ trip, layout, controlsRef, overlayRef, onArrive, onComplete }: {
  trip: LiftTrip | null; layout: ShipLayout; controlsRef: RefObject<Controls | null>;
  overlayRef: RefObject<HTMLDivElement | null>; onArrive: (deck: DeckIndex) => void; onComplete: () => void;
}) {
  const rideCamera = useMemo(() => new THREE.PerspectiveCamera(66, 1, 0.08, 5000), []);
  const statsAt = useRef(-3);
  const journey = useRef<{ id: number; start: number; position: THREE.Vector3; target: THREE.Vector3; zoom: number; arrived: boolean } | null>(null);
  useFrame(state => {
    const camera = state.camera;
    let view = camera;
    const controls = controlsRef.current, overlay = overlayRef.current;
    if (trip && controls) {
      if (journey.current?.id !== trip.id) journey.current = { id: trip.id, start: performance.now(), position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom, arrived: false };
      const value = journey.current, elapsed = (performance.now() - value.start) / 1000;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = 1 + Math.abs(trip.to - trip.from) * 0.45, fromY = trip.from * DECK_STEP, toY = trip.to * DECK_STEP;
      const ortho = camera as THREE.OrthographicCamera, nearZoom = (ortho.right - ortho.left) / 16;
      let phase = "boarding", progress = 0;
      if (reduced || elapsed >= 0.86 + duration) {
        if (!value.arrived) { value.arrived = true; onArrive(trip.to); }
        phase = "leaving";
        const p = reduced ? 1 : ease((elapsed - 0.86 - duration) / 0.55);
        const final = shipCameraPose(layout, state.size.width, state.size.height, trip.to);
        camera.position.lerpVectors(new THREE.Vector3(9, toY + 7, 13), final.position, p);
        controls.target.lerpVectors(new THREE.Vector3(0, toY + 0.8, 0), final.target, p);
        camera.zoom = THREE.MathUtils.lerp(nearZoom, final.zoom, p);
        if (p >= 1) { journey.current = null; onComplete(); }
      } else if (elapsed < 0.5) {
        const p = ease(elapsed / 0.5);
        camera.position.lerpVectors(value.position, new THREE.Vector3(9, fromY + 7, 13), p);
        controls.target.lerpVectors(value.target, new THREE.Vector3(0, fromY + 0.8, 0), p);
        camera.zoom = THREE.MathUtils.lerp(value.zoom, nearZoom, p);
      } else {
        phase = elapsed < 0.68 ? "closing" : elapsed < 0.68 + duration ? "riding" : "arriving";
        progress = ease((elapsed - 0.68) / duration);
        const y = THREE.MathUtils.lerp(fromY, toY, progress) + 1.05;
        resizeRideCamera(rideCamera, state.size.width, state.size.height);
        rideCamera.position.set(0, y, 3.3); rideCamera.lookAt(0, y, 15); view = rideCamera;
      }
      camera.updateProjectionMatrix(); controls.update();
      if (overlay) {
        overlay.dataset.stage = phase;
        const progressBar = overlay.querySelector<HTMLElement>(".ship-travel-track i");
        if (progressBar) progressBar.style.transform = `scaleX(${progress})`;
        const label = overlay.querySelector<HTMLElement>(".ship-travel-label");
        if (label) label.textContent = phase === "boarding" ? "正在前往中央升降梯" : phase === "closing" ? "进入轿厢" : phase === "riding" ? (trip.to > trip.from ? "升降梯上行中" : "升降梯下行中") : `抵达 L${trip.to + 1} · ${DECK_NAMES[trip.to]}`;
      }
    }
    state.gl.render(state.scene, view);
    if (state.clock.elapsedTime - statsAt.current >= 3) {
      state.gl.domElement.dataset.shipDrawCalls = String(state.gl.info.render.calls);
      statsAt.current = state.clock.elapsedTime;
    }
  }, 1);
  return null;
}

export function LiftOverlay({ trip, overlayRef }: { trip: LiftTrip | null; overlayRef: RefObject<HTMLDivElement | null> }) {
  if (!trip) return null;
  return <div ref={overlayRef} className="ship-lift-transit" data-stage="boarding">
    <div className="ship-cabin-window" aria-hidden="true"><div className="ship-cabin-frame"><span>CENTRAL SHUTTLE</span><b>L{trip.from + 1} → L{trip.to + 1}</b></div><div className="ship-lift-door left" /><div className="ship-lift-door right" /></div>
    <section className="ship-travel-status" role="status" aria-live="polite"><strong>L{trip.from + 1} → L{trip.to + 1}</strong><span className="ship-travel-label">正在前往中央升降梯</span><div className="ship-travel-track"><i /></div></section>
  </div>;
}
