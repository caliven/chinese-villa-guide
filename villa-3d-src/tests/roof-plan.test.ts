import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { roofPlanModel, villaLayoutFromDraft } from "../src/architecture";
import { clonePublishedLayout } from "../src/layout-draft";
import { floors, frontElevation, site } from "../src/data";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params";
import { hipRoofSurfaces, type RoofFace } from "../src/roof-surfaces";
import { roofPlanSvg, roofProjectedEdges } from "../src/roof-plan";
import { roofTileEaveLift, roofTileInset } from "../src/roof-options";

test("普通官帽加宽有效瓦面、前侧等坡，天沟改宽不挤占瓦面，悬浮宽度独立保留", () => {
  resetVillaParams();
  try {
    const ordinary = roofPlanModel("joined"), floating = roofPlanModel("floating");
    assert.equal(ordinary.hat.w, 7100);
    assert.equal(ordinary.hat.w - 2 * roofTileInset, 5350);
    assert.equal(ordinary.hat.ridgeFront - ordinary.hat.z - roofTileInset, 2675);
    assert.equal(ordinary.hat.eave, ordinary.main.eave);
    assert.equal(ordinary.hat.peak, ordinary.mainPeak);
    const rise = ordinary.hat.peak - ordinary.hat.eave - roofTileEaveLift();
    assert.ok(Math.atan(rise / 2675) * 180 / Math.PI < 37, "默认前坡从原先约53度舒展至约36度");
    assert.equal(floating.hat.w, DEFAULT_VILLA_PARAMS.porticoWidth + 1040);
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, gutterClearWidth: 800 });
    const wideGutter = roofPlanModel("joined");
    assert.equal(wideGutter.hat.w - 2 * roofTileInset, 5350);
    assert.equal(wideGutter.hat.w, ordinary.hat.w + 400);
    assert.ok(wideGutter.hat.ridgeFront > ordinary.hat.ridgeFront);
  } finally { resetVillaParams(); }
});

test("普通官帽随门厅草稿定位，主辅换位、退台和凹入组合均保留两翼并接脊", () => {
  try {
    for (const buildingPlacement of ["main-east", "main-west"] as const)
      for (const thirdFloorMode of ["setback", "flush"] as const)
        for (const porticoStyle of ["projecting", "recessed"] as const) {
          applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement, thirdFloorMode, porticoStyle });
          const draft = clonePublishedLayout();
          draft.portico.x += 200;
          draft.portico.w -= 400;
          const m = roofPlanModel("joined", villaLayoutFromDraft(draft));
          assert.equal(m.hat.x + m.hat.w / 2, draft.portico.x + draft.portico.w / 2);
          assert.equal(m.hat.w - 2 * roofTileInset, draft.portico.w + 750);
          assert.ok(m.hat.x >= m.main.x + 1000);
          assert.ok(m.hat.x + m.hat.w <= m.main.x + m.main.w - 1000);
          assert.ok(m.hat.ridgeFront < m.hat.joinZ);
          assert.ok(m.mainFaces.every(f => f.points.every(p => Number.isFinite(p.y))));
        }
  } finally { resetVillaParams(); }
});

test("普通官帽在门厅草稿靠近一翼时收窄外包络，不挤掉正屋两翼或生成反向瓦面", () => {
  resetVillaParams();
  const draft = clonePublishedLayout();
  draft.portico.x = site.main.x + 1000;
  const m = roofPlanModel("joined", villaLayoutFromDraft(draft));
  assert.ok(m.hat.w < draft.portico.w + 750 + 2 * roofTileInset);
  assert.ok(m.hat.x >= m.main.x + 1000);
  assert.ok(m.hat.x + m.hat.w <= m.main.x + m.main.w - 1000);
  assert.ok(m.hat.w - 2 * roofTileInset > 400);
  assert.ok(m.hat.ridgeFront < m.hat.joinZ);
});

test("屋面投影保留四坡五脊，裁切片内的共面缝不会变成屋脊", () => {
  const hip = hipRoofSurfaces(0, 0, 14000, 10000, 10000, 2250);
  const edges = roofProjectedEdges(hip.faces);
  assert.equal(edges.filter(e => e.kind === "ridge").length, 5);
  assert.equal(edges.filter(e => e.kind === "edge").length, 4);
  assert.equal(edges.filter(e => e.kind === "valley").length, 0);
  const original = hip.faces[0];
  const [a, b, c, d] = original.points;
  const split = [{ ...original, points: [a, b, c] }, { ...original, points: [a, c, d] }];
  assert.equal(roofProjectedEdges(split).length, 4);
});

