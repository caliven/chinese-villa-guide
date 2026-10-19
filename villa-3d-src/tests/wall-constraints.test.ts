import assert from "node:assert/strict";
import { test } from "node:test";
import type { Wall } from "../src/data.ts";
import { forceOrthoWall, setWallLength } from "../src/layout-draft.ts";
import { constrainWallEdits, reconcileWallOpening } from "../src/wall-constraints.ts";

const clone = <T>(value: T): T => structuredClone(value);

test("连续拖墙始终以拖前拓扑跟随，拖回原点完整还原", () => {
  const originals: Wall[] = [
    { a: [1000, 1000], b: [5000, 1000] },
    { a: [3000, 1000], b: [3000, 4000] },
  ];
  const walls = clone(originals);
  for (const displacement of [100, 250, 500, 0]) {
    walls[0]!.a = [1000, 1000 + displacement];
    walls[0]!.b = [5000, 1000 + displacement];
    assert.deepEqual(constrainWallEdits(walls, originals, [0]), { ok: true });
    assert.deepEqual(walls[1]!.a, [3000, 1000 + displacement]);
    assert.deepEqual(walls[1]!.b, originals[1]!.b);
  }
  assert.deepEqual(walls, originals);
});

test("拉 L 角端点时相邻墙整体侧移，保持其远端正交", () => {
  const originals: Wall[] = [
    { a: [1000, 4000], b: [5000, 4000] },
    { a: [1000, 1000], b: [1000, 4000] },
  ];
  const walls = clone(originals);
  walls[0]!.a[0] += 500;
  assert.equal(constrainWallEdits(walls, originals, [0]).ok, true);
  assert.deepEqual(walls[1], { a: [1500, 1000], b: [1500, 4000] });
});

test("L 接点位移传播到下一段墙，T 接点沿主墙自由滑移", () => {
  const originals: Wall[] = [
    { a: [1000, 4000], b: [5000, 4000] },
    { a: [1000, 1000], b: [1000, 4000] },
    { a: [1000, 1000], b: [5000, 1000] },
    { a: [3000, 4000], b: [3000, 7000] },
  ];
  const walls = clone(originals);
  walls[0]!.a[0] += 500;
  walls[0]!.b[0] += 500;
  assert.equal(constrainWallEdits(walls, originals, [0]).ok, true);
  assert.deepEqual(walls[2], { a: [1500, 1000], b: [5000, 1000] });
  assert.deepEqual(walls[3], originals[3]);
});

test("只认可真实实体接触，80 mm 空隙不会牵动相邻墙", () => {
  const originals: Wall[] = [
    { a: [1000, 1000], b: [5000, 1000] },
    { a: [3000, 1140], b: [3000, 4000] },
    { a: [4000, 1060], b: [4000, 4000] },
  ];
  const walls = clone(originals);
  walls[0]!.a[1] += 200;
  walls[0]!.b[1] += 200;
  assert.equal(constrainWallEdits(walls, originals, [0]).ok, true);
  assert.deepEqual(walls[1], originals[1]);
  assert.deepEqual(walls[2]!.a, [4000, 1260]);
});

test("虚拟分界线无实体厚度，近墙但不接触时不被联动", () => {
  const originals: Wall[] = [
    { a: [1000, 1000], b: [5000, 1000], role: "virtual" },
    { a: [3000, 1060], b: [3000, 4000] },
  ];
  const walls = clone(originals);
  walls[0]!.a[1] += 200;
  walls[0]!.b[1] += 200;
  assert.equal(constrainWallEdits(walls, originals, [0]).ok, true);
  assert.deepEqual(walls[1], originals[1]);
});

test("共线分段的公共端点联动，远端留在原位", () => {
  const originals: Wall[] = [
    { a: [0, 0], b: [2000, 0] },
    { a: [2000, 0], b: [5000, 0] },
  ];
  const walls = clone(originals);
  walls[0]!.b[0] = 2500;
  assert.equal(constrainWallEdits(walls, originals, [0]).ok, true);
  assert.deepEqual(walls[1], { a: [2500, 0], b: [5000, 0] });
});

test("两侧矛盾的直接编辑整次拒绝，不写坏传入数组", () => {
  const originals: Wall[] = [
    { a: [1000, 1000], b: [5000, 1000] },
    { a: [1000, 1000], b: [1000, 4000] },
    { a: [1000, 4000], b: [5000, 4000] },
  ];
  const walls = clone(originals);
  walls[0]!.a[0] += 500;
  walls[2]!.a[0] += 700;
  const before = clone(walls);
  assert.equal(constrainWallEdits(walls, originals, [0, 2]).ok, false);
  assert.deepEqual(walls, before);
});

