import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type { Mats } from "../src/primitives.ts";

// 每个测试文件有独立 Node 环境，模拟两层半 iframe 的启动身份。
Object.defineProperty(globalThis, "location", { value: new URL("http://localhost/?construction=two-and-half"), configurable: true });
const { applyVillaParams, DEFAULT_VILLA_PARAMS, THREE_STOREY_DEFAULT_PARAMS, normalizeVillaParamsLengths, validateVillaParams } = await import("../src/villa-params.ts");
const { floors, site } = await import("../src/data.ts");
const { buildVilla, roofPlanModel, villaLayoutFromDraft } = await import("../src/architecture.ts");
const { clonePublishedLayout } = await import("../src/layout-draft.ts");
const { halfStoreyHeightProfile, halfStoreyRoof } = await import("../src/half-storey.ts");
const { villaParamsPanelHtml } = await import("../src/villa-params-ui.ts");
const { parseSizeVersionDocument } = await import("../src/data-versions.ts");
const { validateMeetingView, viewFlags } = await import("../src/design-session.ts");
const { halfStoreyClearanceZones } = await import("../src/half-storey-plan.ts");
const { floorPlan, planSourceFromDraft } = await import("../src/plan.ts");
const { elevationShell, elevationSvg } = await import("../src/elevation-plan.ts");
const { elevationPlan } = await import("../src/elevation-plan.ts");
const { loadRealSceneScheme } = await import("../src/real-scene-scheme.ts");
const { createEmptyScheme, parseSchemeDocument } = await import("../src/scheme-store.ts");
const { facades } = await import("../src/facades.ts");
const { readFile } = await import("node:fs/promises");
const { AssemblyExplosion } = await import("../src/assembly-explosion.ts");
const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; } });

// 倾斜脊瓦的轴对齐包围盒偏高，限高核对使用实例顶点的实际世界坐标。
function ridgeTop(root: THREE.Group) {
  root.updateWorldMatrix(true, true);
  const ridge = root.getObjectByName("相接直脊瓦") as THREE.InstancedMesh;
  const positions = ridge.geometry.getAttribute("position"), matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
  let top = -Infinity;
  for (let instance = 0; instance < ridge.count; instance++) {
    ridge.getMatrixAt(instance, matrix);
    matrix.premultiply(ridge.matrixWorld);
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      top = Math.max(top, vertex.y);
    }
  }
  return top;
}

test("两层半拆分沿用独立半层，合拢恢复原标高且不生成三层顶板", () => {
  applyVillaParams(DEFAULT_VILLA_PARAMS);
  const model = buildVilla(mat, false);
  const before = new THREE.Box3().setFromObject(model.group);
  const explosion = new AssemblyExplosion(model, floors.map(f => f.name), false);
  assert.ok(explosion.parts.some(p => p.name === "半层"));
  assert.ok(!explosion.parts.some(p => p.name === "主楼顶板"));
  explosion.apply(1);
  assert.ok(model.levels[2].position.y > model.levels[1].position.y);
  explosion.dispose();
  assert.deepEqual(new THREE.Box3().setFromObject(model.group), before);
  assert.ok(Math.abs(ridgeTop(model.roof) - halfStoreyRoof().peak) < 1);
});

test("两层半层高从本层完成面起算且包含屋面板厚，板上屋面另计，超过参考限高仍可应用", () => {
  applyVillaParams(DEFAULT_VILLA_PARAMS);
  assert.equal(DEFAULT_VILLA_PARAMS.floor1Height, 3600);
  assert.equal(DEFAULT_VILLA_PARAMS.floor2Height, 3300);
  assert.equal(DEFAULT_VILLA_PARAMS.floor3Height, 2000);
  assert.equal(floors[1].y, 4050);
  assert.equal(floors[2].name, "半层");
  assert.equal(floors[2].rooms.filter(r => r.kind === "bed").length, 2);
  assert.equal(halfStoreyRoof().wallTop + 120 - floors[2].y, 2000);
  assert.equal(halfStoreyRoof().peak, 12050.25);
  assert.deepEqual(validateVillaParams(DEFAULT_VILLA_PARAMS), []);
  assert.deepEqual(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, floor3Height: 2200 }), []);
  assert.deepEqual(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, roofFenShui: 7 }), []);
});

