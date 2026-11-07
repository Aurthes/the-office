"use client";
import { useEffect, useRef, useState } from "react";
import { useUiText } from "@/lib/i18n/ui-language";
import { MARKOUT_HORIZONS, type MarkoutBand, type MarkoutClass, type MarkoutSeries } from "@/lib/maker-markout/model";
import "./maker-markout.css";
const colors:Record<MarkoutClass,string>={rpi:"#54d9ba","non-rpi":"#8aa9ff",unknown:"#aab4bc"};
const names:Record<MarkoutClass,string>={rpi:"RPI","non-rpi":"non-RPI maker",unknown:"unknown TIF"};
const number=(v:number)=>Math.abs(v)>=1e6 ? v.toExponential(2) : v.toLocaleString(undefined,{maximumFractionDigits:3});
const hour=(time:number)=>new Date(time).toISOString().slice(11,16);
function MarkoutChart({data}:{data:MarkoutSeries}){
  const host=useRef<HTMLDivElement>(null);const [width,setWidth]=useState(800);
  useEffect(()=>{if(!host.current || typeof ResizeObserver==="undefined")return;const o=new ResizeObserver(([e])=>setWidth(Math.max(300,Math.min(1200,e.contentRect.width))));o.observe(host.current);return()=>o.disconnect();},[]);
  const all=data.points.flatMap(p=>p.quantiles||[]), max=all.reduce((a,b)=>Math.max(a,Math.abs(b)),1), lo=Math.min(0,...all.map(x=>x/max)),hi=Math.max(.01,...all.map(x=>x/max));
  const x=(v:number)=>58+(v-data.start)/(data.end-data.start)*(width-74),y=(v:number)=>18+(hi-v/max)/(hi-lo)*226;
  const groups=(type:MarkoutClass)=>{const out:MarkoutBand[][]=[];let current:MarkoutBand[]=[];for(const p of data.points.filter(p=>p.type===type)){if(p.quantiles)current.push(p);else if(current.length){out.push(current);current=[];}}if(current.length)out.push(current);return out;};
  const points=(g:MarkoutBand[],i:number)=>g.map(p=>`${x(p.time+data.bucketMs/2)},${y(p.quantiles![i])}`).join(" ");
  return <div ref={host} className="markout-chart"><svg role="img" aria-label="Maker markout quantile time series" viewBox={`0 0 ${width} 288`}>
    {[0,.25,.5,.75,1].map(t=>{const v=(lo+(hi-lo)*t)*max;return <g key={t}><line x1={54} x2={width-12} y1={y(v)} y2={y(v)} stroke="#355061"/><text x={49} y={y(v)+4} textAnchor="end">{number(v)}</text></g>;})}
    <text x={5} y={11}>bps</text>
    {data.points.filter(p=>p.type===(data.points[0]?.type)).filter((_,i)=>i%Math.ceil((data.end-data.start)/data.bucketMs/(width<500?4:8))===0).map(p=><text key={p.time} x={x(p.time+data.bucketMs/2)} y={270} textAnchor="middle">{hour(p.time)}</text>)}
    {(["rpi","non-rpi","unknown"] as MarkoutClass[]).flatMap(type=>groups(type).map((g,j)=><g key={`${type}:${j}`} data-type={type}>
      <polygon points={`${points(g,0)} ${[...g].reverse().map(p=>`${x(p.time+data.bucketMs/2)},${y(p.quantiles![4])}`).join(" ")}`} fill={colors[type]} opacity=".13"/>
      <polygon points={`${points(g,1)} ${[...g].reverse().map(p=>`${x(p.time+data.bucketMs/2)},${y(p.quantiles![3])}`).join(" ")}`} fill={colors[type]} opacity=".25"/>
      <polyline points={points(g,2)} fill="none" stroke={colors[type]} strokeWidth="2"/>{g.map(p=><circle key={p.time} cx={x(p.time+data.bucketMs/2)} cy={y(p.quantiles![2])} r={3} fill={colors[type]}><title>{hour(p.time)} UTC · {names[type]} · N={p.n} · P50={number(p.quantiles![2])} bps</title></circle>)}
    </g>))}
  </svg></div>;
}
export function MakerMarkoutDashboard(){
  const t=useUiText();const [reply,setReply]=useState<MarkoutSeries|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const [loadedKey,setLoadedKey]=useState("");const [clock,setClock]=useState(Date.now);
  const [horizon,setHorizon]=useState("1s"),[hours,setHours]=useState("1"),[level,setLevel]=useState("overall"),[strategy,setStrategy]=useState(""),[exchange,setExchange]=useState(""),[symbol,setSymbol]=useState(""),[type,setType]=useState("");
  const filterKey=JSON.stringify([horizon,hours,level,strategy,exchange,symbol,type]);
  useEffect(()=>{
    const c=new AbortController();let inFlight=false;
    const refresh=async()=>{if(inFlight || document.hidden)return;inFlight=true;setLoading(true);try{
      const q=new URLSearchParams({horizon,hours,level,strategy,exchange:level==="overall"?"":exchange,symbol:level==="symbol"?symbol:"",type});
      const r=await fetch(`/api/monitoring/maker-markout?${q}`,{cache:"no-store",signal:c.signal});const body=await r.json();if(!r.ok)throw Error(body.error||"Markout read failed");
      if(!c.signal.aborted){setReply(body);setLoadedKey(filterKey);setClock(Date.now());setError("");}
    }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:"Markout read failed");}finally{inFlight=false;if(!c.signal.aborted)setLoading(false);}};
    void refresh();const id=setInterval(()=>{if(!document.hidden){setClock(Date.now());void refresh();}},30_000);document.addEventListener("visibilitychange",refresh);
    return()=>{c.abort();clearInterval(id);document.removeEventListener("visibilitychange",refresh);};
  },[horizon,hours,level,strategy,exchange,symbol,type,filterKey]);
  const expired=!!reply && clock-reply.sampledAt>90_000;
  const data=error || loadedKey!==filterKey || expired ? null : reply;
  const changeLevel=(v:string)=>{setLevel(v);setExchange(v==="overall"?"":reply?.options.exchanges[0]||"");setSymbol(v==="symbol"?reply?.options.symbols[0]||"":"");};
  return <section className="maker-markout" aria-label={t("Maker markout")}>
    <header><h2>{t("Maker markout")}</h2><p>{t("P50 line · P25–P75 / P5–P95 sample distribution bands")}</p></header>
    <div className="markout-controls">
      <label>{t("Horizon")}<select aria-label={t("Horizon")} value={horizon} onChange={e=>setHorizon(e.target.value)}>{MARKOUT_HORIZONS.map(h=><option key={h}>{h}</option>)}</select></label>
      <label>{t("History")}<select aria-label={t("History")} value={hours} onChange={e=>setHours(e.target.value)}>{[1,6,24].map(h=><option key={h} value={h}>{h}h</option>)}</select></label>
      <label>{t("Level")}<select aria-label={t("Level")} value={level} onChange={e=>changeLevel(e.target.value)}><option value="overall">{t("Overall")}</option><option value="exchange">{t("Exchange")}</option><option value="symbol">Symbol</option></select></label>
      <label>{t("Strategy")}<select aria-label={t("Strategy")} value={strategy} onChange={e=>setStrategy(e.target.value)}><option value="">{t("All")}</option>{reply?.options.strategies.map(s=><option key={s}>{s}</option>)}</select></label>
      {level!=="overall"?<label>{t("Exchange")}<select aria-label={t("Exchange")} value={exchange} onChange={e=>{setExchange(e.target.value);setSymbol("");}}><option value="">{t("All")}</option>{reply?.options.exchanges.map(s=><option key={s}>{s}</option>)}</select></label>:null}
      {level==="symbol"?<label>Symbol<select aria-label="Symbol" value={symbol} onChange={e=>setSymbol(e.target.value)}><option value="">{t("All")}</option>{reply?.options.symbols.filter(s=>!exchange||s.split(".")[0]===exchange).map(s=><option key={s}>{s}</option>)}</select></label>:null}
      <label>TIF<select aria-label="TIF" value={type} onChange={e=>setType(e.target.value)}><option value="">{t("All")}</option>{(["rpi","non-rpi","unknown"] as MarkoutClass[]).map(s=><option key={s} value={s}>{names[s]}</option>)}</select></label>
    </div>
    {expired?<p role="alert">{t("Snapshot expired; distribution is unavailable")}</p>:null}{error?<p role="alert">{t(error)}</p>:null}{loading?<p role="status">{t("Reading markout data…")}</p>:null}
    {data?<><p className="markout-clock">UTC · {new Date(data.start).toISOString().slice(0,10)} · {t("Export time; closed buckets")}</p>
      <div className="markout-legend">{(["rpi","non-rpi","unknown"] as MarkoutClass[]).filter(c=>!type||c===type).map(c=><span key={c} style={{color:colors[c]}}>● {names[c]}</span>)}</div>
      <MarkoutChart data={data}/>
      {!data.configured?<p>{t("No markout source configured")}</p>:null}
      {data.sourceErrors?<p role="alert">{t("Source incomplete; distribution is N/A")}</p>:null}
      {!data.points.some(p=>p.quantiles)?<p>{t("No complete distribution yet. Legacy averages cannot recover quantiles.")}</p>:null}
      <div className="markout-table"><table aria-label={t("Markout bucket distributions")}><thead><tr><th>UTC</th><th>TIF</th><th>N</th>{[5,25,50,75,95].map(q=><th key={q}>P{q} bps</th>)}<th>{t("Pending")}</th><th>{t("Quality")}</th></tr></thead>
      <tbody>{data.points.map(p=><tr key={`${p.time}:${p.type}`}><td>{hour(p.time)}</td><td>{names[p.type]}</td><td>{p.n}/{p.count}</td>{[0,1,2,3,4].map(i=><td key={i}>{p.quantiles?number(p.quantiles[i]):"N/A"}</td>)}<td>{p.pending}</td><td>{p.transportIncomplete?t("Source incomplete; distribution is N/A"):p.incomplete?`N/A · legacy ${p.legacy} · overflow ${p.overflow} · invalid ${p.invalid} · missing ${p.missing}`:p.quantiles?t("Valid settled samples"):t("No mature samples")}{p.runs>1?` · ${p.runs} runs`:""}</td></tr>)}</tbody></table></div>
    </>:null}
    <footer>{t("Equal-weight opening-maker fill segments, not unique orders. Bands show the sample distribution, not a confidence interval. Young/pending fills are excluded; missing data is not zero.")}</footer>
  </section>;
}
