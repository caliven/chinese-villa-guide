import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { fitCanvasView, zoomCanvasView, measuredPoint } from "../src/plan-canvas.ts";
import { buildEditorModel, disposeEditorModel, editorFloorGeometry, editorModelBounds } from "../src/editor-model.ts";
import { clonePublishedLayout, removeStairFromDraft } from "../src/layout-draft.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import { roomAreaLabels, roomAreas } from "../src/design-data.ts";
import { site, type Point } from "../src/data.ts";
import type { Mats } from "../src/primitives.ts";
import { selectionBounds } from "../src/layout-scene.ts";

test("连续画布适应窗口保持毫米比例；鼠标锚点缩放不漂移且有限幅", () => {
  const bounds = { x: 1000, y: -2000, w: 20000, h: 15000 };
  const fit = fitCanvasView(bounds, 1000, 500);
  assert.deepEqual(fit, { x: -4000, y: -2000, w: 30000, h: 15000 });
  const anchor = { x: 4000, y: 3000 }, zoom = zoomCanvasView(fit, .5, anchor);
  assert.equal((anchor.x - fit.x) / fit.w, (anchor.x - zoom.x) / zoom.w);
  assert.equal((anchor.y - fit.y) / fit.h, (anchor.y - zoom.y) / zoom.h);
  assert.equal(zoomCanvasView(fit, .0001, anchor).w, 2000);
  assert.equal(zoomCanvasView(fit, 1000, anchor).w, 150000);
  assert.deepEqual(bounds, { x: 1000, y: -2000, w: 20000, h: 15000 });
});

test("临时测距为整数毫米，Shift 沿主方向锁定且不改起止输入", () => {
  const start = { x: 100, y: 200 }, end = { x: 4200.7, y: 890.2 };
  assert.deepEqual(measuredPoint(start, end, false), { x: 4201, y: 890 });
  assert.deepEqual(measuredPoint(start, end, true), { x: 4201, y: 200 });
  assert.deepEqual(measuredPoint(start, { x: 150, y: 2000.6 }, true), { x: 100, y: 2001 });
  assert.deepEqual(end, { x: 4200.7, y: 890.2 });
});

test("新版主辅楼共用一个真实坐标画布，标签沿用净空算法，原始图纸仍可独立输出", () => {
  const draft = clonePublishedLayout(), before = structuredClone(draft);
  const source = planSourceFromDraft(draft, 0);
  const svg = floorPlan(0, false, false, { editorCanvas: true, editable: true }, source);
  assert.equal((svg.match(/<svg\b/g) ?? []).length, 1);
  assert.equal((svg.match(/class="plan-world"/g) ?? []).length, 1);
  assert.match(svg, /class="editor-building" data-plan-building="main"/);
  assert.match(svg, /class="editor-building" data-plan-building="annex"/);
  assert.doesNotMatch(svg, /plan-sheet|plan-shared-dimensions/);
  assert.match(svg, /南向上，西向右/);
  const room = source.floor.rooms.find(room => room.kind !== "void")!;
  for (const label of roomAreaLabels(room, 0, source.floor.partitions)) assert.ok(svg.includes(label));
  assert.ok(svg.includes(roomAreas(room, 0, source.floor.partitions).interior.toFixed(2)));
  assert.match(svg, /data-label-x=/);
  const upper = floorPlan(1, false, false, { editorCanvas: true }, planSourceFromDraft(draft, 1));
  assert.doesNotMatch(upper, /class="editor-building" data-plan-building="annex"/);
  const drawing = floorPlan(0, false, false, {}, source);
  assert.equal((drawing.match(/<svg\b/g) ?? []).length, 2);
  assert.match(drawing, /plan-shared-dimensions/);
  assert.deepEqual(draft, before);
});

function topArea(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute("position");
  let area = 0;
  for (let i = 0; i < p.count; i += 3) area += Math.abs((p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) - (p.getX(i + 2) - p.getX(i)) * (p.getZ(i + 1) - p.getZ(i))) / 2;
  return area;
}