test("谷线按交线两侧的实际坡向识别，不受裁切片重心的沿脊高度影响", () => {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const face = (points: THREE.Vector3[]): RoofFace => ({ points, across: [1, 0], origin: [0, 0], owner: 0 });
  const faces = [face([v(0, 0, 0), v(0, 100, 100), v(-100, 200, 100)]), face([v(0, 0, 0), v(100, 200, 100), v(0, 100, 100)])];
  assert.equal(roofProjectedEdges(faces).filter(e => e.kind === "valley").length, 1);
});

test("两种官帽同用主辅楼控制尺寸，原有同脊、悬浮落脊，隐藏坡面裁去", () => {
  resetVillaParams();
  const joined = roofPlanModel("joined"), floating = roofPlanModel("floating");
  assert.deepEqual(joined.main, floating.main);
  assert.deepEqual(joined.annexFaces, floating.annexFaces);
  assert.equal(joined.main.w, DEFAULT_VILLA_PARAMS.mainWidth + 2 * DEFAULT_VILLA_PARAMS.thirdEave);
  assert.equal(joined.main.d, DEFAULT_VILLA_PARAMS.mainDepth - DEFAULT_VILLA_PARAMS.thirdSetback + 2 * DEFAULT_VILLA_PARAMS.thirdEave);
  assert.equal(joined.hat.peak, joined.mainPeak);
  assert.equal(floating.mainPeak - floating.hat.peak, DEFAULT_VILLA_PARAMS.floatingHatRidgeDrop);
  assert.equal(joined.frontTrimGap, undefined);
  assert.deepEqual(floating.frontTrimGap, [frontElevation.postXs[0] - frontElevation.dividerWidth / 2,
    frontElevation.postXs[1] + frontElevation.dividerWidth / 2]);
  assert.match(roofPlanSvg("floating", "floating"), /clip-path="url\(#roof-floating-main-trim\)"/);
  assert.doesNotMatch(roofPlanSvg("joined", "joined"), /main-trim/);
  assert.ok(joined.mainFaces.some(f => f.owner === 1));
  assert.ok(floating.mainFaces.some(f => f.owner === 1));
  assert.ok(roofProjectedEdges(joined.mainFaces).some(e => e.kind === "valley"));
  for (const m of [joined, floating]) {
    assert.ok(m.mainFaces.every(f => f.points.every(p => Number.isFinite(p.y) && p.y <= m.mainPeak + .01)));
  }
});

test("尺寸、分水与草稿门厅联动，屋面计算不改写参数和用户户型", () => {
  resetVillaParams();
  const draft = clonePublishedLayout();
  draft.portico.x += 200;
  draft.portico.w -= 400;
  draft.portico.projection = 2400;
  const before = JSON.stringify([draft, site, floors, frontElevation]);
  const m = roofPlanModel("floating", villaLayoutFromDraft(draft));
  assert.equal(m.hat.x + m.hat.w / 2, draft.portico.x + draft.portico.w / 2);
  assert.equal(m.hat.w, draft.portico.w + 1040);
  assert.equal(JSON.stringify([draft, site, floors, frontElevation]), before);
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, roofFenShui: 6, thirdSetback: 1600 });
    const changed = roofPlanModel("joined");
    assert.notEqual(changed.main.d, m.main.d);
    assert.ok(changed.pitch.mainRise > m.pitch.mainRise);
    for (const view of ["slab", "joined", "floating"] as const) assert.doesNotMatch(roofPlanSvg(view, "joined"), /NaN|Infinity|undefined/);
  } finally { resetVillaParams(); }
});

test("屋顶层仅表示顶板及下层投影，楼梯删除后不残留投影，SVG可独立显示", () => {
  resetVillaParams();
  const draft = clonePublishedLayout();
  const svg = roofPlanSvg("slab", "joined", villaLayoutFromDraft(draft));
  assert.match(svg, /三层顶板范围/);
  assert.match(svg, /三层楼梯投影/);
  draft.floors[2].rooms = draft.floors[2].rooms.filter(r => r.kind !== "stair");
  assert.doesNotMatch(roofPlanSvg("slab", "joined", villaLayoutFromDraft(draft)), /三层楼梯投影/);
  for (const view of ["slab", "joined", "floating"] as const) {
    const drawing = roofPlanSvg(view, "joined");
    assert.match(drawing, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(drawing, /<style>/);
    assert.match(drawing, /雨水口.*待设计/);
    assert.doesNotMatch(drawing, /data-edit=|data-room=|<image|<script|NaN|Infinity/);
  }
});
