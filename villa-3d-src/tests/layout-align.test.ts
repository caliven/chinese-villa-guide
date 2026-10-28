import assert from "node:assert/strict";
import { test } from "node:test";
import type { Furniture, Room, Wall } from "../src/data.ts";
import {
  anchorRoomSizeAgainstEnvelope,
  centerFurnitureAgainstNearestWall,
  collectFurnitureRoomAnchors,
  findRoomContaining,
  pullFurnitureClearOfWalls,
  snapFurnitureDuringDrag,
  snapWallDuringDrag,
  syncInteriorWallsToRoom,
  syncRoomsToMovedWalls,
  validateProtectedRoomOverlaps,
} from "../src/layout-align.ts";

const body = { x: 0, z: 0, w: 10000, d: 8000 };
const room = (id: string, x: number, z: number, w: number, d: number, kind: Room["kind"] = "bed"): Room =>
  ({ id, name: id, kind, x, z, w, d });

test("尺寸撑贯通墙：同侧上下房与对侧房同时更新，共用墙保持贯通", () => {
  const upper = room("upper", 0, 0, 5000, 4000);
  const lower = room("lower", 0, 4000, 5000, 4000);
  const right = room("right", 5000, 0, 5000, 8000);
  const rooms = [upper, lower, right];
  const walls: Wall[] = [
    { a: [5000, 0], b: [5000, 8000] },
    { a: [0, 4000], b: [5000, 4000] },
  ];
  const result = syncInteriorWallsToRoom(structuredClone(lower), { ...lower, w: 6000 }, walls, rooms, body);
  assert.deepEqual(result, { ok: true });
  assert.equal(upper.w, 6000);
  assert.equal(lower.w, 6000);
  assert.equal(right.x, 6000);
  assert.equal(right.w, 4000);
  assert.deepEqual(walls, [
    { a: [6000, 0], b: [6000, 8000] },
    { a: [0, 4000], b: [6000, 4000] },
  ]);
});

test("扩房挤出不足800的邻房时整次拒绝，不把邻房推出外墙", () => {
  const largeBody = { x: 0, z: 0, w: 13600, d: 8000 };
  const selected = room("A", 0, 0, 6800, 8000);
  const rooms = [selected, room("B", 6800, 0, 6800, 8000)];
  const walls: Wall[] = [{ a: [6800, 0], b: [6800, 8000] }];
  const before = structuredClone({ walls, rooms });
  const result = syncInteriorWallsToRoom(structuredClone(selected), { ...selected, w: 13200 }, walls, rooms, largeBody);
  assert.equal(result.ok, false);
  assert.deepEqual({ walls, rooms }, before);
});

test("选中房超出外包络直接拒绝，输入候选本身也不被修改", () => {
  const selected = room("A", 1000, 1000, 4000, 4000);
  const next = { ...selected, w: 10000 };
  const rooms = [selected];
  const walls: Wall[] = [{ a: [5000, 1000], b: [5000, 5000] }];
  const before = structuredClone({ selected, next, rooms, walls });
  assert.equal(syncInteriorWallsToRoom(selected, next, walls, rooms, body).ok, false);
  assert.deepEqual({ selected, next, rooms, walls }, before);
});

test("楼梯和挑空共墙受影响时禁止撑墙，专用几何不被隐式改写", () => {
  for (const kind of ["stair", "void"] as const) {
    const selected = room("bed", 0, 0, 5000, 8000);
    const protectedRoom = room(kind, 5000, 0, 5000, 8000, kind);
    const rooms = [selected, protectedRoom];
    const walls: Wall[] = [{ a: [5000, 0], b: [5000, 8000] }];
    const before = structuredClone({ walls, rooms });
    assert.equal(syncInteriorWallsToRoom(selected, { ...selected, w: 6000 }, walls, rooms, body).ok, false);
    assert.deepEqual({ walls, rooms }, before);
  }
});

test("侧墙移离楼梯可同步邻房，不联动楼梯框；挑空边墙仍受保护", () => {
  for (const kind of ["stair", "void"] as const) {
    const originalRooms = [room("bed", 0, 0, 5000, 8000), room(kind, 5000, 0, 5000, 8000, kind)];
    const rooms = structuredClone(originalRooms);
    const originalWalls: Wall[] = [{ a: [5000, 0], b: [5000, 8000] }];
    const movedWalls: Wall[] = [{ a: [4800, 0], b: [4800, 8000] }];
    const result = syncRoomsToMovedWalls(originalWalls, movedWalls, originalRooms, rooms, body);
    assert.equal(result.ok, kind === "stair");
    assert.deepEqual(rooms[1], originalRooms[1]);
    assert.equal(rooms[0]!.w, kind === "stair" ? 4800 : 5000);
  }
});

