import { getMakerMarkout } from "@/lib/maker-markout/source";
import { MARKOUT_HORIZONS, type MarkoutQuery } from "@/lib/maker-markout/model";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  const p=new URL(request.url).searchParams,horizon=p.get("horizon")||"1s",hours=Number(p.get("hours")||1),level=p.get("level")||"overall",type=p.get("type")||"";
  const headers={"Cache-Control":"no-store"};
  if(!MARKOUT_HORIZONS.includes(horizon as typeof MARKOUT_HORIZONS[number]) || ![1,6,24].includes(hours) || !["overall","exchange","symbol"].includes(level) || !["","rpi","non-rpi","unknown"].includes(type) || [...p.values()].some(v=>v.length>512))return Response.json({error:"Invalid markout filters"},{status:400,headers});
  try{return Response.json(await getMakerMarkout({horizon,hours,level,type,strategy:p.get("strategy")||"",exchange:p.get("exchange")||"",symbol:p.get("symbol")||""} as MarkoutQuery),{headers});}
  catch{return Response.json({error:"Markout data is unavailable; no distribution can be inferred."},{status:503,headers});}
}
