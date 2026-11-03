"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useCursor } from "@react-three/drei";
import * as THREE from "three";
import type { DuckAppearance } from "@/lib/avatars/duck";
import { AGENT_SCALE } from "@/features/retro-office/core/constants";
import { useUiText } from "@/lib/i18n/ui-language";
import { cabinAngle, DECK_STEP, type ShipCabin, type ShipLayout, type ShipPoint } from "./layout";
import { createDuckCrewFigure } from "./duckCrewFigure";
import { clonePose, cloneStage, cloningPoint, type CloneResult, type CloneStage } from "./cloneMotion";
import { CLONING_POD, CLONING_STEPS } from "./cloningGeometry";
import type { ShipObject } from "./shipObjects";

export type CloneFlight = { requestId: string; agentId: string; name: string; appearance?: DuckAppearance; cloneAppearance?: DuckAppearance };
function Pod({ index, door, cabin, interactive, selectedId, onSelect }: { index: number; door: (node: THREE.Group | null) => void; cabin: ShipCabin; interactive: boolean; selectedId?: string; onSelect?: (object: ShipObject) => void }) {
  const group=useRef<THREE.Group>(null),[hovered,setHovered]=useState(false),id=`${cabin.id}:pod:${index}`;
  useCursor(interactive&&hovered);
  const accent = hovered||selectedId===id ? "#ffe0a6" : index ? "#b4a6fa" : "#7de5d2";
  return <group ref={group} position={[(index?1:-1)*CLONING_POD.spacing, 0, CLONING_POD.v]} name={`cloning-pod:${index}`}
    onPointerOver={event=>{if(interactive){event.stopPropagation();setHovered(true);}}} onPointerOut={()=>setHovered(false)}
    onClick={event=>{
      if(!interactive||!group.current)return;event.stopPropagation();if(event.delta>=6)return;
      group.current.updateWorldMatrix(true,true);
      const bounds=new THREE.Box3().setFromObject(group.current).translate(new THREE.Vector3(0,-cabin.deck*DECK_STEP,0));
      onSelect?.({id,kind:"cloningPod",cabinId:cabin.id,cabinName:cabin.name,deck:cabin.deck,bounds,parts:[]});
    }}>
    <mesh position={[0,.2,0]}><boxGeometry args={[CLONING_POD.width,.4,CLONING_POD.length]}/><meshStandardMaterial color="#344c5b" metalness={.35} roughness={.55}/></mesh>
    <mesh position={[0,.48,0]}><boxGeometry args={[1.48,.16,2.7]}/><meshStandardMaterial color="#c4d6d6" roughness={.85}/></mesh>
    {[-1,1].map(side=><group key={side}>
      <mesh position={[side*.91,.5,0]}><boxGeometry args={[.12,.2,3]}/><meshStandardMaterial color="#75949e" metalness={.5} roughness={.5}/></mesh>
      <mesh position={[side*.94,.3,0]}><boxGeometry args={[.035,.06,2.45]}/><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.5}/></mesh>
    </group>)}
    {CLONING_STEPS.map((step,i)=><mesh key={step.v} position={[0,step.y,step.v]}><boxGeometry args={[step.width,step.height,step.length]}/><meshStandardMaterial color={i?"#4f6975":"#718b95"} roughness={.7}/></mesh>)}
    <mesh position={[0,.83,1.48]}><boxGeometry args={[1.7,.65,.22]}/><meshStandardMaterial color="#243e4d" roughness={.6}/></mesh>
    <mesh position={[0,.9,1.35]}><boxGeometry args={[.85,.23,.03]}/><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={.7}/></mesh>
    <group ref={door} position={[0,.75,1.38]} name={`cloning-canopy:${index}`}>
      <mesh position={[0,.18,-1.4]}><boxGeometry args={[1.65,.5,2.8]}/><meshPhysicalMaterial color="#9cdedc" transparent opacity={.19} roughness={.16} metalness={.1} depthWrite={false}/></mesh>
      {[-1,1].map(side=><mesh key={side} position={[side*.85,.18,-1.4]}><boxGeometry args={[.08,.5,2.85]}/><meshStandardMaterial color="#688a99" metalness={.45} roughness={.5}/></mesh>)}
      <mesh position={[0,.18,-2.8]}><boxGeometry args={[1.75,.5,.09]}/><meshStandardMaterial color="#688a99" metalness={.45} roughness={.5}/></mesh>
    </group>
  </group>;
}
function Passenger({ appearance, index, onReady }: { appearance?: DuckAppearance; index: number; onReady: (node: THREE.Group | null) => void }) {
  const figure = useMemo(()=>{const figure=createDuckCrewFigure(appearance);figure.root.rotation.x=-Math.PI/2;return figure;},[appearance]);
  const group=useRef<THREE.Group|null>(null);
  const rig=useRef(figure);
  useLayoutEffect(()=>{rig.current=figure;},[figure]);
  useEffect(()=>()=>figure.dispose(),[figure]);
  useFrame(()=>{
    const pose = group.current?.userData.pose as ReturnType<typeof clonePose> | undefined;
    if (!pose) return;
    const figure=rig.current;
    figure.root.rotation.x = pose.tilt;
    const stride = pose.walking ? Math.sin(performance.now() / 85 + index) : 0;
    figure.body.rotation.z = stride*.035;
    figure.feet.forEach((foot,i)=>{foot.rotation.x = stride*(i?1:-1)*.4;});
    figure.wings.forEach((wing,i)=>{wing.rotation.x=pose.walking?stride*(i?1:-1)*.25:-.25;});
  });
  return <group ref={node=>{group.current=node;onReady(node);}} name={`cloning-passenger:${index}`} scale={AGENT_SCALE} visible={index===0}><primitive object={figure.root} dispose={null}/></group>;
}
function Sequence({ layout, cabin, flight, resultRef, onStage, onComplete }: {
  layout: ShipLayout; cabin: ShipCabin; flight: CloneFlight; resultRef: RefObject<CloneResult>;
  onStage: (stage: CloneStage) => void; onComplete: (points: ShipPoint[]) => void;
}) {
  const poses=useRef<Array<THREE.Group|null>>([]),lastStage=useRef<CloneStage|null>(null),finished=useRef(false);
  useFrame(()=>{
    if(finished.current)return;
    const result=resultRef.current,reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seconds=result.status==="confirmed" ? reduced ? 6 : Math.max(0,(performance.now()-result.at)/1000) : 0;
    const stage=cloneStage(seconds,result);
    if(stage!==lastStage.current){lastStage.current=stage;onStage(stage);}
    for(let i=0;i<2;i++){
      const actor=poses.current[i],pose=clonePose(seconds,i);if(!actor)continue;
      const point=cloningPoint(layout,cabin,pose.u,pose.v);
      actor.position.set(point.x,cabin.deck*DECK_STEP+pose.y,point.z);actor.rotation.y=cabinAngle(layout,cabin.slot)+Math.PI;
      actor.userData.pose=pose;actor.visible=i===0||(result.status==="confirmed"&&!!flight.cloneAppearance);
    }
    if(stage==="complete"||stage==="failed"){
      finished.current=true;onComplete([0,1].map(i=>{const p=clonePose(6,i);return cloningPoint(layout,cabin,p.u,p.v);}));
    }
  });
  return <group name="cloning-sequence"><Passenger appearance={flight.appearance} index={0} onReady={node=>{poses.current[0]=node;}}/><Passenger appearance={flight.cloneAppearance} index={1} onReady={node=>{poses.current[1]=node;}}/></group>;
}
export function CloningLab({ layout, cabin, flight, resultRef, onStage, onComplete, interactive = false, selectedId, onSelect }: {
  layout: ShipLayout; cabin: ShipCabin; flight?: CloneFlight | null; resultRef: RefObject<CloneResult>;
  onStage: (stage: CloneStage) => void; onComplete: (points: ShipPoint[]) => void;
  interactive?: boolean; selectedId?: string; onSelect?: (object: ShipObject) => void;
}) {
  const t=useUiText(),doors=useRef<Array<THREE.Group|null>>([]),center=cloningPoint(layout,cabin,0,0),angle=cabinAngle(layout,cabin.slot);
  useFrame(()=>{
    const result=resultRef.current,seconds=flight&&result.status==="confirmed"?(performance.now()-result.at)/1000:0;
    for(const door of doors.current)if(door)door.rotation.x=flight?-clonePose(seconds,0).door*1.25:0;
  });
  return <>
    <group position={[center.x,cabin.deck*DECK_STEP,center.z]} rotation={[0,angle,0]} name="cloning-laboratory">
      <Pod index={0} cabin={cabin} interactive={interactive&&!flight} selectedId={selectedId} onSelect={onSelect} door={node=>{doors.current[0]=node;}}/><Pod index={1} cabin={cabin} interactive={interactive&&!flight} selectedId={selectedId} onSelect={onSelect} door={node=>{doors.current[1]=node;}}/>
      <mesh position={[0,.04,.1]}><boxGeometry args={[6.5,.06,5.35]}/><meshStandardMaterial color="#36535d" roughness={.8}/></mesh>
      <mesh position={[0,.12,-2.15]}><boxGeometry args={[6.2,.015,.055]}/><meshStandardMaterial color="#85d6c7" emissive="#85d6c7" emissiveIntensity={.5}/></mesh>
      <Html transform position={[0,2.7,2.45]} rotation={[0,Math.PI,0]} distanceFactor={4} zIndexRange={[10,9]}><div className="rounded-lg border border-teal-200/35 bg-[#122e3a] px-5 py-3 text-center text-teal-100"><strong className="block whitespace-nowrap text-lg">{t("Cloning laboratory")}</strong><span className="text-[10px] uppercase tracking-widest">{t("One history · Two futures")}</span></div></Html>
    </group>
    {flight?<Sequence key={flight.requestId} layout={layout} cabin={cabin} flight={flight} resultRef={resultRef} onStage={onStage} onComplete={onComplete}/>:null}
  </>;
}
