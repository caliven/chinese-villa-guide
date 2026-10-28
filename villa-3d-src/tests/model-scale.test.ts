import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture.ts";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model.ts";
import { clonePublishedLayout, removeStairFromDraft } from "../src/layout-draft.ts";
import { site, construction, type Room, type Wall } from "../src/data.ts";
import { wallWithOpenings, stairs, stairSoffitClearHeight, type Mats } from "../src/primitives.ts";
import { roomFillGeometry } from "../src/design-data.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import { fitCanvasView, zoomCanvasView } from "../src/plan-canvas.ts";
import { openingSymbolSvg } from "../src/openings.ts";
import { stairShape, stairModelDefaults, fitStairToRoom } from "../src/stair-geometry.ts";
import { DEFAULT_VILLA_PARAMS, applyVillaParams, resetVillaParams } from "../src/villa-params.ts";

const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
const materials = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });
const close = (actual: number, expected: number, message = "") => assert.ok(Math.abs(actual - expected) < .05, `${message}: ${actual} != ${expected}`);
const bounds = (objects: THREE.Object3D[]) => objects.reduce((box, object) => { object.updateWorldMatrix(true, true); return box.union(new THREE.Box3().setFromObject(object, true)); }, new THREE.Box3());
function sameBounds(a: THREE.Box3, b: THREE.Box3, label: string) {
  assert.ok(!a.isEmpty() && !b.isEmpty(), `${label} 缺少实体`);
  for (const axis of ["x", "y", "z"] as const) { close(a.min[axis], b.min[axis], `${label} min.${axis}`); close(a.max[axis], b.max[axis], `${label} max.${axis}`); }
}

function fixture() {
  const draft = clonePublishedLayout(); removeStairFromDraft(draft);
  const parts = (x: number, z: number, length: number): Wall[] => (["door", "doubleDoor", "slidingDoor", "window"] as const).map((kind, index) => ({
    a: [x, z + index * 1500], b: [x + length, z + index * 1500], role: index % 2 ? "bearing" : "partition",
    door: { kind, offset: 500, width: kind === "door" ? 900 : 1400, hinge: "end", side: "in" },
  }));
  draft.floors.forEach(floor => { floor.partitions = parts(site.main.x + 1000, site.main.z + 2500, 5000); floor.furniture = []; });
  draft.annexPartitions = parts(site.annex.x + 400, site.annex.z + 1500, 3000); draft.annexFurniture = [];
  return draft;
}

test("主辅楼、三层内墙和四种门窗在户型三维与房屋模型中使用相同实体尺寸和完成面标高", () => {
  for (const changed of [false, true]) {
    try {
      if (changed) applyVillaParams({ ...DEFAULT_VILLA_PARAMS, outsideWall: 300, partition: 160, floor1Height: 3900, floor2Height: 3800, floor3Height: 3500 });
      const draft = fixture(), before = structuredClone(draft), mat = materials();
      const editor = buildEditorModel(draft, mat, "full"), villa = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft));
      for (let floor = 0; floor < 4; floor++) {
        const house = floor === 3 ? villa.annex : villa.levels[floor], edit = floor === 3 ? editor.annex : editor.levels[floor];
        const parts = floor === 3 ? draft.annexPartitions : draft.floors[floor].partitions;
        const houseWalls: THREE.Object3D[] = [], editWalls: THREE.Object3D[] = [];
        house.traverse(o => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.ExtrudeGeometry && o.material === mat.inside) houseWalls.push(o.parent!); });
        edit.traverse(o => { if (o.userData.layoutSelection?.kind === "wall") editWalls.push(o); });
        assert.equal(houseWalls.length, parts.length); assert.equal(editWalls.length, parts.length);
        parts.forEach((part, index) => {
          const actual = houseWalls[index], expected = editWalls[index];
          sameBounds(bounds(actual.children.slice(1)), bounds(expected.children.filter(o => o.userData.layoutSelection?.kind === "door")), `${floor}/${part.door!.kind}`);
          const wall = new THREE.Box3().setFromObject(actual.children[0], true), size = wall.getSize(new THREE.Vector3());
          close(size.z, part.role === "bearing" ? construction.outsideWall : construction.partition, "墙厚");
          sameBounds(wall, bounds(expected.children.filter(o => o instanceof THREE.Mesh && Array.isArray(o.material))), "墙体");
          const finish = floor === 3 || floor === 0 ? site.entranceRise : draft.floors[floor].y;
          const opening = bounds(actual.children.slice(1));
          close(opening.min.y, finish + (part.door!.kind === "window" ? 900 : 0), "门窗底标高");
          if (part.door!.kind === "window") close(opening.max.y - opening.min.y, 1500, "窗高");
          else {
            const models: THREE.Object3D[] = []; actual.traverse(o => { if (o.userData.doorDimensions) models.push(o); });
            assert.equal(models.length, 1);
            assert.equal(models[0].userData.doorDimensions.height, 2200, "洞口高度不含贴墙门套");
            assert.equal(models[0].userData.doorDimensions.width, part.door!.width);
            assert.ok(opening.max.y <= finish + 2250, "门套只在原洞口上沿外包，不把洞高扩大");
          }
        });
      }
      assert.deepEqual(draft, before, "重建不能改写已保存草稿");
      disposeEditorModel(editor.root, new THREE.Scene());
    } finally { resetVillaParams(); }
  }
});

