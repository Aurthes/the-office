"use client";
import { useEffect, useMemo, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useCursor } from "@react-three/drei";
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
  </group>;
}

export function ShipObjectCard({ object, customRoom, onClose }: { object: ShipObject; customRoom: boolean; onClose: () => void }) {
  const t = useUiText();
  const [name, description] = SHIP_OBJECT_INFO[object.kind];
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  return <section className="ship-object-card" aria-label={t("Object information")} data-object-id={object.id} data-object-kind={object.kind}>
    <div className="ship-object-card-heading"><span><ScanLine size={13} />{t(object.space ? "Space discovery" : "Ship discovery")}</span><button type="button" aria-label={t("Close object information")} onClick={onClose}><X size={16} /></button></div>
    <h2>{t(name)}</h2>
    <p className="ship-object-location">{object.space ? t("Nearby space") : <>L{object.deck + 1} · {customRoom ? object.cabinName : t(object.cabinName)}</>}</p>
    <p>{t(description)}</p>
    <div className="ship-object-note"><span>{t("Crew note")}</span><p>{t(shipObjectNote(object.id))}</p></div>
  </section>;
}
