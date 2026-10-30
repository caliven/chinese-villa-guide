import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildVilla, elevationModel, villaLayoutFromDraft } from "../src/architecture";
import { frontApronOutline, porticoFrontZ } from "../src/building-variants";
import { apronEaveDesign } from "../src/roof-options";
import { elevationShell } from "../src/elevation-plan";
import { buildingAreas, frontElevation, site } from "../src/data";
import { clonePublishedLayout } from "../src/layout-draft";
import { courtyardSitePlan, floorPlan, planSourceFromDraft } from "../src/plan";
import type { Mats } from "../src/primitives";
import { DEFAULT_VILLA_PARAMS, applyVillaParams, porticoColumnSpacing, resetVillaParams, validateVillaParams } from "../src/villa-params";

const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; } });
test.afterEach(resetVillaParams);
test.after(() => Object.values(mat).forEach(material => material.dispose()));

function drawnColumns(svg: string) {
  const marked = svg.includes('data-plan-column="portico"');
  const pattern = marked
    ? /<g data-plan-column="portico"[^>]*><title>[^<]*<\/title><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g
    : /<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="#879183"/g;
  return [...svg.matchAll(pattern)]
    .slice(0, 2).map(([, x, z, w, d]) => ({ x: Number(x) + Number(w) / 2, z: Number(z) + Number(d) / 2 }));
}

test("飘檐折角向柱外沿偏移，柱位与门厅控制区保留且柱顶不越过下沿线", async () => {
  const { frontApronSection } = await import("../src/roof-options");
  const { floors } = await import("../src/data");
  const { terraceParapetLayout } = await import("../src/facade-details");
  resetVillaParams();
  const e = frontElevation;
  const layout = terraceParapetLayout();
  assert.equal(e.centerFront, e.porticoColumnZ, "露台北缘仍采用柱心控制线，独立于飘檐折角");
  assert.equal(e.postXs[0], site.portico.x);
  assert.equal(e.postXs[1], site.portico.x + site.portico.w);
  assert.deepEqual(e.balustradePosts.slice(1, 3).map(p => ({ x: p.x, z: p.z })),
    layout.cornerPosts.slice(1, 3).map(p => ({ x: p.x, z: p.z })),
    "中央将军柱落在挡墙中线交点，不与门厅柱同轴");
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
    const outline = frontApronOutline(e.terraceBack, site.secondFrontEave);
    assert.ok(Math.abs(eaveBounds.min.z - outline[3][1]) < 50,
      "瓦檐外缘随拐角外移，仍由承托线挑出二楼前檐");
    assert.ok(Math.abs(new THREE.Box3().setFromObject(villa.levels[2].getObjectByName("外伸门厅三楼平台")!).min.z - e.porticoColumnZ) < 0.01,
      "三楼门厅平台北缘仍与柱心对齐");
  } finally {
    villa.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});

