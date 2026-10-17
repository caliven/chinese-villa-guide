import test from "node:test";
import assert from "node:assert/strict";
import {
  clonePublishedLayout,
  draftToJson,
  parseLayoutDraft,
  ensureExteriorManaged,
  snapMeter,
  orthoSnap,
  refineWallEnd,
  forceOrthoWall,
  wallAxis,
} from "../src/layout-draft.ts";
import {
  createFurniture,
  furnitureLocalBounds,
  defaultFurnitureSize,
  normalizeRotation,
} from "../src/furniture-catalog.ts";
import { createOpening, normalizeOpening } from "../src/openings.ts";
import {
  centerFurnitureAgainstNearestWall,
  furnitureUsesWallCenter,
  nearestRoomWall,
  snapRoomToNearestWalls,
} from "../src/layout-align.ts";
import type { Room, Wall } from "../src/data.ts";

test("clonePublishedLayout 可序列化并解析回来", () => {
  const draft = clonePublishedLayout();
  assert.equal(draft.schema, 1);
  assert.equal(draft.floors.length, 3);
  assert.equal(draft.exteriorManaged, true);
  assert.ok(draft.exteriorOpenings.length > 0);
  const again = parseLayoutDraft(draftToJson(draft));
  assert.equal(again.floors[0]!.rooms.length, draft.floors[0]!.rooms.length);
  assert.equal(again.portico.w, draft.portico.w);
  assert.equal(again.stairLayout.axis, draft.stairLayout.axis);
  assert.equal(again.exteriorManaged, true);
  assert.equal(again.exteriorOpenings.length, draft.exteriorOpenings.length);
});

test("旧草稿无 exteriorManaged 时并入原方案外墙洞口", () => {
  const draft = clonePublishedLayout();
  const raw = JSON.parse(draftToJson(draft)) as Record<string, unknown>;
  delete raw.exteriorManaged;
  raw.exteriorOpenings = [];
  const recovered = ensureExteriorManaged(parseLayoutDraft(JSON.stringify(raw)));
  assert.equal(recovered.exteriorManaged, true);
  assert.ok(recovered.exteriorOpenings.length >= 6);
});

test("snapMeter 默认按 0.01 米吸附", () => {
  assert.equal(snapMeter(1.244), 1.24);
  assert.equal(snapMeter(1.246), 1.25);
  assert.equal(snapMeter(1.26, 0.1), 1.3);
});

test("orthoSnap 默认水平或竖直", () => {
  assert.deepEqual(orthoSnap(0, 0, 3.2, 0.4), { x: 3.2, z: 0, ortho: "h" });
  assert.deepEqual(orthoSnap(0, 0, 0.3, 2.7), { x: 0, z: 2.7, ortho: "v" });
  assert.equal(orthoSnap(0, 0, 1, 1, true).ortho, "free");
});

test("forceOrthoWall 扶正微斜隔墙", () => {
  const wall: Wall = { a: [1, 2.02], b: [5.1, 1.97] };
  assert.equal(wallAxis(wall), "h");
  forceOrthoWall(wall);
  assert.equal(wall.a[1], wall.b[1]);
  assert.equal(wall.a[1], 2);
  const vert: Wall = { a: [3.04, 0], b: [2.96, 4] };
  assert.equal(wallAxis(vert), "v");
  forceOrthoWall(vert);
  assert.equal(vert.a[0], vert.b[0]);
  assert.equal(vert.a[0], 3);
});

test("refineWallEnd 正交时对齐端点", () => {
  const end = refineWallEnd(1, 2, 5.05, 2.4, [{ x: 5, z: 2 }, { x: 1, z: 8 }]);
  assert.equal(end.ortho, "h");
  assert.equal(end.x, 5);
  assert.equal(end.z, 2);
});

test("床宽深即占地外轮廓，床头柜不外扩", () => {
  const size = defaultFurnitureSize("bed");
  assert.equal(size.w, 2.7);
  const bed = createFurniture("bed", 10, 5);
  bed.w = 3;
  bed.d = 2.2;
  const b = furnitureLocalBounds(bed);
  assert.equal(b.x1 - b.x0, 3);
  assert.equal(b.z1 - b.z0, 2.2);
});

