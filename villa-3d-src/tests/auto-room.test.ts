import assert from "node:assert/strict";
import { test } from "node:test";
import { construction, site, type Furniture, type Room, type Wall } from "../src/data.ts";
import { areaM2 } from "../src/units.ts";
import { roomAreas, roomFillBounds } from "../src/design-data.ts";
import { translateFurnitureInsideRoom, translateOwnedWallsWithRoom } from "../src/layout-align.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import {
  allRoomRegions,
  applyRoomToEnclosedRegion,
  enclosedRoomRegions,
  findEnclosedRegionAt,
  findRoomForRegion,
  findWallCorners,
  rectFromThreeCorners,
  regionTouchesWall,
  stretchOrthogonalWallsToMoved,
  threeWallRoomRegions,
} from "../src/plan-regions.ts";

const body = () => ({ x: site.main.x, z: site.main.z, w: site.main.w, d: site.main.d });

/** 主楼内用四面隔墙围一个 4×3 盒子（不贴外墙）。 */
function boxWalls(): Wall[] {
  const b = body();
  const x0 = b.x + 2000, x1 = b.x + 6000, z0 = b.z + 2000, z1 = b.z + 5000;
  return [
    { a: [x0, z0], b: [x1, z0], role: "partition" },
    { a: [x0, z1], b: [x1, z1], role: "partition" },
    { a: [x0, z0], b: [x0, z1], role: "partition" },
    { a: [x1, z0], b: [x1, z1], role: "partition" },
  ];
}

/** 三面 U 形：南基＋西／东臂（东臂较短）。 */
function uWalls(): Wall[] {
  const b = body();
  const x0 = b.x + 2000, x1 = b.x + 6000, z0 = b.z + 2000, z1 = b.z + 5000;
  return [
    { a: [x0, z1], b: [x1, z1], role: "partition" }, // 南基
    { a: [x0, z0], b: [x0, z1], role: "partition" }, // 西臂到 2000
    { a: [x1, z0 + 1000], b: [x1, z1], role: "partition" }, // 东臂较短
  ];
}

test("四面隔墙围合出矩形房间区", () => {
  const walls = boxWalls();
  const regions = enclosedRoomRegions(body(), walls);
  const inner = regions.find((r) => Math.abs(r.w - 4000) < 50 && Math.abs(r.d - 3000) < 50);
  assert.ok(inner, `应检出 4×3 内区，实际 ${JSON.stringify(regions)}`);
  assert.equal(inner.rectangular, true);
  assert.equal(inner.hasInternalWall, true);
});

test("墙墙正交交点识别为交叉角", () => {
  const walls = uWalls();
  const b = body();
  const x0 = b.x + 2000, x1 = b.x + 6000, z1 = b.z + 5000;
  const corners = findWallCorners(walls);
  assert.equal(corners.length, 2);
  assert.ok(corners.some((c) => Math.abs(c.x - x0) < 2 && Math.abs(c.z - z1) < 2));
  assert.ok(corners.some((c) => Math.abs(c.x - x1) < 2 && Math.abs(c.z - z1) < 2));
});

test("三点补第四角得到轴对齐矩形", () => {
  const rect = rectFromThreeCorners(
    { x: 0, z: 0 },
    { x: 4000, z: 0 },
    { x: 0, z: 2000 },
  );
  assert.deepEqual(rect, { x: 0, z: 0, w: 4000, d: 2000 });
  assert.equal(rectFromThreeCorners({ x: 0, z: 0 }, { x: 1000, z: 0 }, { x: 500, z: 500 }), null);
});

test("三面垂直连接墙按最长臂生成最大矩形", () => {
  const walls = uWalls();
  const regions = threeWallRoomRegions(body(), walls);
  // 开敞向北：最长臂为西臂 3000，基边跨度 4000 → 房间 4000×3000（最长墙定最大尺寸）
  const hit = regions.find((r) => Math.abs(r.w - 4000) < 50 && Math.abs(r.d - 3000) < 50);
  assert.ok(hit, `应检出按最长臂的 U 形矩形，实际 ${JSON.stringify(regions)}`);
  assert.equal(hit.openSide, true);
  // 不再用短臂 2000 限制
  assert.equal(regions.some((r) => Math.abs(r.w - 4000) < 50 && Math.abs(r.d - 2000) < 50), false);
});