test("三维楼板按凹形净轮廓铺面并扣除边界洞，内环不重复填色", () => {
  const concave: Point[] = [[0, 0], [6000, 0], [6000, 2000], [2000, 2000], [2000, 6000], [0, 6000]];
  const hole: Point[] = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
  const geometry = editorFloorGeometry([concave], [hole], 3600, 160);
  assert.equal(topArea(geometry), 19000000);
  geometry.computeBoundingBox();
  assert.equal(geometry.boundingBox!.min.y, 3440);
  assert.equal(geometry.boundingBox!.max.y, 3600);
  const ring = editorFloorGeometry([[[0, 0], [4000, 0], [4000, 4000], [0, 4000]], [[1000, 1000], [2000, 1000], [2000, 2000], [1000, 2000]]], [], 0);
  assert.equal(topArea(ring), 15000000);
  geometry.dispose(); ring.dispose();
});

// 几何验证不创建 WebGL；标签只需要画布替身。
const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
const materials = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });

test("三维剖切/全高墙保留真实墙索引与家具身份，构建不改动草稿和共享尺寸", () => {
  const draft = clonePublishedLayout();
  draft.floors[0].partitions = [
    { a: [8000, 3000], b: [12000, 3000], role: "virtual" },
    { a: [8000, 4000], b: [12000, 4000], role: "partition", door: { offset: 1000, width: 900, hinge: "start", side: "in" } },
  ];
  const before = structuredClone(draft), dimensions = structuredClone(site);
  const mat = materials(), cut = buildEditorModel(draft, mat, 1200), full = buildEditorModel(draft, mat, "full");
  const walls: THREE.Object3D[] = [], fullWalls: THREE.Object3D[] = [];
  cut.levels[0].traverse(object => { if (object.userData.layoutSelection?.kind === "wall") walls.push(object); });
  full.levels[0].traverse(object => { if (object.userData.layoutSelection?.kind === "wall") fullWalls.push(object); });
  assert.deepEqual(walls.map(wall => wall.userData.layoutSelection.index), [1]);
  assert.equal(walls[0].userData.editorWallHeight, 1200);
  assert.equal(fullWalls[0].userData.editorWallHeight, draft.floors[0].height - site.entranceRise - 150);
  const furniture: THREE.Object3D[] = [];
  cut.annex.traverse(object => { if (object.userData.layoutSelection?.kind === "furniture") furniture.push(object); });
  assert.equal(furniture.length, draft.annexFurniture.length);
  assert.ok(furniture.every((object, index) => object.userData.layoutSelection.index === index && object.userData.layoutSelection.annex));
  assert.deepEqual(draft, before);
  assert.deepEqual(site, dimensions);
  const scene = new THREE.Scene(); scene.add(cut.root, full.root);
  disposeEditorModel(cut.root, scene); disposeEditorModel(full.root, scene);
});

test("单层剖看补上从下层通来的梯段，完整和分离模型不重复生成楼梯", () => {
  const draft = clonePublishedLayout(), before = structuredClone(draft);
  const stairObjects = (root: THREE.Object3D) => {
    const result: THREE.Object3D[] = [];
    root.traverse(object => { if (object.userData.layoutSelection?.kind === "stair") result.push(object); });
    return result;
  };
  for (const cut of [1200, "full"] as const) for (const floor of [0, 1, 2]) {
    const model = buildEditorModel(draft, materials(), cut, { floors: [floor] });
    const objects = stairObjects(model.root);
    assert.equal(objects.length, floor === 1 ? 2 : 1, `${floor + 1}层 ${cut} 必须有实际梯段`);
    const expectedBounds = new THREE.Box3();
    objects.forEach(object => expectedBounds.union(new THREE.Box3().setFromObject(object)));
    assert.ok(selectionBounds(model.root, { kind: "stair" })?.equals(expectedBounds), "定位应包含上下梯段，不能只取最后一个梯段");
    const incoming = objects.filter(object => object.userData.incomingStair);
    assert.equal(incoming.length, floor > 0 ? 1 : 0);
    if (floor > 0) {
      const bounds = new THREE.Box3().setFromObject(incoming[0]);
      const previousBase = draft.floors[floor - 1].y + (floor === 1 ? site.entranceRise : 0);
      assert.ok(bounds.min.y >= previousBase - 1 && bounds.min.y < previousBase + 1000);
      assert.ok(bounds.max.y > draft.floors[floor].y, "返跑与扶手应通到当前楼层");
    }
    disposeEditorModel(model.root, new THREE.Scene());
  }
  for (const overview of [false, true]) {
    const model = buildEditorModel(draft, materials(), 1200, { overview });
    const objects = stairObjects(model.root);
    assert.equal(objects.length, draft.floors.length - 1);
    assert.ok(objects.every(object => !object.userData.incomingStair), "已构造下层时不叠加来梯副本");
    disposeEditorModel(model.root, new THREE.Scene());
  }
  assert.deepEqual(draft, before);
  removeStairFromDraft(draft);
  const withoutStairs = buildEditorModel(draft, materials(), 1200, { floors: [2] });
  assert.equal(stairObjects(withoutStairs.root).length, 0, "删除楼梯后不能留下来梯");
  disposeEditorModel(withoutStairs.root, new THREE.Scene());
});

