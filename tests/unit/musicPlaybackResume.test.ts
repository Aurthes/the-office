import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MusicPlayerDialog } from "@/features/ring-ship/MusicPlayerDialog";
import { reloadPlaybackIntent } from "@/features/ring-ship/musicPlaybackIntent";
import type { ExperienceController } from "@/features/ring-ship/useExperiencePreferences";
const KEY="claw3d:music:reload-intent", originalNav=Object.getOwnPropertyDescriptor(performance,"getEntriesByType");
let nav="reload";
beforeEach(()=>{
 sessionStorage.clear();localStorage.clear();nav="reload";
 Object.defineProperty(performance,"getEntriesByType",{configurable:true,value:()=>[{type:nav}]});
 vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(function(this:HTMLMediaElement){fireEvent.pause(this);});vi.spyOn(HTMLMediaElement.prototype,"load").mockImplementation(()=>{});
 vi.spyOn(HTMLMediaElement.prototype,"readyState","get").mockReturnValue(4);vi.spyOn(HTMLMediaElement.prototype,"duration","get").mockReturnValue(30);vi.spyOn(HTMLMediaElement.prototype,"buffered","get").mockReturnValue({length:1,start:()=>0,end:()=>30});
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();if(originalNav)Object.defineProperty(performance,"getEntriesByType",originalNav);else Reflect.deleteProperty(performance,"getEntriesByType");});
const songs=[{id:"1",name:"One",artists:"Fixture",album:"Test",playable:true},{id:"2",name:"Two",artists:"Fixture",album:"Test",playable:true}];
function setup(provider:"local"|"netease",options:{authorized?:boolean;missing?:boolean;trackFailure?:boolean}={}){
 sessionStorage.setItem(KEY,JSON.stringify({provider,id:"1"}));
 const fetch=vi.fn(async(url:string)=>({ok:!(options.trackFailure&&url.includes("action=track")),json:async()=>url.includes("/local")?{name:"Fixture",songs:options.missing?[songs[1]]:songs}:url.includes("action=track")?options.trackFailure?{error:"unavailable",code:"TRACK_UNAVAILABLE"}:{url:"/synthetic.wav?id=1",preview:null}:url.includes("action=recommendations")?{songs,playlists:[]}:{configured:true,authorized:options.authorized??true}}));vi.stubGlobal("fetch",fetch);
 const preference:ExperienceController={value:{music:{provider,lastTrack:{provider,id:"1"},volume:.37}},ready:true,error:"",patch:vi.fn(),retry:vi.fn()};
 const props={preferences:preference,onOpen:vi.fn(),onClose:vi.fn()};return{preference,fetch,props};
}
it("only reads an exact, same-tab reload receipt; navigation/malformed data cannot start sound",()=>{
 sessionStorage.setItem(KEY,JSON.stringify({provider:"local",id:"1"}));expect(reloadPlaybackIntent()).toEqual({provider:"local",id:"1"});nav="navigate";expect(reloadPlaybackIntent()).toBeNull();nav="back_forward";expect(reloadPlaybackIntent()).toBeNull();nav="reload";sessionStorage.setItem(KEY,JSON.stringify({provider:"local",id:"/private/path"}));expect(reloadPlaybackIntent()).toBeNull();sessionStorage.setItem(KEY,"broken");expect(reloadPlaybackIntent()).toBeNull();
});
it.each(["local","netease"] as const)("%s resumes the exact track once, records only playing, and distinguishes pause from teardown",async provider=>{
 const f=setup(provider),view=render(React.createElement(MusicPlayerDialog,f.props));await waitFor(()=>expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));const audio=document.querySelector("audio")!;expect(audio.src).toContain("id=1");expect(audio.volume).toBe(.37);expect(sessionStorage.getItem(KEY)).toBeNull();fireEvent.play(audio);expect(sessionStorage.getItem(KEY)).toBeNull();fireEvent.playing(audio);expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({provider,id:"1"});
 window.dispatchEvent(new Event("pagehide"));fireEvent.pause(audio);expect(sessionStorage.getItem(KEY)).not.toBeNull();window.dispatchEvent(new Event("pageshow"));fireEvent.pause(audio);expect(sessionStorage.getItem(KEY)).toBeNull();fireEvent.play(audio);fireEvent.playing(audio);view.unmount();expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({provider,id:"1"});expect(f.preference.patch).not.toHaveBeenCalledWith(expect.objectContaining({playing:expect.anything()}));
});
it.each(["local","netease"] as const)("%s leaves autoplay denial paused with explicit continue; unrelated clicks do not retry",async provider=>{
 const f=setup(provider);vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("Denied","NotAllowedError"));render(React.createElement(MusicPlayerDialog,f.props));await screen.findByRole("button",{name:"Resume music"});expect(sessionStorage.getItem(KEY)).toBeNull();expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);fireEvent.click(document.body);fireEvent.keyDown(document.body,{key:"a"});expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole("button",{name:"Resume music"}));expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);expect(sessionStorage.getItem(KEY)).toBeNull();fireEvent.play(document.querySelector("audio")!);fireEvent.playing(document.querySelector("audio")!);expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({provider,id:"1"});
});
it.each(["local","netease"] as const)("%s waits for a successful profile and does not auto-play when that profile failed",async provider=>{
 const f=setup(provider);const view=render(React.createElement(MusicPlayerDialog,{...f.props,preferences:{...f.preference,ready:false}}));expect(f.fetch).not.toHaveBeenCalled();view.rerender(React.createElement(MusicPlayerDialog,{...f.props,preferences:{...f.preference,error:"Offline"}}));await waitFor(()=>expect(f.fetch).toHaveBeenCalled());expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();view.rerender(React.createElement(MusicPlayerDialog,f.props));await waitFor(()=>expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));expect(document.querySelector("audio")!.src).toContain("id=1");
});
it.each(["local","netease"] as const)("%s stays paused with no receipt even if the shared last track is set",async provider=>{
 const f=setup(provider);sessionStorage.clear();render(React.createElement(MusicPlayerDialog,f.props));await waitFor(()=>expect(f.fetch).toHaveBeenCalled());expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});
