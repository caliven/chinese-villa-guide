import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import * as THREE from "three";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture";
import { clonePublishedLayout, removeStairFromDraft } from "../src/layout-draft";
import { parseLayoutVersionDocument } from "../src/data-versions";
import { construction, site, isPhysicalWall, wallRoleOf, type Point, type Wall } from "../src/data";
import { physicalWallJoinExtensions } from "../src/room-geometry";
import { joinedWallSpan, wallJunctionPeers } from "../src/partition-geometry";
import type { Mats } from "../src/primitives";

const context = new Proxy({}, { get: () => () => {} });
globalThis.document = { createElement: () => ({ getContext: () => context }) } as unknown as Document;
const materials = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });
const hit = (objects: THREE.Object3D[], x: number, y: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0)).intersectObjects(objects, true);
function editWalls(group: THREE.Object3D) {
  const result: THREE.Object3D[] = [];
  group.traverse(object => { if (object.userData.layoutSelection?.kind === "wall") result.push(object); });
  return result;
}
function houseWalls(group: THREE.Object3D, mat: Mats) {
  const result: THREE.Object3D[] = [];
  group.traverse(object => { if (object instanceof THREE.Mesh && object.material === mat.inside) result.push(object); });
  return result;
}
function fixture(sx = 1, sz = 1, reverse = false) {
  const draft = clonePublishedLayout(); removeStairFromDraft(draft);
  const parts = (x: number, z: number): Wall[] => {
    const point = (a: number, b: number): Point => [x + sx * a, z + sz * b];
    const walls: Wall[] = [{ a: point(0, 0), b: point(1800, 0), role: "bearing", door: { offset: 400, width: 800, kind: "passage" } },
      { a: point(1800, 0), b: point(1800, 1800), role: "partition" }];
    return walls.map(part => reverse ? { ...part, a: part.b, b: part.a,
      door: part.door ? { ...part.door, offset: 1800 - part.door.offset - part.door.width } : undefined } : part);
  };
  draft.floors.forEach(floor => { floor.rooms = []; floor.furniture = []; floor.partitions = parts(site.main.x + 3000, site.main.z + 5000); });
  draft.annexRooms = []; draft.annexFurniture = [];
  draft.annexPartitions = parts(site.annex.x + 2000, site.annex.z + 4000);
  return draft;
}

test("主辅楼三层的八种L角方向：剖切、全高与完整房屋均补齐外角，门洞位置不漂移", () => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const reverse of [false, true]) {
    const draft = fixture(sx, sz, reverse), before = structuredClone(draft), mat = materials();
    const house = buildVilla(mat, false, site.roofFenShui, "floating", villaLayoutFromDraft(draft));
    for (const cut of [1200, "full"] as const) {
      const editor = buildEditorModel(draft, mat, cut); editor.root.updateMatrixWorld(true); house.group.updateMatrixWorld(true);
      for (const floor of [0, 1, 2, 3]) {
        const annex = floor === 3, index = annex ? 0 : floor;
        const x = annex ? site.annex.x + 2000 : site.main.x + 3000, z = annex ? site.annex.z + 4000 : site.main.z + 5000;
        const base = index === 0 ? site.entranceRise : draft.floors[index].y;
        for (const objects of [editWalls(annex ? editor.annex : editor.levels[index]), houseWalls(annex ? house.annex : house.levels[index], mat)]) {
          const corner = hit(objects, x + sx * (1800 + construction.partition / 4), base + 5000, z - sz * construction.outsideWall / 4);
          assert.ok(corner.length, `${floor}/${sx}/${sz}/${reverse}/${cut} 外角缺口`);
          const ray = new THREE.Raycaster(new THREE.Vector3(x + sx * 800, base + 600, z - 1000), new THREE.Vector3(0, 0, 1));
          assert.equal(ray.intersectObjects(objects, true).length, 0, "补角不能移动或填住原门洞");
        }
      }
      disposeEditorModel(editor.root, new THREE.Scene());
    }
    assert.deepEqual(draft, before);
  }
});

