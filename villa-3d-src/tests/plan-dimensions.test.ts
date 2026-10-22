import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { site, type Room, type Wall } from "../src/data.ts";
import { clonePublishedLayout, ensureStairRooms, removeStairFromDraft, type LayoutDraft } from "../src/layout-draft.ts";
import { collectPlanDimensions, collectPlanSiteDimensions, planDimMm, planDimSpanMm } from "../src/plan-dimensions.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { collectRoomSnapAxes, translateFurnitureInsideRoom, translateOwnedWallsWithRoom } from "../src/layout-align.ts";

const dims = (draft: LayoutDraft, i = 0) => collectPlanDimensions(i, draft.floors[i]!, draft.annexPartitions);
const spans = (values: number[]) => values.slice(1).map((v, i) => planDimSpanMm(values[i]!, v));
const host = { getFloor: () => 0, redraw: () => {}, toast: () => {} };
const x = (offset: number) => site.main.x + offset;
const z = (offset: number) => site.main.z + offset;

function buildingSvg(html: string, building: string) {
  const svg = html.match(new RegExp(`<svg data-plan-building="${building}"[\\s\\S]*?</svg>`))?.[0];
  assert.ok(svg, `${building} 图纸应存在`);
  return svg;
}

function renderedChain(svg: string, side: string, kind: string) {
  const body = svg.match(new RegExp(`<g data-dim-side="${side}" data-dim-kind="${kind}">([\\s\\S]*?)</g>`))?.[1];
  assert.ok(body, `${side}/${kind} 尺寸链应存在`);
  return [...body.matchAll(/class="dim-mm"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
}

test("拆图后房间内偏120mm、墙端偏10mm不污染主楼外轮廓总宽；门头侧保留柱心控制档", () => {
  const draft = clonePublishedLayout();
  const tea = draft.floors[0]!.rooms.find((r) => r.id === "tea")!;
  tea.x -= 120;
  draft.floors[0]!.partitions[0]!.a[0] -= 10;
  const svg = floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0));
  const main = buildingSvg(svg, "main");
  // 门厅柱心控制在北侧（门头朝下时画面下方）：左余 4500＋柱心距 4600＋右余 4500。
  assert.deepEqual(renderedChain(main, "north", "control"), [4500, 4600, 4500]);
  assert.deepEqual(renderedChain(main, "north", "overall"), [13600]);
  // 总宽只标北侧，南侧不再重复。
  assert.ok(!main.includes('data-dim-side="south" data-dim-kind="overall"'));
});

test("三层楼梯移位与拉伸只改楼梯框，外部尺寸不变", () => {
  const draft = clonePublishedLayout();
  const before = draft.floors.map((_, i) => dims(draft, i));
  Object.assign(draft.stairLayout.room, { x: x(6120), z: z(5740), w: 2800, d: 4200 });
  ensureStairRooms(draft);
  for (let i = 0; i < 3; i++) {
    const after = dims(draft, i);
    for (const key of ["controls", "northXs", "southXs", "eastZs", "westZs", "annexZs"] as const) {
      assert.deepEqual(after[key], before[i]![key], `第${i + 1}层 ${key}`);
    }
  }
});

test("楼梯旁18mm偏差不生成碎档，外侧链只定位用户墙线", () => {
  const draft = clonePublishedLayout();
  Object.assign(draft.stairLayout.room, { x: x(6800), z: z(5800), w: 2900, d: 4200 });
  ensureStairRooms(draft);
  for (const floor of draft.floors) floor.partitions = [
    { a: [x(6782), z(5800)], b: [x(6782), z(10000)], role: "bearing" },
  ];
  for (let i = 0; i < 3; i++) {
    const svg = buildingSvg(floorPlan(i, false, false, {}, planSourceFromDraft(draft, i)), "main");
    assert.deepEqual(renderedChain(svg, "south", "walls"), [6782, 6818]);
    assert.deepEqual(renderedChain(svg, "north", "overall"), [13600]);
    assert.ok(svg.includes("梯间 2900×4200"));
  }
});

