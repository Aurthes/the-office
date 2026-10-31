"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AGENT_SCALE } from "@/features/retro-office/core/constants";
import type { DuckAppearance } from "@/lib/avatars/duck";
import { createDuckCrewFigure } from "./duckCrewFigure";
import { cabinAngle, DECK_STEP, shipPoint, type DeckIndex, type ShipLayout } from "./layout";
import { returnPodNose } from "./returnPodGeometry";
import { createReturnPodEffects } from "./returnPodEffects";
import { routePoint, returnStage, type ArchiveResult, type ReturnStage, type ReturnTransfer, type returnRoute } from "./returnPodMotion";

export type ReturnFlight = ReturnType<typeof returnRoute> & { requestId: string; agentId: string; name: string; appearance?: DuckAppearance };
const ease = (p: number) => { const t = Math.max(0,Math.min(1,p)); return t*t*(3-2*t); };

// Original lightweight geometry; Metekohy's Sketchfab model is a visual
// reference only. No third-party mesh or texture files are bundled.
function Pod({ bodyRef, doorRef, open = false }: {
  bodyRef?: RefObject<THREE.Group|null>; doorRef?: RefObject<THREE.Group|null>; open?: boolean;
}) {
  const nose = useMemo(() => returnPodNose(), []);
  const body = useMemo(() => [[.66,0],[.73,-.10],[.76,-.28],[.76,-2.25]].map(([r,y])=>new THREE.Vector2(r,y)),[]);
  return <group ref={bodyRef} name="return-capsule">
    <mesh><latheGeometry args={[body,32]}/><meshStandardMaterial color="#263c47" metalness={.3} roughness={.7} side={THREE.DoubleSide}/></mesh>
    <mesh><latheGeometry args={[nose,40]}/><meshStandardMaterial color="#b99b64" metalness={.35} roughness={.65}/></mesh>
    {[-.55,-1.25,-1.95].map((y,i)=><mesh key={y} position={[0,y,0]} rotation={[0,Math.PI/8,0]}>
      <cylinderGeometry args={[.84,.84,.62,8,1,true]}/><meshStandardMaterial color={i===1?"#3e5159":"#30444e"} metalness={.25} roughness={.78} flatShading side={THREE.DoubleSide}/>
    </mesh>)}
    {[-.15,-2.23].map(y=><mesh key={y} position={[0,y,0]} rotation={[Math.PI/2,0,0]}>
      <torusGeometry args={[.758,.022,4,32]}/><meshStandardMaterial color="#d0aa59" metalness={.25} roughness={.65}/>
    </mesh>)}
    {[[0,-.34],[-.15,-.58],[.15,-.58]].map(([x,y],i)=><mesh key={i} position={[x,y,.79]} rotation={[Math.PI/2,0,0]}>
      <cylinderGeometry args={[.065,.065,.025,12]}/><meshStandardMaterial color="#9aa7a7" metalness={.4} roughness={.6}/>
    </mesh>)}
    {[-1,1].map(side=><mesh key={side} position={[side*.78,-.3,0]}>
      <boxGeometry args={[.07,.34,.27]}/><meshStandardMaterial color="#283d48" roughness={.8}/>
    </mesh>)}
    <group ref={doorRef} position={[-.72,.06,0]} rotation={[0,0,open?Math.PI/2:0]} name="return-top-hatch">
      <mesh position={[.72,0,0]}><cylinderGeometry args={[.70,.70,.09,32]}/><meshStandardMaterial color="#3c535f" roughness={.65} metalness={.3}/></mesh>
      <mesh position={[.72,.055,0]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.59,.025,4,32]}/><meshStandardMaterial color="#e0b75b" roughness={.7}/></mesh>
      <mesh position={[.72,.052,0]}><boxGeometry args={[.28,.014,.10]}/><meshStandardMaterial color="#9ab5b9" roughness={.75}/></mesh>
    </group>
  </group>;
}

export function ReturnPodBay({ layout, active = false }: {layout:ShipLayout; active?:boolean}) {
  const bay=layout.cabins.find(c=>c.kind==="return");
  if(!bay) return null;
  const angle=cabinAngle(layout,bay.slot), p=shipPoint(layout.rings[bay.ring].radius+1.8,angle);
  return <group position={[p.x,.08,p.z]} rotation={[0,angle,0]} name="return-launch-well">
    <mesh position={[0,-2.12,0]}><cylinderGeometry args={[.98,.98,4.3,40,1,true]}/><meshStandardMaterial color="#273e4d" side={THREE.DoubleSide} roughness={.8}/></mesh>
    <mesh position={[0,-2.23,0]}><cylinderGeometry args={[1.42,1.42,4.04,40,1,true]}/><meshStandardMaterial color="#344d5b" side={THREE.DoubleSide} roughness={.8}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.12,0]}><ringGeometry args={[.86,1.5,40]}/><meshStandardMaterial color="#ca9e51" roughness={.8} side={THREE.DoubleSide}/></mesh>
    <mesh position={[0,-4.25,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.88,1.48,40]}/><meshStandardMaterial color="#425969" roughness={.7} side={THREE.DoubleSide}/></mesh>
    {!active ? <Pod/> : null}
  </group>;
}

