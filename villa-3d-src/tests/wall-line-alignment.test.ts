import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/villa-params.ts";
import { site, type Wall, type Point } from "../src/data.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft, wallAxis } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { parallelWallDistances, snapWallDuringDrag, wallLinePosition } from "../src/layout-align.ts";
import { constrainWallEdits } from "../src/wall-constraints.ts";

const clone = <T>(value: T): T => structuredClone(value);
const x = (v: number) => site.main.x + v;
const z = (v: number) => site.main.z + v;

/** 用户二层过道：上排差7、下排差13，墙端仍在真实墙厚内相接。 */
function corridorWalls(): Wall[] {
  const wall = (a: Point, b: Point, role: Wall["role"] = "bearing"): Wall =>
    ({ a: [x(a[0]), z(a[1])], b: [x(b[0]), z(b[1])], role });
  const walls = [
    wall([4600, 0], [4600, 5500], "virtual"),
    wall([4600, 9880], [4600, 6007]),
    wall([1800, 9880], [1800, 6000], "partition"),
    wall([1800, 6000], [120, 6000], "partition"),
    wall([9100, 4486], [9100, 120]),
    wall([10483, 6000], [10483, 4486]),
    wall([10483, 4486], [13480, 4486]),
    wall([10483, 4486], [9100, 4486]),
    wall([9100, 9880], [9100, 6000]),
    wall([10483, 6000], [13480, 6000]),
    wall([9100, 6000], [10483, 6000]),
    wall([4600, 6007], [9100, 6007]),
    wall([120, 4499], [9100, 4499]),
  ];
  walls[7]!.door = { offset: 248, width: 900, kind: "door", hinge: "end", side: "out" };
  walls[11]!.door = { offset: 208, width: 900, kind: "door", hinge: "start", side: "out" };
  return walls;
}

function setup() {
  const draft = clonePublishedLayout();
  const floor = draft.floors[1]!;
  floor.partitions = corridorWalls();
  floor.rooms = [
    { id: "void", name: "客厅上空", kind: "void", x: x(0), z: z(0), w: 4600, d: 5500 },
    { id: "stair", name: "楼梯", kind: "stair", x: x(1936), z: z(6000), w: 2664, d: 4000 },
    { id: "bath", name: "过道侧房", kind: "bath", x: x(10483), z: z(4486), w: 3117, d: 1514,
      boundary: { key: "exterior:east|wall-11:south|wall-1:east|wall-22:north", status: "enclosed" } },
  ];
  floor.furniture = [];
  const messages: string[] = [];
  const editor = new LayoutEditor({ getFloor: () => 1, redraw: () => {}, toast: text => messages.push(text) }, draft);
  return { editor, messages };
}

test("水平／垂直吸附优先准确墙线，不吞掉7或13毫米的目标，也不吸回自身辅助轴", () => {
  for (const transpose of [false, true]) for (const reverse of [false, true]) {
    const transform = (wall: Wall): Wall => {
      const result = clone(wall);
      if (transpose) { result.a.reverse(); result.b.reverse(); }
      if (reverse) [result.a, result.b] = [result.b, result.a];
      return result;
    };
    const wall = transform({ a: [0, 4096], b: [4000, 4096] });
    const candidate = transform({ a: [5000, 4099], b: [8000, 4099] });
    const guides = snapWallDuringDrag(wall, "move", [candidate], transpose ? { xs: [4096, 4086], zs: [] } : { xs: [], zs: [4096, 4086] });
    assert.equal(wallLinePosition(wall), 4099);
    assert.deepEqual(transpose ? guides.guideXs : guides.guideZs, [4099]);
    assert.equal(Math.hypot(wall.a[0] - wall.b[0], wall.a[1] - wall.b[1]), 4000);
  }
  const wall: Wall = { a: [0, 5605], b: [4000, 5605] };
  snapWallDuringDrag(wall, "move", [{ a: [5000, 5600], b: [8000, 5600] }, { a: [9000, 5607], b: [10000, 5607] }], { xs: [], zs: [] });
  assert.equal(wallLinePosition(wall), 5607);
});

test("超出吸附范围保持手动位置，拉端点仍固定原墙轴线", () => {
  const wall: Wall = { a: [1000, 4100], b: [5000, 4100] }, before = clone(wall);
  assert.deepEqual(snapWallDuringDrag(wall, "move", [{ a: [7000, 4300], b: [9000, 4300] }], { xs: [], zs: [] }), { guideXs: [], guideZs: [] });
  assert.deepEqual(wall, before);
  snapWallDuringDrag(wall, "b", [{ a: [5100, 4200], b: [5100, 6000] }], { xs: [], zs: [] });
  assert.deepEqual(wall, before);
});

test("相接分段同线吸附校正7／13毫米旧偏差，两侧另一排及无关墙保持不动", () => {
  for (const transpose of [false, true]) for (const reverse of [false, true]) {
    const originals = corridorWalls();
    if (transpose) for (const wall of originals) { wall.a.reverse(); wall.b.reverse(); }
    if (reverse) for (const wall of originals) [wall.a, wall.b] = [wall.b, wall.a];
    const walls = clone(originals), normal = transpose ? 0 : 1;
    walls[12]!.a[normal] = walls[12]!.b[normal] = z(4486);
    assert.equal(constrainWallEdits(walls, originals, [12], { wallIndex: 12, target: z(4486) }).ok, true);
    for (const i of [6, 7, 12]) assert.equal(wallLinePosition(walls[i]!), z(4486));
    for (const i of [0, 1, 2, 3, 8, 9, 10, 11]) assert.deepEqual(walls[i], originals[i]);
    assert.deepEqual(walls[7]!.door, originals[7]!.door);
    assert.equal(wallAxis(walls[4]!), transpose ? "h" : "v");
  }
});

