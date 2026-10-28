import assert from "node:assert/strict";
import { test } from "node:test";
import { site, type Point, type Room, type Wall } from "../src/data.ts";
import { clonePublishedLayout, removeStairFromDraft } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { collectPlanDimensions } from "../src/plan-dimensions.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import {
  applyRoomToEnclosedRegion, enclosedRoomRegions, findEnclosedRegionAt,
  polygonAreaMm2, polygonContainsPoint, regionTouchesWall, threeWallRoomRegions,
  virtualWallRegions,
} from "../src/plan-regions.ts";

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

test("平面拖入虚拟墙：细灰虚线与分区尺寸仍画，外墙接触点参与外圈定位", () => {
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
  // 主楼虚线接到外墙时出现 walls 分档。
  const main = html.match(/<svg data-plan-building="main"[\s\S]*?<\/svg>/)?.[0] ?? "";
  assert.ok(main);
  assert.ok(main.includes('data-dim-kind="walls"'));

  const dims = collectPlanDimensions(0, draft.floors[0]!, draft.annexPartitions, "main");
  assert.ok(dims.northXs.includes(x0 + w / 2) && dims.southXs.includes(x0 + w / 2));
  assert.ok(dims.westZs.includes(z0 + d / 2) && dims.eastZs.includes(z0 + d / 2));
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

const polygonBody = { x: 0, z: 0, w: 12000, d: 10000 };
function loop(points: Point[]): Wall[] {
  return points.map((a, i) => ({ id: `l${i}`, a: [...a], b: [...points[(i + 1) % points.length]!], role: "partition" }));
}
const lPoints: Point[] = [[2000, 2000], [8000, 2000], [8000, 4000], [5000, 4000], [5000, 7000], [2000, 7000]];
const box = (): Wall[] => loop([[2000, 2000], [8000, 2000], [8000, 7000], [2000, 7000]]);

test("闭合L形提取为一条真实轮廓，面积不包含凹口", () => {
  const regions = enclosedRoomRegions(polygonBody, loop(lPoints));
  assert.equal(regions.length, 1);
  const r = regions[0]!;
  assert.equal(r.rectangular, false);
  assert.deepEqual(r.polygon, lPoints);
  assert.equal(r.geometryArea, 21);
  assert.equal(r.buildingArea, 21);
  assert.equal(polygonAreaMm2(r.polygon!), 21_000_000);
  assert.equal(polygonContainsPoint(r.polygon!, 6500, 5500), false);
  assert.equal(polygonContainsPoint(r.polygon!, 3500, 5500), true);
  assert.notEqual(findEnclosedRegionAt(6500, 5500, polygonBody, loop(lPoints))?.boundaryKey, r.boundaryKey);
});

test("同一墙拆为多段且反向绘制，闭合轮廓和面积不变", () => {
  const walls = loop(lPoints);
  const original = enclosedRoomRegions(polygonBody, walls)[0]!;
  const split = structuredClone(walls);
  const first = split.shift()!;
  split.push({ ...first, a: [5000, 2000], b: [2000, 2000] });
  split.push({ ...first, id: "l0-split", a: [8000, 2000], b: [5000, 2000] });
  const after = enclosedRoomRegions(polygonBody, split)[0]!;
  assert.deepEqual(after.polygon, original.polygon);
  assert.equal(after.geometryArea, original.geometryArea);
});

test("三墙U形基边拆段不改变手动开敞候选", () => {
  const walls = box();
  walls.splice(0, 1);
  const original = threeWallRoomRegions(polygonBody, walls).find(r => r.x === 2000 && r.z === 2000 && r.w === 6000 && r.d === 5000);
  assert.ok(original);
  const split = structuredClone(walls);
  split.splice(1, 1, { id: "split-1", a: [8000, 7000], b: [5000, 7000] }, { id: "split-2", a: [5000, 7000], b: [2000, 7000] });
  const after = threeWallRoomRegions(polygonBody, split).find(r => r.x === original.x && r.z === original.z && r.w === original.w && r.d === original.d);
  assert.ok(after);
  assert.equal(after.openSide, true);
  assert.deepEqual(enclosedRoomRegions(polygonBody, split), []);
});

test("墙面接触可围合，墙面外仍有80空隙则不冒充闭合", () => {
  const walls = box();
  walls[1]!.a[1] += 60;
  assert.equal(enclosedRoomRegions(polygonBody, walls).length, 1, "端点停在隔墙内皮属于实际墙体接触");
  walls[1]!.a[1] += 80;
  assert.deepEqual(enclosedRoomRegions(polygonBody, walls), []);
});

test("主辅楼四向U形接外墙内皮可识别，外墙内皮外真实留缝不补", () => {
  const bodies = [polygonBody, { x: 21000, z: 3000, w: 4000, d: 8000 }];
  for (const b of bodies) for (const side of ["north", "south", "west", "east"]) {
    const transform = (u: number, v: number): Point => side === "north" ? [b.x + u, b.z + v]
      : side === "south" ? [b.x + u, b.z + b.d - v]
      : side === "west" ? [b.x + v, b.z + u] : [b.x + b.w - v, b.z + u];
    const u0 = b.w === 4000 ? 1000 : 2000, u1 = b.w === 4000 ? 3000 : 6000;
    const a = transform(u0, 0), c = transform(u1, 3000);
    const expected = { x: Math.min(a[0], c[0]), z: Math.min(a[1], c[1]), w: Math.abs(a[0] - c[0]), d: Math.abs(a[1] - c[1]) };
    for (const end of [0, 240, 241, 242, 320]) {
      const walls: Wall[] = [
        { id: "skin-arm-a", a: transform(u0, end), b: transform(u0, 3000) },
        { id: "skin-arm-b", a: transform(u1, end), b: transform(u1, 3000) },
      ];
      const before = structuredClone(walls);
      const target = threeWallRoomRegions(b, walls).find(r => r.x === expected.x && r.z === expected.z && r.w === expected.w && r.d === expected.d);
      assert.equal(!!target, end <= 241, `${side} 起点距外皮${end}，只容许墙厚240加1舍入误差`);
      if (target) assert.equal(target.openSide, true);
      assert.deepEqual(enclosedRoomRegions(b, walls), [], "三面围合不能冒充四面闭合");
      assert.deepEqual(walls, before, "分区识别不能修改原始墙体端点");
    }
  }
});

test("U形内墙墙皮接触与闭合检测口径一致，墙皮外2毫米空隙不补", () => {
  for (const [role, half] of [["partition", 60], ["bearing", 120]] as const) {
    for (const gap of [0, half, half + 1, half + 2, half + 80]) {
      const walls: Wall[] = [
        { id: "base", a: [2000, 2000], b: [8000, 2000], role },
        { id: "left", a: [2000, 2000 + gap], b: [2000, 7000] },
        { id: "right", a: [8000, 2000 + gap], b: [8000, 7000] },
      ];
      const hasU = threeWallRoomRegions(polygonBody, walls).some(r => r.x === 2000 && r.z === 2000 && r.w === 6000 && r.d === 5000 && r.openSide);
      assert.equal(hasU, gap <= half + 1, `${role} 接点距中线${gap}`);
      walls.push({ id: "closing", a: [2000, 7000], b: [8000, 7000] });
      assert.equal(enclosedRoomRegions(polygonBody, walls).some(r => r.x === 2000 && r.z === 2000 && r.w === 6000 && r.d === 5000), gap <= half + 1);
    }
  }
});

test("共线拆段1毫米接点误差不影响闭合或U形，2毫米真实缝隙不补", () => {
  for (const gap of [0, 1, 2]) {
    const closed = box();
    closed[1]!.b = [8000, 4500];
    closed.push({ id: "split", a: [8000, 4500 + gap], b: [8000, 7000] });
    const region = enclosedRoomRegions(polygonBody, closed).find(r => r.x === 2000 && r.z === 2000 && r.w === 6000 && r.d === 5000);
    assert.equal(!!region, gap <= 1, `闭合墙同轴接点缝隙${gap}`);
    if (region) assert.equal(region.geometryArea, 30);
    const open = closed.filter(w => w.id !== "l3");
    assert.equal(threeWallRoomRegions(polygonBody, open).some(r => r.x === 2000 && r.z === 2000 && r.w === 6000 && r.d === 5000 && r.openSide), gap <= 1, `U形基边同轴接点缝隙${gap}`);
  }
});

test("相交接点沿墙段投影也须真实接触，不能只按墙厚跨接墙端空隙", () => {
  const walls: Wall[] = [
    { id: "base", a: [2000, 2000], b: [7938, 2000] },
    { id: "left", a: [2000, 2060], b: [2000, 7000] },
    { id: "right", a: [8000, 2060], b: [8000, 7000] },
  ];
  assert.equal(threeWallRoomRegions(polygonBody, walls).some(r => r.x === 2000 && r.z === 2000 && r.w === 6000 && r.d === 5000), false);
  walls.push({ id: "closing", a: [2000, 7000], b: [8000, 7000] });
  assert.deepEqual(enclosedRoomRegions(polygonBody, walls), []);
});

test("墙ID保持时移动同一闭合墙环，边界关联键稳定", () => {
  const walls = box();
  const before = enclosedRoomRegions(polygonBody, walls)[0]!;
  walls[1]!.a[0] += 700;
  walls[1]!.b[0] += 700;
  walls[0]!.b[0] += 700;
  walls[2]!.a[0] += 700;
  const after = enclosedRoomRegions(polygonBody, walls)[0]!;
  assert.equal(after.boundaryKey, before.boundaryKey);
  assert.equal(after.w, before.w + 700);
});

test("凹形边界也识别为改墙相邻区，房间标签落在实际轮廓内", () => {
  const walls = loop(lPoints);
  const region = enclosedRoomRegions(polygonBody, walls)[0]!;
  assert.equal(regionTouchesWall(region, walls[3]!), true);
  const room: Room = { id: "l-room", name: "L形", x: 0, z: 0, w: 1000, d: 1000, kind: "living" };
  applyRoomToEnclosedRegion(room, region);
  assert.deepEqual(room.outline, lPoints);
  assert.equal(room.boundary?.status, "enclosed");
  assert.equal(polygonContainsPoint(room.outline!, room.label![0], room.label![1]), true);
});

test("重复重叠的半墙不能通过累加覆盖率补成一整面墙", () => {
  const walls: Wall[] = [
    { a: [2000, 7000], b: [8000, 7000] },
    { a: [2000, 2000], b: [2000, 4500] },
    { a: [2000, 2000], b: [2000, 4500] },
    { a: [8000, 2000], b: [8000, 7000] },
  ];
  assert.equal(threeWallRoomRegions(polygonBody, walls).some(r => r.x === 2000 && r.z === 2000 && r.w === 6000 && r.d === 5000), false);
});

test("含内洞的分区不以外包矩形填满，只返回可用单环表达的内房", () => {
  const regions = enclosedRoomRegions(polygonBody, box());
  assert.equal(regions.length, 1);
  assert.equal(regions[0]!.x, 2000);
  assert.equal(regions[0]!.z, 2000);
});
