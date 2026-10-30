import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { elevationModel, roofPlanModel, villaLayoutFromDraft } from "../src/architecture";
import { frontElevation, site } from "../src/data";
import { clonePublishedLayout, type LayoutDraft } from "../src/layout-draft";
import { floorPlan, planSourceFromDraft } from "../src/plan";
import { DEFAULT_VILLA_PARAMS, applyVillaParams, resetVillaParams } from "../src/villa-params";
import { centerPorticoInBay, porticoBayAlign } from "../src/layout-align";
import { alignedEntryOpenings } from "../src/entry-assembly";
import { facades } from "../src/facades";

test.afterEach(resetVillaParams);

function rectangles(svg: string, kind: string) {
  return [...svg.matchAll(new RegExp(`<g data-plan-column="${kind}"[^>]*><title>[^<]*</title><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`, "g"))]
    .map(([, x, z, w, d]) => ({ x: +x + +w / 2, z: +z + +d / 2, w: +w, d: +d }));
}

function checkFrontage(draft: LayoutDraft) {
  const before = JSON.stringify({ porch: site.portico, elevation: frontElevation });
  const porch = draft.portico;
  const expectedXs = [porch.x, porch.x + porch.w];
  const expectedZ = site.main.z - (site.porticoStyle === "recessed" ? 0 : porch.projection);
  const elevation = elevationModel("floating", villaLayoutFromDraft(draft)).front;
  const expectedPosts = elevation.balustradePosts
    .filter((_, i) => site.setback > 0 || i === 1 || i === 2)
    .map(p => ({ x: p.x, z: p.z, w: p.w, d: p.w }));
  for (const editorCanvas of [false, true]) {
    const second = floorPlan(1, false, false, { editorCanvas }, planSourceFromDraft(draft, 1));
    const third = floorPlan(2, false, false, { editorCanvas }, planSourceFromDraft(draft, 2));
    const columns = rectangles(second, "portico");
    assert.deepEqual(columns.map(p => p.x), expectedXs);
    assert.ok(columns.every(p => p.z === expectedZ && p.w === p.d), "门厅柱截面含饰线，双向对称于柱心");
    assert.deepEqual(rectangles(third, "railing"), expectedPosts, "露台短柱与三维同轴");
    assert.deepEqual(rectangles(third, "hat").map(p => [p.x, p.z]),
      expectedXs.map(x => [x, elevation.postZ]), "官帽柱与三维采用同一当前户型");
    const dividerWalls = [...third.matchAll(/<g transform="translate\(([^ ]+) ([^)]+)\) rotate\(([^)]+)\)" data-facade="\d+">/g)]
      .filter(([, , z, angle]) => Number(z) === elevation.postZ + 120 && Math.abs(Number(angle)) === 90)
      .map(([, x, z]) => [Number(x), Number(z)]);
    assert.deepEqual(dividerWalls, expectedXs.map(x => [x, elevation.postZ + 120]),
      "官帽柱后方分隔墙须与当前柱心同轴，不能继续使用全局柱位");
    assert.ok(third.includes(`M${porch.x} ${elevation.postZ} V${expectedZ} H${porch.x + porch.w} V${elevation.postZ}`),
      "中央栏杆折线落在当前户型柱心");
    assert.ok(third.includes(`<rect x="${porch.x}" y="${expectedZ}" width="${porch.w}" height="${elevation.terraceBack - expectedZ}" fill="#e9e2d4"`),
      "中央露台与三维边界相同");
    for (const svg of [second, third]) {
      const control = svg.match(/<g data-dim-side="north" data-dim-kind="control">([\s\S]*?)<\/g>/)?.[1];
      assert.ok(control);
      const labels = [...control.matchAll(/class="dim-mm"[^>]*>(\d+)</g)].map(m => +m[1]);
      assert.deepEqual(labels, [porch.x - site.main.x, porch.w, site.main.x + site.main.w - porch.x - porch.w].map(Math.round));
      for (const x of expectedXs) assert.ok(control.includes(`M${x} ${expectedZ} V`), "定位尺寸引线从当前柱心起画");
    }
  }
  assert.equal(JSON.stringify({ porch: site.portico, elevation: frontElevation }), before, "出图不得改写全局参数");
}

