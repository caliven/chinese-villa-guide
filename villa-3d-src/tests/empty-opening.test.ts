import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { site, construction } from "../src/data.ts";
import { OPENING_KINDS, createOpening, openingLabels, openingHandlesSvg, openingSymbolSvg } from "../src/openings.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft, removeStairFromDraft, facadeOpeningToWallOpening } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { buildLayoutVersionDocument, parseLayoutVersionDocument } from "../src/data-versions.ts";
import { libraryCardsHtml } from "../src/plan-designer.ts";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model.ts";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture.ts";
import { wallWithOpenings, type Mats } from "../src/primitives.ts";
import { pickEmptyOpening, selectionBounds } from "../src/layout-scene.ts";
import { resolveLayoutFacades } from "../src/facade-layout.ts";
import { elevationSvg } from "../src/elevation-plan.ts";

const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
const materials = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });

function fixture() {
  const draft = clonePublishedLayout(); removeStairFromDraft(draft);
  draft.floors.forEach(floor => {
    floor.rooms = []; floor.furniture = [];
    floor.partitions = [{ a: [site.main.x + 1000, site.main.z + 4000], b: [site.main.x + 6000, site.main.z + 4000], door: createOpening("passage", 1800) }];
  });
  draft.annexPartitions = [{ a: [site.annex.x + 300, site.annex.z + 4000], b: [site.annex.x + 3300, site.annex.z + 4000], door: createOpening("passage", 800) }];
  draft.annexRooms = []; draft.annexFurniture = [];
  return draft;
}

test("门窗库提供无门洞口，平面只有墙缝和编辑命中条，不画门扇、开向、框或玻璃", () => {
  assert.ok(OPENING_KINDS.includes("passage"));
  const opening = createOpening("passage", 800);
  assert.equal(opening.width, 1200);
  const card = libraryCardsHtml("door", [{ value: "passage", text: openingLabels.passage, active: false }]);
  assert.match(card, /data-palette-kind="passage"/);
  assert.match(card, /门洞（无门）/);
  for (const thickness of [120, 240, 300]) {
    const symbol = openingSymbolSvg(opening, thickness), editable = openingHandlesSvg(opening, 0, false, true, thickness);
    assert.match(symbol, /class="door-gap"/);
    assert.doesNotMatch(symbol, /door-leaf|door-swing|sliding-panel|window-symbol/);
    assert.match(editable, /data-edit="door"/);
    assert.match(editable, /data-edit="door-handle"/);
  }
});

test("无门洞口可放到主辅楼墙上、改宽和偏移、转换现有门、撤销重做，并随户型JSON保存", () => {
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, fixture());
  editor.openingKind = "passage";
  assert.ok(editor.placeOpeningNear(site.main.x + 3500, site.main.z + 4000));
  assert.equal(editor.draft.floors[0].partitions[0].door!.kind, "passage");
  editor.updateSelectedNumber("length", 1600);
  editor.updateSelectedNumber("offset", 1700);
  editor.updateOpeningField("kind", "door");
  editor.updateOpeningField("kind", "passage");
  const opening = () => editor.draft.floors[0].partitions[0].door!;
  assert.equal(opening().width, 1600); assert.equal(opening().offset, 1700);
  assert.doesNotMatch(editor.inspectorHtml(), /铰链侧|扇叶开向/);
  editor.undo(); assert.equal(opening().kind, "door");
  editor.redo(); assert.equal(opening().kind, "passage");
  assert.ok(editor.placeOpeningNear(site.annex.x + 1800, site.annex.z + 4000));
  assert.equal(editor.draft.annexPartitions[0].door!.kind, "passage");
  const loaded = parseLayoutDraft(draftToJson(editor.draft));
  assert.equal(loaded.floors[0].partitions[0].door!.width, 1600);
  assert.equal(loaded.floors[0].partitions[0].door!.kind, "passage");
  assert.equal(loaded.annexPartitions[0].door!.kind, "passage");
  const version = parseLayoutVersionDocument(JSON.parse(JSON.stringify(buildLayoutVersionDocument(loaded))));
  assert.deepEqual(version.layoutDraft.floors, loaded.floors);
  assert.deepEqual(version.layoutDraft.annexPartitions, loaded.annexPartitions);
});

