import * as THREE from "three";
import { normalizeDuckAppearance, type DuckAppearance } from "@/lib/avatars/duck";
import { createDuckCrewFigure } from "./duckCrewFigure";

const portraits = new Map<string, Promise<string>>();
let renderer: THREE.WebGLRenderer | null = null;
let queue = Promise.resolve();
let pending = 0;

// Photograph the same rig used by DuckCrewModel and CeoCharacter. One temporary
// renderer serves the list; rows display ordinary cached images, not canvases.
export function characterPortrait(appearance?: DuckAppearance): Promise<string> {
  const style = normalizeDuckAppearance(appearance), key = JSON.stringify(style);
  const cached = portraits.get(key);
  if (cached) return cached;
  pending++;
  const result = queue.then(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))).then(() => {
    renderer ||= new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setSize(128, 128, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .95;
    const figure = createDuckCrewFigure(style), scene = new THREE.Scene();
    try {
      scene.add(figure.root);
      const box = new THREE.Box3().setFromObject(figure.root);
      box.min.y = .28 * style.bodyHeight;
      const center = box.getCenter(new THREE.Vector3());
      const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * 1.12;
      const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, .01, 20);
      camera.position.copy(center).add(new THREE.Vector3(.9, .12, 2.4)); camera.lookAt(center);
      scene.add(new THREE.HemisphereLight("#e6efe8", "#6c6960", 1.2));
      const keyLight = new THREE.DirectionalLight("#fff1d6", 2.8); keyLight.position.set(-2, 4, 5); scene.add(keyLight);
      const fill = new THREE.DirectionalLight("#afc7df", .8); fill.position.set(3, 1, -1); scene.add(fill);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    } finally { figure.dispose(); scene.clear(); }
  }).catch(error => { portraits.delete(key); throw error; }).finally(() => {
    if (--pending === 0) { renderer?.dispose(); renderer?.forceContextLoss(); renderer = null; }
  });
  portraits.set(key, result);
  if (portraits.size > 128) portraits.delete(portraits.keys().next().value!);
  queue = result.then(() => {}, () => {});
  return result;
}
