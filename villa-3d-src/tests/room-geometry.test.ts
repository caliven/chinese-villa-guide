import assert from "node:assert/strict";
import test from "node:test";
import { site, type Point, type Room, type Wall } from "../src/data.ts";
import { roomAreas } from "../src/design-data.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { floorPlan, planSourceFromDraft, wallStrokeJoinExtend } from "../src/plan.ts";
import { polygonAreaMm2, polygonContainsPoint, roomContainsPoint, roomIsRectangular, roomLabelPoint, roomNetGeometry } from "../src/room-geometry.ts";

const outsideBody = { x: -1000, z: -1000, w: 10_000, d: 10_000 };
const lRoom = (): Room => ({
  id: "l-shape", name: "凹形房间", x: 0, z: 0, w: 6000, d: 6000, kind: "living",
  outline: [[0, 0], [6000, 0], [6000, 2000], [2000, 2000], [2000, 6000], [0, 6000]],
  boundary: { key: "test-boundary", status: "enclosed" },
});

test("L 形面积按轮廓计算，包络缺角不命中也不填色", () => {
  const room = lRoom();
  assert.equal(polygonAreaMm2(room.outline!), 20_000_000);
  assert.equal(roomIsRectangular(room), false);
  assert.equal(roomContainsPoint(room, [4000, 4000]), false);
  assert.equal(roomContainsPoint(room, [1000, 4000]), true);
  const net = roomNetGeometry(room, outsideBody, [], 240, 120);
  assert.equal(net.areaMm2, 20_000_000);
  assert.equal(net.paths.length, 1);
  assert.equal(polygonContainsPoint(net.paths[0], [4000, 4000]), false);
  assert.equal(polygonAreaMm2(net.paths[0]), 20_000_000);
});

test("交叉实体墙以墙带并集扣净空，重叠墙和虚拟分界不重复扣", () => {
  const room = lRoom();
  const walls: Wall[] = [
    { a: [1000, 1000], b: [5000, 1000], role: "partition" },
    { a: [3000, 0], b: [3000, 2000], role: "partition" },
  ];
  const net = roomNetGeometry(room, outsideBody, walls, 240, 200);
  // 20㎡减(4m×0.2m + 2m×0.2m - 0.2m×0.2m)。
  assert.equal(net.areaMm2, 18_840_000);
  const duplicate = roomNetGeometry(room, outsideBody, [...walls, structuredClone(walls[0]), { a: [0, 3000], b: [2000, 3000], role: "virtual" }], 240, 200);
  assert.equal(duplicate.areaMm2, net.areaMm2);
  assert.equal(duplicate.pathData, net.pathData);
});

test("外墙外皮轮廓扣整墙厚，隔墙中线扣半墙厚", () => {
  const room: Room = { id: "rect", name: "矩形", x: 0, z: 0, w: 4000, d: 3000, kind: "bed" };
  const outer = roomNetGeometry(room, room, [], 240, 120);
  assert.equal(outer.areaMm2, 3520 * 2520);
  assert.deepEqual(outer.bounds, { x: 240, z: 240, w: 3520, d: 2520 });
  const walls: Wall[] = [
    { a: [0, 0], b: [4000, 0], role: "partition" },
    { a: [4000, 0], b: [4000, 3000], role: "partition" },
    { a: [4000, 3000], b: [0, 3000], role: "partition" },
    { a: [0, 3000], b: [0, 0], role: "partition" },
  ];
  const inner = roomNetGeometry(room, outsideBody, walls, 240, 120);
  assert.equal(inner.areaMm2, 3880 * 2880);
  assert.deepEqual(inner.bounds, { x: 60, z: 60, w: 3880, d: 2880 });
});

test("凹形内角的墙面补齐与图面描边相同，小角块也扣出净空", () => {
  const walls: Wall[] = [
    { a: [2000, 2000], b: [6000, 2000], role: "partition" },
    { a: [2000, 2000], b: [2000, 6000], role: "partition" },
  ];
  const net = roomNetGeometry(lRoom(), outsideBody, walls, 240, 120);
  assert.equal(net.areaMm2, 20_000_000 - 4000 * 60 * 2 - 60 * 60);
  assert.equal(net.paths.some(p => polygonContainsPoint(p, [1970, 1970])), false);
  const peers = walls.map(w => ({ ...w, thick: 120 }));
  assert.deepEqual(wallStrokeJoinExtend(walls[0], peers), { start: 60, end: 0 });
});

test("墙端与另一墙面仍有20空隙时，描边不得用80磁吸容差画闭合", () => {
  const a: Wall = { a: [0, 0], b: [3920, 0], role: "partition" };
  const b: Wall = { a: [4000, 0], b: [4000, 3000], role: "partition" };
  const peers = [a, b].map(w => ({ ...w, thick: 120 }));
  assert.deepEqual(wallStrokeJoinExtend(a, peers), { start: 0, end: 0 });
  a.b[0] = 3940; // 两墙实体刚好接触后才可补齐连接。
  assert.equal(wallStrokeJoinExtend(a, peers).end, 120);
});

test("标签拒绝 L 形缺角和实体墙中的旧锚点，选择实际内部点", () => {
  const room = lRoom();
  room.label = [4000, 4000];
  const label = roomLabelPoint(room);
  assert.equal(roomContainsPoint(room, label), true);
  assert.notDeepEqual(label, room.label);
  room.label = [1000, 1000];
  const walls: Wall[] = [{ a: [0, 1000], b: [6000, 1000], role: "partition" }];
  const net = roomNetGeometry(room, outsideBody, walls, 240, 120);
  assert.equal(net.paths.some(p => polygonContainsPoint(p, net.label)), true);
  assert.ok(Math.abs(net.label[1] - 1000) >= 60);
});

test("凹形平面输出真实 path、面积及失围合提示，不输出包络角点手柄", () => {
  const draft = clonePublishedLayout(), room = lRoom();
  const ox = site.main.x + 500, oz = site.main.z + 500;
  room.outline = room.outline!.map(([x, z]) => [x + ox, z + oz] as Point);
  room.x += ox; room.z += oz;
  room.boundary!.status = "unbounded";
  draft.floors[0].rooms = [room];
  draft.floors[0].partitions = [];
  draft.floors[0].furniture = [];
  const html = floorPlan(0, false, false, { editable: true, selected: { kind: "room", id: room.id } }, planSourceFromDraft(draft, 0));
  const group = html.match(/<g tabindex="0" role="button" data-room="l-shape"[\s\S]*?<\/g>/)?.[0] ?? "";
  assert.match(group, /<path[^>]+fill-rule="evenodd"/);
  assert.ok(!group.includes("<rect"));
  assert.ok(!html.includes('data-edit="room-handle"'));
  assert.match(html, /墙线 20\.00㎡/);
  assert.match(html, /失去围合 · 面积待核/);
  assert.equal(roomAreas(room, 0, []).building, 20);
});