test("缩短主墙不可静默丢失原 T 接点，也不能把邻墙拉过另一端", () => {
  const originals: Wall[] = [
    { a: [1000, 1000], b: [5000, 1000] },
    { a: [3000, 1000], b: [3000, 4000] },
  ];
  const shortened = clone(originals);
  shortened[0]!.b[0] = 2000;
  assert.equal(constrainWallEdits(shortened, originals, [0]).ok, false);
  const crossed = clone(originals);
  crossed[0]!.a[1] = 5000;
  crossed[0]!.b[1] = 5000;
  assert.equal(constrainWallEdits(crossed, originals, [0]).ok, false);
});

test("门洞超出缩短墙时保留原宽并限位，拖回可还原原洞口位置", () => {
  const originals: Wall[] = [{
    a: [0, 0], b: [5000, 0],
    door: { offset: 3000, width: 900, kind: "door", hinge: "end", side: "in" },
  }];
  const walls = clone(originals);
  walls[0]!.b[0] = 2000;
  assert.equal(constrainWallEdits(walls, originals, [0]).ok, true);
  assert.equal(walls[0]!.door!.width, 900);
  assert.equal(walls[0]!.door!.offset, 1100);
  walls[0]!.b[0] = 5000;
  assert.equal(constrainWallEdits(walls, originals, [0]).ok, true);
  assert.deepEqual(walls, originals);
});

test("墙长容不下原门洞时拒绝，洞宽不被自动缩小", () => {
  const original: Wall = { a: [0, 0], b: [5000, 0], door: { offset: 3000, width: 900 } };
  const wall = clone(original);
  wall.b = [800, 0];
  const before = clone(wall);
  assert.equal(reconcileWallOpening(wall, original).ok, false);
  assert.deepEqual(wall, before);
  assert.equal(constrainWallEdits([wall], [original], [0]).ok, false);
});

test("反转墙端点同时转换洞口定位、铰链和开向，世界位置不跳变", () => {
  const original: Wall = {
    a: [1000, 2000], b: [6000, 2000],
    door: { offset: 1000, width: 900, kind: "door", hinge: "start", side: "out" },
  };
  const wall = clone(original);
  [wall.a, wall.b] = [wall.b, wall.a];
  assert.equal(constrainWallEdits([wall], [original], [0]).ok, true);
  assert.deepEqual(wall.door, { offset: 3100, width: 900, kind: "door", hinge: "end", side: "in" });
  const oldHinge = original.a[0] + original.door!.offset;
  const newHinge = wall.a[0] - (wall.door!.offset + wall.door!.width);
  assert.equal(oldHinge, newHinge);
});

test("已连接墙反转端点仅改变表达方向，不牵动相邻墙", () => {
  const originals: Wall[] = [
    { a: [1000, 1000], b: [5000, 1000] },
    { a: [1000, 1000], b: [1000, 4000] },
  ];
  const walls = clone(originals);
  [walls[0]!.a, walls[0]!.b] = [walls[0]!.b, walls[0]!.a];
  assert.equal(constrainWallEdits(walls, originals, [0]).ok, true);
  assert.deepEqual(walls[1], originals[1]);
  assert.deepEqual(walls[0], { a: [5000, 1000], b: [1000, 1000] });
});

test("居中修改反向墙长度保留 a 到 b 方向及门开向", () => {
  for (const original of [
    { a: [5000, 0], b: [0, 0] },
    { a: [0, 5000], b: [0, 0] },
  ] as Wall[]) {
    original.door = { offset: 1000, width: 900, hinge: "start", side: "out" };
    const wall = clone(original);
    setWallLength(wall, 3000, "center");
    const coordinate = original.a[0] !== original.b[0] ? 0 : 1;
    assert.equal(wall.a[coordinate], 4000);
    assert.equal(wall.b[coordinate], 1000);
    assert.deepEqual(wall.door, original.door);
  }
});

test("数值缩墙保护原洞宽，拖端点正交可明确保留固定端", () => {
  const wall: Wall = { a: [0, 0], b: [3000, 0], door: { offset: 1000, width: 900 } };
  const original = clone(wall);
  setWallLength(wall, 500);
  assert.deepEqual(wall, original);
  const tip: Wall = { a: [1000, 1000], b: [4500, 1100] };
  forceOrthoWall(tip, "a");
  assert.deepEqual(tip, { a: [1000, 1000], b: [4500, 1000] });
});
