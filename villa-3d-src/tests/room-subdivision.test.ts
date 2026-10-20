import test from "node:test";
import assert from "node:assert/strict";
import { type Point, type Room, type Wall } from "../src/data";
import { syncRoomsFromWalls } from "../src/room-sync";
import { polygonAreaMm2, roomOutline } from "../src/room-geometry";
import { polygonIntersectionAreaMm2 } from "../src/plan-regions";

const body = { x: 0, z: 0, w: 4500, d: 5000 };
const parent = (): Room => ({ id: "elder", name: "尊亲房", kind: "bed", ...body, note: "原房间说明", label: [2250, 2500] });
const cornerWalls = (): Wall[] => [
  { id: "inside-h", a: [120, 1563], b: [3001, 1563], role: "partition" },
  { id: "inside-v", a: [3001, 1563], b: [3001, 0], role: "partition" },
];
function area(room: Room) { return polygonAreaMm2(roomOutline(room)); }
function assertTiling(rooms: Room[], expected = body.w * body.d) {
  assert.equal(rooms.reduce((sum, r) => sum + area(r), 0), expected);
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    assert.equal(polygonIntersectionAreaMm2(roomOutline(rooms[i]!), roomOutline(rooms[j]!)), 0);
  }
}

test("尊亲房内L墙分出闭合小间，原房保留身份及L形轮廓，重复生成幂等", () => {
  const rooms = [parent()];
  const result = syncRoomsFromWalls(body, cornerWalls(), rooms, { associateExisting: true });
  assert.equal(result.created, 1);
  assert.equal(result.updated, 1);
  assert.equal(rooms.length, 2);
  assert.deepEqual(result.issues, []);
  const elder = rooms.find(r => r.id === "elder")!;
  assert.equal(elder.name, "尊亲房");
  assert.equal(elder.kind, "bed");
  assert.equal(elder.note, "原房间说明");
  assert.equal(elder.outline!.length, 6);
  const child = rooms.find(r => r.id !== "elder")!;
  assert.deepEqual([child.w, child.d], [3001, 1563]);
  assert.equal(child.purposeStatus, "pending");
  assert.ok(rooms.every(r => r.boundary?.status === "enclosed"));
  assertTiling(rooms);
  const before = structuredClone(rooms);
  assert.deepEqual(syncRoomsFromWalls(body, cornerWalls(), rooms, { associateExisting: true }), { created: 0, updated: 0, issues: [] });
  assert.deepEqual(rooms, before);
});

test("东西南北角及辅楼偏移采用同一分割算法，不依赖尊亲房名称或房间类型", () => {
  for (const flipX of [false, true]) for (const flipZ of [false, true]) for (const offset of [0, 12000]) {
    const transform = ([x, z]: Point): Point => [offset + (flipX ? body.w - x : x), offset + (flipZ ? body.d - z : z)];
    const walls = cornerWalls().map(w => ({ ...w, a: transform(w.a), b: transform(w.b) }));
    const rooms: Room[] = [{ ...parent(), name: "任意用途", kind: "store", x: offset, z: offset, label: undefined }];
    syncRoomsFromWalls({ ...body, x: offset, z: offset }, walls, rooms, { touchWall: walls[1] });
    assert.equal(rooms.length, 2);
    assert.equal(rooms[0]!.name, "任意用途");
    assertTiling(rooms);
  }
});

test("原房已关联墙边界时对半分割有确定结果，多个隔墙一次生成完整铺满", () => {
  for (const positions of [[2250], [1000, 2500]]) {
    const rooms = [parent()];
    rooms[0]!.boundary = { key: "old-closed-boundary", status: "enclosed" };
    const walls: Wall[] = positions.map((x, i) => ({ id: `middle${i}`, a: [x, 0], b: [x, 5000] }));
    const result = syncRoomsFromWalls(body, walls, rooms);
    assert.equal(result.created, positions.length);
    assert.equal(rooms[0]!.id, "elder");
    if (positions.length === 2) assert.equal(rooms[0]!.x, 2500);
    assertTiling(rooms);
    const before = structuredClone(rooms);
    syncRoomsFromWalls(body, [...walls].reverse(), rooms);
    assert.deepEqual(rooms, before);
  }
});