test("任意房间／套卫／辅楼房间框改变而墙不动时，墙线定位也不变", () => {
  const draft = clonePublishedLayout();
  const before = dims(draft);
  for (const r of [...draft.floors[0]!.rooms, ...draft.annexRooms]) {
    r.x += 120; r.z += 100; r.w -= 300; r.d += 400;
  }
  const after = dims(draft);
  for (const key of ["controls", "northXs", "southXs", "eastZs", "westZs", "annexZs"] as const) {
    assert.deepEqual(after[key], before[key]);
  }
});

test("真实贴南墙内墙移动只更新南侧定位，外轮廓与立面控制不变", () => {
  const draft = clonePublishedLayout();
  draft.floors[0]!.partitions = [{ a: [x(4500), z(6000)], b: [x(4500), z(10000)] }];
  const before = dims(draft);
  draft.floors[0]!.partitions[0]!.a[0] += 700;
  draft.floors[0]!.partitions[0]!.b[0] += 700;
  const after = dims(draft);
  assert.deepEqual(after.controls, before.controls);
  assert.deepEqual(after.northXs, before.northXs);
  assert.equal(after.southDetail, true);
  assert.ok(after.southXs.includes(x(5200)));
  assert.ok(!after.southXs.includes(x(4500)));
});

test("接外墙内墙仍标墙距，换到另一控制线也更新；门厅柱心与总宽保留", () => {
  const draft = clonePublishedLayout();
  removeStairFromDraft(draft); // 去掉梯间宽度档，只验墙线定位
  const wall: Wall = { a: [x(4500), z(7000)], b: [x(4500), z(10000)] };
  draft.floors[0]!.partitions = [wall];
  const render = () => buildingSvg(floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0)), "main");
  assert.deepEqual(renderedChain(render(), "south", "walls"), [4500, 9100]);
  wall.a[0] = wall.b[0] = x(9100);
  assert.deepEqual(renderedChain(render(), "south", "walls"), [9100, 4500]);
  assert.deepEqual(renderedChain(render(), "north", "overall"), [13600]);
  assert.deepEqual(renderedChain(render(), "north", "control"), [4500, 4600, 4500]);
});

test("贯通实体墙在相交两侧均保留定位及闭合尺寸链", () => {
  const draft = clonePublishedLayout();
  removeStairFromDraft(draft);
  draft.floors[0]!.partitions = [
    { a: [x(4500), z(0)], b: [x(4500), z(10000)] }, // 贯通南北 → 南北均标
    { a: [x(0), z(4000)], b: [x(13600), z(4000)] }, // 贯通东西 → 东西均标
  ];
  const result = dims(draft);
  assert.ok(result.southXs.includes(x(4500)));
  assert.ok(result.northXs.includes(x(4500)));
  assert.ok(result.westZs.includes(z(4000)));
  assert.ok(result.eastZs.includes(z(4000)));
  const svg = buildingSvg(floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0)), "main");
  assert.ok(svg.includes('data-dim-side="south" data-dim-kind="walls"'));
  assert.deepEqual(renderedChain(svg, "north", "walls"), [4500, 9100]);
  assert.ok(svg.includes('data-dim-side="west" data-dim-kind="walls"'));
  assert.deepEqual(renderedChain(svg, "east", "walls"), [4000, 6000]);
  assert.deepEqual(renderedChain(svg, "west", "walls"), [4000, 6000]);
  assert.equal(result.horizontalFrom("north", x(4500)), z(0));
  assert.equal(result.horizontalFrom("south", x(4500)), z(10000));
  assert.equal(result.verticalFrom("east", z(4000)), x(13600));
  assert.equal(result.verticalFrom("west", z(4000)), x(0));
});

test("4700贯通横墙在三层主楼及辅楼两侧均输出定位尺寸", () => {
  const draft = clonePublishedLayout();
  removeStairFromDraft(draft);
  for (const floor of draft.floors) {
    floor.partitions = [{ a: [x(240), z(5300)], b: [x(13360), z(5300)], role: "bearing" }];
  }
  draft.annexPartitions = [{
    a: [site.annex.x + 240, site.annex.z + 4800],
    b: [site.annex.x + site.annex.w - 240, site.annex.z + 4800],
  }];
  for (let i = 0; i < 3; i++) {
    const html = floorPlan(i, false, false, {}, planSourceFromDraft(draft, i));
    const main = buildingSvg(html, "main");
    const expected = [5300 - (draft.floors[i]!.front - site.main.z), 4700];
    assert.deepEqual(renderedChain(main, "east", "walls"), expected);
    assert.deepEqual(renderedChain(main, "west", "walls"), expected);
    if (i === 0) {
      const annex = buildingSvg(html, "annex");
      assert.deepEqual(renderedChain(annex, "east", "walls"), [4800, 3200]);
      assert.deepEqual(renderedChain(annex, "west", "walls"), [4800, 3200]);
    }
  }
});

