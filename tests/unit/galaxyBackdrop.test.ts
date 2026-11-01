import { Children, type ReactElement, type ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Camera, Color, Matrix3, OrthographicCamera, Vector3 } from "three";
import { GalaxyBackdrop } from "@/features/ring-ship/GalaxyBackdrop";
import { STAR_SYSTEMS, type StarSystem } from "@/features/ring-ship/galaxy";

const viewport = vi.hoisted(() => ({ size: { width: 1600, height: 900 } }));
vi.mock("@react-three/fiber", () => ({ useThree: (select: (state: typeof viewport) => unknown) => select(viewport) }));
vi.mock("@react-three/drei", () => ({ Stars: () => null }));
afterEach(() => { cleanup(); viewport.size.width = 1600; viewport.size.height = 900; });

type SkyUniforms = {
  uCameraRotation: { value: Matrix3 }; uAspect: { value: number };
  uCloud: { value: Color }; uGlow: { value: Color }; uSeed: { value: number };
  uTime: { value: number }; uPlanetApproach: { value: number }; uPlanetPass: { value: number };
};
function skyElements(element: ReactNode) {
  const mesh = element as ReactElement<{ children: ReactNode; onBeforeRender: (renderer: unknown, scene: unknown, camera: Camera, geometry: unknown, material: unknown) => void }>;
  const material = Children.toArray(mesh.props.children).find(child => (child as ReactElement).type === "shaderMaterial") as ReactElement<{ uniforms: SkyUniforms }>;
  return { uniforms: material.props.uniforms, render: (camera: Camera) => mesh.props.onBeforeRender(null, null, camera, null, { uniforms: material.props.uniforms }) };
}

function sky() {
  const result = renderHook(() => GalaxyBackdrop({ system: STAR_SYSTEMS[1] })).result;
  const backdrop = skyElements(result.current);
  return { rotation: backdrop.uniforms.uCameraRotation.value, render: backdrop.render };
}

it("moves a fixed star with camera orbit and returns it to the same direction on a round trip", () => {
  const backdrop = sky(), camera = new OrthographicCamera(-80, 80, 45, -45, .1, 5000);
  camera.position.set(70, 73, 94); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const starDirection = camera.getWorldDirection(new Vector3());
  backdrop.render(camera);
  expect(new Vector3(0, 0, -1).applyMatrix3(backdrop.rotation).distanceTo(starDirection)).toBeLessThan(1e-12);
  const original = backdrop.rotation.clone();

  camera.position.applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 3); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  backdrop.render(camera);
  // Express the same world star in the sky's new view: it must leave the centre.
  const starInView = starDirection.clone().applyMatrix3(backdrop.rotation.clone().transpose());
  expect(Math.abs(starInView.x)).toBeGreaterThan(.5);
  expect(new Vector3(0, 0, -1).applyMatrix3(backdrop.rotation).distanceTo(camera.getWorldDirection(new Vector3()))).toBeLessThan(1e-12);

  camera.position.set(70, 73, 94); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  backdrop.render(camera);
  backdrop.rotation.elements.forEach((value, i) => expect(value).toBeCloseTo(original.elements[i], 12));
});

it("keeps the distant sky direction fixed when panning or zooming the orthographic ship camera", () => {
  const backdrop = sky(), camera = new OrthographicCamera(-80, 80, 45, -45, .1, 5000);
  camera.position.set(70, 73, 94); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  backdrop.render(camera);
  const original = backdrop.rotation.toArray();
  camera.position.add(new Vector3(200, 30, -70)); camera.zoom = 80;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(); backdrop.render(camera);
  expect(backdrop.rotation.toArray()).toEqual(original);
});

it("keeps the renderer's cached parameters live after repeated resizes and nebula changes", () => {
  const motion = { current: { elapsed: 24, planetApproach: .6, planetPass: .2 } };
  const hook = renderHook(({ system }: { system: StarSystem }) => GalaxyBackdrop({ system, motion }), { initialProps: { system: STAR_SYSTEMS[1] as StarSystem } });
  const camera = new OrthographicCamera(-80, 80, 45, -45, .1, 5000);
  camera.position.set(70, 73, 94); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const initial = skyElements(hook.result.current);
  initial.render(camera);
  // The real renderer retains this first dictionary when it compiles the shader.
  const cached = initial.uniforms;
  for (const [width, height, system] of [[900, 1000, STAR_SYSTEMS[1]], [900, 1000, STAR_SYSTEMS[3]], [1600, 900, STAR_SYSTEMS[2]], [390, 844, STAR_SYSTEMS[4]]] as const) {
    viewport.size.width = width; viewport.size.height = height;
    motion.current.elapsed += 1;
    hook.rerender({ system });
    camera.position.applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 4); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const updated = skyElements(hook.result.current);
    updated.render(camera);
    expect(updated.uniforms).toBe(cached);
    expect(new Vector3(0, 0, -1).applyMatrix3(cached.uCameraRotation.value).distanceTo(camera.getWorldDirection(new Vector3()))).toBeLessThan(1e-12);
    expect(cached.uAspect.value).toBe(width / height);
    expect(cached.uSeed.value).toBe(system.seed);
    expect(cached.uCloud.value.equals(new Color(system.cloud))).toBe(true);
    expect(cached.uGlow.value.equals(new Color(system.glow))).toBe(true);
    expect(cached.uTime.value).toBe(motion.current.elapsed);
    expect(cached.uPlanetApproach.value).toBe(.6);
    expect(cached.uPlanetPass.value).toBe(.2);
  }
});
