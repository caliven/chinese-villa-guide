import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, MeshPhysicalMaterial, Vector3 } from "three";
import { buildVilla, elevationModel, rearBalconyLayout, villaLayoutFromDraft, withLayoutContext } from "../src/architecture";
import { clonePublishedLayout } from "../src/layout-draft";
import { facts, floors, frontElevation, site } from "../src/data";
import { elevationLabels, elevationPlan, elevationShell, elevationSvg, projectElevation, visibleElevationPolygons, type ElevationSurface, type ElevationView } from "../src/elevation-plan";
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

test("墙面内齐平楼板不额外显示板底线，外伸的板边保留", () => {
  const wall = { ...surface(0, 100, 0, 100, 0), part: "exterior-wall" };
  const slab = { ...surface(-20, 120, 80, 100, 0), part: "third-floor-slab" };
  const polygons = visibleElevationPolygons([wall, slab], "north");
  assert.equal(area(polygons[0]), 10000);
  assert.equal(area(polygons[1]), 800, "仅保留墙外两侧各20宽的板边");
});

test("前方外伸楼板不切割外墙，避免墙面出现板厚双线", () => {
  const wall = { ...surface(0, 100, 0, 100, 100), part: "exterior-wall" };
  const slab = { ...surface(20, 80, 80, 100, 0), part: "third-floor-slab" };
  const polygons = visibleElevationPolygons([wall, slab], "north");
  assert.equal(area(polygons[0]), 10000, "外墙保持整面，不被板厚挖出横条");
  assert.equal(area(polygons[1]), 1200, "外伸板边仍单独可见");
});

test("主楼立面外墙不被楼板挖出板厚横条", () => {
  resetVillaParams();
  try {
    for (const view of Object.keys(elevationLabels) as ElevationView[]) {
      const { surfaces } = elevationShell(view, "floating");
      const visible = visibleElevationPolygons(surfaces, view);
      const floorY = floors[2].y;
      for (const [index, surface] of surfaces.entries()) {
        if (surface.part !== "exterior-wall") continue;
        for (const polygon of visible[index]) {
          const ys = polygon.map(point => point[1]);
          const height = Math.max(...ys) - Math.min(...ys);
          // 楼板切割外墙时会留下约120高的横条残片。
          assert.ok(height < 2 || height > 150 || Math.abs(Math.min(...ys) + floorY) > 2,
            `${view} 外墙不应留下贴楼面的板厚残片`);
        }
      }
    }
  } finally { resetVillaParams(); }
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
    assert.equal(changed.roof.mainPeak - floating.roof.hat.peak, 500 - DEFAULT_VILLA_PARAMS.floatingHatHeightOffset);
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
    assert.match(main, /主楼屋面板顶/);
    assert.doesNotMatch(main, /辅楼屋面板顶/);
    assert.match(annex, /辅楼屋面板顶/);
    assert.doesNotMatch(annex, /主楼屋面板顶|官帽瓦脊/);
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
    const apron = villa.levels[2].getObjectByName("三层檐下梁托与线脚")!;
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


test("四向主辅楼高度分段连续，地基与屋面随参数更新", () => {
  resetVillaParams();
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, entranceRise: 600 });
    for (const view of Object.keys(elevationLabels) as ElevationView[]) {
      for (const building of ["main", "annex"] as const) {
        const svg = elevationSvg(view, "floating", undefined, false, building);
        const regions = [...svg.matchAll(/data-height-region="([^"]+)" data-height-bottom="(\d+)" data-height-top="(\d+)"/g)];
        assert.ok(regions.some(r => r[1] === "地基抬高" && Number(r[3]) === 600));
        for (const name of ["屋面构造", "坡屋顶升高", "脊瓦高度", "总高度"]) {
          assert.ok(regions.some(r => r[1] === name), name);
        }
        const parts = regions.filter(r => r[1] !== "总高度");
        const roof = parts.find(r => r[1] === "屋面构造")!;
        assert.equal(Number(roof[3]) - Number(roof[2]), 300, "板顶以上只计天沟内挡及瓦檐间距");
        if (building === "main") {
          const third = parts.find(r => r[1] === "三层层高")!;
          assert.equal(Number(third[3]) - Number(third[2]), DEFAULT_VILLA_PARAMS.floor3Height);
          assert.equal(Number(roof[2]), floors[2].y + floors[2].height, "屋面附加高度从板顶起算");
        }
        parts.forEach((r, i) => {
          assert.ok(Number(r[3]) > Number(r[2]));
          if (i) assert.equal(Number(r[2]), Number(parts[i - 1][3]), "相邻分段标高应连续");
        });
        assert.equal(parts.at(-1)![3], regions.at(-1)![3]);
      }
    }
  } finally { resetVillaParams(); }
});

