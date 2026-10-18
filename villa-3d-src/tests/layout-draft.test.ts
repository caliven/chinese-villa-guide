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
  collectWallSnapSegs,
  snapPointToWallEdge,
  extendOrthoEndToFarFace,
  WALL_EDGE_SNAP_GAP,
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
  anchorRoomSizeAgainstEnvelope,
  clampRoomToEnvelope,
  syncInteriorWallsToRoom,
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

test("snapMeter 默认按 1 mm 吸附，step 可取 10＝厘米", () => {
  assert.equal(snapMeter(1244.4), 1244);
  assert.equal(snapMeter(1244.6), 1245);
  assert.equal(snapMeter(1244, 10), 1240);
  assert.equal(snapMeter(1260, 100), 1300);
});

test("orthoSnap 默认水平或竖直", () => {
  assert.deepEqual(orthoSnap(0, 0, 3200, 400), { x: 3200, z: 0, ortho: "h" });
  assert.deepEqual(orthoSnap(0, 0, 300, 2700), { x: 0, z: 2700, ortho: "v" });
  assert.equal(orthoSnap(0, 0, 1000, 1000, true).ortho, "free");
});

test("forceOrthoWall 扶正微斜隔墙", () => {
  const wall: Wall = { a: [1000, 2020], b: [5100, 1980] };
  assert.equal(wallAxis(wall), "h");
  forceOrthoWall(wall);
  assert.equal(wall.a[1], wall.b[1]);
  assert.equal(wall.a[1], 2000);
  const vert: Wall = { a: [3040, 0], b: [2960, 4000] };
  assert.equal(wallAxis(vert), "v");
  forceOrthoWall(vert);
  assert.equal(vert.a[0], vert.b[0]);
  assert.equal(vert.a[0], 3000);
});

test("refineWallEnd 正交时对齐端点", () => {
  const end = refineWallEnd(1000, 2000, 5050, 2400, [{ x: 5000, z: 2000 }, { x: 1000, z: 8000 }]);
  assert.equal(end.ortho, "h");
  assert.equal(end.x, 5000);
  assert.equal(end.z, 2000);
});

