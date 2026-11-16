import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultStudioSettings, mergeStudioSettings, sanitizeStudioSettings, type StudioSettingsPatch } from "@/lib/studio/settings";
import { StudioSettingsCoordinator } from "@/lib/studio/coordinator";
import { legacyExperience, useExperiencePreferences } from "@/features/ring-ship/useExperiencePreferences";
import { MusicPlayerDialog } from "@/features/ring-ship/MusicPlayerDialog";
import type { ExperienceController } from "@/features/ring-ship/useExperiencePreferences";
const roots: StudioSettingsCoordinator[]=[];
afterEach(()=>{cleanup();roots.splice(0).forEach(c=>c.dispose());vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
beforeEach(()=>{
 localStorage.clear();vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,"load").mockImplementation(()=>{});
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
});
function store(initial=defaultStudioSettings()){
 let value=initial;const writes:StudioSettingsPatch[]=[];
 const transport={fetchSettings:vi.fn(async()=>({settings:sanitizeStudioSettings(value)})),updateSettings:vi.fn(async(p:StudioSettingsPatch)=>{writes.push(p);value=mergeStudioSettings(value,p);return{settings:sanitizeStudioSettings(value)};})};const coordinator=new StudioSettingsCoordinator(transport);roots.push(coordinator);return{coordinator,transport,writes,get:()=>value};
}
it("does not invent migration values, and server receives only truly missing legacy leaves",async()=>{
 expect(legacyExperience("lobby")).toEqual({});localStorage.setItem("claw3d:music:provider","local");localStorage.setItem("claw3d:music:local:last-track","one");localStorage.setItem("claw3d:star-system:lobby","blue-nebula");
 const f=store(mergeStudioSettings(defaultStudioSettings(),{experience:{galaxy:"black-hole",music:{provider:"netease",volume:0}}}));
 const h=renderHook(()=>useExperiencePreferences(f.coordinator,true));await waitFor(()=>expect(h.result.current.ready).toBe(true));expect(h.result.current.value).toEqual({galaxy:"black-hole",music:{provider:"netease",volume:0}});expect(f.writes).toHaveLength(0);
});
it("coalesces music leaves and prevents a late bootstrap read from undoing explicit changes",async()=>{
 const f=store();let resolve!:(v:{settings:ReturnType<typeof sanitizeStudioSettings>})=>void;f.transport.fetchSettings.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const h=renderHook(()=>useExperiencePreferences(f.coordinator,true));
 act(()=>h.result.current.patch({music:{volume:.37}}));resolve({settings:sanitizeStudioSettings(defaultStudioSettings())});await waitFor(()=>expect(h.result.current.ready).toBe(true));await waitFor(()=>expect(f.get().experience?.music?.volume).toBe(.37));expect(h.result.current.value.music?.volume).toBe(.37);
 act(()=>{h.result.current.patch({music:{provider:"local"}});h.result.current.patch({galaxy:"black-hole"});});await waitFor(()=>expect(f.get().experience?.galaxy).toBe("black-hole"));expect(f.get().experience?.music).toEqual({volume:.37,provider:"local"});
});
it("keeps failed-save choices, retries fresh state and writes only explicit leaves",async()=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});const f=store();const h=renderHook(()=>useExperiencePreferences(f.coordinator,true));await waitFor(()=>expect(h.result.current.ready).toBe(true));f.transport.updateSettings.mockRejectedValueOnce(Error("offline"));
 act(()=>h.result.current.patch({music:{volume:.64}}));await waitFor(()=>expect(h.result.current.error).toContain("could not sync"));act(()=>h.result.current.retry());await waitFor(()=>expect(h.result.current.error).toBe(""));expect(f.get().experience?.music?.volume).toBe(.64);expect(f.transport.fetchSettings).toHaveBeenCalledTimes(2);
});
it("merges coordinator batching and preserves explicit values over older read responses",async()=>{
 const f=store();let resolve!:(v:{settings:ReturnType<typeof sanitizeStudioSettings>})=>void;f.transport.fetchSettings.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const old=f.coordinator.loadSettings({force:true});
 f.coordinator.schedulePatch({experience:{music:{volume:0}}},5000);f.coordinator.schedulePatch({experience:{music:{provider:"local"},galaxy:"violet-rift"}},5000);await f.coordinator.flushPending();resolve({settings:sanitizeStudioSettings(defaultStudioSettings())});expect((await old)?.experience).toEqual({music:{volume:0,provider:"local"},galaxy:"violet-rift"});expect(f.writes).toHaveLength(1);
});
function controller(value: ExperienceController["value"]):ExperienceController{return{value,ready:true,error:"",patch:vi.fn(),retry:vi.fn()};}
it("restores a local track and zero volume paused, avoids hydration writes, then records real play/volume",async()=>{
 const preference=controller({music:{provider:"local",lastTrack:{provider:"local",id:"one"},volume:0}});
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({name:"Fixture library",songs:[{id:"one",name:"One",artists:"Fixture",album:"Test"}]})})));
 render(React.createElement(MusicPlayerDialog,{preferences:preference,autoPlay:false,onOpen:vi.fn(),onClose:vi.fn()}));await screen.findByRole("button",{name:"Play One"});await waitFor(()=>expect(document.querySelector("audio")).toHaveAttribute("src","/api/music/local?id=one"));const audio=document.querySelector("audio")!;expect(audio.volume).toBe(0);expect(audio.play).not.toHaveBeenCalled();fireEvent.volumeChange(audio);expect(preference.patch).not.toHaveBeenCalled();
 fireEvent.play(audio);expect(preference.patch).toHaveBeenCalledWith({music:{provider:"local",lastTrack:{provider:"local",id:"one"}}});audio.volume=.4;fireEvent.volumeChange(audio);expect(preference.patch).toHaveBeenCalledWith({music:{volume:.4}});
});
it("does not replace or play an unavailable local saved track",async()=>{
 const preference=controller({music:{provider:"local",lastTrack:{provider:"local",id:"gone"}}});vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({name:"Library",songs:[{id:"one",name:"One",artists:"Fixture",album:"Test"}]})})));
 render(React.createElement(MusicPlayerDialog,{preferences:preference,onOpen:vi.fn(),onClose:vi.fn()}));await screen.findByText("Your previous track is unavailable. Choose a track from this library.");expect(document.querySelector("audio")).not.toHaveAttribute("src");expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();expect(preference.patch).not.toHaveBeenCalled();
});
it("retains the tagged NetEase candidate when unauthorized, without fetching a track or playing",async()=>{
 const preference=controller({music:{provider:"netease",lastTrack:{provider:"netease",id:"123"},volume:.37}}),fetch=vi.fn(async()=>({ok:true,json:async()=>({configured:true,authorized:false})}));vi.stubGlobal("fetch",fetch);
 render(React.createElement(MusicPlayerDialog,{preferences:preference,onOpen:vi.fn(),onClose:vi.fn()}));await waitFor(()=>expect(screen.getByRole("button",{name:"Resume previous track"})).toBeDisabled());expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();expect(fetch.mock.calls).toHaveLength(1);expect(preference.patch).not.toHaveBeenCalled();
});

