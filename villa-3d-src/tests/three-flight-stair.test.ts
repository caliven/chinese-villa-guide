import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { site } from "../src/data.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft, ensureStairRooms, removeStairFromDraft } from "../src/layout-draft.ts";
import { stairShape, stairModelDefaults, fitStairToRoom, stairOpeningBounds, stairOpeningRails } from "../src/stair-geometry.ts";
import { stairs, stairSoffitClearHeight, type Mats } from "../src/primitives.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import { applyVillaParams, resetVillaParams, DEFAULT_VILLA_PARAMS } from "../src/villa-params.ts";
import { scaleLayoutDraftToEnvelope, envelopeFromSite } from "../src/layout-draft.ts";

const mat = { paving: new THREE.MeshBasicMaterial(), metal: new THREE.MeshBasicMaterial() } as Mats;
function setup() {
  const draft = clonePublishedLayout();
  for (const f of draft.floors) { f.rooms = []; f.partitions = []; f.furniture = []; }
  draft.stairLayout = stairModelDefaults({ ...draft.stairLayout, axis: "z", direction: "positive", lowerSide: "min",
    room: { x: site.main.x + 4000, z: site.main.z + 3000, w: 4080, d: 2880 } }, "triple", draft.floors);
  ensureStairRooms(draft);
  return draft;
}

test("三跑常用默认尺寸：1100宽、280深、1200平台、21踢面和两个独立转角", () => {
  const draft = setup(), s = fitStairToRoom(draft.stairLayout, draft.floors), g = stairShape(s);
  assert.equal(g.model, "triple"); if (g.model !== "triple") return;
  assert.deepEqual([s.flight, s.tread, s.landing, g.risers], [1100, 280, 1200, 21]);
  assert.deepEqual(g.flights.map(f => f.risers), [7, 7, 7]);
  assert.deepEqual([g.footprint.w, g.footprint.d], [4080, 2880]);
  assert.equal(g.platforms.length, 2);
  assert.equal(g.flights[0].along + g.flights[0].alongSize, g.platforms[0].along);
  assert.equal(g.platforms[0].cross + s.landing, g.flights[1].cross);
  assert.equal(g.flights[1].cross + g.flights[1].crossSize, g.platforms[1].cross);
  assert.equal(g.flights[2].along + g.flights[2].alongSize, g.platforms[1].along);
});

test("三跑八种摆放共用实体包络、上行高度和板底，顶层出口不被洞口护栏封住", () => {
  for (const axis of ["x", "z"] as const) for (const direction of ["positive", "negative"] as const) for (const lowerSide of ["min", "max"] as const) {
    const s = { ...setup().stairLayout, axis, direction, lowerSide }, g = stairShape(s);
    assert.equal(g.model, "triple"); if (g.model !== "triple") continue;
    const group = new THREE.Group(); stairs(group, s.x, s.z, 0, 3600, mat, axis, s);
    const slabs = group.children.filter((o): o is THREE.Mesh<THREE.BoxGeometry> => o instanceof THREE.Mesh && o.geometry instanceof THREE.BoxGeometry);
    assert.equal(slabs.length, g.risers - 3 + g.risers + 2);
    const bounds = new THREE.Box3(); for (const slab of slabs) bounds.union(new THREE.Box3().setFromObject(slab));
    assert.ok(Math.abs(bounds.min.y) < 1 && Math.abs(bounds.max.y - 3600) < 1);
    assert.ok(Math.abs(bounds.min.x - g.footprint.x) < 1 && Math.abs(bounds.max.x - g.footprint.x - g.footprint.w) < 1);
    assert.ok(Math.abs(bounds.min.z - g.footprint.z) < 1 && Math.abs(bounds.max.z - g.footprint.z - g.footprint.d) < 1);
    // 用真实板底射线交点验证计算值，覆盖三段不同上行方向及两平台。
    for (const f of g.flights) for (const ratio of [.12, .52, .88]) {
      const p = g.point(f.cross + f.crossSize * (f.axis === "across" ? ratio : .5), f.along + f.alongSize * (f.axis === "along" ? ratio : .5));
      group.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(new THREE.Vector3(p.x, -100, p.z), new THREE.Vector3(0, 1, 0));
      const hits = ray.intersectObjects(slabs);
      const expected = stairSoffitClearHeight(p.x, p.z, s, 3600)!;
      assert.ok(hits.length && Math.abs(hits[0].point.y - expected) < .1);
    }
    for (const p of g.platforms) {
      const center = g.point(p.cross + s.landing / 2, p.along + s.landing / 2);
      assert.equal(stairSoffitClearHeight(center.x, center.z, s, 3600), p.riser * 3600 / g.risers - 180);
    }
    const empty = g.point(g.across / 2, g.run / 2);
    assert.equal(stairSoffitClearHeight(empty.x, empty.z, s, 3600), null);
    const entry = g.point(g.upperAcross + s.flight / 2, 0);
    const rails = stairOpeningRails({ ...s, hole: g.footprint });
    assert.ok(rails.every(([a, b]) => Math.min(a[0], b[0]) > entry.x + 1 || Math.max(a[0], b[0]) < entry.x - 1 || Math.min(a[1], b[1]) > entry.z + 1 || Math.max(a[1], b[1]) < entry.z - 1));
  }
});

