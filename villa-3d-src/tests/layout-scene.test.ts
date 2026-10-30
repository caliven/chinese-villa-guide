import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { editorLampSpecs, floorPoint, layoutRoomAt, layoutWallAt, selectionKey, selectionBounds } from "../src/layout-scene.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { batchStatic, visibleSurfaceMeshes } from "../src/render-geometry.ts";
import { site } from "../src/data.ts";
import { roomLabelPosition } from "../src/design-data.ts";

test("楼层分离限制夜景光源数量，单层逐房间灯光不变", () => {
  const draft = clonePublishedLayout(), before = structuredClone(draft);
  const overview = editorLampSpecs(draft, 0, true);
  const count = draft.floors.reduce((n, floor) => n + floor.rooms.filter(r => r.kind !== "void" && r.kind !== "stair").length, 0)
    + draft.annexRooms.filter(r => r.kind !== "void" && r.kind !== "stair").length;
  assert.ok(overview.length <= 7 && overview.length < count);
  for (let floor = 0; floor < 3; floor++) {
    const data = draft.floors[floor]!;
    const single = editorLampSpecs(draft, floor, false);
    const rooms = data.rooms.filter(r => r.kind !== "void" && r.kind !== "stair");
    for (const [i, room] of rooms.entries()) {
      const [x, z] = roomLabelPosition(room, floor, data.partitions);
      assert.deepEqual(single[i], { x, z, y: data.y + (floor === 0 ? site.entranceRise : 0) + Math.min(data.height - (floor === 0 ? site.entranceRise : 0) - 250, 2600), intensity: 16, distance: 7 });
    }
    assert.equal(single.length, rooms.length + (floor === 0 ? draft.annexRooms.filter(r => r.kind !== "void" && r.kind !== "stair").length : 0));
    assert.ok(overview.some(light => light.y === data.y * 2.25 + (floor === 0 ? site.entranceRise : 0) + Math.min(data.height - (floor === 0 ? site.entranceRise : 0) - 250, 2600)));
  }
  assert.deepEqual(draft, before);
});

test("三维射线按楼层标高换算毫米，平行地面的视线不生成落点", () => {
  const ray = new THREE.Ray(new THREE.Vector3(12.345, 10, 4.567), new THREE.Vector3(0, -1, 0));
  assert.deepEqual(floorPoint(ray, 3600), { x: 12345, z: 4567 });
  const sloped = new THREE.Ray(new THREE.Vector3(12, 10, 4), new THREE.Vector3(1, -1, 0).normalize());
  assert.deepEqual(floorPoint(sloped, 3600), { x: 18400, z: 4000 });
  assert.equal(floorPoint(new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(1, 0, 0)), 3600), null);
});

test("外门窗按全局洞口编号跨视图匹配，辅助楼标记不产生另一份选中对象", () => {
  const planar = { kind: "door" as const, floor: 0, index: 32, exterior: true };
  const scene = { ...planar, annex: true };
  assert.equal(selectionKey(planar), selectionKey(scene));
  assert.notEqual(selectionKey(planar), selectionKey({ ...scene, index: 33 }));
  assert.notEqual(selectionKey(planar), selectionKey({ ...scene, exterior: false }));
  assert.notEqual(selectionKey({ ...scene, exterior: false }), selectionKey({ ...planar, exterior: false }));
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} }, clonePublishedLayout());
  editor.selectObject(planar);
  editor.selectObject(scene, true);
  assert.equal(editor.selection, null, "跨视图 Shift 点选同一外门窗应取消选中，不能重复加入");

  const root = new THREE.Group(), window = new THREE.Mesh(new THREE.BoxGeometry(1500, 300, 55));
  window.userData.layoutSelection = scene; root.add(window);
  assert.ok(selectionBounds(root, planar)?.equals(new THREE.Box3().setFromObject(window)), "二维外窗选中应找到三维实际包络");
  root.visible = false;
  assert.equal(selectionBounds(root, planar), null, "隐藏楼层不参与选中包络");
  window.geometry.dispose(); (window.material as THREE.Material).dispose();
});

test("三维选房遵守凹形真实轮廓，辅楼只属于一层", () => {
  const draft = clonePublishedLayout();
  draft.floors[0].rooms = [{ id: "concave", name: "凹形房", kind: "hall", note: "", x: 0, z: 0, w: 4000, d: 4000,
    outline: [[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]] }];
  draft.annexRooms = [{ id: "annex", name: "辅楼", kind: "hall", note: "", x: -4000, z: 0, w: 3000, d: 3000 }];
  assert.equal(layoutRoomAt(draft, 0, { x: 1000, z: 3000 })?.kind, "room");
  assert.equal(layoutRoomAt(draft, 0, { x: 3000, z: 3000 }), null);
  assert.deepEqual(layoutRoomAt(draft, 0, { x: -2000, z: 1000 }), { kind: "room", floor: 0, id: "annex", annex: true });
  draft.floors[1].rooms = [];
  assert.equal(layoutRoomAt(draft, 1, { x: -2000, z: 1000 }), null);
});

