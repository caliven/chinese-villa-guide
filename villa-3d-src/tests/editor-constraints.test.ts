import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/villa-params.ts";
import { site, type Room, type Wall } from "../src/data.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { collectWallSnapSegs, refineWallEnd } from "../src/layout-draft.ts";

const x = (v: number) => Math.round(site.main.x) + v;
const z = (v: number) => Math.round(site.main.z) + v;
function make(walls: Wall[], rooms: Room[] = []) {
  const draft = clonePublishedLayout();
  Object.assign(draft.floors[0]!, { partitions: structuredClone(walls), rooms: structuredClone(rooms), furniture: [] });
  const messages: string[] = [];
  return { editor: new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: s => messages.push(s) }, draft), messages };
}
function box(): Wall[] {
  return [
    { a: [x(2000), z(2000)], b: [x(6000), z(2000)] },
    { a: [x(6000), z(2000)], b: [x(6000), z(5000)] },
    { a: [x(6000), z(5000)], b: [x(2000), z(5000)] },
    { a: [x(2000), z(5000)], b: [x(2000), z(2000)] },
  ];
}
test("四方向墙微移保持L角和房间边界，往返及撤销重做恢复原几何", () => {
  const { editor } = make(box());
  editor.generateAutoRooms();
  const before = editor.draft.floors[0]!.partitions.map(w => [w.a, w.b]);
  const id = editor.draft.floors[0]!.rooms[0]!.id;
  editor.selection = { kind: "wall", index: 1, floor: 0 };
  for (const [dx, dz] of [[10, 0], [0, 10], [-10, 0], [0, -10]]) editor.nudgeSelection(dx!, dz!);
  assert.deepEqual(editor.draft.floors[0]!.partitions.map(w => [w.a, w.b]), before);
  assert.equal(editor.draft.floors[0]!.rooms[0]!.id, id);
  assert.equal(editor.draft.floors[0]!.rooms[0]!.boundary?.status, "enclosed");
  editor.undo(); editor.redo();
  assert.deepEqual(editor.draft.floors[0]!.partitions.map(w => [w.a, w.b]), before);
});
test("楼梯侧墙可独立往返微移和改长，三层楼梯框及洞口不变，撤销重做有效", () => {
  const draft = clonePublishedLayout();
  Object.assign(draft.stairLayout.room, { x: x(6800), z: z(5800), w: 2900, d: 4200 });
  for (const floor of draft.floors) {
    floor.rooms = [{ id: "stair", name: "楼梯", kind: "stair", ...draft.stairLayout.room }];
    floor.partitions = [];
  }
  draft.floors[1]!.partitions = [{ a: [x(6782), z(5800)], b: [x(6782), z(10000)], role: "bearing" }];
  const messages: string[] = [];
  const editor = new LayoutEditor({ getFloor: () => 1, redraw: () => {}, toast: s => messages.push(s) }, draft);
  const before = structuredClone(editor.draft);
  editor.selection = { kind: "wall", index: 0, floor: 1 };
  const wall = editor.draft.floors[1]!.partitions[0]!;
  editor.nudgeSelection(-100, 0);
  assert.equal(wall.a[0], x(6682));
  editor.nudgeSelection(200, 0);
  assert.equal(wall.a[0], x(6882));
  editor.nudgeSelection(-100, 0);
  assert.deepEqual(wall, before.floors[1]!.partitions[0]);
  editor.updateSelectedNumber("length", 4000);
  assert.equal(Math.abs(wall.b[1] - wall.a[1]), 4000);
  assert.deepEqual(editor.draft.stairLayout, before.stairLayout);
  assert.deepEqual(editor.draft.floors.map(f => f.rooms), before.floors.map(f => f.rooms));
  assert.ok(!messages.some(s => s.includes("专用几何")));
  editor.undo();
  assert.deepEqual(editor.draft.floors[1]!.partitions, before.floors[1]!.partitions);
  editor.redo();
  const redone = editor.draft.floors[1]!.partitions[0]!;
  assert.equal(Math.abs(redone.b[1] - redone.a[1]), 4000);
});

test("长度输入保留反向端序和洞宽，容不下洞口时拒绝", () => {
  const { editor, messages } = make([{ a: [x(6000), z(3000)], b: [x(2000), z(3000)], door: { offset: 2800, width: 900, kind: "door", hinge: "end", side: "in" } }]);
  editor.selection = { kind: "wall", index: 0, floor: 0 };
  editor.updateSelectedNumber("length", 1000);
  const wall = editor.draft.floors[0]!.partitions[0]!;
  assert.ok(wall.a[0] > wall.b[0]);
  assert.equal(wall.door!.width, 900);
  assert.ok(wall.door!.offset + 900 <= 1000);
  const before = structuredClone(wall);
  editor.updateSelectedNumber("length", 500);
  assert.deepEqual(wall, before);
  assert.ok(messages.at(-1)!.includes("洞口"));
});
test("全局生成与手动放置不重复占用同一闭合区，生成幂等", () => {
  const { editor } = make(box());
  editor.generateAutoRooms();
  const id = editor.draft.floors[0]!.rooms[0]!.id;
  editor.placeRoomAt(x(3000), z(3000));
  assert.equal(editor.draft.floors[0]!.rooms.length, 1);
  assert.equal((editor.selection as { id: string }).id, id);
  assert.deepEqual(editor.generateAutoRooms(), { created: 0, updated: 0, issues: [] });
});

