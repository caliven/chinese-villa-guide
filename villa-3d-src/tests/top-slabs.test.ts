import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildVilla, roofSlabLayout, villaLayoutFromDraft } from "../src/architecture.ts";
import { construction, site } from "../src/data.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { fitStairToRoom, stairOpeningBounds } from "../src/stair-geometry.ts";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params.ts";
import { roofPlanSvg } from "../src/roof-plan.ts";
import type { Mats } from "../src/primitives.ts";

const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; } });
test.afterEach(resetVillaParams);
test.after(() => Object.values(mat).forEach(material => material.dispose()));
function hit(root: THREE.Object3D, x: number, z: number, y: number, up = false) {
  root.updateWorldMatrix(true, true);
  return new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, up ? 1 : -1, 0)).intersectObject(root, true)[0];
}
function draftWithoutFurniture() {
  const draft = clonePublishedLayout();
  draft.floors.forEach(floor => floor.furniture = []);
  draft.annexFurniture = [];
  return draft;
}

test("三层楼面均有180厚实体板；二层挑空和二三层楼梯洞不被封死", () => {
  const draft = draftWithoutFurniture(), layout = villaLayoutFromDraft(draft);
  const model = buildVilla(mat, false, site.roofFenShui, "floating", layout);
  for (const [index, name] of ["一楼楼板", "二楼楼板", "三楼楼板"].entries()) {
    const mesh = model.levels[index].getObjectByName(name)!;
    assert.ok(mesh, name);
    const box = new THREE.Box3().setFromObject(mesh);
    const top = draft.floors[index].y + (index === 0 ? site.entranceRise : 0);
    assert.equal(box.max.y, top);
    assert.ok(Math.abs(box.min.y - (top - construction.floorSlab)) < .01);
  }
  const opening = stairOpeningBounds(fitStairToRoom(draft.stairLayout, draft.floors));
  for (const index of [1, 2]) {
    const mesh = model.levels[index].getObjectByName(index === 1 ? "二楼楼板" : "三楼楼板")!;
    assert.equal(hit(mesh, opening.x + opening.w / 2, opening.z + opening.d / 2, draft.floors[index].y + 100), undefined);
  }
  const v = draft.livingVoid;
  assert.equal(hit(model.levels[1].getObjectByName("二楼楼板")!, v.x + v.w / 2, v.z + v.d / 2, draft.floors[1].y + 100), undefined);
});

test("关闭瓦屋面仍有独立双面顶板；顶板不沿用下层楼梯洞，并随退台、凹口和换位更新", () => {
  for (const buildingPlacement of ["main-east", "main-west"] as const)
    for (const thirdFloorMode of ["setback", "flush"] as const) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement, thirdFloorMode, porticoStyle: "recessed" });
      const draft = draftWithoutFurniture();
      draft.portico.projection += 100;
      const layout = villaLayoutFromDraft(draft), spec = roofSlabLayout(layout);
      const model = buildVilla(mat, false, site.roofFenShui, "floating", layout);
      model.roof.visible = model.annexRoof.visible = false;
      for (const key of ["main", "annex"] as const) {
        const root = model.topSlabs[key], slab = spec[key];
        assert.equal(root.parent, model.group, "顶板不能挂在可关闭的屋面组内");
        assert.ok(root.visible);
        const box = new THREE.Box3().setFromObject(root);
        assert.equal(box.max.y, slab.top);
        assert.ok(Math.abs(box.min.y - (slab.top - construction.floorSlab)) < .01);
        const x = (box.min.x + box.max.x) / 2, z = (box.min.z + box.max.z) / 2;
        assert.ok(Math.abs(hit(root, x, z, slab.top + 100)!.point.y - slab.top) < .01);
        assert.ok(Math.abs(hit(root, x, z, slab.top - slab.thickness - 100, true)!.point.y - (slab.top - slab.thickness)) < .01, "顶板底面须真实封闭");
        const points = slab.outline.map(([px, pz]) => `${Math.round(px)},${Math.round(pz)}`).join(" ");
        assert.ok(roofPlanSvg("slab", "floating", layout).includes(`points="${points}" class="roof-slab"`), "二维／三维顶板范围须同源");
      }
      const opening = stairOpeningBounds(fitStairToRoom(draft.stairLayout, draft.floors));
      assert.ok(hit(model.topSlabs.main, opening.x + opening.w / 2, opening.z + opening.d / 2, spec.main.top + 100), "楼梯只到三层，封顶板不留通向屋顶的洞");
      const front = Math.min(...spec.main.outline.map(p => p[1]));
      assert.equal(hit(model.topSlabs.main, draft.portico.x + draft.portico.w / 2, front + 100, spec.main.top + 100), undefined, "凹入门厅仍保持开敞");
    }
});
