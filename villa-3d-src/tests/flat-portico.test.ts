import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildVilla, roofPlanModel, villaLayoutFromDraft } from "../src/architecture";
import { frontApronOutline } from "../src/building-variants";
import { frontElevation, site } from "../src/data";
import { clonePublishedLayout } from "../src/layout-draft";
import { floorPlan, planSourceFromDraft } from "../src/plan";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, floatingHatHeightLimits, resetVillaParams } from "../src/villa-params";
import type { Mats } from "../src/primitives";

const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; } });
test.afterEach(resetVillaParams);
test.after(() => Object.values(mat).forEach(material => material.dispose()));
function geometry(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const parts: unknown[] = [];
  root.traverse(o => {
    if (o instanceof THREE.Mesh) parts.push([o.name, o.matrixWorld.toArray(), Array.from(o.geometry.getAttribute("position").array)]);
  });
  return parts;
}

test("平齐式取消外凸柱廊，二楼直檐完整连续；两种官帽实体及柱冠保持凸出式原样", () => {
  for (const buildingPlacement of ["main-east", "main-west"] as const)
    for (const thirdFloorMode of ["setback", "flush"] as const)
      for (const roofStyle of ["joined", "floating"] as const) {
        const params = { ...DEFAULT_VILLA_PARAMS, buildingPlacement, thirdFloorMode };
        applyVillaParams(params);
        const draft = clonePublishedLayout();
        draft.portico.x += 100;
        draft.portico.projection += 200;
        draft.floors.forEach(f => f.furniture = []);
        draft.annexFurniture = [];
        const source = JSON.stringify(draft), layout = villaLayoutFromDraft(draft);
        const original = buildVilla(mat, false, site.roofFenShui, roofStyle, layout);
        const roof = roofPlanModel(roofStyle, layout);
        const limit = floatingHatHeightLimits(params);
        applyVillaParams({ ...params, porticoStyle: "recessed" });
        const flat = buildVilla(mat, false, site.roofFenShui, roofStyle, layout);
        assert.deepEqual(roofPlanModel(roofStyle, layout), roof, "门厅切换不能移动或改变三楼屋面官帽");
        assert.deepEqual(geometry(flat.roof), geometry(original.roof), "三楼屋顶实际顶点保持一致");
        assert.deepEqual(geometry(flat.levels[2].getObjectByName("三楼官帽柱")!), geometry(original.levels[2].getObjectByName("三楼官帽柱")!));
        assert.deepEqual(floatingHatHeightLimits({ ...params, porticoStyle: "recessed" }), limit);
        assert.equal(flat.portico.getObjectByName("参考图通高门厅雕花柱"), undefined);
        assert.equal(flat.portico.getObjectByName("门厅柱外展斜肩"), undefined);
        assert.equal(flat.portico.getObjectByName("参考图门厅雕花横梁"), undefined);
        assert.equal(flat.levels[0].getObjectByName("门厅地坪投影计入首层合计"), undefined);
        assert.ok(flat.portico.getObjectByName("柱间三步"), "入口仍接回原位大门");
        const edge = frontApronOutline(frontElevation.terraceBack, site.secondFrontEave);
        assert.equal(edge.length, 4, "整段前檐不再有中央凹口或凸出折角");
        assert.equal(edge[1][1], edge[2][1]);
        const apron = new THREE.Box3().setFromObject(flat.levels[2].getObjectByName("三楼栏杆下飘檐")!);
        assert.ok(apron.min.z > new THREE.Box3().setFromObject(original.levels[2].getObjectByName("三楼栏杆下飘檐")!).min.z + 500);
        for (const floor of [0, 1]) {
          const svg = floorPlan(floor, false, false, { editable: true }, planSourceFromDraft(draft, floor));
          assert.doesNotMatch(svg, /data-plan-column="portico"|portico-hit|门厅上空/);
        }
        assert.equal(JSON.stringify(draft), source);
        for (const model of [flat, original]) model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      }
});
