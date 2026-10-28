import test from "node:test";
import assert from "node:assert/strict";
import { bayBetweenWalls, centerOpeningInBay } from "../src/layout-align.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import type { Wall } from "../src/data.ts";

const walls: Wall[] = [
  { a: [20200, 4100], b: [11500, 4100], role: "bearing" },
  { a: [20200, 5900], b: [17080, 5900], role: "partition" },
];
const opening = { offset: 4710, width: 900, kind: "window" as const, height: 1200, sill: 900 };

test("东侧内卫窗按不同墙厚的内表面居中", () => {
  const bay = bayBetweenWalls([20080, -160], [20080, 9360], opening, walls);
  assert.equal(bay.bayStart, 4380);
  assert.equal(bay.bayEnd, 6000);
  assert.equal(centerOpeningInBay(bay, opening.width), 4740);
  assert.equal(centerOpeningInBay(bay, opening.width) + opening.width / 2 - bay.bayStart, bay.bayEnd - centerOpeningInBay(bay, opening.width) - opening.width / 2);
});

test("反向墙线、平行墙和未接触的墙不会扰乱净开间", () => {
  const extra: Wall[] = [
    { a: [20080, 4700], b: [20080, 5200], role: "partition" },
    { a: [19000, 5000], b: [19700, 5000], role: "bearing" },
  ];
  const bay = bayBetweenWalls([20080, 9360], [20080, -160], { ...opening, offset: 9520 - opening.offset - opening.width }, [...walls, ...extra]);
  assert.equal(bay.bayStart, 3520);
  assert.equal(bay.bayEnd, 5140);
  assert.equal(centerOpeningInBay(bay, opening.width), 3880);
});

test("编辑器居中后保留窗户尺寸，可撤销；净开间不足时不移动", () => {
  const draft = clonePublishedLayout();
  draft.floors[0].partitions = structuredClone(walls);
  draft.exteriorOpenings = [{ floor: 0, facadeIndex: 3, opening: { ...opening } }];
  const messages: string[] = [];
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: (s: string) => messages.push(s) } as never, draft);
  editor.selection = { kind: "door", floor: 0, index: 0, exterior: true };
  editor.centerSelectedOpeningInBay();
  assert.equal(editor.draft.exteriorOpenings[0].opening.offset, 4740);
  assert.equal(editor.draft.exteriorOpenings[0].opening.height, 1200);
  assert.equal(editor.draft.exteriorOpenings[0].opening.sill, 900);
  editor.undo();
  assert.equal(editor.draft.exteriorOpenings[0].opening.offset, 4710);
  editor.selection = { kind: "door", floor: 0, index: 0, exterior: true };
  editor.draft.exteriorOpenings[0].opening.width = 1700;
  editor.centerSelectedOpeningInBay();
  assert.equal(editor.draft.exteriorOpenings[0].opening.offset, 4710);
  assert.match(messages.at(-1)!, /净宽不足/);
});
