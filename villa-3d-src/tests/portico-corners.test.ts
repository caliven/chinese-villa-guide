import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildVilla, elevationModel, villaLayoutFromDraft } from "../src/architecture";
import { porticoFrontZ } from "../src/building-variants";
import { buildingAreas, frontElevation, site } from "../src/data";
import { clonePublishedLayout } from "../src/layout-draft";
import { courtyardSitePlan, floorPlan, planSourceFromDraft } from "../src/plan";
import type { Mats } from "../src/primitives";
import { DEFAULT_VILLA_PARAMS, applyVillaParams, porticoColumnSpacing, resetVillaParams, validateVillaParams } from "../src/villa-params";

const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; } });
test.afterEach(resetVillaParams);
test.after(() => Object.values(mat).forEach(material => material.dispose()));

function drawnColumns(svg: string) {
  return [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="#879183"/g)]
    .slice(0, 2).map(([, x, z, w, d]) => ({ x: Number(x) + Number(w) / 2, z: Number(z) + Number(d) / 2 }));
}

test("飘檐折角落在门厅柱顶中心，柱顶不越过下沿线", async () => {
  const { frontApronSection } = await import("../src/roof-options");
  const { floors } = await import("../src/data");
  resetVillaParams();
  const e = frontElevation;
  const [west, east] = e.balustradePosts.slice(1, 3);
  assert.equal(e.centerFront, e.porticoColumnZ, "露台／飘檐折角北缘须等于柱心 Z");
  assert.equal(west.x, site.portico.x);
  assert.equal(east.x, site.portico.x + site.portico.w);
  assert.equal(west.z, e.porticoColumnZ);
  assert.equal(east.z, e.porticoColumnZ);
  const apron = frontApronSection(floors[2].y + e.eaveParapet, e.tiledEaveDrop);
  const villa = buildVilla(mat, false);
  try {
    villa.group.updateMatrixWorld(true);
    const columns = villa.portico.children.filter(o => o.name === "参考图通高门厅雕花柱");
    assert.equal(columns.length, 2);
    const beam = villa.portico.getObjectByName("参考图门厅雕花横梁")!;
    for (const part of beam.children.filter(o => ["门厅柱间横梁实体", "门廊阶梯托角", "门廊竖向托角"].includes(o.name))) {
      const center = new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3());
      assert.ok(Math.abs(center.z - columns[0].position.z) < .1, "横梁与下挂托角均须落在两柱截面中线");
    }
    assert.equal(villa.portico.children.filter(o => o.name === "门厅柱退进承托柱颈").length, 0,
      "折角上方不得用实心柱颈隔断梁托／下沿线");
    for (const column of columns) {
      const bounds = new THREE.Box3().setFromObject(column);
      assert.ok(Math.abs(bounds.max.y - apron.columnTopY) < 0.1, "雕花柱帽须下收，不占用梁托／下沿线高度");
      assert.ok(bounds.max.y < apron.fasciaBottomY - 1, "柱帽顶须低于下沿线，折角线脚连续");
    }
    const lowerEave = villa.levels[2].getObjectByName("三楼栏杆下飘檐")!;
    const eaveBounds = new THREE.Box3().setFromObject(lowerEave);
    assert.ok(Math.abs(eaveBounds.min.z - (e.porticoColumnZ - site.secondFrontEave)) < 50,
      "飘檐外缘应由柱心向前挑出二楼前檐");
    assert.ok(Math.abs(new THREE.Box3().setFromObject(villa.levels[2].getObjectByName("外伸门厅三楼平台")!).min.z - e.porticoColumnZ) < 0.01,
      "三楼门厅平台北缘与柱心／折角对齐");
  } finally {
    villa.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});

