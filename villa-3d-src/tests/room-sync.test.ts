import assert from "node:assert/strict";
import { test } from "node:test";
import { site, type Point, type Room, type Wall } from "../src/data.ts";
import { clonePublishedLayout, parseLayoutDraft } from "../src/layout-draft.ts";
import { enclosedRoomRegions, findRoomForRegion } from "../src/plan-regions.ts";
import { syncRoomsFromWalls } from "../src/room-sync.ts";
import { constrainWallEdits } from "../src/wall-constraints.ts";
import { polygonAreaMm2, roomOutline } from "../src/room-geometry.ts";

const body = { x: 0, z: 0, w: 12000, d: 10000 };
const points: Point[] = [[2000, 2000], [8000, 2000], [8000, 7000], [2000, 7000]];
const box = (): Wall[] => points.map((a, i) => ({ id: `w${i}`, a: [...a], b: [...points[(i + 1) % points.length]!], role: "partition" }));
function manual(id = "manual", extra: Partial<Room> = {}): Room {
  return { id, name: "手工房", x: 2000, z: 2000, w: 6000, d: 5000, kind: "living", ...extra };
}

function moveEast(walls: Wall[], amount: number) {
  const originals = structuredClone(walls);
  walls[1]!.a[0] += amount;
  walls[1]!.b[0] += amount;
  assert.equal(constrainWallEdits(walls, originals, [1]).ok, true);
}

test("闭合成房重复同步幂等，稳定ID和名称随同一墙调整保持", () => {
  const walls = box(), rooms: Room[] = [];
  const first = syncRoomsFromWalls(body, walls, rooms);
  assert.equal(first.created, 1);
  const room = rooms[0]!, id = room.id, name = room.name;
  const saved = structuredClone(rooms);
  assert.deepEqual(syncRoomsFromWalls(body, walls, rooms), { created: 0, updated: 0, issues: [] });
  assert.deepEqual(rooms, saved);
  moveEast(walls, 500);
  const changed = syncRoomsFromWalls(body, walls, rooms, { touchWall: walls[1] });
  assert.equal(changed.created, 0);
  assert.equal(changed.updated, 1);
  assert.equal(rooms.length, 1);
  assert.equal(room.w, 6500);
  assert.equal(room.id, id);
  assert.equal(room.name, name);
  assert.equal(syncRoomsFromWalls(body, walls, rooms).updated, 0);
});

test("自动后台不改手工房，全局明确生成可关联高度一致房间", () => {
  const walls = box(), rooms = [manual()];
  const before = structuredClone(rooms);
  assert.equal(syncRoomsFromWalls(body, walls, rooms).created, 0);
  assert.deepEqual(rooms, before);
  assert.equal(syncRoomsFromWalls(body, walls, rooms, { associateExisting: true }).updated, 1);
  assert.equal(rooms[0]!.boundary?.status, "enclosed");
  assert.equal(rooms[0]!.id, "manual");
  assert.equal(syncRoomsFromWalls(body, walls, rooms, { associateExisting: true }).updated, 0);
});

test("内嵌小卫浴不能以中心点抢占大闭合房间，手工大房不被删除", () => {
  const walls = box();
  const bath = manual("bath", { name: "内卫", w: 1500, d: 1800, kind: "bath" });
  const large = manual("large", { name: "套房" });
  const region = enclosedRoomRegions(body, walls)[0]!;
  assert.equal(findRoomForRegion([bath, large], region)?.id, "large");
  const rooms = [bath, large];
  syncRoomsFromWalls(body, walls, rooms, { associateExisting: true });
  assert.equal(rooms.length, 2);
  assert.equal(bath.w, 1500);
  assert.equal(bath.d, 1800);
  assert.equal(large.id, "large");
});