test("纯门洞贯穿实际墙厚，两侧墙垛与上方墙体保留，内外墙及正反墙向均不生成填充模型", () => {
  for (const interior of [false, true]) for (const b of [[4000, 0], [-4000, 0], [0, 4000], [0, -4000]] as [number, number][]) {
    const root = new THREE.Group();
    const wall = wallWithOpenings(root, [0, 0], b, 450, 3150, [{ at: 2000, w: 1200, sill: 0, h: 2200, door: true, kind: "passage" }], materials(), 300, interior);
    root.updateMatrixWorld(true);
    const hits = (x: number, y: number) => {
      const origin = wall.localToWorld(new THREE.Vector3(x, y, -1000));
      const direction = new THREE.Vector3(0, 0, 1).transformDirection(wall.matrixWorld);
      return new THREE.Raycaster(origin, direction).intersectObjects(wall.children, true);
    };
    assert.equal(wall.children.length, 1, "只允许生成挖空后的墙体");
    assert.equal(hits(2000, 1100).length, 0, "洞口中间必须完全留空");
    assert.ok(hits(500, 1100).length > 0, "保留左墙垛");
    assert.ok(hits(3500, 1100).length > 0, "保留右墙垛");
    assert.ok(hits(2000, 2600).length > 0, "保留门洞上方墙体");
  }
});

test("三层及辅楼的剖切、全高三维和完整房屋洞口一致，空洞仍可点选定位且不会穿过遮挡物", () => {
  const draft = fixture(), before = structuredClone(draft), mat = materials();
  const house = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft));
  for (const cut of [1200, "full"] as const) {
    const editor = buildEditorModel(draft, mat, cut), mmRoot = new THREE.Group(); mmRoot.scale.setScalar(.001); mmRoot.add(editor.root);
    for (const index of [0, 1, 2, 3]) {
      const annex = index === 3, floor = annex ? 0 : index, selection = { kind: "door" as const, floor, index: 0, annex };
      const part = annex ? draft.annexPartitions[0] : draft.floors[floor].partitions[0];
      const finish = floor === 0 ? site.entranceRise : draft.floors[floor].y;
      const x = part.a[0] + part.door!.offset + part.door!.width / 2, z = part.a[1];
      const ray = new THREE.Ray(new THREE.Vector3(x / 1000, (finish + 1100) / 1000, (z - 1000) / 1000), new THREE.Vector3(0, 0, 1));
      assert.deepEqual(pickEmptyOpening(editor.root, ray, floor), selection);
      assert.equal(pickEmptyOpening(editor.root, ray, floor, .1), null, "洞口前有实体时不得穿透点选");
      const bounds = selectionBounds(editor.root, selection)!;
      assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).x - 1.2) < .00001);
      assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y - (cut === "full" ? 2.2 : 1.2)) < .00001);
      assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).z - construction.partition / 1000) < .00001);
      const physicalWall: THREE.Object3D[] = [];
      (annex ? house.annex : house.levels[floor]).traverse(o => {
        if (o instanceof THREE.Mesh && o.geometry instanceof THREE.ExtrudeGeometry && o.material === mat.inside && Math.abs(o.parent!.position.x - part.a[0]) < 1 && Math.abs(o.parent!.position.z - part.a[1]) < 1) physicalWall.push(o.parent!);
      });
      assert.equal(physicalWall.length, 1);
      assert.equal(physicalWall[0].children.length, 1, "房屋内墙洞口不能补回门窗或框料");
      const houseRay = new THREE.Raycaster(new THREE.Vector3(x, finish + 1100, z - 1000), new THREE.Vector3(0, 0, 1));
      house.group.updateMatrixWorld(true);
      assert.equal(houseRay.intersectObjects(physicalWall[0].children, true).length, 0);
    }
    disposeEditorModel(editor.root, new THREE.Scene());
  }
  assert.deepEqual(draft, before);
});

test("外墙改为纯门洞后，平面、三维和立面保留该类型，不重新拼接入口门窗", () => {
  const draft = fixture();
  const entry = draft.exteriorOpenings.find(item => item.floor === 0 && item.facadeIndex === 0 && ["door", "doubleDoor"].includes(item.opening.kind ?? "door"))!;
  assert.ok(entry);
  entry.opening.kind = "passage";
  const resolved = resolveLayoutFacades(draft);
  const passage = resolved.facades[0].flatMap(face => face.openings).find(o => o.kind === "passage")!;
  assert.ok(passage);
  assert.equal(passage.sill, site.entranceRise);
  assert.equal(passage.continuous, undefined); assert.equal(passage.entryAssembly, undefined);
  assert.equal(resolved.entries.length, 0);
  assert.equal(facadeOpeningToWallOpening(passage).kind, "passage");
  assert.equal(parseLayoutDraft(draftToJson(draft)).exteriorOpenings.find(item => item.opening.kind === "passage")!.opening.width, entry.opening.width);
  assert.match(elevationSvg("north", "joined", villaLayoutFromDraft(draft)), /class="el-passage"><title>门洞（无门）/);
});
