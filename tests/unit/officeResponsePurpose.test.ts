// @vitest-environment node
import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
const {commandHint,ordinaryHint,primaryEstimate}=createRequire(import.meta.url)('../../server/office-response-purpose');
const record=(actions:unknown[]=[],purposeHints:unknown[]=[])=>({linked:true,goalEnabled:true,outputs:[],actions,purposeHints});
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
it('keeps uncertain goal estimates separate from strict identity and current explicit evidence',()=>{
 const prior={purpose:'execution',responseId:'old'},base={purpose:'unknown',reason:'ordinaryOutputSemanticsUnknown'};
 expect(primaryEstimate(record(),base,prior)).toMatchObject({purpose:'execution',confidence:'low',contextResponseId:'old'});
 expect(primaryEstimate({...record(),hasOrdinaryText:true},base,prior)?.confidence).toBe('low');
 expect(primaryEstimate({...record(),outputs:[{status:'failed'}]},base,prior)?.purpose).toBe('execution');
 expect(primaryEstimate({...record(),linked:false},base,prior)?.confidence).toBe('low');
 expect(primaryEstimate({...record(),conflict:true},base,prior)?.confidence).toBe('low');
 expect(primaryEstimate(record(),{...base,reason:'missingParentScope'},prior)?.confidence).toBe('low');
});
it('recognizes concrete work statements without requiring a domain word and causal sentence',()=>{
 expect(ordinaryHint('我先对齐两侧成交的时间、方向、价格和数量，再定位差额。')).toMatchObject({purpose:'execution',reason:'workStatement'});
 expect(ordinaryHint('我会核对两边成交差异。')).toMatchObject({purpose:'execution',reason:'workStatement'});
 expect(ordinaryHint('我会继续处理一下这些事情。')).toBeNull();expect(ordinaryHint('我会检查这些问题，做好这件事。')).toBeNull();
 expect(ordinaryHint('> 我先对齐两侧成交的时间、方向、价格和数量。')).toBeNull();
 expect(ordinaryHint('引用：现在只转告结果，等待经理回复，不继续检查数据。')).toBeNull();
 expect(ordinaryHint('现在只给经理排明天任务，不再调查差额。')?.purpose).toBe('workflow');
 expect(ordinaryHint('现在只转告结果，等待经理回复，不继续检查数据。')?.purpose).toBe('coordination');
});
it('current explicit administration and communication override an inherited work goal',()=>{
 const prior={purpose:'execution',responseId:'old',sourceItemId:'ordinary-goal'};
 expect(primaryEstimate({...record(),outputs:[{callId:'t',tool:'todo_edit'}]}, {purpose:'workflow'},prior).purpose).toBe('workflow');
 expect(primaryEstimate({...record(),outputs:[{callId:'t',tool:'session_send'}]}, {purpose:'coordination'},prior).purpose).toBe('coordination');
 expect(primaryEstimate({...record(),outputs:[{callId:'t',tool:'todo_get'}]}, {purpose:'workflow'},prior)).toMatchObject({purpose:'execution',confidence:'low'});
 expect(primaryEstimate({...record(),linked:false},{purpose:'unknown',reason:'batchBoundaryMissing'})).toBeNull();
});
