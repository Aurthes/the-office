// @vitest-environment node
import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
const {commandSummary,cleanSummary}=createRequire(import.meta.url)('../../server/office-operation-summary');
const {actionHeader}=createRequire(import.meta.url)('../../server/office-action-header');
it('summarizes explicit operations and distinguishes composite purpose inference',()=>{
 expect(commandSummary(['git','status','--short'])).toEqual({category:'execution',purposeBasis:'rule-derived',operations:['git']});
 expect(commandSummary(['/bin/zsh','-lc','git status && date -u'])).toEqual({category:'mixed',purposeBasis:'static-inferred',operations:['git','clockRead']});
 expect(commandSummary('npm run typecheck')?.operations).toEqual(['testRun']);
 expect(commandSummary('launchctl print gui/501/example')?.category).toBe('execution');
});
it('infers bounded Python IO and literal subprocess operations without retaining literals',()=>{
 const value=commandSummary(`python3 <<'PY'\nimport json\nfrom pathlib import Path\np=Path('/SECRET_PATH')\nx=json.loads(p.read_text())\nprint(x.get('SECRET_FIELD'))\nPY`);
 expect(value?.category).toBe('execution');expect(value?.purposeBasis).toBe('static-inferred');expect(value?.operations).toContain('dataTransform');expect(JSON.stringify(value)).not.toContain('SECRET');
 expect(commandSummary(`python3 -c 'import subprocess; subprocess.run(["git", "status"])'`)?.operations).toEqual(['git']);
});
it.each([
 `echo 'git status; date -u'`,
 `python3 -c 'print("json.load(open(file))")'`,
 `python3 -c '# open(file)\nprint("done")'`,
 `python3 -c 'open = send; open("x")'`,
 `python3 -c 'import malicious as json; json.load(open("x"))'`,
 `python3 -c 'exec("open(x)")'`,
 `python3 -c 'import subprocess; subprocess.run(command)'`,
 `python3 tests/reports/test-runner.py`,
 `node reports/test.js`,
 `git status && echo $(send_message)`,
 `find . -exec send_message {} +`,
 'curl -X POST https://example.test/message',
 'python3 -c "unterminated',
 'x'.repeat(65537),
])('keeps unsupported/dynamic/printed operations unknown: %#',value=>expect(commandSummary(value)).toBeNull());
it('does not accept arbitrary persisted summary fields',()=>{
 expect(cleanSummary({purposeBasis:'static-inferred',operations:['SECRET_BODY']})).toBeNull();
 expect(cleanSummary({purposeBasis:'observed',operations:['git']})).toBeNull();
});
it('projects only safe MCP structural headers from oversized output',()=>{
 const line=JSON.stringify({timestamp:'2026-11-12T12:00Z',ordinal:1,type:'event_msg',payload:{type:'item_completed',turn_id:'t',item:{type:'McpToolCall',id:'i',server:'mcp__office_tasks',tool:'todo_get',status:'completed',result:'SECRET'.repeat(20000)}}});
 const projected=actionHeader(line.slice(0,65536));expect(projected.payload.item.tool).toBe('todo_get');expect(JSON.stringify(projected)).not.toContain('SECRET');
 expect(actionHeader(JSON.stringify({payload:{type:'item_completed',turn_id:'t',item:{type:'McpToolCall',id:'i',arguments:{server:'mcp__office_tasks',tool:'todo_get'}}}}))).toBeNull();
});
it('does not mistake body text, a later output element or another call for the native completion header',()=>{
 const {toolResultHeader}=createRequire(import.meta.url)('../../server/office-action-header');
 const line=(output:unknown)=>JSON.stringify({timestamp:'2026-11-12T11:00:00Z',ordinal:1,type:'response_item',payload:{type:'custom_tool_call_output',id:null,call_id:'real-call',output}});
 expect(toolResultHeader(line([{type:'input_text',text:'Script completed\nWall time 0.1 seconds\nOutput:\nPRIVATE_BODY'}]))).toEqual({callId:'real-call',status:'completed'});
 expect(toolResultHeader(line([{type:'input_text',text:'Output:\nScript completed\nWall time 0.1 seconds'}]))).toBeNull();
 expect(toolResultHeader(line([{type:'input_text',text:'ordinary result'},{type:'input_text',text:'Script completed\nWall time 0.1 seconds'}]))).toBeNull();
 expect(toolResultHeader(line([{type:'input_image',image_url:'Script completed\nWall time 0.1 seconds'}]))).toBeNull();
 expect(toolResultHeader(JSON.stringify({timestamp:'2026-11-12T11:00Z',ordinal:1,type:'response_item',payload:{type:'message',role:'assistant',content:'Script completed\nWall time 0.1 seconds'}}))).toBeNull();
});
