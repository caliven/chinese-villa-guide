import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createFurniture } from "../src/furniture-catalog";
import { clonePublishedLayout, draftToJson, parseLayoutDraft } from "../src/layout-draft";
import { LayoutEditor } from "../src/layout-editor";
import { ritualTeaModel, SHRINE_HEIGHT } from "../src/ritual-tea-model";
import { furnish, type Mats } from "../src/primitives";
import { site } from "../src/data";
import { furnitureUsesWallCenter } from "../src/layout-align";

const mat = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshStandardMaterial() as never });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < .01, `${a} != ${b}`);

test("新模型可从家具库放置并随三层户型回读，茶桌自由摆放，供奉家具可靠墙居中", () => {
  const draft = clonePublishedLayout();
  for (const floor of draft.floors) { floor.rooms = []; floor.partitions = []; floor.furniture = []; }
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, draft);
  const kinds = ["fp-hunan-shrine", "fp-offering-table", "fp-tea-table"] as const;
  kinds.forEach((kind, i) => editor.placeAt(site.main.x + 2000 + i * 3000, site.main.z + 4500, "furniture", kind));
  assert.deepEqual(editor.draft.floors[0].furniture.map(f => f.kind), kinds);
  const loaded = parseLayoutDraft(draftToJson(editor.draft));
  assert.deepEqual(loaded.floors[0].furniture, editor.draft.floors[0].furniture);
  assert.equal(furnitureUsesWallCenter("fp-tea-table"), false);
  assert.equal(furnitureUsesWallCenter("fp-hunan-shrine"), true);
  assert.equal(furnitureUsesWallCenter("fp-offering-table"), true);
});

test("壁挂神龛底高可改、可撤销，严格保存并拒绝超出本层的挂装", () => {
  for (const annex of [false, true]) {
    const draft = clonePublishedLayout(), f = createFurniture("fp-hunan-shrine", site.main.x + 7000, site.main.z + 4500);
    if (annex) draft.annexFurniture = [f]; else draft.floors[0].furniture = [f];
    const messages: string[] = [];
    const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: (message: string) => messages.push(message) } as never, draft);
    const item = () => (annex ? editor.draft.annexFurniture : editor.draft.floors[0].furniture)[0];
    editor.selection = { kind: "furniture", floor: 0, index: 0, annex };
    assert.match(editor.inspectorHtml(), /挂装底高/);
    editor.updateSelectedNumber("mountHeight", 1600);
    assert.equal(item().mountHeight, 1600);
    const loaded = parseLayoutDraft(draftToJson(editor.draft));
    assert.equal((annex ? loaded.annexFurniture : loaded.floors[0].furniture)[0].mountHeight, 1600);
    editor.undo(); assert.equal(item().mountHeight, 1400);
    editor.redo(); assert.equal(item().mountHeight, 1600);
    editor.selection = { kind: "furniture", floor: 0, index: 0, annex };
    editor.updateSelectedNumber("mountHeight", 9000);
    assert.equal(item().mountHeight, 1600); assert.ok(messages.some(message => message.includes("净高")));
    const bad = structuredClone(editor.draft);
    (annex ? bad.annexFurniture : bad.floors[0].furniture)[0].mountHeight = -1;
    assert.throws(() => parseLayoutDraft(draftToJson(bad)), /挂装底高/);
  }
});

test("神龛悬挂、供桌落地，缩放宽深不改变挂高／桌高且本层标高只加一次", () => {
  for (const kind of ["fp-hunan-shrine", "fp-offering-table", "fp-tea-table"] as const) {
    const f = createFurniture(kind, 1000, 2000); f.w *= 1.3; f.d *= .8;
    const group = furnish(new THREE.Group(), f, 3600, mat());
    const bounds = new THREE.Box3().setFromObject(group, true);
    near(bounds.getSize(new THREE.Vector3()).x, f.w); near(bounds.getSize(new THREE.Vector3()).z, f.d);
    near(bounds.min.y, 3600 + (kind === "fp-hunan-shrine" ? 1400 : 0));
    if (kind === "fp-hunan-shrine") near(bounds.max.y, 3600 + 1400 + SHRINE_HEIGHT);
    const top = group.getObjectByName(kind === "fp-tea-table" ? "实木茶桌台面" : kind === "fp-offering-table" ? "供桌台面" : "供台")!;
    const topBounds = new THREE.Box3().setFromObject(top, true);
    if (kind !== "fp-hunan-shrine") near(topBounds.max.y - 3600, kind === "fp-tea-table" ? 750 : 960);
  }
});

test("功夫茶桌具备四客泡茶器具且不把座椅混入桌子占地", () => {
  const group = ritualTeaModel(createFurniture("fp-tea-table", 0, 0));
  const names: string[] = []; group.traverse(object => names.push(object.name));
  for (const name of ["嵌入式茶盘", "紫砂茶壶", "公道杯", "电茶炉", "烧水壶"]) assert.ok(names.includes(name), name);
  assert.equal(names.filter(name => name === "品茗杯").length, 4);
  assert.ok(names.every(name => !name.includes("椅")));
});
