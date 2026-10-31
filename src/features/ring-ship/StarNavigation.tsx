"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import { Html, Line } from "@react-three/drei";
import { X, Navigation2, ArrowRight } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";
import { navigationReducer, STAR_SYSTEMS, starSystem, type NavigationAction, type NavigationState, type StarSystemId } from "./galaxy";

export function useStarNavigation(key: string) {
  const [state, dispatch] = useReducer(navigationReducer, key, storageKey => {
    let id: string | null = null;
    try { id = localStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
    return { current: starSystem(id).id, destination: null, phase: "idle", arrived: false } as NavigationState;
  });
  const { current, arrived } = state;
  useEffect(() => {
    if (!arrived) return;
    try { localStorage.setItem(key, current); } catch { /* The current view still works. */ }
  }, [key, current, arrived]);
  return { state, dispatch };
}

export const NAVIGATION_TABLE_RADIUS = 2.65;

export function navigationConsolePose(layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring], angle = cabinAngle(layout, cabin.slot) + 6.7 / ring.radius;
  return { point: shipPoint(ring.radius + .3, angle), angle };
}

export function NavigationConsole({ layout, cabin, state, onAction, disabled }: { layout: ShipLayout; cabin: ShipCabin; state: NavigationState; onAction: (action: NavigationAction) => void; disabled: boolean }) {
  const t = useUiText(), pose = navigationConsolePose(layout, cabin), open = state.phase !== "idle";
  const route = useMemo(() => STAR_SYSTEMS.map(system => [...system.position] as [number, number, number]), []);
  const choose = (id: StarSystemId) => { if (!disabled) onAction(open ? { type: "select", id } : { type: "open" }); };
  return <group position={[pose.point.x, 0, pose.point.z]} rotation={[0, pose.angle, 0]}>
    <group onClick={event => { event.stopPropagation(); if (!disabled && !open) onAction({ type: "open" }); }}>
      <mesh position={[0, .45, 0]}><cylinderGeometry args={[1.7, 1.2, .8, 48]} /><meshStandardMaterial color="#263f50" metalness={.55} roughness={.4} /></mesh>
      <mesh position={[0, .88, 0]}><cylinderGeometry args={[NAVIGATION_TABLE_RADIUS, 2.5, .12, 64]} /><meshStandardMaterial color="#102c3a" metalness={.6} roughness={.26} /></mesh>
      {[1.1, 1.8, 2.5].map(radius => <mesh key={radius} position={[0, .96, 0]} rotation={[-Math.PI/2, 0, 0]}>
        <ringGeometry args={[radius-.014, radius+.014, 80]} /><meshBasicMaterial color="#79cbd7" transparent opacity={.38} depthWrite={false} />
      </mesh>)}
      <mesh position={[0, 2.05, 0]}><cylinderGeometry args={[2.4, .3, 2.15, 48, 1, true]} /><meshBasicMaterial color="#57bad3" transparent opacity={.045} depthWrite={false} side={2} /></mesh>
    </group>
    <group position={[0, 2.15, 0]}>
      <Line points={[...route, route[0]]} color="#6baac1" lineWidth={1} transparent opacity={.35} raycast={() => {}} />
      {STAR_SYSTEMS.map(system => <group key={system.id} position={[...system.position]}>
        <mesh onClick={event => { event.stopPropagation(); choose(system.id); }}>
          <sphereGeometry args={[.115, 24, 16]} /><meshBasicMaterial color={system.color} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI/2, 0, 0]}><ringGeometry args={[.22, .24, 48]} /><meshBasicMaterial color={system.color} transparent opacity={system.id === state.current ? .95 : .35} side={2} /></mesh>
        {open ? <Html center position={[0, .37, 0]} zIndexRange={[35, 34]}>
          <button type="button" disabled={disabled || state.phase !== "chart"} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); choose(system.id); }}
            className="star-map-label" aria-label={t("Plot course to {system}", { system: t(system.name) })} aria-pressed={state.destination === system.id}>
            <span style={{ color: system.color }}>{t(system.name)}</span>
            {system.id === state.current ? <small>{t("You are here")}</small> : null}
          </button>
        </Html> : null}
      </group>)}
    </group>
    {!open ? <Html center position={[0, 3.8, 0]} zIndexRange={[15, 14]}>
      <button type="button" disabled={disabled} className="star-console-label" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onAction({ type: "open" }); }}>
        <Navigation2 size={14} /><span>{t("Star chart")}<small>{t("Command navigation")}</small></span><ArrowRight size={13} />
      </button>
    </Html> : null}
  </group>;
}

export function NavigationOverlay({ state, onAction }: { state: NavigationState; onAction: (action: NavigationAction) => void }) {
  const t = useUiText(), close = useRef<HTMLButtonElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onAction({ type: state.phase === "confirm" ? "cancel" : "close" });
    };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); previousFocus.current?.focus(); };
  }, [onAction, state.phase]);
  const destination = state.destination ? starSystem(state.destination) : null;
  return <div className="star-navigation-overlay" data-navigation-phase={state.phase}>
    <header>
      <div><span className="star-eyebrow">{t("Command navigation")}</span><h1>{t("Local star chart")}</h1><p>{t("Current system")} · {t(starSystem(state.current).name)}</p></div>
      <button ref={close} type="button" onClick={() => onAction({ type: "close" })} className="star-close" aria-label={t("Close star chart")}><X size={18} /></button>
    </header>
    <p className="star-map-help">{t("Select a star to plot a course · Drag to orbit · Scroll to zoom")}</p>
    {destination ? <section className="star-course" role="dialog" aria-labelledby="star-course-title">
      <span className="star-eyebrow" style={{ color: destination.color }}>{t("Destination")}</span>
      <h2 id="star-course-title">{t("Warp to {system}?", { system: t(destination.name) })}</h2>
      <p>{t(destination.description)}</p>
      <div className="star-course-actions"><button type="button" onClick={() => onAction({ type: "cancel" })}>{t("Cancel")}</button><button type="button" className="star-engage" onClick={() => onAction({ type: "engage" })}>{t("Engage warp")} <ArrowRight size={15} /></button></div>
    </section> : null}
  </div>;
}