test("未启用同线事务的普通移动仍保留墙面接点偏移", () => {
  const originals = corridorWalls(), walls = clone(originals);
  walls[12]!.a[1] += 100; walls[12]!.b[1] += 100;
  assert.equal(constrainWallEdits(walls, originals, [12]).ok, true);
  assert.equal(wallLinePosition(walls[12]!) - wallLinePosition(walls[6]!), 13);
});

test("墙距取投影重叠的最近平行墙，不把近乎同线、垂直或远处短墙当对侧", () => {
  const wall: Wall = { a: [0, 4000], b: [4000, 4000] };
  const candidates: Wall[] = [
    { a: [5000, 4013], b: [8000, 4013] },
    { a: [5000, 4500], b: [8000, 4500] },
    { a: [3000, 0], b: [3000, 8000] },
    { a: [0, 5500], b: [3000, 5500] },
    { a: [0, 6000], b: [4000, 6000] },
    { a: [0, 2000], b: [4000, 2000] },
  ];
  assert.deepEqual(parallelWallDistances(wall, candidates), { low: { at: 2000, distance: 2000 }, high: { at: 5500, distance: 1500 } });
  for (const item of [wall, ...candidates]) { item.a.reverse(); item.b.reverse(); }
  assert.deepEqual(parallelWallDistances(wall, candidates), { low: { at: 2000, distance: 2000 }, high: { at: 5500, distance: 1500 } });
});

test("用户二层先对齐上排再输入1500，两端墙线距均1500，房间／洞口同步且楼梯挑空不动", () => {
  const { editor } = setup();
  const before = clone(editor.draft), originalWalls = clone(before.floors[1]!.partitions);
  editor.selection = { kind: "wall", floor: 1, index: 11 };
  editor.alignSelectedWallLine();
  editor.selection = { kind: "wall", floor: 1, index: 12 };
  assert.equal(editor.updateSelectedNumber("wallDistanceHigh", 1500), true);
  const walls = editor.draft.floors[1]!.partitions;
  for (const i of [3, 9, 10, 11]) assert.equal(wallLinePosition(walls[i]!), z(6000));
  for (const i of [6, 7, 12]) assert.equal(wallLinePosition(walls[i]!), z(4500));
  assert.equal(wallLinePosition(walls[9]!) - wallLinePosition(walls[6]!), 1500);
  assert.equal(wallLinePosition(walls[3]!) - wallLinePosition(walls[12]!), 1500);
  assert.deepEqual(walls[7]!.door, originalWalls[7]!.door);
  assert.deepEqual(walls[11]!.door, originalWalls[11]!.door);
  for (const id of ["void", "stair"]) assert.deepEqual(editor.draft.floors[1]!.rooms.find(r => r.id === id), before.floors[1]!.rooms.find(r => r.id === id));
  const bath = editor.draft.floors[1]!.rooms.find(r => r.id === "bath")!;
  assert.equal(bath.z, z(4500)); assert.equal(bath.d, 1500);
  assert.match(editor.inspectorHtml(), /data-edit-field="wallDistanceHigh"[^>]*value="1500"/);
  assert.match(editor.inspectorHtml(), /净宽需再扣两侧各半墙厚/);
  const result = clone(editor.draft);
  editor.undo(); editor.undo();
  assert.deepEqual(editor.draft.floors[1]!.partitions, originalWalls);
  editor.redo(); editor.redo();
  assert.deepEqual(editor.draft.floors[1]!.partitions, result.floors[1]!.partitions);
  assert.deepEqual(parseLayoutDraft(draftToJson(editor.draft)).floors[1]!.partitions, result.floors[1]!.partitions);
});

test("精确墙线定位可将整排同时移动，超出包络或无效墙距整次回滚", () => {
  const { editor, messages } = setup();
  editor.selection = { kind: "wall", floor: 1, index: 12 };
  assert.equal(editor.updateSelectedNumber("wallPosition", z(4500)), true);
  for (const i of [6, 7, 12]) assert.equal(wallLinePosition(editor.draft.floors[1]!.partitions[i]!), z(4500));
  const before = clone(editor.draft);
  assert.equal(editor.updateSelectedNumber("wallPosition", z(-5000)), undefined);
  assert.deepEqual(editor.draft, before);
  assert.equal(editor.updateSelectedNumber("wallDistanceHigh", 0), undefined);
  assert.deepEqual(editor.draft, before);
  assert.match(messages.at(-1)!, /有效墙线距/);
});

test("墙线按钮仅处理附近同向墙，找不到时保留几何和撤销栈", () => {
  const { editor, messages } = setup();
  editor.selection = { kind: "wall", floor: 1, index: 0 };
  const before = clone(editor.draft);
  editor.alignSelectedWallLine();
  // 同X的北侧短墙在千毫米之外；当前这条墙本身已经是该X，因此允许同线原地校正。
  assert.deepEqual(editor.draft.floors[1]!.partitions, before.floors[1]!.partitions);
  editor.draft.floors[1]!.partitions = [{ a: [x(1000), z(1000)], b: [x(3000), z(1000)] }];
  editor.selection = { kind: "wall", floor: 1, index: 0 };
  const isolated = clone(editor.draft);
  editor.alignSelectedWallLine();
  assert.deepEqual(editor.draft, isolated);
  assert.match(messages.at(-1)!, /没有同向墙线/);
});
