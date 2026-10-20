import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { clonePublishedLayout, draftToJson, parseLayoutDraft, removeStairFromDraft, type StairDraft } from "../src/layout-draft.ts";
import { stairShape, stairOpeningBounds, stairWellBounds } from "../src/stair-geometry.ts";
import { stairs, stairSoffitClearHeight, type Mats } from "../src/primitives.ts";
import { collectPlanDimensions, planDimMm, planDimSpanMm } from "../src/plan-dimensions.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { site } from "../src/data.ts";

const host = { getFloor: () => 0, redraw: () => {}, toast: () => {} };

const stair = (): StairDraft => ({
  room: {x: 12900, z: 5370, w: 2800, d: 4200}, x: 13150, z: 5770,
  flight: 980, gap: 180, risers: 20, tread: 290, landing: 800, axis: "z",
  hole: {x: 12920, z: 5740, w: 2240, d: 3400},
});

test("南北向默认图左上踏步、图右返跑；一层返跑只画上方投影，上层画实体且不自带侧墙", () => {
  const draft = clonePublishedLayout(); draft.stairLayout = stair();
  const g = stairShape(draft.stairLayout);
  assert.ok(g.lower.x > g.upper.x, "旋转180度后东侧在图左");
  const first = floorPlan(0, false, false, {editable: true}, planSourceFromDraft(draft, 0));
  assert.equal((first.match(/class="stair-flight"/g) ?? []).length, 1);
  assert.match(first, /class="stair-overhead"/);
  assert.ok(!first.includes('data-stair-side-wall="1"'));
  assert.ok(first.includes("梯下可用"));
  for (const i of [1, 2]) {
    const html = floorPlan(i, false, false, {}, planSourceFromDraft(draft, i));
    assert.equal((html.match(/class="stair-flight"/g) ?? []).length, 2);
    assert.ok(!html.includes('data-stair-side-wall="1"'), "楼梯模型不自带侧墙");
    assert.ok(!html.includes('class="stair-overhead"'));
  }
});

test("放置楼梯时吸附到附近竖墙内侧，三层房间框同步", () => {
  const draft = clonePublishedLayout();
  removeStairFromDraft(draft);
  const wallX = site.main.x + 4500;
  for (const floor of draft.floors) {
    floor.rooms = [];
    floor.partitions = [{ a: [wallX, site.main.z], b: [wallX, site.main.z + site.main.d] }];
  }
  const editor = new LayoutEditor(host, draft);
  const w = draft.stairLayout.room.w;
  const d = draft.stairLayout.room.d;
  // 中心偏到墙西侧约 80mm：右缘靠近墙，应吸到墙中线（外轮廓＝墙内侧）
  editor.placeStairModelAt(wallX - w / 2 + 80, site.main.z + 3000 + d / 2);
  // snapMeter 取整到 mm；面宽比例缩放后梯间宽可能带小数
  assert.ok(Math.abs(draft.stairLayout.room.x - (wallX - w)) < 1);
  assert.ok(draft.floors.every((f) => f.rooms.some((r) => r.kind === "stair")));
  assert.ok(Math.abs(draft.floors[0]!.rooms.find((r) => r.kind === "stair")!.x - (wallX - w)) < 1);
  // 踏步／洞口由 fitStairToRoom 按房间重排，须仍落在梯间框内
  assert.ok(draft.stairLayout.x >= draft.stairLayout.room.x - 1);
  assert.ok(draft.stairLayout.x + draft.stairLayout.flight <= draft.stairLayout.room.x + draft.stairLayout.room.w + 1);
});

