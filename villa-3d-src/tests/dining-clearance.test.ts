import assert from "node:assert/strict";
import { test } from "node:test";
import { annexFurniture, site, type Furniture } from "../src/data.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { diningClearance, floorPlan, planSourceFromDraft, type PlanOptions } from "../src/plan.ts";

function fixture() {
  const draft = clonePublishedLayout();
  draft.annexRooms = [];
  draft.annexPartitions = [];
  draft.annexFurniture = [{ kind: "roundTable", x: site.annex.x + 1800, z: site.annex.z + 2200, w: 1200, d: 1200 }];
  return draft;
}

function ranges(draft: ReturnType<typeof fixture>, options: PlanOptions = {}, clearance = true, floor = 0) {
  const svg = floorPlan(floor, clearance, false, options, planSourceFromDraft(draft, floor));
  return [...svg.matchAll(/<circle\b[^>]*class="clearance"[^>]*>/g)].map(([tag]) => {
    const attr = (name: string) => Number(tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]);
    return { x: attr("cx"), z: attr("cy"), r: attr("r") };
  });
}

test("拉椅圈读取当前草稿，连续画布与导出图均随圆桌平移及直径变化", () => {
  const published = structuredClone(annexFurniture);
  for (const editorCanvas of [false, true]) {
    const draft = fixture();
    const table = draft.annexFurniture[0]!;
    assert.deepEqual(ranges(draft, { editorCanvas }), [{ x: table.x, z: table.z, r: 1150 }]);
    table.x += 280; table.z += 360; table.w += 200; table.d = table.w;
    assert.deepEqual(ranges(draft, { editorCanvas }), [{ x: table.x, z: table.z, r: table.w / 2 + 550 }]);
  }
  assert.deepEqual(annexFurniture, published, "绘制草稿不能改写正式家具");
});

test("删除最后一张圆桌后不留虚线圈，关闭显示、日常收起及其它楼层均不画圈", () => {
  const draft = fixture();
  assert.equal(ranges(draft, {}, false).length, 0);
  assert.equal(ranges(draft, { dining: "daily" }).length, 0);
  assert.equal(ranges(draft, {}, true, 1).length, 0);
  draft.annexFurniture = [];
  assert.equal(ranges(draft).length, 0);
  assert.equal(diningClearance([]), null);
});

test("旧圆桌和家具库圆桌各有独立拉椅圈，移动或删除其中一张不串位", () => {
  const draft = fixture();
  const added: Furniture = { kind: "fp-roundtable", x: site.annex.x + 2300, z: site.annex.z + 6000, w: 1000, d: 1000 };
  draft.annexFurniture.push(added);
  assert.deepEqual(ranges(draft), [
    { x: draft.annexFurniture[0]!.x, z: draft.annexFurniture[0]!.z, r: 1150 },
    { x: added.x, z: added.z, r: 1050 },
  ]);
  added.x -= 300; added.w = added.d = 1400;
  draft.annexFurniture.shift();
  assert.deepEqual(ranges(draft), [{ x: added.x, z: added.z, r: 1250 }]);
  assert.equal(ranges(draft, { dining: "daily" }).length, 0);
});

test("编辑器移动、改直径、删除与撤销重做后，拉椅圈始终跟随同一圆桌", () => {
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} }, fixture());
  const selection = { kind: "furniture" as const, floor: 0, annex: true, index: 0 };
  const before = ranges(editor.draft);
  editor.moveFurnitureTo(selection, site.annex.x + 2400, site.annex.z + 4500, false);
  assert.deepEqual(ranges(editor.draft), [{ x: site.annex.x + 2400, z: site.annex.z + 4500, r: 1150 }]);
  editor.updateSelectedNumber("w", 1600);
  const resized = ranges(editor.draft);
  assert.equal(resized[0]!.r, 1350);
  editor.deleteSelection();
  assert.equal(ranges(editor.draft).length, 0);
  editor.undo(); assert.deepEqual(ranges(editor.draft), resized);
  editor.undo(); assert.equal(ranges(editor.draft)[0]!.r, 1150);
  editor.undo(); assert.deepEqual(ranges(editor.draft), before);
  editor.redo(); editor.redo(); assert.deepEqual(ranges(editor.draft), resized);
});
