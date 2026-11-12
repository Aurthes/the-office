"use strict";
// Commands are inspected only in memory. Nothing returned by this module contains
// arguments, paths, literals, source text, or results. This is purpose estimation,
// never a claim that an invoked script completed its intended downstream effects.
const KINDS = Object.freeze({
  git: "execution", fileAccess: "execution", fileRead: "execution", fileWrite: "execution",
  fileSearch: "execution", fileList: "execution", dataTransform: "execution",
  testRun: "execution", buildRun: "execution", processInspect: "execution",
  clockRead: "workflow", processWait: "workflow",
});
const BASIS = ["rule-derived", "static-inferred"];
function summary(operations, inferred = false) {
  const kinds = [...new Set(operations)].filter(k => Object.hasOwn(KINDS,k));
  if (!kinds.length) return null;
  const purposes = new Set(kinds.map(k=>KINDS[k]));
  return {category:purposes.size>1?"mixed":[...purposes][0],purposeBasis:inferred?"static-inferred":"rule-derived",operations:kinds};
}
function cleanSummary(v) {
  if (!v || !BASIS.includes(v.purposeBasis) || !Array.isArray(v.operations) || v.operations.length>16 || v.operations.some(k=>!Object.hasOwn(KINDS,k))) return null;
  return summary(v.operations,v.purposeBasis==="static-inferred");
}
// Bounded shell tokenization, deliberately no shell evaluation. Substitutions and
// indirect execution are unknown; quoting prevents printed code becoming evidence.
function shellTokens(source) {
  const tokens=[];let value="",quote=null,started=false,dynamic=false;
  const flush=()=>{if(started)tokens.push({value,dynamic});value="";started=false;dynamic=false;};
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(quote){if(c===quote){quote=null;continue;}if(c==="\\"&&quote==='"'&&i+1<source.length){value+=source[++i];continue;}if(quote==='"'&&(c==="$"||c==="`"))dynamic=true;value+=c;continue;}
    if(c==='"'||c==="'"){quote=c;started=true;continue;}
    if(c==="\\"&&i+1<source.length){started=true;value+=source[++i];continue;}
    if(c==="#"&&!started){while(i<source.length&&source[i]!=="\n")i++;flush();tokens.push({op:";"});continue;}
    if(c==="$"||c==="`")dynamic=true;
    if(/\s/.test(c)){flush();if(c==="\n")tokens.push({op:";"});}
    else if(";&|<>".includes(c)){flush();let op=c;if(source[i+1]===c||c==="&"&&source[i+1]===">"||c===">"&&source[i+1]==="&")op+=source[++i];tokens.push({op});}
    else {value+=c;started=true;}
    if(tokens.length>2048)return null;
  }
  if(quote)return null;flush();return tokens;
}
// Only a small, explicit family of data/file/test operations. Strings/comments
// are removed before looking for calls. Dynamic/imported arbitrary programs do
// not acquire a purpose just because their filename mentions tests or reports.
function scriptSummary(source, language, depth) {
  if(source.length>32768)return null;
  let code="",i=0; const literals=[];
  while(i<source.length){const c=source[i];
    if(c==="#"&&language==="python"){while(i<source.length&&source[i]!=="\n")i++;code+="\n";continue;}
    if(c==='"'||c==="'"||c==="`") {const start=i, q=c, triple=source.slice(i,i+3)===q.repeat(3),end=triple?q.repeat(3):q;i+=end.length;let closed=false;while(i<source.length){if(source[i]==="\\"){i+=2;continue;}if(source.slice(i,i+end.length)===end){i+=end.length;closed=true;break;}i++;}if(!closed)return null;const raw=source.slice(start+end.length,i-end.length);const literal=!triple&&!raw.includes("\\")?raw:null;literals.push(literal);code+=` __L${literals.length-1}__ `;continue;}
    code+=c;i++;
  }
  if(/\b(?:eval|exec|compile|__import__|globals|locals)\s*\(/.test(code))return null;
  // Rebinding these standard names makes the structural evidence unreliable.
  if(/\b(?:json|pathlib|subprocess|unittest|pytest|open|print|Path)\s*=|\bdef\s+(?:open|print|Path)\b|\bas\s+(?:json|pathlib|subprocess|unittest|pytest|open|print|Path)\b/.test(code))return null;
  const ops=[];
  if(language==="python") {
    if(/\bopen\s*\(/.test(code))ops.push("fileAccess");
    if(/\.(?:read_text|read_bytes)\s*\(/.test(code))ops.push("fileRead");
    if(/\.(?:write_text|write_bytes)\s*\(/.test(code))ops.push("fileWrite");
    if(/\bjson\.(?:load|loads|dump|dumps)\s*\(/.test(code))ops.push("dataTransform");
    if(/\b(?:unittest\.main|pytest\.main)\s*\(/.test(code))ops.push("testRun");
    if(/\.(?:glob|rglob|iterdir)\s*\(/.test(code))ops.push("fileList");
    const subcalls=[...code.matchAll(/\bsubprocess\.(?:run|Popen|check_output|check_call|call)\s*\(\s*(\[(?:\s*__L\d+__\s*,?)*\s*\]|__L\d+__)\s*[,)]/g)];
    const subCount=[...code.matchAll(/\bsubprocess\.(?:run|Popen|check_output|check_call|call)\s*\(/g)].length;
    if(subcalls.length!==subCount||/\bos\.(?:system|exec\w*|spawn\w*)\s*\(/.test(code))return null;
    for(const m of subcalls){const values=[...m[1].matchAll(/__L(\d+)__/g)].map(x=>literals[+x[1]]);if(values.some(x=>typeof x!=="string"))return null;const child=commandSummary(m[1][0]==="["?values:values[0],depth+1);if(!child)return null;ops.push(...child.operations);}
    const calls=[...code.matchAll(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g)].map(m=>m[1]);
    const allowed=/^(?:open|print|len|str|int|float|bool|list|dict|set|tuple|sorted|enumerate|range|zip|sum|min|max|round|isinstance|Path|pathlib\.Path|json\.(?:load|loads|dump|dumps)|unittest\.main|pytest\.main|subprocess\.(?:run|Popen|check_output|check_call|call))$/;
    const methods=/\.(?:read_text|read_bytes|write_text|write_bytes|glob|rglob|iterdir|get|items|keys|values|join|split|strip|replace|append|extend|exists|is_file|is_dir|mkdir|resolve)$/;
    if(calls.some(c=>!allowed.test(c)&&!methods.test(c)))return null;
  } else return null;
  return summary(ops,true);
}
function commandSummary(source, depth=0) {
  if(depth>6)return null;
  if(Array.isArray(source)) {
    if(!source.length||source.length>128||source.some(x=>typeof x!=="string")||source.reduce((n,x)=>n+x.length,0)>65536)return null;
    if(["sh","bash","zsh"].includes(source[0].split("/").pop())&&["-c","-lc"].includes(source[1])&&source.length===3)return commandSummary(source[2],depth+1);
    source=source.map(x=>"\'"+x.replaceAll("\'", "\'\"\'\"\'")+"\'").join(" ");
  }
  if(typeof source!=="string"||!source.length||source.length>65536)return null;
  // A literal heredoc is a bounded script argument, not shell commands.
  const scripts=[];
  source=source.replace(/<<\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n([\s\S]*?)\n\2(?=\n|$)/g,(_all,_q,_tag,body)=>{scripts.push(body);return ` __OFFICE_SCRIPT_${scripts.length-1}__ `;});
  if(source.includes("<<"))return null;
  const tokens=shellTokens(source);if(!tokens)return null;
  const groups=[];let group=[];
  for(let i=0;i<tokens.length;i++){const token=tokens[i];if(token.op&&[";","&&","||","|","&"].includes(token.op)){if(group.length)groups.push(group);group=[];}else if(token.op){if(![">",">>","<","2>"].includes(token.op)||!tokens[++i]?.value)return null;}else group.push(token);}
  if(group.length)groups.push(group);let inferred=groups.length>1,ops=[];
  for(let words of groups){while(words.length&&/^[A-Za-z_]\w*=/.test(words[0].value))words=words.slice(1);if(!words.length)continue;
    const [first,...rest]=words;if(words.some(t=>t.dynamic))return null;const cmd=first.value.split("/").pop(),args=rest.map(t=>t.value);
    if(["cd","true",":"].includes(cmd))continue;
    if(["echo","printf"].includes(cmd))continue;
    if(cmd==="git") {let n=0;while(n<args.length&&args[n].startsWith("-")){if(["-C","-c","--git-dir","--work-tree"].includes(args[n]))n+=2;else n++;}if(!["status","log","show","diff","rev-parse","worktree","ls-files","branch","add","commit","merge","checkout","switch","fetch","push"].includes(args[n]))return null;ops.push("git");}
    else if(["cat","head","tail","wc","stat","du","sed"].includes(cmd))ops.push("fileRead");
    else if(["rg","grep","find"].includes(cmd)){if(cmd==="find"&&args.some(x=>["-exec","-execdir","-ok","-okdir"].includes(x)))return null;ops.push("fileSearch");}
    else if(["ls","pwd"].includes(cmd))ops.push("fileList");
    else if(["date"].includes(cmd))ops.push("clockRead");
    else if(["sleep","wait"].includes(cmd))ops.push("processWait");
    else if(["ps","pgrep","launchctl"].includes(cmd)){if(cmd==="launchctl"&&!["print","list","blame","procinfo"].includes(args[0]))return null;ops.push("processInspect");}
    else if(["mkdir","cp","mv","touch","rm"].includes(cmd))ops.push("fileWrite");
    else if(["python","python3"].includes(cmd)) {
      let s=null;const heredoc=args.find(a=>/^__OFFICE_SCRIPT_\d+__$/.test(a));
      if(heredoc)s=scriptSummary(scripts[Number(heredoc.match(/\d+/)[0])],"python",depth);
      else if(args[0]==="-c"&&!rest[1]?.dynamic)s=scriptSummary(args[1]||"","python",depth);
      else if(args[0]==="-m"&&["pytest","unittest"].includes(args[1]))s=summary(["testRun"]);
      if(!s)return null;ops.push(...s.operations);inferred=true;
    } else if(["npm","npx"].includes(cmd)) {if(cmd==="npx"&&["vitest","playwright","tsc","eslint"].includes(args[0])||cmd==="npm"&&(args[0]==="test"||args[0]==="run"&&["test","typecheck","lint"].includes(args[1])))ops.push("testRun");else if(cmd==="npm"&&args[0]==="run"&&["build","build:office"].includes(args[1]))ops.push("buildRun");else return null;}
    else return null;
    if(words.some(t=>t.dynamic))return null;
  }
  return summary(ops,inferred);
}
module.exports={commandSummary,cleanSummary,KINDS};
