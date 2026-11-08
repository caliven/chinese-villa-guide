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

test("主辅楼首层及整段过道同高，过道两端踏步与铺装一致", () => {
  for (const buildingPlacement of ["main-east", "main-west"] as const) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement, entranceRise: 600 });
    const model = buildVilla(mat, false, site.roofFenShui, "floating", villaLayoutFromDraft(draftWithoutFurniture()));
    const main = model.levels[0].getObjectByName("一楼楼板")!;
    const annex = model.annex.getObjectByName("辅楼一楼楼板")!;
    const lane = model.levels[0].getObjectByName("主辅楼间过道")! as THREE.Mesh;
    for (const floor of [main, annex, lane]) assert.equal(new THREE.Box3().setFromObject(floor).max.y, 600);
    assert.ok(Math.abs(new THREE.Box3().setFromObject(annex).min.y - (600 - construction.floorSlab)) < .01);
    assert.equal(lane.material, mat.courtyard);
    const steps = model.levels[0].children.filter(c => c.name === "过道端部踏步") as THREE.Mesh[];
    assert.equal(steps.length, 6);
    assert.deepEqual(steps.map(s => new THREE.Box3().setFromObject(s).max.y).sort((a, b) => a - b), [150, 150, 300, 300, 450, 450]);
    assert.ok(steps.every(s => s.material === mat.courtyard));
  }
});

test("三层楼面均有120厚水泥楼板；二层挑空和二三层楼梯洞不被封死", () => {
  const draft = draftWithoutFurniture(), layout = villaLayoutFromDraft(draft);
  const model = buildVilla(mat, false, site.roofFenShui, "floating", layout);
  for (const [index, name] of ["一楼楼板", "二楼楼板", "三楼楼板"].entries()) {
    const mesh = model.levels[index].getObjectByName(name)!;
    assert.ok(mesh, name);
    const box = new THREE.Box3().setFromObject(mesh);
    const top = draft.floors[index].y + (index === 0 ? site.entranceRise : 0);
    assert.equal(box.max.y, top);
    assert.ok(Math.abs(box.min.y - (top - construction.floorSlab)) < .01);
    // 楼板外缘与建筑外皮（外墙外皮）齐平，不外扩半墙厚。
    assert.ok(Math.abs(box.min.x - site.main.x) < 1, name);
    assert.ok(Math.abs(box.max.x - (site.main.x + site.main.w)) < 1, name);
  }
  const opening = stairOpeningBounds(fitStairToRoom(draft.stairLayout, draft.floors));
  for (const index of [1, 2]) {
    const mesh = model.levels[index].getObjectByName(index === 1 ? "二楼楼板" : "三楼楼板")!;
    assert.equal(hit(mesh, opening.x + opening.w / 2, opening.z + opening.d / 2, draft.floors[index].y + 100), undefined);
  }
  const v = draft.livingVoid;
  assert.equal(hit(model.levels[1].getObjectByName("二楼楼板")!, v.x + v.w / 2, v.z + v.d / 2, draft.floors[1].y + 100), undefined);
});

test("关闭瓦屋面仍有独立双面顶板；楼梯洞随退台、凹口和换位更新", () => {
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
        const slabMesh = root.getObjectByName(`${root.name}实体`)!;
        const box = new THREE.Box3().setFromObject(slabMesh);
        assert.equal(box.max.y, slab.top);
        assert.ok(Math.abs(box.min.y - (slab.top - construction.floorSlab)) < .01);
        const x = (box.min.x + box.max.x) / 2, z = (box.min.z + box.max.z) / 2;
        assert.ok(Math.abs(hit(slabMesh, x, z, slab.top + 100)!.point.y - slab.top) < .01);
        assert.ok(Math.abs(hit(slabMesh, x, z, slab.top - slab.thickness - 100, true)!.point.y - (slab.top - slab.thickness)) < .01, "顶板底面须真实封闭");
        const points = slab.outline.map(([px, pz]) => `${Math.round(px)},${Math.round(pz)}`).join(" ");
        assert.ok(roofPlanSvg("slab", "floating", layout).includes(`points="${points}" class="roof-slab"`), "二维／三维顶板范围须同源");
      }
      const opening = stairOpeningBounds(fitStairToRoom(draft.stairLayout, draft.floors));
      assert.equal(hit(model.topSlabs.main.getObjectByName("主楼三层顶板实体")!, opening.x + opening.w / 2, opening.z + opening.d / 2, spec.main.top + 100), undefined, "顶板须在楼梯位置开洞");
      assert.ok(roofPlanSvg("slab", "floating", layout).includes(`points="${spec.stairHole!.map(([x, z]) => `${Math.round(x)},${Math.round(z)}`).join(" ")}" class="roof-stair-hole"`));
      const front = Math.min(...spec.main.outline.map(p => p[1]));
      assert.ok(hit(model.topSlabs.main, draft.portico.x + draft.portico.w / 2, front + 100, spec.main.top + 100), "平齐门厅不再切中央凹口");
    }
});

test("复用场景时删除楼梯须恢复完整顶板", () => {
  const draft = draftWithoutFurniture(), layout = villaLayoutFromDraft(draft);
  const previous = buildVilla(mat, false, site.roofFenShui, "floating", layout);
  const hole = roofSlabLayout(layout).stairHole!;
  const x = (hole[0][0] + hole[2][0]) / 2, z = (hole[0][1] + hole[2][1]) / 2;
  const top = roofSlabLayout(layout).main.top;
  assert.equal(hit(previous.topSlabs.main.getObjectByName("主楼三层顶板实体")!, x, z, top + 100), undefined);
  draft.floors.forEach(floor => floor.rooms = floor.rooms.filter(room => room.kind !== "stair"));
  const next = buildVilla(mat, false, site.roofFenShui, "floating", villaLayoutFromDraft(draft), previous);
  assert.notEqual(next.topSlabs.main, previous.topSlabs.main);
  assert.ok(hit(next.topSlabs.main.getObjectByName("主楼三层顶板实体")!, x, z, top + 100));
});
