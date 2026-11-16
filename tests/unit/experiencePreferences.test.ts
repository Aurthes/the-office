import { describe, expect, it } from "vitest";
import { defaultStudioSettings, mergeStudioSettings, normalizeStudioSettings, sanitizeStudioSettings } from "@/lib/studio/settings";
import { normalizeExperience } from "@/lib/studio/experience";
describe("single-owner four-leaf experience",()=>{
 it("keeps absence distinct from defaults, preserves zero, and exposes only bounded public IDs",()=>{
  expect(defaultStudioSettings()).not.toHaveProperty("experience");expect(normalizeStudioSettings({})).not.toHaveProperty("experience");
  const settings=mergeStudioSettings(defaultStudioSettings(),{experience:{galaxy:"black-hole",music:{provider:"local",volume:0,lastTrack:{provider:"local",id:"song-1"}}}});
  expect(sanitizeStudioSettings(settings).experience).toEqual({galaxy:"black-hole",music:{provider:"local",volume:0,lastTrack:{provider:"local",id:"song-1"}}});
  expect(normalizeExperience({galaxy:"invalid",music:{volume:Infinity,lastTrack:{provider:"local",id:"/private/music/file.mp3",url:"https://bad"},cookie:"bad"}})).toEqual({});
 });
 it("merges different-device leaves and only seeds fields still missing at write time",()=>{
  let value=mergeStudioSettings(defaultStudioSettings(),{experience:{music:{volume:.64}}});
  value=mergeStudioSettings(value,{experience:{galaxy:"jade-nebula",music:{provider:"netease"}}});
  value=mergeStudioSettings(value,{experienceSeed:{galaxy:"deep-space",music:{provider:"local",volume:.15,lastTrack:null}}});
  expect(value.experience).toEqual({galaxy:"jade-nebula",music:{provider:"netease",volume:.64,lastTrack:null}});
  value=mergeStudioSettings(value,{experienceSeed:{music:{volume:.1}},experience:{music:{volume:0}}});expect(value.experience?.music?.volume).toBe(0);
  expect(mergeStudioSettings(value,{office:{}}).experience).toEqual(value.experience);
 });
});
