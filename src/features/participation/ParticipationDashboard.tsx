"use client";

import { useEffect, useMemo, useState } from "react";
import { participationRows, type ParticipationHour, type ParticipationRow } from "@/lib/participation/model";
import "./participation.css";

type Reply = { configured: boolean; updatedAt: number | null; hours: number[]; hour: ParticipationHour | null };
const formatHour = (ms: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
const amount = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}%`;

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
  const [reply, setReply] = useState<Reply | null>(null), [selected, setSelected] = useState<number | undefined>();
  const [level, setLevel] = useState<"symbol" | "account" | "exchange">("exchange");
  const [exchange, setExchange] = useState(""), [account, setAccount] = useState(""), [type, setType] = useState(""), [symbol, setSymbol] = useState("");
  const [error, setError] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController(); let inFlight = false;
    const refresh = async () => {
      if (inFlight) return; inFlight = true;
      try {
        const response = await fetch(`/api/monitoring/participation${selected === undefined ? "" : `?hour=${selected}`}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || "读取失败");
        if (!controller.signal.aborted) { setReply(body); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暂时无法读取数据"); }
      finally { inFlight = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 30_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [selected]);
  const hour = reply?.hour;
  const exchanges = useMemo(() => [...new Set(hour?.own.map(r => r.exchange) || [])].sort(), [hour]);
  const accounts = useMemo(() => [...new Set(hour?.own.filter(r => !exchange || r.exchange === exchange).map(r => r.account) || [])].sort(), [hour, exchange]);
  const rows = useMemo(() => hour ? participationRows(hour, level, { exchange, account, symbol, type }) : [], [hour, level, exchange, account, symbol, type]);
  const stale = !!reply?.updatedAt && Date.now() - reply.updatedAt > 120_000;
  const pendingHour = !!hour && Date.now() < hour.hour + 3_720_000;
  return <section className="participation-dashboard" aria-label="小时市场参与度">
    <header><div><p className="participation-eyebrow">MARKET PARTICIPATION · HOURLY</p><h2>小时市场参与度</h2><p>成交额与成交笔数并列 · RPI / non-RPI</p></div><span className={error || stale ? "participation-partial" : "participation-ready"}>{loading ? "读取中…" : hour ? `更新 ${new Date(reply?.updatedAt ?? hour.updatedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : "等待数据"}</span></header>
    {error ? <p role="alert" className="participation-notice">{error}</p> : null}
    {stale ? <p className="participation-notice">数据更新已延迟，请勿把当前数值当成最新状态。</p> : null}
    {pendingHour ? <p className="participation-notice">本小时尚在采集或结算。数据未完整时，参与率显示“—”。</p> : null}
    {reply && !reply.configured ? <p className="participation-empty">尚未接入小时成交数据。</p> : null}
    <div className="participation-filters">
      <label>小时（北京时间）<select aria-label="小时" value={selected ?? "latest"} onChange={e => setSelected(e.target.value === "latest" ? undefined : Number(e.target.value))}><option value="latest">最近已结束小时</option>{reply?.hours.map(h => <option key={h} value={h}>{formatHour(h)}–{formatHour(h + 3_600_000)}</option>)}</select></label>
      <label>交易所<select value={exchange} onChange={e => { setExchange(e.target.value); setAccount(""); }}><option value="">全部</option>{exchanges.map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Account<select value={account} onChange={e => setAccount(e.target.value)}><option value="">全部</option>{accounts.map(x => <option key={x}>{x}</option>)}</select></label>
      <label>订单类型<select value={type} onChange={e => setType(e.target.value)}><option value="">两种类型</option><option value="rpi">RPI</option><option value="non-rpi">non-RPI</option></select></label>
      <label>Symbol<input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="搜索 symbol" /></label>
    </div>
    <nav className="participation-levels" aria-label="汇总层级">{([["exchange", "Exchange 汇总"], ["account", "Account 汇总"], ["symbol", "Account × Symbol 明细"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={level === key} onClick={() => setLevel(key)}>{label}</button>)}</nav>
    {hour ? <p className="participation-period">{formatHour(hour.hour)}–{formatHour(hour.hour + 3_600_000)} · 北京时间 · 金额为美元等值</p> : null}
    <ParticipationTable rows={rows} level={level} />
    <footer><p>参与率＝我们的该类成交 ÷ 同 symbol 的市场该类成交。汇总先加总原始数值，再求比率；同一市场分母跨账户只算一次。</p><p>缺数据不等于 0%。Gate RPI 市场量使用总成交与过滤流的差集估计；发现流缺失或记录不一致时，不给出参与率。USDT / USDC 按 1:1 美元等值。</p></footer>
  </section>;
}
