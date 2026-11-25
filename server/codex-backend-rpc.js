"use strict";
const WebSocket=require("ws");
const {loadUpstreamGatewaySettings}=require("./studio-settings");
function backendRpc(method,params={},settings=loadUpstreamGatewaySettings()){
 return new Promise((resolve,reject)=>{
  const url=new URL(settings.url);
  if(!["ws:","wss:"].includes(url.protocol)||!["127.0.0.1","localhost","[::1]"].includes(url.hostname)||url.username||url.password||url.search||url.hash||!settings.token) return reject(new Error("Managed Office backend unavailable"));
  const ws=new WebSocket(url,{maxPayload:262144,handshakeTimeout:4000,followRedirects:false});let done=false;
  const finish=(e,value)=>{if(done)return;done=true;clearTimeout(timer);ws.terminate();if(e)reject(e);else resolve(value);};
  const timer=setTimeout(()=>finish(new Error("Backend status timed out")),5000);
  ws.on("open",()=>ws.send(JSON.stringify({type:"req",id:"connect",method:"connect",params:{auth:{token:settings.token}}})));
  ws.on("error",e=>finish(e));ws.on("close",()=>finish(new Error("Backend connection closed")));
  ws.on("message",raw=>{try{const f=JSON.parse(raw);if(f.type!=="res")return;if(!f.ok)return finish(new Error(f.error?.message||"Backend operation rejected"));if(f.id==="connect")ws.send(JSON.stringify({type:"req",id:"operation",method,params}));else if(f.id==="operation")finish(null,f.payload);}catch(e){finish(e);}});
 });
}
module.exports={backendRpc};
