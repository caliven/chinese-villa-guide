import assert from "node:assert/strict";
import { test } from "node:test";
import { site } from "../src/data.ts";
import { clonePublishedLayout, removeStairFromDraft } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { collectPlanDimensions } from "../src/plan-dimensions.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import { virtualWallRegions } from "../src/plan-regions.ts";

const body = () => ({ x: site.main.x, z: site.main.z, w: site.main.w, d: site.main.d });

test("十字虚拟墙围合四个分区并标注宽深", () => {
  const b = body();
  const midX = b.x + b.w / 2;
  const midZ = b.z + b.d / 2;
  const regions = virtualWallRegions(b, [
    { a: [b.x, midZ], b: [b.x + b.w, midZ], role: "virtual" },
    { a: [midX, b.z], b: [midX, b.z + b.d], role: "virtual" },
  ]);
  assert.equal(regions.length, 4);
  for (const r of regions) {
    assert.ok(r.wMm > 0 && r.dMm > 0);
  }
});

test("L 形虚线围合的非矩形区不标外包络尺寸", () => {
  const b = body();
  // 西半横线＋南半竖线：西南角为矩形分间；其余凹形大区旧逻辑会标外包络，现应跳过。
  const midX = b.x + b.w / 2;
  const midZ = b.z + b.d / 2;
  const regions = virtualWallRegions(b, [
    { a: [b.x, midZ], b: [midX, midZ], role: "virtual" },
    { a: [midX, midZ], b: [midX, b.z + b.d], role: "virtual" },
  ]);
  assert.equal(regions.length, 1);
  assert.equal(regions[0]!.wMm, b.w / 2);
  assert.equal(regions[0]!.dMm, b.d / 2);
});

test("未接墙的短虚线不单独制造分区尺寸", () => {
  const b = body();
  assert.deepEqual(
    virtualWallRegions(b, [{ a: [b.x + 3000, b.z + 4000], b: [b.x + 5000, b.z + 4000], role: "virtual" }]),
    [],
  );
});

test("虚拟墙与实体墙重合时不因虚线重复划区", () => {
  const b = body();
  const midZ = b.z + b.d / 2;
  const physical = { a: [b.x, midZ] as [number, number], b: [b.x + b.w, midZ] as [number, number], role: "partition" as const };
  const virtual = { a: [b.x, midZ] as [number, number], b: [b.x + b.w, midZ] as [number, number], role: "virtual" as const };
  assert.deepEqual(virtualWallRegions(b, [physical, virtual]), []);
});

test("平面拖入虚拟墙：细灰虚线与分区尺寸仍画，但不参与外圈墙距", () => {
  const draft = clonePublishedLayout();
  removeStairFromDraft(draft); // 去掉梯间档，避免与虚线测试混淆
  const x0 = site.main.x;
  const z0 = site.main.z;
  const w = site.main.w;
  const d = site.main.d;
  draft.floors[0]!.partitions = [
    { a: [x0, z0 + d / 2], b: [x0 + w, z0 + d / 2], role: "virtual" },
    { a: [x0 + w / 2, z0], b: [x0 + w / 2, z0 + d], role: "virtual" },
  ];
  const html = floorPlan(0, false, false, { editable: true }, planSourceFromDraft(draft, 0));
  assert.match(html, /class="virtual-wall"/);
  assert.match(html, /virtual-wall-hit/);
  assert.match(html, /virtual-region-size/);
  assert.match(html, /虚线分间 \d+×\d+/);
  // 主楼仅虚线时外圈不应出现 walls 分档（辅楼另有实体墙，勿用整页断言）。
  const main = html.match(/<svg data-plan-building="main"[\s\S]*?<\/svg>/)?.[0] ?? "";
  assert.ok(main);
  assert.ok(!main.includes('data-dim-kind="walls"'));

  const dims = collectPlanDimensions(0, draft.floors[0]!, draft.annexPartitions, "main");
  assert.ok(!dims.northXs.includes(x0 + w / 2) && !dims.southXs.includes(x0 + w / 2));
  assert.ok(!dims.westZs.includes(z0 + d / 2) && !dims.eastZs.includes(z0 + d / 2));
});

test("改角色为虚拟墙时去掉门洞，且不进入立体墙体", () => {
  const draft = clonePublishedLayout();
  draft.floors[0]!.partitions = [
    {
      a: [site.main.x + 2000, site.main.z + 4000],
      b: [site.main.x + 6000, site.main.z + 4000],
      role: "partition",
      door: { offset: 1000, width: 900, kind: "door", side: "in", hinge: "left" },
    },
  ];
  const editor = new LayoutEditor(
    { getFloor: () => 0, redraw: () => {}, toast: () => {} } as never,
    draft,
  );
  editor.selection = { kind: "wall", index: 0, floor: 0 };
  editor.updateWallField("role", "virtual");
  assert.equal(draft.floors[0]!.partitions[0]!.role, "virtual");
  assert.equal(draft.floors[0]!.partitions[0]!.door, undefined);
});

test("拖放虚拟墙写入 role=virtual，默认长度短于实体隔墙", () => {
  const draft = clonePublishedLayout();
  const before = draft.floors[0]!.partitions.length;
  const toasts: string[] = [];
  const editor = new LayoutEditor(
    { getFloor: () => 0, redraw: () => {}, toast: (m: string) => { toasts.push(m); } } as never,
    draft,
  );
  const worldX = site.main.x + 4000;
  const worldZ = site.main.z + 4000;
  const svg = {
    dataset: { planBuilding: "main" },
    querySelector: () => null,
    createSVGPoint: () => ({
      x: 0,
      y: 0,
      matrixTransform: () => ({ x: worldX, y: worldZ }),
    }),
    getScreenCTM: () => ({
      inverse: () => ({}),
    }),
  } as unknown as SVGSVGElement;
  editor.dropPlace(svg, 0, 0, "wall", "virtual");
  assert.equal(draft.floors[0]!.partitions.length, before + 1);
  const wall = draft.floors[0]!.partitions.at(-1)!;
  assert.equal(wall.role, "virtual");
  assert.ok(Math.abs(wall.b[0] - wall.a[0] - 1500) < 1);
  assert.ok(toasts.some((t) => t.includes("虚拟墙")));
});
