"use client";

import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { Color, Vector2 } from "three";
import type { StarSystem } from "./galaxy";

const vertexShader = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`;
const fragmentShader = `
varying vec2 vUv;
uniform vec2 uSize;
uniform vec3 uCloud, uGlow;
uniform float uSeed;
float random(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(random(i), random(i+vec2(1,0)), f.x), mix(random(i+vec2(0,1)), random(i+1.0), f.x), f.y);
}
float fbm(vec2 p) {
  float n = 0.0, a = .52;
  for (int i=0; i<5; i++) { n += a*noise(p); p = mat2(.8,-.6,.6,.8)*p*2.04+17.3; a *= .49; }
  return n;
}
void main() {
  vec2 p = (vUv-.5)*vec2(uSize.x/uSize.y,1.0);
  float s = uSeed*7.19;
  vec2 q = p*3.0+vec2(s,s*.63);
  float warp = fbm(q+vec2(3.1,7.6));
  float cloud = fbm(q+vec2(warp*2.7,-warp*1.9));
  float ridge = pow(max(0.0,1.0-abs(cloud-.54)*5.0),2.0);
  float sweep = exp(-pow((p.y+p.x*(.35+.12*sin(s))-.13+sin(p.x*2.0+s)*.12)*2.5,2.0));
  float dust = fbm(q*2.6+warp*3.0);
  float cavity = smoothstep(.28,.65,cloud);
  vec3 color = vec3(.0018,.003,.007);
  color += uCloud*(cloud*.75+ridge*.45)*sweep;
  color += uGlow*pow(dust,4.0)*sweep*.85;
  color *= .18+cavity*.82;
  // Widely separated stellar layers, without scintillation or camera shake.
  for (int i=0; i<2; i++) {
    float scale = 165.0+float(i)*127.0;
    vec2 cell = floor(p*scale), f = fract(p*scale)-.5;
    float r = random(cell+vec2(s,float(i)*31.0));
    float star = pow(max(0.0,1.0-length(f)*2.0),14.0)*step(.987,r);
    color += mix(vec3(.57,.69,.95),vec3(1.0,.88,.65),random(cell+3.0))*star*(.7+float(i)*.25);
  }
  // A distant world is drawn after the star field, so stars cannot shine through it.
  vec2 center = vec2((.28+.07*sin(s))*uSize.x/uSize.y,.12+.13*cos(s));
  float radius = .155+.035*sin(s*.8);
  vec2 planet = (p-center)/radius;
  float d = length(planet);
  float atmosphere = exp(-abs(d-1.0)*65.0)*.2;
  color += uGlow*atmosphere;
  if (d<1.0) {
    vec3 normal = vec3(planet,sqrt(1.0-d*d));
    float light = max(0.0,dot(normal,normalize(vec3(-.8,.35,-.2))));
    float bands = fbm(planet*6.0+vec2(s,planet.y*7.0));
    vec3 surface = mix(uCloud*.28,uGlow*.32,bands);
    color = surface*(.015+light*.75)+uGlow*pow(max(0.0,1.0-normal.z),4.0)*light*.12;
  }
  float edge = 1.0-smoothstep(.3,1.15,length(vUv-.5));
  gl_FragColor = vec4(color*(.6+edge*.4),1.0);
  #include <colorspace_fragment>
}`;

export function GalaxyBackdrop({ system }: { system: StarSystem }) {
  const size = useThree(state => state.size);
  const uniforms = useMemo(() => ({
    uSize: { value: new Vector2(size.width, size.height) },
    uCloud: { value: new Color(system.cloud) }, uGlow: { value: new Color(system.glow) }, uSeed: { value: system.seed },
  }), [system, size.width, size.height]);
  if (system.id === "deep-space") return <>
    <color attach="background" args={["#081421"]} />
    <Stars radius={100} depth={50} count={1800} factor={15} saturation={0} fade speed={0} />
  </>;
  return <mesh frustumCulled={false} renderOrder={-1000} raycast={() => {}}>
    <planeGeometry args={[2, 2]} />
    <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={uniforms} depthWrite={false} depthTest={false} toneMapped={false} />
  </mesh>;
}