test("虚拟墙即使接到外墙也不拆外圈墙距；实体墙之间的墙距仍保留", () => {
  const draft = clonePublishedLayout();
  removeStairFromDraft(draft);
  draft.floors[0]!.partitions = [
    { a: [x(4500), z(7000)], b: [x(4500), z(10000)] }, // 实体，接南墙
    { a: [x(7000), z(0)], b: [x(7000), z(10000)], role: "virtual" }, // 虚拟，贯通南北
    { a: [x(0), z(5000)], b: [x(13600), z(5000)], role: "virtual" }, // 虚拟，贯通东西
  ];
  const result = dims(draft);
  assert.ok(result.southXs.includes(x(4500)));
  assert.ok(!result.southXs.includes(x(7000)));
  assert.ok(!result.northXs.includes(x(7000)));
  assert.ok(!result.eastZs.includes(z(5000)));
  assert.ok(!result.westZs.includes(z(5000)));
  const svg = buildingSvg(floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0)), "main");
  assert.deepEqual(renderedChain(svg, "south", "walls"), [4500, 9100]);
});

test("悬空内墙不标宽度；只有真正接到外墙的短墙才贴边定位", () => {
  const draft = clonePublishedLayout();
  removeStairFromDraft(draft);
  draft.floors[0]!.partitions = [
    { a: [x(3000), z(900)], b: [x(3000), z(4500)] }, // 离北外墙 900，悬空
    { a: [x(7000), z(240)], b: [x(7000), z(840)] }, // 接到北外墙内皮
  ];
  const result = dims(draft);
  assert.ok(!result.northXs.includes(x(3000)), "悬空内墙不应投到外圈");
  assert.ok(!result.southXs.includes(x(3000)));
  assert.ok(result.northXs.includes(x(7000)));
  assert.ok(!result.southXs.includes(x(7000)));
  assert.equal(result.horizontalFrom("north", x(7000)), z(240));
  const svg = buildingSvg(floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0)), "main");
  assert.ok(svg.includes('data-dim-kind="walls"'));
  assert.deepEqual(renderedChain(svg, "north", "walls"), [7000, 6600]);
});

test("墙端顺序与拆成短段不改变四侧定位", () => {
  const draft = clonePublishedLayout();
  draft.floors[0]!.partitions = [{ a: [x(0), z(4000)], b: [x(13500), z(4000)] }];
  const before = dims(draft);
  draft.floors[0]!.partitions = Array.from({ length: 9 }, (_, i) => ({
    a: [x((i + 1) * 1500), z(4000)] as [number, number],
    b: [x(i * 1500), z(4000)] as [number, number],
  }));
  assert.deepEqual(dims(draft).eastZs, before.eastZs);
  assert.deepEqual(dims(draft).westZs, before.westZs);
});

test("真实相距80mm的两道墙线在尺寸后端不能被合并或漏写", () => {
  const draft = clonePublishedLayout();
  removeStairFromDraft(draft);
  draft.floors[0]!.partitions = [4500, 4580].map((offset) => ({ a: [x(offset), z(7000)], b: [x(offset), z(10000)] }));
  const xs = dims(draft).southXs;
  assert.ok(xs.includes(x(4500)) && xs.includes(x(4580)));
  assert.equal(planDimSpanMm(x(4500), x(4580)), 80);
  assert.equal(spans(xs).reduce((a, b) => a + b, 0), 13600);
});