test("更新编辑模型时只释放旧资源，不销毁场地模型仍使用的共用材质和纹理", () => {
  const shared = new THREE.MeshStandardMaterial(), texture = new THREE.Texture(); shared.map = texture;
  const own = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxGeometry();
  const root = new THREE.Group(), scene = new THREE.Scene();
  root.add(new THREE.Mesh(geometry, shared), new THREE.Mesh(geometry, own));
  scene.add(root, new THREE.Mesh(new THREE.BoxGeometry(), shared));
  let sharedDisposed = 0, textureDisposed = 0, ownDisposed = 0, geometryDisposed = 0;
  shared.addEventListener("dispose", () => sharedDisposed++); texture.addEventListener("dispose", () => textureDisposed++);
  own.addEventListener("dispose", () => ownDisposed++); geometry.addEventListener("dispose", () => geometryDisposed++);
  disposeEditorModel(root, scene);
  assert.deepEqual([sharedDisposed, textureDisposed, ownDisposed, geometryDisposed], [0, 0, 1, 1]);
});

test("编辑模型双开门按净口分扇，推拉门双轨贴墙，门套及五金不改变草稿开向", () => {
  const draft = clonePublishedLayout();
  draft.floors[0].partitions = [
    { a: [8000, 1000], b: [14000, 1000], door: { offset: 1000, width: 1800, kind: "doubleDoor", hinge: "start", side: "in" } },
    { a: [8000, 3000], b: [14000, 3000], door: { offset: 1000, width: 1800, kind: "slidingDoor", hinge: "start", side: "in" } },
    { a: [8000, 5000], b: [14000, 5000], door: { offset: 1000, width: 900, kind: "door", hinge: "end", side: "out" } },
  ];
  const model = buildEditorModel(draft, materials(), 1200, { floors: [0] });
  const doors = new Map<number, THREE.Box3>();
  model.root.updateMatrixWorld(true);
  model.levels[0].traverse(object => {
    const selection = object.userData.layoutSelection;
    if (selection?.kind === "door" && !selection.exterior) doors.set(selection.index, new THREE.Box3().setFromObject(object));
  });
  const double = doors.get(0)!, sliding = doors.get(1)!, outward = doors.get(2)!;
  assert.ok(double.getSize(new THREE.Vector3()).z > 850 && double.getSize(new THREE.Vector3()).z < 1100, "双门扇扣除门框，单扇不能按整洞宽度伸出");
  assert.ok(sliding.getSize(new THREE.Vector3()).z <= 200, "双轨及弯管拉手限制在墙两侧附近，不伸成平开门");
  assert.ok(double.max.z <= 1120 && double.min.z < 200, "in仍向局部负Z开启；墙另一面只允许门套厚度");
  assert.ok(outward.min.z >= 4880 && outward.max.z > 5800, "out仍向局部正Z开启，不能因加门套反向");
  assert.equal(model.levels[1].children.length, 0);
  disposeEditorModel(model.root, new THREE.Scene());
});

test("适应镜头按可见实体取景，屏幕标签大小和隐藏楼层不影响建筑包络", () => {
  const mmRoot = new THREE.Group(), root = new THREE.Group(); mmRoot.scale.setScalar(.001); mmRoot.add(root);
  const model = new THREE.Mesh(new THREE.BoxGeometry(2000, 1000, 3000)); model.position.set(1000, 500, 1500); root.add(model);
  const label = new THREE.Sprite(); label.scale.setScalar(50000); root.add(label);
  const hidden = new THREE.Group(); hidden.add(new THREE.Mesh(new THREE.BoxGeometry(50000, 50000, 50000))); hidden.visible = false; root.add(hidden);
  const bounds = editorModelBounds(root);
  assert.deepEqual(bounds.min.toArray(), [0, 0, 0]);
  assert.deepEqual(bounds.max.toArray(), [2, 1, 3]);
  label.scale.setScalar(500000);
  assert.ok(editorModelBounds(root).equals(bounds));
});