test("全局生成保留成功数量，并提示实际冲突分区，不把已有挑空当成新房报错", () => {
  const walls: Wall[] = [
    { a: [x(0), z(3000)], b: [x(3000), z(3000)] },
    { a: [x(3000), z(0)], b: [x(3000), z(3000)] },
    { a: [x(6000), z(5000)], b: [x(9000), z(5000)] },
    { a: [x(9000), z(5000)], b: [x(9000), z(8000)] },
    { a: [x(9000), z(8000)], b: [x(6000), z(8000)] },
  ];
  const { editor, messages } = make(walls, [
    { id: "void", name: "客厅上空", kind: "void", x: x(0), z: z(0), w: 3000, d: 3000 },
    { id: "stair", name: "楼梯", kind: "stair", x: x(4500), z: z(4000), w: 1000, d: 1000 },
  ]);
  const result = editor.generateAutoRooms();
  assert.ok(result.created >= 1);
  const message = messages.at(-1)!;
  assert.match(message, /已自动生成|新建/);
  assert.ok(!message.includes("覆盖客厅上空"));
  assert.match(message, /距西墙/);
  assert.match(message, /楼梯/);
});
test("开敞U区不会误选无边界关联的其他手工房", () => {
  const walls = box(); walls.splice(0, 1);
  const { editor } = make(walls, [{ id: "old", name: "old", kind: "bed", x: x(8000), z: z(1000), w: 2000, d: 2000 }]);
  editor.placeRoomAt(x(3000), z(3000));
  assert.equal(editor.draft.floors[0]!.rooms.length, 2);
  assert.notEqual((editor.selection as { id: string }).id, "old");
});
test("房间方向键与数值坐标都带家具跟移，并解除原墙边界关联", () => {
  const { editor } = make([], [{ id: "A", name: "A", kind: "bed", x: x(2000), z: z(2000), w: 3000, d: 3000, boundary: { key: "old", status: "enclosed" } }]);
  editor.draft.floors[0]!.furniture = [{ kind: "bed", x: x(3000), z: z(3000), w: 1000, d: 1000 }];
  editor.selection = { kind: "room", id: "A", floor: 0 };
  editor.nudgeSelection(10, 0);
  assert.equal(editor.draft.floors[0]!.furniture[0]!.x, x(3010));
  editor.updateSelectedNumber("z", z(2100));
  assert.equal(editor.draft.floors[0]!.furniture[0]!.z, z(3100));
  assert.equal(editor.draft.floors[0]!.rooms[0]!.boundary, undefined);
});
test("房间平移保持原宽深并限制整轮廓在外墙包络内", () => {
  const { editor } = make([], [{ id: "wide", name: "wide", kind: "bed", x: x(2000), z: z(2000), w: 6000, d: 3000 }]);
  editor.selection = { kind: "room", id: "wide", floor: 0 };
  editor.updateSelectedNumber("x", x(100000));
  const room = editor.draft.floors[0]!.rooms[0]!;
  assert.equal(room.w, 6000);
  assert.ok(room.x + room.w <= site.main.x + site.main.w + 1);
  editor.nudgeSelection(100000, 100000);
  assert.equal(room.d, 3000);
  assert.ok(room.z + room.d <= site.main.z + site.main.d + 1);
});
test("连续拖动快照返回原点恢复房间边界关联", () => {
  const room: Room = { id: "A", name: "A", kind: "bed", x: x(2000), z: z(2000), w: 3000, d: 3000, boundary: { key: "old", status: "enclosed" } };
  const { editor } = make([], [room]);
  const live = editor.draft.floors[0]!.rooms[0]!;
  const translate = (editor as unknown as { translateRoom: (r: Room, o: Room, dx: number, dz: number) => void }).translateRoom.bind(editor);
  for (const dx of [500, 1000, 0]) translate(live, room, dx, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(live)), room);
});
test("楼梯方向键同步三层房间及洞口派生位置", () => {
  const draft = clonePublishedLayout();
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} }, draft);
  const old = structuredClone(editor.draft.stairLayout.room);
  editor.selection = { kind: "stair" }; editor.nudgeSelection(10, 10);
  for (const floor of editor.draft.floors) {
    const stair = floor.rooms.find(r => r.kind === "stair")!;
    assert.equal(stair.x, Math.round(old.x + 10));
    assert.equal(stair.z, Math.round(old.z + 10));
  }
});
test("凹形轮廓与稳定关联经JSON及撤销重做保留，外包络编辑拒绝", () => {
  const room: Room = { id: "L", name: "L", kind: "living", x: x(1000), z: z(1000), w: 5000, d: 6000,
    outline: [[x(1000), z(1000)], [x(6000), z(1000)], [x(6000), z(4000)], [x(3000), z(4000)], [x(3000), z(7000)], [x(1000), z(7000)]], boundary: { key: "stable", status: "enclosed" } };
  const { editor } = make([], [room]);
  assert.deepEqual(parseLayoutDraft(draftToJson(editor.draft)).floors[0]!.rooms[0], room);
  editor.selection = { kind: "room", id: "L", floor: 0 };
  editor.updateSelectedNumber("w", 6000);
  assert.deepEqual(editor.draft.floors[0]!.rooms[0], room);
  editor.nudgeSelection(10, 0); editor.undo(); editor.redo();
  assert.equal(editor.draft.floors[0]!.rooms[0]!.outline![0]![0], x(1010));
  assert.equal(editor.draft.floors[0]!.rooms[0]!.boundary, undefined);
});
test("默认三层房间均在本层主体内，二层公卫收回实际南墙", () => {
  const draft = clonePublishedLayout();
  for (const floor of draft.floors) for (const room of floor.rooms) {
    assert.ok(room.x >= site.main.x - 1, room.id);
    assert.ok(room.z >= floor.front - 1, room.id);
    assert.ok(room.x + room.w <= site.main.x + site.main.w + 1, room.id);
    assert.ok(room.z + room.d <= site.main.z + site.main.d + 1, room.id);
  }
  const bathroom = draft.floors[1]!.rooms.find(r => r.id === "bath1")!;
  assert.equal(bathroom.d, 2400);
  const toilet = draft.floors[1]!.furniture.find(f => f.kind === "toilet" && f.x > bathroom.x && f.x < bathroom.x + bathroom.w)!;
  assert.ok(toilet.z + toilet.d / 2 <= site.main.z + site.main.d - 240);
});
test("画墙与拉端点均固定原轴，不吸向离轴墙尖后挪动起点", () => {
  const segs = collectWallSnapSegs([{ a: [4000, 1100], b: [4000, 3000] }]);
  const end = refineWallEnd(1000, 1000, 3950, 1000, [{ x: 4000, z: 1100 }], false, 250, segs);
  assert.equal(end.z, 1000);
});
test("JSON带四角轮廓的矩形房仍受最小尺寸约束，拒绝缩到500", () => {
  const { editor } = make(box());
  editor.generateAutoRooms();
  const room = editor.draft.floors[0]!.rooms[0]!;
  room.outline = [[room.x, room.z], [room.x + room.w, room.z], [room.x + room.w, room.z + room.d], [room.x, room.z + room.d]];
  const before = structuredClone(editor.draft);
  editor.selection = { kind: "wall", index: 1, floor: 0 };
  editor.nudgeSelection(-3500, 0);
  assert.deepEqual(editor.draft, before);
});