test("三维墙面/门洞拾取保留含虚拟墙的原始索引", () => {
  const draft = clonePublishedLayout();
  draft.annexPartitions = [];
  draft.floors[0].partitions = [
    { a: [0, 0], b: [4000, 0], role: "virtual" },
    { a: [0, 2000], b: [4000, 2000], role: "partition", door: { offset: 1000, width: 900, hinge: "start", side: "in" } },
  ];
  assert.equal(layoutWallAt(draft, 0, { x: 2000, z: 0 }, 1000), null);
  assert.deepEqual(layoutWallAt(draft, 0, { x: 2500, z: 2090 }, 1200), { kind: "wall", floor: 0, index: 1, annex: false });
  assert.deepEqual(layoutWallAt(draft, 0, { x: 1500, z: 2090 }, 1200), { kind: "door", floor: 0, index: 1, annex: false });
});

test("同材质家具合批后仍能独立射线拾取和显隐，不并入建筑", () => {
  const root = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  const models = [0, 1].map(index => {
    const group = new THREE.Group();
    group.position.x = index * 3;
    group.userData.layoutSelection = { kind: "furniture", floor: 0, index, annex: index === 1 };
    for (const x of [-.3, .3]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(.5, 1, 1), material);
      mesh.position.x = x;
      group.add(mesh);
    }
    root.add(group);
    return group;
  });
  batchStatic(root);
  assert.equal(models[0].children.length, 1);
  assert.equal(models[1].children.length, 1);
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(3.3, 3, 0), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects(visibleSurfaceMeshes(root), false)[0];
  assert.equal(selectionKey(hit.object.parent!.userData.layoutSelection), "furniture:0:true:1:false");
  models[1].visible = false;
  assert.equal(ray.intersectObjects(visibleSurfaceMeshes(root), false).length, 0);
});

test("三维放置、属性修改和拖动共用一份草稿及撤销栈，点选/原地松手无历史", () => {
  const draft = clonePublishedLayout();
  draft.floors[0].furniture = [];
  const editor = new LayoutEditor({ getFloor: () => 0, redraw: () => {}, toast: () => {} }, draft);
  editor.placeAt(site.main.x + 3000, site.main.z + 3000, "furniture", "fp-tv-65");
  assert.equal(editor.tool, "select");
  const selection = { kind: "furniture" as const, floor: 0, index: 0 };
  editor.selectObject(selection);
  editor.updateSelectedNumber("w", 1600);
  const item = structuredClone(editor.draft.floors[0].furniture[0]);
  editor.moveFurnitureTo(selection, item.x + 300, item.z + 500, false);
  assert.equal(editor.draft.floors[0].furniture[0].d, 80);
  assert.equal(editor.draft.floors[0].furniture[0].x, item.x + 300);
  editor.moveFurnitureTo(selection, item.x + 300, item.z + 500, false);
  editor.selectObject(null);
  editor.selectObject(selection);
  editor.undo();
  assert.deepEqual(editor.draft.floors[0].furniture[0], item);
  editor.redo();
  assert.equal(editor.draft.floors[0].furniture[0].z, item.z + 500);
  editor.undo();
  editor.undo();
  assert.equal(editor.draft.floors[0].furniture[0].w, 1450);
  editor.undo();
  assert.equal(editor.draft.floors[0].furniture.length, 0);
});

test("三维在辅楼和二层放置不会串写其它楼层", () => {
  const draft = clonePublishedLayout();
  draft.annexFurniture = [];
  draft.floors.forEach(floor => floor.furniture = []);
  let floor = 0;
  const editor = new LayoutEditor({ getFloor: () => floor, redraw: () => {}, toast: () => {} }, draft);
  editor.placeAt(site.annex.x + 1500, site.annex.z + 1500, "furniture", "fp-bed-double-1800");
  assert.equal(editor.draft.annexFurniture.length, 1);
  assert.equal(editor.draft.floors[0].furniture.length, 0);
  floor = 1;
  editor.clearSelectionOnFloorChange();
  editor.placeAt(site.main.x + 3000, site.main.z + 3000, "furniture", "fp-tv-65");
  assert.deepEqual(editor.selection, { kind: "furniture", index: 0, floor: 1, annex: undefined });
  assert.equal(editor.draft.floors[1].furniture.length, 1);
  assert.equal(editor.draft.annexFurniture.length, 1);
  assert.equal(editor.draft.floors[2].furniture.length, 0);
});
