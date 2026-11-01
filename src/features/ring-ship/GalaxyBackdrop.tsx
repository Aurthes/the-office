"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { Color, Matrix3, SRGBColorSpace, VideoTexture, type ShaderMaterial } from "three";
import type { StarSystem } from "./galaxy";
import type { SpaceMotion } from "./space-activity";

// The ship has an orthographic camera. Give its distant sky a fixed angular
// field of view, sharing the camera's world rotation but not its pan or zoom.
const vertexShader = `
uniform mat3 uCameraRotation;
uniform float uAspect;
varying vec3 vDirection;
void main() {
  vDirection = uCameraRotation * vec3(position.x*uAspect*.55, position.y*.55, -1.0);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;
const fragmentShader = `
varying vec3 vDirection;
uniform vec3 uCloud, uGlow;
uniform float uSeed;
uniform float uTime, uPlanetApproach, uPlanetPass;
uniform float uBlackHole;
uniform sampler2D uBlackHoleVideo;
float random(vec3 p) {
  p = fract(p*.1031); p += dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = mix(mix(random(i),random(i+vec3(1,0,0)),f.x), mix(random(i+vec3(0,1,0)),random(i+vec3(1,1,0)),f.x),f.y);
  float b = mix(mix(random(i+vec3(0,0,1)),random(i+vec3(1,0,1)),f.x), mix(random(i+vec3(0,1,1)),random(i+vec3(1,1,1)),f.x),f.y);
  return mix(a,b,f.z);
}
float fbm(vec3 p) {
  float n = 0.0, a = .52;
  for (int i=0; i<5; i++) { n += a*noise(p); p = p*2.04+vec3(17.3,31.7,11.2); a *= .49; }
  return n;
}
void main() {
  vec3 direction = normalize(vDirection);
  // A fixed reference keeps the cloud band and planet near the original
  // overview composition. Every sample remains anchored in world space.
  vec3 forward = normalize(vec3(-70,-73,-94));
  vec3 right = normalize(cross(forward,vec3(0,1,0)));
  vec3 up = cross(right,forward);
  vec3 sky = vec3(dot(direction,right),dot(direction,up),dot(direction,forward));
  float s = uSeed*7.19;
  vec3 q = direction*3.0+vec3(s,s*.63,s*.27)+vec3(uTime*.0012,-uTime*.0007,uTime*.0005);
  float warp = fbm(q+vec3(3.1,7.6,1.7));
  float cloud = fbm(q+vec3(warp*2.7,-warp*1.9,warp*.9));
  float ridge = pow(max(0.0,1.0-abs(cloud-.54)*5.0),2.0);
  float sweep = exp(-pow((sky.y+sky.x*(.35+.12*sin(s))-.13+sin(sky.x*2.0+s)*.12)*2.5,2.0));
  float dust = fbm(q*2.6+warp*3.0);
  float cavity = smoothstep(.28,.65,cloud);
  vec3 color = vec3(.0018,.003,.007);
  color += uCloud*(cloud*.75+ridge*.45)*sweep;
  color += uGlow*pow(dust,4.0)*sweep*.85;
  color *= .18+cavity*.82;
  // Widely separated stellar layers, without scintillation or camera shake.
  for (int i=0; i<2; i++) {
    float scale = 165.0+float(i)*127.0;
    vec3 cell = floor(direction*scale), f = fract(direction*scale)-.5;
    float r = random(cell+vec3(s,float(i)*31.0,s*.3));
    float star = pow(max(0.0,1.0-length(f)*2.0),14.0)*step(.987,r);
    color += mix(vec3(.57,.69,.95),vec3(1.0,.88,.65),random(cell+3.0))*star*(.7+float(i)*.25);
  }
  if (uBlackHole > .5) {
    // Project the animated disk into the same world-anchored sky as the stars.
    // Only its light and central shadow cover the sky, never a video rectangle.
    vec3 holeDirection = normalize(forward+right*.34+up*.22);
    vec3 holeRight = normalize(cross(holeDirection,vec3(0,1,0)));
    vec3 holeUp = cross(holeRight,holeDirection);
    float facing = dot(direction,holeDirection);
    vec2 uv = vec2(dot(direction,holeRight),dot(direction,holeUp))/max(.0001,facing)/vec2(2.7,1.51875)+.5;
    if (facing > 0.0 && min(uv.x,uv.y) > 0.0 && max(uv.x,uv.y) < 1.0) {
      vec3 disk = sRGBTransferEOTF(texture2D(uBlackHoleVideo,uv)).rgb;
      disk = vec3(dot(disk,vec3(.2126,.7152,.0722))*1.6);
      vec2 center = (uv-.5)*vec2(16.0/9.0,1.0);
      float shadow = 1.0-smoothstep(.16,.166,length(center));
      float coverage = max(shadow,clamp(max(disk.r,max(disk.g,disk.b))*12.0,0.0,1.0));
      color = color*(1.0-coverage)+disk*1.4;
    }
  } else {
  // A distant world is drawn after the star field, so stars cannot shine through it.
  vec3 planetDirection = normalize(forward+right*(.55+.12*sin(s)+uPlanetPass*.5)+up*(.16+.12*cos(s)+uPlanetApproach*.08));
  vec3 planetRight = normalize(cross(planetDirection,vec3(0,1,0)));
  vec3 planetUp = cross(planetRight,planetDirection);
  float radius = .155+.035*sin(s*.8)+uPlanetApproach*.18;
  vec2 planet = vec2(dot(direction,planetRight),dot(direction,planetUp))/sin(radius);
  float d = length(planet);
  float facing = step(0.0,dot(direction,planetDirection));
  float atmosphere = exp(-abs(d-1.0)*65.0)*.2*facing;
  color += uGlow*atmosphere;
  if (d<1.0 && facing>0.0) {
    vec3 normal = vec3(planet,sqrt(1.0-d*d));
    float light = max(0.0,dot(normal,normalize(vec3(-.8,.35,-.2))));
    float bands = fbm(vec3(planet*6.0+vec2(uTime*.003,0.0),s+planet.y*7.0));
    vec3 surface = mix(uCloud*.28,uGlow*.32,bands);
    color = surface*(.015+light*.75)+uGlow*pow(max(0.0,1.0-normal.z),4.0)*light*.12;
  }
  }
  gl_FragColor = vec4(color,1.0);
  #include <colorspace_fragment>
}`;

export function GalaxyBackdrop({ system, motion }: { system: StarSystem; motion?: RefObject<SpaceMotion> }) {
  const size = useThree(state => state.size);
  const videoTexture = useRef<VideoTexture | null>(null);
  // Three.js caches this dictionary with the material. Keep its identity stable
  // across resizes and system changes; update only its values before rendering.
  const uniforms = useMemo(() => ({
    uCameraRotation: { value: new Matrix3() }, uAspect: { value: 1 },
    uTime: { value: 0 }, uPlanetApproach: { value: 0 }, uPlanetPass: { value: 0 },
    uCloud: { value: new Color() }, uGlow: { value: new Color() }, uSeed: { value: 0 },
    uBlackHole: { value: 0 }, uBlackHoleVideo: { value: null as VideoTexture | null },
  }), []);
  useEffect(() => {
    if (system.id !== "black-hole") return;
    const video = document.createElement("video");
    video.muted = true; video.loop = true; video.playsInline = true; video.preload = "auto";
    video.src = "/environments/black-hole-accretion-hq.mp4";
    const texture = new VideoTexture(video);
    texture.colorSpace = SRGBColorSpace;
    videoTexture.current = texture;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (document.hidden || reduced.matches) video.pause();
      else void video.play().catch(() => {});
    };
    update();
    document.addEventListener("visibilitychange", update); reduced.addEventListener("change", update);
    return () => {
      document.removeEventListener("visibilitychange", update); reduced.removeEventListener("change", update);
      video.pause(); video.removeAttribute("src"); video.load();
      videoTexture.current = null; texture.dispose();
    };
  }, [system.id]);
  if (system.id === "deep-space") return <>
    <color attach="background" args={["#081421"]} />
    <Stars radius={100} depth={50} count={1800} factor={15} saturation={0} fade speed={0} />
  </>;
  return <mesh frustumCulled={false} renderOrder={-1000} raycast={() => {}}
    onBeforeRender={(_renderer, _scene, camera, _geometry, material) => {
      const live = (material as ShaderMaterial).uniforms;
      live.uCameraRotation.value.setFromMatrix4(camera.matrixWorld);
      live.uAspect.value = size.width / Math.max(1, size.height);
      live.uCloud.value.set(system.cloud);
      live.uGlow.value.set(system.glow);
      live.uSeed.value = system.seed;
      live.uBlackHole.value = system.id === "black-hole" ? 1 : 0;
      live.uBlackHoleVideo.value = videoTexture.current;
      live.uTime.value = motion?.current.elapsed ?? 0;
      live.uPlanetApproach.value = motion?.current.planetApproach ?? 0;
      live.uPlanetPass.value = motion?.current.planetPass ?? 0;
    }}>
    <planeGeometry args={[2, 2]} />
    <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={uniforms} depthWrite={false} depthTest={false} toneMapped={false} />
  </mesh>;
}
