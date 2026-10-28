import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { readFileSync, readdirSync } from "node:fs";
import { floorplanCategories, floorplanFurniture } from "../src/floorplan-catalog.ts";
import { createFurniture, furniturePickerOrder, resizeFurnitureFromCorner, furnitureLocalToWorld, LEGACY_FURNITURE_KINDS, isRoundFurniture } from "../src/furniture-catalog.ts";
import { floorplanFurnitureModel, floorplanFurnitureSymbol } from "../src/floorplan-furniture.ts";
import { clonePublishedLayout, draftToJson, parseLayoutDraft } from "../src/layout-draft.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import type { Furniture } from "../src/data.ts";
import { parseLayoutVersionDocument } from "../src/data-versions.ts";
import { furnish, type Mats } from "../src/primitives.ts";

function disposeFurniture(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

function assertFootprint(group: THREE.Object3D, f: Pick<Furniture, "kind" | "w" | "d">) {
  const bounds = new THREE.Box3().setFromObject(group, true);
  for (const [axis, size] of [["x", f.w], ["z", f.d]] as const) {
    assert.ok(Math.abs(bounds.min[axis] + size / 2) < .01, `${f.kind}: ${axis} 最小边 ${bounds.min[axis]}，应为 ${-size / 2}`);
    assert.ok(Math.abs(bounds.max[axis] - size / 2) < .01, `${f.kind}: ${axis} 最大边 ${bounds.max[axis]}，应为 ${size / 2}`);
  }
}

test("家具库完整保留上游 60 款、6 分类、独立规格与配色", () => {
  assert.equal(floorplanFurniture.length, 60);
  assert.equal(new Set(furniturePickerOrder).size, 60);
  assert.deepEqual(furniturePickerOrder, floorplanFurniture.map(item => item.id));
  assert.deepEqual(floorplanCategories.map(cat => floorplanFurniture.filter(item => item.category === cat).length), [12, 14, 11, 8, 9, 6]);
  const beds = floorplanFurniture.filter(item => item.type === "bed");
  assert.deepEqual(beds.map(item => [item.w, item.d, item.color]), [[1800, 2000, "#c9d6df"], [1500, 2000, "#d8c7dc"], [1200, 2000, "#e8d5b5"]]);
});

test("全目录 JSON 往返保留型号、尺寸、名称和朝向，包括 80 厚电视", () => {
  const draft = clonePublishedLayout();
  const items = floorplanFurniture.map((item, i) => ({ ...createFurniture(item.id, 7000, 18000), rotation: i * Math.PI / 60 }));
  draft.floors[0]!.furniture = items;
  const loaded = parseLayoutDraft(draftToJson(draft));
  assert.deepEqual(loaded.floors[0]!.furniture, items);
  assert.equal(loaded.floors[0]!.furniture.find(item => item.kind === "fp-tv-65")?.d, 80);
});

test("上游符号全量可选中、坐标有效，朝向统一转换", () => {
  for (const entry of floorplanFurniture) {
    const svg = floorplanFurnitureSymbol(createFurniture(entry.id, 0, 0), ' data-edit="furniture" data-index="3"');
    assert.ok(svg, entry.id);
    assert.doesNotMatch(svg, /NaN|Infinity|undefined/, entry.id);
    assert.match(svg, /rotate\(180\)/, entry.id);
    assert.match(svg, /class="floorplan-furniture-shape" data-edit="furniture" data-index="3"/, entry.id);
  }
});

test("新旧淋浴房均只有进出侧一面玻璃，缩放后保持占地", () => {
  for (const kind of ["shower", "fp-shower"]) {
    const f = createFurniture(kind, 0, 0); f.w = 1200; f.d = 800;
    const glass = new THREE.MeshBasicMaterial();
    const group = floorplanFurnitureModel(f, glass)!;
    const panes: THREE.Mesh[] = [];
    group.traverse(object => { if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) panes.push(object); });
    assert.equal(panes.length, 1, kind);
    group.updateMatrixWorld(true);
    const pane = new THREE.Box3().setFromObject(panes[0]!, true);
    assert.ok(pane.getSize(new THREE.Vector3()).x > 1100);
    assert.ok(pane.getSize(new THREE.Vector3()).z < 30);
    assertFootprint(group, f);
    disposeFurniture(group);
  }
});