test("实际飘檐收口拐角距柱身两个外沿各留1/8，改柱宽、换位及三楼模式自动联动", () => {
  for (const porticoColumnSize of [600, 800, 1000])
    for (const buildingPlacement of ["main-east", "main-west"] as const)
      for (const thirdFloorMode of ["setback", "flush"] as const) {
        applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoColumnSize, buildingPlacement, thirdFloorMode });
        const draft = clonePublishedLayout();
        draft.portico.x += 150;
        draft.portico.projection += 250;
        draft.floors.forEach(f => f.furniture = []);
        draft.annexFurniture = [];
        const source = JSON.stringify(draft);
        const live = villaLayoutFromDraft(draft);
        const style = thirdFloorMode === "setback" ? "floating" : "joined";
        const villa = buildVilla(mat, false, 4.5, style, live);
        try {
          villa.group.updateMatrixWorld(true);
          const columnZ = site.main.z - draft.portico.projection;
          const fascia = villa.levels[2].getObjectByName("连续转角下沿线")!;
          const front = new THREE.Box3().setFromObject(fascia.children[3]);
          const inset = porticoColumnSize / 8;
          const outerWest = draft.portico.x - porticoColumnSize / 2;
          const outerEast = draft.portico.x + draft.portico.w + porticoColumnSize / 2;
          const outerFront = columnZ - porticoColumnSize / 2;
          assert.ok(Math.abs(front.min.x - outerWest - inset) < .1, "西拐角可见外边距须为柱宽1/8");
          assert.ok(Math.abs(outerEast - front.max.x - inset) < .1, "东拐角可见外边距须为柱宽1/8");
          assert.ok(Math.abs(front.min.z - outerFront - inset) < .1, "北向可见外边距须为柱深1/8");
          for (const [i, x, outward] of [[0, draft.portico.x, -1], [1, draft.portico.x + draft.portico.w, 1]]) {
            const side = new THREE.Box3().setFromObject(fascia.children[i === 0 ? 2 : 4]);
            assert.ok(Math.abs((outward < 0 ? side.min.x : side.max.x) - (outward < 0 ? front.min.x : front.max.x)) < .1,
              "侧线与前线在同一拐角闭合");
            assert.ok(Math.abs(side.min.z - front.min.z) < .1);
            const shoulder = villa.portico.children.filter(o => o.name === "门厅柱外展斜肩")[i];
            const offset = porticoColumnSize * 3 / 8 - 10;
            const hit = new THREE.Raycaster(new THREE.Vector3(x + outward * offset, front.min.y + 1, columnZ - offset),
              new THREE.Vector3(0, -1, 0)).intersectObject(shoulder, true)[0];
            assert.ok(hit && Math.abs(hit.point.y - front.min.y) < .1, "两向收口拐角下方须有柱冠斜肩实体承接");
          }
          const e = elevationModel(style, live).front;
          const control = frontApronOutline(e.terraceBack, 0, e, draft.portico);
          assert.ok(Math.abs(front.min.x - (control[3][0] - apronEaveDesign.fasciaProtrusion)) < .1,
            "立面共用轮廓须包括线脚突出量，不能用承托线代替可见外缘");
          const lines = elevationShell("north", style, live).surfaces.filter(s => s.part === "apron-support");
          for (const x of [front.min.x, front.max.x])
            assert.ok(lines.some(s => s.points.some(p => Math.abs(p.x - x) < .1 && Math.abs(p.z - front.min.z) < .1
              && Math.abs(p.y - front.min.y) < .1)), "二维立面须投影三维最终可见收口拐角");
          assert.equal(e.centerFront, columnZ);
          assert.equal(JSON.stringify(draft), source);
        } finally {
          villa.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
        }
      }
});

test("门厅两角柱心贯通二维、总图、三维、露台及立面，支持造型换位和改截面", () => {
  for (const porticoStyle of ["projecting"] as const) for (const buildingPlacement of ["main-east", "main-west"] as const) {
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
        const elevation = elevationModel(style, live);
        const shortCorners = elevation.front.balustradePosts.slice(1, 3).map(p => ({ x: p.x, z: p.z }));
        assert.deepEqual(short.map(o => ({ x: o.position.x, z: o.position.z })), shortCorners,
          "中央将军柱与立面同源，落在挡墙中线交点");
        assert.ok(shortCorners.every((p, i) => Math.abs(p.x - corners[i].x) > 1 || Math.abs(p.z - corners[i].z) > 1),
          "将军柱不再与门厅柱同轴");
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
    const shortCorners = elevationModel("joined", live).front.balustradePosts.slice(1, 3).map(p => ({ x: p.x, z: p.z }));
    assert.ok(shortCorners.every((p, i) => Math.abs(p.x - corners[i].x) > 1 || Math.abs(p.z - corners[i].z) > 1),
      "草稿门厅下将军柱仍按挡墙中线交点，不贴回门厅柱轴");
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

test("两侧露台将军柱随包角突出量落在挡墙中线交点", async () => {
  const { terraceParapetLayout } = await import("../src/facade-details");
  try {
    for (const cornerProject of [100, 150, 250]) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, cornerProject });
      assert.equal(frontElevation.terraceFront, site.main.z - 120 - cornerProject);
      const layout = terraceParapetLayout();
      assert.deepEqual(
        [frontElevation.balustradePosts[0], frontElevation.balustradePosts[3]].map(p => ({ x: p.x, z: p.z })),
        [layout.cornerPosts[0], layout.cornerPosts[3]].map(p => ({ x: p.x, z: p.z })),
      );
    }
  } finally { resetVillaParams(); }
});