test("半层高度明细不重复加板厚，方形屋面限高提示随官帽实际脊瓦顶联动", async () => {
  const { updateVillaParamsMeta } = await import("../src/villa-params-ui.ts");
  const { initializeHalfStoreyContent } = await import("../src/half-storey-content.ts");
  const { facts } = await import("../src/data.ts");
  initializeHalfStoreyContent();
  applyVillaParams(DEFAULT_VILLA_PARAMS);
  assert.equal(facts.find(f => f.label === "层高")!.value, "3600 / 3300 / 2000 mm");
  const html = elevationPlan("east", "floating");
  assert.match(html, /450＋3600＋3300＋2000＋300＋2270＋130＝12050/);
  assert.match(html, /板底 \+9230，板顶 \+9350/);
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 10000 });
    const model = buildVilla(mat, false);
    const actualTop = Math.round(ridgeTop(model.roof));
    assert.equal(actualTop, 12047, "方形悬浮官帽屋面只有斜脊，顶点比名义130预算低数毫米");
    const status = { textContent: "" };
    const root = { querySelector: (selector: string) => selector === "#construction-height-status" ? status : null,
      querySelectorAll: () => [] } as unknown as ParentNode;
    updateVillaParamsMeta(DEFAULT_VILLA_PARAMS, root, "floating");
    assert.match(status.textContent, new RegExp(`已应用屋脊最高点 ${actualTop}`));
    const roof = roofPlanModel("floating");
    assert.equal(Math.round(roof.mainRidgePeak), actualTop);
    for (const view of ["north", "south", "east", "west"] as const) {
      const svg = elevationSvg(view, "floating");
      assert.match(svg, new RegExp(`总高度 ${actualTop}`));
      const parts = [...svg.matchAll(/<g data-height-region="(?!总高度)[^"]+" data-height-bottom="(\d+)" data-height-top="(\d+)">([\s\S]*?)<\/g>/g)];
      assert.equal(parts.reduce((sum, r) => sum + Number(r[3].match(/class="el-dim-label"[^>]*>(\d+)<\/text>/)![1]), 0), actualTop);
    }
    updateVillaParamsMeta(DEFAULT_VILLA_PARAMS, root, "joined");
    assert.match(status.textContent, /已应用屋脊最高点 12050/);
  } finally { applyVillaParams(DEFAULT_VILLA_PARAMS); }
});

test("半层北向退台配置在载入与应用时归零，面板删除模式和退台项", () => {
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, thirdFloorMode: "setback", thirdSetback: 1200 });
  assert.equal(site.setback, 0);
  assert.equal(floors[2].front, site.main.z);
  const params = normalizeVillaParamsLengths({ ...DEFAULT_VILLA_PARAMS, thirdFloorMode: "setback", thirdSetback: 1200 });
  assert.equal(params.thirdFloorMode, "flush");
  assert.equal(params.thirdSetback, 0);
  const html = villaParamsPanelHtml(params);
  assert.doesNotMatch(html, /data-building-variant="thirdFloorMode"|data-villa-param="thirdSetback"|半层北向退台|院坪至二层地面|半层地面至屋脊最高点/);
  assert.match(html, /一层层高/);
  assert.match(html, /3层半层高度/);
});

