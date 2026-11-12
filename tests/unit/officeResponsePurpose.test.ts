// @vitest-environment node
import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
const {commandHint,ordinaryHint,primaryEstimate}=createRequire(import.meta.url)('../../server/office-response-purpose');
const record=(actions:unknown[]=[],purposeHints:unknown[]=[])=>({linked:true,outputs:[],actions,purposeHints});
it('uses current substance rather than unknown child veto or incidental clock',()=>{
 const value=record([{category:'execution',tool:'read_file'},{category:'unknown',tool:'opaque'},{category:'workflow',tool:'curr_time'}]);
 expect(primaryEstimate(value,{purpose:'unknown',reason:'actionSemanticsUnknown'})).toMatchObject({purpose:'execution',confidence:'medium',reason:'currentActions'});
 expect(primaryEstimate(record([{category:'execution',tool:'read_file'},{category:'coordination',tool:'todo_submit'}]),{purpose:'mixed'}).purpose).toBe('mixed');
 expect(primaryEstimate(record([{category:'execution',tool:'read_file'},{category:'workflow',tool:'schedule_update'}]),{purpose:'mixed'}).purpose).toBe('mixed');
});
it('treats a technical answer as work but handoff as current coordination',()=>{
 expect(ordinaryHint('配置格式兼容时不需要转换。应该先检查认证配置，因为额外转换会改变现有凭据的读取方式。')).toEqual({purpose:'execution',reason:'technicalAnswer'});
 const h=ordinaryHint('已收到，等待 Head 返回验收结果。');expect(h?.purpose).toBe('coordination');
 expect(primaryEstimate(record([],[h]),{purpose:'unknown'},{purpose:'execution',responseId:'old'}).purpose).toBe('coordination');
});
it.each([
 '引用：“配置格式兼容时不需要转换，因为改变格式会使凭据读取失败。”',
 'He said "the configuration is compatible because the credential format does not change."',
 '```js\nconst json = configuration; // because authentication is compatible\n```',
 '代码',
])('does not infer technical work from quoted or isolated terms %#',s=>expect(ordinaryHint(s)).toBeNull());
it('infers operations only from effective structure, not printed program or scheduling JSON',()=>{
 expect(commandHint(`node <<'JS'\nconst x=JSON.parse(fs.readFileSync('x'));const rows=x.filter(r=>r.ok);fs.writeFileSync('y',JSON.stringify(rows));\nJS`)).toEqual({purpose:'execution',reason:'dataAnalysisStructure'});
 expect(commandHint(`node -e "console.log('const x=np.mean(a); fs.writeFileSync(x,y)')"`)).toBeNull();
 expect(commandHint(`node <<'JS'\nconst invocations=[1,2];fs.writeFileSync('calendar',JSON.stringify({invocations}));\nJS`)).toBeNull();
 expect(commandHint(`python3 -c 'print("np.mean(a); p.write_text(x)")'`)).toBeNull();
});
it('does not use prior purpose over current unknown ordinary text, failure, missing identity or conflicts',()=>{
 const prior={purpose:'execution',responseId:'old'},base={purpose:'unknown',reason:'ordinaryOutputSemanticsUnknown'};
 expect(primaryEstimate(record(),base,prior)).toMatchObject({purpose:'execution',confidence:'low',contextResponseId:'old'});
 expect(primaryEstimate({...record(),hasOrdinaryText:true},base,prior)).toBeNull();
 expect(primaryEstimate({...record(),outputs:[{status:'failed'}]},base,prior)).toBeNull();
 expect(primaryEstimate({...record(),linked:false},base,prior)).toBeNull();
 expect(primaryEstimate({...record(),conflict:true},base,prior)).toBeNull();
 expect(primaryEstimate(record(),{...base,reason:'missingParentScope'},prior)).toBeNull();
});