test("普通外窗的外框、玻璃和墙厚严格使用洞口毫米规格，米制根节点不重复换算", () => {
  const mat = materials();
  for (const width of [600, 1500, 3000]) for (const axis of ["x", "z"] as const) {
    const parent = new THREE.Group(), opening = { at: 2500, w: width, sill: 900, h: 1500 };
    const wall = wallWithOpenings(parent, [0, 0], axis === "x" ? [5000, 0] : [0, 5000], 450, 3150, [opening], mat, 300);
    const meshes: THREE.Mesh[] = []; wall.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
    const frame = meshes.filter(o => o.material === mat.dark), glass = meshes.filter(o => o.material === mat.glass);
    const frameBounds = bounds(frame), glassBounds = bounds(glass);
    close(frameBounds.getSize(new THREE.Vector3())[axis], width, "窗框宽");
    close(frameBounds.min.y, 1350); close(frameBounds.max.y, 2850);
    close(glassBounds.getSize(new THREE.Vector3())[axis], width - 206, "开启扇两侧各留60外框、37扇框和两道3毫米接缝");
    close(glassBounds.getSize(new THREE.Vector3()).y, width === 3000 ? 1374 : 1294, "固定玻璃与开启扇各按实际框槽留位");
    const mmRoot = new THREE.Group(); mmRoot.scale.setScalar(.001); mmRoot.add(parent);
    close(bounds(frame).getSize(new THREE.Vector3())[axis], width / 1000);
    close(new THREE.Box3().setFromObject(wall.children[0], true).getSize(new THREE.Vector3())[axis === "x" ? "z" : "x"], .3);
  }
});

test("窗与推拉门平面符号按实际墙厚绘制，不能使用超过薄隔墙的固定厚度", () => {
  for (const thickness of [100, 120, 240, 300]) {
    const window = openingSymbolSvg({ offset: 500, width: 1500, kind: "window" }, thickness);
    const stroke = Math.min(40, thickness / 4);
    assert.ok(window.includes(`M${500 + stroke / 2} ${-thickness / 2 + stroke / 2}`));
    const sliding = openingSymbolSvg({ offset: 500, width: 1500, kind: "slidingDoor" }, thickness);
    assert.ok(sliding.includes(`height="${Math.min(60, thickness - 30)}"`));
  }
});

test("房间三维底色与平面使用同一份真实净空轮廓", () => {
  const draft = fixture();
  const room: Room = { id: "scale-room", name: "比例房", kind: "hall", note: "", x: site.main.x + 1000, z: site.main.z + 500, w: 5000, d: 1500 };
  draft.floors[0].rooms = [room]; draft.floors[0].partitions = [];
  room.outline = [[room.x, room.z], [room.x + room.w, room.z], [room.x + room.w, room.z + room.d], [room.x, room.z + room.d]];
  const geometry = roomFillGeometry(room, 0, []), editor = buildEditorModel(draft, materials(), "full", { floors: [0] });
  let surface: THREE.Object3D | undefined;
  editor.root.traverse(o => { if (o.userData.layoutSelection?.kind === "room" && o.userData.layoutSelection.id === room.id) surface = o; });
  const expected = new THREE.Box3().setFromPoints(geometry.paths.flatMap(path => path.map(([x, z]) => new THREE.Vector3(x, site.entranceRise + 3, z))));
  sameBounds(new THREE.Box3().setFromObject(surface!, true), expected, "房间净空");
  assert.ok(floorPlan(0, false, false, { editorCanvas: true }, planSourceFromDraft(draft, 0)).includes(geometry.pathData));
  disposeEditorModel(editor.root, new THREE.Scene());
});