test("挑空旁虚拟分界可从4199对齐4200并退回，保持洞口不变", () => {
  for (const horizontal of [false, true]) {
    const transpose = (r: Room): Room => horizontal ? { ...r, x: r.z, z: r.x, w: r.d, d: r.w } : r;
    const envelope = horizontal ? { x: 0, z: 0, w: 8000, d: 10000 } : body;
    const originals = [transpose(room("普通房", 0, 0, 4199, 4500)), transpose(room("挑空", 4200, 0, 5800, 4500, "void"))];
    const makeWall = (at: number): Wall => ({ a: horizontal ? [0, at] : [at, 0], b: horizontal ? [4500, at] : [at, 4500], role: "virtual" });
    const rooms = structuredClone(originals);
    assert.equal(syncRoomsToMovedWalls([makeWall(4199)], [makeWall(4200)], originals, rooms, envelope).ok, true);
    assert.equal(horizontal ? rooms[0]!.d : rooms[0]!.w, 4200);
    assert.deepEqual(rooms[1], originals[1]);
    assert.equal(validateProtectedRoomOverlaps(originals, rooms).ok, true);
    const aligned = structuredClone(rooms);
    assert.equal(syncRoomsToMovedWalls([makeWall(4200)], [makeWall(4100)], aligned, rooms, envelope).ok, true);
    assert.deepEqual(rooms[1], originals[1]);
    // 穿入洞口仍由统一重叠保护拒绝，不能因为虚拟线放开而绕过。
    const crossed = structuredClone(aligned);
    assert.equal(syncRoomsToMovedWalls([makeWall(4200)], [makeWall(4300)], aligned, crossed, envelope).ok, true);
    assert.equal(validateProtectedRoomOverlaps(aligned, crossed).ok, false);
    assert.deepEqual(crossed[1], originals[1]);
  }
});

test("矩形尺寸编辑拒绝非矩形轮廓，防止只改变外包络", () => {
  const selected = room("L", 1000, 1000, 5000, 5000);
  selected.outline = [[1000, 1000], [6000, 1000], [6000, 3000], [4000, 3000], [4000, 6000], [1000, 6000]];
  const rooms = [selected];
  const before = structuredClone(rooms);
  assert.equal(syncInteriorWallsToRoom(selected, { ...selected, w: 5500 }, [], rooms, body).ok, false);
  assert.deepEqual(rooms, before);
});

test("墙缩短容不下门时尺寸撑墙整次回滚，门洞不被偷偷缩小", () => {
  const selected = room("A", 0, 0, 5000, 4000);
  const rooms = [selected, room("B", 5000, 0, 5000, 4000)];
  const walls: Wall[] = [
    { a: [5000, 0], b: [5000, 4000] },
    { a: [0, 4000], b: [5000, 4000], door: { offset: 1000, width: 900, hinge: "start", side: "out" } },
  ];
  const before = structuredClone({ walls, rooms });
  assert.equal(syncInteriorWallsToRoom(selected, { ...selected, w: 800 }, walls, rooms, body).ok, false);
  assert.deepEqual({ walls, rooms }, before);
});

test("撑墙保留反向墙a到b及门铰链，不将它改成递增端点", () => {
  const selected = room("A", 0, 0, 5000, 4000);
  const rooms = [selected];
  const walls: Wall[] = [
    { a: [5000, 4000], b: [5000, 0] },
    { a: [5000, 4000], b: [0, 4000], door: { offset: 1000, width: 900, hinge: "end", side: "in" } },
  ];
  assert.equal(syncInteriorWallsToRoom(selected, { ...selected, w: 6000 }, walls, rooms, body).ok, true);
  assert.deepEqual(walls[0]!.a, [6000, 4000]);
  assert.deepEqual(walls[0]!.b, [6000, 0]);
  assert.deepEqual(walls[1]!.a, [6000, 4000]);
  assert.deepEqual(walls[1]!.b, [0, 4000]);
  assert.deepEqual(walls[1]!.door, { offset: 1000, width: 900, hinge: "end", side: "in" });
});

