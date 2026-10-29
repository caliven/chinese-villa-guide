import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { site } from "../src/data.ts";
import { createOpening, normalizeOpening, interiorOpeningProfile } from "../src/openings.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft, removeStairFromDraft } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { exteriorWindowProfile, resolveLayoutFacades } from "../src/facade-layout.ts";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model.ts";
import { buildVilla, villaLayoutFromDraft, elevationModel } from "../src/architecture.ts";
import { buildLayoutVersionDocument, parseLayoutVersionDocument } from "../src/data-versions.ts";
import { type Mats } from "../src/primitives.ts";
import { readFileSync, readdirSync } from "node:fs";

const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
const materials = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < .1, `${a} != ${b}`);
function fixture() {
  const draft = clonePublishedLayout(); removeStairFromDraft(draft);
  draft.floors.forEach(f => {
    f.furniture = [];
    f.partitions = [{ a: [site.main.x + 1000, site.main.z + 4000], b: [site.main.x + 6000, site.main.z + 4000], door: createOpening("window", 1800) }];
  });
  draft.annexFurniture = [];
  draft.annexPartitions = [{ a: [site.annex.x + 300, site.annex.z + 4000], b: [site.annex.x + 3300, site.annex.z + 4000], door: createOpening("window", 800) }];
  return draft;
}
function editorAt(floor = 0, annex = false) {
  const messages: string[] = [];
  const editor = new LayoutEditor({ getFloor: () => floor, redraw: () => {}, toast: (s: string) => messages.push(s) } as never, fixture());
  editor.selection = { kind: "door", floor, index: 0, annex };
  return { editor, messages };
}
function exteriorEditor(index: number, draft = clonePublishedLayout()) {
  const item = draft.exteriorOpenings[index];
  const editor = new LayoutEditor({ getFloor: () => item.floor === 3 ? 0 : item.floor, redraw: () => {}, toast: () => {} } as never, draft);
  editor.selection = { kind: "door", floor: item.floor === 3 ? 0 : item.floor, index, annex: item.floor === 3, exterior: true };
  return editor;
}
const field = (html: string, name: string) => Number(html.match(new RegExp(`data-edit-field="${name}"[^>]*value="([^"]+)"`))?.[1]);

test("旧窗有实际默认高度，主辅楼预设各自保留；JSON能往返自定义窗高和窗台，并校验数值", () => {
  const raw = { ...createOpening("window", 800), height: 1234, sill: 600 };
  assert.equal(normalizeOpening(raw).height, 1234);
  const draft = fixture(); draft.floors[0].partitions[0].door = raw;
  draft.exteriorOpenings[3].opening = { ...draft.exteriorOpenings[3].opening, height: 1350, sill: 700 };
  const saved = parseLayoutVersionDocument(buildLayoutVersionDocument(parseLayoutDraft(draftToJson(draft)))).layoutDraft;
  assert.deepEqual(saved.floors[0].partitions[0].door, raw);
  assert.equal(saved.exteriorOpenings[3].opening.height, 1350);
  assert.equal(saved.exteriorOpenings[3].opening.sill, 700);
  const legacy = interiorOpeningProfile(createOpening("window", 100), 3000);
  assert.equal(legacy.sill, 900); assert.equal(legacy.height, 1500);
  for (const bad of [{ height: -1 }, { height: "1500" }, { sill: -1 }, { sill: null }]) {
    const invalid = structuredClone(draft);
    Object.assign(invalid.floors[0].partitions[0].door!, bad);
    assert.throws(() => parseLayoutDraft(JSON.stringify(invalid)), /窗高|窗台/);
  }
  for (const file of readdirSync(new URL("../data/户型/", import.meta.url)).filter(f => f !== "index.json" && f.endsWith(".json"))) {
    const version = parseLayoutVersionDocument(JSON.parse(readFileSync(new URL(`../data/户型/${file}`, import.meta.url), "utf8")));
    const before = draftToJson(version.layoutDraft);
    const resolved = resolveLayoutFacades(version.layoutDraft);
    version.layoutDraft.exteriorOpenings.forEach((item, i) => {
      if (item.opening.kind === "window") assert.ok(exteriorWindowProfile(version.layoutDraft, i)!.height > 0, file);
    });
    assert.ok(resolved.facades.length === 4);
    assert.equal(draftToJson(version.layoutDraft), before, "派生默认值不得改写保存稿");
  }
});