test("T形、共线和自由端沿用真实墙皮接触；虚拟分界与2毫米真空隙不补墙", () => {
  const cross: Wall = { a: [0, 0], b: [4000, 0], role: "bearing" };
  const stem: Wall = { a: [2000, 0], b: [2000, 2000] };
  let peers = wallJunctionPeers([cross, stem], []);
  assert.deepEqual(joinedWallSpan(stem, peers).join, { start: construction.outsideWall / 2, end: 0 });
  assert.deepEqual(joinedWallSpan(cross, peers).join, { start: 0, end: 0 });
  const continuation: Wall = { a: [4000, 0], b: [6000, 0] };
  assert.deepEqual(joinedWallSpan(cross, wallJunctionPeers([cross, continuation], [])).join, { start: 0, end: 0 });
  const gap: Wall = { a: [2000, construction.outsideWall / 2 + 2], b: [2000, 2000] };
  assert.deepEqual(joinedWallSpan(gap, wallJunctionPeers([cross, gap], [])).join, { start: 0, end: 0 });
  peers = wallJunctionPeers([{ ...cross, role: "virtual" }, stem], []);
  assert.deepEqual(joinedWallSpan(stem, peers).join, { start: 0, end: 0 });
  assert.deepEqual(joinedWallSpan({ a: [0, 0], b: [0, 0] }, peers).join, { start: 0, end: 0 });
});

test("所有保存户型逐层检查原有L角外侧缺块，剖切、全高与完整房屋均覆盖二维墙带", () => {
  const directory = new URL("../data/户型/", import.meta.url);
  let checked = 0;
  for (const file of readdirSync(directory).filter(file => file !== "index.json" && file.endsWith(".json"))) {
    const draft = parseLayoutVersionDocument(JSON.parse(readFileSync(new URL(file, directory), "utf8"))).layoutDraft;
    const before = structuredClone(draft), mat = materials();
    const house = buildVilla(mat, false, site.roofFenShui, "floating", villaLayoutFromDraft(draft));
    house.group.updateMatrixWorld(true);
    for (const cut of [1200, "full"] as const) {
      const editor = buildEditorModel(draft, materials(), cut); editor.root.updateMatrixWorld(true);
      for (let floor = 0; floor < 4; floor++) {
        const annex = floor === 3, parts = (annex ? draft.annexPartitions : draft.floors[floor].partitions).filter(isPhysicalWall);
        const peers = wallJunctionPeers(parts, []), walls = editWalls(annex ? editor.annex : editor.levels[floor]);
        const base = floor === 0 || annex ? site.entranceRise : draft.floors[floor].y;
        for (const part of parts) {
          const length = Math.hypot(part.b[0] - part.a[0], part.b[1] - part.a[1]);
          if (!length) continue;
          const ux = (part.b[0] - part.a[0]) / length, uz = (part.b[1] - part.a[1]) / length;
          const join = physicalWallJoinExtensions(part, peers), half = (wallRoleOf(part) === "bearing" ? construction.outsideWall : construction.partition) / 2;
          for (const [at, extension, sign] of [[0, join.start, -1], [length, join.end, 1]]) {
            if (extension < 2) continue;
            for (const side of [-1, 1]) {
              const x = part.a[0] + ux * (at + sign * extension / 2) - uz * half * side / 2;
              const z = part.a[1] + uz * (at + sign * extension / 2) + ux * half * side / 2;
              const originallyCovered = peers.some(peer => {
                const dx = peer.b[0] - peer.a[0], dz = peer.b[1] - peer.a[1], len = Math.hypot(dx, dz);
                const along = ((x - peer.a[0]) * dx + (z - peer.a[1]) * dz) / len;
                return along >= 0 && along <= len && Math.abs((x - peer.a[0]) * -dz + (z - peer.a[1]) * dx) / len <= peer.thick / 2;
              });
              if (originallyCovered) continue;
              assert.ok(hit(walls, x, base + 5000, z).length, `${file}/${floor}/${cut} 未补齐 ${x},${z}`);
              assert.ok(hit(houseWalls(annex ? house.annex : house.levels[floor], mat), x, base + 5000, z).length,
                `${file}/${floor}/完整房屋 未补齐 ${x},${z}`);
              checked++;
            }
          }
        }
      }
      disposeEditorModel(editor.root, new THREE.Scene());
    }
    assert.deepEqual(draft, before);
  }
  assert.ok(checked >= 20, `应实际检查保存稿中的缺角，实际 ${checked}`);
  console.log(`已核对保存稿补角采样 ${checked} 处（剖切、全高及完整房屋）`);
});