test("三层平面共用三跑且顶层向下，首层上方横跑和返跑不占梯下命中区", () => {
  const draft = setup();
  for (const floor of [0, 1, 2]) {
    const html = floorPlan(floor, false, false, { editable: true }, planSourceFromDraft(draft, floor));
    assert.match(html, /data-stair-model="triple"/);
    assert.equal((html.match(/data-stair-flight=/g) ?? []).length, 3);
    assert.equal((html.match(/class="stair-flight"/g) ?? []).length, floor === 0 ? 1 : 3);
    assert.equal((html.match(/class="stair-platform"/g) ?? []).length, floor === 0 ? 1 : 2);
    assert.equal((html.match(/class="stair-overhead"/g) ?? []).length, floor === 0 ? 3 : 0);
    assert.equal((html.match(/class="edit-hit" data-edit="stair"/g) ?? []).length, floor === 0 ? 2 : 5);
  }
});

test("三跑支持规格联动、四向切换、镜像起步、撤销重做和JSON往返，旧稿仍是双跑", () => {
  const draft = setup(), editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, draft);
  editor.selection = { kind: "stair" };
  for (const [field, value] of [["flight", 1200], ["tread", 300], ["landing", 1300], ["risers", 24]] as const) {
    editor.updateSelectedNumber(field, value);
    const fitted = fitStairToRoom(editor.draft.stairLayout, editor.draft.floors);
    assert.equal(fitted[field], value);
  }
  for (const direction of ["north", "east", "west", "south"] as const) {
    editor.setStairDirection(direction);
    assert.equal(editor.draft.stairLayout.axis, direction === "east" || direction === "west" ? "x" : "z");
    assert.equal(editor.draft.stairLayout.direction, direction === "north" || direction === "west" ? "negative" : "positive");
  }
  editor.setStairLowerSide("max");
  assert.equal(parseLayoutDraft(draftToJson(editor.draft)).stairLayout.model, "triple");
  const before = structuredClone(editor.draft.stairLayout);
  editor.setStairModel("double"); assert.equal(editor.draft.stairLayout.model, "double");
  editor.undo(); assert.deepEqual(editor.draft.stairLayout, before);
  editor.redo(); assert.equal(editor.draft.stairLayout.model, "double");
  const old = clonePublishedLayout(); delete old.stairLayout.model;
  assert.equal(stairShape(parseLayoutDraft(draftToJson(old)).stairLayout).model, "double");
});

test("三跑从素材库放置及删除同步三层，尺寸过大与无空间模型切换整次回滚", () => {
  const draft = setup(); removeStairFromDraft(draft);
  draft.stairLayout = stairModelDefaults(draft.stairLayout, "double", draft.floors);
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, draft);
  editor.placeAt(site.main.x + 6500, site.main.z + 5000, "room", "stair-triple");
  assert.equal(editor.draft.stairLayout.model, "triple");
  assert.ok(editor.draft.floors.every(f => f.rooms.some(r => r.kind === "stair")));
  const before = structuredClone(editor.draft.stairLayout);
  editor.updateSelectedNumber("roomW", 30000);
  assert.deepEqual(editor.draft.stairLayout, before);
  removeStairFromDraft(editor.draft);
  assert.ok(editor.draft.floors.every(f => f.rooms.every(r => r.kind !== "stair")));
});