test("已有精确子房沿用其名称和身份，不生成重复房，父房只保留剩余部分", () => {
  const child: Room = { id: "bath", name: "内卫", kind: "bath", x: 0, z: 0, w: 3001, d: 1563 };
  const rooms = [parent(), child];
  const result = syncRoomsFromWalls(body, cornerWalls(), rooms, { associateExisting: true });
  assert.equal(result.created, 0);
  assert.equal(rooms.length, 2);
  assert.equal(child.name, "内卫");
  assert.equal(child.kind, "bath");
  assert.ok(child.boundary);
  assertTiling(rooms);
});

test("旧稿小数毫米与略偏移的手工内卫按唯一高度覆盖归位，父房不再漏分", () => {
  const oldBody = { x: 15666 + 2 / 3, z: 5400, w: 4533 + 1 / 3, d: 4200 };
  const rooms: Room[] = [
    { ...parent(), ...oldBody },
    { id: "ensuite", name: "尊亲房内卫", kind: "bath", x: 16855.4, z: 5400, w: 3223.7, d: 1500 },
  ];
  const walls: Wall[] = [
    { id: "h", a: [17178, 6900], b: [20200, 6900] },
    { id: "v", a: [17178, 5400], b: [17178, 6900] },
  ];
  const result = syncRoomsFromWalls(oldBody, walls, rooms, { associateExisting: true });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 2);
  assert.deepEqual(result.issues, []);
  assert.equal(rooms[0]!.outline?.length, 6);
  assert.equal(rooms[1]!.id, "ensuite");
  assert.equal(rooms[1]!.kind, "bath");
  assert.deepEqual([rooms[1]!.x, rooms[1]!.w], [17178, 3022]);
  assertTiling(rooms, 4533 * 4200);
  assert.equal(syncRoomsFromWalls(oldBody, walls, rooms).updated, 0);
});

test("相邻房间的亚毫米舍入条带不会误阻止内部完整分割", () => {
  const rooms: Room[] = [
    { ...parent(), x: 4500.2, w: 4499.8, label: [6750, 2500] },
    { id: "neighbour", name: "相邻房间", kind: "living", x: 0, z: 0, w: 4500.2, d: 5000 },
  ];
  const walls: Wall[] = [
    { id: "shared", a: [4500.2, 0], b: [4500.2, 5000] },
    ...cornerWalls().map(w => ({ ...w, a: [w.a[0] + 4500, w.a[1]] as Point, b: [w.b[0] + 4500, w.b[1]] as Point })),
  ];
  walls[1]!.a[0] = 4560; // 共墙为 120 厚隔墙，端点接其东侧墙皮。
  const result = syncRoomsFromWalls({ ...body, w: 9000 }, walls, rooms, { associateExisting: true });
  assert.equal(result.created, 1);
  assert.equal(rooms[0]!.outline?.length, 6);
  assert.deepEqual(result.issues, []);
  assertTiling(rooms, 9000 * 5000);
});

test("内部闭合孤岛留下带洞残余时不偷改原房，同时明确提示补充分界", () => {
  const rooms = [parent()];
  const p: Point[] = [[1000, 1000], [2500, 1000], [2500, 2500], [1000, 2500]];
  const walls: Wall[] = p.map((a, i) => ({ id: `ring${i}`, a, b: p[(i + 1) % 4]! }));
  const before = structuredClone(rooms);
  const result = syncRoomsFromWalls(body, walls, rooms, { associateExisting: true });
  assert.deepEqual(rooms, before);
  assert.equal(result.created, 0);
  assert.ok(result.issues.some(i => /内部|有孔|剩余/.test(i)));
});

test("其它手工区或楼梯挑空冲突时，事务不覆盖身份、不留下半次分割", () => {
  for (const kind of ["living", "stair", "void"] as const) {
    const rooms: Room[] = [parent(), { id: "other", name: "其它分区", kind, x: 2000, z: 1000, w: 1600, d: 1800 }];
    const before = structuredClone(rooms);
    const result = syncRoomsFromWalls(body, cornerWalls(), rooms, { associateExisting: true });
    assert.equal(result.created, 0);
    assert.deepEqual(rooms, before);
    assert.ok(result.issues.length);
  }
});

test("真实空隙不视为分隔完成；后台仅校验时不创建子房", () => {
  const walls = cornerWalls(); walls[0]!.a[0] = 320;
  const rooms = [parent()], before = structuredClone(rooms);
  syncRoomsFromWalls(body, walls, rooms, { createOpen: false });
  assert.deepEqual(rooms, before);
  const checked = [parent()];
  assert.equal(syncRoomsFromWalls(body, cornerWalls(), checked, { create: false }).created, 0);
  assert.deepEqual(checked, [parent()]);
});
