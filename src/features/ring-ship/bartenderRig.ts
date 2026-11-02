import * as THREE from "three";

type Arm = {
  shoulder: THREE.Bone; elbow: THREE.Bone; hand: THREE.Object3D;
  origin: THREE.Vector3; upper: THREE.Vector3; lower: THREE.Vector3;
  a: number; b: number; pole: THREE.Vector3;
};
const RAW_ARMS = [
  [[-84, 1, 6], [-148, -138, 53], [112, -167, 188]],
  [[77, 32, -4], [188, -6, 104], [317, 101, 349]],
] as const;
const identity = new THREE.Quaternion();

function segmentDistance(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const direction = b.clone().sub(a);
  return point.distanceTo(direction.multiplyScalar(THREE.MathUtils.clamp(point.clone().sub(a).dot(direction) / direction.lengthSq(), 0, 1)).add(a));
}

// The original asset has rigid mechanical parts, but no authored skeleton.
// Assign each connected part to a joint; retain its geometry, UVs and material.
function rigidWeights(geometry: THREE.BufferGeometry, material: string, positions: Float32Array) {
  const count = positions.length / 3, parents = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => parents[i] === i ? i : (parents[i] = find(parents[i]));
  const joined = new Map<string, number>(), point = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    point.fromArray(positions, i * 3);
    const key = `${Math.round(point.x * 10)},${Math.round(point.y * 10)},${Math.round(point.z * 10)}`;
    const previous = joined.get(key);
    if (previous !== undefined) parents[find(i)] = find(previous); else joined.set(key, i);
  }
  const indices = geometry.index, length = indices?.count || count;
  const index = (i: number) => indices ? indices.getX(i) : i;
  for (let i = 0; i < length; i += 3) { const root = find(index(i)); parents[find(index(i + 1))] = root; parents[find(index(i + 2))] = root; }
  const boxes = new Map<number, THREE.Box3>();
  for (let i = 0; i < count; i++) {
    const key = find(i); if (!boxes.has(key)) boxes.set(key, new THREE.Box3());
    boxes.get(key)!.expandByPoint(point.fromArray(positions, i * 3));
  }
  const segments = RAW_ARMS.flatMap(arm => [[new THREE.Vector3(...arm[0]), new THREE.Vector3(...arm[1])], [new THREE.Vector3(...arm[1]), new THREE.Vector3(...arm[2])]]);
  const assignments = new Map<number, number>();
  for (const [key, box] of boxes) {
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    let bone = 0;
    const body = /Jetpack|Eyes|Lens|Visor|Bowtie|Shirt/.test(material) || (size.x > 130 && Math.abs(center.x) < 80 && center.y > -30 && center.z < 100);
    if (!body && center.z > -80 && (center.y < 60 || Math.abs(center.x) > 135)) {
      const distances = segments.map(([a, b]) => segmentDistance(center, a, b));
      const best = Math.min(...distances);
      if (best < 90) bone = distances.indexOf(best) + 1;
    }
    assignments.set(key, bone);
  }
  const skin = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { skin[i * 4] = assignments.get(find(i))!; weights[i * 4] = 1; }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skin, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
}

export function createBartenderRig(source: THREE.Object3D, height: number) {
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source), center = bounds.getCenter(new THREE.Vector3());
  const scale = height / bounds.getSize(new THREE.Vector3()).y;
  const normalize = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const point = (raw: readonly number[]) => new THREE.Vector3(raw[0], raw[1], raw[2]).applyMatrix4(normalize);
  const group = new THREE.Group(), body = new THREE.Bone(); group.add(body);
  const arms: Arm[] = RAW_ARMS.map((raw, i) => {
    const [s, e, w] = raw.map(point), shoulder = new THREE.Bone(), elbow = new THREE.Bone(), hand = new THREE.Object3D();
    shoulder.name = `bartender-shoulder-${i}`; elbow.name = `bartender-elbow-${i}`; hand.name = `bartender-hand-${i}`;
    shoulder.position.copy(s); elbow.position.copy(e).sub(s); hand.position.copy(w).sub(e);
    body.add(shoulder); shoulder.add(elbow); elbow.add(hand);
    return { shoulder, elbow, hand, origin: s, upper: e.clone().sub(s), lower: w.clone().sub(e), a: s.distanceTo(e), b: e.distanceTo(w), pole: new THREE.Vector3(i ? 1 : -1, -.8, .1) };
  });
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([body, ...arms.flatMap(arm => [arm.shoulder, arm.elbow])]);
  const owned: THREE.BufferGeometry[] = [], vector = new THREE.Vector3();
  source.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const geometry = mesh.geometry.clone(), original = mesh.geometry.getAttribute("position"), positions = new Float32Array(original.count * 3);
    for (let i = 0; i < original.count; i++) vector.fromBufferAttribute(original, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
    rigidWeights(geometry, mesh.material.name, positions);
    const baked = new Float32Array(positions.length);
    for (let i = 0; i < original.count; i++) vector.fromArray(positions, i * 3).applyMatrix4(normalize).toArray(baked, i * 3);
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(baked, 3));
    for (const attribute of ["normal", "tangent"] as const) {
      const original = mesh.geometry.getAttribute(attribute); if (!original) continue;
      const array = new Float32Array(original.count * original.itemSize), matrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for (let i = 0; i < original.count; i++) {
        vector.fromBufferAttribute(original, i).applyNormalMatrix(matrix).toArray(array, i * original.itemSize);
        if (original.itemSize === 4) array[i * 4 + 3] = original.getW(i);
      }
      geometry.setAttribute(attribute, new THREE.Float32BufferAttribute(array, original.itemSize));
    }
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); owned.push(geometry);
    const moving = new THREE.SkinnedMesh(geometry, mesh.material); moving.name = mesh.name; moving.receiveShadow = true; group.add(moving); moving.bind(skeleton);
  });
  const scratch = { direction: new THREE.Vector3(), bend: new THREE.Vector3(), elbow: new THREE.Vector3(), q1: new THREE.Quaternion(), q2: new THREE.Quaternion() };
  return {
    group, arms,
    pose(index: number, target: THREE.Vector3 | null, delta: number) {
      const arm = arms[index], rate = 1 - Math.exp(-delta * 7);
      if (!target) { arm.shoulder.quaternion.slerp(identity, rate); arm.elbow.quaternion.slerp(identity, rate); return; }
      const { direction, bend, elbow, q1, q2 } = scratch;
      direction.copy(target).sub(arm.origin);
      const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(arm.a - arm.b) + .001, arm.a + arm.b - .001);
      direction.normalize(); bend.copy(arm.pole).addScaledVector(direction, -arm.pole.dot(direction)).normalize();
      const cosine = THREE.MathUtils.clamp((arm.a * arm.a + distance * distance - arm.b * arm.b) / (2 * arm.a * distance), -1, 1);
      elbow.copy(arm.origin).addScaledVector(direction, arm.a * cosine).addScaledVector(bend, arm.a * Math.sqrt(1 - cosine * cosine));
      q1.setFromUnitVectors(arm.upper.clone().normalize(), direction.copy(elbow).sub(arm.origin).normalize());
      q2.setFromUnitVectors(arm.lower.clone().normalize(), direction.copy(target).sub(elbow).normalize());
      arm.shoulder.quaternion.slerp(q1, rate); arm.elbow.quaternion.slerp(q1.invert().multiply(q2), rate);
    },
    dispose() { skeleton.dispose(); owned.forEach(geometry => geometry.dispose()); },
  };
}
