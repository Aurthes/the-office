import React from "react";
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import {afterEach,expect,it} from "vitest";
import {appendVoiceCaption,mergeCallTimeline,callTimeline,voiceTimelineGroups} from "@/features/office/components/voiceTranscript";
import {SessionVoiceHistory} from "@/features/office/components/SessionVoice";
afterEach(cleanup);
it('uses item+role identities, not a text set, and keeps every received line',()=>{
 let lines:ReturnType<typeof appendVoiceCaption>=[];
 for(let i=0;i<12;i++)lines=appendVoiceCaption(lines,{id:String(i),role:'user',text:'Same'});
 lines=appendVoiceCaption(lines,{id:'0',role:'assistant',text:'Same'});expect(lines).toHaveLength(13);
 lines=appendVoiceCaption(lines,{id:'0',role:'user',text:'Updated'});expect(lines).toHaveLength(13);expect(lines[0].text).toBe('Updated');
 const long='x'.repeat(10000);expect(appendVoiceCaption(lines,{role:'assistant',text:long}).at(-1)?.text).toBe(long);
});
it('prepends older pages with overlap and keeps a committed tail after earlier live captions',()=>{
 const known={id:'b',role:'assistant',text:'B',committed:true};
 const lines=mergeCallTimeline([known],[{id:'a',role:'user',text:'A',committed:true},known],true);expect(lines.map(p=>p.id)).toEqual(['a','b']);
 expect(mergeCallTimeline([{id:'live',role:'user',text:'Same'}],[{id:'tail',role:'assistant',text:'Tail',committed:true}]).map(p=>p.id)).toEqual(['live','tail']);
 expect(mergeCallTimeline([{role:'user',text:'Same'}],[{id:'canonical',role:'user',text:'Same',committed:true}])).toHaveLength(1);
 expect(mergeCallTimeline([{id:'one',role:'user',text:'Same'}],[{id:'two',role:'user',text:'Same',committed:true}])).toHaveLength(2);
});
it('only matches explicit call IDs and exposes loaded prior dialogue in a separate blue history control',()=>{
 const messages=[{id:'v1',source:'voice' as const,voiceCallId:'one',role:'user',content:'Old dialogue'}, {id:'v2',source:'voice' as const,voiceCallId:'two',role:'assistant',content:'Current dialogue'}, {id:'plain',role:'assistant',content:'Plain final'}];
 expect(callTimeline(messages,'one').map(p=>p.text)).toEqual(['Old dialogue']);expect(callTimeline(messages,'unknown')).toEqual([]);
 render(React.createElement(SessionVoiceHistory,{messages,currentCallId:'two'}));expect(screen.getByText('Old dialogue')).not.toBeVisible();expect(screen.queryByText('Current dialogue')).toBeNull();expect(screen.queryByText('Plain final')).toBeNull();
 fireEvent.click(screen.getByText('Voice conversation history (1)'));fireEvent.click(screen.getByText(/Voice conversation 1/));expect(screen.getByText('Old dialogue')).toBeVisible();
});
it('keeps an already received full segment when bounded history returns only a clipped prefix',()=>{
 const full={id:'item',role:'assistant',text:'Complete speech already received',committed:true};
 expect(mergeCallTimeline([full],[{...full,text:'Complete speech',truncated:true}])[0]).toMatchObject({text:full.text,truncated:false});
 expect(mergeCallTimeline([full],[{...full,text:'Canonical correction'}])[0].text).toBe('Canonical correction');
});

it('separates reused native call IDs by canonical started/closed boundaries, not words or time',()=>{
 const row=(id:string,voiceBoundary?:'started'|'closed')=>({id,source:'voice' as const,voiceCallId:'same-native',voiceItemId:id,voiceBoundary,role:voiceBoundary?'tool':'user',content:voiceBoundary?'':'Again'});
 const messages=[row('first','started'),row('one'),row('close','closed'),row('second','started'),row('two'),row('three')];
 expect(callTimeline(messages,'same-native','first').map(p=>p.id)).toEqual(['one']);expect(callTimeline(messages,'same-native','second').map(p=>p.id)).toEqual(['two','three']);expect(callTimeline(messages,'same-native','unknown')).toEqual([]);
 expect(voiceTimelineGroups(messages).map(g=>g.lines.map(p=>p.id))).toEqual([['one'],['two','three']]);
 render(React.createElement(SessionVoiceHistory,{messages,currentCallId:'same-native',currentBoundaryId:'second'}));expect(screen.getByText('Voice conversation history (1)')).toBeTruthy();
});