test("旧半层当前稿、尺寸版本和会议快照仅转换一次并保留原始数据", () => {
  const raw = { ...createEmptyScheme(), villaParams: {
    ...THREE_STOREY_DEFAULT_PARAMS, floor1Height: 3750, floor2Height: 3000, floor3Height: 3000,
  } };
  const before = JSON.stringify(raw);
  const converted = parseSchemeDocument(raw);
  assert.equal(converted.villaParams.floor1Height, 3300);
  assert.equal(converted.villaParams.floor3Height, 300);
  assert.equal(converted.villaParams.halfStoreyHeightMode, "storey");
  assert.ok(Math.abs(halfStoreyHeightProfile(converted.villaParams).peak - 9750) <= .5);
  assert.deepEqual(parseSchemeDocument(converted).villaParams, converted.villaParams);
  const size = parseSizeVersionDocument({ ...raw, schema: "anhua-villa-尺寸-v1" });
  assert.deepEqual(size.villaParams, converted.villaParams);
  const view = { roofStyle: "floating", courtyardFinish: "concrete", neighborCourtyardFinish: "concrete",
    tab: "model", camera: "aerial", level: 0, planMode: "2d", existing: false, balcony: false,
    fenShui: 4.5, roadY: -3000, rampLength: 8000, progress: 0, sunDate: "2026-11-10", sunTime: 12,
    dining: "full", flags: Object.fromEntries(viewFlags.map(key => [key, false])), pose: null, villaParams: raw.villaParams };
  const parsed = validateMeetingView(view);
  assert.deepEqual(parsed.villaParams, converted.villaParams);
  assert.deepEqual(validateMeetingView(parsed).villaParams, converted.villaParams);
  assert.equal(JSON.stringify(raw), before);
});

test("半层外窗顶不得超过飘檐下沿线，限制低于墙顶", async () => {
  const { windowHeadLimit, resolveLayoutFacades, clampExteriorOpeningsToFascia } = await import("../src/facade-layout.ts");
  const { thirdFloorMaxOpeningHead, mainEaveY } = await import("../src/facades.ts");
  const { fasciaBottomY, openingBelowFasciaClearance } = await import("../src/roof-options.ts");
  const { LayoutEditor } = await import("../src/layout-editor.ts");
  const { draftToJson } = await import("../src/layout-draft.ts");
  const maxTop = windowHeadLimit(2);
  assert.equal(maxTop, thirdFloorMaxOpeningHead());
  assert.ok(maxTop < halfStoreyRoof().wallTop - floors[2].y);
  assert.ok(Math.abs(maxTop - (fasciaBottomY(mainEaveY(), 0) - openingBelowFasciaClearance - floors[2].y)) < 1e-6);
  const document = parseSchemeDocument(JSON.parse(await readFile(new URL("../public/scheme/two-and-half/current.json", import.meta.url), "utf8")));
  const draft = structuredClone(document.layoutDraft!);
  const index = draft.exteriorOpenings.findIndex(o => o.floor === 2 && o.opening.kind === "window");
  assert.ok(index >= 0);
  draft.exteriorOpenings[index].opening = { ...draft.exteriorOpenings[index].opening, height: maxTop + 500, sill: 0 };
  assert.equal(clampExteriorOpeningsToFascia(draft), 1);
  assert.equal(draft.exteriorOpenings[index].opening.height, maxTop);
  const halfOpenings = resolveLayoutFacades(draft).facades[2].flatMap(face => face.openings);
  assert.ok(halfOpenings.length >= 8);
  for (const o of halfOpenings) assert.ok(o.sill + o.h <= maxTop + 1e-6, `${o.kind} ${o.sill}+${o.h}`);
  const messages: string[] = [];
  const editor = new LayoutEditor({ getFloor: () => 2, redraw: () => {}, toast: (s: string) => messages.push(s) } as never, draft);
  const selIndex = editor.draft.exteriorOpenings.findIndex(o => o.floor === 2 && o.opening.kind === "window"
    && Math.abs((o.opening.height ?? 0) - maxTop) < 1);
  editor.selection = { kind: "door", floor: 2, index: selIndex >= 0 ? selIndex : index, exterior: true };
  const before = draftToJson(editor.draft);
  editor.updateSelectedNumber("windowHeight", maxTop + 50);
  assert.equal(draftToJson(editor.draft), before);
  assert.match(messages.at(-1)!, /飘檐下沿线/);
});