test("门窗默认开向与类型", () => {
  const door = createOpening("doubleDoor", 1.2);
  assert.equal(door.kind, "doubleDoor");
  assert.equal(door.width, 1.8);
  assert.equal(door.hinge, "start");
  assert.equal(door.side, "out");
  const legacy = normalizeOpening({ offset: 0.5, width: 0.9 });
  assert.equal(legacy.kind, "door");
});

test("过大旋转角可导入并归一化", () => {
  const draft = clonePublishedLayout();
  draft.floors[0]!.furniture.push({
    kind: "chair",
    x: 10,
    z: 5,
    w: 0.5,
    d: 0.5,
    rotation: 20, // 远超 ±2π
  });
  // 直接走 parse，模拟用户导出的「角已爆掉」JSON
  const raw = JSON.stringify({ ...draft, floors: draft.floors });
  const again = parseLayoutDraft(raw);
  const chair = again.floors[0]!.furniture.at(-1)!;
  assert.ok(Math.abs(chair.rotation!) <= Math.PI + 1e-9);
  assert.ok(Math.abs(normalizeRotation(Math.PI * 2 + 0.1) - 0.1) < 1e-9);
  assert.ok(Math.abs(normalizeRotation(-20)) <= Math.PI + 1e-9);
});

test("解析拒绝错误 schema", () => {
  assert.throws(() => parseLayoutDraft(JSON.stringify({ schema: 99, floors: [] })), /版本/);
});

test("改房间宽后可贴最近竖墙吸附", () => {
  // 西边距 6.8 为 0.32，东边距 11.3 为 0.12 → 应优先贴东墙，x = 11.3 - 4.3
  const room: Room = { id: "t", name: "试", x: 7.12, z: -0.9, w: 4.3, d: 5, kind: "bed" };
  snapRoomToNearestWalls(room, [6.8, 11.3], [-1, 4.2], 0.55);
  assert.equal(room.x, 7);
  assert.equal(room.w, 4.3);
  assert.equal(room.z, -1);

  // 明显更靠近西墙时贴西
  const west: Room = { id: "w", name: "西", x: 6.95, z: 0.2, w: 4, d: 3, kind: "bed" };
  snapRoomToNearestWalls(west, [6.8, 12], [0, 5], 0.55);
  assert.equal(west.x, 6.8);
  assert.equal(west.z, 0);
});

test("房间改宽后可贴最近两面墙", () => {
  // 东边距 15.8 更近（0.4）→ x=11.8；北边距 -1 更近 → z=-1
  const room: Room = { id: "new1", name: "新", x: 12.2, z: 0.3, w: 4, d: 3.5, kind: "bed" };
  snapRoomToNearestWalls(room, [11.3, 15.8], [-1, 5.4], 2.5);
  assert.equal(room.x, 11.8);
  assert.equal(room.z, -1);
});

test("沙发床柜电视神龛靠墙居中，桌椅不居中", () => {
  assert.equal(furnitureUsesWallCenter("sofa"), true);
  assert.equal(furnitureUsesWallCenter("bed"), true);
  assert.equal(furnitureUsesWallCenter("cabinet"), true);
  assert.equal(furnitureUsesWallCenter("tv"), true);
  assert.equal(furnitureUsesWallCenter("shrine"), true);
  assert.equal(furnitureUsesWallCenter("table"), false);
  assert.equal(furnitureUsesWallCenter("chair"), false);
  assert.equal(furnitureUsesWallCenter("roundTable"), false);
  assert.equal(furnitureUsesWallCenter("coffeeTable"), false);

  const room: Room = { id: "r", name: "房", x: 10, z: 0, w: 4, d: 5, kind: "living" };
  const sofa = createFurniture("sofa", 11.5, 0.6);
  assert.equal(nearestRoomWall(sofa, room).side, "north");
  centerFurnitureAgainstNearestWall(sofa, room, 0.05);
  const boxGap = sofa.z - sofa.d / 2 - room.z;
  assert.ok(Math.abs(boxGap - 0.05) < 0.02);
  assert.ok(Math.abs(sofa.x - (room.x + room.w / 2)) < 0.02);
});
