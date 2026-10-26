import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, effectiveThirdSetback, getVillaParams, resetVillaParams, validateVillaParams } from "../src/villa-params";
import { floors, site, facts } from "../src/data";
import { clonePublishedLayout, envelopeFromSite, ensureExteriorManaged, scaleLayoutDraftToEnvelope } from "../src/layout-draft";
import { buildSchemeDocument, parseSchemeDocument } from "../src/scheme-store";
import { buildSizeVersionDocument, parseSizeVersionDocument } from "../src/data-versions";
import { validateMeetingView, viewFlags, type MeetingView } from "../src/design-session";
import { buildVilla, mainRoofFootprint, roofPitch, villaLayoutFromDraft } from "../src/architecture";
import { frontTerracePosts, recessedFootprint } from "../src/building-variants";
import { frontTerraceRailRuns } from "../src/facade-details";
import { resolveLayoutFacades } from "../src/facade-layout";
import { floorPlan, planSourceFromDraft } from "../src/plan";
import { roofPlanSvg } from "../src/roof-plan";
import { elevationSvg } from "../src/elevation-plan";
import { villaParamsPanelHtml } from "../src/villa-params-ui";
import { polygonAreaMm2 } from "../src/room-geometry";
import { controlTable } from "../src/meeting-booklet";
import { designBrief, designIssues } from "../src/design-data";
import type { Mats } from "../src/primitives";

test.afterEach(resetVillaParams);
const flush = { ...DEFAULT_VILLA_PARAMS, thirdFloorMode: "flush" as const };

test("不内退模式保留配置退距，外墙、顶板、屋顶坡度使用实际零退距", () => {
  const lower = structuredClone(floors.slice(0, 2));
  const rise = roofPitch().mainRise;
  applyVillaParams({ ...flush, thirdSetback: 1800 });
  assert.equal(getVillaParams().thirdSetback, 1800);
  assert.equal(effectiveThirdSetback(getVillaParams()), 0);
  assert.equal(site.setback, 0);
  assert.equal(floors[2].front, floors[1].front);
  assert.equal(polygonAreaMm2(recessedFootprint(floors[2].front)), 136000000);
  assert.equal(mainRoofFootprint().d, 11600);
  assert.equal(mainRoofFootprint().z, site.main.z - 800);
  assert.ok(roofPitch().mainRise > rise);
  assert.equal(site.roofRise, roofPitch().mainRise);
  assert.deepEqual(floors.slice(0, 2), lower);
  applyVillaParams({ ...getVillaParams(), thirdFloorMode: "setback" });
  assert.equal(floors[2].front - floors[1].front, 1800);
});

test("模式单独校验，禁用的退距不缩小主体或凹入门厅可用进深", () => {
  assert.deepEqual(validateVillaParams({ ...flush, porticoStyle: "recessed", thirdSetback: 9000 }), []);
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, thirdSetback: 9000 }).some(i => i.field === "thirdSetback"));
  assert.ok(validateVillaParams({ ...flush, thirdFloorMode: "unknown" as never }).some(i => i.field === "thirdFloorMode"));
  assert.ok(validateVillaParams({ ...flush, thirdSetback: -1 }).some(i => i.field === "thirdSetback"));
});

test("当前户型切换时接北墙房间及墙端伸到新前墙，楼梯与门洞世界位置不动，往返不叠乘", () => {
  const draft = ensureExteriorManaged(clonePublishedLayout()), before = structuredClone(draft);
  const oldFront = draft.floors[2].front;
  draft.floors[2].partitions.push({ a: [site.portico.x, oldFront], b: [site.portico.x, oldFront + 3500], door: { offset: 1500, width: 900, kind: "door" } });
  const staged = structuredClone(draft), source = JSON.stringify(draft);
  applyVillaParams(flush);
  const full = scaleLayoutDraftToEnvelope(draft, envelopeFromSite());
  assert.equal(JSON.stringify(draft), source);
  for (const room of full.floors[2].rooms.filter(r => r.kind !== "stair" && staged.floors[2].rooms.find(o => o.id === r.id)!.z === oldFront)) {
    const original = staged.floors[2].rooms.find(o => o.id === room.id)!;
    assert.equal(room.z, site.main.z, room.id);
    assert.equal(room.z + room.d, original.z + original.d, room.id);
  }
  assert.deepEqual(full.stairLayout, draft.stairLayout);
  assert.deepEqual(full.floors.slice(0, 2), before.floors.slice(0, 2));
  const wall = full.floors[2].partitions.at(-1)!;
  assert.equal(wall.a[1] + wall.door!.offset, oldFront + 1500);
  assert.deepEqual(scaleLayoutDraftToEnvelope(full, envelopeFromSite()), full);
  resetVillaParams();
  const restored = scaleLayoutDraftToEnvelope(full, envelopeFromSite());
  assert.deepEqual(restored.floors, staged.floors);
  assert.deepEqual(restored.exteriorOpenings, staged.exteriorOpenings);
});

