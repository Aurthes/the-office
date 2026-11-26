// React lifecycle acceptance: predeclared 1s per async case, synthetic HTTP only.
import React from 'react';
import {it,expect,afterEach,vi} from 'vitest';
import {act,render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {DepartmentLibrary} from '../../src/features/ring-ship/DepartmentLibrary';
import {SessionPreviewContext} from '../../src/features/office/components/SessionPreviewContext';
import {SessionAssetPreview} from '../../src/features/office/components/SessionMarkdown';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('old same-name archives expose real distinct titles, open permanent copies and retain download',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({entries:[{id:'a',name:'index.html',title:'First report',previewKind:'html',kind:'file',createdAt:'2026-11-26'}, {id:'b',name:'index.html',title:'Second report',previewKind:'html',kind:'file',createdAt:'2026-11-26'}]})));
 const open=vi.fn();render(React.createElement(SessionPreviewContext.Provider,{value:open},React.createElement(DepartmentLibrary,{departmentId:'dept-a'})));
 fireEvent.click(await screen.findByRole('button',{name:'Second report'}));expect(open).toHaveBeenCalledWith(expect.objectContaining({name:'Second report',archived:true,url:'/api/office/department-library/dept-a/b',kind:'html'}));expect(screen.getAllByRole('link',{name:'Download'})[1]).toHaveAttribute('href','/api/office/department-library/dept-a/b');
},1000);
it('department changes hide old entries and ignore late collection replies',async()=>{
 let resolve!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith('dept-a')?new Promise(r=>resolve=r):Promise.resolve(Response.json({entries:[]}))));
 const v=render(React.createElement(DepartmentLibrary,{departmentId:'dept-a'}));v.rerender(React.createElement(DepartmentLibrary,{departmentId:'dept-b'}));await screen.findByText('This library is empty.');await act(async()=>resolve(Response.json({entries:[{id:'a',name:'stale'}]})));expect(screen.queryByText('stale')).toBeNull();
},1000);
it('archived text uses escaped plain text, correct JSON query and no resave control',async()=>{
 const fetch=vi.fn(async()=>Response.json({content:'<script>not executable</script>',assets:[]}));vi.stubGlobal('fetch',fetch);
 render(React.createElement(SessionAssetPreview,{embedded:true,onClose:()=>{},asset:{kind:'markdown',plainText:true,archived:true,name:'Text',source:'library:a',url:'/api/office/department-library/dept/a'}}));
 await waitFor(()=>expect(screen.getByText('<script>not executable</script>')).toBeVisible());expect(fetch).toHaveBeenCalledWith('/api/office/department-library/dept/a?format=json',expect.anything());expect(screen.queryByText('Save to Library')).toBeNull();expect(document.querySelector('pre script')).toBeNull();
},1000);
