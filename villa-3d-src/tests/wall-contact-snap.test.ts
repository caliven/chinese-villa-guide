import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { construction, site, type Wall } from "../src/data.ts";
import { parseLayoutVersionDocument } from "../src/data-versions.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { alignWallToNearestSide, snapWallDuringDrag } from "../src/layout-align.ts";
import { roomAreas } from "../src/design-data.ts";
import { enclosedRoomRegions } from "../src/plan-regions.ts";
import { normalizeConnectedWallEndpoints, normalizeDraftWallContacts, type WallContactTarget } from "../src/wall-contact-snap.ts";

const openingWorld = (wall: Wall) => {
  if (!wall.door) return null;
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const u = [(wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length];
  return [wall.a[0] + u[0]! * wall.door.offset, wall.a[1] + u[1]! * wall.door.offset,
    wall.door.width, wall.door.hinge, wall.door.side];
};

test("外墙端到远侧外皮、内墙端到中线，四方向及反向端序的门洞不漂移", () => {
  for (const transpose of [false, true]) for (const sign of [-1, 1]) for (const reverse of [false, true]) {
    const p = (x: number, z: number): [number, number] => transpose ? [sign * z, x] : [x, sign * z];
    const exterior: WallContactTarget = { a: p(0, 4000), b: p(5000, 4000), role: "bearing", exterior: true };
    const host: Wall = { a: p(0, 0), b: p(5000, 0), role: "bearing" };
    const wall: Wall = { a: p(2000, 120), b: p(2000, 4000), role: "bearing",
      door: { offset: 500, width: 800, kind: "door", hinge: "end", side: "out" } };
    if (reverse) [wall.a, wall.b] = [wall.b, wall.a];
    const before = openingWorld(wall);
    normalizeConnectedWallEndpoints([wall, host], [exterior]);
    assert.deepEqual(new Set([wall.a.join(","), wall.b.join(",")]), new Set([p(2000, 0).join(","), p(2000, 4120).join(",")]));
    assert.deepEqual(openingWorld(wall), before);
    const once = structuredClone([wall, host]);
    normalizeConnectedWallEndpoints([wall, host], [exterior]);
    assert.deepEqual([wall, host], once);
  }
});

test("不吸跨真实间隙、虚拟墙及共线分段；门洞会被裁切时保留端点", () => {
  const host: Wall = { a: [0, 0], b: [4000, 0], role: "bearing" };
  const gap: Wall = { a: [2000, 122], b: [2000, 1500] };
  const virtual: Wall = { a: [3000, 120], b: [3000, 1500], role: "virtual" };
  const continuation: Wall = { a: [4000, 0], b: [5000, 0] };
  const tightDoor: Wall = { a: [1000, -120], b: [1000, 1200], door: { offset: 0, width: 900 } };
  const walls = [host, gap, virtual, continuation, tightDoor], before = structuredClone(walls);
  normalizeConnectedWallEndpoints(walls, []);
  assert.deepEqual(walls, before);
});

test("拖动端点吸附外墙外皮，实体内墙仍吸中线，虚拟墙不扩厚", () => {
  const facade: WallContactTarget = { a: [4000, 0], b: [4000, 5000], role: "bearing", exterior: true };
  for (const role of ["bearing", "virtual"] as const) {
    const wall: Wall = { a: [1000, 2000], b: [3960, 2000], role };
    snapWallDuringDrag(wall, "b", [facade], { xs: [], zs: [] });
    assert.equal(wall.b[0], role === "virtual" ? 4000 : 4000 + construction.outsideWall / 2);
  }
  const wall: Wall = { a: [1000, 2000], b: [3960, 2000], role: "bearing" };
  snapWallDuringDrag(wall, "b", [{ ...facade, exterior: false }], { xs: [], zs: [] });
  assert.equal(wall.b[0], 4000);
  const moved: Wall = { a: [1000, 2000], b: [3000, 2000], role: "bearing" };
  assert.equal(alignWallToNearestSide(moved, "right", [facade]).ok, true);
  assert.equal(moved.b[0], 4000 + construction.outsideWall / 2);
});

test("截图对应户型载入编辑器后墙长4000，房间与门窗保留；所有版本重复接管稳定", () => {
  const directory = new URL("../data/户型/", import.meta.url);
  for (const file of readdirSync(directory).filter(file => file !== "index.json" && file.endsWith(".json"))) {
    const original = parseLayoutVersionDocument(JSON.parse(readFileSync(new URL(file, directory), "utf8"))).layoutDraft;
    const draft = normalizeDraftWallContacts(structuredClone(original));
    const once = structuredClone(draft);
    normalizeDraftWallContacts(draft);
    assert.deepEqual(draft, once, file);
    for (let floor = 0; floor < 4; floor++) {
      const a = floor === 3 ? original.annexPartitions : original.floors[floor]!.partitions;
      const b = floor === 3 ? draft.annexPartitions : draft.floors[floor]!.partitions;
      for (let i = 0; i < a.length; i++) {
        const start = openingWorld(a[i]!), end = openingWorld(b[i]!);
        if (start && end) {
          assert.ok(Math.abs(Number(start[0]) - Number(end[0])) < 0.001, `${file}/${floor}/${i} 门窗X`);
          assert.ok(Math.abs(Number(start[1]) - Number(end[1])) < 0.001, `${file}/${floor}/${i} 门窗Z`);
          assert.deepEqual(end.slice(2), start.slice(2));
        }
      }
      const rooms = floor === 3 ? original.annexRooms : original.floors[floor]!.rooms;
      const changedRooms = floor === 3 ? draft.annexRooms : draft.floors[floor]!.rooms;
      assert.deepEqual(changedRooms, rooms, `${file}/${floor} 房间定义`);
      const body = floor === 3 ? site.annex : { ...site.main, z: original.floors[floor]!.front,
        d: site.main.z + site.main.d - original.floors[floor]!.front };
      const regions = (walls: Wall[]) => enclosedRoomRegions(body, walls).map(r =>
        [r.x, r.z, r.w, r.d, r.boundaryKey, r.openSide]);
      assert.deepEqual(regions(b), regions(a), `${file}/${floor} 自动成房边界`);
      for (let i = 0; i < rooms.length; i++) {
        const oldArea = roomAreas(rooms[i]!, floor === 3 ? 0 : floor, a);
        const newArea = roomAreas(changedRooms[i]!, floor === 3 ? 0 : floor, b);
        assert.ok(Math.abs(oldArea.interior - newArea.interior) < 0.0001, `${file}/${floor}/${rooms[i]!.name} 净空`);
      }
    }
    if (file === "户型-20261023-210731.json") {
      const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} }, structuredClone(original));
      const wall = editor.draft.floors[0]!.partitions.find(w => w.id === "wall-5")!;
      assert.deepEqual(wall.a, [11500, site.main.z + site.main.d]);
      assert.deepEqual(wall.b, [11500, 5600]);
      assert.equal(Math.hypot(wall.a[0] - wall.b[0], wall.a[1] - wall.b[1]), 4000);
    }
  }
});
