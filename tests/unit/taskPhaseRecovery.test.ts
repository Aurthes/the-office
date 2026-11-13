// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
const { OfficeTodos } = createRequire(import.meta.url)("../../server/office-todos.js");
const roots: string[] = [];afterEach(() => roots.splice(0).forEach(p => rmSync(p,{recursive:true,force:true})));
function fixture() {
 const dir=mkdtempSync(path.join(os.tmpdir(),'phase-recovery-'));roots.push(dir);let now=1000;
 const todos=new OfficeTodos(dir,{now:()=>now,projects:()=>[],agents:()=>['manager','worker'].map(id=>({id,name:id}))});
 const task=todos.create({requestId:'create',title:'Goal',executionMode:'phases',actorId:'manager',ownerId:'manager',phases:[{title:'Technical delivery',assigneeId:'manager'},{title:'Independent acceptance',assigneeId:null}]}).todo;
 const id=task.id,tech=task.phases[0].id,head=task.phases[1].id;
 const change=(extra:object,action='edit')=>todos.change({id,revision:todos.raw(id).revision,actorId:'manager',...extra},action).todo;
 const original=structuredClone(todos.raw(id).phases[1]);
 const remove=()=>change({phases:[todos.raw(id).phases[0]],removedPhaseIds:[head]});
 return {dir,todos,id,tech,head,original,change,remove,tick:()=>now+=1000};
}
it('refuses accidental omissions while retaining full-array old-client edits and unknown-ID rejection',()=>{
 const f=fixture(),before=JSON.stringify(f.todos.raw(f.id));
 expect(()=>f.change({phases:[f.todos.raw(f.id).phases[0]]})).toThrow(/removedPhaseIds/);expect(JSON.stringify(f.todos.raw(f.id))).toBe(before);
 expect(()=>f.change({phases:[{id:crypto.randomUUID(),title:'Unknown'}]})).toThrow(/Phase is missing/);
 const full=f.todos.raw(f.id).phases.map((p:{id:string})=>p.id===f.tech?{...p,title:'Renamed'}:p);
 expect(f.change({phases:full}).phases[0].title).toBe('Renamed');
 for(const ids of [[],[f.tech],[f.head,f.head],['unknown']])expect(()=>f.change({phases:[f.todos.raw(f.id).phases[0]],removedPhaseIds:ids})).toThrow(/removedPhaseIds/);
});
it('preserves current review, reports, execution metadata and Owner when restoring the reviewed legacy receipt by original ID and position',()=>{
 const f=fixture();f.change({phaseId:f.tech,assigneeId:'worker',instructions:'Implement',acceptanceCriteria:''},'delegate');
 f.change({phaseId:f.tech,actorId:'worker'},'start');const handoff=f.todos.raw(f.id).delegations[0].id;
 f.change({phaseId:f.tech,actorId:'worker',handoffId:handoff,report:'Verified evidence'},'submit');f.remove();
 // Only this temporary fixture emulates a pre-fix summary-only deletion.
 delete f.todos.raw(f.id).events.findLast((e:{removedPhase?:unknown})=>e.removedPhase).removedPhase;
 const before=structuredClone(f.todos.raw(f.id));f.tick();
 const restored=f.change({restorePhase:{phase:f.original,index:1,sourceRevision:3,sourceItemId:'official-receipt',sourceReceiptSha256:'a'.repeat(64)}});
 const raw=f.todos.raw(f.id);expect(raw.phases[1]).toEqual(f.original);expect(raw.phases[0]).toEqual(before.phases[0]);
 expect(raw.delegations).toEqual(before.delegations);expect(raw.ownerId).toBe(before.ownerId);expect(raw.status).toBe(before.status);expect(raw.archived).toBe(false);
 expect(restored.phases[0]).toMatchObject({status:'review',handoffId:handoff});expect(raw.events.at(-1).restoredPhase.source).toMatchObject({basis:'reviewedReceipt',sourceRevision:3});
 expect(()=>f.change({restorePhase:{phase:f.original,index:1}})).toThrow(/already exists/);
});
it('restores future deletions only from matching same-task snapshots and is independent of object key order',()=>{
 const f=fixture();f.remove();const event=f.todos.raw(f.id).events.at(-2);expect(event.removedPhase).toEqual({index:1,phase:f.original});
 const reverse=Object.fromEntries(Object.entries(f.original).reverse());expect(f.change({restorePhase:{phase:reverse,index:1}}).phases[1]).toMatchObject(f.original);
});
it.each([
 ['time',{elapsedMs:1}],['started',{startedAt:100}],['completed',{completedAt:100}],['status',{status:'paused'}],['activity',{activity:{agentId:'worker'}}],['identity',{id:crypto.randomUUID()}],['notes',{notes:'Changed original'}],['assignment',{assigneeId:'worker',assigneeName:'worker'}],
])('rejects a restoration with changed %s without partial writes',(_name,patch)=>{
 const f=fixture();f.remove();const before=JSON.stringify(f.todos.raw(f.id));expect(()=>f.change({restorePhase:{phase:{...f.original,...patch},index:1}})).toThrow();expect(JSON.stringify(f.todos.raw(f.id))).toBe(before);
});
it('rejects missing evidence, stale revisions, unknown actors, wrong position and mixed edits',()=>{
 const f=fixture();expect(()=>f.change({restorePhase:{phase:{...f.original,id:crypto.randomUUID()},index:1}})).toThrow(/deletion/);f.remove();
 expect(()=>f.change({restorePhase:{phase:f.original,index:0}})).toThrow(/snapshot/);
 expect(()=>f.change({revision:1,restorePhase:{phase:f.original,index:1}})).toThrow(/changed/);
 expect(()=>f.change({actorId:'unknown',restorePhase:{phase:f.original,index:1}})).toThrow(/existing/);
 expect(()=>f.change({title:'Other',restorePhase:{phase:f.original,index:1}})).toThrow(/separately/);
 delete f.todos.raw(f.id).events.findLast((e:{removedPhase?:unknown})=>e.removedPhase).removedPhase;
 expect(()=>f.change({restorePhase:{phase:f.original,index:1}})).toThrow(/reviewed original receipt/);
});
it('patches only the intended phase, retains sibling and clocks, and cannot bypass assignment/handoff protection',()=>{
 const f=fixture();f.change({phaseId:f.tech},'start');const before=structuredClone(f.todos.raw(f.id));f.tick();f.change({phasePatch:{id:f.tech,notes:'New note'}});
 const raw=f.todos.raw(f.id);expect(raw.phases[1]).toEqual(before.phases[1]);expect(raw.phases[0]).toEqual({...before.phases[0],notes:'New note'});
 expect(()=>f.change({phasePatch:{id:f.tech,assigneeId:'worker'}})).toThrow(/Pause/);
 expect(()=>f.change({phasePatch:{id:f.tech,activity:{} }})).toThrow(/only title/);
 expect(()=>f.change({phasePatch:{id:f.tech,notes:'No'},phases:raw.phases})).toThrow(/separately/);
 expect(()=>f.change({phases:[raw.phases[1]],removedPhaseIds:[f.tech]})).toThrow(/Pause/);
});
it('keeps legacy local patches from resetting a live timer and guards legacy full-plan deletion too',()=>{
 const f=fixture();const t=f.todos.create({requestId:'legacy',title:'Legacy',assigneeId:'worker',phases:[{title:'One'},{title:'Two'}]}).todo;
 let r=f.todos.change({id:t.id,revision:t.revision},'start').todo;const before=structuredClone(f.todos.raw(t.id));f.tick();
 r=f.todos.change({id:t.id,revision:r.revision,phasePatch:{id:r.phases[0].id,notes:'Only this'}},'edit').todo;
 expect(f.todos.raw(t.id).phases[0]).toEqual({...before.phases[0],notes:'Only this'});expect(f.todos.raw(t.id).phases[1]).toEqual(before.phases[1]);
 expect(()=>f.todos.change({id:t.id,revision:r.revision,phases:[r.phases[0]]},'edit')).toThrow(/removedPhaseIds/);
});
it('does not let an explicit deletion list or local patch remove a phase with handoff history',()=>{
 const f=fixture();f.change({phaseId:f.tech,assigneeId:'worker',instructions:'Deliver'},'delegate');
 const before=JSON.stringify(f.todos.raw(f.id));expect(()=>f.change({phases:[f.todos.raw(f.id).phases[1]],removedPhaseIds:[f.tech]})).toThrow(/handoff history/);expect(JSON.stringify(f.todos.raw(f.id))).toBe(before);
});