test("两面 L 形墙不成房", () => {
  const b = body();
  const x0 = b.x + 2000, x1 = b.x + 6000, z0 = b.z + 2000, z1 = b.z + 5000;
  const walls: Wall[] = [
    { a: [x0, z1], b: [x1, z1], role: "partition" },
    { a: [x0, z0], b: [x0, z1], role: "partition" },
  ];
  assert.deepEqual(threeWallRoomRegions(body(), walls), []);
});

/** 东北角：西隔墙 + 北外墙 + 东外墙（南开敞），模拟图面右侧上区。 */
function neExteriorUWalls(): Wall[] {
  const b = body();
  const xW = b.x + b.w - 4274; // 东条带宽约 4274
  const zS = b.z + 5483; // 开敞边大约在右向分界
  return [
    { a: [xW, b.z], b: [xW, zS], role: "partition" }, // 西隔贴到北外皮
  ];
}

/** 东南角：北隔墙 + 东外墙 + 南外墙（西开敞），模拟图面右侧下区。 */
function seExteriorUWalls(): Wall[] {
  const b = body();
  const xW = b.x + b.w - 4274;
  const zN = b.z + 5483;
  return [
    { a: [xW, zN], b: [b.x + b.w, zN], role: "partition" }, // 北隔贴到东外皮
  ];
}

test("靠外墙的东北 U 形三面可成房", () => {
  const b = body();
  const walls = neExteriorUWalls();
  const regions = threeWallRoomRegions(b, walls);
  // 无中间横墙时，东外墙到南转角比西隔墙更长 → 按最长外侧墙取满进深
  const hit = regions.find(
    (r) =>
      Math.abs(r.x - (b.x + b.w - 4274)) < 50 &&
      Math.abs(r.z - b.z) < 50 &&
      Math.abs(r.w - 4274) < 50 &&
      Math.abs(r.d - b.d) < 50,
  );
  assert.ok(hit, `应检出按东外墙最长尺寸的东北 U 区，实际 ${JSON.stringify(regions)}`);
});

test("靠外墙的东南 U 形三面可成房", () => {
  const b = body();
  const walls = seExteriorUWalls();
  const regions = threeWallRoomRegions(b, walls);
  const hit = regions.find(
    (r) =>
      Math.abs(r.x - (b.x + b.w - 4274)) < 50 &&
      Math.abs(r.z - (b.z + 5483)) < 50 &&
      Math.abs(r.w - 4274) < 50 &&
      Math.abs(r.d - (b.d - 5483)) < 50,
  );
  assert.ok(hit, `应检出东南外墙 U 区，实际 ${JSON.stringify(regions)}`);
});

test("南北两道隔墙同时可贴出东北与东南两间", () => {
  const b = body();
  const walls = [...neExteriorUWalls(), ...seExteriorUWalls()];
  const regions = threeWallRoomRegions(b, walls);
  assert.ok(regions.some((r) => Math.abs(r.w - 4274) < 50 && Math.abs(r.d - 5483) < 50));
  assert.ok(regions.some((r) => Math.abs(r.w - 4274) < 50 && Math.abs(r.d - (b.d - 5483)) < 50));
});

/**
 * 左短右长 + 短臂顶 stub 横墙未接到右侧：应按右臂最长尺寸成房，
 * stub 不得挡住外接矩形（否则上方会留白）。
 */
