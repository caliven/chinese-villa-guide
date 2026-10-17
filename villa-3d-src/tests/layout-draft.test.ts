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
  wallLength,
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
  furnitureWorldBounds,
  nearestRoomWall,
  pullFurnitureClearOfWalls,
  roomFurnitureClearRect,
  resizeOwnedWallsWithRoom,
  snapFurnitureDuringDrag,
  snapRoomToNearestWalls,
  snapWallDuringDrag,
  alignWallToNearestSide,
  resizeRoomFromCorner,
  translateFurnitureInsideRoom,
  translateOwnedWallsWithRoom,
  wallsOwnedByRoom,
} from "../src/layout-align.ts";
import {
  resizeFurnitureFromCorner,
  furnitureLocalToWorld,
  worldToFurnitureLocal,
  furnitureCornerLocal,
} from "../src/furniture-catalog.ts";
import type { Furniture, Room, Wall } from "../src/data.ts";

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

test("家具方位约定：有前后件带说明，沙发双侧扶手", async () => {
  const { furnitureHasFacing, furnitureOrientationHints, FURNITURE_LOCAL_FRAME } = await import(
    "../src/furniture-catalog"
  );
  const { floorPlan } = await import("../src/plan");
  assert.equal(furnitureHasFacing("sofa"), true);
  assert.equal(furnitureHasFacing("roundTable"), false);
  assert.match(furnitureOrientationHints.sofa, /靠背/);
  assert.match(furnitureOrientationHints.bed, /床头/);
  assert.match(FURNITURE_LOCAL_FRAME, /\+Z/);
  const svg = floorPlan(0, false, false);
  const arms = [...svg.matchAll(/sofa-arm/g)].length;
  // 一层至少三只沙发 × 双侧扶手
  assert.ok(arms >= 6, `沙发扶手数 ${arms}`);
  assert.match(svg, /facing-mark/);
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

test("一层门铰链贴墙角统一净距，厨无东门，开向符合约定", async () => {
  const { floors, annexPartitions, circulation, annexRooms } = await import("../src/data");
  const { facades } = await import("../src/facades");
  const { DOOR_HINGE_CORNER_GAP, doorOffsetAgainstHinge } = await import("../src/openings");

  const hingeGap = (a: [number, number], b: [number, number], door: { offset: number; width: number; hinge?: string }) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return door.hinge === "end" ? len - door.offset - door.width : door.offset;
  };

  for (const w of floors[0]!.partitions) {
    if (!w.door || w.door.kind === "slidingDoor" || w.door.kind === "window") continue;
    assert.ok(Math.abs(hingeGap(w.a, w.b, w.door) - DOOR_HINGE_CORNER_GAP) < 1e-9);
  }

  const { DOOR_OPENING } = await import("../src/openings");
  const bridge = floors[0]!.rooms.find((r) => r.id === "bridge0")!;
  assert.ok(Math.abs(circulation.sideDoorZ - (bridge.z + bridge.d / 2)) < 1e-9, "通辅楼门应在客厅过道中线");
  assert.equal(circulation.sideDoorWidth, DOOR_OPENING.room);
  assert.ok(circulation.sideDoorWidth < bridge.d, "通辅楼门洞应窄于过道进深");

  const eastDoors = facades(3)[2]!.openings.filter((o) => o.door);
  assert.equal(eastDoors.length, 1);
  assert.equal(eastDoors[0]!.hinge, "start"); // 面对门往右＝铰链北
  assert.equal(eastDoors[0]!.side, "out"); // 往里推进餐厅
  assert.equal(eastDoors[0]!.w, DOOR_OPENING.room);

  const slide = annexPartitions[0]!.door!;
  assert.equal(slide.kind, "slidingDoor");
  assert.equal(slide.width, DOOR_OPENING.sliding);
  assert.ok(Math.abs(slide.offset - (4.5 - DOOR_OPENING.sliding) / 2) < 1e-9);

  const mainWest = facades(0).find(
    (f) => Math.abs(f.a[0] - f.b[0]) < 0.01 && f.a[0] < floors[0]!.rooms[0]!.x + 1,
  )!;
  const linkDoor = mainWest.openings.find((o) => o.door)!;
  assert.equal(linkDoor.side, "in", "通辅楼门扇叶开向主楼内侧");
  assert.equal(linkDoor.w, DOOR_OPENING.room);
  assert.ok(Math.abs(linkDoor.at + (floors[0]!.front + 0.24) - circulation.sideDoorZ) < 0.05);

  const southDoor = facades(0)
    .flatMap((f) => f.openings)
    .find((o) => o.door && o.hinge === "start" && Math.abs(o.w - 0.9) < 1e-9);
  assert.ok(southDoor);
  assert.equal(southDoor!.side, "in");

  const vertical = floors[0]!.partitions.filter((w) => w.door && Math.abs(w.a[0] - w.b[0]) < 1e-6);
  const elder = vertical.find((w) => Math.abs(w.a[0] - floors[0]!.rooms.find((r) => r.id === "elder")!.x) < 0.2)!;
  const bath = vertical.find((w) => Math.abs(w.a[0] - floors[0]!.rooms.find((r) => r.id === "stairBath0")!.x) < 0.2)!;
  const ensuite = vertical.find((w) => Math.abs(w.a[0] - floors[0]!.rooms.find((r) => r.id === "ensuite")!.x) < 0.2)!;
  const spareDoor = vertical.find((w) => Math.abs(w.a[0] - 11.2) < 0.3 || Math.abs(w.a[0] - 11.3) < 0.3)!;
  assert.equal(elder.door!.side, "in");
  assert.equal(elder.door!.width, DOOR_OPENING.room);
  assert.equal(bath.door!.side, "in");
  assert.equal(bath.door!.width, DOOR_OPENING.bath);
  assert.equal(ensuite.door!.width, DOOR_OPENING.bath);
  assert.ok(DOOR_OPENING.bath < DOOR_OPENING.room);
  assert.equal(spareDoor.door!.side, "out");
  assert.equal(spareDoor.door!.hinge, "start"); // 贴北墙；面对门往右

  const annexEast = facades(3)[2]!.openings;
  assert.equal(annexEast.filter((o) => o.door).length, 1);
  assert.equal(annexEast.filter((o) => !o.door).length, 0, "厨房东墙无窗");

  assert.equal(doorOffsetAgainstHinge(4.2, DOOR_OPENING.room, "start"), DOOR_HINGE_CORNER_GAP);
  assert.equal(
    doorOffsetAgainstHinge(4.2, DOOR_OPENING.room, "end"),
    4.2 - DOOR_OPENING.room - DOOR_HINGE_CORNER_GAP,
  );
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

test("四角拉伸对角固定不跳位", () => {
  const room: Room = { id: "r", name: "房", x: 10, z: 2, w: 4, d: 3, kind: "bed" };
  const se = resizeRoomFromCorner(room, "se", 15, 6);
  assert.equal(se.x, 10);
  assert.equal(se.z, 2);
  assert.equal(se.w, 5);
  assert.equal(se.d, 4);
  const nw = resizeRoomFromCorner(room, "nw", 9, 1);
  assert.equal(nw.x + nw.w, 14);
  assert.equal(nw.z + nw.d, 5);

  const bed: Furniture = { kind: "bed", x: 12, z: 4, w: 2, d: 1.5, rotation: 0 };
  const fixed = furnitureLocalToWorld(-1, -0.75, bed);
  const grown = resizeFurnitureFromCorner(bed, "se", 14, 5.5);
  const fixedAfter = furnitureLocalToWorld(-grown.w / 2, -grown.d / 2, grown);
  assert.ok(Math.abs(fixedAfter.x - fixed.x) < 1e-9);
  assert.ok(Math.abs(fixedAfter.z - fixed.z) < 1e-9);

  // 与 SVG rotate(-θ) 往返一致
  const rotated: Furniture = { kind: "wardrobe", x: 10, z: 5, w: 1.6, d: 0.5, rotation: Math.PI / 2 };
  const tip = furnitureLocalToWorld(0.8, 0.25, rotated);
  const back = worldToFurnitureLocal(tip.x, tip.z, rotated);
  assert.ok(Math.abs(back.lx - 0.8) < 1e-9);
  assert.ok(Math.abs(back.lz - 0.25) < 1e-9);

  // 旋转衣柜拉角：保持长条，不跳成正方形；对角固定
  const seLocal = furnitureCornerLocal(rotated, "se");
  const seWorld = furnitureLocalToWorld(seLocal.lx + 0.4, seLocal.lz + 0.2, rotated);
  const resized = resizeFurnitureFromCorner(rotated, "se", seWorld.x, seWorld.z);
  assert.ok(Math.abs(resized.w - 2) < 1e-9, `w=${resized.w}`);
  assert.ok(Math.abs(resized.d - 0.7) < 1e-9, `d=${resized.d}`);
  assert.ok(Math.abs(resized.w - resized.d) > 0.5, "不应变成正方形");
  const oppBefore = furnitureLocalToWorld(-0.8, -0.25, rotated);
  const oppAfter = furnitureLocalToWorld(-resized.w / 2, -resized.d / 2, {
    x: resized.x,
    z: resized.z,
    rotation: rotated.rotation,
  });
  assert.ok(Math.abs(oppAfter.x - oppBefore.x) < 1e-6);
  assert.ok(Math.abs(oppAfter.z - oppBefore.z) < 1e-6);
});

test("隔墙：横墙靠西／东贴竖墙，竖墙靠北／南贴横墙", () => {
  // 横墙：西端贴西侧最近竖墙
  const h: Wall = { a: [11, 3], b: [14, 3] };
  const west: Wall = { a: [10, 1], b: [10, 5] };
  const east: Wall = { a: [16, 2], b: [16, 4] };
  const farWest: Wall = { a: [8, 2], b: [8, 4] };
  const left = alignWallToNearestSide(h, "left", [west, east, farWest]);
  assert.equal(left.ok, true);
  if (left.ok) assert.equal(left.sideLabel, "西");
  assert.equal(Math.min(h.a[0], h.b[0]), 10);
  assert.equal(wallLength(h), 3);

  const right = alignWallToNearestSide(h, "right", [west, east, farWest]);
  assert.equal(right.ok, true);
  assert.equal(Math.max(h.a[0], h.b[0]), 16);

  // 竖墙：北端贴北侧最近横墙
  const v: Wall = { a: [12, 2], b: [12, 5] };
  const north: Wall = { a: [10, 1], b: [15, 1] };
  const south: Wall = { a: [11, 6], b: [14, 6] };
  const up = alignWallToNearestSide(v, "up", [north, south]);
  assert.equal(up.ok, true);
  if (up.ok) assert.equal(up.sideLabel, "北");
  assert.equal(Math.min(v.a[1], v.b[1]), 1);
  const down = alignWallToNearestSide(v, "down", [north, south]);
  assert.equal(down.ok, true);
  assert.equal(Math.max(v.a[1], v.b[1]), 6);

  assert.equal(alignWallToNearestSide({ a: [12, 1], b: [12, 4] }, "left", [west]).ok, false);
  assert.equal(alignWallToNearestSide({ a: [11, 3], b: [14, 3] }, "up", [north]).ok, false);
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

test("拖墙吸附：平行墙持平，端点贴正交墙", () => {
  // 横墙 Z≈3.08，应吸到平行墙 Z=3
  const moving: Wall = { a: [10, 3.08], b: [14, 3.08] };
  const parallel: Wall = { a: [6, 3], b: [9, 3] };
  const vertical: Wall = { a: [16, 1], b: [16, 5] };
  const moveSnap = snapWallDuringDrag(moving, "move", [parallel, vertical], { xs: [], zs: [] }, 0.12);
  assert.equal((moving.a[1] + moving.b[1]) / 2, 3);
  assert.ok(moveSnap.guideZs.includes(3));

  // 拉东端靠近竖墙 X=16
  moving.b = [15.92, 3];
  const endSnap = snapWallDuringDrag(moving, "b", [parallel, vertical], { xs: [6.8], zs: [] }, 0.12);
  assert.equal(moving.b[0], 16);
  assert.ok(endSnap.guideXs.includes(16));
});

test("拖家具吸附：贴墙边、墙尖，接近居中才居中", () => {
  const room: Room = { id: "r", name: "房", x: 10, z: 0, w: 4, d: 5, kind: "living" };
  const xs = [10, 14];
  const zs = [0, 5];
  const corners = [
    { x: 10, z: 0 },
    { x: 14, z: 0 },
    { x: 10, z: 5 },
    { x: 14, z: 5 },
  ];

  // 沙发靠近北墙且近居中 → 贴墙并居中
  const sofa = createFurniture("sofa", 12.05, 0.55);
  snapFurnitureDuringDrag(sofa, xs, zs, {
    corners,
    room,
    floorIndex: 0,
    allowCenter: true,
    maxGap: 0.15,
    centerGap: 0.25,
  });
  const clear = roomFurnitureClearRect(room, 0, 0.02);
  const box = furnitureWorldBounds(sofa);
  assert.ok(Math.abs(box.z0 - clear.z0) < 0.05 || Math.abs(box.z0 - 0) < 0.15);
  assert.ok(Math.abs(sofa.x - (room.x + room.w / 2)) < 0.15);

  // 椅子偏一侧：自由件只贴边，不强制居中
  const chair = createFurniture("chair", 10.3, 2);
  snapFurnitureDuringDrag(chair, xs, zs, {
    corners,
    room,
    floorIndex: 0,
    allowCenter: true,
    maxGap: 0.15,
  });
  assert.equal(furnitureUsesWallCenter("chair"), false);
  assert.ok(Math.abs(furnitureWorldBounds(chair).x0 - 10) < 0.05 || Math.abs(chair.x - 10.3) < 0.05);

  // 衣柜角靠近墙尖 → 吸到角点
  const wardrobe = createFurniture("wardrobe", 10.4, 0.35);
  wardrobe.w = 0.8;
  wardrobe.d = 0.5;
  snapFurnitureDuringDrag(wardrobe, xs, zs, {
    corners,
    room,
    floorIndex: 0,
    allowCenter: false,
    maxGap: 0.2,
  });
  const wb = furnitureWorldBounds(wardrobe);
  const cornerDist = Math.min(
    Math.hypot(wb.x0 - 10, wb.z0 - 0),
    Math.hypot(wb.x1 - 10, wb.z0 - 0),
    Math.hypot(wb.x0 - 10, wb.z1 - 0),
  );
  assert.ok(cornerDist < 0.08, `墙尖距离 ${cornerDist}`);
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
  assert.equal(nearestRoomWall(sofa, room, 0).side, "north");
  centerFurnitureAgainstNearestWall(sofa, room, 0, 0.05);
  const clear = roomFurnitureClearRect(room, 0, 0.05);
  const box = furnitureWorldBounds(sofa);
  assert.ok(Math.abs(box.z0 - clear.z0) < 0.02);
  assert.ok(Math.abs(sofa.x - (room.x + room.w / 2)) < 0.02);

  // 压进北墙外轮廓时，应被推出墙内皮
  const tv = createFurniture("tv", 12, -0.1);
  tv.d = 0.4;
  pullFurnitureClearOfWalls(tv, room, 0, 0.02);
  const inner = roomFurnitureClearRect(room, 0, 0.02);
  const tvBox = furnitureWorldBounds(tv);
  assert.ok(tvBox.z0 >= inner.z0 - 0.03);
});

test("布局编辑撤销／重做按几何变化入栈，忽略空暂存", async () => {
  const { LayoutEditor } = await import("../src/layout-editor.ts");
  const { clonePublishedLayout: clone } = await import("../src/layout-draft.ts");
  const toasts: string[] = [];
  const editor = new LayoutEditor(
    {
      getFloor: () => 0,
      redraw: () => {},
      toast: (m) => toasts.push(m),
      onDraftSaved: () => {},
    },
    clone(),
  );
  assert.equal(editor.canUndo, false);
  assert.equal(editor.canRedo, false);

  const x0 = editor.draft.floors[0]!.furniture[0]!.x;
  // 模拟点选空松手：只刷新 updatedAt，不应入撤销栈
  (editor as unknown as { commit: () => void }).commit();
  (editor as unknown as { commit: () => void }).commit();
  assert.equal(editor.canUndo, false);

  editor.draft.floors[0]!.furniture[0]!.x = x0 + 0.8;
  (editor as unknown as { commit: () => void }).commit();
  assert.equal(editor.canUndo, true);
  assert.equal(editor.draft.floors[0]!.furniture[0]!.x, x0 + 0.8);

  editor.undo();
  assert.equal(editor.draft.floors[0]!.furniture[0]!.x, x0);
  assert.equal(editor.canRedo, true);

  editor.redo();
  assert.equal(editor.draft.floors[0]!.furniture[0]!.x, x0 + 0.8);

  editor.undo();
  editor.undo();
  assert.ok(toasts.some((t) => t.includes("没有可撤销")));
});

test("编辑平面：仅房间名上图；家具无名标注；辅楼家具可缩放／改名", async () => {
  const { floorPlan, planSourceFromDraft } = await import("../src/plan");
  const { LayoutEditor } = await import("../src/layout-editor.ts");
  const { clonePublishedLayout: clone } = await import("../src/layout-draft.ts");
  const draft = clone();
  draft.annexFurniture[0]!.label = "辅楼茶几";
  draft.floors[0]!.furniture[0]!.label = "主楼家具名";

  const viewSvg = floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0));
  assert.doesNotMatch(viewSvg, /furniture-label/);
  assert.doesNotMatch(viewSvg, /辅楼茶几/);
  assert.doesNotMatch(viewSvg, /主楼家具名/);
  assert.match(viewSvg, /堂屋/);

  const editSvg = floorPlan(
    0,
    false,
    false,
    {
      editable: true,
      selected: { kind: "furniture", index: 0, annex: true },
      selectedFurniture: [1000],
    },
    planSourceFromDraft(draft, 0),
  );
  assert.doesNotMatch(editSvg, /furniture-label/);
  assert.match(editSvg, /堂屋/);
  assert.match(editSvg, /furniture-handle/);
  assert.match(editSvg, /data-edit="furniture-handle"[^>]*data-index="1000"/);

  const editor = new LayoutEditor(
    { getFloor: () => 0, redraw: () => {}, toast: () => {}, onDraftSaved: () => {} },
    draft,
  );
  const room = editor.draft.floors[0]!.rooms.find((r) => r.id === "hall")!;
  editor.selection = { kind: "room", id: room.id, floor: 0 };
  editor.updateSelectedName("堂屋改名");
  assert.equal(room.name, "堂屋改名");
  assert.match(editor.inspectorHtml(), /edit-model-name/);
  assert.match(editor.inspectorHtml(), /堂屋改名/);

  editor.selection = { kind: "furniture", index: 0, floor: 0, annex: true };
  editor.updateSelectedName("圆桌定制名");
  assert.equal(editor.draft.annexFurniture[0]!.label, "圆桌定制名");
  editor.draft.annexFurniture[0]!.kind = "roundTable";
  editor.updateSelectedNumber("w", 2.4);
  assert.equal(editor.draft.annexFurniture[0]!.w, 2.4);
  assert.equal(editor.draft.annexFurniture[0]!.d, 2.4);
});

test("拖房间：四面独占短墙同移；共用长墙不动", () => {
  const roomA: Room = {
    id: "a",
    name: "A",
    kind: "bedroom",
    x: 2,
    z: 2,
    w: 3,
    d: 2.5,
  };
  const roomB: Room = {
    id: "b",
    name: "B",
    kind: "bedroom",
    x: 5,
    z: 2,
    w: 3,
    d: 2.5,
  };
  // A 独有西／北／南墙；东侧与 B 共用长横墙在北侧延伸？用竖向共用墙：x=5 贴 A 东与 B 西
  const walls: Wall[] = [
    { a: [2, 2], b: [2, 4.5] }, // A west
    { a: [2, 2], b: [5, 2] }, // A north（仅 A）
    { a: [2, 4.5], b: [5, 4.5] }, // A south
    { a: [5, 2], b: [5, 4.5] }, // shared A east / B west
    { a: [5, 2], b: [8, 2] }, // B north
    { a: [8, 2], b: [8, 4.5] }, // B east
    { a: [5, 4.5], b: [8, 4.5] }, // B south
  ];
  const rooms = [roomA, roomB];
  const ownedA = wallsOwnedByRoom(roomA, walls, rooms);
  assert.equal(ownedA.length, 3);
  assert.ok(ownedA.every((o) => o.index !== 3));

  const orig = structuredClone(walls);
  translateOwnedWallsWithRoom(roomA, 0.5, -0.3, walls, orig, rooms);
  assert.deepEqual(walls[0]!.a, [2.5, 1.7]);
  assert.deepEqual(walls[0]!.b, [2.5, 4.2]);
  assert.deepEqual(walls[1]!.a, [2.5, 1.7]);
  assert.deepEqual(walls[1]!.b, [5.5, 1.7]);
  assert.deepEqual(walls[2]!.a, [2.5, 4.2]);
  assert.deepEqual(walls[2]!.b, [5.5, 4.2]);
  // 共用墙与 B 侧墙不动
  assert.deepEqual(walls[3], orig[3]);
  assert.deepEqual(walls[4], orig[4]);
  assert.deepEqual(walls[5], orig[5]);
  assert.deepEqual(walls[6], orig[6]);
});

test("拉角改房间：独占边墙随新边伸缩", () => {
  const room: Room = { id: "solo", name: "独间", kind: "bath", x: 1, z: 1, w: 2, d: 1.5 };
  const walls: Wall[] = [
    { a: [1, 1], b: [1, 2.5] },
    { a: [3, 1], b: [3, 2.5] },
    { a: [1, 1], b: [3, 1] },
    { a: [1, 2.5], b: [3, 2.5] },
  ];
  const origWalls = structuredClone(walls);
  const next = { ...room, w: 2.8, d: 1.5 };
  resizeOwnedWallsWithRoom(room, next, walls, origWalls, [room]);
  assert.equal(walls[0]!.a[0], 1);
  assert.equal(walls[1]!.a[0], 3.8);
  assert.deepEqual(
    [Math.min(walls[2]!.a[0], walls[2]!.b[0]), Math.max(walls[2]!.a[0], walls[2]!.b[0])],
    [1, 3.8],
  );
  assert.deepEqual(
    [Math.min(walls[3]!.a[0], walls[3]!.b[0]), Math.max(walls[3]!.a[0], walls[3]!.b[0])],
    [1, 3.8],
  );
});

test("拖房间：房内家具同移且相对位置不变，房外与套间内家具不动", () => {
  const bed: Room = { id: "bed", name: "卧室", kind: "bedroom", x: 0, z: 0, w: 6, d: 5 };
  const bath: Room = { id: "bath", name: "内卫", kind: "bath", x: 4, z: 0, w: 2, d: 2 };
  const rooms = [bed, bath];
  const furniture: Furniture[] = [
    { id: "f1", kind: "bed", x: 2, z: 3, w: 1.5, d: 2, rotation: 0 },
    { id: "f2", kind: "toilet", x: 5, z: 1, w: 0.4, d: 0.6, rotation: 0 },
    { id: "f3", kind: "sofa", x: 8, z: 8, w: 2, d: 0.9, rotation: 0 },
  ];
  const orig = structuredClone(furniture);
  // 拖卧室：床跟移；内卫马桶属小房间不跟；房外沙发不动
  translateFurnitureInsideRoom(bed, 1.2, -0.5, furniture, orig, rooms);
  assert.equal(furniture[0]!.x, 3.2);
  assert.equal(furniture[0]!.z, 2.5);
  assert.equal(furniture[1]!.x, 5);
  assert.equal(furniture[1]!.z, 1);
  assert.equal(furniture[2]!.x, 8);
  assert.equal(furniture[2]!.z, 8);

  // 拖内卫：马桶跟移
  const furn2 = structuredClone(orig);
  translateFurnitureInsideRoom(bath, 0.3, 0.4, furn2, orig, rooms);
  assert.equal(furn2[0]!.x, 2);
  assert.equal(furn2[1]!.x, 5.3);
  assert.equal(furn2[1]!.z, 1.4);
});
