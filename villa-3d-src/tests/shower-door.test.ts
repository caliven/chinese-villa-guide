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
