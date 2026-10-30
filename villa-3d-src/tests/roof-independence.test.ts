import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { attachRoofs, elevationModel, roofPlanModel } from "../src/architecture";
import { elevationSvg } from "../src/elevation-plan";
import { roofPlan } from "../src/roof-plan";
import { villaParamsPanelHtml } from "../src/villa-params-ui";
import { ANNEX_ROOF_PARAM_KEYS, applyVillaParams, DEFAULT_VILLA_PARAMS, getVillaParams,
  normalizeVillaParamsLengths, resetVillaParams, validateVillaParams, type VillaParams } from "../src/villa-params";
import { annexRoofProfile, roofGutterDesign, roofTileInset, withAnnexRoofDesign } from "../src/roof-options";
import { createEmptyScheme, parseSchemeDocument, schemeToJson } from "../src/scheme-store";
import { parseSizeVersionDocument, sizeDocSchema } from "../src/data-versions";
import { validateMeetingView, viewFlags } from "../src/design-session";
import { VILLA_PARAM_NON_LENGTH } from "../src/units";
import type { Mats } from "../src/primitives";

const changedAnnex: VillaParams = { ...DEFAULT_VILLA_PARAMS,
  annexEave: 1100, annexRoofFenShui: 6, annexGutterClearWidth: 450,
  annexGutterClearDepth: 260, annexGutterInnerDepth: 320, annexGutterOuterTopWidth: 250,
  annexGutterBedSlope: 2, annexGutterTileGap: 80, annexGutterTileOverhang: 60,
  annexGutterCopingSlope: 7, annexCorbelLength: 600, annexCorbelSpacing: 900,
  annexCorbelCornerSpacing: 800, annexEyelidToFasciaGap: 400 };
const changedMain: VillaParams = { ...DEFAULT_VILLA_PARAMS,
  roofFenShui: 6, thirdEave: 1000, secondFrontEave: 900, gutterClearWidth: 750,
  gutterClearDepth: 300, gutterInnerDepth: 380, gutterOuterTopWidth: 350,
  gutterBedSlope: 2, gutterTileGap: 80, gutterTileOverhang: 100,
  gutterCopingSlope: 6, corbelLength: 600, corbelSpacing: 900,
  corbelCornerSpacing: 800, eyelidToFasciaGap: 400, floatingHatHeightOffset: -200 };

function legacyParams() {
  const legacy: Partial<VillaParams> = { ...changedMain, annexEave: 500 };
  for (const field of Object.values(ANNEX_ROOF_PARAM_KEYS)) delete legacy[field];
  return legacy;
}
function meeting(villaParams: Partial<VillaParams>) {
  return { roofStyle: "floating", courtyardFinish: "concrete", neighborCourtyardFinish: "concrete",
    tab: "model", camera: "aerial", level: -1, planMode: "2d", existing: false, balcony: false,
    fenShui: villaParams.roofFenShui, roadY: -1860, rampLength: 5000, progress: 0,
    sunDate: "2026-10-28", sunTime: 10, dining: "full", pose: null, villaParams,
    flags: Object.fromEntries(viewFlags.map(key => [key, false])) };
}

test("屋面字段归入主楼与辅楼，各字段仅出现一次，辅楼不出现官帽", () => {
  const html = villaParamsPanelHtml();
  const pane = (id: string) => html.split(`data-params-pane="${id}"`)[1]?.split('role="tabpanel"')[1]?.split('<div class="params-pane')[0] ?? "";
  assert.doesNotMatch(html, /data-params-tab="roof"/);
  for (const [main, annex] of Object.entries(ANNEX_ROOF_PARAM_KEYS)) {
    assert.ok(pane("main").includes(`data-villa-param="${main}"`));
    assert.ok(pane("annex").includes(`data-villa-param="${annex}"`));
    assert.equal(html.split(`data-villa-param="${annex}"`).length, 2);
  }
  assert.match(pane("main"), /data-roof-style="floating"/);
  assert.match(pane("main"), /data-villa-param="floatingHatHeightOffset"/);
  assert.doesNotMatch(html, /floatingHatRidgeDrop|悬浮官帽落脊/);
  assert.match(pane("annex"), /data-villa-param="annexEave"/);
  assert.doesNotMatch(pane("annex"), /官帽|floatingHatHeightOffset|secondFrontEave|data-roof-style/);
});