test("全目录立体几何有限、尺度为毫米，返回模型独立持有材质", () => {
  let previousMaterials = new Set<THREE.Material>();
  for (const entry of floorplanFurniture) {
    const group = floorplanFurnitureModel(createFurniture(entry.id, 0, 0))!;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    let meshes = 0;
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes++;
      geometries.add(object.geometry);
      const position = object.geometry.getAttribute("position");
      for (const value of position.array) assert.ok(Number.isFinite(value), `${entry.id}: nonfinite vertex`);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        assert.ok(!previousMaterials.has(material), `${entry.id}: material shared across disposed models`);
        materials.add(material);
      }
    });
    assert.ok(meshes > 1, `${entry.id}: missing source detail`);
    const bounds = new THREE.Box3().setFromObject(group, true);
    const size = bounds.getSize(new THREE.Vector3());
    assertFootprint(group, { ...entry, kind: entry.id });
    assert.ok(size.y > 0 && size.y < 3200, `${entry.id}: wrong height scale ${size.y}`);
    assert.ok(size.z > 0 && Number.isFinite(size.z), entry.id);
    assert.equal(group.children[0]!.scale.x, 1000);
    assert.equal(group.children[0]!.rotation.y, Math.PI);
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    previousMaterials = materials;
  }
});

test("全目录及旧类型在放大、缩小和独立改宽深后，实体占地与毫米规格一致", () => {
  const mat = new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshStandardMaterial() as never });
  for (const kind of [...furniturePickerOrder, ...LEGACY_FURNITURE_KINDS]) {
    for (const [sx, sz] of [[.5, .5], [1.5, 1.5], [.65, 1.4]]) {
      const f = createFurniture(kind, 0, 0);
      f.w = Math.round(f.w * sx); f.d = isRoundFurniture(kind) ? f.w : Math.round(f.d * sz);
      const before = structuredClone(f), parent = new THREE.Group();
      const group = furnish(parent, f, 0, mat);
      assertFootprint(group, f);
      assert.deepEqual(f, before, `${kind}: 构建不能叠乘源尺寸`);
      disposeFurniture(parent);
    }
  }
});

test("3000宽家具在5000宽房间占60%，mmRoot只做一次毫米到米的换算", () => {
  const f = { ...createFurniture("fp-sofa-three", 2500, 2500), w: 3000, d: 1000 };
  const model = floorplanFurnitureModel(f)!;
  model.position.set(f.x, 0, f.z);
  const mmRoot = new THREE.Group(); mmRoot.scale.setScalar(.001); mmRoot.add(model);
  const bounds = new THREE.Box3().setFromObject(mmRoot, true), size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x / 5 - .6) < 1e-8);
  assert.ok(Math.abs(size.z - 1) < 1e-8);
  assert.ok(Math.abs(bounds.min.x - 1) < 1e-8);
  assert.ok(Math.abs(bounds.max.x - 4) < 1e-8);
  disposeFurniture(mmRoot);
});

test("已有户型内全部主辅楼家具自动使用正确占地，保留自定义尺寸、位置和朝向", () => {
  const dir = new URL("../data/户型/", import.meta.url);
  const files = readdirSync(dir).filter(name => name !== "index.json" && name.endsWith(".json"));
  const mat = new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshStandardMaterial() as never });
  let count = 0;
  for (const file of files) {
    const document = parseLayoutVersionDocument(JSON.parse(readFileSync(new URL(file, dir), "utf8")));
    const before = structuredClone(document.layoutDraft);
    const draft = parseLayoutDraft(draftToJson(document.layoutDraft));
    for (const f of [...draft.floors.flatMap(floor => floor.furniture), ...draft.annexFurniture]) {
      for (let rebuild = 0; rebuild < 2; rebuild++) {
        const parent = new THREE.Group(), group = furnish(parent, f, 450, mat);
        assert.equal(group.position.x, f.x); assert.equal(group.position.z, f.z);
        assert.equal(group.position.y, 450); assert.equal(group.rotation.y, f.rotation ?? 0);
        group.position.set(0, 0, 0); group.rotation.y = 0;
        assertFootprint(group, f);
        disposeFurniture(parent);
      }
      count++;
    }
    assert.deepEqual(draft, before, `${file}: 载入／绘制不能改写用户的布局`);
  }
  assert.ok(files.length > 0);
  assert.ok(count > 0, `应覆盖全部已放置家具，本次 ${count} 件`);
});

