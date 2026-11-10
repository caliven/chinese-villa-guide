import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { elevationModel, villaLayoutFromDraft } from "../src/architecture";
import { clonePublishedLayout } from "../src/layout-draft";
import { floors, frontElevation, site } from "../src/data";
import { elevationLabels, elevationShell, elevationSvg, projectElevation, visibleElevationPolygons, type ElevationSurface, type ElevationView } from "../src/elevation-plan";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params";

const surface = (x0: number, x1: number, y0: number, y1: number, z: number): ElevationSurface => ({
  points: [new Vector3(x0, y0, z), new Vector3(x1, y0, z), new Vector3(x1, y1, z), new Vector3(x0, y1, z)], cls: "wall",
});
const area = (polygons: number[][][]) => polygons.reduce((sum, p) => sum + Math.abs(p.reduce((a, q, i) => {
  const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - q[1] * r[0];
}, 0) / 2), 0);

test("四向立面按观察方向正投影，北侧正门左东右西，无透视缩放", () => {
  const p = new Vector3(3000, 4500, 2000);
  assert.deepEqual(projectElevation(p, "north"), [-3000, -4500]);
  assert.deepEqual(projectElevation(p, "south"), [3000, -4500]);
  assert.deepEqual(projectElevation(p, "east"), [-2000, -4500]);
  assert.deepEqual(projectElevation(p, "west"), [2000, -4500]);
  assert.equal(projectElevation(new Vector3(3000, 4500, 9000), "north")[0], -3000);
});

test("消隐扣除前方实体重叠，反向观察保留相反面，透明栏杆不遮住墙窗", () => {
  const back = surface(0, 100, 0, 100, 100), front = surface(25, 75, 0, 100, 0);
  const north = visibleElevationPolygons([back, front], "north");
  assert.equal(area(north[0]), 5000);
  assert.equal(area(north[1]), 5000);
  const south = visibleElevationPolygons([back, front], "south");
  assert.equal(area(south[0]), 10000);
  assert.equal(area(south[1]), 0);
  front.occludes = false;
  assert.equal(area(visibleElevationPolygons([back, front], "north")[0]), 10000);
});

test("相交斜面按局部深度消隐，不用平均深度把半边屋面整块盖掉", () => {
  const flat = surface(0, 100, 0, 100, 50), sloped = surface(0, 100, 0, 100, 0);
  sloped.points[1].z = 100; sloped.points[2].z = 100;
  const visible = visibleElevationPolygons([flat, sloped], "north");
  assert.ok(Math.abs(area(visible[0]) - 5000) < 20);
  assert.ok(Math.abs(area(visible[1]) - 5000) < 20);
});

test("外部门窗和门厅草稿随立体共用数据，出图不污染草稿及全局尺寸", () => {
  resetVillaParams();
  const draft = clonePublishedLayout();
  draft.portico.x += 150; draft.portico.w -= 300; draft.portico.projection = 2400;
  draft.exteriorManaged = true;
  draft.exteriorOpenings = [{ floor: 0, facadeIndex: 0, opening: { offset: 1000, width: 1250, kind: "window" } }];
  const before = JSON.stringify([draft, site, floors, frontElevation]);
  const layout = villaLayoutFromDraft(draft), model = elevationModel("floating", layout);
  assert.equal(model.front.porticoColumnZ, site.main.z - 2400);
  assert.deepEqual(model.front.postXs, [draft.portico.x, draft.portico.x + draft.portico.w]);
  assert.equal(model.floors[0].facades[0].openings.length, 1);
  assert.equal(model.floors[0].facades[0].openings[0].w, 1250);
  const upperOpenings = model.floors[1].facades.flatMap(f => f.openings);
  assert.equal(upperOpenings.length, 1, "挑空外窗应在上层派生同宽通高洞口");
  assert.ok(upperOpenings[0].continuous);
  assert.equal(upperOpenings[0].w, 1250);
  assert.equal(model.roof.portico.w, 4300);
  assert.match(elevationSvg("north", "floating", layout), /class="el-dim-label"[^>]*>4300<\/text>/);
  assert.equal(JSON.stringify([draft, site, floors, frontElevation]), before);
});

