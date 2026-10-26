import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DEFAULT_VILLA_PARAMS, applyVillaParams, resetVillaParams, getVillaParams, validateVillaParams } from "../src/villa-params";
import { site, floors, annexRooms, buildingAreas, frontElevation, roadsideVilla, courtyardArcAnchors } from "../src/data";
import { recessedFloor, porticoFrontZ, porticoWallZ, recessedFootprint, recessedRoom } from "../src/building-variants";
import { clonePublishedLayout, envelopeFromSite, scaleLayoutDraftToEnvelope } from "../src/layout-draft";
import { buildSchemeDocument, parseSchemeDocument } from "../src/scheme-store";
import { buildSizeVersionDocument, parseSizeVersionDocument } from "../src/data-versions";
import { buildVilla, roofPlanModel, villaLayoutFromDraft } from "../src/architecture";
import { facades } from "../src/facades";
import { resolveLayoutFacades } from "../src/facade-layout";
import { collectPlanSiteDimensions } from "../src/plan-dimensions";
import { floorPlan, planSourceFromDraft, courtyardSitePlan } from "../src/plan";
import { roofPlanSvg } from "../src/roof-plan";
import { elevationSvg } from "../src/elevation-plan";
import { polygonContainsPoint, polygonAreaMm2 } from "../src/room-geometry";
import { roomAreas } from "../src/design-data";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model";
import { LayoutEditor } from "../src/layout-editor";
import { designDrawings } from "../src/design-drawings";
import type { Mats } from "../src/primitives";

const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; } });
test.afterEach(resetVillaParams);

test("凹入门厅取消左右侧坡道及防滑条，保留柱间三步；凸出式恢复原侧坡道", () => {
  for (const buildingPlacement of ["main-east", "main-west"] as const) for (const porticoStyle of ["recessed", "projecting"] as const) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement, porticoStyle });
    const villa = buildVilla(mat, false, 4.5, "joined");
    assert.ok(villa.group.getObjectByName("柱间三步"));
    for (const name of ["东侧坡道", "西侧坡道", "坡道防滑条"])
      assert.equal(!!villa.group.getObjectByName(name), porticoStyle === "projecting", `${buildingPlacement}/${porticoStyle}/${name}`);
    const drawing = designDrawings({ fenShui: 4.5, roadY: -1860, rampLength: 5000 })[3].svg;
    assert.equal(drawing.includes("左右侧坡道已取消"), porticoStyle === "recessed");
    villa.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
});

test("主辅楼互换：包络、各层户型、门窗、楼梯与总尺寸随之镜像，邻房道路及场地不换位", () => {
  resetVillaParams();
  const source = clonePublishedLayout(), road = structuredClone(roadsideVilla), yard = structuredClone(courtyardArcAnchors);
  applyVillaParams({ ...getVillaParams(), buildingPlacement: "main-west" });
  assert.equal(site.main.x, 800);
  assert.equal(site.annex.x, 16200);
  assert.equal(site.annex.x - site.main.x - site.main.w, 1800);
  assert.deepEqual(roadsideVilla, road);
  assert.deepEqual(courtyardArcAnchors, yard);
  const scaled = scaleLayoutDraftToEnvelope(source, envelopeFromSite());
  const room = source.floors[0].rooms[0], mirrored = scaled.floors[0].rooms[0];
  assert.equal(mirrored.x - site.main.x, source.envelope!.mainW - (room.x - source.envelope!.mainX) - room.w);
  assert.deepEqual(scaled.floors[0].rooms, floors[0].rooms);
  assert.equal(scaled.stairLayout.direction, "negative");
  const rotatedIndex = source.floors[0].furniture.findIndex(f => f.rotation != null && f.rotation !== 0);
  assert.equal(scaled.floors[0].furniture[rotatedIndex].rotation, -source.floors[0].furniture[rotatedIndex].rotation!);
  assert.equal(facades(0)[0].a[0], site.main.x + site.main.w);
  const annexDoor = facades(3).find(f => f.openings.some(o => o.door))!;
  assert.ok(Math.abs(annexDoor.a[0] - site.annex.x) < 250);
  assert.ok(annexRooms.every(r => r.x >= site.annex.x - 1 && r.x + r.w <= site.annex.x + site.annex.w + 1));
  assert.deepEqual(collectPlanSiteDimensions().widthSegmentsMm, [800,13600,1800,4000,800]);
  resetVillaParams();
  const restored = scaleLayoutDraftToEnvelope(scaled, envelopeFromSite());
  const rounded = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v));
  const normalizeDoors = (list: typeof source.floors) => list.map(f => ({ ...f, partitions: f.partitions.map(w => ({ ...w, door: w.door ? { ...w.door, side: w.door.side ?? "out" } : undefined })) }));
  assert.deepEqual(rounded(normalizeDoors(restored.floors)), rounded(normalizeDoors(source.floors)));
  assert.deepEqual(rounded(restored.annexFurniture), rounded(source.annexFurniture));
  assert.deepEqual(restored.exteriorOpenings, source.exteriorOpenings);
});