test("两翼原露台推拉门派生为窗，中央入口和源稿保留，切回恢复推拉门", () => {
  const draft = ensureExteriorManaged(clonePublishedLayout()), source = JSON.stringify(draft);
  applyVillaParams(flush);
  const full = scaleLayoutDraftToEnvelope(draft, envelopeFromSite());
  const front = resolveLayoutFacades(full).facades[2][0];
  assert.equal(front.openings.filter(o => o.door).length, 1);
  assert.equal(front.openings.filter(o => !o.door && o.sill === 900).length, 2);
  const shown = planSourceFromDraft(full, 2).exteriorOpenings.filter(o => o.floor === 2 && o.facadeIndex === 0);
  assert.equal(shown.filter(o => o.opening.kind === "window").length, 2);
  assert.equal(JSON.stringify(draft), source);
  resetVillaParams();
  const restored = scaleLayoutDraftToEnvelope(full, envelopeFromSite());
  assert.equal(resolveLayoutFacades(restored).facades[2][0].openings.filter(o => o.door).length, 3);
});

test("完整方案、尺寸版本及会议快照保存模式和退距，旧文件缺项保持内退", () => {
  applyVillaParams({ ...flush, thirdSetback: 1600 });
  const scheme = buildSchemeDocument({}), size = buildSizeVersionDocument();
  assert.deepEqual(parseSchemeDocument(JSON.parse(JSON.stringify(scheme))).villaParams, getVillaParams());
  assert.deepEqual(parseSizeVersionDocument(JSON.parse(JSON.stringify(size))).villaParams, getVillaParams());
  const view: MeetingView = {
    roofStyle: "joined", courtyardFinish: "concrete", neighborCourtyardFinish: "concrete",
    tab: "model", camera: "north", level: 2, planMode: "3d", existing: false, balcony: false,
    fenShui: 4.5, roadY: -1860, rampLength: 5000, progress: 72, sunDate: "2026-10-24", sunTime: 10,
    dining: "full", flags: Object.fromEntries(viewFlags.map(key => [key, true])), pose: null, villaParams: getVillaParams(),
  };
  assert.deepEqual(validateMeetingView(JSON.parse(JSON.stringify(view))).villaParams, getVillaParams());
  for (const doc of [scheme, size, view]) delete (doc.villaParams as Partial<typeof doc.villaParams>).thirdFloorMode;
  assert.equal(parseSchemeDocument(scheme).villaParams.thirdFloorMode, "setback");
  assert.equal(parseSizeVersionDocument(size).villaParams.thirdFloorMode, "setback");
  assert.equal(validateMeetingView(view).villaParams.thirdFloorMode, "setback");
});

test("尺寸面板提供即时切换，不内退时保留并禁用退台尺寸", () => {
  const html = villaParamsPanelHtml(flush);
  assert.match(html, /data-building-variant="thirdFloorMode" data-variant-value="flush" aria-pressed="true"/);
  assert.match(html, /data-villa-param="thirdSetback"[^>]*value="1200"[^>]*disabled/);
  assert.doesNotMatch(villaParamsPanelHtml(DEFAULT_VILLA_PARAMS), /data-villa-param="thirdSetback"[^>]*disabled/);
});

test("不内退的资料与图纸不残留两侧露台，主楼进深显示10000", () => {
  applyVillaParams(flush);
  const draft = clonePublishedLayout();
  const plan = floorPlan(2, false, false, {}, planSourceFromDraft(draft, 2));
  const roof = roofPlanSvg("slab", "joined", villaLayoutFromDraft(draft));
  assert.doesNotMatch(plan + roof, />(?:三层)?[西东]侧露台[^<]*</);
  assert.match(plan, /三楼不内退/);
  assert.match(roof, /三层中央露台/);
  assert.match(roof, />10000</);
  assert.match(facts.find(f => f.label === "三楼北退")!.value, /不内退/);
  assert.match(controlTable(), /不内退／10000/);
  assert.match(designBrief[1].text + designIssues.find(i => i.id === "D14")!.current, /仅保留中央门厅露台/);
});

test("不内退组合支持两种门厅、主辅楼位置和官帽，撤销旧退台构件，模型及四向图纸有限", () => {
  const mat = new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });
  for (const porticoStyle of ["projecting", "recessed"] as const) for (const buildingPlacement of ["main-east", "main-west"] as const) {
    applyVillaParams({ ...flush, porticoStyle, buildingPlacement });
    assert.equal(frontTerracePosts().length, 2);
    assert.equal(frontTerraceRailRuns(floors[2].front).length, 3);
    assert.ok(frontTerraceRailRuns(floors[2].front).slice(1).every(run => run.b[1] > run.a[1]));
    const layout = villaLayoutFromDraft(clonePublishedLayout());
    for (const style of ["joined", "floating"] as const) {
      const model = buildVilla(mat, false, 4.5, style, layout);
      assert.ok(model.group.getObjectByName("中央露台两根短柱"));
      assert.ok(model.group.getObjectByName("外伸门厅三楼平台"));
      for (const name of ["三楼左侧露台", "三楼右侧露台", "四根露台短柱"]) assert.equal(model.group.getObjectByName(name), undefined);
      model.group.traverse(o => { if (o instanceof THREE.Mesh) {
        const p = o.geometry.getAttribute("position");
        if (p) assert.ok(Array.from(p.array).every(Number.isFinite), o.name);
        o.geometry.dispose();
      } });
      assert.doesNotMatch(roofPlanSvg(style, style, layout), /NaN|Infinity/);
      for (const side of ["north", "south", "east", "west"] as const) assert.doesNotMatch(elevationSvg(side, style, layout), /NaN|Infinity/);
    }
  }
  for (const material of Object.values(mat)) material.dispose();
  resetVillaParams();
  assert.equal(frontTerracePosts().length, 4);
  assert.equal(frontTerraceRailRuns(floors[2].front).length, 7);
});
