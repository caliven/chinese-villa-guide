import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { attachRoofs, buildVilla, floatingHatLayout, roofPlanModel, roofPitch } from "../src/architecture";
import { fasciaBottomY, floatingHatDesign, roofTileEaveLift, roofTileInset } from "../src/roof-options";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, floatingHatHeightLimits, normalizeVillaParamsLengths,
  resetVillaParams, validateVillaParams, type VillaParams } from "../src/villa-params";
import { parseVillaParamNumber, readVillaParamsFromDom, sanitizeVillaParamInput, villaParamsPanelHtml } from "../src/villa-params-ui";
import { createEmptyScheme, parseSchemeDocument, schemeToJson } from "../src/scheme-store";
import { parseSizeVersionDocument, sizeDocSchema } from "../src/data-versions";
import { validateMeetingView, viewFlags } from "../src/design-session";
import { VILLA_PARAM_NON_LENGTH } from "../src/units";
import type { Mats } from "../src/primitives";

const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) {
  return target[key] ??= new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide }) as never;
} });
const close = (a: number, b: number, message?: string) => assert.ok(Math.abs(a - b) < .02, message ?? `${a} != ${b}`);
const dispose = (root: THREE.Object3D) => root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
test.afterEach(resetVillaParams);
test.after(() => Object.values(mat).forEach(m => m.dispose()));

function topHits(root: THREE.Object3D, x: number, z: number) {
  const surfaces: THREE.Object3D[] = [];
  root.traverse(o => { if (o.name === "封闭瓦面") surfaces.push(o); });
  const hits = new THREE.Raycaster(new THREE.Vector3(x, 25000, z), new THREE.Vector3(0, -1, 0))
    .intersectObjects(surfaces, false).filter(hit => (hit.face?.normal.y ?? 0) > .01);
  return hits.filter((hit, i) => !hits.slice(0, i).some(other =>
    hit.point.distanceTo(other.point) < 1e-4 &&
    (hit.object === other.object || hit.face!.normal.dot(other.face!.normal) < 1 - 1e-8)));
}

test("升降输入保留正负号和整数毫米，普通尺寸仍拒绝负数，辅楼不出现此项", () => {
  assert.equal(parseVillaParamNumber("-200", true), -200);
  assert.equal(parseVillaParamNumber("−200", true), -200);
  assert.equal(parseVillaParamNumber("+200", true), 200);
  assert.equal(parseVillaParamNumber("-200"), null);
  assert.equal(parseVillaParamNumber("--200", true), null);
  for (const raw of ["-200", "+200", "0", "-200.4"]) {
    const input = { dataset: { villaParam: "floatingHatHeightOffset", paramMin: "-80000", paramMax: "80000" },
      value: raw, readOnly: false, disabled: false } as HTMLInputElement;
    const root = { querySelectorAll: () => [input] } as unknown as ParentNode;
    sanitizeVillaParamInput(input, true);
    assert.equal(readVillaParamsFromDom(root).floatingHatHeightOffset, Math.round(Number(raw)));
  }
  const html = villaParamsPanelHtml();
  assert.equal(html.split('data-villa-param="floatingHatHeightOffset"').length, 2);
  assert.doesNotMatch(html.split('data-params-pane="annex"')[1].split('data-params-pane=')[0], /floatingHatHeightOffset/);
});

function meeting(villaParams: Partial<VillaParams>) {
  return { roofStyle: "floating", courtyardFinish: "concrete", neighborCourtyardFinish: "concrete",
    tab: "model", camera: "aerial", level: -1, planMode: "2d", existing: false, balcony: false,
    fenShui: villaParams.roofFenShui, roadY: -1860, rampLength: 5000, progress: 0,
    sunDate: "2026-10-29", sunTime: 10, dining: "full", pose: null, villaParams,
    flags: Object.fromEntries(viewFlags.map(key => [key, false])) };
}
test("旧稿补零，新升降参数随毫米或米制方案、尺寸和会议快照回读", () => {
  const old: Partial<VillaParams> = { ...DEFAULT_VILLA_PARAMS };
  delete old.floatingHatHeightOffset;
  assert.equal(normalizeVillaParamsLengths(old).floatingHatHeightOffset, 0);
  for (const offset of [-200, 200]) {
    const p = { ...DEFAULT_VILLA_PARAMS, floatingHatHeightOffset: offset };
    const doc = { ...createEmptyScheme(), villaParams: p };
    assert.equal(parseSchemeDocument(JSON.parse(schemeToJson(doc))).villaParams.floatingHatHeightOffset, offset);
    for (const units of ["mm", "m"]) {
      const raw = Object.fromEntries(Object.entries(p).map(([key, value]) => [key,
        units === "m" && typeof value === "number" && !VILLA_PARAM_NON_LENGTH.has(key) ? value / 1000 : value]));
      assert.equal(parseSchemeDocument({ ...doc, units, villaParams: raw }).villaParams.floatingHatHeightOffset, offset);
      assert.equal(parseSizeVersionDocument({ schema: sizeDocSchema, units, villaParams: raw }).villaParams.floatingHatHeightOffset, offset);
      assert.equal(validateMeetingView(meeting(raw)).villaParams.floatingHatHeightOffset, offset);
    }
  }
});