test("凹入门厅：柱退至主楼前沿、门墙与三层官帽联动、主楼面积先扣凹口", () => {
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoStyle: "recessed" });
  assert.equal(porticoFrontZ(), site.main.z);
  assert.equal(porticoWallZ(), site.main.z + 2000);
  assert.equal(frontElevation.porticoColumnZ, site.main.z);
  assert.equal(frontElevation.postZ, site.main.z + 2250);
  assert.equal(buildingAreas.main, 127);
  assert.equal(buildingAreas.portico, 9);
  assert.equal(buildingAreas.total, 168);
  const outline = recessedFootprint(floors[0].front);
  assert.equal(polygonAreaMm2(outline), 127000000);
  assert.equal(polygonContainsPoint(outline, [site.portico.x + 1000, site.main.z + 1000]), false);
  const walls = resolveLayoutFacades().facades[0];
  assert.ok(walls.some(w => w.openings.some(o => o.door) && w.a[1] === porticoWallZ() + 120));
  assert.equal(walls.filter(w => w.a[1] === site.main.z + 120 && w.b[1] === site.main.z + 120).length, 2);
});

test("凹口派生房间、隔墙与家具，不改用户源稿；切回原造型恢复", () => {
  resetVillaParams();
  const draft = clonePublishedLayout(), before = JSON.stringify(draft);
  const x = site.portico.x, z = site.main.z;
  draft.floors[0].partitions.push({ a: [x - 500, z + 800], b: [x + 5100, z + 800] });
  const staged = JSON.stringify(draft);
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoStyle: "recessed" });
  const shown = recessedFloor(draft.floors[0]);
  assert.equal(JSON.stringify(draft), staged);
  const parts = shown.partitions.filter(w => w.sourceIndex === draft.floors[0].partitions.length - 1);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].b[0], x);
  assert.equal(parts[1].a[0], x + 4500);
  assert.ok(shown.rooms.every(r => !polygonContainsPoint(r.outline ?? [], [x + 2300, z + 500])));
  resetVillaParams();
  assert.deepEqual(recessedFloor(draft.floors[0]), draft.floors[0]);
  assert.ok(before.length > 0);
});

test("造型与换位保存在尺寸和完整方案中；旧文件默认凸出式和主东辅西", () => {
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoStyle: "recessed", buildingPlacement: "main-west" });
  const full = buildSchemeDocument({ layoutDraft: clonePublishedLayout() });
  assert.deepEqual(parseSchemeDocument(JSON.parse(JSON.stringify(full))).villaParams, getVillaParams());
  const size = buildSizeVersionDocument();
  assert.deepEqual(parseSizeVersionDocument(JSON.parse(JSON.stringify(size))).villaParams, getVillaParams());
  const legacy = structuredClone(full) as any;
  delete legacy.villaParams.porticoStyle; delete legacy.villaParams.buildingPlacement;
  assert.equal(parseSchemeDocument(legacy).villaParams.porticoStyle, "projecting");
  assert.equal(parseSchemeDocument(legacy).villaParams.buildingPlacement, "main-east");
});

test("两种门厅×两种主辅楼位置×两种官帽：3D与所有图纸均为有限几何且完整取景", () => {
  for (const porticoStyle of ["projecting", "recessed"] as const) for (const buildingPlacement of ["main-east", "main-west"] as const) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoStyle, buildingPlacement });
    const draft = clonePublishedLayout(), layout = villaLayoutFromDraft(draft);
    for (const style of ["joined", "floating"] as const) {
      const scene = buildVilla(mat, false, 4.5, style, layout);
      scene.group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(scene.group);
      assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite));
      scene.group.traverse(o => { if (o instanceof THREE.Mesh) {
        const positions = o.geometry.getAttribute("position");
        if (positions) assert.ok(Array.from(positions.array).every(Number.isFinite), o.name);
        o.geometry.dispose();
      } });
      const roof = roofPlanModel(style, layout);
      assert.ok(roof.hat.joinZ > roof.hat.z, `${porticoStyle}/${buildingPlacement}/${style}`);
      const svg = roofPlanSvg(style, style, layout);
      const viewBox = svg.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
      assert.ok(viewBox[2] > 21000);
      assert.doesNotMatch(svg, /NaN|Infinity/);
      for (const side of ["north", "south", "east", "west"] as const) assert.doesNotMatch(elevationSvg(side, style, layout), /NaN|Infinity/);
    }
    for (let i = 0; i < 3; i++) assert.doesNotMatch(floorPlan(i, true, false, {}, planSourceFromDraft(draft, i)), /NaN|Infinity/);
    assert.doesNotMatch(courtyardSitePlan(), /NaN|Infinity/);
    assert.ok(roomAreas(draft.annexRooms[0], 0, draft.annexPartitions).interior > 0);
  }
});

