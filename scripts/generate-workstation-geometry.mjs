import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Read the same bundled meshes as the renderer; never infer a collider from a
// furniture item's old 2D editor footprint. Run automatically before npm build.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = {};
for (const name of ["desk", "chairDesk"]) {
  const bytes = await fs.readFile(path.join(root, "public/office-assets/models/furniture/" + name + ".glb"));
  const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const entry = { sha256: crypto.createHash("sha256").update(bytes).digest("hex"), min: box.min.toArray(), max: box.max.toArray() };
  if (name === "chairDesk") {
    // The seat is the broad upper horizontal surface. Narrow armrests and the
    // top of the backrest cannot win the area threshold.
    const levels = new Map();
    scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index;
      for (let i = 0; i < (indices?.count || positions.count); i += 3) {
        const points = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(positions, indices ? indices.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld));
        if (Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) > 1e-5) continue;
        const area = new Vector3().subVectors(points[1], points[0]).cross(new Vector3().subVectors(points[2], points[0])).length() / 2;
        const key = points[0].y.toFixed(4), level = levels.get(key) || { y: points[0].y, area: 0, x: 0, z: 0 };
        level.area += area; level.x += area * points.reduce((sum, p) => sum + p.x, 0) / 3; level.z += area * points.reduce((sum, p) => sum + p.z, 0) / 3; levels.set(key, level);
      }
    });
    const largest = Math.max(...[...levels.values()].map(level => level.area));
    const seat = [...levels.values()].filter(level => level.area > largest * 0.6).sort((a, b) => b.y - a.y)[0];
    if (!seat) throw new Error("Chair seat surface not found");
    entry.seat = [seat.x / seat.area, seat.y, seat.z / seat.area];
  }
  result[name] = entry;
}
await fs.writeFile(path.join(root, "src/features/retro-office/core/workstation-models.json"), JSON.stringify(result, null, 2) + "\n");