test("梯下墙高以本层完成面计算，二楼不能因绝对楼层标高被误压成900高", () => {
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, floor1Height: 3600 + site.entranceRise, floor2Height: 3600 });
    const draft = clonePublishedLayout(), mat = materials();
    const stair = fitStairToRoom(draft.stairLayout, draft.floors), shape = stairShape(stair);
    const platform = shape.model === "double" ? shape.landing : shape.rect(shape.platforms[0].cross, shape.platforms[0].along, stair.landing, stair.landing);
    const z = platform.z + platform.d / 2, a = platform.x + 50, b = platform.x + platform.w - 50;
    const indexes = draft.floors.map(floor => { floor.partitions.push({ a: [a, z], b: [b, z] }); floor.furniture = []; return floor.partitions.length - 1; });
    const expected = Math.max(900, stairSoffitClearHeight((a + b) / 2, z, stair, 3600)! - 30);
    assert.ok(expected > 900);
    const editor = buildEditorModel(draft, mat, "full"), villa = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft));
    for (const floor of [0, 1]) {
      const finish = floor === 0 ? site.entranceRise : draft.floors[floor].y;
      let houseWall: THREE.Object3D | undefined, editWall: THREE.Object3D | undefined;
      villa.levels[floor].traverse(o => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.ExtrudeGeometry && o.material === mat.inside && Math.abs(o.parent!.position.x - a) < 1 && Math.abs(o.parent!.position.z - z) < 1) houseWall = o; });
      editor.levels[floor].traverse(o => { if (o.userData.layoutSelection?.kind === "wall" && o.userData.layoutSelection.index === indexes[floor]) editWall = o; });
      const physical = bounds([houseWall!]);
      close(physical.min.y, finish); close(physical.max.y, finish + expected);
      sameBounds(physical, bounds(editWall!.children.filter(o => o instanceof THREE.Mesh && Array.isArray(o.material))), "梯下墙");
    }
    disposeEditorModel(editor.root, new THREE.Scene());
  } finally { resetVillaParams(); }
});

test("双跑和三跑楼梯各方向的实际踏步平台与平面包络同尺度，层高直接决定真实升高", () => {
  const draft = clonePublishedLayout(), mat = materials();
  for (const model of ["double", "triple"] as const) for (const axis of ["x", "z"] as const) for (const direction of ["positive", "negative"] as const) {
    const stair = { ...stairModelDefaults(draft.stairLayout, model, draft.floors), axis, direction }, shape = stairShape(stair);
    for (const height of [3150, 3900]) {
      const group = new THREE.Group(); stairs(group, stair.x, stair.z, 450, height, mat, axis, stair);
      const slabs = group.children.filter(o => o instanceof THREE.Mesh && o.geometry instanceof THREE.BoxGeometry);
      const actual = bounds(slabs), footprint = shape.footprint;
      close(actual.min.x, footprint.x); close(actual.min.z, footprint.z);
      close(actual.max.x, footprint.x + footprint.w); close(actual.max.z, footprint.z + footprint.d);
      close(actual.min.y, 450); close(actual.max.y, 450 + height - (shape.model === "double" ? height / shape.risers : 0));
    }
  }
});

test("PC画布缩放和窗口比例变化对墙门窗家具楼梯及房间共用同一个毫米到像素倍率", () => {
  const sizes = [120, 240, 900, 1500, 3000, 5000], original = { x: -2000, y: -3000, w: 25000, h: 18000 };
  for (const [width, height] of [[1280, 800], [1600, 1000], [1920, 1080]]) {
    let view = fitCanvasView(original, width, height);
    for (const factor of [.5, 1.5, .8]) {
      view = zoomCanvasView(view, factor, { x: 5000, y: 3000 });
      close(width / view.w, height / view.h, "横纵比例");
      for (const size of sizes) close((size * width / view.w) / (5000 * width / view.w), size / 5000, "相对房间尺寸");
    }
  }
});
