import assert from "node:assert/strict";
import test from "node:test";
import { site, type Wall } from "../src/data.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft, type LayoutDraft } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";

function editorFor(draft = clonePublishedLayout()) {
  const messages: string[] = [];
  const editor = new LayoutEditor({ getFloor: () => 0, redraw() {}, toast(message) { messages.push(message); } }, draft);
  return { editor, messages };
}

function emptyDraft() {
  const draft = clonePublishedLayout();
  for (const floor of draft.floors) { floor.rooms = []; floor.partitions = []; floor.furniture = []; }
  draft.annexRooms = []; draft.annexPartitions = []; draft.annexFurniture = [];
  return draft;
}

const content = (draft: LayoutDraft) => JSON.parse(JSON.stringify({ ...parseLayoutDraft(draftToJson(draft)), updatedAt: "" })) as LayoutDraft;
const wall = (x: number, z: number, index: number): Wall => ({ id: `test-${x}-${index}`, a: [x, z + index * 1200], b: [x + 1800, z + index * 1200], door: { kind: "door", width: 800, offset: 400 } });

test("混合多选删除主辅楼墙、内洞口与外窗，各数组索引独立且可撤销重做", () => {
  const draft = emptyDraft();
  draft.floors[0]!.partitions = [0, 1, 2].map(n => wall(site.main.x + 500, site.main.z + 500, n));
  draft.annexPartitions = [0, 1, 2].map(n => wall(site.annex.x + 500, site.annex.z + 500, n));
  const { editor } = editorFor(draft);
  const before = content(editor.draft);
  const mainExterior = editor.draft.exteriorOpenings.findIndex(o => o.floor === 0 && o.opening.kind === "window");
  const annexExterior = editor.draft.exteriorOpenings.findIndex(o => o.floor === 3 && o.opening.kind === "window");
  assert.ok(mainExterior >= 0 && annexExterior >= 0);
  editor.selections = [
    { kind: "wall", index: 0, floor: 0 }, { kind: "wall", index: 2, floor: 0 },
    { kind: "door", index: 1, floor: 0 },
    { kind: "wall", index: 1, floor: 0, annex: true },
    { kind: "door", index: 0, floor: 0, annex: true },
    { kind: "door", index: mainExterior, floor: 0, exterior: true },
    { kind: "door", index: annexExterior, floor: 0, exterior: true, annex: true },
  ];
  editor.deleteSelection();
  assert.deepEqual(editor.draft.floors[0]!.partitions.map(w => [w.id, w.door]), [[before.floors[0]!.partitions[1]!.id, undefined]]);
  assert.deepEqual(editor.draft.annexPartitions.map(w => w.id), [before.annexPartitions[0]!.id, before.annexPartitions[2]!.id]);
  assert.equal(editor.draft.annexPartitions[0]!.door, undefined);
  assert.ok(editor.draft.annexPartitions[1]!.door);
  assert.deepEqual(editor.draft.exteriorOpenings, before.exteriorOpenings.filter((_, i) => i !== mainExterior && i !== annexExterior));
  const deleted = content(editor.draft);
  editor.undo(); assert.deepEqual(content(editor.draft), before);
  editor.redo(); assert.deepEqual(content(editor.draft), deleted);
});

test("多选楼梯与家具时整套楼梯和其它所选对象一起删除", () => {
  const { editor } = editorFor();
  const original = content(editor.draft);
  const furnitureCount = editor.draft.floors[0]!.furniture.length;
  editor.selections = [{ kind: "stair" }, { kind: "furniture", index: 0, floor: 0 }];
  editor.deleteSelection();
  assert.ok(editor.draft.floors.every(f => f.rooms.every(r => r.kind !== "stair")));
  assert.equal(editor.draft.floors[0]!.furniture.length, furnitureCount - 1);
  editor.undo(); assert.deepEqual(content(editor.draft), original);
});

test("超出JSON范围的洞宽修改被拒绝，保留原稿及已有重做记录", () => {
  const { editor, messages } = editorFor();
  const index = editor.draft.exteriorOpenings.findIndex(o => o.floor === 0 && o.opening.kind === "window");
  editor.selection = { kind: "door", index, floor: 0, exterior: true };
  editor.updateSelectedNumber("length", 3000);
  editor.undo();
  const before = content(editor.draft);
  editor.selection = { kind: "door", index, floor: 0, exterior: true };
  editor.updateSelectedNumber("length", 6500);
  assert.deepEqual(content(editor.draft), before);
  assert.match(messages.at(-1)!, /超出范围.*已保留原状态/);
  assert.equal(editor.canUndo, false);
  assert.equal(editor.canRedo, true);
  assert.doesNotThrow(() => parseLayoutDraft(draftToJson(editor.draft)));
  editor.redo();
  assert.equal(editor.draft.exteriorOpenings[index]!.opening.width, 3000);
});

test("家具超大宽深不能生成无法重读的草稿", () => {
  for (const field of ["w", "d"]) {
    const draft = emptyDraft();
    const kind = clonePublishedLayout().floors[0]!.furniture[0]!.kind;
    draft.floors[0]!.furniture = [{ kind, x: site.main.x + 6000, z: site.main.z + 5000, w: 1000, d: 1000 }];
    const { editor, messages } = editorFor(draft);
    const before = content(editor.draft);
    editor.selection = { kind: "furniture", index: 0, floor: 0 };
    editor.updateSelectedNumber(field, 9000);
    assert.deepEqual(content(editor.draft), before);
    assert.ok(messages.some(message => /超出范围|放不下/.test(message)));
    assert.equal(editor.canUndo, false);
    assert.doesNotThrow(() => parseLayoutDraft(draftToJson(editor.draft)));
  }
});

test("超数量粘贴拒绝整次变更，不损坏当前草稿及撤销重做", () => {
  for (const kind of ["furniture", "wall", "room"] as const) {
    const draft = emptyDraft();
    if (kind === "furniture") draft.floors[0]!.furniture = Array.from({ length: 120 }, () => structuredClone(clonePublishedLayout().floors[0]!.furniture[0]!));
    if (kind === "wall") draft.floors[0]!.partitions = Array.from({ length: 80 }, (_, index) => ({ id: `wall-limit-${index}`, a: [site.main.x + 500, site.main.z + 500], b: [site.main.x + 1500, site.main.z + 500] }));
    if (kind === "room") draft.floors[0]!.rooms = Array.from({ length: 40 }, (_, index) => ({ id: `room-limit-${index}`, name: "房间", kind: "living", x: site.main.x + 500, z: site.main.z + 500, w: 1000, d: 1000 }));
    const { editor, messages } = editorFor(draft);
    const before = content(editor.draft);
    editor.selection = kind === "room" ? { kind, id: "room-limit-0", floor: 0 } : { kind, index: 0, floor: 0 };
    editor.copySelection(); editor.pasteClipboard();
    assert.deepEqual(content(editor.draft), before, kind);
    assert.match(messages.at(-1)!, /过多.*已保留原状态/);
    assert.equal(editor.canUndo, false);
    assert.doesNotThrow(() => parseLayoutDraft(draftToJson(editor.draft)));
  }
});