test("二三楼柱位、露台及尺寸随草稿移动改宽改出挑，支持凹凸门厅与主辅楼换位", () => {
  for (const porticoStyle of ["projecting", "recessed"] as const)
    for (const buildingPlacement of ["main-east", "main-west"] as const)
      for (const thirdFloorMode of ["setback", "flush"] as const) {
        applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoStyle, buildingPlacement, thirdFloorMode, porticoColumnSize: 900 });
        const draft = clonePublishedLayout();
        draft.portico.x += 150;
        draft.portico.w -= 200;
        draft.portico.projection += 350;
        checkFrontage(draft);
      }
});

test("三套保存户型的柱位、出挑及柱墙连接均按当前稿出图", () => {
  resetVillaParams();
  for (const file of ["户型-20261023-210731", "户型-20261017-233620", "户型-20261027-231848"])
    checkFrontage(JSON.parse(readFileSync(new URL(`../data/户型/${file}.json`, import.meta.url), "utf8")).layoutDraft);
});

test("门厅4600沿主楼中轴居中，主辅换位、主楼改宽及编辑居中保持两翼等宽", () => {
  for (const buildingPlacement of ["main-east", "main-west"] as const)
    for (const mainWidth of [13600, 14000]) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement, mainWidth });
      const center = site.main.x + mainWidth / 2;
      assert.equal(site.portico.w, 4600);
      assert.equal(site.portico.x + site.portico.w / 2, center);
      const draft = clonePublishedLayout();
      // 室内堂屋可偏心，门厅居中按钮仍应以整栋主楼中轴为准。
      const hall = draft.floors[0].rooms.find(r => r.kind === "hall")!;
      hall.x += 300;
      draft.portico.x += 200;
      centerPorticoInBay(draft.portico, draft.floors[0].rooms);
      assert.equal(porticoBayAlign(draft.portico, draft.floors[0].rooms).centerDelta, 0);
      assert.equal(draft.portico.x + draft.portico.w / 2, center);
      for (const style of ["joined", "floating"] as const) {
        const model = roofPlanModel(style, villaLayoutFromDraft(draft));
        assert.equal(model.hat.x + model.hat.w / 2, center);
      }
      checkFrontage(draft);
    }
});

test("当前方案及三套保存户型一二三层均为4500＋4600＋4500，中央门窗同轴", () => {
  const scheme = JSON.parse(readFileSync(new URL("../public/scheme/current.json", import.meta.url), "utf8"));
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, ...scheme.villaParams });
  assert.equal(site.portico.w, 4600);
  const center = site.main.x + site.main.w / 2;
  for (const file of ["户型-20261023-210731", "户型-20261017-233620", "户型-20261027-231848"]) {
    const draft: LayoutDraft = JSON.parse(readFileSync(new URL(`../data/户型/${file}.json`, import.meta.url), "utf8")).layoutDraft;
    assert.equal(draft.portico.w, 4600);
    assert.equal(draft.portico.x + draft.portico.w / 2, center);
    for (const floor of [0, 1, 2]) {
      const svg = floorPlan(floor, false, false, { editorCanvas: true }, planSourceFromDraft(draft, floor));
      const control = svg.match(/<g data-dim-side="north" data-dim-kind="control">([\s\S]*?)<\/g>/)![1];
      assert.deepEqual([...control.matchAll(/class="dim-mm"[^>]*>(\d+)</g)].map(m => +m[1]), [4500, 4600, 4500]);
      const face = facades(floor)[0];
      const central = alignedEntryOpenings(draft).filter(o => o.floor === floor && o.facadeIndex === 0)
        .map(o => face.a[0] + (face.b[0] > face.a[0] ? 1 : -1) * (o.opening.offset + o.opening.width / 2))
        .filter(x => x > draft.portico.x && x < draft.portico.x + draft.portico.w);
      assert.deepEqual(central, [center], "入户门、上窗、露台门均在主楼中轴");
    }
  }
});
