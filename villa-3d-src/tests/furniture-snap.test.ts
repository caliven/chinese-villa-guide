import assert from "node:assert/strict";
import { test } from "node:test";
import { construction, site, type Furniture, type Wall } from "../src/data.ts";
import { snapFurnitureDuringDrag, furnitureWorldBounds } from "../src/layout-align.ts";
import { furnitureLocalBounds, furnitureLocalToWorld } from "../src/furniture-catalog.ts";
import { polygonIntersectionAreaMm2 } from "../src/plan-regions.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";

const item = (x: number, z: number, rotation = 0): Furniture => ({ kind: "cabinet", x, z, w: 600, d: 800, rotation });
const outline = (f: Furniture): [number, number][] => {
  const b = furnitureLocalBounds(f);
  return [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]].map(([x, z]) => {
    const p = furnitureLocalToWorld(x!, z!, f); return [p.x, p.z];
  });
};
const overlap = (a: Furniture, b: Furniture) => polygonIntersectionAreaMm2(outline(a), outline(b));
const snap = (f: Furniture, walls: Wall[], furniture: Furniture[] = [], previous?: { x: number; z: number }) =>
  snapFurnitureDuringDrag(f, [3000], [3000], { partitions: walls, collisionWalls: walls, furniture, previous, allowCenter: false });

test("未成房区域家具吸附实体墙面而非墙中线，承重和隔墙按各自厚度", () => {
  for (const role of ["bearing", "partition"] as const) for (const side of [-1, 1]) {
    const half = (role === "bearing" ? construction.outsideWall : construction.partition) / 2;
    const f = item(3000 + side * (half + 300 + 50), 1800);
    snap(f, [{ a: [3000, 0], b: [3000, 5000], role }]);
    const b = furnitureWorldBounds(f);
    assert.ok(Math.abs((side < 0 ? b.x1 : b.x0) - (3000 + side * (half + 20))) <= 1);
  }
});

test("墙带内拖动保留原侧，不将室内家具推出外墙", () => {
  const f = item(3100, 2000), previous = { x: 2000, z: 2000 };
  snap(f, [{ a: [3000, 0], b: [3000, 5000], role: "bearing" }], [], previous);
  assert.ok(furnitureWorldBounds(f).x1 <= 3000 - construction.outsideWall / 2 - 20);
});

test("原稿已有压墙且指针刚过中线时，不能被邻房归属拉到墙另一侧", () => {
  const wall: Wall = { a: [3000, 0], b: [3000, 5000], role: "bearing" };
  const f = item(2980, 2000);
  snapFurnitureDuringDrag(f, [], [], { collisionWalls: [wall], partitions: [wall], previous: { x: 3300, z: 2000 },
    room: { id: "left", name: "左室", kind: "living", x: 0, z: 0, w: 3000, d: 5000 } });
  assert.ok(furnitureWorldBounds(f).x0 >= 3000 + construction.outsideWall / 2 + 20);
});

test("无房间归属的两件家具可以贴边并排，前沿同时自动对齐", () => {
  const peer = item(2000, 2000), f = item(2640, 2060);
  const guides = snap(f, [], [peer, f]);
  assert.equal(overlap(f, peer), 0);
  assert.equal(furnitureWorldBounds(f).x0, furnitureWorldBounds(peer).x1);
  assert.equal(furnitureWorldBounds(f).z0, furnitureWorldBounds(peer).z0);
  assert.ok(guides.guideXs.includes(2300));
  assert.ok(guides.guideZs.includes(1600));
});

test("拖入另一件家具会退到最近空位，旋转占地也不重叠", () => {
  for (const rotation of [0, Math.PI / 2, Math.PI / 4]) {
    const peer = item(2000, 2000, rotation), f = item(2080, 2000, -rotation);
    snap(f, [], [peer, f]);
    assert.ok(overlap(f, peer) < 0.01);
    assert.ok(Math.hypot(f.x - 2080, f.z - 2000) < 1000);
  }
});

test("旋转家具的包络相交但实际占地分离时不误推开", () => {
  const peer = item(2000, 2000, Math.PI / 4), f = item(2600, 2600, Math.PI / 4);
  const before = { ...f };
  assert.equal(overlap(f, peer), 0);
  const a = furnitureWorldBounds(f), b = furnitureWorldBounds(peer);
  assert.ok(a.x0 < b.x1 && a.z0 < b.z1);
  snap(f, [], [peer, f]);
  assert.deepEqual(f, before);
});

