import test from "node:test";
import assert from "node:assert/strict";
import { LayoutEditor } from "../src/layout-editor.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft } from "../src/layout-draft.ts";
import { createFurniture } from "../src/furniture-catalog.ts";
import { mirrorFurniture } from "../src/building-variants.ts";

test("淋浴门位置可编辑、撤销并随户型往返，旧件默认对面", () => {
  for (const annex of [false, true]) for (const kind of ["shower", "fp-shower"] as const) {
    const draft = clonePublishedLayout(), f = createFurniture(kind, 10000, 5000);
    if (annex) draft.annexFurniture = [f]; else draft.floors[0].furniture = [f];
    const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, draft);
    editor.selection = { kind: "furniture", floor: 0, index: 0, annex };
    assert.match(editor.inspectorHtml(), /花洒对面/);
    editor.updateSelectedShowerDoorSide("left");
    const list = () => annex ? editor.draft.annexFurniture : editor.draft.floors[0].furniture;
    assert.equal(list()[0].showerDoorSide, "left");
    assert.equal(list()[0].rotation, f.rotation);
    const loaded = parseLayoutDraft(draftToJson(editor.draft));
    assert.equal((annex ? loaded.annexFurniture : loaded.floors[0].furniture)[0].showerDoorSide, "left");
    assert.equal(mirrorFurniture(list()[0], 21000).showerDoorSide, "right");
    editor.undo();
    assert.equal(list()[0].showerDoorSide, undefined);
    editor.redo();
    assert.equal(list()[0].showerDoorSide, "left");
  }
});

test("三种淋浴房造型与推拉开度可编辑、撤销和严格回读，尺寸及花洒位置保留", () => {
  for (const annex of [false, true]) for (const kind of ["shower", "fp-shower"] as const) {
    const draft = clonePublishedLayout(), f = createFurniture(kind, 10000, 5000);
    if (annex) draft.annexFurniture = [f]; else draft.floors[0].furniture = [f];
    const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} } as never, draft);
    editor.selection = { kind: "furniture", floor: 0, index: 0, annex };
    const list = () => annex ? editor.draft.annexFurniture : editor.draft.floors[0].furniture;
    for (const shape of ["inline", "corner", "quadrant"]) {
      editor.selection = { kind: "furniture", floor: 0, index: 0, annex };
      editor.updateSelectedShowerOption("showerShape", shape);
      editor.updateSelectedShowerOption("showerOpening", "100");
      const loaded = parseLayoutDraft(draftToJson(editor.draft));
      const item = (annex ? loaded.annexFurniture : loaded.floors[0].furniture)[0];
      assert.equal(item.showerShape, shape); assert.equal(item.showerOpening, 100);
      const legacy = JSON.parse(draftToJson(editor.draft));
      (annex ? legacy.annexFurniture : legacy.floors[0].furniture)[0].showerShape = "semicircle";
      const migrated = parseLayoutDraft(JSON.stringify(legacy));
      assert.equal((annex ? migrated.annexFurniture : migrated.floors[0].furniture)[0].showerShape, "quadrant");
      assert.equal(item.w, f.w); assert.equal(item.d, f.d); assert.equal(item.rotation, f.rotation);
      editor.updateSelectedShowerOption("showerOpening", "50");
      editor.undo(); assert.equal(list()[0].showerOpening, 100);
      editor.redo(); assert.equal(list()[0].showerOpening, 50);
      const bad = structuredClone(editor.draft);
      (annex ? bad.annexFurniture : bad.floors[0].furniture)[0].showerOpening = 101;
      assert.throws(() => parseLayoutDraft(JSON.stringify(bad)), /移门开度/);
    }
  }
});

test("所有淋浴造型的活动门沿轨道错层滑动，关闭接合、全开让出中央通口", async () => {
  const THREE = await import("three");
  const { showerModel, showerOutline } = await import("../src/shower-model.ts");
  for (const shape of ["inline", "corner", "quadrant"] as const) for (const side of ["front", "left", "right"] as const) {
    const f = { ...createFurniture("shower", 10000, 5000), w: 1200, d: 1000, showerShape: shape, showerDoorSide: side };
    const closed = showerModel(f), open = showerModel({ ...f, showerOpening: 100 });
    const named = (g: import("three").Group, name: string) => { const all: import("three").Object3D[] = []; g.traverse(o => { if (o.name === name) all.push(o); }); return all; };
    assert.equal(named(closed, "推拉活动玻璃").length, 2);
    assert.equal(named(closed, "移门拉手").length, 2);
    assert.equal(named(closed, "固定玻璃").length, shape === "corner" ? 3 : 2);
    const panes = named(closed, "推拉活动玻璃"), opened = named(open, "推拉活动玻璃");
    for (let i = 0; i < 2; i++) {
      const before = new THREE.Box3().setFromObject(panes[i]).getCenter(new THREE.Vector3());
      const after = new THREE.Box3().setFromObject(opened[i]).getCenter(new THREE.Vector3());
      assert.ok(before.distanceTo(after) > 100, "活动玻璃确实沿轨道移动");
    }
    assert.deepEqual(new THREE.Box3().setFromObject(named(closed, "花洒顶喷")[0]), new THREE.Box3().setFromObject(named(open, "花洒顶喷")[0]));
    const bounds = new THREE.Box3().setFromObject(open);
    assert.ok(bounds.min.x >= -f.w / 2 - 1 && bounds.max.x <= f.w / 2 + 1);
    assert.ok(bounds.min.z >= -f.d / 2 - 1 && bounds.max.z <= f.d / 2 + 1);
    assert.ok(showerOutline(f).length > (shape === "inline" || shape === "corner" ? 3 : 30));
  }
});