test("移墙同步按真实内皮识别邻房，保留原60偏移，不牵动隔80空隙的房", () => {
  const originals: Wall[] = [{ a: [5000, 0], b: [5000, 8000] }];
  const walls: Wall[] = [{ a: [6000, 0], b: [6000, 8000] }];
  const originalRooms = [
    room("clear", 0, 0, 4940, 4000),
    room("gap", 0, 4000, 4860, 4000),
    room("right", 5060, 0, 4940, 8000),
  ];
  const rooms = structuredClone(originalRooms);
  assert.equal(syncRoomsToMovedWalls(originals, walls, originalRooms, rooms, body).ok, true);
  assert.equal(rooms[0]!.w, 5940);
  assert.deepEqual(rooms[1], originalRooms[1]);
  assert.equal(rooms[2]!.x, 6060);
  assert.equal(rooms[2]!.w, 3940);
});

test("移墙不能把另一侧残余房间压为负数，失败不提交任何房间", () => {
  const originals: Wall[] = [{ a: [5000, 0], b: [5000, 8000] }];
  const walls: Wall[] = [{ a: [9600, 0], b: [9600, 8000] }];
  const originalRooms = [room("left", 0, 0, 5000, 8000), room("right", 5000, 0, 5000, 8000)];
  const rooms = structuredClone(originalRooms);
  assert.equal(syncRoomsToMovedWalls(originals, walls, originalRooms, rooms, body).ok, false);
  assert.deepEqual(rooms, originalRooms);
});

test("四角矩形关联房与手工房均随同一面墙更新", () => {
  const originals: Wall[] = [{ a: [5000, 0], b: [5000, 8000] }];
  const walls: Wall[] = [{ a: [6000, 0], b: [6000, 8000] }];
  const linked = room("linked", 0, 0, 5000, 8000);
  linked.outline = [[0, 0], [5000, 0], [5000, 8000], [0, 8000]];
  linked.boundary = { key: "walls", status: "enclosed" };
  const originalRooms = [linked, room("manual", 5000, 0, 5000, 8000)];
  const rooms = structuredClone(originalRooms);
  assert.equal(syncRoomsToMovedWalls(originals, walls, originalRooms, rooms, body).ok, true);
  assert.equal(rooms[0]!.w, 6000);
  assert.deepEqual(rooms[0]!.outline, [[0, 0], [6000, 0], [6000, 8000], [0, 8000]]);
  assert.equal(rooms[1]!.x, 6000);
});

test("拉端点不吸离轴墙尖，固定端和整条墙轴线均保持原位", () => {
  const wall: Wall = { a: [1000, 1000], b: [3980, 1000] };
  const original = structuredClone(wall);
  const guides = snapWallDuringDrag(wall, "b", [{ a: [4000, 1100], b: [4000, 3000] }], { xs: [], zs: [] }, 120);
  assert.deepEqual(wall, original);
  assert.deepEqual(guides, { guideXs: [], guideZs: [] });
});

test("拉反向墙a端只能沿固定b轴向接入真正穿过轴线的墙", () => {
  const wall: Wall = { a: [1000, 1020], b: [1000, 5000] };
  const fixed = [...wall.b];
  snapWallDuringDrag(wall, "a", [{ a: [0, 1000], b: [3000, 1000] }], { xs: [], zs: [] }, 120);
  assert.deepEqual(wall.a, [1000, 1000]);
  assert.deepEqual(wall.b, fixed);
});

test("外皮吸附容差可显式关闭，数值改深不偷偷改变近外墙原点", () => {
  const selected = room("A", 120, 120, 4000, 3000);
  const next = anchorRoomSizeAgainstEnvelope(selected, "d", 4000, body, 0);
  assert.equal(next.x, 120);
  assert.equal(next.z, 120);
  assert.equal(next.d, 4000);
  const legacy = anchorRoomSizeAgainstEnvelope(selected, "d", 4000, body);
  assert.equal(legacy.x, 0);
  assert.equal(legacy.z, 0);
});

