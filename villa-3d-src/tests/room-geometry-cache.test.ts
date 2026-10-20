import assert from "node:assert/strict";
import test from "node:test";
import { construction, floors, site, type Room, type Wall } from "../src/data.ts";
import { roomAreas, roomFillBounds, roomFillGeometry, roomLabelPosition } from "../src/design-data.ts";
import { roomNetGeometry } from "../src/room-geometry.ts";

function fixture() {
  const x = site.main.x + 1000, z = site.main.z + 1000;
  const room: Room = {
    id: "cached-room", name: "缓存回归房间", kind: "living", x, z, w: 4000, d: 3000,
    boundary: { key: "cache-boundary", status: "enclosed" },
  };
  const walls: Wall[] = [{ a: [x + 2000, z], b: [x + 2000, z + 2000], role: "partition" }];
  return { room, walls };
}

function uncached(room: Room, walls: Wall[], index = 0) {
  const body = room.x < site.main.x
    ? site.annex
    : { ...site.main, z: floors[index].front, d: site.main.z + site.main.d - floors[index].front };
  return roomNetGeometry(room, body, walls, construction.outsideWall, construction.partition);
}

test("房间填色、标签、净空包络和面积复用同一份几何结果", () => {
  const { room, walls } = fixture();
  const geometry = roomFillGeometry(room, 0, walls);
  assert.strictEqual(roomFillGeometry(room, 0, walls), geometry);
  assert.strictEqual(roomFillBounds(room, 0, walls), geometry.bounds);
  assert.strictEqual(roomLabelPosition(room, 0, walls), geometry.label);
  assert.strictEqual(roomAreas(room, 0, walls).fill, geometry.bounds);
  assert.equal(roomAreas(room, 0, walls).interior, geometry.areaMm2 / 1_000_000);
  assert.deepEqual(geometry, uncached(room, walls));
});

test("房间坐标和尺寸原地修改会失效，不依赖 Room 引用变化", () => {
  const { room, walls } = fixture();
  let previous = roomFillGeometry(room, 0, walls);
  for (const field of ["x", "z", "w", "d"] as const) {
    room[field] += 100;
    const current = roomFillGeometry(room, 0, walls);
    assert.notStrictEqual(current, previous, field);
    assert.deepEqual(current, uncached(room, walls), field);
    previous = current;
  }
});

test("轮廓顶点与标签坐标原地修改后立即生效", () => {
  const { room, walls } = fixture();
  room.outline = [[room.x, room.z], [room.x + room.w, room.z], [room.x + room.w, room.z + 1000], [room.x + 1000, room.z + 1000], [room.x + 1000, room.z + room.d], [room.x, room.z + room.d]];
  const first = roomFillGeometry(room, 0, walls);
  room.outline[2][1] += 100;
  room.outline[3][1] += 100;
  const altered = roomFillGeometry(room, 0, walls);
  assert.notStrictEqual(altered, first);
  assert.deepEqual(altered, uncached(room, walls));
  room.label = [room.x + 500, room.z + 500];
  const labelled = roomFillGeometry(room, 0, walls);
  assert.deepEqual(labelled.label, room.label);
  room.label[1] += 100;
  const moved = roomFillGeometry(room, 0, walls);
  assert.notStrictEqual(moved, labelled);
  assert.deepEqual(moved.label, room.label);
  assert.notDeepEqual(labelled.label, moved.label);
  delete room.label;
  assert.deepEqual(roomFillGeometry(room, 0, walls), uncached(room, walls));
});

test("墙端、角色与墙数组原地增删均使净空缓存失效", () => {
  const { room, walls } = fixture();
  let previous = roomFillGeometry(room, 0, walls);
  const expectFresh = () => {
    const current = roomFillGeometry(room, 0, walls);
    assert.notStrictEqual(current, previous);
    assert.deepEqual(current, uncached(room, walls));
    previous = current;
  };
  walls[0].b[1] += 200;
  expectFresh();
  walls[0].a[0] += 100;
  walls[0].b[0] += 100;
  expectFresh();
  walls[0].role = "bearing";
  expectFresh();
  walls[0].role = "virtual";
  expectFresh();
  walls.push({ a: [room.x, room.z + 1500], b: [room.x + room.w, room.z + 1500] });
  expectFresh();
  walls.pop();
  expectFresh();
});

test("墙厚与楼层外轮廓原地调整会失效", () => {
  const { room, walls } = fixture();
  const original = { outside: construction.outsideWall, partition: construction.partition, front: floors[0].front, width: site.main.w };
  let previous = roomFillGeometry(room, 0, walls);
  const expectFresh = () => {
    const current = roomFillGeometry(room, 0, walls);
    assert.notStrictEqual(current, previous);
    assert.deepEqual(current, uncached(room, walls));
    previous = current;
  };
  try {
    construction.partition += 20;
    expectFresh();
    construction.outsideWall += 20;
    expectFresh();
    floors[0].front += 100;
    expectFresh();
    site.main.w += 100;
    expectFresh();
  } finally {
    construction.outsideWall = original.outside;
    construction.partition = original.partition;
    floors[0].front = original.front;
    site.main.w = original.width;
  }
  assert.deepEqual(roomFillGeometry(room, 0, walls), uncached(room, walls));
});

test("同名房间与不同墙组不会串用结果，恢复旧输入也按当前内容计算", () => {
  const { room, walls } = fixture();
  const secondRoom = structuredClone(room), secondWalls = structuredClone(walls);
  secondRoom.w += 500;
  secondWalls[0].a[0] += 500;
  secondWalls[0].b[0] += 500;
  const first = roomFillGeometry(room, 0, walls);
  const second = roomFillGeometry(secondRoom, 0, secondWalls);
  assert.notStrictEqual(second, first);
  assert.deepEqual(second, uncached(secondRoom, secondWalls));
  const changedWalls = roomFillGeometry(room, 0, secondWalls);
  assert.notStrictEqual(changedWalls, first);
  assert.deepEqual(changedWalls, uncached(room, secondWalls));
  assert.deepEqual(roomFillGeometry(room, 0, walls), first);
  assert.strictEqual(roomFillGeometry(secondRoom, 0, secondWalls), second);
});

test("旧矩形仍采用整边参考口径，增加真实边界后切换算法并失效", () => {
  const { room, walls } = fixture();
  delete room.boundary;
  const legacy = roomFillGeometry(room, 0, walls);
  assert.equal(legacy.areaMm2, room.w * room.d);
  assert.strictEqual(roomFillBounds(room, 0, walls), legacy.bounds);
  assert.strictEqual(roomAreas(room, 0, walls).fill, legacy.bounds);
  room.boundary = { key: "new-boundary", status: "enclosed" };
  const linked = roomFillGeometry(room, 0, walls);
  assert.notStrictEqual(linked, legacy);
  assert.ok(linked.areaMm2 < legacy.areaMm2);
  assert.deepEqual(linked, uncached(room, walls));
});
