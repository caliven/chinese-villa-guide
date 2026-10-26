import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { construction, site, type Room, type Wall } from "../src/data.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft, ensureStairRooms } from "../src/layout-draft.ts";
import { syncRoomsFromWalls } from "../src/room-sync.ts";
import { polygonIntersectionAreaMm2 } from "../src/plan-regions.ts";
import { roomOutline } from "../src/room-geometry.ts";
import * as stairGeometry from "../src/stair-geometry.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import { stairs, stairSoffitClearHeight, type Mats } from "../src/primitives.ts";

const { fitStairToRoom, stairShape, stairOpeningRails, stairStoryHeight } = stairGeometry;

// 用户截图的墙端、旧开敞区与中间新增墙；使用相对坐标避免改写保存户型。
function dividedOpenRoom() {
  const body = { x: 0, z: 0, w: 13600, d: 10000 };
  const walls: Wall[] = [
    { id: "wall-1", role: "bearing", a: [13480, 3600], b: [9400, 3600] },
    { id: "wall-2", role: "bearing", a: [13480, 6200], b: [9471, 6200] },
    { id: "wall-3", role: "bearing", a: [9400, 9880], b: [9400, 6200] },
    { id: "wall-5", role: "bearing", a: [8431, 5000], b: [120, 5000] },
    { id: "wall-6", role: "bearing", a: [4777, 9880], b: [4777, 5000] },
  ];
  const rooms: Room[] = [
    { id: "room1", name: "房间1", kind: "living", x: 9400, z: 0, w: 4200, d: 3600, boundary: { key: "open-walls:exterior:east|exterior:north|wall-1:north", status: "open" } },
    { id: "room3", name: "房间3", kind: "living", x: 0, z: 6800, w: 9400, d: 3200, label: [4700, 8400], boundary: { key: "open-walls:exterior:south|exterior:west|wall-3:west", status: "unbounded" } },
    { id: "room4", name: "房间4", kind: "living", x: 0, z: 0, w: 8431, d: 5000, boundary: { key: "open-walls:exterior:north|exterior:west|wall-5:north", status: "open" } },
    { id: "stair0", name: "楼梯", kind: "stair", x: 10866, z: 3600, w: 2500, d: 2600 },
  ];
  return { body, walls, rooms };
}

test("旧开敞区被补墙分割后按真实闭合／开敞子区更新，不保留跨墙色块", () => {
  const { body, walls, rooms } = dividedOpenRoom();
  const protectedBefore = structuredClone(rooms[3]);
  const result = syncRoomsFromWalls(body, walls, rooms, { associateExisting: true });
  const original = rooms.find(r => r.id === "room3")!;
  assert.deepEqual([original.x, original.z, original.w, original.d, original.boundary?.status], [0, 5000, 4777, 5000, "enclosed"]);
  assert.ok(rooms.some(r => r.x === 4777 && r.w === 4623 && r.boundary?.status === "open"));
  assert.deepEqual(rooms.find(r => r.id === "stair0"), protectedBefore);
  assert.equal(result.issues.some(s => s.includes("已有「房间3」")), false);
  const editable = rooms.filter(r => r.kind !== "stair");
  for (const [i, a] of editable.entries()) for (const b of editable.slice(i + 1)) {
    assert.equal(polygonIntersectionAreaMm2(roomOutline(a), roomOutline(b)), 0);
  }
  const snapshot = structuredClone(rooms);
  const repeat = syncRoomsFromWalls(body, walls, rooms, { associateExisting: true });
  assert.equal(repeat.created, 0);
  assert.equal(repeat.updated, 0);
  assert.deepEqual(rooms, snapshot);
});

test("没有自动墙边界关联的旧手工区不会被新增墙猜测改写", () => {
  const { body, walls, rooms } = dividedOpenRoom();
  delete rooms[1]!.boundary;
  const manual = structuredClone(rooms[1]);
  syncRoomsFromWalls(body, walls, rooms, { associateExisting: true });
  assert.deepEqual(rooms.find(r => r.id === "room3"), manual);
});

