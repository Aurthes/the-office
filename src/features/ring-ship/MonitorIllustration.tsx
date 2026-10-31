import type { MonitorLink } from "@/lib/monitoring/types";

// Static instrument illustrations, deliberately without invented metric values.
export function MonitorIllustration({ visual, compact = false }: { visual: MonitorLink["visual"]; compact?: boolean }) {
  return <svg viewBox="0 0 400 170" fill="none" aria-hidden="true" className={`monitor-illustration ${compact ? "compact" : ""}`}>
    <defs><linearGradient id={`monitor-fill-${visual}`} x1="200" y1="20" x2="200" y2="170" gradientUnits="userSpaceOnUse"><stop stopColor="currentColor" stopOpacity=".28" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
    {[35, 75, 115, 155].map(y => <path key={y} d={`M20 ${y}H380`} stroke="currentColor" opacity=".09" />)}
    {visual === "chart" ? <>
      {[70, 140, 210, 280, 350].map(x => <path key={x} d={`M${x} 15V155`} stroke="currentColor" opacity=".07" />)}
      <path d="M20 134L42 128L62 139L83 110L105 119L127 88L149 101L171 82L193 90L216 58L238 72L260 45L282 59L304 30L326 49L349 22L380 35V165H20Z" fill={`url(#monitor-fill-${visual})`} />
      <path d="M20 134L42 128L62 139L83 110L105 119L127 88L149 101L171 82L193 90L216 58L238 72L260 45L282 59L304 30L326 49L349 22L380 35" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M20 143L54 129L87 137L120 113L153 120L186 105L219 114L252 90L285 101L318 80L351 94L380 76" stroke="#99a5dc" strokeWidth="2" opacity=".6" />
      <circle cx="380" cy="35" r="5" fill="currentColor" /><circle cx="380" cy="35" r="10" stroke="currentColor" opacity=".2" />
    </> : visual === "servers" ? <>
      {[38, 142, 246].map((x, i) => <g key={x} transform={`translate(${x},${i === 1 ? 20 : 35})`}>
        <rect width="88" height="120" rx="8" fill="#122c3c" stroke="currentColor" strokeOpacity=".4" />
        {[12, 44, 76].map(y => <g key={y}><rect x="9" y={y} width="70" height="24" rx="4" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeOpacity=".2" /><path d={`M19 ${y + 9}H48M19 ${y + 15}H42`} stroke="currentColor" opacity=".4" /><circle cx="66" cy={y + 12} r="3" fill="currentColor" /></g>)}
      </g>)}
      <path d="M82 155V162H290V155M186 141V162" stroke="currentColor" opacity=".4" />
    </> : <>
      <circle cx="200" cy="85" r="64" stroke="currentColor" strokeWidth="2" /><ellipse cx="200" cy="85" rx="28" ry="64" stroke="currentColor" opacity=".5" />
      <ellipse cx="200" cy="85" rx="64" ry="25" stroke="currentColor" opacity=".5" /><path d="M136 85H264M200 21V149M58 85H122M278 85H342" stroke="currentColor" opacity=".4" />
      <circle cx="58" cy="85" r="5" fill="currentColor" /><circle cx="342" cy="85" r="5" fill="currentColor" />
    </>}
  </svg>;
}