test("旧毫米与米制方案、尺寸版本及会议快照继承原共用屋面参数", () => {
  const mm = legacyParams();
  const meter = Object.fromEntries(Object.entries(mm).map(([key, value]) => [key,
    typeof value === "number" && !VILLA_PARAM_NON_LENGTH.has(key) ? value / 1000 : value]));
  for (const [units, raw] of [["mm", mm], ["m", meter]] as const) {
    const results = [normalizeVillaParamsLengths(raw),
      parseSchemeDocument({ ...createEmptyScheme(), units, villaParams: raw }).villaParams,
      parseSizeVersionDocument({ schema: sizeDocSchema, units, villaParams: raw }).villaParams,
      validateMeetingView(meeting(raw)).villaParams];
    for (const p of results) {
      for (const [main, annex] of Object.entries(ANNEX_ROOF_PARAM_KEYS) as [keyof typeof ANNEX_ROOF_PARAM_KEYS, typeof ANNEX_ROOF_PARAM_KEYS[keyof typeof ANNEX_ROOF_PARAM_KEYS]][])
        assert.ok(Math.abs(p[annex] - p[main]) < 1e-6, `${units}: ${annex}`);
      assert.equal(p.annexEave, changedMain.thirdEave, "旧无效辅楼出檐按原实际效果恢复");
    }
  }
  const { villaParams: _params, ...oldMeeting } = meeting(mm);
  assert.equal(validateMeetingView({ ...oldMeeting, fenShui: 6 }).villaParams.annexRoofFenShui, 6);
});

test("独立参数随方案、尺寸版本和会议快照完整回读，应用后仍保持不同值", () => {
  const params = { ...changedMain, ...Object.fromEntries(Object.values(ANNEX_ROOF_PARAM_KEYS).map(key => [key, changedAnnex[key]])), annexEave: changedAnnex.annexEave };
  try {
    const doc = { ...createEmptyScheme(), villaParams: params };
    const results = [parseSchemeDocument(JSON.parse(schemeToJson(doc))).villaParams,
      parseSizeVersionDocument({ schema: sizeDocSchema, units: "mm", villaParams: params }).villaParams,
      validateMeetingView(meeting(params)).villaParams];
    for (const result of results) {
      assert.deepEqual(result, params);
      applyVillaParams(result);
      assert.deepEqual(getVillaParams(), params);
    }
  } finally { resetVillaParams(); }
});

test("两种官帽与主辅楼换位时，屋面、烟囱及四向立面仅随所属楼参数变化", () => {
  try {
    for (const buildingPlacement of ["main-east", "main-west"] as const)
      for (const style of ["floating", "joined"] as const) {
        applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement });
        const baseline = roofPlanModel(style), chimney = elevationModel(style).chimney;
        const views = ["north", "south", "east", "west"] as const;
        const mainSvg = views.map(view => elevationSvg(view, style)), annexSvg = views.map(view => elevationSvg(view, style, undefined, false, "annex"));
        applyVillaParams({ ...changedAnnex, buildingPlacement });
        const a = roofPlanModel(style);
        assert.deepEqual(a.mainFaces, baseline.mainFaces);
        assert.deepEqual(a.hat, baseline.hat);
        assert.deepEqual(views.map(view => elevationSvg(view, style)), mainSvg);
        assert.notDeepEqual(a.annexFaces, baseline.annexFaces);
        assert.notDeepEqual(elevationModel(style).chimney, chimney);
        assert.equal(a.pitch.annexRise / a.pitch.annexRun, 0.6);
        assert.match(roofPlan(style, style), /主楼出檐 800/);
        assert.match(roofPlan(style, style), /辅楼出檐 1100/);
        applyVillaParams({ ...changedMain, buildingPlacement });
        const m = roofPlanModel(style);
        assert.deepEqual(m.annexFaces, baseline.annexFaces);
        assert.deepEqual(elevationModel(style).chimney, chimney);
        assert.deepEqual(views.map(view => elevationSvg(view, style, undefined, false, "annex")), annexSvg);
        assert.notDeepEqual(m.mainFaces, baseline.mainFaces);
        assert.equal(m.pitch.mainRise / m.pitch.mainRun, 0.6);
      }
  } finally { resetVillaParams(); }
});

