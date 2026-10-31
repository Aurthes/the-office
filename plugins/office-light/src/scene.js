import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createDuckCrewFigure } from "../../../src/features/ring-ship/duckCrewFigure.ts";
import { ACCENTS } from "./links.mjs";

export function createOfficeScene(canvas, labels, openChat) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
  catch {
    document.getElementById("scene-hint").textContent = "3D is unavailable here. Open chats using the crew list.";
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdce6ce, 0x4b5043, 3));
  const sun = new THREE.DirectionalLight(0xffefd4, 4);
  sun.position.set(3, 8, 5); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * .43;
  controls.minDistance = 5; controls.maxDistance = 30;
  let room = new THREE.Group(); scene.add(room);
  let figures = [], roleLabels = [];
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const target = new THREE.Vector3();
  let pressed;
  canvas.addEventListener("pointerdown", event => { pressed = [event.clientX, event.clientY]; });
  canvas.addEventListener("pointerup", event => {
    if (!pressed || Math.hypot(event.clientX - pressed[0], event.clientY - pressed[1]) > 6) return;
    pressed = null;
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(figures.map(value => value.root), true);
    if (hits.length) {
      let object = hits[0].object;
      while (object && !object.userData.role) object = object.parent;
      if (object?.userData.role) openChat(object.userData.role);
    }
  });
  function render() {
    renderer.render(scene, camera);
    const rect = canvas.getBoundingClientRect();
    for (const { figure, button } of roleLabels) {
      target.copy(figure.position); target.y += 1.38; target.project(camera);
      button.style.left = (target.x * .5 + .5) * rect.width + "px";
      button.style.top = (-target.y * .5 + .5) * rect.height + "px";
      button.hidden = target.z > 1 || target.z < -1;
    }
    canvas.dataset.sceneReady = "true";
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); render();
  }
  controls.addEventListener("change", render);
  const observer = new ResizeObserver(resize); observer.observe(canvas.parentElement);

  function updateRoles(roles) {
    const geometries = new Set(), materials = new Set();
    room.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) for (const material of [object.material].flat()) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    scene.remove(room); room = new THREE.Group(); scene.add(room);
    figures = []; roleLabels = []; labels.replaceChildren();
    const palette = new Map();
    function material(color) {
      if (!palette.has(color)) palette.set(color, new THREE.MeshStandardMaterial({ color, roughness: .85 }));
      return palette.get(color);
    }
    function box(size, position, color) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color));
      mesh.position.set(...position); room.add(mesh); return mesh;
    }
    const rows = Math.max(2, Math.ceil(roles.length / 3)), depth = rows * 2.3 + 1.5, width = 7.6;
    box([width, .22, depth], [0, -.14, 0], "#b5aa87");
    box([width, .8, .12], [0, .3, -depth / 2], "#687969");
    box([.12, .8, depth], [-width / 2, .3, 0], "#83917a");
    box([width, .08, .2], [0, .75, -depth / 2], "#b9c3ac");
    box([.2, .08, depth], [-width / 2, .75, 0], "#b9c3ac");
    box([5.9, .018, depth - .6], [.15, -.015, .1], "#708c78");
    const grid = new THREE.GridHelper(1, 16, 0x95a18a, 0x95a18a);
    grid.scale.set(width, 1, depth); grid.position.y = -.023;
    grid.material.transparent = true; grid.material.opacity = .1; room.add(grid);
    for (let index = 0; index < rows * 3; index++) {
      const x = (index % 3 - 1) * 2.25 + .1, z = (Math.floor(index / 3) - (rows - 1) / 2) * 2.3 - .35;
      box([1.63, .11, .85], [x, .76, z], "#b89b73");
      for (const side of [-1, 1]) box([.08, .74, .65], [x + side * .68, .35, z], "#415c4f");
      box([.23, .04, .2], [x, .84, z - .03], "#334b42");
      box([.05, .25, .05], [x, .94, z - .05], "#334b42");
      box([.67, .43, .06], [x, 1.15, z - .05], "#283f36");
      box([.57, .32, .012], [x, 1.16, z - .01], "#9abfae");
      box([.42, .025, .17], [x, .835, z + .25], "#d2d0b4");
      box([.36, .12, .35], [x, .33, z + .9], "#496759");
      box([.07, .32, .07], [x, .12, z + .9], "#334b42");
      const role = roles[index];
      if (!role) continue;
      const figure = createDuckCrewFigure({ outfit: "vest", outfitColor: ACCENTS[role.accent].outfit, billShape: "sculpted" });
      figure.root.scale.multiplyScalar(1.75); figure.root.position.set(x, .02, z + .78);
      figure.root.rotation.y = .18; figure.root.userData.role = role; room.add(figure.root);
      figures.push(figure);
      const button = document.createElement("button"); button.className = "desk-label";
      button.textContent = role.name; button.setAttribute("aria-label", "Open " + role.name + " from scene");
      button.onclick = () => openChat(role); labels.append(button);
      roleLabels.push({ figure: figure.root, button });
    }
    // Small plants and a shared table keep the empty room useful without dummy roles.
    for (const x of [-3.1, 3.1]) {
      box([.42, .43, .42], [x, .2, -depth / 2 + .55], "#d1b28c");
      for (const [dx, dy] of [[0, .8], [-.13, .65], [.13, .7]]) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(.23, 12, 8), material("#547d55"));
        leaf.scale.set(.6, 1.7, .6); leaf.position.set(x + dx, dy, -depth / 2 + .55); room.add(leaf);
      }
    }
    camera.position.set(width * 1.05, 8.7 + rows, depth * 1.18);
    controls.target.set(0, .25, 0); controls.update(); resize();
  }
  updateRoles([]);
  return { updateRoles };
}