test("互换后按实际西侧院坪校验，不用东侧余量冒充可用进深", () => {
  const params = { ...DEFAULT_VILLA_PARAMS, mainDepth: 13000, annexDepth: 8000, courtyardEastTotal: 23000 };
  assert.ok(validateVillaParams({ ...params, buildingPlacement: "main-west" }).some(i => i.field === "mainDepth"));
});


test("凹口分隔后的房间保留全部片区；通高窗仍能定位原始可编辑洞口", () => {
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoStyle: "recessed", buildingPlacement: "main-west" });
  const p = site.portico, front = floors[0].front;
  const room = recessedRoom({ id: "across", name: "跨凹口", kind: "hall", x: p.x - 500, z: front, w: p.w + 1000, d: 1000 }, front);
  assert.equal(polygonAreaMm2(room.outline!), 1000000);
  assert.ok(polygonContainsPoint(room.outline!, [p.x - 250, front + 500]));
  assert.ok(polygonContainsPoint(room.outline!, [p.x + p.w + 250, front + 500]));
  assert.equal(polygonContainsPoint(room.outline!, [p.x + p.w / 2, front + 500]), false);
  const draft = clonePublishedLayout(), resolved = resolveLayoutFacades(draft);
  assert.ok(resolved.glazing.length > 0);
  assert.ok(resolved.glazing.every(panel => panel.sourceIndex != null));
});

test("互换后再次改面宽和进深：户型、尺寸链、面积及凹口仍取新参数", () => {
  resetVillaParams();
  let draft = clonePublishedLayout();
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement: "main-west" });
  draft = scaleLayoutDraftToEnvelope(draft, envelopeFromSite());
  applyVillaParams({ ...getVillaParams(), mainWidth: 13000, annexDepth: 7000, porticoProjection: 1500, porticoStyle: "recessed" });
  draft = scaleLayoutDraftToEnvelope(draft, envelopeFromSite());
  assert.deepEqual(collectPlanSiteDimensions().widthSegmentsMm, [1400,13000,1800,4000,800]);
  assert.equal(site.main.z + site.main.d, site.annex.z + site.annex.d);
  assert.equal(porticoWallZ() - site.main.z, 1500);
  assert.equal(buildingAreas.total, 158);
  assert.equal(draft.envelope!.mainW, 13000);
  assert.equal(draft.envelope!.annexD, 7000);
  assert.equal(draft.portico.projection, 1500);
});

test("凹角旁宽窗在平面与立体中同宽收口，保留原可编辑洞口；可在退入墙面新增门", () => {
  for (const buildingPlacement of ["main-east", "main-west"] as const) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoStyle: "recessed", buildingPlacement });
    const draft = clonePublishedLayout(), face = facades(0)[0];
    const x = site.portico.x + (buildingPlacement === "main-east" ? 300 : site.portico.w - 300);
    const center = Math.abs(x - face.a[0]);
    draft.exteriorManaged = true;
    draft.exteriorOpenings = [{ floor: 0, facadeIndex: 0, opening: { offset: center - 1000, width: 2000, kind: "window" } }];
    draft.livingVoid.w = 0;
    draft.livingVoid.d = 0;
    // 本回归只核对实体门窗，不创建依赖浏览器Canvas的房间标签。
    draft.floors.forEach(floor => { floor.rooms = []; });
    draft.annexRooms = [];
    const source = JSON.stringify(draft);
    const resolved = resolveLayoutFacades(draft).facades[0].flatMap(f => f.openings);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].w, 520);
    const svg = floorPlan(0, true, false, { editable: true }, planSourceFromDraft(draft, 0));
    assert.match(svg, /width="520" height="240" class="edit-hit" data-edit="door" data-index="0" data-exterior="1"/);
    const model = buildEditorModel(draft, mat, "full", { floors: [0] });
    let picked = false;
    model.root.traverse(o => { if (o.userData.layoutSelection?.exterior && o.userData.layoutSelection.index === 0) picked = true; });
    assert.ok(picked);
    disposeEditorModel(model.root, new THREE.Scene());
    assert.equal(JSON.stringify(draft), source);
    draft.floors[0].partitions = [];
    const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, draft);
    assert.ok(editor.placeOpeningNear(site.portico.x + site.portico.w / 2, porticoWallZ() + 120));
    const created = editor.draft.exteriorOpenings.at(-1)!;
    assert.equal(created.facadeIndex, 0);
    assert.ok(Math.abs(created.opening.offset + created.opening.width / 2 - Math.abs(site.portico.x + site.portico.w / 2 - face.a[0])) < 1);
  }
});
