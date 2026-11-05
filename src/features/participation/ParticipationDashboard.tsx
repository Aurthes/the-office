"use client";
import { useEffect, useMemo, useState } from "react";
import type { OrderClass, ParticipationLevel, ParticipationMetric, ParticipationRow, ParticipationSeries } from "@/lib/participation/model";
import { ParticipationChart, formatParticipationHour as formatHour, formatParticipationShare as percent } from "./ParticipationChart";
import "./participation.css";
const amount = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
function ParticipationTable({ rows, level }: { rows: ParticipationRow[]; level: "symbol" | "account" | "exchange" }) {
  return <div className="participation-table-wrap"><table>
    <thead><tr><th>交易所</th>{level !== "exchange" ? <th>Account</th> : null}{level === "symbol" ? <th>Symbol</th> : <th>Symbol 数</th>}<th>订单类型</th><th className="participation-metric">成交额参与率</th><th className="participation-metric">成交笔数参与率</th><th>我们的成交额</th><th>市场成交额</th><th>我们的笔数</th><th>市场笔数</th><th>状态</th></tr></thead>
    <tbody>{rows.map(row => <tr key={JSON.stringify([row.exchange, row.account, row.symbol, row.type])}>
      <td>{row.exchange}</td>{level !== "exchange" ? <td>{row.account}</td> : null}<td>{level === "symbol" ? row.symbol : row.symbols}</td>
      <td><span className={`participation-type ${row.type}`}>{row.type === "rpi" ? "RPI" : "non-RPI"}</span></td>
      <td className="participation-metric">{percent(row.notionalShare)}</td><td className="participation-metric">{percent(row.countShare)}</td>
      <td>{amount(row.own.notional)}</td><td>{amount(row.market.notional)}</td><td>{amount(row.own.count)}</td><td>{amount(row.market.count)}</td>
      <td className={row.ready ? "participation-ready" : "participation-partial"} title={row.reasons.join("；")}>{row.ready ? row.market.count > 0 ? "完整" : "市场无该类成交" : row.reasons.join("；") || "数据未完整"}</td>
    </tr>)}</tbody>
  </table>{!rows.length ? <p className="participation-empty">该筛选条件下暂无数据。</p> : null}</div>;
}