test("删除落脊字段后不折算旧值，不再读写第二个高度参数", () => {
  const input = { ...DEFAULT_VILLA_PARAMS, floatingHatRidgeDrop: 900, floatingHatHeightOffset: 200 };
  const doc = parseSchemeDocument({ ...createEmptyScheme(), villaParams: input });
  for (const params of [normalizeVillaParamsLengths(input), doc.villaParams,
    parseSizeVersionDocument({ schema: sizeDocSchema, units: "mm", villaParams: input }).villaParams,
    validateMeetingView(meeting(input)).villaParams]) {
    assert.equal(Object.hasOwn(params, "floatingHatRidgeDrop"), false);
    assert.equal(params.floatingHatHeightOffset, 200);
    applyVillaParams(params);
    const roof = roofPlanModel("floating");
    close(roof.mainPeak - roof.hat.peak, 300, "位置只由默认零点与升降200决定");
  }
  assert.doesNotMatch(schemeToJson(doc), /floatingHatRidgeDrop/);
});

test("零升降保留默认定位，正负升降保持帽体坡度和宽度，主屋基准与辅楼及普通官帽不变", () => {
  resetVillaParams();
  const before = roofPlanModel("floating"), joined = roofPlanModel("joined");
  const run = (before.hat.w - 2 * roofTileInset) / 2;
  close(before.hat.peak, before.mainPeak - 500);
  close(before.hat.eave, before.hat.peak - roofTileEaveLift() - run * DEFAULT_VILLA_PARAMS.roofFenShui / 10);
  for (const offset of [-200, 200]) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, floatingHatHeightOffset: offset });
    const after = roofPlanModel("floating");
    close(after.hat.peak - before.hat.peak, offset);
    close(after.hat.eave - before.hat.eave, offset);
    close(after.hat.peak - after.hat.eave, before.hat.peak - before.hat.eave);
    assert.equal(after.hat.w, before.hat.w);
    assert.deepEqual(after.main, before.main);
    assert.equal(after.mainPeak, before.mainPeak);
    assert.deepEqual(after.annexFaces, before.annexFaces);
    assert.deepEqual(roofPlanModel("joined"), joined);
  }
});

test("升降上下限随主屋和门厅组合计算，边界保留净空和正向纵脊，越界不接受", () => {
  for (const buildingPlacement of ["main-east", "main-west"] as const)
    for (const porticoStyle of ["projecting", "recessed"] as const)
      for (const thirdFloorMode of ["setback", "flush"] as const)
        for (const roofFenShui of [1, 4.5, 10]) {
          const p = { ...DEFAULT_VILLA_PARAMS, buildingPlacement, porticoStyle, thirdFloorMode, roofFenShui };
          const { minOffset, maxOffset } = floatingHatHeightLimits(p);
          assert.ok(minOffset <= 0 && maxOffset >= 0, "自动零点必须落在可用范围内");
          applyVillaParams(p);
          assert.equal(floatingHatLayout().heightOffset, 0);
          for (const offset of [minOffset, maxOffset]) {
            const candidate = { ...p, floatingHatHeightOffset: offset };
            assert.deepEqual(validateVillaParams(candidate), []);
            applyVillaParams(candidate);
            const model = roofPlanModel("floating"), h = floatingHatLayout();
            close(h.heightOffset, offset);
            close(h.peak - model.main.eave - roofTileEaveLift(), floatingHatHeightLimits(candidate).peakLift);
            assert.ok(h.joinZ >= h.ridgeFront + 50 - .01);
            assert.ok(h.peak <= model.mainPeak + .01);
            assert.ok(h.eave >= model.main.eave + floatingHatDesign.minEaveLift - .01);
          }
          for (const offset of [minOffset - 1, maxOffset + 1]) {
            assert.ok(validateVillaParams({ ...p, floatingHatHeightOffset: offset })
              .some(issue => issue.field === "floatingHatHeightOffset"));
          }
        }
});

