import assert from "node:assert/strict";
import { test } from "node:test";
import { site, type Room, type Wall } from "../src/data.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft } from "../src/layout-draft.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { polygonIntersectionAreaMm2 } from "../src/plan-regions.ts";
import { polygonAreaMm2, roomOutline } from "../src/room-geometry.ts";

function make(floor: number, annex: boolean) {
  const draft = clonePublishedLayout();
  const body = annex ? site.annex : {
    ...site.main, z: draft.floors[floor]!.front,
    d: site.main.z + site.main.d - draft.floors[floor]!.front,
  };
  const parent: Room = { id: "original", name: "原卧室", kind: "bed", x: body.x, z: body.z, w: body.w, d: body.d };
  const walls: Wall[] = [
    { id: "new-h", role: "partition", a: [body.x + 240, body.z + 1500], b: [body.x + 1800, body.z + 1500] },
    { id: "new-v", role: "partition", a: [body.x + 1800, body.z + 1500], b: [body.x + 1800, body.z + 240] },
  ];
  if (annex) { draft.annexRooms = [parent]; draft.annexPartitions = walls; }
  else Object.assign(draft.floors[floor]!, { rooms: [parent], partitions: walls, furniture: [] });
  const messages: string[] = [];
  const editor = new LayoutEditor({ getFloor: () => floor, redraw: () => {}, toast: s => messages.push(s) }, draft);
  const rooms = () => annex ? editor.draft.annexRooms : editor.draft.floors[floor]!.rooms;
  return { editor, body, rooms, messages };
}

function assertSplit(rooms: Room[], area: number) {
  assert.equal(rooms.length, 2);
  assert.equal(rooms.find(r => r.id === "original")!.outline?.length, 6);
  assert.equal(rooms.reduce((sum, r) => sum + polygonAreaMm2(roomOutline(r)), 0), area);
  assert.equal(polygonIntersectionAreaMm2(roomOutline(rooms[0]!), roomOutline(rooms[1]!)), 0);
}

test("三层主楼及辅楼的全局生成、手动放置均完整分割，单步撤销重做及JSON保留轮廓", () => {
  for (const [floor, annex] of [[0, false], [1, false], [2, false], [0, true]] as const) {
    for (const manual of [false, true]) {
      const { editor, body, rooms } = make(floor, annex);
      const initial = structuredClone(rooms());
      if (manual) {
        editor.roomKind = "bath";
        editor.placeRoomAt(body.x + 1000, body.z + 1000);
        const child = rooms().find(r => r.id !== "original")!;
        assert.equal(child.kind, "bath");
        assert.equal(child.purposeStatus, undefined);
        assert.equal((editor.selection as { id: string }).id, child.id);
      } else assert.equal(editor.generateAutoRooms(annex).created, 1);
      assertSplit(rooms(), body.w * body.d);
      const after = JSON.parse(JSON.stringify(rooms()));
      const loaded = parseLayoutDraft(draftToJson(editor.draft));
      assert.deepEqual(annex ? loaded.annexRooms : loaded.floors[floor]!.rooms, after);
      assert.equal(editor.generateAutoRooms(annex).created, 0);
      assert.deepEqual(JSON.parse(JSON.stringify(rooms())), after);
      editor.placeRoomAt(body.x + 1000, body.z + 1000);
      assert.deepEqual(JSON.parse(JSON.stringify(rooms())), after);
      editor.undo();
      assert.deepEqual(rooms(), initial);
      editor.redo();
      assert.deepEqual(rooms(), after);
    }
  }
});

test("最后一段墙由方向键接到外墙时自动完成分割，无需另点全局生成", () => {
  const { editor, body, rooms } = make(0, false);
  const wall = editor.draft.floors[0]!.partitions[1]!;
  // 先把竖墙放在离北墙内皮 100 mm 的位置，向北微移才闭合。
  wall.a[1] += 100; wall.b[1] += 100;
  editor.selection = { kind: "wall", floor: 0, index: 1 };
  editor.nudgeSelection(0, -100);
  assertSplit(rooms(), body.w * body.d);
});

test("内部独立四墙会留下带洞原房时手动放置不重复填色，并提示原因", () => {
  const { editor, body, rooms, messages } = make(0, false);
  const p: [number, number][] = [[1000, 1000], [2500, 1000], [2500, 2500], [1000, 2500]]
    .map(([x, z]) => [body.x + x!, body.z + z!]);
  editor.draft.floors[0]!.partitions = p.map((a, i) => ({ id: `ring-${i}`, a, b: p[(i + 1) % 4]! }));
  const before = structuredClone(rooms());
  editor.placeRoomAt(body.x + 1500, body.z + 1500);
  assert.deepEqual(rooms(), before);
  assert.match(messages.at(-1) ?? "", /重叠|分界/);
});