test("左右臂不等长时按长臂成房，短臂顶 stub 不挡", () => {
  const b = body();
  const x0 = b.x + 3000, x1 = b.x + 8000;
  const zBot = b.z + 6000, zStub = b.z + 3000, zTop = b.z + 2000;
  const walls: Wall[] = [
    { a: [x0, zBot], b: [x1, zBot], role: "partition" }, // 底（较长）
    { a: [x0, zStub], b: [x0, zBot], role: "partition" }, // 左短臂
    { a: [x1, zTop], b: [x1, zBot], role: "virtual" }, // 右长臂（虚拟墙）
    { a: [x0, zStub], b: [x0 + 2000, zStub], role: "partition" }, // stub，未接到右臂
    { a: [x1 - 2500, zTop], b: [x1, zTop], role: "partition" }, // 右臂顶横墙
  ];
  const regions = threeWallRoomRegions(b, walls);
  const tall = regions.find(
    (r) =>
      Math.abs(r.x - x0) < 50 &&
      Math.abs(r.w - (x1 - x0)) < 50 &&
      Math.abs(r.z - zTop) < 50 &&
      Math.abs(r.d - (zBot - zTop)) < 50,
  );
  assert.ok(tall, `应按右臂撑到顶墙填满空白，实际 ${JSON.stringify(regions)}`);
});

/**
 * 宽开间南墙中部竖向隔墙未接到北侧：应按相邻交叉拆成左右两间，
 * 不得保留跨过隔墙的通长大房间。
 */
test("南侧中间隔墙未贯通也拆成左右两间", () => {
  const b = body();
  const xW = b.x + 3000, xM = b.x + 7000, xE = b.x + 11000;
  const zN = b.z + 2000, zS = b.z + 7000;
  const walls: Wall[] = [
    { a: [xW, zS], b: [xE, zS], role: "partition" }, // 南基
    { a: [xW, zN], b: [xW, zS], role: "partition" }, // 西
    { a: [xE, zN], b: [xE, zS], role: "partition" }, // 东
    { a: [xW, zN], b: [xE, zN], role: "partition" }, // 北（四面本可封闭，但中隔未接）
    { a: [xM, zS - 2500], b: [xM, zS], role: "partition" }, // 中隔从南伸入未到北
  ];
  const regions = allRoomRegions(b, walls);
  const left = regions.find(
    (r) => Math.abs(r.x - xW) < 50 && Math.abs(r.w - (xM - xW)) < 80,
  );
  const right = regions.find(
    (r) => Math.abs(r.x - xM) < 50 && Math.abs(r.w - (xE - xM)) < 80,
  );
  assert.ok(left, `应有左间，实际 ${JSON.stringify(regions)}`);
  assert.ok(right, `应有右间，实际 ${JSON.stringify(regions)}`);
  assert.equal(
    regions.some((r) => Math.abs(r.w - (xE - xW)) < 80 && Math.abs(r.d - (zS - zN)) < 80),
    false,
    `不应保留跨中隔的通间，实际 ${JSON.stringify(regions)}`,
  );
});

/** 上中下三道横墙共用右竖墙：只在相邻交叉点成房，不跨中墙成大间。 */
test("共用竖墙上相邻交叉点成房，不得跨过中间墙成大间", () => {
  const b = body();
  const x0 = b.x + 5000, x1 = b.x + 9000;
  const zTop = b.z + 2000, zMid = b.z + 5000, zBot = b.z + 8000;
  const walls: Wall[] = [
    { a: [x0, zTop], b: [x1, zTop], role: "partition" },
    { a: [x0, zMid], b: [x1, zMid], role: "partition" },
    { a: [x0, zBot], b: [x1, zBot], role: "partition" },
    { a: [x1, zTop], b: [x1, zBot], role: "partition" },
  ];
  const regions = threeWallRoomRegions(b, walls);
  const upper = regions.find(
    (r) => Math.abs(r.w - 4000) < 50 && Math.abs(r.d - 3000) < 50 && Math.abs(r.z - zTop) < 50,
  );
  const lower = regions.find(
    (r) => Math.abs(r.w - 4000) < 50 && Math.abs(r.d - 3000) < 50 && Math.abs(r.z - zMid) < 50,
  );
  assert.ok(upper, `应有上－中小间，实际 ${JSON.stringify(regions)}`);
  assert.ok(lower, `应有中－下小间，实际 ${JSON.stringify(regions)}`);
  // 跨过中间墙的大间（高 6000）不得出现
  assert.equal(
    regions.some((r) => Math.abs(r.w - 4000) < 50 && Math.abs(r.d - 6000) < 50),
    false,
    `不应出现跨中墙大间，实际 ${JSON.stringify(regions)}`,
  );
});