test("三跑实际墙净空与楼板洞口一致，不因梯井缝的双跑公式破坏三跑", () => {
  const draft = setup(), s = draft.stairLayout;
  const r = s.room;
  for (const floor of draft.floors) floor.partitions = [{ a: [r.x, r.z], b: [r.x, r.z + r.d], role: "bearing" }];
  const fitted = fitStairToRoom(s, draft.floors), g = stairShape(fitted), hole = stairOpeningBounds(fitted);
  assert.ok(g.footprint.x >= r.x + 120);
  assert.ok(g.footprint.x + g.footprint.w <= r.x + r.w + 1);
  assert.ok(g.footprint.z + g.footprint.d <= r.z + r.d + 1);
  assert.ok(hole.w >= g.footprint.w && hole.d >= g.footprint.d);
  assert.equal(s.flight, 1100, "派生不得回写源稿");
});

test("原双跑周围墙体容不下三跑时保留整套楼梯及房间框，奇数总级数不丢级", () => {
  const draft = setup(); draft.stairLayout = stairModelDefaults(draft.stairLayout, "double", draft.floors);
  ensureStairRooms(draft);
  const r = draft.stairLayout.room;
  for (const f of draft.floors) f.partitions = [
    { a: [r.x, r.z], b: [r.x, r.z + r.d] },
    { a: [r.x + r.w, r.z], b: [r.x + r.w, r.z + r.d] },
  ];
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, draft);
  editor.selection = { kind: "stair" };
  const before = structuredClone(editor.draft.stairLayout);
  editor.setStairModel("triple");
  assert.deepEqual(editor.draft.stairLayout, before);
  assert.ok(editor.draft.floors.every(f => f.rooms.find(r => r.kind === "stair")?.w === before.room.w));
  for (const risers of [19, 20, 22, 23, 25]) {
    const g = stairShape({ ...setup().stairLayout, risers });
    if (g.model !== "triple") assert.fail();
    assert.equal(g.flights.reduce((sum, f) => sum + f.risers, 0), risers);
    assert.equal(g.lowerRisers, g.upperRisers, "两端同长，楼层起终步对齐");
  }
});

test("主辅楼换位后保留三跑类型并镜像上行方向与起步侧，往返不改源稿", () => {
  try {
    for (const axis of ["x", "z"] as const) {
      resetVillaParams();
      const draft = setup(); draft.stairLayout.axis = axis;
      const original = structuredClone(draft.stairLayout);
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement: "main-west" });
      const mirrored = scaleLayoutDraftToEnvelope(draft, envelopeFromSite());
      assert.equal(mirrored.stairLayout.model, "triple");
      if (axis === "x") assert.equal(mirrored.stairLayout.direction, "negative");
      else assert.equal(mirrored.stairLayout.lowerSide, "max");
      resetVillaParams();
      const back = scaleLayoutDraftToEnvelope(mirrored, envelopeFromSite());
      assert.equal(back.stairLayout.direction, original.direction);
      assert.equal(back.stairLayout.lowerSide, original.lowerSide);
      assert.ok(Math.abs(back.stairLayout.room.x - original.room.x) < 1);
      assert.deepEqual(draft.stairLayout, original);
    }
  } finally { resetVillaParams(); }
});


test("三跑手动缩框后按显示踏面进深继续修改，不叠加隐藏旧规格", () => {
  const draft = setup(), editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, draft);
  editor.selection = { kind: "stair" };
  editor.updateSelectedNumber("roomD", 2600);
  const before = fitStairToRoom(editor.draft.stairLayout, editor.draft.floors);
  assert.ok(before.tread < 280);
  editor.updateSelectedNumber("tread", 250);
  const fitted = fitStairToRoom(editor.draft.stairLayout, editor.draft.floors);
  assert.ok(Math.abs(fitted.tread - 250) < 1);
  assert.equal(parseLayoutDraft(draftToJson(editor.draft)).stairLayout.model, "triple");
});