function stairDraft() {
  const draft = clonePublishedLayout();
  for (const floor of draft.floors) { floor.partitions = []; floor.rooms = []; floor.furniture = []; }
  draft.stairLayout = {
    x: site.main.x + 4000, z: site.main.z + 3000,
    room: { x: site.main.x + 4000, z: site.main.z + 3000, w: 3600, d: 2600 },
    hole: { x: site.main.x + 4000, z: site.main.z + 3000, w: 3600, d: 2600 },
    axis: "x", flight: 1210, gap: 180, risers: 20, tread: 300, landing: 900,
  };
  ensureStairRooms(draft);
  return draft;
}

test("四向上行及起步侧：平面变换、实体高差、板底净高、洞口出入口一致", () => {
  const draft = stairDraft();
  const mat = { paving: new THREE.MeshBasicMaterial(), metal: new THREE.MeshBasicMaterial() } as Mats;
  for (const axis of ["x", "z"] as const) for (const direction of ["positive", "negative"] as const) for (const lowerSide of ["min", "max"] as const) {
    const s = { ...draft.stairLayout, axis, direction, lowerSide }, shape = stairShape(s);
    const start = shape.point(shape.lowerAcross + s.flight / 2, 10);
    const end = shape.point(shape.lowerAcross + s.flight / 2, shape.run - 10);
    assert.equal(Math.sign(axis === "x" ? end.x - start.x : end.z - start.z), direction === "positive" ? 1 : -1);
    assert.ok(stairSoffitClearHeight(end.x, end.z, s, 3600)! > stairSoffitClearHeight(start.x, start.z, s, 3600)!);
    const group = new THREE.Group();
    stairs(group, s.x, s.z, 0, 3600, mat, axis, s);
    const slabs = group.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.geometry instanceof THREE.BoxGeometry);
    const low = shape.local(slabs[0].position.x, slabs[0].position.z);
    const high = shape.local(slabs[(shape.lowerTreads - 1) * 2].position.x, slabs[(shape.lowerTreads - 1) * 2].position.z);
    assert.ok(high.along > low.along);
    assert.ok(slabs[(shape.lowerTreads - 1) * 2].position.y > slabs[0].position.y);
    const box = new THREE.Box3();
    for (const slab of slabs) box.union(new THREE.Box3().setFromObject(slab));
    assert.ok(Math.abs(box.min.x - shape.footprint.x) < 1 && Math.abs(box.max.x - shape.footprint.x - shape.footprint.w) < 1);
    assert.ok(Math.abs(box.min.z - shape.footprint.z) < 1 && Math.abs(box.max.z - shape.footprint.z - shape.footprint.d) < 1);
    const entry = shape.point(shape.upperAcross + s.flight / 2, 0);
    const rails = stairOpeningRails({ ...s, hole: shape.footprint });
    assert.ok(rails.every(([a, b]) => Math.min(a[0], b[0]) > entry.x + 1 || Math.max(a[0], b[0]) < entry.x - 1 || Math.min(a[1], b[1]) > entry.z + 1 || Math.max(a[1], b[1]) < entry.z - 1), "出口中心不能被洞口围栏封死");
  }
});

test("无接触的上层近墙不能挤小楼梯；选中框与实际踏步平台一致", () => {
  const draft = stairDraft(), s = draft.stairLayout, r = s.room;
  for (const z of [r.z, r.z + r.d]) draft.floors[0].partitions.push({ a: [r.x - 100, z], b: [r.x + r.w + 100, z], role: "bearing" });
  draft.floors[2].partitions.push({ a: [r.x - 100, r.z + r.d - 187], b: [r.x + r.w + 100, r.z + r.d - 187], role: "bearing" });
  const fitted = fitStairToRoom(s, draft.floors), footprint = stairShape(fitted).footprint;
  assert.equal(footprint.z, r.z + construction.outsideWall / 2);
  assert.equal(footprint.z + footprint.d, r.z + r.d - construction.outsideWall / 2);
  const svg = floorPlan(0, false, false, { editable: true, editorCanvas: true, selected: { kind: "stair" } }, planSourceFromDraft(draft, 0));
  assert.ok(svg.includes(`x="${footprint.x}" y="${footprint.z}" width="${footprint.w}" height="${footprint.d}" class="edit-selection" data-stair-selection="1"`));
});

