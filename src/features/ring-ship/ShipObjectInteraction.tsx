"use client";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, useCursor } from "@react-three/drei";
import type { Group } from "three";
import { ScanLine, X } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { SHIP_OBJECT_INFO, shipObjectAtHit, shipObjectHighlight, shipObjectNote, type ShipObject } from "./shipObjects";

export function ShipObjectScene({ group, enabled, selectedId, onSelect }: {
  group: Group; enabled: boolean; selectedId?: string; onSelect: (object: ShipObject) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const { gl } = useThree();
  const objects = group.userData.shipObjects as ShipObject[];
  const object = enabled ? objects.find(item => item.id === (hovered || selectedId)) : undefined;
  const highlight = useMemo(() => object ? shipObjectHighlight(object) : null, [object]);
  useEffect(() => () => { highlight?.geometry.dispose(); highlight?.material.dispose(); }, [highlight]);
  useCursor(enabled && !!hovered, "pointer", "auto", gl.domElement);
  const hover = (event: ThreeEvent<PointerEvent>) => {
    if (event.pointerType === "touch") return;
    const hit = shipObjectAtHit(event.object, event.faceIndex);
    if (hit) event.stopPropagation();
    setHovered(hit?.id || null);
  };
  // Keep the event host stable when asynchronously loaded models replace the geometry.
  return <group dispose={null} onPointerMove={enabled ? hover : undefined} onPointerOut={enabled ? () => setHovered(null) : undefined}
      onClick={enabled ? (event: ThreeEvent<MouseEvent>) => {
        const hit = shipObjectAtHit(event.object, event.faceIndex);
        if (!hit) return;
        event.stopPropagation();
        if (event.delta < 6) onSelect(hit);
      } : undefined}>
    <primitive object={group} dispose={null} />
    {highlight ? <primitive object={highlight} dispose={null} /> : null}
    {object?.serverAlias ? <Html center position={[(object.bounds.min.x + object.bounds.max.x) / 2, object.bounds.max.y + .25, (object.bounds.min.z + object.bounds.max.z) / 2]} style={{ pointerEvents: "none" }}><span className="whitespace-nowrap rounded border border-blue-200/40 bg-[#102a36] px-2 py-1 text-xs text-blue-100">{object.serverAlias}</span></Html> : null}
  </group>;
}

export function ShipObjectCard({ object, customRoom, onClose, children }: { object: ShipObject; customRoom: boolean; onClose: () => void; children?: ReactNode }) {
  const t = useUiText();
  const [snapshot, setSnapshot] = useState({ id: object.id, activity: object.npc?.activity || "" });
  const activity = snapshot.id === object.id ? snapshot.activity : object.npc?.activity || "";
  useEffect(() => {
    if (!object.npc) return;
    const timer = window.setInterval(() => setSnapshot(previous => previous.id === object.id && previous.activity === object.npc?.activity ? previous : { id: object.id, activity: object.npc?.activity || "" }), 350);
    return () => window.clearInterval(timer);
  }, [object]);
  const [name, description] = SHIP_OBJECT_INFO[object.kind];
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  return <section className="ship-object-card" aria-label={t("Object information")} data-object-id={object.id} data-object-kind={object.kind} data-server-alias={object.serverAlias}>
    <div className="ship-object-card-heading"><span><ScanLine size={13} />{t(object.space ? "Space discovery" : "Ship discovery")}</span><button type="button" aria-label={t("Close object information")} onClick={onClose}><X size={16} /></button></div>
    <h2>{object.serverAlias || object.npc?.name || t(name)}</h2>
    <p className="ship-object-location">{object.space ? t("Nearby space") : <>L{object.deck + 1} · {customRoom ? object.cabinName : t(object.cabinName)}</>}</p>
    {!object.serverAlias ? <p>{t(description)}</p> : null}
    {children}
    {!object.serverAlias ? <div className="ship-object-note"><span>{t(object.npc ? "Current activity" : "Crew note")}</span><p>{t(object.npc ? activity : shipObjectNote(object.id))}</p></div> : null}
  </section>;
}