test("主辅楼窗高和窗台可编辑，撤销重做及恢复默认同步；非法窗顶整次拒绝", () => {
  for (const [floor, annex] of [[0, false], [1, false], [2, false], [0, true]] as const) {
    const { editor, messages } = editorAt(floor, annex);
    const reselect = () => { editor.selection = { kind: "door", floor, index: 0, annex }; };
    assert.equal(field(editor.inspectorHtml(), "windowHeight"), 1500);
    assert.equal(field(editor.inspectorHtml(), "windowSill"), 900);
    editor.updateSelectedNumber("windowHeight", 1250);
    editor.updateSelectedNumber("windowSill", 650);
    assert.equal(field(editor.inspectorHtml(), "windowHeight"), 1250);
    assert.equal(field(editor.inspectorHtml(), "windowSill"), 650);
    const before = draftToJson(editor.draft);
    editor.updateSelectedNumber("windowHeight", 15000);
    editor.updateSelectedNumber("windowSill", -100);
    assert.equal(draftToJson(editor.draft), before);
    assert.match(messages.at(-1)!, /已保留原尺寸/);
    editor.undo(); reselect(); assert.equal(field(editor.inspectorHtml(), "windowSill"), 900);
    editor.redo(); reselect(); assert.equal(field(editor.inspectorHtml(), "windowSill"), 650);
    editor.resetSelectedWindowDimensions();
    assert.equal(field(editor.inspectorHtml(), "windowHeight"), 1500);
    assert.equal(field(editor.inspectorHtml(), "windowSill"), 900);
    editor.undo(); reselect(); assert.equal(field(editor.inspectorHtml(), "windowHeight"), 1250);
    editor.updateOpeningField("kind", "door");
    assert.doesNotMatch(editor.inspectorHtml(), /data-edit-field="windowHeight"/);
    editor.updateOpeningField("kind", "window");
    assert.equal(field(editor.inspectorHtml(), "windowHeight"), 1500);
  }
});

test("内窗自定义高度与完成面在户型三维及完整房屋完全一致；剖切不改保存规格", () => {
  const draft = fixture(), mat = materials();
  [...draft.floors.flatMap(f => f.partitions), ...draft.annexPartitions].forEach(w => Object.assign(w.door!, { height: 1250, sill: 650 }));
  const before = draftToJson(draft), house = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft));
  house.group.updateMatrixWorld(true);
  for (const cut of [1200, "full"] as const) {
    const model = buildEditorModel(draft, mat, cut);
    for (const floor of [0, 1, 2, 3]) {
      const annex = floor === 3, level = annex ? 0 : floor, part = (annex ? draft.annexPartitions : draft.floors[floor].partitions)[0];
      const finish = level === 0 ? site.entranceRise : draft.floors[level].y;
      let window: THREE.Object3D | undefined, houseWall: THREE.Object3D | undefined;
      (annex ? model.annex : model.levels[floor]).traverse(o => { if (o.userData.layoutSelection?.kind === "door" && !o.userData.layoutSelection.exterior) window = o; });
      (annex ? house.annex : house.levels[floor]).traverse(o => {
        if (o instanceof THREE.Mesh && o.geometry instanceof THREE.ExtrudeGeometry && o.material === mat.inside && Math.abs(o.parent!.position.x - part.a[0]) < 1 && Math.abs(o.parent!.position.z - part.a[1]) < 1) houseWall = o.parent!;
      });
      const editBounds = new THREE.Box3().setFromObject(window!, true), physical = new THREE.Box3();
      houseWall!.children.slice(1).forEach(o => physical.union(new THREE.Box3().setFromObject(o, true)));
      close(editBounds.min.y, finish + 650); close(editBounds.max.y, finish + (cut === "full" ? 1900 : 1200));
      close(physical.min.y, finish + 650); close(physical.max.y, finish + 1900);
    }
    disposeEditorModel(model.root, new THREE.Scene());
  }
  assert.equal(draftToJson(draft), before);
});

