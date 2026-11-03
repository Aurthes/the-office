// @vitest-environment node
import fs from 'node:fs/promises';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHIP_MODELS, shipModelUrl, buildShipGeometry, disposeShipGeometry, type ModelTemplates } from '@/features/ring-ship/geometry';
import { buildShipLayout, shipDeck, cabinAngle, shipPoint, SHIP_AISLE_WIDTH, routeBetweenCabins, type ShipCabin, type ShipLayout, type ShipPoint } from '@/features/ring-ship/layout';
import { registerFurniture, type FurnitureBox } from '@/features/ring-ship/furnitureCollisions';
import { isWalkable, walkableSegment } from '@/features/ring-ship/walkableSurface';
import { crewRadius, occupiedWaypoint, walkCharacter } from '@/features/ring-ship/characterCollision';

let models: ModelTemplates;
const maxCrewRadius=crewRadius({avatarProfile:{duck:{bodyWidth:1.3,bodyDepth:1.3}}} as Parameters<typeof crewRadius>[0]);
beforeAll(async () => {
  vi.stubGlobal('document', {createElement:()=>({getContext:()=>({fillRect(){},fillText(){}})})});
  vi.stubGlobal('ProgressEvent', class {});
  models = Object.fromEntries(await Promise.all(SHIP_MODELS.map(async name=>{
    const path='public'+shipModelUrl(name);let bytes=await fs.readFile(path);
    if(path.endsWith('.gltf')){
      const json=JSON.parse(bytes.toString());
      json.materials=json.materials?.map((m:{name?:string})=>({name:m.name}));delete json.textures;delete json.images;
      for(const buffer of json.buffers||[])buffer.uri='data:application/octet-stream;base64,'+(await fs.readFile(path.replace(/[^/]+$/,buffer.uri))).toString('base64');
      bytes=Buffer.from(JSON.stringify(json));
    }
    return [name,(await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer,'')).scene];
  }))) as ModelTemplates;
});
afterAll(()=>vi.unstubAllGlobals());

// A connected chain of 2.4-wide clear discs proves that a complete passage
// exists, rather than measuring unrelated gaps on either side of an obstacle.
function passage(layout: ShipLayout, cabin: ShipCabin): ShipPoint[] | undefined {
  const ring=layout.rings[cabin.ring],angle=cabinAngle(layout,cabin.slot),half=ring.radius*Math.PI/layout.allocation.sectors;
  const columns=Math.ceil(half*2/.4),rows=Math.ceil(ring.depth/.15);
  const point=(x:number,y:number)=>shipPoint(ring.radius-ring.depth/2+ring.depth*y/rows,angle+(-half+2*half*x/columns)/ring.radius);
  let previous=new Map<number,ShipPoint[]>();
  for(let x=0;x<=columns;x++){
    const next=new Map<number,ShipPoint[]>();
    for(let y=0;y<=rows;y++){
      const p=point(x,y);
      if(!isWalkable(p,layout,SHIP_AISLE_WIDTH/2,cabin.deck))continue;
      if(!x){if(Math.abs(Math.hypot(p.x,p.z)-ring.radius)<.25)next.set(y,[p]);continue;}
      for(const dy of [0,-1,1,-2,2]){
        const path=previous.get(y+dy);
        if(path&&walkableSegment(path.at(-1)!,p,layout,SHIP_AISLE_WIDTH/2,cabin.deck)){next.set(y,[...path,p]);break;}
      }
    }
    previous=next;
    if(!previous.size)return;
  }
  return [...previous.values()].find(path=>Math.abs(Math.hypot(path.at(-1)!.x,path.at(-1)!.z)-ring.radius)<.25);
}

it.each([8,12,20])('keeps a continuous two-person passage through every sector on all decks at %s sectors',sectors=>{
    const roster={projects:[{id:'small',name:'Small'},{id:'medium',name:'Medium'},{id:'large',name:'Large'}],members:[3,6,8].flatMap((n,i)=>Array.from({length:n},(_,j)=>({id:`w${i}-${j}`,projectId:['small','medium','large'][i]})))};
    const full=buildShipLayout(roster,{version:1,sectors,projects:{}});
    for(const seat of Object.values(full.seats))expect(Math.abs(Math.hypot(seat.x,seat.z)-full.rings[seat.ring].radius)-maxCrewRadius).toBeGreaterThan(SHIP_AISLE_WIDTH/2);
    for(const deck of [0,1,2] as const){
      const layout=shipDeck(full,deck),scene=buildShipGeometry(layout,models),boxes=scene.userData.shipCollisionBoxes as FurnitureBox[];
      const unregister=registerFurniture(layout,boxes);
      try {
        for(const cabin of layout.cabins)expect.soft(passage(layout,cabin),`${cabin.id} (${cabin.kind}) on deck ${deck}`).toBeDefined();
        for(const cabin of layout.cabins.filter(c=>c.kind==='garden'))expect(scene.userData.shipObjects.filter((o:{cabinId:string;kind:string})=>o.cabinId===cabin.id&&o.kind==='rainforestTree').length).toBeGreaterThanOrEqual(18);
      } finally {unregister();disposeShipGeometry(scene);}
    }
},30000);

it.each(['lounge','observatory','work','reserve','garden','hydroponics','canteen','gym','servers','maintenance','cargo','quarters','return','monitor','cloning','bar','break','ai'] as const)('lets two maximum-size crew pass through the furnished %s without overlap or stalling',kind=>{
  const roster={projects:[{id:'p',name:'P'}],members:[{id:'worker',projectId:'p'}]};
  const layout=shipDeck(buildShipLayout(roster),0),scene=buildShipGeometry(layout,models),unregister=registerFurniture(layout,scene.userData.shipCollisionBoxes);
  try {
    const cabin=layout.cabins.find(c=>c.kind===kind)!,ring=layout.rings[cabin.ring],center=cabinAngle(layout,cabin.slot),offset=Math.PI/layout.allocation.sectors*.9;
    const paths=[-1,1].map(side=>routeBetweenCabins(layout,{ring:cabin.ring,angle:center+side*offset},cabin,center-side*offset));
    const radius=maxCrewRadius;
    const bodies=paths.map((path,i)=>({id:`crew-${i}`,position:{...path[0]},radius,deck:0})),owners=[{},{}],indices=[1,1];
    const seated=Object.values(layout.seats).map(seat=>({id:seat.agentId,position:seat,radius,deck:seat.deck}));
    for(let frame=0;frame<2400&&indices.some((n,i)=>n<paths[i].length);frame++){
      for(const [i,body] of bodies.entries()){
        const target=paths[i][indices[i]];if(!target)continue;
        body.position=walkCharacter(owners[i],body,target,.04,.05,[...bodies,...seated],layout);
        const distance=Math.hypot(body.position.x-target.x,body.position.z-target.z),following=paths[i][indices[i]+1];
        if(distance<.02||(distance<radius*2+.15&&occupiedWaypoint(body,target,bodies)&&(!following||walkableSegment(body.position,following,layout,.4))))indices[i]++;
        expect(isWalkable(body.position,layout,.4)).toBe(true);
      }
      expect(Math.hypot(bodies[0].position.x-bodies[1].position.x,bodies[0].position.z-bodies[1].position.z)).toBeGreaterThanOrEqual(2*radius+.03-1e-6);
    }
    expect(indices,JSON.stringify(bodies)).toEqual(paths.map(p=>p.length));
    expect(ring.depth).toBeGreaterThan(SHIP_AISLE_WIDTH);
  } finally {unregister();disposeShipGeometry(scene);}
},15000);
