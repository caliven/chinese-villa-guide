import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import "../src/villa-params.ts";
import { site, type Room } from "../src/data.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft, scaleLayoutDraftToEnvelope, envelopeFromSite } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { livingVoidSource, voidBox } from "../src/living-void.ts";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture.ts";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params.ts";
import type { Mats } from "../src/primitives.ts";
import { buildLayoutVersionDocument, parseLayoutVersionDocument } from "../src/data-versions.ts";
import { buildSchemeDocument, parseSchemeDocument, schemeToJson } from "../src/scheme-store.ts";

test.afterEach(resetVillaParams);
function fixture() {
  const draft = clonePublishedLayout(), x = site.main.x, z = draft.floors[1]!.front;
  for (const floor of draft.floors) { floor.rooms = []; floor.partitions = []; floor.furniture = []; }
  const source: Room = { id: "room3", name: "房间3", kind: "living", x, z, w: 4000, d: 4000 };
  draft.floors[0]!.rooms = [source];
  draft.livingVoid = { x, z, w: 4000, d: 5000 };
  draft.floors[1]!.rooms = [{ id: "f2-void", name: "客厅上空", kind: "void", ...draft.livingVoid }];
  const messages: string[] = [];
  let floor = 1;
  const editor = new LayoutEditor({ getFloor: () => floor, redraw: () => {}, toast: message => messages.push(message) }, draft);
  const selectVoid = () => editor.selection = { kind: "room", id: "f2-void", floor: 1 };
  const selectSource = () => { floor = 0; editor.selection = { kind: "room", id: "room3", floor: 0 }; };
  selectVoid();
  return { editor, messages, selectVoid, selectSource };
}
const upperVoid = (editor: LayoutEditor) => editor.draft.floors[1]!.rooms.find(room => room.kind === "void")!;
const assertSynchronized = (editor: LayoutEditor) => assert.deepEqual(voidBox(upperVoid(editor)), voidBox(editor.draft.livingVoid));

test("栏杆造型在对应对象属性中独立修改，即时提交且支持撤销重做", () => {
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, livingRailingStyle: "brick", stairRailingStyle: "steel" });
  const { editor, selectVoid, selectSource } = fixture();
  assert.match(editor.inspectorHtml(), /data-edit-railing="living"/);
  assert.match(editor.inspectorHtml(), /<option value="marble" selected>大理石栏杆<\/option>/);
  assert.doesNotMatch(editor.inspectorHtml(), /value="brick"|data-edit-railing="stair"/);
  assert.equal(editor.updateSelectedRailingStyle("wood"), true);
  assert.equal(editor.draft.livingVoid.railingStyle, "wood");
  assert.equal(editor.draft.stairLayout.railingStyle, undefined);
  editor.undo();
  assert.equal(editor.draft.livingVoid.railingStyle, undefined);
  editor.redo();
  assert.equal(editor.draft.livingVoid.railingStyle, "wood");
  editor.selection = { kind: "stair" };
  assert.match(editor.inspectorHtml(), /data-edit-railing="stair"/);
  assert.match(editor.inspectorHtml(), /<option value="steel" selected>/);
  assert.equal(editor.updateSelectedRailingStyle("glass"), true);
  assert.equal(editor.draft.stairLayout.railingStyle, "glass");
  assert.equal(editor.draft.livingVoid.railingStyle, "wood");
  editor.undo();
  assert.equal(editor.draft.stairLayout.railingStyle, undefined);
  assert.equal(editor.draft.livingVoid.railingStyle, "wood");
  editor.redo();
  const before = draftToJson(editor.draft);
  selectSource();
  assert.doesNotMatch(editor.inspectorHtml(), /data-edit-railing/);
  editor.updateSelectedRailingStyle("marble");
  selectVoid();
  editor.updateSelectedRailingStyle("unknown");
  editor.selections.push({ kind: "stair" });
  assert.doesNotMatch(editor.inspectorHtml(), /data-edit-railing/);
  editor.updateSelectedRailingStyle("steel");
  assert.equal(draftToJson(editor.draft), before, "普通房间、多选和非法值不能改栏杆");
});