test("普通外窗可逐扇改高，主辅楼窗台均从完成面起算；立面图和模型读取同一洞口", () => {
  for (const floor of [0, 1, 2, 3]) {
    const draft = clonePublishedLayout();
    const index = draft.exteriorOpenings.findIndex((o, i) => o.floor === floor && o.opening.kind === "window" && exteriorWindowProfile(draft, i)?.mode === "ordinary");
    const editor = exteriorEditor(index, draft), initial = exteriorWindowProfile(editor.draft, index)!;
    editor.updateSelectedNumber("windowHeight", 1200); editor.updateSelectedNumber("windowSill", 600);
    const profile = exteriorWindowProfile(editor.draft, index)!;
    assert.equal(profile.height, 1200); assert.equal(profile.sill, 600);
    const opening = resolveLayoutFacades(editor.draft).facades[floor].flatMap(f => f.openings).find(o => o.layoutSourceIndex === index)!;
    assert.equal(opening.h, 1200); assert.equal(opening.sill, 600 + (floor === 0 || floor === 3 ? site.entranceRise : 0));
    const elevation = elevationModel("joined", villaLayoutFromDraft(editor.draft));
    const faces = floor === 3 ? elevation.annexFacades : elevation.floors[floor].facades;
    assert.ok(faces.flatMap(f => f.openings).some(o => o.layoutSourceIndex === index && o.h === 1200 && o.sill === opening.sill));
    const before = draftToJson(editor.draft); editor.updateSelectedNumber("windowHeight", 10000);
    assert.equal(draftToJson(editor.draft), before);
    editor.resetSelectedWindowDimensions();
    assert.deepEqual(exteriorWindowProfile(editor.draft, index), initial);
  }
});

test("挑空侧墙新增普通窗可改为5500通高窗，并可退回单层；越过上层墙顶仍拒绝", () => {
  const draft = clonePublishedLayout();
  draft.exteriorOpenings = draft.exteriorOpenings.filter(o => o.facadeIndex !== 2 || o.floor > 1);
  const index = draft.exteriorOpenings.length;
  draft.exteriorOpenings.push({ floor: 0, facadeIndex: 2, opening: { ...createOpening("window", 3000), offset: 630, height: 1800, sill: 450 } });
  const editor = exteriorEditor(index, draft);
  assert.equal(exteriorWindowProfile(editor.draft, index)!.mode, "ordinary");
  assert.equal(editor.updateSelectedNumber("windowHeight", 5500), true);
  const profile = exteriorWindowProfile(editor.draft, index)!;
  assert.equal(profile.mode, "continuous");
  assert.equal(profile.height, 5500);
  assert.equal(profile.sill, 450);
  assert.match(editor.inspectorHtml(), /通高整窗/);
  editor.undo();
  assert.equal(exteriorWindowProfile(editor.draft, index)!.height, 1800);
  editor.redo();
  assert.equal(exteriorWindowProfile(editor.draft, index)!.height, 5500);
  editor.selection = { kind: "door", floor: 0, index, exterior: true };
  const resolved = resolveLayoutFacades(editor.draft), panel = resolved.glazing.find(p => p.sourceIndex === index)!;
  assert.equal(panel.top - panel.bottom, 5500);
  for (const floor of [0, 1]) assert.ok(resolved.facades[floor].some(f => f.openings.some(o => o.continuous === panel.id)));
  const saved = parseLayoutDraft(draftToJson(editor.draft));
  assert.equal(exteriorWindowProfile(saved, index)!.height, 5500);
  const before = draftToJson(editor.draft);
  editor.updateSelectedNumber("windowHeight", profile.maxTop - profile.sill + 1);
  assert.equal(draftToJson(editor.draft), before);
  editor.updateSelectedNumber("windowHeight", 1800);
  assert.equal(exteriorWindowProfile(editor.draft, index)!.mode, "ordinary");
  assert.equal(resolveLayoutFacades(editor.draft).glazing.some(p => p.sourceIndex === index), false);
});

