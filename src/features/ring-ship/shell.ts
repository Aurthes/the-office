import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder } from './geometry';
import { cabinAngle, shipPoint, type ShipLayout } from './layout';
import { hullProfile } from './shell-shapes';

const TAU = Math.PI * 2;
function torusPatch(radius: number, width: number, height: number, start: number, end: number, from: number, to: number) {
  const along = Math.max(8, Math.ceil((end - start) * radius * 1.5)), around = 20;
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i <= along; i++) for (let j = 0; j <= around; j++) {
    const a = start + (end - start) * i / along, b = from + (to - from) * j / around;
    const profile=hullProfile(i/along),r = radius + width * profile * Math.cos(b);
    positions.push(Math.sin(a) * r, .12 + height * profile * Math.sin(b), Math.cos(a) * r);
    const n = new THREE.Vector3(Math.sin(a) * Math.cos(b) / width, Math.sin(b) / height, Math.cos(a) * Math.cos(b) / width).normalize();
    normals.push(n.x, n.y, n.z); uv.push(i / along, j / around);
    if (i < along && j < around) {
      const k = i * (around + 1) + j;
      indices.push(k, k + around + 1, k + 1, k + 1, k + around + 1, k + around + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
  return geometry;
}
function arch(radius: number, width: number, height: number, angle: number, from: number, to: number, thickness: number) {
  const points = Array.from({length: 33}, (_, j) => {
    const phi = from + (to - from) * j / 32;
    const p = shipPoint(radius + width * Math.cos(phi), angle);
    return new THREE.Vector3(p.x, .12 + height * Math.sin(phi), p.z);
  });
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, thickness, 5, false);
}
function beam(b: Builder, from: THREE.Vector3, to: THREE.Vector3, radius: number, color: string) {
  const delta = to.clone().sub(from), center = from.clone().add(to).multiplyScalar(.5);
  b.add(new THREE.CylinderGeometry(radius, radius, delta.length(), 8), color,
    new THREE.Matrix4().compose(center, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize()), new THREE.Vector3(1,1,1)));
}
function corridor(angle: number, start: number, end: number, from: number, to: number) {
  const p: number[] = [], index: number[] = [], n = 20;
  for (let row = 0; row < 2; row++) for (let j = 0; j <= n; j++) {
    const phi = from + (to - from) * j / n, x = .87 * Math.cos(phi), z = row ? end : start;
    p.push(Math.cos(angle) * x + Math.sin(angle) * z, .12 + 1.18 * Math.sin(phi), -Math.sin(angle) * x + Math.cos(angle) * z);
    if (!row && j < n) { const k = j; index.push(k,k+1,k+n+1,k+1,k+n+2,k+n+1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(index);g.computeVertexNormals();
  g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(p.length/3*2),2));
  return g;
}
export function buildShell(layout: ShipLayout) {
  const b = new Builder({}), group = new THREE.Group(), upper: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [];
  const step = TAU / layout.allocation.sectors;
  for (const cabin of layout.cabins) {
    const ring = layout.rings[cabin.ring], half = ring.depth / 2 + .18, height = 3.1 + cabin.ring * .4;
    const start = cabin.slot * step + .07 / ring.radius, end = (cabin.slot + 1) * step - .07 / ring.radius;
    b.add(torusPatch(ring.radius, half, height, start, end, Math.PI, TAU), cabin.kind === 'reserve' ? '#b9c9cb' : '#dce5e4');
    // The keel and service bands follow the rounded belly, rather than a flat slab.
    b.add(torusPatch(ring.radius, half + .025, height + .025, start, end, Math.PI * 1.44, Math.PI * 1.56), '#425e6d');
    b.add(torusPatch(ring.radius, half + .028, height + .028, start, end, TAU - .34, TAU - .27), cabin.kind === 'reserve' ? '#91b1b5' : '#dfa357');
    b.add(torusPatch(ring.radius, half + .03, height + .03, start + step * .08, end - step * .08, TAU - .13, TAU - .11), cabin.kind === 'reserve' ? '#79b6bd' : '#f2c782',new THREE.Matrix4(),true);
    upper.push(torusPatch(ring.radius, half, height, start, end, 0, Math.PI).toNonIndexed());
    const boundary = cabin.slot * step;
    b.add(arch(ring.radius, (half + .06)*.79, (height + .06)*.79, boundary, Math.PI, TAU, .10), '#829da7');
    frames.push(arch(ring.radius, (half + .06)*.79, (height + .06)*.79, boundary, 0, Math.PI, .08).toNonIndexed());
    // A longitudinal roof spar makes each full capsule readable at high transparency.
    frames.push(torusPatch(ring.radius, half + .04, height + .04, start, end, Math.PI / 2 - .012, Math.PI / 2 + .012).toNonIndexed());
    for(const phi of [Math.PI/4,Math.PI*3/4])frames.push(torusPatch(ring.radius,half+.025,height+.025,start,end,phi-.006,phi+.006).toNonIndexed());
    const a = cabinAngle(layout, cabin.slot), p = shipPoint(ring.radius + half * .91, a);
    b.box([.9, .55, .15],[p.x,-.9,p.z],'#4a6370',a);
    b.box([.45, .08, .17],[p.x,-.86,p.z],cabin.kind==='reserve'?'#7caeb7':'#eab977',a,true);
  }
  for (const angle of layout.spokes) {
    // The transit arms also have a rounded lower shell and transparent roof.
    b.add(corridor(angle,3.2,layout.radius,Math.PI,TAU),'#d6e2e1');
    upper.push(corridor(angle,3.2,layout.radius,0,Math.PI).toNonIndexed());
    for (let r=4;r<layout.radius;r+=3) {
      const points=Array.from({length:17},(_,j)=>{
        const phi=j*Math.PI/16,x=.91*Math.cos(phi);
        return new THREE.Vector3(Math.cos(angle)*x+Math.sin(angle)*r,.12+1.22*Math.sin(phi),-Math.sin(angle)*x+Math.cos(angle)*r);
      });
      frames.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),16,.035,4,false).toNonIndexed());
    }
    const inner = shipPoint(layout.rings[0].radius - 1, angle), hub=shipPoint(2.2,angle);
    beam(b,new THREE.Vector3(hub.x,-4,hub.z),new THREE.Vector3(inner.x,-1.7,inner.z),.14,'#9eb3ba');
  }
  // A real central spindle extends below the habitat deck.
  b.cylinder(2.25,7.4,[0,-3.1,0],'#ccd9da',32);
  b.cylinder(2.4,.25,[0,-2.0,0],'#dba16b',32);
  b.cylinder(2.35,.28,[0,-5.8,0],'#4d6777',32);
  b.ball(2.22,[0,-6.3,0],'#b5c8cd',[1,.6,1]);
  for(const angle of layout.spokes){
    const p=shipPoint(2.25,angle); b.box([.65,3.8,.28],[p.x,-3.9,p.z],'#4a6876',angle);
  }
  const dome=new THREE.SphereGeometry(2.5,32,16,0,TAU,0,Math.PI/2);dome.translate(0,1.35,0);upper.push(dome.toNonIndexed());
  group.add(b.finish());
  const roofMaterial=new THREE.MeshPhysicalMaterial({color:'#99c1cd',transparent:true,opacity:.12,roughness:.28,metalness:.12,clearcoat:.65,side:THREE.DoubleSide,depthWrite:false});
  roofMaterial.forceSinglePass=true;
  const frameMaterial=new THREE.MeshStandardMaterial({color:'#a8c3c5',transparent:true,opacity:.33,roughness:.5,side:THREE.DoubleSide,depthWrite:false});
  frameMaterial.forceSinglePass=true;
  for(const [geometries,material,order] of [[upper,roofMaterial,10],[frames,frameMaterial,11]] as const){
    const geometry=mergeGeometries([...geometries],false);geometries.forEach(g=>g.dispose());
    if(geometry){const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=order;group.add(mesh);}
  }
  return {group,roofMaterial,frameMaterial};
}
