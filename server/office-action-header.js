"use strict";
// Project only structural identity fields from a bounded, possibly incomplete
// JSON prefix. Keys inside strings/arguments/results are never mistaken for headers.
function actionHeader(text) {
  if(typeof text!=="string"||text.length>65536)return null;
  const out={payload:{item:{}}};let i=0,steps=0;
  const keep=new Set(["payload.type","payload.turn_id","payload.item.type","payload.item.id","payload.item.server","payload.item.tool","payload.item.status"]);
  const space=()=>{while(/\s/.test(text[i]||"x"))i++;};
  function string(){const start=i++;while(i<text.length){if(text[i]==="\\"){i+=2;continue;}if(text[i++]==='"')return i-start<=1024?JSON.parse(text.slice(start,i)):null;}throw Error("incomplete");}
  function value(route,depth){if(depth>16||++steps>8192)throw Error("limit");space();
    if(text[i]==='"'){const s=string();if(keep.has(route)&&typeof s==="string"&&/^[a-zA-Z0-9_.:/-]{1,256}$/.test(s)){const p=route.split(".");let v=out;for(const key of p.slice(0,-1))v=v[key]||=( {} );v[p.at(-1)]=s;}return;}
    if(text[i]==="{"){i++;space();while(text[i]!=="}"){if(text[i]!=='"')throw Error("invalid");const k=string();space();if(text[i++]!==":")throw Error("invalid");value(route?`${route}.${k}`:k,depth+1);space();if(text[i]!==",")break;i++;space();}if(text[i++]!=="}")throw Error("incomplete");return;}
    if(text[i]==="["){i++;space();while(text[i]!=="]"){value(`${route}[]`,depth+1);space();if(text[i]!==",")break;i++;space();}if(text[i++]!=="]")throw Error("incomplete");return;}
    const m=/^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i,i+64));if(!m)throw Error("invalid");i+=m[0].length;
  }
  try{value("",0);}catch{/* A large result may end the prefix after valid headers. */}
  const p=out.payload;
  return p.type==="item_completed"&&p.turn_id&&p.item.type==="McpToolCall"&&p.item.id&&p.item.server&&p.item.tool?out:null;
}
module.exports={actionHeader};
