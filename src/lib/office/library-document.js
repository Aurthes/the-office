"use strict";
const clean = value => value.replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const code = parseInt(n[0].toLowerCase()==='x'?n.slice(1):n,n[0].toLowerCase()==='x'?16:10); return code>0&&code<=0x10ffff?String.fromCodePoint(code):''; }).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n.toLowerCase()]).replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
function documentInfo(name, content) {
  const extension = name.toLowerCase().split('.').pop();
  const kind = ['html','htm'].includes(extension)?'html':['md','markdown'].includes(extension)?'markdown':['txt','text'].includes(extension)?'text':null;
  if(!kind||content.includes('\0'))return {};
  let title;
  if(kind==='html') {
    const heading=content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    const tag=content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    title=clean(tag||'');if(!title||/^(index|untitled|document)$/i.test(title))title=clean(heading||tag||'');
  } else title=clean(content.split(/\r?\n/).find(line=>line.trim()&&(!/^---\s*$/.test(line)))?.replace(/^#{1,6}\s+/,'')||'');
  return {previewKind:kind,...(title?{title}:{})};
}
function documentName(name, content) {
  const {title}=documentInfo(name,content);
  if(!title)return name;
  const extension=name.split('.').pop();
  const stem=title.replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim().slice(0,64);
  return stem ? stem+'.'+extension : name;
}
module.exports={documentInfo,documentName};