test("半层独立构造不生成原三楼官帽高柱或通向屋顶的楼梯，完整模型随保存层高联动", async () => {
  const document = parseSchemeDocument(JSON.parse(await readFile(new URL("../public/scheme/two-and-half/current.json", import.meta.url), "utf8")));
  applyVillaParams(document.villaParams);
  assert.equal(document.layoutDraft!.exteriorManaged, true);
  assert.equal(document.layoutDraft!.exteriorOpenings.filter(o => o.floor === 2).length, 9);
  assert.equal(facades(2).length, 4);
  const before = JSON.stringify(document.layoutDraft);
  const model = buildVilla(mat, false, DEFAULT_VILLA_PARAMS.roofFenShui, document.roofStyle, villaLayoutFromDraft(document.layoutDraft!));
  assert.ok(model.levels[2].getObjectByName("半层楼面"));
  assert.ok(!model.levels[2].getObjectByName("三楼官帽柱"));
  assert.equal(model.topSlabs.main.children.length, 0);
  model.group.updateWorldMatrix(true, true);
  assert.ok(Math.abs(ridgeTop(model.roof) - halfStoreyRoof().peak) < 1);
  assert.equal(JSON.stringify(document.layoutDraft), before);
});

test("各层层高、入户抬高及坡度独立驱动楼面、围护和屋顶图", () => {
  for (const changed of [{}, { floor1Height: 3400 }, { floor2Height: 3100 }, { floor3Height: 400 }, { entranceRise: 550 }, { roofFenShui: 4 }]) {
    const params = { ...DEFAULT_VILLA_PARAMS, ...changed };
    applyVillaParams(params);
    const roof = halfStoreyRoof();
    const plan = roofPlanModel("floating", villaLayoutFromDraft(clonePublishedLayout()));
    assert.equal(floors[1].y - params.entranceRise, params.floor1Height);
    assert.equal(floors[2].y - floors[1].y, params.floor2Height);
    assert.equal(roof.wallTop + 120 - floors[2].y, params.floor3Height);
    assert.equal(roof.peak, halfStoreyHeightProfile(params).peak);
    assert.ok(Math.abs(plan.mainPeak + 130 - roof.peak) < .1);
    assert.equal(plan.slabs.main.top, floors[2].y);
    assert.ok(plan.slabs.stairHole, "半层楼面保留下层通来的楼梯洞");
    const model = buildVilla(mat, false);
    const lids = model.roof.getObjectByName("正屋四坡")!.getObjectByName("三眼皮檐口")!;
    const plate = lids.children.map(child => new THREE.Box3().setFromObject(child))
      .sort((a, b) => a.min.y - b.min.y)[0];
    assert.ok(Math.abs(plate.max.y - floors[2].y - params.floor3Height) < .1, "实体檐口板顶为半层层高终点");
    assert.ok(Math.abs(plate.max.y - plate.min.y - 120) < .1, "板厚仅占用层高内120");
    const top = ridgeTop(model.roof);
    assert.ok(Math.abs(top - roof.peak) < 1, `实体脊瓦最高点${top}，参数屋脊${roof.peak}`);
  }
  applyVillaParams(DEFAULT_VILLA_PARAMS);
});

test("低坡半层和超过10米参考限高的方案均可保存载入", async () => {
  const document = parseSchemeDocument(JSON.parse(await readFile(new URL("../public/scheme/two-and-half/current.json", import.meta.url), "utf8")));
  for (const changed of [{ roofFenShui: 1, floor3Height: 300 }, {}]) {
    const params = { ...DEFAULT_VILLA_PARAMS, ...changed };
    applyVillaParams(params);
    const saved = { ...document, villaParams: params, layoutDraft: clonePublishedLayout() };
    assert.doesNotThrow(() => parseSchemeDocument(saved));
    assert.ok(Math.abs(ridgeTop(buildVilla(mat, false).roof) - halfStoreyRoof().peak) < 1);
  }
  applyVillaParams(DEFAULT_VILLA_PARAMS);
});

