import { OrthographicCamera, Vector3 } from "three";
import { expect, it } from "vitest";
import { chatCameraPose } from "@/features/ring-ship/chatCamera";

it("frames the person in the exposed half of the screen instead of behind the chat", () => {
  const point = { x: 20, z: -10 }, width = 1920, height = 900;
  const pose = chatCameraPose(point, width, height, 960);
  const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 5000);
  camera.position.copy(pose.position); camera.zoom = pose.zoom; camera.lookAt(pose.target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const projected = new Vector3(point.x, 0.6, point.z).project(camera);
  expect((projected.x + 1) * width / 2).toBeCloseTo(480);
  expect((1 - projected.y) * height / 2).toBeCloseTo(height / 2);
  expect(pose.zoom).toBeGreaterThan(18);
});
it("keeps a valid centered camera for full-screen mobile chat", () => {
  const pose = chatCameraPose({ x: 0, z: 0 }, 390, 844, 0);
  expect(pose.target).toEqual(new Vector3(0, 0.6, 0));
  expect(Number.isFinite(pose.zoom)).toBe(true);
});