test("不完整对应挑空或上层有冲突门洞的侧窗不能改成通高窗", () => {
  for (const scenario of ["partial", "door", "no-void"] as const) {
    const draft = clonePublishedLayout();
    draft.exteriorOpenings = draft.exteriorOpenings.filter(o => o.facadeIndex !== 2 || o.floor > 1);
    const index = draft.exteriorOpenings.length;
    draft.exteriorOpenings.push({ floor: 0, facadeIndex: 2, opening: { ...createOpening("window", 3000), offset: 630, height: 1800, sill: 450 } });
    if (scenario === "door") draft.exteriorOpenings.push({ floor: 1, facadeIndex: 2, opening: { ...createOpening("door", 900), offset: 1000 } });
    else {
      draft.floors.forEach(f => { f.rooms = f.rooms.filter(r => r.kind !== "void"); });
      draft.livingVoid.d = scenario === "partial" ? 2000 : 0;
    }
    const editor = exteriorEditor(index, draft), before = draftToJson(editor.draft);
    editor.updateSelectedNumber("windowHeight", 5500);
    assert.equal(draftToJson(editor.draft), before, scenario);
  }
});

test("通高窗的上下层选择均显示整窗尺寸，改高／窗台实际更新整窗并保留一组玻璃", () => {
  const draft = clonePublishedLayout(), original = resolveLayoutFacades(draft).glazing[0];
  assert.ok(original.upperSourceIndices!.length > 0);
  const lower = original.sourceIndex!, upper = original.upperSourceIndices![0], editor = exteriorEditor(upper, draft);
  assert.equal(field(editor.inspectorHtml(), "windowHeight"), original.top - original.bottom);
  assert.match(editor.inspectorHtml(), /通高整窗，窗台距1层完成地面/);
  editor.updateSelectedNumber("windowHeight", 5400); editor.updateSelectedNumber("windowSill", 200);
  const panel = resolveLayoutFacades(editor.draft).glazing[0];
  assert.equal(panel.bottom, site.entranceRise + 200); assert.equal(panel.top - panel.bottom, 5400);
  assert.equal(editor.draft.exteriorOpenings[lower].opening.height, 5400);
  assert.equal(editor.draft.exteriorOpenings[upper].opening.height, undefined);
  assert.equal(exteriorWindowProfile(editor.draft, lower)!.height, 5400);
  const mat = materials(), model = buildEditorModel(editor.draft, mat, "full"), villa = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(editor.draft));
  for (const root of [model.root, villa.group]) {
    root.updateMatrixWorld(true);
    const groups: THREE.Object3D[] = []; root.traverse(o => { if (o.userData.continuousGlazing) groups.push(o); });
    assert.equal(groups.length, 1);
    const bounds = new THREE.Box3().setFromObject(groups[0], true);
    close(bounds.min.y, panel.bottom); close(bounds.max.y, panel.top);
  }
  disposeEditorModel(model.root, new THREE.Scene());
  editor.resetSelectedWindowDimensions();
  assert.equal(field(editor.inspectorHtml(), "windowHeight"), original.top - original.bottom);
});