test("对象栏杆随户型及完整方案保存，范围和楼梯模型调整后保留，非法文件值拒绝", () => {
  const { editor, selectVoid } = fixture();
  editor.updateSelectedRailingStyle("marble");
  editor.updateSelectedNumber("w", 6000);
  editor.updateLivingVoidField("mode", "follow");
  assert.equal(editor.draft.livingVoid.railingStyle, "marble");
  editor.selection = { kind: "stair" };
  editor.updateSelectedRailingStyle("glass");
  editor.setStairModel("triple");
  assert.equal(editor.draft.stairLayout.railingStyle, "glass");
  const layoutDoc = buildLayoutVersionDocument(editor.draft);
  const layout = parseLayoutVersionDocument(JSON.parse(JSON.stringify(layoutDoc))).layoutDraft;
  const scheme = parseSchemeDocument(JSON.parse(schemeToJson(buildSchemeDocument({ layoutDraft: layout }))));
  for (const saved of [layout, scheme.layoutDraft!]) {
    assert.equal(saved.livingVoid.railingStyle, "marble");
    assert.equal(saved.stairLayout.railingStyle, "glass");
  }
  editor.loadDraft(layout);
  selectVoid();
  assert.match(editor.inspectorHtml(), /<option value="marble" selected>/);
  for (const key of ["stairLayout", "livingVoid"] as const) {
    const raw = JSON.parse(draftToJson(layout));
    raw[key].railingStyle = "brick";
    assert.equal(parseLayoutDraft(JSON.stringify(raw))[key].railingStyle, "brick", "兼容旧砖柱别名");
    for (const invalid of ["unknown", null, 100]) {
      raw[key].railingStyle = invalid;
      assert.throws(() => parseLayoutDraft(JSON.stringify(raw)), /栏杆造型无效/);
    }
  }
});

test("旧稿按实际位置识别一楼客厅，二楼同开间默认跟随，既有跨开间范围保留", () => {
  const { editor } = fixture();
  assert.equal(editor.draft.livingVoid.mode, "follow");
  assert.equal(editor.draft.livingVoid.sourceRoomId, "room3");
  assert.equal(editor.draft.livingVoid.d, 4000);
  assertSynchronized(editor);
  assert.match(editor.inspectorHtml(), /跟随一楼客厅/);
  const custom = structuredClone(editor.draft);
  delete custom.livingVoid.mode;
  delete custom.livingVoid.sourceRoomId;
  custom.livingVoid.w = 6000;
  Object.assign(custom.floors[1]!.rooms[0]!, voidBox(custom.livingVoid));
  editor.loadDraft(custom);
  assert.equal(editor.draft.livingVoid.mode, "custom");
  assert.equal(editor.draft.livingVoid.w, 6000);
});

test("一楼客厅改宽深及平移后二维挑空与洞口同步；撤销重做为同一步", () => {
  const { editor, selectSource } = fixture();
  selectSource();
  editor.updateSelectedNumber("w", 5000);
  assert.equal(editor.draft.livingVoid.w, 5000);
  editor.updateSelectedNumber("d", 4500);
  assert.equal(editor.draft.livingVoid.d, 4500);
  editor.updateSelectedNumber("x", site.main.x + 500);
  assert.equal(editor.draft.livingVoid.x, site.main.x + 500);
  assertSynchronized(editor);
  editor.undo();
  assert.equal(editor.draft.livingVoid.x, site.main.x);
  editor.redo();
  assert.equal(editor.draft.livingVoid.x, site.main.x + 500);
  assertSynchronized(editor);
});

test("移动一楼客厅边墙也同步挑空，而切换楼层或只点选不新增撤销步骤", () => {
  const { editor, selectSource, selectVoid } = fixture();
  const r = livingVoidSource(editor.draft)!;
  editor.draft.floors[0]!.partitions.push({ a: [r.x + r.w, r.z], b: [r.x + r.w, r.z + r.d], role: "partition" });
  selectSource(); editor.updateSelectedName("一楼客厅");
  editor.selection = { kind: "wall", floor: 0, index: 0 };
  editor.updateSelectedNumber("wallPosition", r.x + 4500);
  assert.equal(livingVoidSource(editor.draft)!.w, 4500);
  assert.equal(editor.draft.livingVoid.w, 4500);
  assertSynchronized(editor);
  selectVoid();
  assert.equal(editor.draft.livingVoid.mode, "follow");
  editor.undo();
  assert.equal(editor.draft.livingVoid.w, 4000);
});