test("三面U形自动生成开敞分区且重复幂等，不覆写已有手工分区", () => {
  const walls = box();
  walls.shift();
  const empty: Room[] = [];
  assert.equal(syncRoomsFromWalls(body, walls, empty).created, 1);
  assert.equal(empty[0]!.boundary?.status, "open");
  assert.equal(empty[0]!.w, 6000);
  assert.equal(empty[0]!.d, 5000);
  const generated = structuredClone(empty);
  assert.deepEqual(syncRoomsFromWalls(body, walls, empty), { created: 0, updated: 0, issues: [] });
  assert.deepEqual(empty, generated);
  const rooms = [manual("open", { boundary: { key: "open:custom", status: "open" } })];
  const before = structuredClone(rooms);
  assert.equal(syncRoomsFromWalls(body, walls, rooms, { associateExisting: true }).updated, 0);
  assert.deepEqual(rooms, before);
});

test("失去闭合后保留原轮廓和ID，标记失围合；重新闭合可恢复关联", () => {
  const walls = box(), rooms: Room[] = [];
  syncRoomsFromWalls(body, walls, rooms);
  const original = structuredClone(rooms[0]!);
  const removed = walls.pop()!;
  const lost = syncRoomsFromWalls(body, walls, rooms);
  assert.equal(lost.created, 0);
  assert.equal(lost.updated, 1);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0]!.id, original.id);
  assert.equal(rooms[0]!.w, original.w);
  assert.equal(rooms[0]!.boundary?.status, "unbounded");
  assert.ok(lost.issues.some(s => s.includes("失去原闭合边界")));
  assert.equal(syncRoomsFromWalls(body, walls, rooms).updated, 0);
  walls.push(removed);
  assert.equal(syncRoomsFromWalls(body, walls, rooms).updated, 1);
  assert.equal(rooms[0]!.boundary?.status, "enclosed");
  assert.equal(rooms[0]!.id, original.id);
});

test("增删其它无关墙不串换边界关联，拆段后按真实几何保留房间身份", () => {
  const walls = box(), rooms: Room[] = [];
  walls.unshift({ id: "unrelated", a: [1000, 1000], b: [1400, 1000] });
  syncRoomsFromWalls(body, walls, rooms);
  const id = rooms[0]!.id, key = rooms[0]!.boundary!.key;
  walls.shift();
  assert.equal(syncRoomsFromWalls(body, walls, rooms).updated, 0);
  assert.equal(rooms[0]!.boundary!.key, key);
  const original = walls.shift()!;
  walls.push({ ...original, b: [5000, 2000] }, { ...original, id: "split", a: [5000, 2000] });
  assert.equal(syncRoomsFromWalls(body, walls, rooms).created, 0);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0]!.id, id);
  assert.equal(rooms[0]!.boundary?.status, "enclosed");
  assert.equal(syncRoomsFromWalls(body, walls, rooms).updated, 0);
});

test("楼梯和挑空不被成房算法改写，也不在其上重复自动放房", () => {
  for (const kind of ["stair", "void"] as const) {
    const rooms = [manual(kind, { kind, name: kind, boundary: { key: "prior", status: "enclosed" } })];
    const before = structuredClone(rooms);
    const result = syncRoomsFromWalls(body, box(), rooms, { associateExisting: true });
    assert.equal(result.created, 0);
    assert.equal(result.updated, 0);
    assert.deepEqual(rooms, before);
    assert.deepEqual(result.issues, [], "完整已占用保护区应静默跳过");
  }
});

test("重叠重复手工房不任意选择身份，不自动删除其中任何一个", () => {
  const rooms = [manual("a"), manual("b")], before = structuredClone(rooms);
  const result = syncRoomsFromWalls(body, box(), rooms, { associateExisting: true });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.deepEqual(rooms, before);
  assert.ok(result.issues.length > 0);
});

test("一房被新墙等分时保留原房身份，生成另一半且不重叠，重复同步稳定", () => {
  const walls = box(), rooms: Room[] = [];
  syncRoomsFromWalls(body, walls, rooms);
  const before = structuredClone(rooms[0]!);
  walls.push({ id: "splitter", a: [5000, 2000], b: [5000, 7000] });
  const result = syncRoomsFromWalls(body, walls, rooms);
  assert.equal(result.created, 1);
  assert.equal(rooms.length, 2);
  assert.equal(rooms[0]!.id, before.id);
  assert.equal(rooms[0]!.name, before.name);
  assert.equal(rooms[0]!.kind, before.kind);
  assert.equal(rooms[0]!.w, before.w / 2);
  assert.ok(rooms.every(r => r.boundary?.status === "enclosed"));
  assert.equal(rooms.reduce((sum, r) => sum + r.w * r.d, 0), before.w * before.d);
  assert.equal(rooms[0]!.x + rooms[0]!.w, rooms[1]!.x);
  const snapshot = structuredClone(rooms);
  assert.deepEqual(syncRoomsFromWalls(body, walls, rooms), { created: 0, updated: 0, issues: [] });
  assert.deepEqual(rooms, snapshot);
});