it("does not auto-replace a saved NetEase track when its exact resume request fails",async()=>{
 const preference=controller({music:{provider:"netease",lastTrack:{provider:"netease",id:"123"}}});const fetch=vi.fn(async(url:string)=>({ok:!url.includes("action=track"),json:async()=>url.includes("action=track")?{error:"gone",code:"TRACK_UNAVAILABLE"}:url.includes("action=recommendations")?{songs:[],playlists:[]}:{configured:true,authorized:true}}));vi.stubGlobal("fetch",fetch);
 render(React.createElement(MusicPlayerDialog,{preferences:preference,onOpen:vi.fn(),onClose:vi.fn()}));await waitFor(()=>expect(screen.getByRole("button",{name:"Resume previous track"})).toBeEnabled());expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Resume previous track"}));await screen.findByText("Your previous track could not be restored. Choose another track.");expect(fetch.mock.calls.filter(([url])=>url.includes("action=track"))).toHaveLength(1);expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();expect(preference.patch).not.toHaveBeenCalled();
});
it("does not fall through to a mix when the saved NetEase audio itself is unavailable",async()=>{
 const preference=controller({music:{provider:"netease",lastTrack:{provider:"netease",id:"123"}}});const fetch=vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes("action=track")?{url:"/synthetic-audio",preview:null}:url.includes("action=recommendations")?{songs:[],playlists:[]}:{configured:true,authorized:true}}));vi.stubGlobal("fetch",fetch);
 render(React.createElement(MusicPlayerDialog,{preferences:preference,onOpen:vi.fn(),onClose:vi.fn()}));await waitFor(()=>expect(screen.getByRole("button",{name:"Resume previous track"})).toBeEnabled());fireEvent.click(screen.getByRole("button",{name:"Resume previous track"}));await waitFor(()=>expect(document.querySelector("audio")).toHaveAttribute("src","/synthetic-audio"));const calls=fetch.mock.calls.length;fireEvent.error(document.querySelector("audio")!);await screen.findByText("Your previous track could not be restored. Choose another track.");expect(fetch.mock.calls).toHaveLength(calls);expect(preference.patch).not.toHaveBeenCalled();
});
