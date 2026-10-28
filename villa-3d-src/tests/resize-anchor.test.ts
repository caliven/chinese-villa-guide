import assert from "node:assert/strict";
import { test } from "node:test";
import { construction, site, type Furniture } from "../src/data.ts";
import { clonePublishedLayout, ensureStairRooms } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { furnitureWorldBounds } from "../src/layout-align.ts";
import { anchorResizedBox } from "../src/resize-anchor.ts";
import { fitStairToRoom } from "../src/stair-geometry.ts";

function setup(floor = 0) {
  const draft = clonePublishedLayout(), messages: string[] = [];
  for (const f of draft.floors) Object.assign(f, { partitions: [], rooms: [], furniture: [] });
  draft.annexPartitions = []; draft.annexFurniture = [];
  const editor = new LayoutEditor({ getFloor: () => floor, redraw: () => {}, toast: s => messages.push(s) }, draft);
  return { editor, draft: editor.draft, messages };
}
const pad = construction.outsideWall + 20;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1, `${a} != ${b}`);

test("无靠墙家具改尺寸保持真实中心；圆桌宽深联动不偏移", () => {
  for (const kind of ["bed", "roundTable"] as const) {
    const { editor, draft } = setup();
    const f: Furniture = { kind, x: site.main.x + 6000, z: site.main.z + 5000, w: 1000, d: 1000 };
    draft.floors[0].furniture = [f];
    editor.selection = { kind: "furniture", floor: 0, index: 0 };
    editor.updateSelectedNumber("w", 1800);
    assert.equal(f.x, site.main.x + 6000); assert.equal(f.z, site.main.z + 5000);
    assert.equal(f.w, 1800);
  }
});

test("主辅楼、三层家具四侧贴墙改宽深，旋转包络仍留在外墙内", () => {
  for (const annex of [false, true]) for (const floor of [0, 2]) for (const rotation of [0, Math.PI / 2, Math.PI / 4]) {
    const { editor, draft } = setup(floor);
    const body = annex ? site.annex : { ...site.main, z: draft.floors[floor].front, d: site.main.z + site.main.d - draft.floors[floor].front };
    for (const side of ["west", "east", "north", "south"] as const) {
      const f: Furniture = { kind: "wardrobe", x: body.x + body.w / 2, z: body.z + body.d / 2, w: 800, d: 600, rotation };
      const b = furnitureWorldBounds(f);
      if (side === "west") f.x += body.x + pad - b.x0;
      if (side === "east") f.x += body.x + body.w - pad - b.x1;
      if (side === "north") f.z += body.z + pad - b.z0;
      if (side === "south") f.z += body.z + body.d - pad - b.z1;
      if (annex) draft.annexFurniture = [f]; else draft.floors[floor].furniture = [f];
      editor.selection = { kind: "furniture", floor, index: 0, annex };
      for (const size of [1200, 700]) {
        editor.updateSelectedNumber("w", size);
        const box = furnitureWorldBounds(f);
        if (side === "west") close(box.x0, body.x + pad);
        if (side === "east") close(box.x1, body.x + body.w - pad);
        if (side === "north") close(box.z0, body.z + pad);
        if (side === "south") close(box.z1, body.z + body.d - pad);
        assert.ok(box.x0 >= body.x + pad - 1 && box.x1 <= body.x + body.w - pad + 1);
        assert.ok(box.z0 >= body.z + pad - 1 && box.z1 <= body.z + body.d - pad + 1);
      }
    }
  }
});

test("家具改深贴真实内墙面；超出两墙净距拒绝且撤销恢复原规格", () => {
  const { editor, draft, messages } = setup();
  const x = site.main.x + 4000, z = site.main.z + 3000;
  draft.floors[0].partitions = [
    { a: [x - 2000, z], b: [x + 2000, z], role: "partition" },
    { a: [x - 2000, z + 3000], b: [x + 2000, z + 3000], role: "partition" },
  ];
  const face = z + construction.partition / 2 + 20;
  const f: Furniture = { kind: "wardrobe", x, z: face + 300, w: 1000, d: 600 };
  draft.floors[0].furniture = [f];
  editor.selection = { kind: "furniture", floor: 0, index: 0 };
  editor.updateSelectedNumber("d", 600);
  editor.updateSelectedNumber("d", 1000);
  close(furnitureWorldBounds(f).z0, face);
  const before = structuredClone(f);
  editor.updateSelectedNumber("d", 4000);
  assert.deepEqual(f, before); assert.match(messages.at(-1)!, /放不下/);
  editor.undo(); assert.equal(editor.draft.floors[0].furniture[0].d, 600);
  editor.redo(); assert.equal(editor.draft.floors[0].furniture[0].d, 1000);
});

