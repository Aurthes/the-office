"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Group } from "three";
import { captureCollisionGeometry, type CollisionWorld } from "../core/collision";
import { getItemRotationRadians } from "../core/geometry";
import type { FurnitureItem } from "../core/types";

/** Capture actual rendered solids after child layout/instance matrices commit. */
export function SceneColliders({ world, source, revision, layout, children }: {
  world: CollisionWorld; source: string; revision?: unknown; layout?: unknown; children: ReactNode;
}) {
  const root = useRef<Group>(null);
  useLayoutEffect(() => {
    if (root.current) world.set(source, captureCollisionGeometry(root.current, source), layout);
    return () => world.delete(source);
  }, [world, source, revision, layout]);
  return <group ref={root}>{children}</group>;
}

export function CollisionItem({ item, children }: { item: FurnitureItem; children: ReactNode }) {
  return <group userData={{ collisionItem: { id: item._uid, rotation: getItemRotationRadians(item) } }}>{children}</group>;
}
