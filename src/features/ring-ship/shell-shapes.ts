import * as THREE from 'three';
import type { LaunchOpening } from './returnPodGeometry';
// Each cabin bulges between narrower docking collars, so the outline reads as
// joined pressure modules rather than a single uniform circular platform.
export function hullProfile(t:number){
  const end=Math.min(t,1-t)/.16;
  return .79+.21*Math.sin(Math.min(1,end)*Math.PI/2);
}
export function cabinDeck(radius:number,half:number,start:number,end:number,opening?:LaunchOpening){
  if(opening){
    const shape=new THREE.Shape();
    for(let side=0;side<2;side++)for(let i=0;i<=40;i++){
      const t=side?1-i/40:i/40,theta=start+(end-start)*t,r=radius+(side?-1:1)*half*hullProfile(t);
      const x=Math.sin(theta)*r,z=-Math.cos(theta)*r;
      if(!side&&!i)shape.moveTo(x,z);else shape.lineTo(x,z);
    }
    shape.closePath();
    const hole=new THREE.Path();hole.absarc(opening.x,-opening.z,opening.radius,0,Math.PI*2,true);shape.holes.push(hole);
    const geometry=new THREE.ShapeGeometry(shape,32);geometry.rotateX(-Math.PI/2);geometry.translate(0,.055,0);return geometry;
  }
  const p:number[]=[],uv:number[]=[],idx:number[]=[],n=40;
  for(let i=0;i<=n;i++)for(let j=0;j<2;j++){
    const theta=start+(end-start)*i/n,r=radius+(j?1:-1)*half*hullProfile(i/n);
    p.push(Math.sin(theta)*r,.055,Math.cos(theta)*r);uv.push(i/n,j);
    if(i<n&&!j){const k=i*2;idx.push(k,k+1,k+2,k+1,k+3,k+2);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