test("半层户型显示坡下净高参考线，不沿用三层露台和官帽高柱；立面标注自身高度", () => {
  applyVillaParams(DEFAULT_VILLA_PARAMS);
  const draft = clonePublishedLayout();
  const zones = halfStoreyClearanceZones();
  assert.equal(zones.length, 2);
  assert.ok(zones[0].w >= zones[1].w && zones[0].d >= zones[1].d);
  const html = floorPlan(2, false, false, {}, planSourceFromDraft(draft, 2));
  assert.match(html, /data-half-storey-clearance="2100"/);
  assert.doesNotMatch(html, /data-plan-column="hat"|data-plan-column="railing"|中央露台 · 前方敞开/);
  const elevation = elevationSvg("north", "floating", villaLayoutFromDraft(draft));
  assert.match(elevation, /半层楼面/);
  assert.match(elevation, /屋脊最高点 \+12050/);
  const roofRegion = /data-height-region="屋面构造" data-height-bottom="(\d+)" data-height-top="(\d+)"/.exec(elevation)!;
  assert.equal(Number(roofRegion[1]), floors[2].y + DEFAULT_VILLA_PARAMS.floor3Height);
  assert.equal(Number(roofRegion[2]) - Number(roofRegion[1]), 300);
  assert.match(elevation, />2000<\/text>/);
});

test("独立实景加载只读取两层半目录，保存的当前户型不被初始版本覆盖", async t => {
  const scheme = JSON.parse(await readFile(new URL("../public/scheme/two-and-half/current.json", import.meta.url), "utf8"));
  scheme.layoutDraft.floors[0].rooms[0].name = "两层半独立修改";
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (async (url: URL) => {
    const pathname = new URL(url).pathname; requests.push(pathname);
    if (pathname.endsWith("/current.json")) return Response.json(scheme);
    if (pathname.endsWith("/index.json")) return Response.json({ schema: "anhua-villa-data-versions-v1", kind: "户型", versions: [] });
    throw new Error(`不应读取 ${pathname}`);
  }) as typeof fetch;
  const loaded = await loadRealSceneScheme(new URL("http://localhost/villa-3d/"));
  assert.equal(loaded.layoutDraft!.floors[0].rooms[0].name, "两层半独立修改");
  assert.deepEqual(requests.map(decodeURI), ["/villa-3d/scheme/two-and-half/current.json", "/villa-3d/data/two-and-half/户型/index.json"]);
});


test("两层半侧立面各层南端外墙投影齐平，补齐下层墙角搭接", () => {
  applyVillaParams(DEFAULT_VILLA_PARAMS);
  const back = site.main.z + site.main.d;
  for (const view of ["east", "west"] as const) {
    const { model, surfaces } = elevationShell(view, "floating");
    for (const floor of model.floors) {
      const walls = surfaces.filter(s => s.cls === "el-wall" && s.points.some(p => p.y === floor.y));
      assert.ok(walls.length > 0);
      assert.equal(Math.max(...walls.flatMap(s => s.points.map(p => p.z))), back);
    }
  }
});

test("两层半四周通高包角柱顶对齐正屋下沿线底", async () => {
  const { mainRoofFootprint } = await import("../src/architecture.ts");
  const { fasciaBottomY } = await import("../src/roof-options.ts");
  applyVillaParams(DEFAULT_VILLA_PARAMS);
  const villa = buildVilla(mat, false, undefined, "floating");
  const expect = fasciaBottomY(mainRoofFootprint().eave, 0);
  const corners = villa.facadeColumns.children.filter(o => o.name === "包角柱");
  assert.equal(corners.length, 4, "南北左右共四根通高包角柱");
  for (const column of corners) {
    const top = new THREE.Box3().setFromObject(column).max.y;
    assert.ok(Math.abs(top - expect) < 0.1, `包角柱顶 ${top} 应对齐下沿线底 ${expect}`);
  }
});
