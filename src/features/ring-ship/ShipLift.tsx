"use client";

import { useMemo, useRef, useState, type ComponentRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { ArrowRight, DoorClosed, X } from "lucide-react";
import { DECK_NAMES, DECK_STEP, DECKS, type DeckIndex, type ShipLayout } from "./layout";
import { shipCameraPose } from "./cameraPose";
import { useUiText } from "@/lib/i18n/ui-language";

type Controls = ComponentRef<typeof OrbitControls>;
export type LiftTrip = { from: DeckIndex; to: DeckIndex; id: number };
const ease = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function LiftEntry({ deck, whole, open, disabled, counts, onOpen, onClose, onTravel }: {
  deck: DeckIndex; whole: boolean; open: boolean; disabled: boolean; counts: number[];
  onOpen: () => void; onClose: () => void; onTravel: (deck: DeckIndex) => void;
}) {
  const t = useUiText();
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
        <button ref={entry} className="ship-lift-entry" aria-label={t("Take the central lift")} aria-expanded={open} aria-controls="ship-lift-menu" onClick={showMenu}>
          <span className="ship-lift-mark" aria-hidden="true"><DoorClosed size={19} strokeWidth={1.25} /></span>
          <span className="ship-lift-entry-copy">{t("Central lift")}<small>{t("CENTRAL SHUTTLE")}</small></span>
          <span className="ship-lift-deck" aria-hidden="true"><small>{t("DECK")}</small>L{deck + 1}</span>
        </button>
        {open ? <section id="ship-lift-menu" role="dialog" aria-label={t("Central lift")} className="ship-lift-menu"
          onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } }}>
          <div className="ship-lift-heading"><span>{t("CENTRAL SHUTTLE")}</span><button aria-label={t("Close lift menu")} onClick={event => close(event.detail === 0)}><X size={16} strokeWidth={1.5} /></button></div>
          <h2>{t("Which deck?")}</h2><p>{t("Current location: L{deck} · {name}", { deck: deck + 1, name: t(DECK_NAMES[deck]) })}</p>
          {/* Html mounts its own DOM root: focus the button there, not from the scene effect. */}
          {DECKS.map((destination, index) => <button key={destination} autoFocus={destination === DECKS.find(d => d !== deck)}
            className="ship-lift-destination" disabled={destination === deck} aria-current={destination === deck ? "location" : undefined}
            aria-label={t("Travel to L{0}", { "0": destination + 1 })} onClick={() => onTravel(destination)}>
            <b>L{destination + 1}</b><span>{t(DECK_NAMES[index])}<small>{t("{count} sessions · Three-ring deck", { count: counts[index] })}</small></span><em>{destination === deck ? t("Current") : <ArrowRight size={15} strokeWidth={1.25} aria-hidden="true" />}</em>
          </button>)}
          <p>{t("Take the central lift to open the destination deck.")}</p>
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
  const t = useUiText();
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
        if (label) label.textContent = phase === "boarding" ? t("Heading to the central lift") : phase === "closing" ? t("Boarding") : phase === "riding" ? t(trip.to > trip.from ? "Lift going up" : "Lift going down") : t("Arriving at L{0} · {1}", { "0": trip.to + 1, "1": t(DECK_NAMES[trip.to]) });
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
  const t = useUiText();
  if (!trip) return null;
  return <div ref={overlayRef} className="ship-lift-transit" data-stage="boarding">
    <div className="ship-cabin-window" aria-hidden="true"><div className="ship-cabin-frame"><span>{t("CENTRAL SHUTTLE")}</span><b>L{trip.from + 1} → L{trip.to + 1}</b></div><div className="ship-lift-door left" /><div className="ship-lift-door right" /></div>
    <section className="ship-travel-status" role="status" aria-live="polite"><strong>L{trip.from + 1} → L{trip.to + 1}</strong><span className="ship-travel-label">{t("Heading to the central lift")}</span><div className="ship-travel-track"><i /></div></section>
  </div>;
}
