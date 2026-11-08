import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type { Mats } from "../src/primitives.ts";

// 每个测试文件有独立 Node 环境，模拟两层半 iframe 的启动身份。
Object.defineProperty(globalThis, "location", { value: new URL("http://localhost/?construction=two-and-half"), configurable: true });
const { applyVillaParams, DEFAULT_VILLA_PARAMS, validateVillaParams } = await import("../src/villa-params.ts");
const { floors } = await import("../src/data.ts");
const { buildVilla, roofPlanModel, villaLayoutFromDraft } = await import("../src/architecture.ts");
const { clonePublishedLayout } = await import("../src/layout-draft.ts");
const { halfStoreyRoof } = await import("../src/half-storey.ts");
const { halfStoreyClearanceZones } = await import("../src/half-storey-plan.ts");
const { floorPlan, planSourceFromDraft } = await import("../src/plan.ts");
const { elevationSvg } = await import("../src/elevation-plan.ts");
const { loadRealSceneScheme } = await import("../src/real-scene-scheme.ts");
const { parseSchemeDocument } = await import("../src/scheme-store.ts");
const { facades } = await import("../src/facades.ts");
const { readFile } = await import("node:fs/promises");
const { AssemblyExplosion } = await import("../src/assembly-explosion.ts");
const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; } });

test("两层半拆分沿用独立半层，合拢恢复限高且不生成三层顶板", () => {
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
  assert.ok(before.max.y <= 10000.1);
});

test("两层半独立默认值为3300实层高、3000二层和3000屋脊预算，默认屋脊9750", () => {
  assert.equal(DEFAULT_VILLA_PARAMS.floor1Height - DEFAULT_VILLA_PARAMS.entranceRise, 3300);
  assert.equal(DEFAULT_VILLA_PARAMS.floor2Height, 3000);
  assert.equal(floors[2].name, "半层");
  assert.equal(floors[2].rooms.filter(r => r.kind === "bed").length, 0);
  assert.equal(halfStoreyRoof().peak, 9750);
  assert.deepEqual(validateVillaParams(DEFAULT_VILLA_PARAMS), []);
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, floor3Height: 3300 }).some(i => i.field === "floor3Height"));
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, roofFenShui: 7 }).some(i => i.field === "floor3Height"));
});

test("半层独立构造不生成原三楼官帽高柱或通向屋顶的楼梯，完整模型不越10000", async () => {
  const document = parseSchemeDocument(JSON.parse(await readFile(new URL("../public/scheme/two-and-half/current.json", import.meta.url), "utf8")));
  applyVillaParams(document.villaParams);
  assert.equal(document.layoutDraft!.exteriorManaged, true);
  assert.equal(document.layoutDraft!.exteriorOpenings.filter(o => o.floor === 2).length, 0);
  assert.equal(facades(2).length, 4);
  const before = JSON.stringify(document.layoutDraft);
  const model = buildVilla(mat, false, DEFAULT_VILLA_PARAMS.roofFenShui, document.roofStyle, villaLayoutFromDraft(document.layoutDraft!));
  assert.ok(model.levels[2].getObjectByName("半层楼面"));
  assert.ok(!model.levels[2].getObjectByName("三楼官帽柱"));
  assert.equal(model.topSlabs.main.children.length, 0);
  model.group.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model.group);
  assert.ok(bounds.max.y <= 10000.1, `实际模型最高点 ${bounds.max.y}`);
  assert.equal(JSON.stringify(document.layoutDraft), before);
});

test("调整两层半层高和坡度后屋脊仍按预算联动，屋顶图和户型使用同一参数", () => {
  for (const params of [DEFAULT_VILLA_PARAMS, { ...DEFAULT_VILLA_PARAMS, floor3Height: 2900 }, { ...DEFAULT_VILLA_PARAMS, roofFenShui: 4 }]) {
    applyVillaParams(params);
    const plan = roofPlanModel("floating", villaLayoutFromDraft(clonePublishedLayout()));
    assert.ok(Math.abs(plan.mainPeak + 130 - (params.floor1Height + params.floor2Height + params.floor3Height)) < .1);
    assert.equal(plan.slabs.main.top, floors[2].y);
    assert.ok(plan.slabs.stairHole, "半层楼面保留下层通来的楼梯洞");
  }
  applyVillaParams(DEFAULT_VILLA_PARAMS);
});

test("半层户型显示坡下净高参考线，不沿用三层露台和官帽高柱；立面标注自身高度", () => {
  applyVillaParams(DEFAULT_VILLA_PARAMS);
  const draft = clonePublishedLayout();
  const zones = halfStoreyClearanceZones();
  assert.equal(zones.length, 2);
  assert.ok(zones[0].w > zones[1].w && zones[0].d > zones[1].d);
  const html = floorPlan(2, false, false, {}, planSourceFromDraft(draft, 2));
  assert.match(html, /data-half-storey-clearance="2100"/);
  assert.doesNotMatch(html, /data-plan-column="hat"|data-plan-column="railing"|中央露台 · 前方敞开/);
  const elevation = elevationSvg("north", "floating", villaLayoutFromDraft(draft));
  assert.match(elevation, /半层楼面/);
  assert.match(elevation, /屋脊最高点 \+9750/);
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