test("有门洞的墙仍参与三面成房", () => {
  const walls = uWalls();
  walls[0]!.door = { offset: 500, width: 900, kind: "door", side: "in", hinge: "left" };
  const regions = threeWallRoomRegions(body(), walls);
  assert.ok(regions.some((r) => Math.abs(r.w - 4000) < 50 && Math.abs(r.d - 3000) < 50));
});

test("四面含虚拟墙同样围合出房间区", () => {
  const walls = boxWalls();
  walls[1]!.role = "virtual";
  walls[2]!.role = "virtual";
  const regions = enclosedRoomRegions(body(), walls);
  const inner = regions.find((r) => Math.abs(r.w - 4000) < 50 && Math.abs(r.d - 3000) < 50);
  assert.ok(inner);
});

test("房间贴围合区后色块缩到墙内皮，套内＜建筑面积", () => {
  const walls = boxWalls();
  const region = findEnclosedRegionAt(site.main.x + 4000, site.main.z + 3500, body(), walls)!;
  assert.ok(region);
  const room: Room = {
    id: "t1", name: "测", x: 0, z: 0, w: 1000, d: 1000, kind: "living",
  };
  applyRoomToEnclosedRegion(room, region);
  const fill = roomFillBounds(room, 0, walls);
  const areas = roomAreas(room, 0, walls);
  assert.ok(fill.w < room.w && fill.d < room.d, "色块应小于外轮廓（扣隔墙半厚）");
  assert.ok(Math.abs(fill.x - (room.x + construction.partition / 2)) < 1);
  assert.ok(areas.interior < areas.building);
  assert.ok(Math.abs(areas.building - areaM2(room.w, room.d)) < 1e-6);
  assert.ok(Math.abs(areas.interior - areaM2(fill.w, fill.d)) < 1e-6);
});

test("无内墙时不自动造整栋房间", () => {
  assert.deepEqual(enclosedRoomRegions(body(), []), []);
});

test("拖墙再次改位时更新已有房间尺寸而非新建", () => {
  const draft = clonePublishedLayout();
  draft.floors[0]!.partitions = boxWalls();
  draft.floors[0]!.rooms = [];
  draft.floors[0]!.furniture = [];
  const editor = new LayoutEditor(
    { getFloor: () => 0, redraw: () => {}, toast: () => {} } as never,
    draft,
  );
  const api = editor as unknown as {
    ensureAutoRoomsFromWalls: (f: number, a: boolean, w?: Wall) => { created: number; updated: number };
  };
  const first = api.ensureAutoRoomsFromWalls(0, false, draft.floors[0]!.partitions[3]);
  assert.equal(first.created, 1);
  assert.equal(draft.floors[0]!.rooms.length, 1);
  const room = draft.floors[0]!.rooms[0]!;
  const before = { w: room.w, d: room.d };

  // 把东墙往东移 500mm，并让南北墙端跟着伸长（与编辑器拖墙一致）
  const eastOrig = structuredClone(draft.floors[0]!.partitions[3]!);
  const east = draft.floors[0]!.partitions[3]!;
  east.a = [east.a[0] + 500, east.a[1]];
  east.b = [east.b[0] + 500, east.b[1]];
  stretchOrthogonalWallsToMoved(3, draft.floors[0]!.partitions, eastOrig);
  const second = api.ensureAutoRoomsFromWalls(0, false, east);
  assert.equal(second.created, 0);
  assert.ok(second.updated >= 1, `应更新房间尺寸，实际 ${JSON.stringify(second)} w ${before.w}→${room.w}`);
  assert.equal(draft.floors[0]!.rooms.length, 1);
  assert.ok(room.w > before.w);
});