test("L形房间保存真实轮廓，重复同步不退化为包络矩形", () => {
  const lPoints: Point[] = [[2000, 2000], [8000, 2000], [8000, 4000], [5000, 4000], [5000, 7000], [2000, 7000]];
  const walls: Wall[] = lPoints.map((a, i) => ({ id: `l${i}`, a: [...a], b: [...lPoints[(i + 1) % lPoints.length]!] }));
  const rooms: Room[] = [];
  syncRoomsFromWalls(body, walls, rooms);
  assert.equal(rooms.length, 1);
  assert.deepEqual(rooms[0]!.outline, lPoints);
  const before = structuredClone(rooms);
  assert.deepEqual(syncRoomsFromWalls(body, walls, rooms), { created: 0, updated: 0, issues: [] });
  assert.deepEqual(rooms, before);
});

test("默认三层全局生成保留房间身份，尊亲房按真实内卫墙扣除凹口，保护楼梯挑空", () => {
  const draft = clonePublishedLayout();
  draft.floors.forEach((floor, index) => {
    const initial = structuredClone(floor.rooms);
    const envelope = { ...site.main, z: site.main.z + (index === 2 ? 1200 : 0), d: site.main.d - (index === 2 ? 1200 : 0) };
    syncRoomsFromWalls(envelope, floor.partitions, floor.rooms, { associateExisting: true });
    assert.equal(floor.rooms.length, initial.length);
    for (const room of initial) {
      const after = floor.rooms.find(r => r.id === room.id);
      assert.ok(after, `${room.name}身份必须保留`);
      assert.equal(after.name, room.name);
      assert.equal(after.kind, room.kind);
      if (room.kind === "void" || room.kind === "stair" || room.name === "茶室") assert.deepEqual(after, room);
      if (room.name === "尊亲房") {
        assert.equal(after.outline?.length, 6);
        const bathroom = floor.rooms.find(r => r.name === "尊亲房内卫")!;
        assert.equal(polygonAreaMm2(roomOutline(after)) + polygonAreaMm2(roomOutline(bathroom)), (Math.round(room.x + room.w) - Math.round(room.x)) * room.d);
      }
    }
    const beforeRepeat = structuredClone(floor.rooms);
    assert.equal(syncRoomsFromWalls(envelope, floor.partitions, floor.rooms, { associateExisting: true }).updated, 0);
    assert.deepEqual(floor.rooms, beforeRepeat);
  });
});


test("导出载入保留凹形outline、boundary和稳定墙ID", () => {
  const draft = clonePublishedLayout();
  const b = site.main;
  const lPoints: Point[] = [[2000, 2000], [8000, 2000], [8000, 4000], [5000, 4000], [5000, 7000], [2000, 7000]]
    .map(([x,z]) => [b.x+x!, b.z+z!]);
  const floor = draft.floors[0]!;
  floor.partitions = lPoints.map((a,i) => ({ id:`persist-${i}`, a:[...a], b:[...lPoints[(i+1)%lPoints.length]!] }));
  floor.rooms = [];
  syncRoomsFromWalls(b, floor.partitions, floor.rooms);
  const loaded = parseLayoutDraft(JSON.stringify(draft));
  assert.deepEqual(loaded.floors[0]!.rooms, floor.rooms);
  assert.deepEqual(loaded.floors[0]!.partitions, floor.partitions);
  assert.equal(syncRoomsFromWalls(b, loaded.floors[0]!.partitions, loaded.floors[0]!.rooms).updated, 0);
});