test("墙长输入锁住原靠墙端，正反端序及洞口保留，过长不越外墙", () => {
  for (const reverse of [false, true]) {
    const { editor, draft, messages } = setup();
    const x = site.main.x, z = site.main.z;
    const a: [number, number] = [x + site.main.w - 3000, z + 4000];
    const b: [number, number] = [x + site.main.w, z + 4000];
    draft.floors[0].partitions = [{ a: reverse ? b : a, b: reverse ? a : b, door: { offset: 300, width: 900, kind: "door" } }];
    editor.selection = { kind: "wall", floor: 0, index: 0 };
    editor.updateSelectedNumber("length", 5000);
    const wall = draft.floors[0].partitions[0];
    close(Math.max(wall.a[0], wall.b[0]), b[0]); close(Math.abs(wall.a[0] - wall.b[0]), 5000);
    assert.equal(wall.door!.width, 900);
    editor.updateSelectedNumber("length", 20000);
    close(Math.abs(wall.a[0] - wall.b[0]), 5000); assert.match(messages.at(-1)!, /放不下/);
  }
});

test("楼梯四侧改梯间尺寸保留贴墙边，三层洞口同步且可撤销", () => {
  for (const side of ["west", "east", "north", "south"] as const) {
    const { editor, draft } = setup();
    const front = Math.max(...draft.floors.map(f => f.front)), back = site.main.z + site.main.d;
    const r = { x: site.main.x + 4000, z: front + 2000, w: 3000, d: 3000 };
    if (side === "west") r.x = site.main.x;
    if (side === "east") r.x = site.main.x + site.main.w - r.w;
    if (side === "north") r.z = front;
    if (side === "south") r.z = back - r.d;
    draft.stairLayout.room = r; ensureStairRooms(draft);
    editor.selection = { kind: "stair" };
    for (const size of [4000, 2600]) {
      editor.updateSelectedNumber(side === "west" || side === "east" ? "roomW" : "roomD", size);
      if (side === "west") close(r.x, site.main.x);
      if (side === "east") close(r.x + r.w, site.main.x + site.main.w);
      if (side === "north") close(r.z, front);
      if (side === "south") close(r.z + r.d, back);
      const fitted = fitStairToRoom(draft.stairLayout, draft.floors);
      assert.ok(fitted.x >= site.main.x && fitted.z >= front);
      for (const f of draft.floors) assert.deepEqual(f.rooms.find(r => r.kind === "stair")!.w, r.w);
    }
    editor.undo(); close(editor.draft.stairLayout.room.w + editor.draft.stairLayout.room.d, 7000);
  }
});

test("楼梯踏步改宽保持靠外墙位置；尺寸无法容纳时整次回滚", () => {
  const { editor, draft, messages } = setup();
  const s = draft.stairLayout;
  s.axis = "z";
  s.room = { x: site.main.x + site.main.w - 2600, z: site.main.z + 3000, w: 2600, d: 3500 };
  ensureStairRooms(draft); editor.selection = { kind: "stair" };
  editor.updateSelectedNumber("flight", 1400);
  close(fitStairToRoom(s, draft.floors).flight, 1400);
  close(s.room.x + s.room.w, site.main.x + site.main.w);
  const before = structuredClone(s);
  editor.updateSelectedNumber("roomW", 20000);
  assert.deepEqual(s, before); assert.match(messages.at(-1)!, /放不下/);
});

test("缩放固定角越界时平移回墙内；远墙不吸引、虚拟线不挡尺寸、室外家具不入屋", () => {
  const body = { x: 0, z: 0, w: 10000, d: 8000 };
  const old = { x: 7000, z: 4000, w: 1500, d: 1000 };
  const near = anchorResizedBox(old, { ...old, w: 4000 }, body, [], { gap: 120 });
  assert.deepEqual(near, { ...old, x: 6000, w: 4000 });
  const small = { ...old, w: 1000 };
  assert.deepEqual(anchorResizedBox(old, small, body, [{ a: [7500, 0], b: [7500, 8000], role: "virtual" }], { gap: 120 }), small);
  const outside = { x: -3000, z: 4000, w: 1000, d: 1000 };
  assert.deepEqual(anchorResizedBox(outside, { ...outside, w: 1800 }, body, [], { gap: 120 }), { ...outside, w: 1800 });
});
