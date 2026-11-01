import { Children, type ReactElement, type ReactNode, type RefObject } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BufferGeometry, Group, InstancedMesh, Material, Points, Matrix4, Vector3, Raycaster, type Intersection } from "three";
import { SpaceActivity } from "@/features/ring-ship/SpaceActivity";
import { emptySpaceMotion, emptySpaceEncounter, sampleSpaceEncounter } from "@/features/ring-ship/space-activity";
import type { ShipObject } from "@/features/ring-ship/shipObjects";

const hooks = vi.hoisted(() => ({ frame: null as ((state: unknown, delta: number) => void) | null }));
vi.mock("@react-three/fiber", () => ({ useFrame: (callback: typeof hooks.frame) => { hooks.frame = callback; }, useThree: () => ({ gl: { domElement: document.createElement("canvas") } }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("pauses hidden tabs, navigation and reduced motion without a catch-up burst, and resets on arrival", () => {
  let change = () => {};
  const media = { matches: false, addEventListener: vi.fn((_type: string, listener: () => void) => { change = listener; }), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => media);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const motion = { current: emptySpaceMotion() }, caption = { current: document.createElement("small") };
  const hook = renderHook(({ paused, seed }) => SpaceActivity({ radius: 46, seed, paused, motion, caption, enabled: true, selected: null, onSelect: vi.fn(), onExpire: vi.fn() }), { initialProps: { paused: false, seed: 1 } });
  const root = hook.result.current as ReactElement<{ ref: RefObject<Group | null>; children: ReactNode }>;
  const group = new Group(); root.props.ref.current = group;
  const children = Children.toArray(root.props.children) as ReactElement<{ ref: RefObject<InstancedMesh | Points | null>; args?: [BufferGeometry, Material, number]; geometry?: BufferGeometry; material?: Material }>[];
  for (const child of children) child.props.ref.current = child.props.args ? new InstancedMesh(...child.props.args) : new Points(child.props.geometry, child.props.material);
  const tick = (delta = .05) => act(() => hooks.frame?.({}, delta));
  tick(); expect(motion.current.elapsed).toBe(.05); expect(group.visible).toBe(true);
  hidden.mockReturnValue(true); tick(30); expect(motion.current.elapsed).toBe(.05); expect(group.visible).toBe(false);
  hidden.mockReturnValue(false); tick(30); expect(motion.current.elapsed).toBeCloseTo(.15);
  hook.rerender({ paused: true, seed: 1 }); tick(); expect(motion.current.elapsed).toBeCloseTo(.15);
  hook.rerender({ paused: false, seed: 1 }); media.matches = true; change(); tick(); expect(motion.current.elapsed).toBeCloseTo(.15);
  media.matches = false; change(); tick(); expect(motion.current.elapsed).toBeCloseTo(.2);
  hook.rerender({ paused: false, seed: 2 }); expect(motion.current.elapsed).toBe(0);
  hook.unmount(); expect(media.removeEventListener).toHaveBeenCalledTimes(1);
});

it("picks instanced space objects, tracks moving bounds, rejects drags and occluded hits, and expires the original encounter", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const motion = { current: emptySpaceMotion() }, caption = { current: null }, onSelect = vi.fn(), onExpire = vi.fn();
  const hook = renderHook(({ selected }: { selected: ShipObject | null }) => SpaceActivity({ radius: 46, seed: 1, paused: false, enabled: true, motion, caption, selected, onSelect, onExpire }), { initialProps: { selected: null as ShipObject | null } });
  type ElementProps = { ref: RefObject<InstancedMesh | Points | null>; args?: [BufferGeometry, Material, number]; geometry?: BufferGeometry; material?: Material; onClick: (event: object) => void; raycast: (ray: Raycaster, hits: Intersection[]) => void };
  const elements = () => Children.toArray((hook.result.current as ReactElement<{ children: ReactNode }>).props.children) as ReactElement<ElementProps>[];
  const root = hook.result.current as ReactElement<{ ref: RefObject<Group | null> }>;
  root.props.ref.current = new Group();
  for (const child of elements()) child.props.ref.current = child.props.args ? new InstancedMesh(...child.props.args) : new Points(child.props.geometry, child.props.material);
  const tick = () => act(() => hooks.frame?.({}, .05));
  tick();
  const event = { instanceId: 0, delta: 0, distance: 10, intersections: [], stopPropagation: vi.fn() };
  act(() => elements()[0].props.onClick({ ...event, delta: 9 }));
  act(() => elements()[0].props.onClick({ ...event, intersections: [{ distance: 5 }] }));
  expect(onSelect).not.toHaveBeenCalled();
  act(() => elements()[0].props.onClick(event));
  const rock = onSelect.mock.calls[0][0] as ShipObject;
  expect(rock.kind).toBe("asteroid"); expect(rock.bounds.isEmpty()).toBe(false);
  hook.rerender({ selected: rock });
  const before = rock.bounds.clone(); tick(); expect(rock.bounds.equals(before)).toBe(false);
  motion.current.elapsed = 240; tick(); tick(); expect(onExpire).toHaveBeenCalledTimes(1);

  hook.rerender({ selected: null });
  const encounter = sampleSpaceEncounter(0, 1, emptySpaceEncounter());
  motion.current.elapsed = (encounter.trafficStartsIn + encounter.trafficEndsIn) / 2; tick();
  const shipMesh = elements()[1].props.ref.current as InstancedMesh;
  const center = new Vector3();
  // Use the actual instance matrix and triangle raycast, including its broad-phase bounds.
  const matrix = new Matrix4(); shipMesh.getMatrixAt(0, matrix);
  center.copy(shipMesh.geometry.boundingBox!.getCenter(new Vector3())).applyMatrix4(matrix);
  const hits: Intersection[] = [];
  elements()[1].props.raycast(new Raycaster(center.clone().add(new Vector3(0, 0, 20)), new Vector3(0, 0, -1)), hits);
  expect(hits.some(hit => hit.instanceId === 0)).toBe(true);
  act(() => elements()[1].props.onClick(event));
  const ship = onSelect.mock.calls.at(-1)![0] as ShipObject;
  expect(ship.kind).toBe(encounter.trafficSize > 1 ? "passingFleet" : "passingShip");
  hook.rerender({ selected: ship }); motion.current.elapsed = encounter.trafficEndsIn + 1; tick(); tick();
  expect(onExpire).toHaveBeenCalledTimes(2);
  hook.unmount();
});
