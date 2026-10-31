"use client";

import { useEffect, useRef } from "react";
import { useUiText } from "@/lib/i18n/ui-language";
import type { StarSystem } from "./galaxy";

export function WarpJourney({ destination, onArrive, onComplete }: { destination: StarSystem; onArrive: () => void; onComplete: () => void }) {
  const t = useUiText(), canvasRef = useRef<HTMLCanvasElement>(null), root = useRef<HTMLDivElement>(null), status = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced ? 1200 : 6400, arrival = reduced ? 650 : 4900;
    const start = performance.now(); let frame = 0, arrived = false;
    let width = 1, height = 1;
    const resize = () => {
      if (!canvas) return;
      width = canvas.clientWidth; height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = width*dpr; canvas.height = height*dpr; context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); window.addEventListener("resize", resize);
    const draw = (now: number) => {
      const elapsed = now-start, progress = Math.min(1, elapsed/duration);
      const exit = Math.max(0, (elapsed-arrival)/(duration-arrival));
      if (!arrived && elapsed >= arrival) { arrived = true; onArrive(); }
      if (root.current) {
        root.current.style.opacity = String(elapsed < 450 ? elapsed/450 : 1-exit);
        root.current.dataset.warpStage = elapsed < 1500 && !reduced ? "aligning" : arrived ? "arriving" : "in-warp";
      }
      if (status.current) status.current.textContent = elapsed < 1500 && !reduced ? t("Aligning warp drive") : arrived ? t("Arrival confirmed") : t("In warp");
      if (context && !reduced) {
        context.fillStyle = "#020610"; context.fillRect(0, 0, width, height);
        const cx = width*.5, cy = height*.48, extent = Math.hypot(width, height);
        const speed = Math.min(1, Math.max(0, (elapsed-800)/1200));
        const halo = context.createRadialGradient(cx, cy, 0, cx, cy, extent*.55);
        halo.addColorStop(0, "#a4e2ff35"); halo.addColorStop(.12, destination.color+"28"); halo.addColorStop(.45, "#12395635"); halo.addColorStop(1, "#020610");
        context.fillStyle = halo; context.fillRect(0, 0, width, height);
        for (let i=0; i<180; i++) {
          const angle = i*2.39996323, cycle = (i*.6180339+progress*(.35+speed*2.8))%1;
          const distance = Math.pow(cycle,2)*extent*.75;
          const length = (8+distance*.22)*speed;
          context.strokeStyle = i%4 ? destination.color : "#d7f1ff";
          context.globalAlpha = Math.sin(cycle*Math.PI)*(.18+speed*.65);
          context.lineWidth = .4+cycle*1.5; context.beginPath();
          context.moveTo(cx+Math.cos(angle)*distance, cy+Math.sin(angle)*distance*.72);
          context.lineTo(cx+Math.cos(angle)*(distance+length), cy+Math.sin(angle)*(distance+length)*.72); context.stroke();
        }
        context.globalAlpha = 1;
      }
      if (progress >= 1) { onComplete(); return; }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", resize); };
  }, [destination, onArrive, onComplete, t]);
  return <div ref={root} className="star-warp" role="status" aria-live="polite" aria-label={t("Warp to {system}", { system: t(destination.name) })}>
    <canvas ref={canvasRef} aria-hidden="true" />
    <div className="star-warp-copy"><span className="star-eyebrow">{t("Destination")}</span><h2>{t(destination.name)}</h2><span ref={status}>{t("Aligning warp drive")}</span></div>
  </div>;
}