test("入口二楼窗高和窗台联动上段玻璃及层间装饰，保留一门到顶和默认值", () => {
  const draft = clonePublishedLayout(), entry = resolveLayoutFacades(draft).entries[0], index = entry.upperSourceIndex!;
  const editor = exteriorEditor(index, draft);
  assert.equal(field(editor.inspectorHtml(), "windowSill"), 320);
  editor.updateSelectedNumber("windowHeight", 1800); editor.updateSelectedNumber("windowSill", 500);
  const changed = resolveLayoutFacades(editor.draft).entries[0];
  assert.equal(changed.bandTop, draft.floors[1].y + 500); assert.equal(changed.top - changed.bandTop, 1800);
  assert.equal(changed.w, entry.w); assert.equal(changed.bandBottom, entry.bandBottom);
  const mat = materials(), house = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(editor.draft));
  house.group.updateMatrixWorld(true);
  const glass = new THREE.Box3().setFromObject(house.group.getObjectByName("门厅二楼门头玻璃")!, true);
  close(glass.min.y, changed.bandTop + 3); close(glass.max.y, changed.top - 73);
  editor.updateSelectedNumber("windowHeight", 200); editor.updateSelectedNumber("windowSill", 0);
  const minimum = resolveLayoutFacades(editor.draft).entries[0];
  assert.ok(minimum, "合法的小窗仍保留一门到顶组合");
  assert.equal(minimum.bandTop, draft.floors[1].y); assert.equal(minimum.top - minimum.bandTop, 200);
  editor.resetSelectedWindowDimensions();
  assert.equal(field(editor.inspectorHtml(), "windowSill"), 320);
  assert.equal(field(editor.inspectorHtml(), "windowHeight"), entry.top - entry.bandTop);
});

test("旧外窗移动、改宽、开间居中及JSON重载后仍保留自己的窗高和窗台", () => {
  const draft = clonePublishedLayout();
  const index = draft.exteriorOpenings.findIndex(o => o.floor === 1 && o.facadeIndex === 1 && o.opening.offset < 3000);
  const editor = exteriorEditor(index, draft), initial = exteriorWindowProfile(editor.draft, index)!;
  assert.equal(initial.height, 1800); assert.equal(initial.sill, 900);
  editor.updateSelectedNumber("offset", 6000);
  editor.updateSelectedNumber("length", 2100);
  let actual = exteriorWindowProfile(editor.draft, index)!;
  assert.equal(actual.height, initial.height); assert.equal(actual.sill, initial.sill);
  const version = parseLayoutVersionDocument(buildLayoutVersionDocument(editor.draft));
  const reloaded = exteriorEditor(index, version.layoutDraft);
  reloaded.updateSelectedNumber("offset", 4500);
  reloaded.centerSelectedOpeningInBay();
  actual = exteriorWindowProfile(reloaded.draft, index)!;
  assert.equal(actual.height, initial.height); assert.equal(actual.sill, initial.sill);
  assert.match(reloaded.inspectorHtml(), /窗宽/);
  reloaded.undo(); reloaded.selection = { kind: "door", floor: 1, index, exterior: true };
  assert.equal(exteriorWindowProfile(reloaded.draft, index)!.height, initial.height);
});

test("新放入的普通外窗不继承附近高窗，三楼檐下优先保留1800窗高", () => {
  for (const floor of [1, 2]) {
    const draft = clonePublishedLayout();
    draft.exteriorOpenings = draft.exteriorOpenings.filter(o => o.floor !== floor);
    draft.floors[floor].partitions = [];
    const editor = new LayoutEditor({ getFloor: () => floor, redraw: () => {}, toast: () => {} } as never, draft);
    editor.openingKind = "window";
    assert.ok(editor.placeOpeningNear(site.main.x + site.main.w / 2, site.main.z + site.main.d - 120));
    const index = editor.draft.exteriorOpenings.length - 1;
    const actual = exteriorWindowProfile(editor.draft, index)!;
    assert.equal(actual.height, 1800);
    assert.equal(actual.sill, Math.min(900, actual.maxTop - 1800));
    assert.equal(editor.draft.exteriorOpenings[index].opening.height, actual.height);
    assert.equal(editor.draft.exteriorOpenings[index].opening.sill, actual.sill);
  }
});

test("接管旧稿的竖向尺寸只补齐普通窗，不改变通高门窗及原立面造型", () => {
  const all = [clonePublishedLayout(), ...readdirSync(new URL("../data/户型/", import.meta.url))
    .filter(file => file !== "index.json").map(file => parseLayoutVersionDocument(JSON.parse(readFileSync(new URL(`../data/户型/${file}`, import.meta.url), "utf8"))).layoutDraft)];
  for (const draft of all) {
    const before = JSON.stringify(resolveLayoutFacades(draft));
    const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, structuredClone(draft));
    assert.equal(JSON.stringify(resolveLayoutFacades(editor.draft)), before);
  }
});