test("层高、主楼宽度、三层退台与屋面坡度联动，两种官帽四向均可独立导出", () => {
  resetVillaParams();
  const original = elevationSvg("north", "joined");
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 13400, floor2Height: 3800, thirdSetback: 1600, roofFenShui: 6 });
    const changed = elevationModel("joined"), floating = elevationModel("floating");
    assert.equal(changed.main.w, 13400);
    assert.equal(changed.floors[2].y, 7400);
    assert.equal(changed.floors[2].front, site.main.z + 1600);
    assert.equal(changed.roof.mainPeak - floating.roof.hat.peak, 500);
    assert.notEqual(elevationSvg("north", "joined"), original);
    for (const style of ["joined", "floating"] as const) {
      for (const view of Object.keys(elevationLabels) as ElevationView[]) {
        const svg = elevationSvg(view, style);
        assert.match(svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
        assert.match(svg, /<style>/);
        assert.match(svg, /相对暂定院坪基准，非施工图/);
        assert.match(svg, /13400|10000/);
        assert.doesNotMatch(svg, /NaN|Infinity|undefined|<image|<script|data-edit=/);
      }
    }
  } finally { resetVillaParams(); }
});

test("主楼和辅楼按各自外包络独立出图与导出", () => {
  resetVillaParams();
  for (const style of ["joined", "floating"] as const) for (const view of Object.keys(elevationLabels) as ElevationView[]) {
    const main = elevationSvg(view, style, undefined, false, "main");
    const annex = elevationSvg(view, style, undefined, false, "annex");
    assert.match(main, /data-building="main"/);
    assert.match(annex, /data-building="annex"/);
    assert.match(main, /主楼屋面基准/);
    assert.doesNotMatch(main, /辅楼屋面基准/);
    assert.match(annex, /辅楼屋面基准/);
    assert.doesNotMatch(annex, /主楼屋面基准|官帽瓦脊/);
    assert.match(annex, view === "north" || view === "south" ? />4000<\/text>/ : />8000<\/text>/);
    assert.doesNotMatch(annex, /NaN|Infinity|undefined/);
    assert.match(main, new RegExp(`id="el-${view}-${style}-main-tiles"`));
    assert.match(annex, new RegExp(`id="el-${view}-${style}-annex-tiles"`));
  }
});

test("三层统一楼板与立面同标高，檐下不再投影下挂墙梁", async () => {
  const THREE = await import("three");
  const { buildVilla } = await import("../src/architecture");
  const mat = new Proxy({} as import("../src/primitives").Mats, {
    get(target, key: keyof import("../src/primitives").Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; },
  });
  resetVillaParams();
  for (const style of ["joined", "floating"] as const) {
    const villa = buildVilla(mat, false, 4.5, style);
    const plate = villa.levels[2].getObjectByName("三楼楼板")!;
    const bounds = new THREE.Box3().setFromObject(plate);
    const apron = villa.levels[2].getObjectByName("三楼栏杆下飘檐")!;
    assert.equal(apron.getObjectByName("挑檐连续承托梁"), undefined);
    assert.equal(apron.getObjectByName("四处柱位实体承台"), undefined);
    assert.ok(apron.getObjectByName("连续转角下沿线"));
    for (const view of ["east", "west"] as const) {
      const { surfaces } = elevationShell(view, style);
      const slab = surfaces.filter(surface => surface.part === "third-floor-slab");
      assert.ok(slab.length > 0);
      assert.equal(Math.min(...slab.flatMap(surface => surface.points.map(point => point.y))), bounds.min.y);
      assert.equal(Math.max(...slab.flatMap(surface => surface.points.map(point => point.y))), bounds.max.y);
      assert.ok(surfaces.filter(surface => surface.part === "apron-support").every(surface =>
        surface.points.every(point => point.y <= bounds.min.y)), "下沿线位于楼板底以下");
    }
  }
});