test("方向键扩房跨入原不相邻的挑空时，墙房整次回滚", () => {
  const protectedRoom: Room = { id: "void", name: "挑空", kind: "void", x: x(6500), z: z(2500), w: 1000, d: 1000 };
  const { editor, messages } = make(box(), [protectedRoom]);
  editor.generateAutoRooms();
  const before = structuredClone(editor.draft);
  editor.selection = { kind: "wall", index: 1, floor: 0 };
  editor.nudgeSelection(2000, 0);
  assert.deepEqual(editor.draft, before);
  assert.match(messages.at(-1) ?? "", /新增覆盖/);
});

test("手动放置按整个分区检查挑空，点击点在挑空外也不能覆盖", () => {
  const protectedRoom: Room = { id: "void", name: "挑空", kind: "void", x: x(5000), z: z(2500), w: 1000, d: 1000 };
  const { editor, messages } = make(box(), [protectedRoom]);
  editor.placeRoomAt(x(2500), z(3000));
  assert.equal(editor.draft.floors[0]!.rooms.length, 1);
  assert.match(messages.at(-1) ?? "", /新增覆盖/);
});

test("房间坐标输入和方向键平移碰到保护区时家具及轮廓不变", () => {
  const rooms: Room[] = [
    { id: "bed", name: "卧室", kind: "bed", x: x(2000), z: z(2000), w: 2000, d: 2000 },
    { id: "stair", name: "楼梯", kind: "stair", x: x(5000), z: z(2000), w: 2000, d: 2000 },
  ];
  const { editor } = make([], rooms);
  editor.draft.floors[0]!.furniture = [{ kind: "bed", x: x(3000), z: z(3000), w: 1000, d: 1000 }];
  const before = structuredClone(editor.draft);
  editor.selection = { kind: "room", id: "bed", floor: 0 };
  editor.updateSelectedNumber("x", x(4000));
  assert.deepEqual(editor.draft, before);
  editor.nudgeSelection(2000, 0);
  assert.deepEqual(editor.draft, before);
});