test("新房与保护区只相交一小条也不能自动生成", () => {
  for (const kind of ["void", "stair"] as const) {
    const rooms: Room[] = [manual("protected", { kind, x: 7900, z: 3000, w: 1000, d: 1000 })];
    const before = structuredClone(rooms);
    const result = syncRoomsFromWalls(body, box(), rooms);
    assert.equal(result.created, 0);
    assert.deepEqual(rooms, before);
    assert.match(result.issues[0] ?? "", /6000×5000/);
    assert.match(result.issues[0] ?? "", /手工房/);
    assert.ok(!result.issues.some(s => s.includes("专用几何")));
  }
});

test("边界重算扩展到原不相邻挑空时保留原轮廓并报告冲突", () => {
  const walls = box(), rooms: Room[] = [];
  syncRoomsFromWalls(body, walls, rooms);
  const before = structuredClone(rooms[0]!);
  rooms.push(manual("void", { kind: "void", x: 8500, z: 3000, w: 1000, d: 1000 }));
  moveEast(walls, 2000);
  const result = syncRoomsFromWalls(body, walls, rooms);
  assert.equal(rooms.length, 2);
  assert.equal(rooms[0]!.w, before.w);
  assert.equal(rooms[0]!.boundary?.status, "unbounded");
  assert.equal(result.conflicts?.length, 1);
});

test("全层生成跳过已有挑空，同时生成独立三边与四边空区", () => {
  const testBody = { x: 0, z: 0, w: 24000, d: 12000 };
  const loop = (id: string, x: number): Wall[] => {
    const p: Point[] = [[x, 2000], [x + 3000, 2000], [x + 3000, 6000], [x, 6000]];
    return p.map((a, i) => ({ id: `${id}-${i}`, a, b: p[(i + 1) % 4]! }));
  };
  const walls = [...loop("void", 1000), ...loop("closed", 8000), ...loop("open", 15000).slice(1)];
  const rooms: Room[] = [manual("void", { name: "客厅上空", kind: "void", x: 1000, z: 2000, w: 3000, d: 4000 })];
  const protectedBefore = structuredClone(rooms[0]);
  const result = syncRoomsFromWalls(testBody, walls, rooms, { associateExisting: true });
  assert.equal(result.created, 2);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(rooms[0], protectedBefore);
  assert.equal(rooms.find(r => r.x === 8000)!.boundary?.status, "enclosed");
  assert.equal(rooms.find(r => r.x === 15000)!.boundary?.status, "open");
  const before = structuredClone(rooms);
  assert.deepEqual(syncRoomsFromWalls(testBody, walls, rooms, { associateExisting: true }), { created: 0, updated: 0, issues: [] });
  assert.deepEqual(rooms, before);
});

test("自动开敞分区跟随原墙调整，补齐第四边后沿用原房间身份", () => {
  const walls = box();
  const fourth = walls.shift()!;
  const rooms: Room[] = [];
  syncRoomsFromWalls(body, walls, rooms);
  const id = rooms[0]!.id;
  const originals = structuredClone(walls);
  walls[0]!.a[0] += 400;
  walls[0]!.b[0] += 400;
  assert.equal(constrainWallEdits(walls, originals, [0]).ok, true);
  assert.equal(syncRoomsFromWalls(body, walls, rooms).updated, 1);
  assert.equal(rooms[0]!.w, 6400);
  assert.equal(rooms[0]!.id, id);
  fourth.b[0] += 400;
  walls.push(fourth);
  assert.equal(syncRoomsFromWalls(body, walls, rooms).updated, 1);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0]!.boundary?.status, "enclosed");
  assert.equal(rooms[0]!.id, id);
});

test("三边开敞候选不能覆盖挑空，也不能替换已有手工房", () => {
  const walls = box().slice(1);
  const protectedRoom = manual("void", { name: "客厅上空", kind: "void", x: 7900, z: 3000, w: 1000, d: 1000 });
  const rooms = [protectedRoom], before = structuredClone(rooms);
  const result = syncRoomsFromWalls(body, walls, rooms);
  assert.equal(result.created, 0);
  assert.match(result.issues[0]!, /6000×5000.*客厅上空/);
  assert.deepEqual(rooms, before);
  const occupied = [manual()];
  assert.equal(syncRoomsFromWalls(body, walls, occupied).created, 0);
  assert.deepEqual(occupied, [manual()]);
});