test("踏步宽深与高度输入改变实际几何，方向及踢面数支持撤销和JSON回读", () => {
  const draft = stairDraft();
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, draft);
  editor.selection = { kind: "stair" };
  editor.updateSelectedNumber("flight", 1100);
  assert.ok(Math.abs(fitStairToRoom(editor.draft.stairLayout, draft.floors).flight - 1100) < 1);
  editor.updateSelectedNumber("tread", 280);
  assert.ok(Math.abs(fitStairToRoom(editor.draft.stairLayout, draft.floors).tread - 280) < 1);
  editor.updateSelectedNumber("rise", 175);
  const s = editor.draft.stairLayout;
  assert.equal(s.risers, 18);
  assert.equal(stairStoryHeight(draft.floors, 0) / s.risers, 175);
  editor.setStairDirection("west");
  assert.equal(editor.draft.stairLayout.direction, "negative");
  const loaded = parseLayoutDraft(draftToJson(editor.draft));
  assert.equal(loaded.stairLayout.direction, "negative");
  assert.equal(loaded.stairLayout.risers, 18);
  assert.ok(Math.abs(fitStairToRoom(loaded.stairLayout, loaded.floors).tread - 280) < 1);
  const center = { x: s.room.x + s.room.w / 2, z: s.room.z + s.room.d / 2 };
  editor.setStairDirection("north");
  assert.equal(editor.draft.stairLayout.axis, "z");
  assert.ok(Math.abs(editor.draft.stairLayout.room.x + editor.draft.stairLayout.room.w / 2 - center.x) < 1);
  editor.undo();
  assert.equal(editor.draft.stairLayout.axis, "x");
  assert.equal(editor.draft.stairLayout.direction, "negative");
});

test("连续画布主辅楼间不叠总进深；选中楼梯的局部宽度随模型更新", () => {
  const draft = stairDraft();
  const f = draft.floors[0];
  f.partitions.push({ a: [site.main.x, site.main.z + 5000], b: [site.main.x + 4000, site.main.z + 5000] });
  const render = () => floorPlan(0, false, false, { editorCanvas: true, editable: true, selected: { kind: "stair" } }, planSourceFromDraft(draft, 0));
  let svg = render();
  const annex = svg.split('class="editor-building" data-plan-building="annex"')[1];
  assert.ok(!annex.includes('data-dim-side="east" data-dim-kind="overall"'));
  assert.ok(annex.includes('data-dim-side="west" data-dim-kind="overall"'));
  assert.ok(svg.includes("主楼西侧") && svg.includes("辅楼东侧"));
  const stairChain = () => svg.match(/data-dim-side="south" data-dim-kind="stair">([\s\S]*?)<\/g>/)![1];
  assert.ok(stairChain().includes(">3600</text>"));
  assert.equal((stairChain().match(/class="dim-mm"/g) ?? []).length, 1, "梯间宽度不再拆整栋外包尺寸");
  draft.stairLayout.room.w = 3800;
  svg = render();
  assert.ok(stairChain().includes(">3800</text>"));
  assert.ok(svg.includes(">13600</text>"));
});

test("靠外墙的楼梯修改踏步宽时跨过墙皮后仍保持输入值，不残留旧扣墙量", () => {
  const draft = stairDraft(), s = draft.stairLayout;
  s.axis = "z";
  Object.assign(s.room, { x: site.main.x + site.main.w - 2784, w: 2600, d: 3500 });
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, draft);
  editor.selection = { kind: "stair" };
  editor.updateSelectedNumber("flight", 1100);
  assert.ok(Math.abs(fitStairToRoom(editor.draft.stairLayout, draft.floors).flight - 1100) < 0.5);
});