test("分段尺寸按标高端点求差，方形屋面及非整坡度四向加总等于总高", () => {
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 10000, thirdFloorMode: "flush",
      annexRoofFenShui: 5.17, entranceRise: 533 });
    for (const style of ["floating", "joined"] as const) for (const view of Object.keys(elevationLabels) as ElevationView[]) {
      for (const building of ["main", "annex"] as const) {
        const svg = elevationSvg(view, style, undefined, false, building);
        const regions = [...svg.matchAll(/<g data-height-region="([^"]+)" data-height-bottom="(\d+)" data-height-top="(\d+)">([\s\S]*?)<\/g>/g)];
        let sum = 0;
        for (const r of regions.filter(r => r[1] !== "总高度")) {
          const printed = Number(r[4].match(/class="el-dim-label"[^>]*>(\d+)<\/text>/)![1]);
          assert.equal(printed, Number(r[3]) - Number(r[2]), r[1]);
          sum += printed;
        }
        assert.equal(sum, Number(regions.at(-1)![3]), `${building}/${view}/${style}`);
      }
    }
  } finally { resetVillaParams(); }
});

test("高度明细列出实际层高及板底板顶，层高与板上构造只累加一次", async () => {
  resetVillaParams();
  const { villaParamsPanelHtml } = await import("../src/villa-params-ui");
  const html = elevationPlan("east", "floating");
  assert.match(html, /data-overall-height="12930"/);
  assert.match(villaParamsPanelHtml(), /二层楼面标高（院坪起）/);
  assert.equal(facts.find(f => f.label === "层高")!.value, "3150 / 3600 / 3300 mm");
  assert.match(html, /当前首层实际层高＝3600－450＝3150/);
  assert.match(html, /板底 \+10380，板顶 \+10500/);
  assert.match(html, /450＋3150＋3600＋3300＋300＋2000＋130＝12930/);
  assert.match(html, /屋脊最高点 \+5070；总高度包含烟囱盖板/);
  assert.match(html, /450＋3270＋300＋920＋130＋1073＝6143/);
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, annexHeight: 17000 });
    const tallAnnex = elevationPlan("east", "floating");
    assert.match(tallAnnex, /data-overall-height="19543"/);
    assert.match(tallAnnex, /主楼 12930，辅楼含烟囱 19543/);
  } finally { resetVillaParams(); }
});


test("立面外墙按真实外皮及墙端绘制，辅楼四向角部完整", () => {
  resetVillaParams();
  for (const building of ["main", "annex"] as const) {
    const body = building === "main" ? site.main : site.annex;
    for (const view of ["east", "west"] as const) {
      const walls = elevationShell(view, "floating", undefined, false, building).surfaces.filter(s => s.part === "exterior-wall");
      const sideX = view === "east" ? body.x + body.w : body.x;
      assert.ok(walls.some(s => s.points.every(p => Math.abs(p.x - sideX) < .01)));
      assert.equal(Math.min(...walls.flatMap(s => s.points.map(p => p.z))), body.z);
      assert.equal(Math.max(...walls.flatMap(s => s.points.map(p => p.z))), body.z + body.d);
      assert.ok(walls.every(s => s.points.every(p => p.y >= site.entranceRise)));
    }
  }
});