test("挑空支持一间半／两间、自定义位置、切回跟随和JSON往返", () => {
  const { editor, selectVoid, selectSource } = fixture();
  for (const width of [6000, 8000, 11000]) {
    selectVoid(); editor.updateSelectedNumber("w", width);
    assert.equal(editor.draft.livingVoid.w, width);
    assert.equal(editor.draft.livingVoid.mode, "custom");
    assertSynchronized(editor);
    assert.deepEqual(parseLayoutDraft(draftToJson(editor.draft)).livingVoid, editor.draft.livingVoid);
  }
  selectVoid(); editor.updateSelectedNumber("x", site.main.x + 500);
  const custom = structuredClone(editor.draft.livingVoid);
  selectSource(); editor.updateSelectedNumber("d", 4200);
  assert.deepEqual(editor.draft.livingVoid, custom);
  selectVoid(); editor.updateLivingVoidField("mode", "follow");
  assert.equal(editor.draft.livingVoid.w, 4000);
  assert.equal(editor.draft.livingVoid.d, 4200);
  assert.equal(editor.draft.livingVoid.x, site.main.x);
  editor.undo();
  assert.deepEqual(editor.draft.livingVoid, custom);
  editor.redo(); assertSynchronized(editor);
});

test("自定义范围越界、过小或扩大到二楼房间／楼梯时拒绝且不破坏重做", () => {
  const { editor, selectVoid, messages } = fixture();
  editor.draft.floors[1]!.rooms.push({ id: "occupied", name: "卧室", kind: "bed", x: site.main.x + 6000, z: editor.draft.livingVoid.z, w: 3000, d: 4000 });
  editor.updateSelectedName("客厅挑空");
  editor.updateSelectedNumber("w", 5000); editor.undo(); selectVoid();
  const before = parseLayoutDraft(draftToJson(editor.draft));
  for (const [field, value] of [["w", 8000], ["w", 500], ["x", site.main.x - 1000], ["d", 20000]] as const) {
    editor.updateSelectedNumber(field, value);
    assert.deepEqual(parseLayoutDraft(draftToJson(editor.draft)), before);
    assert.equal(editor.canRedo, true);
  }
  assert.match(messages.join(" "), /卧室/);
  editor.draft.floors[1]!.rooms.find(room => room.id === "occupied")!.kind = "stair";
  editor.updateSelectedNumber("w", 8000);
  assert.equal(editor.draft.livingVoid.w, 4000);
});

test("跟随一楼扩大若覆盖二楼房间则整次回滚；自定义后可独立改一楼", () => {
  const { editor, selectSource, selectVoid, messages } = fixture();
  editor.draft.floors[1]!.rooms.push({ id: "upper-bed", name: "二楼卧室", kind: "bed", x: site.main.x + 4500, z: editor.draft.livingVoid.z, w: 3000, d: 4000 });
  editor.updateSelectedName("客厅挑空");
  selectSource();
  const before = parseLayoutDraft(draftToJson(editor.draft));
  editor.updateSelectedNumber("w", 5000);
  assert.deepEqual(parseLayoutDraft(draftToJson(editor.draft)), before);
  assert.match(messages.at(-1)!, /二楼卧室/);
  selectVoid(); editor.updateLivingVoidField("mode", "custom");
  selectSource(); editor.updateSelectedNumber("w", 5000);
  assert.equal(livingVoidSource(editor.draft)!.w, 5000);
  assert.equal(editor.draft.livingVoid.w, 4000);
});

