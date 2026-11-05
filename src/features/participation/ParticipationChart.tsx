"use client";
import { useEffect, useId, useRef, useState } from "react";
import { participationGroupKey, type OrderClass, type ParticipationGroup, type ParticipationMetric, type ParticipationPoint } from "@/lib/participation/model";

export const formatParticipationHour = (ms: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
export const formatParticipationShare = (value: number | null) => value === null ? "—" : `${(value * 100).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}%`;
const clock = (ms: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(ms);
const number = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export function ParticipationChart({ group, points, metric, types, maximum, selected, onSelect }: {
  group: ParticipationGroup; points: ParticipationPoint[]; metric: ParticipationMetric; types: OrderClass[]; maximum: number;
  selected?: number; onSelect: (hour: number) => void;
}) {
  const pattern = useId().replaceAll(":", ""), scroll = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ hour: number; type: OrderClass } | null>(null);
  useEffect(() => { const node = scroll.current; if (node) node.scrollLeft = node.scrollWidth; }, [points.length, group.key]);
  const width = 960, height = 240, top = 12, bottom = 202, band = width / Math.max(1, points.length);
  const shareKey = metric === "count" ? "countShare" : "notionalShare";
  const focusedPoint = hover ? points.find(p => p.hour === hover.hour) : null;
  const focusedRow = focusedPoint?.rows.find(r => participationGroupKey(r) === group.key && r.type === hover?.type);
  const ticks = Array.from({ length: 5 }, (_, i) => maximum * (4 - i) / 4);
  const state = !focusedPoint?.available ? "该小时未采集" : !focusedRow ? "该小时没有此对象" : !focusedRow.ready ? focusedRow.reasons.join("；") : "市场无该类成交";
  return <article className="participation-chart" aria-label={`${group.label}小时参与率柱状图`}>
    <div className="participation-chart-heading"><h3>{group.label}</h3><span>{metric === "count" ? "成交笔数参与率" : "成交额参与率"}</span></div>
    <div className="participation-plot">
      <svg className="participation-y-axis" viewBox="0 0 60 240" preserveAspectRatio="none" aria-hidden="true">{ticks.map(value => <text key={value} x={54} y={top + (1 - value / maximum) * (bottom - top) + 4} textAnchor="end">{formatParticipationShare(value)}</text>)}</svg>
      <div className="participation-plot-scroll" ref={scroll}>
        <svg className="participation-bars" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="按小时排列的参与率，点击柱子查看明细">
          <defs><pattern id={pattern} width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5L5 0" stroke="#6c8190" strokeWidth="1" /></pattern></defs>
          {ticks.map(value => <line key={value} x1={0} x2={width} y1={top + (1 - value / maximum) * (bottom - top)} y2={top + (1 - value / maximum) * (bottom - top)} className="participation-grid-line" />)}
          {points.map((point, i) => <g key={point.hour}>
            {selected === point.hour ? <rect x={i * band} y={top} width={band} height={bottom - top} fill="#a7e2d410" /> : null}
            {types.map((type, t) => {
              const row = point.rows.find(r => participationGroupKey(r) === group.key && r.type === type), value = row?.[shareKey] ?? null;
              const barHeight = value === null ? 7 : Math.max(1.5, value / maximum * (bottom - top));
              const label = `${formatParticipationHour(point.hour)} ${type === "rpi" ? "RPI" : "non-RPI"} ${formatParticipationShare(value)}`;
              return <rect key={type} role="button" tabIndex={0} aria-label={label} data-hour={point.hour} data-type={type} data-share={value ?? "unknown"}
                className={`participation-bar ${value === null ? "unknown" : type}`} fill={value === null ? `url(#${pattern})` : undefined}
                x={i * band + band * (.1 + t * .8 / types.length)} y={bottom - barHeight} width={Math.max(1, band * .8 / types.length - 1)} height={barHeight}
                onMouseEnter={() => setHover({ hour: point.hour, type })} onFocus={() => setHover({ hour: point.hour, type })}
                onClick={() => onSelect(point.hour)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(point.hour); } }}>
                <title>{label}{row ? `；我们的${metric === "count" ? "笔数" : "成交额"} ${number(row.own[metric])} / 市场 ${number(row.market[metric])}` : "；数据未完整"}</title>
              </rect>;
            })}
            {i % Math.max(1, Math.ceil(points.length / 6)) === 0 || i === points.length - 1 ? <text x={i * band + band / 2} y={222} textAnchor="middle" className="participation-x-label">{i === 0 || clock(point.hour) === "00" || points.length > 48 ? formatParticipationHour(point.hour) : `${clock(point.hour)}:00`}</text> : null}
          </g>)}
        </svg>
      </div>
    </div>
    <div className="participation-chart-tooltip" role="status">{hover ? <><strong>{formatParticipationHour(hover.hour)} · {hover.type === "rpi" ? "RPI" : "non-RPI"} · {formatParticipationShare(focusedRow?.[shareKey] ?? null)}</strong><span>{focusedRow ? `我们 ${number(focusedRow.own[metric])} / 市场 ${number(focusedRow.market[metric])}${metric === "count" ? " 笔" : " 美元"}` : ""}{focusedRow?.[shareKey] == null ? ` · ${state}` : ""}</span></> : <span>悬停查看参与率与分子、分母；点击柱子查看该小时明细。</span>}</div>
  </article>;
}
