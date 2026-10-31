import { Children, type ReactElement, type ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Camera, Matrix3, OrthographicCamera, Vector3 } from "three";
import { GalaxyBackdrop } from "@/features/ring-ship/GalaxyBackdrop";
import { STAR_SYSTEMS } from "@/features/ring-ship/galaxy";

const viewport = vi.hoisted(() => ({ size: { width: 1600, height: 900 } }));
vi.mock("@react-three/fiber", () => ({ useThree: (select: (state: typeof viewport) => unknown) => select(viewport) }));
vi.mock("@react-three/drei", () => ({ Stars: () => null }));
afterEach(cleanup);

function sky() {
  const result = renderHook(() => GalaxyBackdrop({ system: STAR_SYSTEMS[1] })).result;
  const mesh = result.current as ReactElement<{ children: ReactNode; onBeforeRender: (renderer: unknown, scene: unknown, camera: Camera) => void }>;
  const material = Children.toArray(mesh.props.children).find(child => (child as ReactElement).type === "shaderMaterial") as ReactElement<{ uniforms: { uCameraRotation: { value: Matrix3 }; uAspect: { value: number } } }>;
  return { rotation: material.props.uniforms.uCameraRotation.value, render: (camera: Camera) => mesh.props.onBeforeRender(null, null, camera) };
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