it("honors this tab's actual local track rather than another device's newer provider/track",async()=>{
 const f=setup("local");f.preference.value.music={provider:"netease",lastTrack:{provider:"netease",id:"2"},volume:.37};render(React.createElement(MusicPlayerDialog,f.props));await waitFor(()=>expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));expect(document.querySelector("audio")!.src).toContain("/api/music/local?id=1");expect(f.fetch.mock.calls.every(([url])=>!url.includes("netease"))).toBe(true);
});
it("does not let a late profile recovery replace a user's explicit track choice",async()=>{
 const f=setup("local"),view=render(React.createElement(MusicPlayerDialog,{...f.props,preferences:{...f.preference,error:"Offline"}}));fireEvent.click(await screen.findByRole("button",{name:"Play Two"}));await waitFor(()=>expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));vi.spyOn(HTMLMediaElement.prototype,"paused","get").mockReturnValue(false);fireEvent.play(document.querySelector("audio")!);fireEvent.playing(document.querySelector("audio")!);view.rerender(React.createElement(MusicPlayerDialog,f.props));expect(document.querySelector("audio")!.src).toContain("id=2");expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
});
it("missing local track never chooses a preferred/random replacement",async()=>{
 const f=setup("local",{missing:true});render(React.createElement(MusicPlayerDialog,f.props));await screen.findByText("Your previous track is unavailable. Choose a track from this library.");expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();expect(document.querySelector("audio")).not.toHaveAttribute("src");
});
it("unauthorized NetEase does not request a track or switch providers",async()=>{
 const f=setup("netease",{authorized:false});render(React.createElement(MusicPlayerDialog,f.props));await waitFor(()=>expect(screen.getByRole("button",{name:"Resume previous track"})).toBeDisabled());expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();expect(f.fetch.mock.calls).toHaveLength(1);
});
it("NetEase exact lookup failure does not try another track",async()=>{
 const f=setup("netease",{trackFailure:true});render(React.createElement(MusicPlayerDialog,f.props));await screen.findByText("Your previous track could not be restored. Choose another track.");expect(f.fetch.mock.calls.filter(([url])=>url.includes("action=track"))).toHaveLength(1);expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});
it("NetEase play without actual playing still cannot turn an audio failure into another-song fallback",async()=>{
 const f=setup("netease");render(React.createElement(MusicPlayerDialog,f.props));await waitFor(()=>expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));const audio=document.querySelector("audio")!,before=f.fetch.mock.calls.length;fireEvent.play(audio);fireEvent.error(audio);await screen.findByText("Your previous track could not be restored. Choose another track.");expect(f.fetch.mock.calls).toHaveLength(before);expect(sessionStorage.getItem(KEY)).toBeNull();
});

it("a normal navigation consumes stale intent so a later paused refresh cannot revive it",async()=>{
 const f=setup("local");nav="navigate";const view=render(React.createElement(MusicPlayerDialog,f.props));await screen.findByRole("button",{name:"Play One"});expect(sessionStorage.getItem(KEY)).toBeNull();expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();view.unmount();nav="reload";render(React.createElement(MusicPlayerDialog,f.props));await screen.findByRole("button",{name:"Play One"});expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});