test("门厅两角柱心贯通二维、总图、三维、露台及立面，支持造型换位和改截面", () => {
  for (const porticoStyle of ["projecting", "recessed"] as const) for (const buildingPlacement of ["main-east", "main-west"] as const) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoStyle, buildingPlacement, porticoWidth: 5000, porticoProjection: 2200, porticoColumnSize: 900 });
    const draft = clonePublishedLayout(), live = villaLayoutFromDraft(draft);
    const corners = [{ x: site.portico.x, z: porticoFrontZ() }, { x: site.portico.x + site.portico.w, z: porticoFrontZ() }];
    for (const editorCanvas of [false, true]) for (const floor of [0, 1]) {
      const svg = floorPlan(floor, false, false, { editorCanvas }, planSourceFromDraft(draft, floor));
      assert.deepEqual(drawnColumns(svg), corners);
    }
    assert.deepEqual(drawnColumns(courtyardSitePlan()), corners);
    for (const style of ["joined", "floating"] as const) {
      const model = buildVilla(mat, false, 4.5, style, live);
      try {
        model.group.updateMatrixWorld(true);
        const columns = model.portico.children.filter(o => o.name === "参考图通高门厅雕花柱");
        assert.deepEqual(columns.map(o => ({ x: o.position.x, z: o.position.z })), corners);
        const short = model.levels[2].getObjectByName("四根露台短柱")!.children.slice(1, 3);
        assert.deepEqual(short.map(o => ({ x: o.position.x, z: o.position.z })), corners);
        for (const post of short) {
          const width = new THREE.Box3().setFromObject(post).getSize(new THREE.Vector3()).x;
          assert.ok(width <= 1000.1, "角点上的中央短柱仍遵守含饰线外包宽度");
        }
        const steps = new THREE.Box3().setFromObject(model.portico.getObjectByName("柱间三步")!);
        assert.equal(steps.min.x, corners[0].x + 450);
        assert.equal(steps.max.x, corners[1].x - 450);
        const beam = new THREE.Box3().setFromObject(model.portico.getObjectByName("门厅柱间横梁实体")!);
        assert.equal(beam.min.x, steps.min.x - 8);
        assert.equal(beam.max.x, steps.max.x + 8);
        assert.ok(Math.abs(beam.getCenter(new THREE.Vector3()).z - corners[0].z) < .1,
          "改柱截面、门厅造型或主辅楼换位后，门廊进深仍以柱心居中");
        const elevation = elevationModel(style, live);
        assert.deepEqual(elevation.front.balustradePosts.slice(1, 3).map(p => ({ x: p.x, z: p.z })), corners);
      } finally {
        model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      }
    }
    assert.equal(porticoColumnSpacing({ ...DEFAULT_VILLA_PARAMS, porticoWidth: 5000, porticoColumnSize: 900 }), 5000);
    assert.equal(buildingAreas.portico, 11);
  }
});

test("门厅草稿偏移改宽后柱心仍落角点，临时三维与立面上下文不污染全局", () => {
  resetVillaParams();
  const before = JSON.stringify({ porch: site.portico, front: frontElevation });
  const draft = clonePublishedLayout();
  draft.portico.x += 200;
  draft.portico.w = 4800;
  draft.portico.projection += 300;
  const live = villaLayoutFromDraft(draft);
  const columnZ = site.main.z - draft.portico.projection;
  const corners = [{ x: draft.portico.x, z: columnZ }, { x: draft.portico.x + draft.portico.w, z: columnZ }];
  assert.deepEqual(drawnColumns(floorPlan(0, false, false, { editorCanvas: true }, planSourceFromDraft(draft, 0))), corners);
  const model = buildVilla(mat, false, 4.5, "joined", live);
  try {
    const columns = model.portico.children.filter(o => o.name === "参考图通高门厅雕花柱");
    assert.deepEqual(columns.map(o => ({ x: o.position.x, z: o.position.z })), corners);
    assert.deepEqual(elevationModel("joined", live).front.balustradePosts.slice(1, 3).map(p => ({ x: p.x, z: p.z })), corners);
    assert.equal(JSON.stringify({ porch: site.portico, front: frontElevation }), before);
  } finally {
    model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});

test("门厅净宽按两柱相向的半截面扣减，过窄拒绝且面积仍取门厅矩形", () => {
  const accepted = { ...DEFAULT_VILLA_PARAMS, porticoWidth: 1800 };
  assert.deepEqual(validateVillaParams(accepted), []);
  const rejected = validateVillaParams({ ...accepted, porticoWidth: 1799 });
  assert.ok(rejected.some(issue => issue.field === "porticoWidth" && issue.message.includes("899")));
  applyVillaParams(accepted);
  assert.equal(buildingAreas.portico, 3.6);
  assert.equal(buildingAreas.total, 171.6);
});

test("两侧露台短柱外皮对齐下层包角柱外皮，改突出量后仍联动", () => {
  try {
    for (const cornerProject of [100, 150, 250]) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, cornerProject });
      for (const post of [frontElevation.balustradePosts[0], frontElevation.balustradePosts[3]])
        assert.equal(post.z - post.w / 2, site.main.z - 120 - cornerProject);
    }
  } finally { resetVillaParams(); }
});