test("拉角不把薄电视拉厚，圆桌始终保持直径一致", () => {
  const tv = createFurniture("fp-tv-65", 0, 0);
  const resized = resizeFurnitureFromCorner(tv, "se", tv.w / 2, tv.d / 2);
  assert.deepEqual(resized, { x: 0, z: 0, w: 1450, d: 80 });
  const table = createFurniture("fp-roundtable", 4000, 8000);
  table.rotation = Math.PI / 2;
  const corner = furnitureLocalToWorld(800, 650, table);
  const round = resizeFurnitureFromCorner(table, "se", corner.x, corner.z);
  assert.equal(round.w, round.d);
});

test("新旧床柜和厨卫家具均显示600毫米讨论留位，关闭图层后不残留", () => {
  const kinds: Furniture["kind"][] = [
    "bed", "wardrobe", "cabinet", "toilet", "squatToilet", "basin", "sink", "stove", "hob", "dressingTable",
    "fp-bed-double-1800", "fp-bed-double-1500", "fp-bed-single", "fp-wardrobe", "fp-wardrobe-small",
    "fp-sideboard", "fp-storage-cabinet", "fp-toilet", "fp-vanity", "fp-vanity-double", "fp-ksink", "fp-stove", "fp-dresser",
  ];
  const draft = clonePublishedLayout(); draft.annexFurniture = [];
  for (const kind of kinds) {
    const furniture = { ...createFurniture(kind, 10000, 3000), rotation: Math.PI / 2 };
    draft.floors[0].furniture = [furniture];
    const before = structuredClone(draft), source = planSourceFromDraft(draft, 0);
    for (const editorCanvas of [false, true]) {
      const svg = floorPlan(0, false, false, { useZones: true, editorCanvas }, source);
      assert.equal((svg.match(/class="use-zone"/g) ?? []).length, 1, `${kind} ${editorCanvas}`);
      assert.ok(svg.includes(`x="${-furniture.w / 2 - 600}"`));
      assert.ok(svg.includes(`width="${furniture.w + 1200}"`));
      assert.ok(svg.includes('translate(10000 3000) rotate(-90)'));
      assert.doesNotMatch(floorPlan(0, false, false, { useZones: false, editorCanvas }, source), /class="use-zone"/);
    }
    assert.deepEqual(draft, before);
  }
  for (const kind of ["fp-rug", "fp-tv-65", "fp-plant"] as const) {
    draft.floors[0].furniture = [createFurniture(kind, 10000, 3000)];
    assert.doesNotMatch(floorPlan(0, false, false, { useZones: true, editorCanvas: true }, planSourceFromDraft(draft, 0)), /class="use-zone"/);
  }
});

test("淋浴房玻璃门可单独选对面或两侧，二维三维和尺寸同步", () => {
  for (const kind of ["shower", "fp-shower"] as const) for (const side of ["front", "left", "right"] as const) {
    const f = { ...createFurniture(kind, 0, 0), w: 1200, d: 800, showerDoorSide: side };
    const svg = floorplanFurnitureSymbol(f)!;
    const expectedLine = side === "front" ? /<line[^>]*x1="-450" y1="450" x2="450" y2="450"/ : side === "left" ? /<line[^>]*x1="450" y1="-450" x2="450" y2="450"/ : /<line[^>]*x1="-450" y1="-450" x2="-450" y2="450"/;
    assert.match(svg, expectedLine);
    const group = floorplanFurnitureModel(f, new THREE.MeshBasicMaterial())!;
    group.updateMatrixWorld(true);
    const panes: THREE.Mesh[] = [];
    group.traverse(o => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial) panes.push(o); });
    assert.equal(panes.length, 1);
    const pane = new THREE.Box3().setFromObject(panes[0]);
    const center = pane.getCenter(new THREE.Vector3()), size = pane.getSize(new THREE.Vector3());
    if (side === "front") { assert.ok(center.z < -380); assert.ok(size.x > 1100); }
    else { assert.ok(side === "left" ? center.x < -580 : center.x > 580); assert.ok(size.z > 750); }
    assertFootprint(group, f);
    disposeFurniture(group);
  }
});
