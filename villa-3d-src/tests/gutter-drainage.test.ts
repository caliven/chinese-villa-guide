import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { roofEaves } from "../src/facade-details.ts";
import type { Mats } from "../src/primitives.ts";
const mat = new Proxy({} as Mats, {
  get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; },
});
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params.ts";
import { floorSlabThickness, gutterBedTop } from "../src/roof-options.ts";

test("槽底沿沟向具有排水中点，找坡角度控制实际高差且底面保持原位", () => {
  try {
    for (const degrees of [0, 1, 2]) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, gutterBedSlope: degrees, gutterClearDepth: 300, gutterInnerDepth: 380 });
      const group = new THREE.Group();
      roofEaves(group, 0, 0, 5600, 9600, 3600, mat);
      group.updateMatrixWorld(true);
      const bed = group.getObjectByName("天沟槽底") as THREE.Mesh;
      const surface = (x: number) => new THREE.Raycaster(new THREE.Vector3(x, 5000, 600),
        new THREE.Vector3(0, -1, 0)).intersectObject(bed)[0].point.y;
      const middle = surface(2800), left = surface(1000), right = surface(4600);
      const slope = Math.tan(degrees * Math.PI / 180);
      assert.ok(Math.abs(middle - (3600 + floorSlabThickness + gutterBedTop + 300 * slope)) < .02);
      assert.ok(Math.abs(left - right) < .02, "排水中点两侧对称");
      assert.ok(degrees === 0 ? Math.abs(left - middle) < .02 : left > middle + 10, "沿沟向有真实高差");
      const box = new THREE.Box3().setFromObject(bed);
      assert.ok(Math.abs(box.min.y - 3600 - floorSlabThickness) < .02, "找坡层底面仍贴板顶");
      const vertices = bed.geometry.getAttribute("position");
      for (let i = 0; i < vertices.count; i++) assert.ok(Number.isFinite(vertices.getY(i)));
    }
  } finally {
    resetVillaParams();
  }
});
