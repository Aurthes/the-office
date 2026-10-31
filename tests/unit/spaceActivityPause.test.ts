import { Children, type ReactElement, type ReactNode, type RefObject } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BufferGeometry, Group, InstancedMesh, Material, Points } from "three";
import { SpaceActivity } from "@/features/ring-ship/SpaceActivity";
import { emptySpaceMotion } from "@/features/ring-ship/space-activity";

const hooks = vi.hoisted(() => ({ frame: null as ((state: unknown, delta: number) => void) | null }));
vi.mock("@react-three/fiber", () => ({ useFrame: (callback: typeof hooks.frame) => { hooks.frame = callback; } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("pauses hidden tabs, navigation and reduced motion without a catch-up burst, and resets on arrival", () => {
  let change = () => {};
  const media = { matches: false, addEventListener: vi.fn((_type: string, listener: () => void) => { change = listener; }), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => media);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const motion = { current: emptySpaceMotion() }, caption = { current: document.createElement("small") };
  const hook = renderHook(({ paused, seed }) => SpaceActivity({ radius: 46, seed, paused, motion, caption }), { initialProps: { paused: false, seed: 1 } });
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