test("跟随来源可显式选择，删除来源后保持自定义；删除挑空同步封板并可撤销", () => {
  const { editor, selectVoid } = fixture();
  editor.draft.floors[0]!.rooms.push({ id: "hall", name: "堂屋", kind: "hall", x: site.main.x + 4000, z: editor.draft.livingVoid.z, w: 4000, d: 4000 });
  editor.updateLivingVoidField("source", "hall");
  assert.equal(editor.draft.livingVoid.sourceRoomId, "hall");
  assert.equal(editor.draft.livingVoid.x, site.main.x + 4000);
  editor.selection = { kind: "room", id: "hall", floor: 0 };
  editor.deleteSelection();
  assert.equal(editor.draft.livingVoid.mode, "custom");
  assert.equal(editor.draft.livingVoid.x, site.main.x + 4000);
  selectVoid(); editor.deleteSelection();
  assert.equal(editor.draft.livingVoid.w, 0);
  assert.equal(editor.draft.livingVoid.d, 0);
  assert.equal(upperVoid(editor), undefined);
  editor.undo(); assertSynchronized(editor);
});

test("新挑空模式和来源随缩放／主辅楼换位及重载保留；非法模式拒绝", () => {
  const { editor } = fixture();
  editor.updateSelectedNumber("w", 6000);
  const next = { ...envelopeFromSite(), mainW: site.main.w + 1000 };
  const scaled = scaleLayoutDraftToEnvelope(editor.draft, next);
  assert.equal(scaled.livingVoid.mode, "custom");
  assert.equal(scaled.livingVoid.sourceRoomId, "room3");
  const raw = draftToJson(editor.draft);
  editor.loadDraft(parseLayoutDraft(raw));
  assert.equal(editor.draft.livingVoid.w, 6000);
  assert.equal(editor.draft.livingVoid.mode, "custom");
  const invalid = JSON.parse(raw); invalid.livingVoid.mode = "other";
  assert.throws(() => parseLayoutDraft(JSON.stringify(invalid)), /挑空跟随方式/);
});

const mat = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });
function hasFloorAt(mesh: THREE.Object3D, x: number, y: number, z: number) {
  mesh.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, y + 100, z), new THREE.Vector3(0, -1, 0), 0, 200).intersectObject(mesh, true).length > 0;
}

test("任意位置及跨开间挑空：完整三维和编辑三维开洞同源，原洞位置恢复楼板", () => {
  const { editor } = fixture();
  editor.updateSelectedNumber("w", 6000);
  editor.updateSelectedNumber("x", site.main.x + 1000);
  editor.updateSelectedNumber("z", editor.draft.livingVoid.z + 1000);
  const draft = editor.draft, v = draft.livingVoid, y = draft.floors[1]!.y;
  const villa = buildVilla(mat(), false, 4.5, "joined", villaLayoutFromDraft(draft));
  const slab = villa.levels[1]!.getObjectByName("二楼楼板")!;
  assert.ok(slab);
  assert.equal(hasFloorAt(slab, v.x + 1000, y, v.z + 1000), false);
  assert.equal(hasFloorAt(slab, site.main.x + 500, y, v.z + 1000), true);
  const model = buildEditorModel(draft, mat(), 1200, { floors: [1] });
  assert.equal(hasFloorAt(model.levels[1]!, v.x + 1000, y, v.z + 1000), false);
  const svg = floorPlan(1, false, false, { editable: true, editorCanvas: true, selected: { kind: "room", id: "f2-void", floor: 1 } }, planSourceFromDraft(draft, 1));
  assert.match(svg, /data-edit="room-handle"[^>]*data-id="f2-void"/);
  disposeEditorModel(model.root, new THREE.Scene());
  villa.group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
});

test("凹入门厅与主辅楼换位时二楼挑空按真实X／Z开洞", () => {
  for (const buildingPlacement of ["main-east", "main-west"] as const) for (const porticoStyle of ["projecting", "recessed"] as const) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement, porticoStyle });
    const { editor } = fixture();
    editor.updateSelectedNumber("w", 6000);
    const v = editor.draft.livingVoid, y = editor.draft.floors[1]!.y;
    const villa = buildVilla(mat(), false, 4.5, "joined", villaLayoutFromDraft(editor.draft));
    const slab = villa.levels[1]!.getObjectByName("二楼楼板")!;
    assert.equal(hasFloorAt(slab, v.x + 1000, y, v.z + 1000), false, `${buildingPlacement}/${porticoStyle}`);
    assert.equal(hasFloorAt(slab, v.x + v.w + 1000, y, v.z + 3000), true, `${buildingPlacement}/${porticoStyle}`);
    villa.group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  }
});