export function ReturnPodJourney({ flight, resultRef, transferRef, displayDeck, onStage, onComplete }: {
  flight:ReturnFlight; resultRef:RefObject<ArchiveResult>; transferRef:RefObject<ReturnTransfer>;
  displayDeck:DeckIndex;
  onStage:(stage:ReturnStage)=>void; onComplete:()=>void;
}) {
  const podRef=useRef<THREE.Group>(null), doorRef=useRef<THREE.Group>(null), walkerRef=useRef<THREE.Group>(null);
  const startRef=useRef<number|null>(null), stageRef=useRef<ReturnStage|null>(null), doneAt=useRef<number|null>(null), finished=useRef(false);
  const figure=useMemo(()=>createDuckCrewFigure(flight.appearance),[flight.appearance]);
  const figureRef=useRef(figure);
  useLayoutEffect(()=>{figureRef.current=figure;},[figure]);
  const effects=useMemo(()=>createReturnPodEffects(),[]);
  useEffect(()=>()=>figure.dispose(),[figure]);
  useEffect(()=>()=>effects.dispose(),[effects]);
  useFrame(({camera})=>{
    const now=performance.now(); if(startRef.current===null) startRef.current=now;
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const elapsed=(now-startRef.current)/1000, transfer=transferRef.current;
    const transferAt=flight.legs.length>1?flight.legs[0].duration:Infinity;
    if (!reduced && elapsed>=transferAt && transfer.startedAt===undefined && resultRef.current.status!=="failed") transfer.startedAt=now;
    const inLift=transfer.startedAt!==undefined && transfer.completedAt===undefined;
    const paused=transfer.startedAt===undefined?0:((transfer.completedAt??now)-transfer.startedAt)/1000;
    const clock=elapsed-paused;
    const result=resultRef.current, timed={...result,at:result.at===undefined?undefined:(result.at-startRef.current)/1000-paused};
    // Neither elapsed animation time nor a lost response may imply success.
    const phase=inLift && result.status!=="failed" ? {stage:"transferring" as const,launch:0} : returnStage(
      reduced?Math.max(flight.duration+(result.status==="confirmed"?4:2),clock):clock,flight.duration,timed);
    if(phase.stage!==stageRef.current){stageRef.current=phase.stage;onStage(phase.stage);}
    const walker=walkerRef.current, pod=podRef.current, door=doorRef.current;
    if(!walker||!pod||!door) return;
    if(phase.stage!=="failed") {
      const legIndex=flight.legs.length>1 && clock>=transferAt?1:0, leg=flight.legs[legIndex];
      const localClock=clock-(legIndex?transferAt:0), move=localClock/leg.duration;
      const boarding=Math.max(0,clock-flight.duration);
      const p=clock<flight.duration?routePoint(leg.points,move):{
        x:THREE.MathUtils.lerp(flight.entry.x,flight.pod.x,ease(boarding/.45)),
        z:THREE.MathUtils.lerp(flight.entry.z,flight.pod.z,ease(boarding/.45))};
      const ahead=routePoint(leg.points,Math.min(1,move+.015));
      const lowered=clock>=flight.duration?ease((boarding-.45)/.75)*1.7:0;
      const stepUp=clock>=flight.duration ? .14*ease(boarding/.12) : 0;
      walker.position.set(p.x,leg.deck*DECK_STEP+.08+stepUp-lowered,p.z);
      walker.rotation.y=clock<flight.duration?Math.atan2(ahead.x-p.x,ahead.z-p.z):flight.angle;
      const stride=clock<flight.duration||boarding<.45?Math.sin(elapsed*14):0;
      const rig=figureRef.current;
      rig.body.rotation.z=stride*.045;rig.feet.forEach((foot,i)=>{foot.rotation.x=stride*(i?-1:1)*.4;});
      walker.visible=!reduced&&!inLift&&displayDeck===leg.deck&&clock<flight.duration+1.2;
      door.rotation.z=Math.PI/2*(1-ease((clock-flight.duration-1.2)/.8));
    }
    if(phase.stage==="failed" && Math.round(walker.position.y/DECK_STEP)!==displayDeck) walker.visible=false;
    if(phase.stage==="launching"||phase.stage==="done") pod.position.y=-(12*phase.launch+4*phase.launch*phase.launch);
    effects.update(!reduced && phase.stage==="launching" ? phase.launch : null,pod.position.y,camera);
    if(phase.stage==="done") {
      if(doneAt.current===null) doneAt.current=now;
      if(!finished.current && (reduced||now-doneAt.current>=850)){finished.current=true;onComplete();}
    }
  });
  const first=flight.legs[0];
  return <>
    <group ref={walkerRef} position={[first.points[0].x,first.deck*DECK_STEP+.08,first.points[0].z]} scale={AGENT_SCALE}><primitive object={figure.root} dispose={null}/></group>
    <group position={[flight.pod.x,.08,flight.pod.z]} rotation={[0,flight.angle,0]} visible={displayDeck===0}><Pod bodyRef={podRef} doorRef={doorRef} open/><primitive object={effects.root} dispose={null}/></group>
  </>;
}
