import * as THREE from "three";
import { AGENT_HEIGHT } from "@/features/retro-office/core/constants";
import { collisionBounds, circleHitsBox, segmentHitsBox, type CollisionBox } from "@/features/retro-office/core/collision";
import type { ShipLayout, ShipPoint } from "./layout";
import type { ShipObject } from "./shipObjects";

export type CollisionActor = { id: string; reservedSeat?: string };
export type SeatAccess = { key: string; cabinId: string; point: ShipPoint; facing: number };
export type FurnitureBox = CollisionBox & { deck: number; access?: SeatAccess[] };
const CELL = 4;
const scenes = new WeakMap<ShipLayout["allocation"], Map<number, { boxes: FurnitureBox[]; cells: Map<string, FurnitureBox[]> }>>();

// Capture the low, solid part of each selectable prop before material batching.
// Clipping at head height keeps tree canopies and overhead equipment out of paths.
export class FurnitureCapture {
  private records = new Map<ShipObject, { yaw: number; bounds: THREE.Box3 }>();
  angle(object: ShipObject, yaw: number) { if (!this.records.has(object)) this.records.set(object, { yaw, bounds: new THREE.Box3() }); }
  add(object: ShipObject, geometry: THREE.BufferGeometry) {
    geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.max.y <= .12 || geometry.boundingBox.min.y >= AGENT_HEIGHT) return;
    this.angle(object, 0);
    const record = this.records.get(object)!, positions = geometry.getAttribute("position"), c = Math.cos(record.yaw), s = Math.sin(record.yaw), point = new THREE.Vector3();
    const include = (x: number, y: number, z: number) => record.bounds.expandByPoint(point.set(c*x-s*z,y,s*x+c*z));
    for (let i = 0; i < positions.count; i += 3) {
      for (let j = 0; j < 3; j++) {
        const a=i+j,b=i+(j+1)%3,ay=positions.getY(a),by=positions.getY(b);
        if (ay <= AGENT_HEIGHT) include(positions.getX(a),ay,positions.getZ(a));
        if ((ay<AGENT_HEIGHT&&by>AGENT_HEIGHT)||(ay>AGENT_HEIGHT&&by<AGENT_HEIGHT)) {
          const t=(AGENT_HEIGHT-ay)/(by-ay);
          include(positions.getX(a)+(positions.getX(b)-positions.getX(a))*t,AGENT_HEIGHT,positions.getZ(a)+(positions.getZ(b)-positions.getZ(a))*t);
        }
      }
    }
  }
  finish(seats: readonly SeatAccess[] = []): FurnitureBox[] {
    return [...this.records].flatMap(([object,{yaw,bounds}])=>{
      if(bounds.isEmpty())return[];
      const center=bounds.getCenter(new THREE.Vector3()).applyAxisAngle(THREE.Object3D.DEFAULT_UP,yaw),size=bounds.getSize(new THREE.Vector3());
      const canSit=["workstation","chairDesk","breakChair","controlDesk","loungeSofa","loungeDesignChair","chairModernCushion"].includes(object.kind);
      const access=canSit?seats.filter(seat=>seat.cabinId===object.cabinId&&object.bounds.distanceToPoint(new THREE.Vector3(seat.point.x,.5,seat.point.z))<.8):[];
      return [{owner:object.id,deck:object.deck,x:center.x,y:center.z,halfX:size.x/2,halfY:size.z/2,angle:-yaw,bottom:bounds.min.y,top:bounds.max.y,access}];
    });
  }
}

export function registerFurniture(layout: ShipLayout, boxes: readonly FurnitureBox[]) {
  let decks=scenes.get(layout.allocation);if(!decks){decks=new Map();scenes.set(layout.allocation,decks);}
  const installed=new Map<number,{boxes:FurnitureBox[];cells:Map<string,FurnitureBox[]>}>();
  for(const deck of new Set(layout.cabins.map(c=>c.deck))){
    const state={boxes:boxes.filter(box=>box.deck===deck),cells:new Map<string,FurnitureBox[]>()};
    for(const box of state.boxes){const b=collisionBounds(box);for(let x=Math.floor(b.x/CELL);x<=Math.floor((b.x+b.w)/CELL);x++)for(let z=Math.floor(b.y/CELL);z<=Math.floor((b.y+b.h)/CELL);z++){const key=`${x}:${z}`;const cell=state.cells.get(key)||[];cell.push(box);state.cells.set(key,cell);}}
    decks.set(deck,state);installed.set(deck,state);
  }
  return()=>{for(const [deck,state] of installed)if(decks!.get(deck)===state)decks!.delete(deck);};
}
export function furnitureNear(layout: ShipLayout, deck: number, from: ShipPoint, padding: number, to=from): FurnitureBox[] {
  const cells=scenes.get(layout.allocation)?.get(deck)?.cells;if(!cells)return[];
  const found=new Set<FurnitureBox>();
  for(let x=Math.floor((Math.min(from.x,to.x)-padding)/CELL);x<=Math.floor((Math.max(from.x,to.x)+padding)/CELL);x++)for(let z=Math.floor((Math.min(from.z,to.z)-padding)/CELL);z<=Math.floor((Math.max(from.z,to.z)+padding)/CELL);z++)for(const box of cells.get(`${x}:${z}`)||[])found.add(box);
  return [...found];
}

function passage(box: CollisionBox, actor?: CollisionActor) { return actor&&(box as FurnitureBox).access?.find(seat=>seat.key===actor.id||seat.key===actor.reservedSeat); }
function seatLocal(point: ShipPoint, seat: SeatAccess) { const dx=point.x-seat.point.x,dz=point.z-seat.point.z,c=Math.cos(seat.facing),s=Math.sin(seat.facing);return{x:c*dx-s*dz,z:s*dx+c*dz}; }
export function furnitureHitsPoint(box: CollisionBox, point: ShipPoint, padding: number, actor?: CollisionActor) {
  const seat=passage(box,actor),p=seat&&seatLocal(point,seat);
  if(p&&Math.abs(p.x)<=.95&&p.z>=-1.4&&p.z<=.12)return false;
  return circleHitsBox({x:point.x,y:point.z},box,padding);
}
export function furnitureHitsSegment(box: CollisionBox, from: ShipPoint, to: ShipPoint, padding: number, actor?: CollisionActor) {
  const seat=passage(box,actor);
  const hit=(a:ShipPoint,b:ShipPoint)=>segmentHitsBox({x:a.x,y:a.z},{x:b.x,y:b.z},box,padding);
  if(!seat)return hit(from,to);
  const a=seatLocal(from,seat),b=seatLocal(to,seat);let low=0,high=1;
  for(const [start,delta,min,max] of [[a.x,b.x-a.x,-.95,.95],[a.z,b.z-a.z,-1.4,.12]]){
    if(Math.abs(delta)<1e-9){if(start<min||start>max)return hit(from,to);continue;}
    const t1=(min-start)/delta,t2=(max-start)/delta;low=Math.max(low,Math.min(t1,t2));high=Math.min(high,Math.max(t1,t2));
    if(low>high)return hit(from,to);
  }
  const at=(t:number)=>({x:from.x+(to.x-from.x)*t,z:from.z+(to.z-from.z)*t});
  return (low>1e-7&&hit(from,at(low)))||(high<1-1e-7&&hit(at(high),to));
}
