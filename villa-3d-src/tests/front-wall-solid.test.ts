import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { wallWithOpenings, type Mats } from "../src/primitives";

test("通高洞口落在墙底时，门窗之间墙垛正反面均保持实体", () => {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const mat = new Proxy({} as Mats, { get: () => material });
  wallWithOpenings(group, [0, 0], [13600, 0], 450, 3150, [
    { at: 2350, w: 3200, sill: 0, h: 3150, span: "lower", continuous: "living" },
    { at: 6800, w: 2300, sill: 0, h: 3150, span: "lower", entryAssembly: "entry" },
  ], mat);
  group.updateMatrixWorld(true);
  for (const x of [4100, 4500, 5000, 5500, 8200, 10000]) {
    for (const y of [451, 800, 1800, 3500]) {
      for (const sign of [-1, 1]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(x, y, sign * 1000), new THREE.Vector3(0, 0, -sign));
        assert.ok(ray.intersectObject(group, true).length, `墙垛缺面 x=${x} y=${y} side=${sign}`);
      }
    }
  }
  for (const x of [2350, 6800]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 1800, -1000), new THREE.Vector3(0, 0, 1));
    assert.equal(ray.intersectObject(group, true).length, 0, "门窗洞保持通透");
  }
});