test("立面出图全程采用草稿门厅上下文，返回后恢复共享参数", () => {
  resetVillaParams();
  const draft = clonePublishedLayout();
  draft.portico.projection = 2600;
  draft.portico.x += 200;
  draft.portico.w -= 400;
  const layout = villaLayoutFromDraft(draft);
  const before = JSON.stringify([site, frontElevation, draft]);
  for (const view of ["north", "east"] as const) {
    const expected = withLayoutContext(layout, () => elevationSvg(view, "floating", layout));
    assert.equal(elevationSvg(view, "floating", layout), expected);
  }
  assert.match(elevationSvg("east", "floating", layout), />2600<\/text>/);
  assert.equal(JSON.stringify([site, frontElevation, draft]), before);
});

test("两种官帽及主楼换位时，后阳台轮廓与模型共用位置", () => {
  try {
    for (const buildingPlacement of ["main-east", "main-west"] as const) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement });
      const balcony = rearBalconyLayout();
      for (const style of ["joined", "floating"] as const) {
        const slab = elevationShell("south", style, undefined, true).surfaces.filter(s => s.part === "rear-balcony-slab");
        assert.equal(Math.min(...slab.flatMap(s => s.points.map(p => p.x))), balcony.x);
        assert.equal(Math.max(...slab.flatMap(s => s.points.map(p => p.x))), balcony.x + balcony.w);
      }
    }
  } finally { resetVillaParams(); }
});

test("立面脊瓦最高点和实体16面筒瓦一致，包含等长宽屋面", () => {
  const mats = new Proxy({} as import("../src/primitives").Mats, {
    get(target, key: keyof import("../src/primitives").Mats) { return target[key] ??= new MeshPhysicalMaterial() as never; },
  });
  try {
    for (const mainWidth of [DEFAULT_VILLA_PARAMS.mainWidth, DEFAULT_VILLA_PARAMS.mainDepth]) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth });
      for (const style of ["joined", "floating"] as const) {
        const villa = buildVilla(mats, false, site.roofFenShui, style);
        villa.group.updateWorldMatrix(true, true);
        const actual: number[] = [];
        villa.roof.traverse(object => {
          if (object.name !== "相接直脊瓦") return;
          const mesh = object as import("three").InstancedMesh;
          for (let i = 0; i < mesh.count; i++) {
            const matrix = new Matrix4(); mesh.getMatrixAt(i, matrix);
            // 逐顶点求最高点，旋转后的局部包围盒会放大斜脊截面。
            const positions = mesh.geometry.getAttribute("position");
            for (let j = 0; j < positions.count; j++) actual.push(new Vector3().fromBufferAttribute(positions, j)
              .applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld).y);
          }
        });
        const shell = elevationShell("north", style).surfaces.filter(s => s.part === "roof-ridge");
        const drawingTop = Math.max(...shell.flatMap(s => s.points.map(p => p.y)));
        assert.ok(Math.abs(drawingTop - Math.max(...actual)) < .01);
        const svg = elevationSvg("north", style);
        assert.match(svg, new RegExp(`屋脊最高点 \\+${Math.round(drawingTop)}`));
      }
    }
  } finally { resetVillaParams(); }
});


test("后方包角柱在四向投影中保留，与主体南墙的外凸关系联动", () => {
  resetVillaParams();
  for (const view of ["north", "south", "east", "west"] as const) {
    const columns = elevationShell(view, "floating").surfaces.filter(s => s.part === "rear-corner-column");
    assert.ok(columns.length > 0);
    if (view !== "north") assert.ok(Math.max(...columns.flatMap(s => s.points.map(p => p.z))) > site.main.z + site.main.d);
  }
});