test("垂直墙随被拖墙端点伸缩", () => {
  const walls = boxWalls();
  const southOrig = structuredClone(walls[1]!);
  const west = walls[2]!;
  const beforeWestLen = Math.abs(west.b[1] - west.a[1]);
  // 南墙南移 500
  walls[1]!.a = [southOrig.a[0], southOrig.a[1] + 500];
  walls[1]!.b = [southOrig.b[0], southOrig.b[1] + 500];
  stretchOrthogonalWallsToMoved(1, walls, southOrig);
  const afterWestLen = Math.abs(west.b[1] - west.a[1]);
  assert.ok(afterWestLen > beforeWestLen - 1, `西墙应变长，前 ${beforeWestLen} 后 ${afterWestLen}`);
  assert.ok(Math.abs(Math.max(west.a[1], west.b[1]) - walls[1]!.a[1]) < 2);
});

test("画四面墙自动生成房间；移动房间携家具且墙不跟移", () => {
  const draft = clonePublishedLayout();
  draft.floors[0]!.partitions = [];
  draft.floors[0]!.rooms = [];
  draft.floors[0]!.furniture = [];
  const editor = new LayoutEditor(
    { getFloor: () => 0, redraw: () => {}, toast: () => {} } as never,
    draft,
  );
  const walls = boxWalls();
  for (const w of walls) draft.floors[0]!.partitions.push(w);
  const last = walls[3]!;
  const n = (editor as unknown as {
    ensureAutoRoomsFromWalls: (f: number, a: boolean, w?: Wall) => { created: number; updated: number };
  }).ensureAutoRoomsFromWalls(0, false, last);
  assert.equal(n.created, 1);
  const room = draft.floors[0]!.rooms[0]!;
  assert.ok(findRoomForRegion([room], findEnclosedRegionAt(room.x + room.w / 2, room.z + room.d / 2, body(), walls)!));

  const chair: Furniture = {
    kind: "chair",
    x: room.x + room.w / 2,
    z: room.z + room.d / 2,
    w: 500,
    d: 500,
  };
  draft.floors[0]!.furniture.push(chair);
  const origRoom = structuredClone(room);
  const origFurn = [structuredClone(chair)];
  const wallSnap = structuredClone(draft.floors[0]!.partitions);
  room.x += 500;
  room.z += 300;
  translateFurnitureInsideRoom(origRoom, 500, 300, draft.floors[0]!.furniture, origFurn, [origRoom]);
  // 故意调用旧的跟墙逻辑则墙会动；此处断言我们业务上不该动墙——墙快照仍等于当前
  assert.deepEqual(draft.floors[0]!.partitions, wallSnap);
  assert.ok(Math.abs(chair.x - (origFurn[0]!.x + 500)) < 1);
  assert.ok(Math.abs(chair.z - (origFurn[0]!.z + 300)) < 1);

  // 确认若调用 translateOwnedWallsWithRoom 墙会动（对照），但编辑器已不再调用
  const wallsClone = structuredClone(wallSnap);
  translateOwnedWallsWithRoom(origRoom, 500, 300, wallsClone, wallSnap, [origRoom]);
  assert.notDeepEqual(wallsClone, wallSnap);
});

test("regionTouchesWall 只认贴边墙段", () => {
  const walls = boxWalls();
  const region = findEnclosedRegionAt(site.main.x + 4000, site.main.z + 3500, body(), walls)!;
  assert.ok(regionTouchesWall(region, walls[0]!));
  assert.equal(
    regionTouchesWall(region, { a: [site.main.x + 8000, site.main.z + 2000], b: [site.main.x + 10000, site.main.z + 2000], role: "partition" }),
    false,
  );
});