test("墙角及紧邻家具同时避让，不能从家具推出后又压入墙", () => {
  const walls: Wall[] = [
    { a: [0, 0], b: [0, 5000], role: "bearing" },
    { a: [0, 0], b: [5000, 0], role: "bearing" },
  ];
  const peer = item(450, 550), f = item(350, 450);
  snap(f, walls, [peer, f], { x: 1500, z: 1500 });
  const b = furnitureWorldBounds(f);
  assert.ok(b.x0 >= construction.outsideWall / 2 + 20);
  assert.ok(b.z0 >= construction.outsideWall / 2 + 20);
  assert.equal(overlap(f, peer), 0);
});

test("虚拟分界不阻挡，远处有限墙段不产生隔空吸附", () => {
  for (const walls of [
    [{ a: [3000, 0], b: [3000, 5000], role: "virtual" }],
    [{ a: [3000, 8000], b: [3000, 10000], role: "bearing" }],
  ] as Wall[][]) {
    const f = item(2700, 2000), original = { ...f };
    snap(f, walls);
    assert.deepEqual(f, original);
  }
});

function editorDraft() {
  const draft = clonePublishedLayout();
  for (const floor of draft.floors) Object.assign(floor, { rooms: [], furniture: [], partitions: [] });
  draft.annexRooms = []; draft.annexFurniture = []; draft.annexPartitions = [];
  return draft;
}

test("共享2D/3D移动入口包含主辅楼真实外墙厚度，撤销重做保留吸附位置", () => {
  for (const annex of [false, true]) {
    const draft = editorDraft(), body = annex ? site.annex : site.main;
    const list = annex ? draft.annexFurniture : draft.floors[0].furniture;
    list.push(item(body.x + 1200, body.z + 2000));
    const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} }, draft);
    const selection = { kind: "furniture" as const, floor: 0, index: 0, annex };
    const beforePreview = structuredClone(editor.draft);
    const preview = editor.previewFurniturePosition(selection, body.x + 300, body.z + 2000);
    assert.deepEqual(editor.draft, beforePreview, "三维拖动预览不能改草稿或撤销栈");
    assert.ok(furnitureWorldBounds({ ...list[0]!, ...preview }).x0 >= body.x + construction.outsideWall + 20);
    editor.moveFurnitureTo(selection, body.x + 300, body.z + 2000);
    const current = () => (annex ? editor.draft.annexFurniture : editor.draft.floors[0].furniture)[0]!;
    const after = { ...current() };
    assert.ok(furnitureWorldBounds(after).x0 >= body.x + construction.outsideWall + 20);
    editor.undo(); assert.equal(current().x, body.x + 1200);
    editor.redo(); assert.deepEqual(current(), after);
  }
});

test("关闭磁吸时保留手动移动语义，不强行重排家具", () => {
  const draft = editorDraft();
  draft.floors[0].furniture = [item(site.main.x + 2000, site.main.z + 2000), item(site.main.x + 3000, site.main.z + 2000)];
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} }, draft);
  editor.magnetSnap = false;
  editor.moveFurnitureTo({ kind: "furniture", floor: 0, index: 1 }, site.main.x + 2000, site.main.z + 2000);
  assert.equal(editor.draft.floors[0].furniture[1]!.x, site.main.x + 2000);
});

test("主辅楼非承重墙均画在承重墙下方，排序不改原始点选与选中索引", () => {
  const draft = editorDraft();
  for (const annex of [false, true]) {
    const body = annex ? site.annex : site.main;
    const walls: Wall[] = [
      { a: [body.x + 1000, body.z + 2000], b: [body.x + 3000, body.z + 2000], role: "bearing" },
      { a: [body.x + 2000, body.z + 1000], b: [body.x + 2000, body.z + 2000], role: "partition" },
    ];
    if (annex) draft.annexPartitions = walls; else draft.floors[0].partitions = walls;
    const svg = floorPlan(0, false, false, { editable: true, editorCanvas: true,
      selected: { kind: "wall", index: 1, floor: 0, annex } }, planSourceFromDraft(draft, 0));
    const offset = annex ? 1000 : 0;
    assert.ok(svg.indexOf(`data-wall="${offset + 1}" data-wall-role="partition"`) < svg.indexOf(`data-wall="${offset}" data-wall-role="bearing"`));
    assert.ok(svg.includes(`data-end="a" data-index="${offset + 1}"`));
    assert.deepEqual(walls.map(w => w.role), ["bearing", "partition"]);
  }
});
