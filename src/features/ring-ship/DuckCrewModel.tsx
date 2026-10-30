import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AGENT_SCALE, WALK_ANIM_SPEED } from "@/features/retro-office/core/constants";
import { toWorld } from "@/features/retro-office/core/geometry";
import type { AgentModelProps } from "@/features/retro-office/objects/types";
import { createDuckCrewFigure } from "./duckCrewFigure";

export const DuckCrewModel = memo(function DuckCrewModel({
  agentId, agentsRef, agentLookupRef, initialPosition, onHover, onUnhover, onClick,
}: Pick<AgentModelProps, "agentId" | "agentsRef" | "agentLookupRef" | "initialPosition" | "onHover" | "onUnhover" | "onClick">) {
  const group = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const figure = useMemo(() => createDuckCrewFigure(), []);
  const animation = useRef(figure);
  useEffect(() => () => figure.dispose(), [figure]);

  useFrame((_, delta) => {
    const agent = agentLookupRef?.current.get(agentId) ?? agentsRef.current.find(value => value.id === agentId);
    if (!group.current) return;
    group.current.visible = !!agent;
    if (!agent) return;
    const rig = animation.current;
    const [x, , z] = toWorld(agent.x, agent.y), rate = 1 - Math.exp(-Math.min(delta, 0.1) * 12);
    target.set(x, 0.08, z); group.current.position.lerp(target, rate);
    group.current.rotation.y += Math.atan2(Math.sin(agent.facing - group.current.rotation.y), Math.cos(agent.facing - group.current.rotation.y)) * rate;
    const walking = agent.state === "walking", seated = agent.state === "sitting";
    const phase = agent.frame * WALK_ANIM_SPEED + (agent.phaseOffset ?? 0);
    const stride = Math.sin(phase), working = agent.status === "working" && agent.interactionTarget === "desk";
    const typing = working && agent.frame % 1100 < 780;
    const seatOffset = seated ? Math.max(0, ((agent.workstation?.seatHeight ?? 0.4) - 0.08) / AGENT_SCALE - 0.065) : 0;
    rig.root.position.y = seatOffset + (walking ? Math.abs(stride) * 0.012 : Math.sin(phase * 0.23) * 0.003);
    rig.body.rotation.z = walking ? stride * 0.055 : 0;
    rig.body.rotation.x = working ? 0.07 : 0;
    rig.body.rotation.y = working ? typing ? 0 : Math.sin(phase * 0.12) * 0.12 : Math.sin(phase * 0.08) * 0.06;
    rig.wings.forEach((wing, index) => {
      const side = index ? 1 : -1;
      wing.rotation.x = walking ? side * stride * 0.3 : typing ? -1.05 + Math.sin(agent.frame * 0.45 + index * Math.PI) * 0.07 : working ? -0.4 : 0;
      wing.rotation.z = side * (typing ? 0.16 : 0.03);
    });
    rig.feet.forEach((foot, index) => {
      const step = (index ? -1 : 1) * stride;
      foot.rotation.x = walking ? step * 0.48 : seated ? -0.45 : 0;
      foot.position.y = 0.075 + (walking ? Math.max(0, step) * 0.022 : seated ? 0.015 : 0);
    });
  });

  return <group ref={group} name={`duck-crew:${agentId}`} position={initialPosition} scale={AGENT_SCALE}
    onPointerOver={event => { event.stopPropagation(); onHover?.(agentId); }}
    onPointerOut={() => onUnhover?.()}
    onClick={event => { event.stopPropagation(); onClick?.(agentId); }}>
    <primitive object={figure.root} dispose={null} />
  </group>;
});