test("辅楼只引用辅楼实体墙，房间框与主楼内墙不能改写辅楼总进深", () => {
  const draft = clonePublishedLayout();
  const before = dims(draft);
  draft.annexRooms[0]!.d -= 130;
  draft.floors[0]!.partitions.push({ a: [0, 5000], b: [1000, 5000] });
  assert.deepEqual(dims(draft).annexZs, before.annexZs);
  draft.annexPartitions[0]!.a[1] += 300;
  draft.annexPartitions[0]!.b[1] += 300;
  const after = dims(draft);
  assert.notDeepEqual(after.annexZs, before.annexZs);
  assert.equal(spans(after.annexZs).reduce((a, b) => a + b, 0), 8000);
});

test("主辅楼总宽只标北、总进深只标东；接西墙的墙距仍在西侧", () => {
  const draft = clonePublishedLayout();
  draft.floors[0]!.partitions = [{ a: [site.main.x, z(6000)], b: [x(3000), z(6000)] }];
  draft.annexPartitions = [{ a: [site.annex.x, site.annex.z + 3000], b: [site.annex.x + site.annex.w, site.annex.z + 3000] }];
  const html = floorPlan(0, false, false, { editable: true }, planSourceFromDraft(draft, 0));
  const main = buildingSvg(html, "main"), annex = buildingSvg(html, "annex");
  assert.deepEqual(renderedChain(main, "east", "overall"), [10000]);
  assert.deepEqual(renderedChain(annex, "east", "overall"), [8000]);
  assert.ok(!main.includes('data-dim-side="west" data-dim-kind="overall"'));
  assert.ok(!annex.includes('data-dim-side="west" data-dim-kind="overall"'));
  // 接西外墙的水平内墙应出现在西侧墙线定位
  assert.ok(main.includes('data-dim-side="west" data-dim-kind="walls"'));
  assert.ok(annex.includes('data-dim-side="west" data-dim-kind="walls"'));
  assert.deepEqual(renderedChain(main, "north", "control"), [4500, 4600, 4500]);
  assert.deepEqual(renderedChain(main, "north", "overall"), [13600]);
  assert.deepEqual(renderedChain(annex, "north", "overall"), [4000]);
  assert.ok(!main.includes('data-dim-side="south" data-dim-kind="overall"'));
  assert.ok(!annex.includes('data-dim-side="south" data-dim-kind="overall"'));
  assert.ok(!main.includes('data-annex="1"'));
  assert.ok(annex.includes('data-annex="1"'));
  assert.ok(!annex.includes('data-edit="stair"'));
  assert.ok(!annex.includes('data-edit="portico"'));
  const shared = collectPlanSiteDimensions();
  assert.deepEqual(shared.widthSegmentsMm, [800, 4000, 1800, 13600, 800]);
  assert.equal(shared.widthSegmentsMm.reduce((a, b) => a + b, 0), shared.totalWidthMm);
  assert.equal(shared.mainDepthMm, shared.annexDepthMm + shared.annexSetbackMm);
});

test("二三层仅画主楼，辅楼不随楼层重复生成", () => {
  for (const i of [1, 2]) {
    const html = floorPlan(i, false, false);
    assert.equal((html.match(/data-plan-building=/g) ?? []).length, 1);
    assert.ok(!html.includes('data-plan-building="annex"'));
  }
});

test("三楼旧稿前缘不同于当前北退时，尺寸后端仍与真实后墙一致", () => {
  const draft = clonePublishedLayout();
  draft.floors[2]!.front = z(1800);
  const result = dims(draft, 2);
  assert.equal(result.south, z(10000));
  const svg = floorPlan(2, false, false, {}, planSourceFromDraft(draft, 2));
  assert.deepEqual(renderedChain(svg, "east", "overall"), [8200]);
  assert.ok(!svg.includes('data-dim-side="west" data-dim-kind="overall"'));
});

test("外包络含小数毫米时，先量化端点保证分段严格闭合", () => {
  const draft = clonePublishedLayout();
  const old = site.main.w;
  try {
    site.main.w = 13001.4;
    const result = dims(draft, 1);
    // 外包络端点先量化到整数 mm，再相减；门厅柱心控制档仍夹在外皮之间。
    assert.equal(spans(result.controls).reduce((a, b) => a + b, 0), 13001);
    assert.ok(result.controls.length >= 2);
    assert.equal(result.controls[0], planDimMm(site.main.x));
    assert.equal(result.controls.at(-1), planDimMm(site.main.x + site.main.w));
  } finally { site.main.w = old; }
});

