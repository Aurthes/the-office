import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { Builder, disposeShipGeometry } from "../../src/features/ring-ship/geometry";

describe("ship imported surface ownership", () => {
  it("retains authored surfaces, merges repeated props and leaves cached textures reusable", () => {
    const texture = new THREE.Texture();
    const surface = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture, roughness: .92, metalness: 0, alphaTest: .5, side: THREE.DoubleSide });
    const source = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    source.add(new THREE.Mesh(geometry, surface));
    const textureDisposed = vi.fn(), sourceDisposed = vi.fn(), geometryDisposed = vi.fn();
    texture.addEventListener("dispose", textureDisposed);
    surface.addEventListener("dispose", sourceDisposed);
    geometry.addEventListener("dispose", geometryDisposed);
    for (let pass = 0; pass < 2; pass++) {
      const builder = new Builder({ rainforestTree: source });
      builder.furniture("rainforestTree", 1, { x: 0, z: 0 });
      builder.furniture("rainforestTree", 1, { x: 3, z: 0 });
      const group = builder.finish();
      expect(group.children).toHaveLength(1);
      const material = (group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      expect(material).not.toBe(surface);
      expect(material).toMatchObject({ map: texture, normalMap: texture, roughness: .92, metalness: 0, alphaTest: .5, side: THREE.DoubleSide });
      disposeShipGeometry(group);
      expect(textureDisposed).not.toHaveBeenCalled();
      expect(sourceDisposed).not.toHaveBeenCalled();
      expect(geometryDisposed).not.toHaveBeenCalled();
    }
    geometry.dispose(); surface.dispose(); texture.dispose();
  });
  it("still releases canvas textures owned by generated signs", () => {
    const texture = new THREE.CanvasTexture(document.createElement("canvas")), disposed = vi.fn();
    texture.addEventListener("dispose", disposed);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture })));
    disposeShipGeometry(group);
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});
