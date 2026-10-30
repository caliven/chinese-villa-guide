import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildVilla, mainRoofFootprint, roofPitch, villaLayoutFromDraft } from "../src/architecture.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { roofTileEaveLift, roofTileInset } from "../src/roof-options.ts";
import { clipRailingBelowRoof } from "../src/roof-railing-clearance.ts";
import type { Mats } from "../src/primitives.ts";

const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; } });
test.after(() => Object.values(mat).forEach(material => material.dispose()));

function checkVertices(root: THREE.Object3D, height: (p: THREE.Vector3) => number) {
  let count = 0, highest = -Infinity;
  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const p = object.geometry.getAttribute("position"), point = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i).applyMatrix4(object.matrixWorld);
      highest = Math.max(highest, point.y - height(point)); count++;
    }
  });
  return { count, highest };
}

test("倾斜变换后的栏杆按屋面裁切，原几何保持完整", () => {
  const root = new THREE.Group(), part = new THREE.Group();
  part.position.set(250, 0, 0); part.rotation.y = .3; root.add(part);
  const original = new THREE.BoxGeometry(600, 600, 600);
  const mesh = new THREE.Mesh(original); mesh.position.y = 300; part.add(mesh);
  const roof = { x: 0, z: -1000, w: 2000, d: 2000, eave: 200, slope: .5 };
  clipRailingBelowRoof(root, roof, 100);
  const result = checkVertices(root, p => Math.min(roof.eave + roof.slope * p.x, roof.eave + roof.slope * (roof.w - p.x), roof.eave + roof.slope * (p.z - roof.z), roof.eave + roof.slope * (roof.z + roof.d - p.z)) - 100);
  assert.ok(result.count > 0); assert.ok(result.highest < .01, `越出屋面 ${result.highest}`);
  assert.equal(original.getAttribute("position").count, 24);
});

test("各栏杆造型和坡度的新增梯段及顶板护栏均位于主屋瓦面下", () => {
  for (const style of ["wood", "steel", "glass", "marble"] as const) for (const slope of [3, 5]) {
    const draft = clonePublishedLayout(); draft.stairLayout.railingStyle = style;
    const model = buildVilla(mat, false, slope, "floating", villaLayoutFromDraft(draft));
    const main = mainRoofFootprint(), pitch = roofPitch(slope), x = main.x + roofTileInset, z = main.z + roofTileInset;
    const w = main.w - 2 * roofTileInset, d = main.d - 2 * roofTileInset, eave = main.eave + roofTileEaveLift(), k = pitch.mainRise / pitch.mainRun;
    const ceiling = (p: THREE.Vector3) => eave + k * Math.min(p.x - x, x + w - p.x, p.z - z, z + d - p.z) - 100;
    for (const root of [model.levels[2], model.topSlabs.main]) {
      const covered = root.getObjectByName("屋面避让栏杆")!, open = root.getObjectByName("完整楼梯栏杆")!;
      assert.ok(covered && open); assert.ok(covered.visible && !open.visible);
      const result = checkVertices(covered, ceiling);
      assert.ok(result.count > 0); assert.ok(result.highest < .02, `${style} ${slope}: 越出屋面 ${result.highest}`);
    }
  }
});
