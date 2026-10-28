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
  const live = villaLayoutFromDraft(draft);
  const corners = [{ x: draft.portico.x, z: porticoFrontZ() }, { x: draft.portico.x + draft.portico.w, z: porticoFrontZ() }];
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
