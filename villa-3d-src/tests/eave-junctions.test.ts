import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildVilla, floatingHatLayout, mainRoofFootprint } from "../src/architecture";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params";
import { eyelidStackHeight } from "../src/roof-options";
import type { Mats } from "../src/primitives";

const mat = new Proxy({} as Mats, {
  get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; },
});

test("全屋梁托只沿直墙布置，阴阳角不设斜托，也不穿入官帽柱", () => {
  try {
    for (const style of ["joined", "floating"] as const)
      for (const thirdFloorMode of ["setback", "flush"] as const)
        for (const porticoStyle of ["projecting", "recessed"] as const) {
          applyVillaParams({ ...DEFAULT_VILLA_PARAMS, thirdFloorMode, porticoStyle });
          const villa = buildVilla(mat, false, 4.5, style);
          villa.group.updateMatrixWorld(true);
          const piers = villa.levels[2].getObjectByName("三楼官帽柱")!.children
            .map(o => new THREE.Box3().setFromObject(o));
          let count = 0;
          villa.group.traverse(o => {
            assert.notEqual(o.name, "转角梁托承托块");
            if (o.name !== "梁托") return;
            count++;
            assert.ok(Math.abs(Math.sin(2 * o.rotation.y)) < 1e-8,
              `${style}/${thirdFloorMode}/${porticoStyle} 墙角不应出现斜向梁托`);
            const bounds = new THREE.Box3().setFromObject(o);
            for (const pier of piers) {
              const overlap = bounds.clone().intersect(pier).getSize(new THREE.Vector3());
              assert.ok(overlap.x * overlap.y * overlap.z < 1,
                `${style}/${thirdFloorMode}/${porticoStyle} 梁托不能穿入官帽柱`);
            }
          });
          assert.ok(count > 30, "主辅楼及挑檐的直墙梁托应保留");
        }
  } finally { resetVillaParams(); }
});

test("两种官帽的两侧柱盖贴檐底，柱身不再穿过柱盖及三眼皮", () => {
  resetVillaParams();
  try {
    for (const style of ["joined", "floating"] as const) {
      const villa = buildVilla(mat, false, 4.5, style);
      villa.group.updateMatrixWorld(true);
      const soffit = (style === "floating" ? floatingHatLayout(4.5).eave : mainRoofFootprint().eave) - eyelidStackHeight();
      const piers = villa.levels[2].getObjectByName("三楼官帽柱")!.children;
      assert.equal(piers.length, 2);
      for (const pier of piers) {
        const bounds = new THREE.Box3().setFromObject(pier);
        assert.ok(Math.abs(bounds.max.y - soffit) < .1, `${style} 柱顶须在真实檐底收口`);
        const shaft = new THREE.Box3().setFromObject(pier.getObjectByName("官帽柱身")!);
        const cap = new THREE.Box3().setFromObject(pier.getObjectByName("官帽柱顶盖")!);
        assert.ok(Math.abs(shaft.max.y - cap.min.y) < .1, "柱身接柱盖底，不在盖板内部叠出同高顶面");
      }
    }
  } finally { resetVillaParams(); }
});