test("楼梯框不生成外圈墙距或墙厚碎档；房屋控制尺寸及总宽不变", () => {
  const draft = clonePublishedLayout(), s = stair();
  draft.stairLayout = s;
  for (const floor of draft.floors) floor.partitions = [];
  const read = (floor: number) => collectPlanDimensions(floor, draft.floors[floor]!, draft.annexPartitions, "main");
  for (let i = 0; i < 3; i++) {
    const dims = read(i);
    assert.deepEqual(dims.northXs, [dims.xLo, dims.xHi]);
    assert.deepEqual(dims.southXs, [dims.xLo, dims.xHi]);
  }
  const upper = read(1);
  const controls = upper.controls;
  s.room.w += 300;
  assert.deepEqual(read(1).controls, controls);
  assert.deepEqual(controls, [
    planDimMm(site.main.x),
    planDimMm(site.portico.x),
    planDimMm(site.portico.x + site.portico.w),
    planDimMm(site.main.x + site.main.w),
  ]);
  assert.equal(planDimSpanMm(read(1).xLo, read(1).xHi), 13600);
});

test("梯下净高来自实际返跑薄板，梯井缝和预留空位不再假设有平台", () => {
  const s = stair(), g = stairShape(s), p = g.point(g.upperAcross + s.flight / 2, 200);
  assert.ok(stairSoffitClearHeight(p.x, p.z, s, 3600)! > 3000);
  const gap = g.point(s.flight + s.gap / 2, 200);
  assert.equal(stairSoffitClearHeight(gap.x, gap.z, s, 3600), null);
  assert.equal(stairSoffitClearHeight(s.room.x + 20, s.room.z + 20, s, 3600), null);
});

test("立体读取当前草稿梯段宽、踏步深、平台与踢面数，实体不在梯下堆实心块", () => {
  const s = {...stair(), flight: 1200, tread: 270, landing: 1100, risers: 24};
  const parent = new THREE.Group();
  const mat = {paving: new THREE.MeshBasicMaterial(), metal: new THREE.MeshBasicMaterial()} as Mats;
  stairs(parent, s.x, s.z, 0, 3600, mat, s.axis, s);
  const bounds = new THREE.Box3().setFromObject(parent), g = stairShape(s);
  assert.ok(Math.abs(bounds.max.x - (g.footprint.x + g.footprint.w)) < 1);
  assert.ok(Math.abs(bounds.max.z - (g.footprint.z + g.footprint.d)) < 1);
  const slabs = parent.children.filter(o => o instanceof THREE.Mesh && o.geometry instanceof THREE.BoxGeometry);
  assert.equal(slabs.length, (g.lowerTreads + g.upperTreads) * 2 + 1);
  const upper = slabs.filter(o => o.position.x < s.x + s.flight);
  assert.ok(upper.every(o => new THREE.Box3().setFromObject(o).min.y > 1500), "图右返跑下方不得堆到地面");
});

test("起步侧镜像可保存／载入，东西向和奇数踢面也共用同一几何", () => {
  const draft = clonePublishedLayout(); draft.stairLayout = {...stair(), lowerSide: "min", risers: 21};
  const loaded = parseLayoutDraft(draftToJson(draft));
  assert.equal(loaded.stairLayout.lowerSide, "min");
  for (const axis of ["x", "z"] as const) {
    const g = stairShape({...loaded.stairLayout, axis});
    assert.equal(g.lowerRisers + g.upperRisers, 21);
    assert.equal(axis === "x" ? g.footprint.d : g.footprint.w, 2 * 980 + 180);
  }
});

test("楼板洞口与梯间至少包住真实踏步和平台，删除楼梯后不留自动侧墙或定位档", () => {
  const draft = clonePublishedLayout(), s = {...stair(), landing: 1500}; draft.stairLayout = s;
  const body = stairShape(s).footprint, opening = stairOpeningBounds(s), well = stairWellBounds(s);
  assert.ok(opening.z + opening.d >= body.z + body.d);
  assert.ok(well.z + well.d >= opening.z + opening.d);
  removeStairFromDraft(draft);
  const html = floorPlan(1, false, false, {}, planSourceFromDraft(draft, 1));
  assert.ok(!html.includes('data-stair-side-wall="1"'));
  assert.ok(!html.includes('data-dim-kind="stair"'));
  assert.ok(!html.includes('data-stair-floor='));
  assert.equal(site.main.w, 13600);
});