export function ParticipationDashboard() {
  const [reply, setReply] = useState<ParticipationSeries | null>(null);
  const [window, setWindow] = useState(24), [level, setLevel] = useState<ParticipationLevel>("exchange"), [metric, setMetric] = useState<ParticipationMetric>("notional");
  const [exchange, setExchange] = useState(""), [account, setAccount] = useState(""), [type, setType] = useState(""), [symbol, setSymbol] = useState(""), [search, setSearch] = useState(""), [focus, setFocus] = useState("");
  const [selected, setSelected] = useState<number | undefined>(), [detail, setDetail] = useState(false);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => { const timer = setTimeout(() => { setSymbol(search); setFocus(""); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const controller = new AbortController(); let inFlight = false;
    setLoading(true);
    const refresh = async () => {
      if (inFlight) return; inFlight = true;
      try {
        const query = new URLSearchParams({ window: String(window), level, exchange, account, type, symbol, focus });
        const response = await fetch(`/api/monitoring/participation?${query}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || "读取失败");
        if (!controller.signal.aborted) { setReply(body); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暂时无法读取数据"); }
      finally { inFlight = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 30_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [window, level, exchange, account, type, symbol, focus]);
  const types: OrderClass[] = type ? [type as OrderClass] : ["rpi", "non-rpi"];
  const shareKey = metric === "count" ? "countShare" : "notionalShare";
  const maximum = useMemo(() => {
    const values = reply?.points.flatMap(p => p.rows.map(r => r[shareKey] ?? 0)) || [];
    const high = values.reduce((a, b) => Math.max(a, b), .001) * 1.1, scale = 10 ** Math.floor(Math.log10(high));
    return Math.ceil(high / scale) * scale;
  }, [reply, shareKey]);
  const groups = reply?.groups.filter(g => !reply.focus || reply.focus === g.key) || [];
  const point = reply?.points.find(p => p.hour === selected) || [...(reply?.points || [])].reverse().find(p => p.rows.some(r => r.ready)) || [...(reply?.points || [])].reverse().find(p => p.available);
  const stale = !!reply?.updatedAt && Date.now() - reply.updatedAt > 120_000;
  const available = reply?.points.filter(p => p.available).length || 0;
  const changeLevel = (next: ParticipationLevel) => { setLevel(next); setFocus(""); setSelected(undefined); };
  return <section className="participation-dashboard" aria-label="小时市场参与度">
    <header><div><p className="participation-eyebrow">MARKET PARTICIPATION · HOURLY</p><h2>小时市场参与度</h2><p>按小时看参与率变化 · RPI / non-RPI</p></div><span className={error || stale ? "participation-partial" : "participation-ready"}>{loading ? "读取中…" : reply?.updatedAt ? `更新 ${new Date(reply.updatedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : "等待数据"}</span></header>
    {error ? <p role="alert" className="participation-notice">{error}</p> : null}
    {stale ? <p className="participation-notice">数据更新已延迟，请勿把当前数值当成最新状态。</p> : null}
    {reply && !reply.configured ? <p className="participation-empty">尚未接入小时成交数据。</p> : null}
    <div className="participation-chart-controls">
      <div className="participation-metric-toggle" role="group" aria-label="参与率维度"><button type="button" aria-pressed={metric === "notional"} onClick={() => setMetric("notional")}>成交额</button><button type="button" aria-pressed={metric === "count"} onClick={() => setMetric("count")}>成交笔数</button></div>
      <label>时间范围<select aria-label="时间范围" value={window} onChange={e => { setWindow(Number(e.target.value)); setSelected(undefined); }}><option value={24}>最近 24 小时</option><option value={72}>最近 72 小时</option><option value={168}>最近 7 天</option></select></label>
      <span className="participation-chart-legend"><i className="rpi" />RPI <i className="non-rpi" />non-RPI <i className="unknown" />缺数据 / 未结算</span>
    </div>
    <nav className="participation-levels" aria-label="汇总层级">{([["exchange", "Exchange 汇总"], ["account", "Account 汇总"], ["symbol", "Account × Symbol 明细"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={level === key} onClick={() => changeLevel(key)}>{label}</button>)}</nav>
    <div className="participation-filters">
      <label>交易所<select aria-label="交易所" value={exchange} onChange={e => { setExchange(e.target.value); setAccount(""); setFocus(""); }}><option value="">全部</option>{reply?.options.exchanges.map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Account<select aria-label="Account" value={account} onChange={e => { setAccount(e.target.value); setFocus(""); }}><option value="">全部</option>{reply?.options.accounts.filter(a => !exchange || a.exchange === exchange).map(x => <option key={x.name}>{x.name}</option>)}</select></label>
      <label>订单类型<select aria-label="订单类型" value={type} onChange={e => setType(e.target.value)}><option value="">两种类型</option><option value="rpi">RPI</option><option value="non-rpi">non-RPI</option></select></label>
      <label>Symbol<input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索 symbol" /></label>
      {reply?.groups.length ? <label className="participation-target">图表对象<select aria-label="图表对象" value={focus || reply.focus} onChange={e => setFocus(e.target.value)}>{level !== "symbol" ? <option value="">全部</option> : null}{reply.groups.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}</select></label> : null}
    </div>
    <p className="participation-period">最近 {window} 小时 · 每根柱子 1 小时 · 北京时间 · 已有 {available} 小时采集记录{available < window ? "，空缺时段没有采集记录" : ""}{loading && reply ? " · 正在更新筛选" : ""}</p>
    <div className="participation-charts">{reply ? groups.map(group => <ParticipationChart key={group.key} group={group} points={reply.points} metric={metric} types={types} maximum={maximum} selected={selected} onSelect={hour => { setSelected(hour); setDetail(true); }} />) : null}</div>
    {reply && !groups.length ? <p className="participation-empty">该筛选条件下暂无数据。</p> : null}
    <details className="participation-details" open={detail} onToggle={e => setDetail(e.currentTarget.open)}><summary>查看单小时原始数值{point ? ` · ${formatHour(point.hour)}–${formatHour(point.hour + 3_600_000)}` : ""}</summary>
      {point && !point.available ? <p className="participation-notice">该小时未采集，参与率未知。</p> : null}<ParticipationTable rows={point?.rows || []} level={reply?.level || level} />
    </details>
    <footer><p>参与率＝我们的该类成交 ÷ 同 symbol 的市场该类成交。汇总先加总原始数值，再求比率；同一市场分母跨账户只算一次。</p><p>缺数据不等于 0%。当前小时结束后再等 2 分钟结算。Gate RPI 市场量使用总成交与过滤流差集估计；USDT / USDC 按 1:1 美元等值。</p></footer>
  </section>;
}