test("楼梯在西侧保存稿12扇背窗的墙洞、框、玻璃和立面严格使用本窗参数", () => {
  const { layoutDraft: draft } = parseLayoutVersionDocument(JSON.parse(readFileSync(new URL("../data/户型/户型-20261023-210731.json", import.meta.url), "utf8")));
  const mat = materials(), model = buildEditorModel(draft, mat, "full");
  const house = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft));
  const resolved = resolveLayoutFacades(draft), elevation = elevationModel("joined", villaLayoutFromDraft(draft));
  house.group.updateMatrixWorld(true); model.root.updateMatrixWorld(true);
  let count = 0;
  for (let floor = 0; floor < 3; floor++) {
    const facade = resolved.facades[floor].find(face => Math.abs(face.a[1] - (site.main.z + site.main.d - 120)) < 1 && face.a[1] === face.b[1])!;
    let wall: THREE.Object3D | undefined;
    house.levels[floor].traverse(o => {
      if (o instanceof THREE.Mesh && o.geometry instanceof THREE.ExtrudeGeometry && o.material === mat.sand && Math.abs(o.parent!.position.x - facade.a[0]) < 1 && Math.abs(o.parent!.position.z - facade.a[1]) < 1) wall = o.parent!;
    });
    assert.ok(wall);
    for (const opening of facade.openings) {
      const source = draft.exteriorOpenings[opening.layoutSourceIndex!].opening;
      assert.equal(source.height, 1800); assert.equal(opening.h, source.height);
      assert.equal(source.sill, [450, 900, 700][floor]);
      const profile = exteriorWindowProfile(draft, opening.layoutSourceIndex!)!;
      assert.equal(profile.height, source.height); assert.equal(profile.sill, source.sill);
      const bottom = draft.floors[floor].y + (floor === 0 ? site.entranceRise : 0) + source.sill!;
      const meshes: THREE.Mesh[] = []; wall!.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
      const frames = meshes.filter(o => o.material === mat.dark && Math.abs(o.position.x - opening.at) < opening.w / 2);
      const glass = meshes.filter(o => o.material === mat.glass && Math.abs(o.position.x - opening.at) < opening.w / 2);
      const bounds = (objects: THREE.Object3D[]) => objects.reduce((b, o) => b.union(new THREE.Box3().setFromObject(o, true)), new THREE.Box3());
      const frame = bounds(frames), pane = bounds(glass);
      close(frame.min.y, bottom); close(frame.max.y, bottom + source.height!);
      close(frame.getSize(new THREE.Vector3()).x, source.width);
      close(pane.min.y, bottom + (source.width <= 1760 ? 103 : 63)); close(pane.max.y, bottom + source.height! - 63);
      const physicalWall = wall!.children[0] as THREE.Mesh<THREE.ExtrudeGeometry>;
      const shape = physicalWall.geometry.parameters.shapes as THREE.Shape;
      const hole = shape.holes.find(h => Math.abs(Math.min(...h.getPoints().map(p => p.x)) - (opening.at - opening.w / 2)) < 1)!;
      assert.ok(hole);
      close(Math.min(...hole.getPoints().map(p => p.y)), opening.sill);
      close(Math.max(...hole.getPoints().map(p => p.y)), opening.sill + source.height!);
      let edit: THREE.Object3D | undefined;
      model.levels[floor].traverse(o => { if (o.userData.layoutSelection?.exterior && o.userData.layoutSelection.index === opening.layoutSourceIndex) edit = o; });
      const editBounds = new THREE.Box3().setFromObject(edit!, true);
      close(editBounds.min.y, frame.min.y); close(editBounds.max.y, frame.max.y);
      assert.ok(elevation.floors[floor].facades.flatMap(face => face.openings).some(o => o.layoutSourceIndex === opening.layoutSourceIndex && o.h === source.height && o.sill === opening.sill));
      count++;
    }
  }
  assert.equal(count, 12);
  disposeEditorModel(model.root, new THREE.Scene());
});