test("全部已存户型三层尺寸链单调、总尺寸固定、各分段毫米之和闭合", () => {
  const root = new URL("../data/户型/", import.meta.url);
  for (const name of readdirSync(root).filter((n) => n !== "index.json" && n.endsWith(".json"))) {
    const raw = JSON.parse(readFileSync(new URL(name, root), "utf8"));
    const draft = (raw.layoutDraft ?? raw.layout ?? raw) as LayoutDraft;
    for (let i = 0; i < 3; i++) {
      const result = dims(draft, i);
      for (const key of ["controls", "northXs", "southXs", "eastZs", "westZs", "annexZs"] as const) {
        const values = result[key];
        assert.ok(spans(values).every((n) => n > 0), `${name}/${i}/${key}`);
        assert.equal(spans(values).reduce((a, b) => a + b, 0), planDimSpanMm(values[0]!, values.at(-1)!));
      }
      const svg = floorPlan(i, false, false, {}, planSourceFromDraft(draft, i));
      const total = Math.round(site.main.w);
      assert.deepEqual(renderedChain(svg, "north", "overall"), [total]);
      assert.ok(!svg.includes('data-dim-side="south" data-dim-kind="overall"'));
    }
  }
});

test("尺寸引出线回到实际外墙，不再从门厅外围的空白处起算", () => {
  const draft = clonePublishedLayout();
  const result = dims(draft);
  assert.equal(result.horizontalFrom("north", site.main.x), draft.floors[0]!.front);
  assert.equal(collectPlanDimensions(0, draft.floors[0]!, draft.annexPartitions, "annex").horizontalFrom("north", site.annex.x), site.annex.z);
  const svg = floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0));
  assert.ok(svg.includes(`M${site.main.x} ${draft.floors[0]!.front}`));
});

test("靠近外皮10mm的旧墙端不会抢走房间吸附的固定边界", () => {
  const result = collectRoomSnapAxes({
    partitions: [{ a: [6690, 1000], b: [6690, 5000] }], rooms: [],
    bounds: [{ x0: 6700, x1: 20200, z0: -400, z1: 9600 }],
  });
  assert.ok(result.xs.includes(6700));
  assert.ok(!result.xs.includes(6690));
});

test("改变贴外墙房间的进深不会因吸附外墙中线横移120mm", () => {
  const draft = clonePublishedLayout();
  const editor = new LayoutEditor(host, draft);
  editor.selection = { kind: "room", id: "tea", floor: 0 };
  const room = editor.draft.floors[0]!.rooms.find((r) => r.id === "tea")!;
  const oldX = room.x;
  editor.updateSelectedNumber("d", 4000);
  assert.ok(Math.abs(room.x - oldX) < 1);
  assert.ok(Math.abs(room.x + room.w - site.main.x - site.main.w) < 1);
});

test("关闭吸附后输入尺寸保留房间原点，不再偷偷贴最近墙", () => {
  const editor = new LayoutEditor(host, clonePublishedLayout());
  editor.selection = { kind: "room", id: "tea", floor: 0 };
  editor.magnetSnap = false;
  const room = editor.draft.floors[0]!.rooms.find((r) => r.id === "tea")!;
  room.x -= 120; room.z += 120;
  const before = [room.x, room.z];
  editor.updateSelectedNumber("d", 4000);
  assert.deepEqual([room.x, room.z], before);
});

test("拖出再拖回原点时，独占墙和家具必须回到拖前快照", () => {
  const room: Room = { id: "t", name: "试", kind: "bed", x: 2000, z: 2000, w: 3000, d: 3000 };
  const origWalls: Wall[] = [{ a: [2000, 2000], b: [2000, 5000] }];
  const walls = structuredClone(origWalls);
  const origFurniture = [{ kind: "bed" as const, x: 3000, z: 3000, w: 1000, d: 1000 }];
  const furniture = structuredClone(origFurniture);
  for (const d of [500, -100, 0]) {
    translateOwnedWallsWithRoom(room, d, d, walls, origWalls, [room]);
    translateFurnitureInsideRoom(room, d, d, furniture, origFurniture, [room]);
  }
  assert.deepEqual(walls, origWalls);
  assert.deepEqual(furniture, origFurniture);
});