test("抬高、降低与上下边界的帽脊同高接入主坡，交线两侧瓦面唯一且连续", () => {
  const { minOffset, maxOffset } = floatingHatHeightLimits(DEFAULT_VILLA_PARAMS);
  for (const offset of [-200, 200, minOffset, maxOffset]) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, floatingHatHeightOffset: offset });
    const { main: m, hat: h } = roofPlanModel("floating"), pitch = roofPitch(DEFAULT_VILLA_PARAMS.roofFenShui);
    const slope = DEFAULT_VILLA_PARAMS.roofFenShui / 10, lift = roofTileEaveLift(), inset = roofTileInset;
    close(h.peak, m.eave + lift + (h.joinZ - m.z - inset) * slope);
    const main = new THREE.Group(), annex = new THREE.Group();
    attachRoofs(main, annex, mat, DEFAULT_VILLA_PARAMS.roofFenShui, "floating");
    main.updateMatrixWorld(true);
    try {
      for (let x = h.x + inset + 31; x < h.x + h.w - inset; x += 327)
        for (let z = m.z + inset + 37; z < h.joinZ + 20; z += 191) {
          const expectedMain = m.eave + lift + Math.min(x - m.x - inset, m.x + m.w - inset - x,
            z - m.z - inset, m.z + m.d - inset - z, pitch.mainRun) * slope;
          const run = (h.w - 2 * inset) / 2;
          const expectedHat = z <= h.joinZ ? h.eave + lift + (h.peak - h.eave - lift)
            * Math.min((x - h.x - inset) / run, (h.x + h.w - inset - x) / run, (z - h.z - inset) / run, 1) : -Infinity;
          const hits = topHits(main, x, z);
          assert.equal(hits.length, 1, `${offset} @ ${x}, ${z}`);
          close(hits[0].point.y, Math.max(expectedMain, expectedHat));
        }
    } finally { dispose(main); dispose(annex); }
  }
});

test("升降后天沟槽底找坡及压顶、三眼皮的后端逐顶点贴住主坡，避免接缝悬空", () => {
  for (const offset of [-200, 200, 500]) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, floatingHatHeightOffset: offset });
    const { main: m } = roofPlanModel("floating"), slope = DEFAULT_VILLA_PARAMS.roofFenShui / 10;
    const main = new THREE.Group(), annex = new THREE.Group();
    attachRoofs(main, annex, mat, DEFAULT_VILLA_PARAMS.roofFenShui, "floating");
    main.updateMatrixWorld(true);
    try {
      const eaves = main.getObjectByName("前檐及两侧融入正屋的天沟")!;
      let checked = 0;
      eaves.traverse(o => {
        if (!(o instanceof THREE.Mesh) || o.name === "悬浮官帽柱顶封闭转接梁" || o.parent?.userData.eaveWash) return;
        const positions = o.geometry.getAttribute("position");
        // 同一X横截面中每个上下端顶点都应接到该标高的主屋坡面，而非只用顶面Z。
        for (let i = 0; i < positions.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld);
          if (v.z < m.z + roofTileInset - .1) continue;
          const rear = Array.from({ length: positions.count }, (_, j) => j).every(j =>
            Math.abs(positions.getX(j) - positions.getX(i)) > .02 || Math.abs(positions.getY(j) - positions.getY(i)) > .02
            || positions.getZ(j) <= positions.getZ(i) + .02);
          if (!rear) continue;
          close(v.y, m.eave + roofTileEaveLift() + (v.z - m.z - roofTileInset) * slope,
            `${o.name} offset=${offset} 后端未贴合：${v.toArray()}`);
          checked++;
        }
      });
      assert.ok(checked > 30);
    } finally { dispose(main); dispose(annex); }
  }
});

test("仅修改升降仍触发模型重建，三楼官帽柱、转接梁及灯带跟随，主楼包角柱不动", () => {
  const original = buildVilla(mat, false, DEFAULT_VILLA_PARAMS.roofFenShui, "floating");
  const corner = new THREE.Box3().setFromObject(original.levels[2].getObjectByName("三楼包角柱")!);
  try {
    for (const offset of [-200, 200]) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, floatingHatHeightOffset: offset });
      const updated = buildVilla(mat, false, DEFAULT_VILLA_PARAMS.roofFenShui, "floating", undefined, original);
      try {
        assert.notEqual(updated, original);
        assert.notEqual(updated.roof, original.roof);
        updated.group.updateMatrixWorld(true);
        const h = floatingHatLayout(), top = fasciaBottomY(h.eave, 0);
        const piers = updated.levels[2].getObjectByName("三楼官帽柱")!;
        for (const pier of piers.children) close(new THREE.Box3().setFromObject(pier).max.y, top);
        const joints: THREE.Object3D[] = [];
        updated.roof.traverse(o => { if (o.name === "悬浮官帽柱顶封闭转接梁") joints.push(o); });
        assert.equal(joints.length, 2);
        for (const joint of joints) close(new THREE.Box3().setFromObject(joint).min.y, top);
        assert.deepEqual(new THREE.Box3().setFromObject(updated.levels[2].getObjectByName("三楼包角柱")!), corner);
        const lights = updated.roof.getObjectByName("悬浮官帽")!;
        const strips: THREE.Object3D[] = [];
        lights.traverse(o => { if (o.name === "暖白灯带") strips.push(o); });
        assert.ok(strips.length > 0);
        for (const strip of strips) assert.ok(new THREE.Box3().setFromObject(strip).max.y < h.eave);
      } finally { dispose(updated.group); }
    }
  } finally { dispose(original.group); }
});
