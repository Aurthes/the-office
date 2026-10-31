import * as THREE from "three";

// One short ejection burst, with two instanced particle batches. No extra
// lights, postprocessing, external textures or per-frame allocations.
export function createReturnPodEffects() {
  const root = new THREE.Group(); root.name = "return-pod-launch-effects"; root.visible = false;
  const plume = new THREE.Group(); plume.name = "return-pod-exhaust"; root.add(plume);
  const cone = new THREE.ConeGeometry(1, 1, 16, 1, true);
  const fire = [
    { color: "#ff6b16", radius: .58, length: 4.6, opacity: .4 },
    { color: "#ffce67", radius: .36, length: 3.7, opacity: .75 },
    { color: "#fff9d5", radius: .2, length: 2.5, opacity: .95 },
  ].map(spec => {
    const material = new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: spec.opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(cone, material); mesh.scale.set(spec.radius, spec.length, spec.radius);
    mesh.position.y = spec.length / 2; plume.add(mesh);
    return { mesh, material, ...spec };
  });
  const flashMaterial = new THREE.MeshBasicMaterial({ color: "#fff2bb", transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), flashMaterial);
  flash.position.y = -4.48; root.add(flash);
  const shockMaterial = new THREE.MeshBasicMaterial({ color: "#ffcb76", transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const shock = new THREE.Mesh(new THREE.RingGeometry(.82, 1.04, 48), shockMaterial);
  shock.rotation.x = -Math.PI / 2; shock.position.y = -4.5; root.add(shock);

  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4, r = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(255 * Math.max(0, 1 - r) ** 1.8);
  }
  const haze = new THREE.DataTexture(pixels, 32, 32); haze.needsUpdate = true;
  haze.magFilter = haze.minFilter = THREE.LinearFilter;
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: "#b3a79a", map: haze, transparent: true,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const smoke = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), smokeMaterial, 20);
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: "#ffd778", transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const sparks = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(.075), sparkMaterial, 32);
  smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage); sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Bounds change rapidly during the burst, so do not use a stale first-frame
  // instancing bound to cull particles when the camera swings below the hull.
  smoke.frustumCulled = sparks.frustumCulled = false;
  root.add(smoke, sparks);
  const dummy = new THREE.Object3D(), localCamera = new THREE.Quaternion(), inverseRoot = new THREE.Quaternion();
  const particles = Array.from({ length: 32 }, (_, i) => ({
    angle: i * 2.399963, speed: 3 + (i % 7) * .48, size: .75 + (i % 5) * .13,
  }));
  const fade = (a: number, b: number, p: number) => 1 - THREE.MathUtils.smoothstep(p, a, b);
  return {
    root,
    update(progress: number | null, drop: number, camera: THREE.Camera) {
      root.visible = progress !== null && progress < 1;
      if (progress === null || progress >= 1) return;
      const p = THREE.MathUtils.clamp(progress, 0, 1);
      const burn = Math.min(1, p / .035) * fade(.72, 1, p), flicker = 1 + .08 * Math.sin(p * 73);
      plume.position.y = drop + .16; plume.scale.set(flicker, flicker * (.9 + .1 * Math.sin(p * 41)), flicker);
      for (const layer of fire) layer.material.opacity = layer.opacity * burn;
      flash.scale.setScalar(1 + p * 10); flash.scale.y = .2 + p;
      flashMaterial.opacity = .85 * fade(0, .09, p);
      shock.scale.setScalar(1 + p * 15); shockMaterial.opacity = .8 * fade(0, .22, p);
      smokeMaterial.opacity = .55 * fade(.08, .72, p);
      sparkMaterial.opacity = fade(.12, .48, p);
      // The batch lives in the launch bay's rotated local frame. Billboards
      // must undo that rotation before copying the camera orientation.
      root.getWorldQuaternion(inverseRoot).invert(); camera.getWorldQuaternion(localCamera);
      localCamera.premultiply(inverseRoot);
      for (let i = 0; i < particles.length; i++) {
        const seed = particles[i], spread = p * seed.speed;
        dummy.position.set(Math.cos(seed.angle) * (.4 + spread), -4.5 - p * (1.5 + i % 4) - 3 * p * p, Math.sin(seed.angle) * (.4 + spread));
        dummy.rotation.set(p * 9 + i, p * 5, seed.angle);
        dummy.scale.setScalar(fade(.15, .5, p) * seed.size); dummy.updateMatrix(); sparks.setMatrixAt(i, dummy.matrix);
        if (i < smoke.count) {
          dummy.position.set(Math.cos(seed.angle) * (.7 + spread * .7), -4.6 - p * (1 + i % 3) * .7, Math.sin(seed.angle) * (.7 + spread * .7));
          dummy.quaternion.copy(localCamera); dummy.scale.setScalar(seed.size * (1.3 + p * 4));
          dummy.updateMatrix(); smoke.setMatrixAt(i, dummy.matrix);
        }
      }
      smoke.instanceMatrix.needsUpdate = sparks.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      cone.dispose(); fire.forEach(layer => layer.material.dispose());
      flash.geometry.dispose(); flashMaterial.dispose(); shock.geometry.dispose(); shockMaterial.dispose();
      smoke.dispose(); smoke.geometry.dispose(); smokeMaterial.dispose(); haze.dispose();
      sparks.dispose(); sparks.geometry.dispose(); sparkMaterial.dispose(); root.clear();
    },
  };
}