function geometryDigest(root: THREE.Object3D) {
  const hash = createHash("sha256");
  root.traverse(object => {
    hash.update(JSON.stringify([object.name, object.position.toArray(), object.rotation.toArray(), object.scale.toArray()]));
    if (!(object instanceof THREE.Mesh)) return;
    for (const attribute of Object.values(object.geometry.attributes)) {
      const array = attribute.array;
      hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
    }
  });
  return hash.digest("hex");
}
function roofs() {
  const main = new THREE.Group(), annex = new THREE.Group();
  const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) {
    return target[key] ??= new THREE.MeshPhysicalMaterial() as never;
  } });
  attachRoofs(main, annex, mat, getVillaParams().roofFenShui, "floating");
  return [geometryDigest(main), geometryDigest(annex)];
}
test("真实三维屋面含天沟、梁托、下沿线及灯带均独立，切换后无参数泄漏", () => {
  try {
    resetVillaParams();
    const baseline = roofs();
    applyVillaParams(changedAnnex);
    const annex = roofs();
    assert.equal(annex[0], baseline[0]);
    assert.notEqual(annex[1], baseline[1]);
    applyVillaParams(changedMain);
    const main = roofs();
    assert.equal(main[1], baseline[1]);
    assert.notEqual(main[0], baseline[0]);
    resetVillaParams();
    assert.deepEqual(roofs(), baseline);
    const inset = roofTileInset, gutter = roofGutterDesign;
    assert.throws(() => withAnnexRoofDesign(() => { throw new Error("abort"); }), /abort/);
    assert.equal(roofTileInset, inset);
    assert.equal(roofGutterDesign, gutter);
  } finally { resetVillaParams(); }
});

test("辅楼每个屋面控制项单独应用都改变辅楼几何，主楼几何保持一致", () => {
  try {
    resetVillaParams();
    const baseline = roofs();
    const values = { annexEave: 1000, annexRoofFenShui: 6, annexGutterClearWidth: 450,
      annexGutterClearDepth: 220, annexGutterInnerDepth: 280, annexGutterOuterTopWidth: 350,
      annexGutterBedSlope: 2, annexGutterTileGap: 80, annexGutterTileOverhang: 100,
      annexGutterCopingSlope: 6, annexCorbelLength: 550, annexCorbelSpacing: 900,
      annexCorbelCornerSpacing: 500, annexEyelidToFasciaGap: 400 };
    for (const [field, value] of Object.entries(values)) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, [field]: value });
      const changed = roofs();
      assert.equal(changed[0], baseline[0], field);
      assert.notEqual(changed[1], baseline[1], field);
    }
  } finally { resetVillaParams(); }
});

test("辅楼按自身出檐和屋面跨度校验，错误定位到辅楼字段", () => {
  assert.deepEqual(validateVillaParams(changedAnnex), []);
  assert.deepEqual(validateVillaParams(changedMain), []);
  for (const [field, value] of Object.entries({ annexRoofFenShui: 11, annexCorbelLength: 900,
    annexGutterClearWidth: 3000, annexGutterInnerDepth: 150, annexGutterTileOverhang: 600,
    annexGutterBedSlope: 5, annexGutterCopingSlope: 16 }))
    assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, [field]: value }).some(issue => issue.field === field), field);
  assert.equal(annexRoofProfile().clearWidth, DEFAULT_VILLA_PARAMS.annexGutterClearWidth);
});