test("床宽深即占地外轮廓，床头柜不外扩", () => {
  const size = defaultFurnitureSize("bed");
  assert.equal(size.w, 2960);
  assert.equal(size.d, 2220);
  const bed = createFurniture("bed", 10000, 5000);
  bed.w = 3000;
  bed.d = 2200;
  const b = furnitureLocalBounds(bed);
  assert.equal(b.x1 - b.x0, 3000);
  assert.equal(b.z1 - b.z0, 2200);
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

test("二楼挑空不写死栏杆；南缘有墙；栏杆家具可入平面与草稿", async () => {
  const { floors, circulation } = await import("../src/data");
  const { floorPlan, planSourceFromDraft } = await import("../src/plan");
  const { furnitureHasFacing, furnitureLabels } = await import("../src/furniture-catalog");
  const voidSouth = circulation.livingVoid.z + circulation.livingVoid.d;
  const voidEast = circulation.livingVoid.x + circulation.livingVoid.w;
  const southWall = floors[1]!.partitions.some(
    (w) =>
      Math.abs(w.a[1] - voidSouth) < 1 &&
      Math.abs(w.b[1] - voidSouth) < 1 &&
      Math.min(w.a[0], w.b[0]) <= circulation.livingVoid.x + 50 &&
      Math.max(w.a[0], w.b[0]) >= voidEast - 50,
  );
  assert.ok(southWall, "挑空南缘应有实体墙");
  const html = floorPlan(1, false, false);
  // 旧写死 L 形：东缘竖线＋南缘横线；南缘改墙后不应再有贴 void 边的 balustrade path
  assert.ok(!html.includes(`M${voidEast}`), "不再写死挑空东缘栏杆路径");
  assert.equal(furnitureLabels.railing, "栏杆");
  assert.equal(furnitureHasFacing("railing"), true);
  const draft = clonePublishedLayout();
  const rail = createFurniture("railing", voidEast + 50, circulation.livingVoid.z + circulation.livingVoid.d / 2);
  rail.rotation = Math.PI / 2;
  draft.floors[1]!.furniture.push(rail);
  const withRail = floorPlan(1, false, false, { editable: true }, planSourceFromDraft(draft, 1));
  assert.match(withRail, /furniture railing/);
  assert.match(withRail, /railing-line/);
  const loaded = parseLayoutDraft(draftToJson(draft));
  assert.equal(loaded.floors[1]!.furniture.at(-1)?.kind, "railing");
});

test("门窗默认开向与类型", () => {
  const door = createOpening("doubleDoor", 1200);
  assert.equal(door.kind, "doubleDoor");
  assert.equal(door.width, 1800);
  assert.equal(door.hinge, "start");
  assert.equal(door.side, "out");
  const legacy = normalizeOpening({ offset: 500, width: 900 });
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
    assert.ok(Math.abs(hingeGap(w.a, w.b, w.door) - DOOR_HINGE_CORNER_GAP) < 1e-6);
  }

  const { DOOR_OPENING } = await import("../src/openings");
  const bridge = floors[0]!.rooms.find((r) => r.id === "bridge0")!;
  assert.ok(Math.abs(circulation.sideDoorZ - (bridge.z + bridge.d / 2)) < 1e-6, "通辅楼门应在客厅过道中线");
  assert.equal(circulation.sideDoorWidth, DOOR_OPENING.room);
  assert.ok(circulation.sideDoorWidth < bridge.d, "通辅楼门洞应窄于过道进深");

  const eastDoors = facades(3)[2]!.openings.filter((o) => o.door);
  assert.equal(eastDoors.length, 1);
  assert.equal(eastDoors[0]!.hinge, "start"); // 面对门往右＝铰链北
  assert.equal(eastDoors[0]!.side, "out"); // 往里推进餐厅
  assert.equal(eastDoors[0]!.w, DOOR_OPENING.room);

  const slide = annexPartitions[0]!.door!;
  assert.equal(slide.kind, "slidingDoor");
  const annexWallLen = Math.abs(annexPartitions[0]!.a[0] - annexPartitions[0]!.b[0]);
  assert.ok(Math.abs(slide.offset - (annexWallLen - slide.width) / 2) < 1e-6);

  const mainWest = facades(0).find(
    (f) => Math.abs(f.a[0] - f.b[0]) < 10 && f.a[0] < floors[0]!.rooms[0]!.x + 1000,
  )!;
  const linkDoor = mainWest.openings.find((o) => o.door)!;
  assert.equal(linkDoor.side, "in", "通辅楼门扇叶开向主楼内侧");
  assert.equal(linkDoor.w, DOOR_OPENING.room);
  assert.ok(Math.abs(linkDoor.at + (floors[0]!.front + 240) - circulation.sideDoorZ) < 50);

  const southDoor = facades(0)
    .flatMap((f) => f.openings)
    .find((o) => o.door && o.hinge === "start" && Math.abs(o.w - 900) < 1e-6);
  assert.ok(southDoor);
  assert.equal(southDoor!.side, "in");

  const vertical = floors[0]!.partitions.filter((w) => w.door && Math.abs(w.a[0] - w.b[0]) < 1);
  const elder = vertical.find((w) => Math.abs(w.a[0] - floors[0]!.rooms.find((r) => r.id === "elder")!.x) < 200)!;
  const bath = vertical.find((w) => Math.abs(w.a[0] - floors[0]!.rooms.find((r) => r.id === "stairBath0")!.x) < 200)!;
  const ensuite = vertical.find((w) => Math.abs(w.a[0] - floors[0]!.rooms.find((r) => r.id === "ensuite")!.x) < 200)!;
  const spareDoor = vertical.find((w) => Math.abs(w.a[0] - 11200) < 300 || Math.abs(w.a[0] - 11300) < 300)!;
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

  assert.equal(doorOffsetAgainstHinge(4200, DOOR_OPENING.room, "start"), DOOR_HINGE_CORNER_GAP);
  assert.equal(
    doorOffsetAgainstHinge(4200, DOOR_OPENING.room, "end"),
    4200 - DOOR_OPENING.room - DOOR_HINGE_CORNER_GAP,
  );
});

test("过大旋转角可导入并归一化", () => {
  const draft = clonePublishedLayout();
  draft.floors[0]!.furniture.push({
    kind: "chair",
    x: 10000,
    z: 5000,
    w: 500,
    d: 500,
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
  const room: Room = { id: "r", name: "房", x: 10000, z: 2000, w: 4000, d: 3000, kind: "bed" };
  const se = resizeRoomFromCorner(room, "se", 15000, 6000);
  assert.equal(se.x, 10000);
  assert.equal(se.z, 2000);
  assert.equal(se.w, 5000);
  assert.equal(se.d, 4000);
  const nw = resizeRoomFromCorner(room, "nw", 9000, 1000);
  assert.equal(nw.x + nw.w, 14000);
  assert.equal(nw.z + nw.d, 5000);

  const bed: Furniture = { kind: "bed", x: 12000, z: 4000, w: 2000, d: 1500, rotation: 0 };
  const fixed = furnitureLocalToWorld(-1000, -750, bed);
  const grown = resizeFurnitureFromCorner(bed, "se", 14000, 5500);
  const fixedAfter = furnitureLocalToWorld(-grown.w / 2, -grown.d / 2, grown);
  assert.ok(Math.abs(fixedAfter.x - fixed.x) < 1e-6);
  assert.ok(Math.abs(fixedAfter.z - fixed.z) < 1e-6);

  // 与 SVG rotate(-θ) 往返一致
  const rotated: Furniture = { kind: "wardrobe", x: 10000, z: 5000, w: 1600, d: 500, rotation: Math.PI / 2 };
  const tip = furnitureLocalToWorld(800, 250, rotated);
  const back = worldToFurnitureLocal(tip.x, tip.z, rotated);
  assert.ok(Math.abs(back.lx - 800) < 1e-6);
  assert.ok(Math.abs(back.lz - 250) < 1e-6);

  // 旋转衣柜拉角：保持长条，不跳成正方形；对角固定
  const seLocal = furnitureCornerLocal(rotated, "se");
  const seWorld = furnitureLocalToWorld(seLocal.lx + 400, seLocal.lz + 200, rotated);
  const resized = resizeFurnitureFromCorner(rotated, "se", seWorld.x, seWorld.z);
  assert.ok(Math.abs(resized.w - 2000) < 1e-6, `w=${resized.w}`);
  assert.ok(Math.abs(resized.d - 700) < 1e-6, `d=${resized.d}`);
  assert.ok(Math.abs(resized.w - resized.d) > 500, "不应变成正方形");
  const oppBefore = furnitureLocalToWorld(-800, -250, rotated);
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
  const h: Wall = { a: [11000, 3000], b: [14000, 3000] };
  const west: Wall = { a: [10000, 1000], b: [10000, 5000] };
  const east: Wall = { a: [16000, 2000], b: [16000, 4000] };
  const farWest: Wall = { a: [8000, 2000], b: [8000, 4000] };
  const left = alignWallToNearestSide(h, "left", [west, east, farWest]);
  assert.equal(left.ok, true);
  if (left.ok) assert.equal(left.sideLabel, "西");
  assert.equal(Math.min(h.a[0], h.b[0]), 10000);
  assert.equal(wallLength(h), 3000);

  const right = alignWallToNearestSide(h, "right", [west, east, farWest]);
  assert.equal(right.ok, true);
  assert.equal(Math.max(h.a[0], h.b[0]), 16000);

  // 竖墙：北端贴北侧最近横墙
  const v: Wall = { a: [12000, 2000], b: [12000, 5000] };
  const north: Wall = { a: [10000, 1000], b: [15000, 1000] };
  const south: Wall = { a: [11000, 6000], b: [14000, 6000] };
  const up = alignWallToNearestSide(v, "up", [north, south]);
  assert.equal(up.ok, true);
  if (up.ok) assert.equal(up.sideLabel, "北");
  assert.equal(Math.min(v.a[1], v.b[1]), 1000);
  const down = alignWallToNearestSide(v, "down", [north, south]);
  assert.equal(down.ok, true);
  assert.equal(Math.max(v.a[1], v.b[1]), 6000);

  assert.equal(alignWallToNearestSide({ a: [12000, 1000], b: [12000, 4000] }, "left", [west]).ok, false);
  assert.equal(alignWallToNearestSide({ a: [11000, 3000], b: [14000, 3000] }, "up", [north]).ok, false);
});

test("改房间宽后可贴最近竖墙吸附", () => {
  // 西边距 6800 为 320，东边距 11300 为 120 → 应优先贴东墙，x = 11300 - 4300
  const room: Room = { id: "t", name: "试", x: 7120, z: -900, w: 4300, d: 5000, kind: "bed" };
  snapRoomToNearestWalls(room, [6800, 11300], [-1000, 4200], 550);
  assert.equal(room.x, 7000);
  assert.equal(room.w, 4300);
  assert.equal(room.z, -1000);

  // 明显更靠近西墙时贴西
  const west: Room = { id: "w", name: "西", x: 6950, z: 200, w: 4000, d: 3000, kind: "bed" };
  snapRoomToNearestWalls(west, [6800, 12000], [0, 5000], 550);
  assert.equal(west.x, 6800);
  assert.equal(west.z, 0);
});

test("房间改宽后可贴最近两面墙", () => {
  // 东边距 15800 更近（400）→ x=11800；北边距 -1000 更近 → z=-1000
  const room: Room = { id: "new1", name: "新", x: 12200, z: 300, w: 4000, d: 3500, kind: "bed" };
  snapRoomToNearestWalls(room, [11300, 15800], [-1000, 5400], 2500);
  assert.equal(room.x, 11800);
  assert.equal(room.z, -1000);
});

test("拖墙吸附：平行墙持平，端点贴正交墙中线", () => {
  // 横墙 Z≈3080，应吸到平行墙 Z=3000
  const moving: Wall = { a: [10000, 3080], b: [14000, 3080] };
  const parallel: Wall = { a: [6000, 3000], b: [9000, 3000] };
  const vertical: Wall = { a: [16000, 1000], b: [16000, 5000], role: "partition" };
  const moveSnap = snapWallDuringDrag(moving, "move", [parallel, vertical], { xs: [], zs: [] }, 120);
  assert.equal((moving.a[1] + moving.b[1]) / 2, 3000);
  assert.ok(moveSnap.guideZs.includes(3000));

  // 拉东端靠近竖墙中段 → 中线交点 X=16000（不伸外皮）
  moving.b = [15920, 3000];
  const endSnap = snapWallDuringDrag(moving, "b", [parallel, vertical], { xs: [6800], zs: [] }, 120);
  assert.equal(moving.b[0], 16000);
  assert.equal(moving.b[1], 3000);
  assert.ok(endSnap.guideXs.includes(16000));
});

test("画墙起点落在横墙中段吸到墙身中线", () => {
  const segs = collectWallSnapSegs([
    { a: [6000, 5100], b: [15000, 5100], role: "bearing" },
  ]);
  const hit = snapPointToWallEdge(11000, 5180, segs, WALL_EDGE_SNAP_GAP);
  assert.equal(hit.snapped, true);
  assert.equal(hit.z, 5100);
  assert.ok(Math.abs(hit.x - 11000) < 1);
});

test("画墙竖向终点近横墙中段时落到中线交点", () => {
  const segs = collectWallSnapSegs([
    { a: [6000, 5100], b: [15000, 5100], role: "bearing" },
  ]);
  // 自下往上画，终点靠近中线 5114（旧缝）→ 应吸到 5100 中线
  const end = extendOrthoEndToFarFace(11100, -400, 11100, 5114, segs, WALL_EDGE_SNAP_GAP);
  assert.equal(end.snapped, true);
  assert.equal(end.x, 11100);
  assert.equal(end.z, 5100);
});

test("直角 L 角落到对方墙尖中线，不伸外皮", () => {
  const segs = collectWallSnapSegs([
    { a: [16300, 5400], b: [20200, 5400], role: "bearing" },
  ]);
  // 竖墙自北往南拖，终点靠近横墙西尖（曾误吸到 5280）
  const end = extendOrthoEndToFarFace(16300, 9600, 16300, 5280, segs, WALL_EDGE_SNAP_GAP);
  assert.equal(end.snapped, true);
  assert.equal(end.x, 16300);
  assert.equal(end.z, 5400);
});

test("画墙终点靠近平行墙墙尖则精确重合", () => {
  const segs = collectWallSnapSegs([
    { a: [6000, 3000], b: [9000, 3000], role: "partition" },
  ]);
  // 自东向西画横墙，终点靠近对方东墙尖
  const end = extendOrthoEndToFarFace(12000, 3000, 9050, 3020, segs, WALL_EDGE_SNAP_GAP);
  assert.equal(end.snapped, true);
  assert.equal(end.x, 9000);
  assert.equal(end.z, 3000);
});

test("refineWallEnd 优先墙段中线而非错误房间角点", () => {
  const segs = collectWallSnapSegs([
    { a: [6000, 5100], b: [15000, 5100], role: "bearing" },
  ]);
  const anchors = [{ x: 11100, z: 5114 }]; // 错误房间角
  const end = refineWallEnd(11100, -400, 11100, 5080, anchors, false, WALL_EDGE_SNAP_GAP, segs);
  assert.equal(end.z, 5100);
  assert.notEqual(end.z, 5114);
});

test("拖家具吸附：贴墙内皮、净空角，接近居中才居中，并出引导线", () => {
  const room: Room = { id: "r", name: "房", x: 10000, z: 0, w: 4000, d: 5000, kind: "living" };
  const clear = roomFurnitureClearRect(room, 0, 20);
  const xs = [10000, 14000];
  const zs = [0, 5000];

  // 沙发靠近北墙内皮且近居中 → 贴墙内皮并沿墙居中；引导线含内皮与中线
  const sofa = createFurniture("sofa", 12050, clear.z0 + 400);
  const sofaGuides = snapFurnitureDuringDrag(sofa, xs, zs, {
    room,
    floorIndex: 0,
    allowCenter: true,
    maxGap: 150,
    centerGap: 250,
    previewGap: 500,
  });
  const box = furnitureWorldBounds(sofa);
  assert.ok(Math.abs(box.z0 - clear.z0) < 50, `应贴北墙内皮，实得 z0=${box.z0} clear=${clear.z0}`);
  assert.ok(Math.abs(sofa.x - (clear.x0 + clear.x1) / 2) < 150);
  assert.ok(sofaGuides.guideZs.includes(clear.z0) || sofaGuides.guideZs.some((z) => Math.abs(z - clear.z0) < 30));

  // 椅子靠近西墙内皮：自由件贴边，不强制居中；接近时有引导线
  const chair = createFurniture("chair", clear.x0 + 350, 2000);
  const chairGuides = snapFurnitureDuringDrag(chair, xs, zs, {
    room,
    floorIndex: 0,
    allowCenter: true,
    maxGap: 150,
    previewGap: 500,
  });
  assert.equal(furnitureUsesWallCenter("chair"), false);
  assert.ok(Math.abs(furnitureWorldBounds(chair).x0 - clear.x0) < 50);
  assert.ok(chairGuides.guideXs.length > 0, "接近墙内皮应出现竖向引导线");

  // 衣柜角靠近净空角 → 吸到角点（内皮），不是外轮廓墙尖
  const wardrobe = createFurniture("wardrobe", clear.x0 + 350, clear.z0 + 200);
  wardrobe.w = 800;
  wardrobe.d = 500;
  snapFurnitureDuringDrag(wardrobe, xs, zs, {
    room,
    floorIndex: 0,
    allowCenter: false,
    maxGap: 250,
  });
  const wb = furnitureWorldBounds(wardrobe);
  const cornerDist = Math.min(
    Math.hypot(wb.x0 - clear.x0, wb.z0 - clear.z0),
    Math.hypot(wb.x1 - clear.x0, wb.z0 - clear.z0),
    Math.hypot(wb.x0 - clear.x0, wb.z1 - clear.z0),
  );
  assert.ok(cornerDist < 80, `净空角距离 ${cornerDist}`);

  // 靠近房间中线时出现居中引导线（未吸死也可看见）
  const table = createFurniture("table", (clear.x0 + clear.x1) / 2 + 300, (clear.z0 + clear.z1) / 2);
  const midGuides = snapFurnitureDuringDrag(table, xs, zs, {
    room,
    floorIndex: 0,
    allowCenter: true,
    maxGap: 120,
    centerGap: 350,
    previewGap: 500,
  });
  const midX = (clear.x0 + clear.x1) / 2;
  assert.ok(midGuides.guideXs.some((x) => Math.abs(x - midX) < 30), "应出现居中竖向引导线");
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

  const room: Room = { id: "r", name: "房", x: 10000, z: 0, w: 4000, d: 5000, kind: "living" };
  const sofa = createFurniture("sofa", 11500, 600);
  assert.equal(nearestRoomWall(sofa, room, 0).side, "north");
  centerFurnitureAgainstNearestWall(sofa, room, 0, 50);
  const clear = roomFurnitureClearRect(room, 0, 50);
  const box = furnitureWorldBounds(sofa);
  assert.ok(Math.abs(box.z0 - clear.z0) < 20);
  assert.ok(Math.abs(sofa.x - (room.x + room.w / 2)) < 20);

  // 压进北墙外轮廓时，应被推出墙内皮
  const tv = createFurniture("tv", 12000, -100);
  tv.d = 400;
  pullFurnitureClearOfWalls(tv, room, 0, 20);
  const inner = roomFurnitureClearRect(room, 0, 20);
  const tvBox = furnitureWorldBounds(tv);
  assert.ok(tvBox.z0 >= inner.z0 - 30);
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

  editor.draft.floors[0]!.furniture[0]!.x = x0 + 800;
  (editor as unknown as { commit: () => void }).commit();
  assert.equal(editor.canUndo, true);
  assert.equal(editor.draft.floors[0]!.furniture[0]!.x, x0 + 800);

  editor.undo();
  assert.equal(editor.draft.floors[0]!.furniture[0]!.x, x0);
  assert.equal(editor.canRedo, true);

  editor.redo();
  assert.equal(editor.draft.floors[0]!.furniture[0]!.x, x0 + 800);

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
  editor.updateSelectedNumber("w", 2400);
  assert.equal(editor.draft.annexFurniture[0]!.w, 2400);
  assert.equal(editor.draft.annexFurniture[0]!.d, 2400);
});

test("拖房间：四面独占短墙同移；共用长墙不动", () => {
  const roomA: Room = {
    id: "a",
    name: "A",
    kind: "bedroom",
    x: 2000,
    z: 2000,
    w: 3000,
    d: 2500,
  };
  const roomB: Room = {
    id: "b",
    name: "B",
    kind: "bedroom",
    x: 5000,
    z: 2000,
    w: 3000,
    d: 2500,
  };
  // A 独有西／北／南墙；东侧与 B 共用长横墙在北侧延伸？用竖向共用墙：x=5000 贴 A 东与 B 西
  const walls: Wall[] = [
    { a: [2000, 2000], b: [2000, 4500] }, // A west
    { a: [2000, 2000], b: [5000, 2000] }, // A north（仅 A）
    { a: [2000, 4500], b: [5000, 4500] }, // A south
    { a: [5000, 2000], b: [5000, 4500] }, // shared A east / B west
    { a: [5000, 2000], b: [8000, 2000] }, // B north
    { a: [8000, 2000], b: [8000, 4500] }, // B east
    { a: [5000, 4500], b: [8000, 4500] }, // B south
  ];
  const rooms = [roomA, roomB];
  const ownedA = wallsOwnedByRoom(roomA, walls, rooms);
  assert.equal(ownedA.length, 3);
  assert.ok(ownedA.every((o) => o.index !== 3));

  const orig = structuredClone(walls);
  translateOwnedWallsWithRoom(roomA, 500, -300, walls, orig, rooms);
  assert.deepEqual(walls[0]!.a, [2500, 1700]);
  assert.deepEqual(walls[0]!.b, [2500, 4200]);
  assert.deepEqual(walls[1]!.a, [2500, 1700]);
  assert.deepEqual(walls[1]!.b, [5500, 1700]);
  assert.deepEqual(walls[2]!.a, [2500, 4200]);
  assert.deepEqual(walls[2]!.b, [5500, 4200]);
  // 共用墙与 B 侧墙不动
  assert.deepEqual(walls[3], orig[3]);
  assert.deepEqual(walls[4], orig[4]);
  assert.deepEqual(walls[5], orig[5]);
  assert.deepEqual(walls[6], orig[6]);
});

test("拉角改房间：独占边墙随新边伸缩", () => {
  const room: Room = { id: "solo", name: "独间", kind: "bath", x: 1000, z: 1000, w: 2000, d: 1500 };
  const walls: Wall[] = [
    { a: [1000, 1000], b: [1000, 2500] },
    { a: [3000, 1000], b: [3000, 2500] },
    { a: [1000, 1000], b: [3000, 1000] },
    { a: [1000, 2500], b: [3000, 2500] },
  ];
  const origWalls = structuredClone(walls);
  const next = { ...room, w: 2800, d: 1500 };
  resizeOwnedWallsWithRoom(room, next, walls, origWalls, [room]);
  assert.equal(walls[0]!.a[0], 1000);
  assert.equal(walls[1]!.a[0], 3800);
  assert.deepEqual(
    [Math.min(walls[2]!.a[0], walls[2]!.b[0]), Math.max(walls[2]!.a[0], walls[2]!.b[0])],
    [1000, 3800],
  );
  assert.deepEqual(
    [Math.min(walls[3]!.a[0], walls[3]!.b[0]), Math.max(walls[3]!.a[0], walls[3]!.b[0])],
    [1000, 3800],
  );
});

test("改房间宽：东贴外皮则只推西侧内墙，邻房东边跟着对齐", () => {
  const body = { x: 0, z: 0, w: 10000, d: 8000 };
  const bed: Room = { id: "bed", name: "次卧", kind: "bed", x: 6100, z: 3800, w: 3900, d: 4200 };
  const hall: Room = { id: "hall", name: "过道", kind: "hall", x: 4000, z: 3800, w: 2100, d: 4200 };
  // 共用竖墙在 6100；次卧东＝外皮 10000；北横墙在内
  const walls: Wall[] = [
    { a: [6100, 3800], b: [6100, 8000], role: "bearing" }, // shared
    { a: [6100, 3800], b: [10000, 3800], role: "bearing" }, // bed north (interior)
    { a: [4000, 3800], b: [6100, 3800], role: "partition" }, // hall north
  ];
  const rooms = [bed, hall];
  const orig = { ...bed };
  const next = anchorRoomSizeAgainstEnvelope(bed, "w", 3945, body);
  assert.equal(next.x + next.w, 10000); // 东缘锁外皮
  assert.equal(next.w, 3945);
  assert.equal(next.x, 10000 - 3945);
  syncInteriorWallsToRoom(orig, next, walls, rooms, body);
  assert.equal(walls[0]!.a[0], next.x);
  assert.equal(walls[0]!.b[0], next.x);
  // 邻房东边跟着到新西墙
  assert.equal(hall.x + hall.w, next.x);
  // 外皮不产生新墙；北内墙西端随新宽伸到 next.x
  assert.equal(Math.min(walls[1]!.a[0], walls[1]!.b[0]), next.x);
  assert.equal(Math.max(walls[1]!.a[0], walls[1]!.b[0]), 10000);
});

test("房间东缘漂移出外皮时，改宽锁楼体外皮而非漂移边", () => {
  // 再现：X=16312 宽=3900 → 东缘 20212，外皮 20200，标线只能量到 3888
  const body = { x: 6600, z: -400, w: 13600, d: 10000 };
  const room: Room = {
    id: "room1",
    name: "房间2",
    kind: "bed",
    x: 16312,
    z: 5400,
    w: 3900,
    d: 4200,
  };
  const clamped = clampRoomToEnvelope(room, body);
  assert.equal(clamped.x + clamped.w, 20200);
  assert.equal(clamped.w, 3888); // 先吸回外皮时宽变成真实到外皮的跨度

  const next = anchorRoomSizeAgainstEnvelope(room, "w", 3900, body);
  assert.equal(next.x + next.w, 20200); // 锁的是楼体外皮
  assert.equal(next.w, 3900);
  assert.equal(next.x, 16300); // 西缘内推，不再停在 16312
});

test("拖房间：房内家具同移且相对位置不变，房外与套间内家具不动", () => {
  const bed: Room = { id: "bed", name: "卧室", kind: "bedroom", x: 0, z: 0, w: 6000, d: 5000 };
  const bath: Room = { id: "bath", name: "内卫", kind: "bath", x: 4000, z: 0, w: 2000, d: 2000 };
  const rooms = [bed, bath];
  const furniture: Furniture[] = [
    { id: "f1", kind: "bed", x: 2000, z: 3000, w: 1500, d: 2000, rotation: 0 },
    { id: "f2", kind: "toilet", x: 5000, z: 1000, w: 400, d: 600, rotation: 0 },
    { id: "f3", kind: "sofa", x: 8000, z: 8000, w: 2000, d: 900, rotation: 0 },
  ];
  const orig = structuredClone(furniture);
  // 拖卧室：床跟移；内卫马桶属小房间不跟；房外沙发不动
  translateFurnitureInsideRoom(bed, 1200, -500, furniture, orig, rooms);
  assert.equal(furniture[0]!.x, 3200);
  assert.equal(furniture[0]!.z, 2500);
  assert.equal(furniture[1]!.x, 5000);
  assert.equal(furniture[1]!.z, 1000);
  assert.equal(furniture[2]!.x, 8000);
  assert.equal(furniture[2]!.z, 8000);

  // 拖内卫：马桶跟移
  const furn2 = structuredClone(orig);
  translateFurnitureInsideRoom(bath, 300, 400, furn2, orig, rooms);
  assert.equal(furn2[0]!.x, 2000);
  assert.equal(furn2[1]!.x, 5300);
  assert.equal(furn2[1]!.z, 1400);
});
