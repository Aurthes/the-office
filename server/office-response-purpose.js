"use strict";
const PURPOSES=["execution","coordination","workflow","mixed"];
const REASONS=["codeStructure","dataAnalysisStructure","technicalAnswer","coordinationReceipt","workflowContent","currentActions","sameTurnContinuation"];
// A bounded transient projection. No literals, paths, text or commands leave it.
function shape(text) {
  let code="",literals="",i=0;
  while(i<text.length){const c=text[i];
    if(c==="#"){while(i<text.length&&text[i]!=="\n")i++;code+="\n";continue;}
    if(c==='"'||c==="'"||c==="`"){const q=c,end=text.slice(i,i+3)===q.repeat(3)?q.repeat(3):q;i+=end.length;const start=i;while(i<text.length){if(text[i]==="\\"){i+=2;continue;}if(text.slice(i,i+end.length)===end)break;i++;}literals+=text.slice(start,i)+"\n";i+=end.length;code+=" _ ";}else{code+=c;i++;}}
  return {code,literals};
}
function commandHint(command) {
  if(Array.isArray(command)){if(command.length>128||command.some(x=>typeof x!=="string")||command.reduce((n,x)=>n+x.length,0)>65536)return null;if(command.length===3&&["sh","bash","zsh"].includes(command[0]?.split("/").pop())&&["-c","-lc"].includes(command[1]))command=command[2];else command=command.filter(x=>typeof x==="string").join(" ");}
  if(typeof command!=="string"||command.length>65536)return null;
  const {code,literals}=shape(command);
  // Current, explicit code-writing invocation plus code structure. Merely
  // printing/quoting a program or writing scheduling JSON is not this evidence.
  const heredocWriter=/(?:^|\n)\s*cat\s+(?:>[^\n]*<<|<<[^\n]*>)/.test(code);
  const writer=/\.(?:write_text|write_bytes|writeFileSync|writeFile)\s*\(/.test(code)||heredocWriter;
  const program=/\b(?:def\s+\w+\s*\(|class\s+\w+\s*[:(]|function\s*\w*\s*\(|(?:const|let)\s+\w+\s*=)|\b(?:np|numpy)\.(?:array|asarray|mean|std|quantile|isfinite)\s*\(/.test(literals+(heredocWriter?"\n"+code:""));
  if(writer&&program)return {purpose:"execution",reason:"codeStructure"};
  if(/(?:^|[\n;&|])\s*git\s+(?:[^\n;&|]{0,200}\s)?(?:status|diff|show|log|commit|push|worktree|rev-parse)\b/.test(code))return {purpose:"execution",reason:"codeStructure"};
  const read=/\.(?:readFileSync|readFile|read_text)\s*\(/.test(code),parse=/\bJSON\.parse\s*\(|\bjson\.loads?\s*\(/.test(code),project=/\.(?:filter|map|reduce|sort)\s*\(/.test(code);
  if(read&&parse&&project)return {purpose:"execution",reason:"dataAnalysisStructure"};
  return null;
}
function ordinaryHint(text) {
  if(typeof text!=="string"||text.length>32768)return null;
  // Do not turn a quotation, code example, or acknowledgement of future work
  // into evidence that this response performed technical analysis.
  const visible=text.replace(/```[\s\S]*?```/g,"").replace(/^\s*>.*$/gm,"").replace(/[“「『][^”」』]*[”」』]/g,"").replace(/"[^"\n]*"/g,"").trim();
  if(!visible)return null;
  const handoff=/(?:转告|转交|交接|提交(?:给|至)|等待.{0,16}(?:回复|返回|验收)|已收到|收到[，。!！]|acknowledged|hand(?:ed)? off|forward(?:ed|ing)? to|waiting for|submitted to)/i.test(visible);
  const technical=/(?:代码|源码|凭据|配置|兼容|格式|缓存|接口|参数|算法|公式|误差|样本|统计|测试|编译|部署|权限|认证|延迟|credential|configuration|schema|cache|function|algorithm|variance|regression|compile|authentication|latency|\bAPI\b|\bJSON\b)/i.test(visible);
  const explanation=/(?:因为|因此|所以|只有|如果|否则|不需要|不必|无需|不能|并不|应该先|先.{0,12}(?:确认|核对|检查)|because|therefore|only if|otherwise|does not|must not|incompatible|compatible|rather than)/i.test(visible);
  const concrete=visible.length>=35&&/[。；;.!！\n]/.test(visible);
  if(technical&&explanation&&concrete&&!/^(?:引用|原文|他说|she said|quoted)/i.test(visible))return {purpose:handoff?"mixed":"execution",reason:"technicalAnswer"};
  if(handoff)return {purpose:"coordination",reason:"coordinationReceipt"};
  if(/(?:排期|日程|任务台账|schedule|task record)/i.test(visible)&&/(?:新增|调整|删除|更新|设为|create|update|remove)/i.test(visible))return {purpose:"workflow",reason:"workflowContent"};
  return null;
}
function cleanHint(v){return v&&PURPOSES.includes(v.purpose)&&REASONS.includes(v.reason)?{purpose:v.purpose,reason:v.reason}:null;}
function primaryEstimate(record, base, prior=null) {
  if(!record?.linked||record.conflict||record.truncated||["missingParentScope","pendingCell","genericExecWithoutActions"].includes(base.reason))return null;
  const substantive=new Set(),hints=[...(record.purposeHints||[]),...record.actions.map(a=>a.hint)].map(cleanHint).filter(Boolean);
  for(const h of hints)substantive.add(h.purpose);
  for(const a of record.actions){
    if(a.category==="unknown")continue;
    if(a.category==="workflow"&&["curr_time","sleep","schedule_list","todo_get","todo_list","question_context"].includes(a.tool))continue;
    substantive.add(a.category);
  }
  if(!substantive.size&&base.purpose!=="unknown")substantive.add(base.purpose);
  if(substantive.size){const purpose=substantive.size>1||substantive.has("mixed")?"mixed":[...substantive][0];
    const unchanged=purpose===base.purpose&&!hints.length;
    return {purpose,confidence:unchanged&&base.purposeBasis!=="static-inferred"?"high":"medium",reason:hints[0]?.reason||"currentActions",purposeBasis:unchanged?base.purposeBasis:"static-inferred",contextResponseId:null};
  }
  const failed=record.outputs.some(o=>["failed","terminated"].includes(o.status))||record.actions.some(a=>["failed","terminated"].includes(a.status));
  if(!record.hasOrdinaryText&&!failed&&prior&&PURPOSES.includes(prior.purpose))return {purpose:prior.purpose,confidence:"low",reason:"sameTurnContinuation",purposeBasis:"static-inferred",contextResponseId:prior.responseId};
  return null;
}
module.exports={commandHint,ordinaryHint,cleanHint,primaryEstimate};