test("家具房间归属遵循凹形真实轮廓，缺角中的家具不属于该房", () => {
  const concave = room("L", 0, 0, 6000, 6000);
  concave.outline = [[0, 0], [6000, 0], [6000, 2000], [2000, 2000], [2000, 6000], [0, 6000]];
  const furniture: Furniture = { kind: "chair", x: 4000, z: 4000, w: 500, d: 500 };
  assert.equal(findRoomContaining(furniture, [concave]), null);
  furniture.z = 1000;
  assert.equal(findRoomContaining(furniture, [concave]), concave);
});

test("凹形房间禁用包络矩形家具吸附和钳位，避免移入缺角", () => {
  const concave = room("L", 0, 0, 6000, 6000);
  concave.outline = [[0, 0], [6000, 0], [6000, 2000], [2000, 2000], [2000, 6000], [0, 6000]];
  const furniture: Furniture = { kind: "cabinet", x: 1000, z: 4500, w: 800, d: 500 };
  const original = structuredClone(furniture);
  const anchors = collectFurnitureRoomAnchors(concave, 0);
  assert.deepEqual(anchors.edgeXs, []);
  assert.deepEqual(anchors.centerXs, []);
  assert.deepEqual(anchors.corners, []);
  assert.deepEqual(snapFurnitureDuringDrag(furniture, [1000], [4500], { room: concave }), { guideXs: [], guideZs: [] });
  pullFurnitureClearOfWalls(furniture, concave, 0);
  centerFurnitureAgainstNearestWall(furniture, concave, 0);
  assert.deepEqual(furniture, original);
});

test("尺寸撑墙不能跨越原来未相邻的挑空，整次几何保持原样", () => {
  const selected = room("closed", 2000, 1000, 4000, 3000);
  const protectedRoom = room("void", 6500, 1000, 1000, 3000, "void");
  const rooms = [selected, protectedRoom];
  const walls: Wall[] = [
    { a: [2000, 1000], b: [6000, 1000] },
    { a: [6000, 1000], b: [6000, 4000] },
    { a: [6000, 4000], b: [2000, 4000] },
    { a: [2000, 4000], b: [2000, 1000] },
  ];
  const before = structuredClone({ walls, rooms });
  const next = { ...selected, w: 6000 };
  assert.equal(validateProtectedRoomOverlaps(rooms, [next, protectedRoom]).ok, false);
  const result = syncInteriorWallsToRoom(selected, next, walls, rooms, body);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /新增覆盖/);
  assert.deepEqual({ walls, rooms }, before);
});

test("历史梯下卫套叠未增大时仍可编辑，新增交集则拒绝", () => {
  const stair = room("stair", 2000, 1000, 4000, 5000, "stair");
  const bath = room("stairBath", 2500, 1500, 1000, 1000, "bath");
  const original = [bath, stair];
  assert.equal(validateProtectedRoomOverlaps(original, [{ ...bath, x: 3000 }, stair]).ok, true);
  assert.equal(validateProtectedRoomOverlaps(original, [{ ...bath, w: 2000 }, stair]).ok, false);
});

test("专用楼梯主动移动时不因未变化普通房而被反向阻止", () => {
  const ordinary = room("bed", 1000, 1000, 4000, 4000);
  const stair = room("stair", 6000, 1000, 3000, 4000, "stair");
  assert.equal(validateProtectedRoomOverlaps([ordinary, stair], [ordinary, { ...stair, x: 4000 }]).ok, true);
});

test("保护区交集计算使用真实凹形轮廓，缺角不被误判为占用", () => {
  const protectedRoom = room("void", 0, 0, 6000, 6000, "void");
  protectedRoom.outline = [[0, 0], [6000, 0], [6000, 2000], [2000, 2000], [2000, 6000], [0, 6000]];
  const ordinary = room("bed", 7000, 6000, 2000, 2000);
  assert.equal(validateProtectedRoomOverlaps([ordinary, protectedRoom], [{ ...ordinary, x: 3000, z: 3000 }, protectedRoom]).ok, true);
});

test("保护交集只宽容1mm周界舍入带，明显侵入仍拒绝", () => {
  const protectedRoom = room("void", 5000, 1000, 2000, 3000, "void");
  const ordinary = room("bed", 1000, 1000, 4000, 3000);
  const original = [ordinary, protectedRoom];
  assert.equal(validateProtectedRoomOverlaps(original, [{ ...ordinary, w: 4001 }, protectedRoom]).ok, true);
  assert.equal(validateProtectedRoomOverlaps(original, [{ ...ordinary, w: 4020 }, protectedRoom]).ok, false);
});
