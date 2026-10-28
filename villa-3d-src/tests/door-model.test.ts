import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as THREE from "three";
import { doorModel, doorFinishMaterials, type DoorSpec } from "../src/door-model.ts";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture.ts";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model.ts";
import { parseLayoutVersionDocument } from "../src/data-versions.ts";
import { exteriorDoorModel, type Mats } from "../src/primitives.ts";
import { site } from "../src/data.ts";

const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
const materials = () => new Proxy(doorFinishMaterials() as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });
const named = (root: THREE.Object3D, name: string) => { const result: THREE.Object3D[] = []; root.traverse(o => { if (o.name === name) result.push(o); }); return result; };
const bounds = (root: THREE.Object3D) => { root.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(root, true); };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < .05, `${a} != ${b}`);

test("实木门的四种开向与双开仍沿用草稿，门套包住实际墙厚且门扇留安装缝", () => {
  const mat = materials();
  for (const thickness of [120, 200, 300]) for (const side of ["in", "out"] as const)
    for (const hinge of ["start", "end"] as const) for (const double of [false, true]) {
      const width = double ? 1800 : 900, spec: DoorSpec = { at: 1600, sill: 450, w: width, h: 2200, kind: double ? "doubleDoor" : "door", hinge, side };
      const model = doorModel(new THREE.Group(), spec, mat, { thickness });
      const leaves = named(model, "平开门扇"); assert.equal(leaves.length, double ? 2 : 1);
      assert.equal(named(model, "门扇三节铰链").length, leaves.length * 3);
      assert.equal(named(model, "门执手横柄").length, leaves.length * 2);
      for (const leaf of leaves) {
        const box = bounds(leaf), depth = box.getSize(new THREE.Vector3()).z;
        assert.ok(depth < width / leaves.length && depth > width / leaves.length - 120, "按门框内净口分扇");
        assert.ok(side === "in" ? box.max.z < 0 : box.min.z > 0, "铰链仍朝原平面符号一侧开启");
        assert.ok(leaf.userData.doorHinge === (double ? leaves.indexOf(leaf) ? "end" : "start" : hinge));
      }
      const trim = named(model, "双面门套线").map(bounds);
      close(Math.min(...trim.map(b => b.min.z)), -thickness / 2 - 16);
      close(Math.max(...trim.map(b => b.max.z)), thickness / 2 + 16);
      const opening = model.userData.doorDimensions;
      assert.equal(opening.width, width); assert.equal(opening.height, 2200);
    }
});

test("双轨玻璃门的两扇错层、框与玻璃相接，拉手避开另一扇且无贯穿中横杆", () => {
  const mat = materials();
  for (const width of [750, 1500, 2200, 3600]) for (const outward of [-1, 1]) {
    const model = doorModel(new THREE.Group(), { at: 0, sill: 0, w: width, h: 2400, kind: "slidingDoor" }, mat, { outward });
    const leaves = named(model, "错层推拉门扇"), glass = named(model, "推拉门独立玻璃");
    assert.equal(leaves.length, 2); assert.equal(glass.length, 2);
    assert.equal(named(model, "推拉门下轨").length, 2);
    const glassBounds = glass.map(bounds);
    close(Math.abs(glassBounds[0].getCenter(new THREE.Vector3()).z - glassBounds[1].getCenter(new THREE.Vector3()).z), 58);
    assert.ok(!glassBounds[0].intersectsBox(glassBounds[1]), "两片玻璃不能共面闪烁");
    for (let i = 0; i < leaves.length; i++) {
      const otherFrame = [...named(leaves[1 - i], "推拉门扇竖框"), ...named(leaves[1 - i], "推拉门独立玻璃")].map(bounds);
      for (const handle of named(leaves[i], "弯管门拉手")) assert.ok(otherFrame.every(b => !b.intersectsBox(bounds(handle))), "外凸拉手不能穿进邻扇");
      for (const frame of named(leaves[i], "推拉门扇竖框")) {
        const a = bounds(frame), b = glassBounds[i];
        assert.ok(Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) < .01, "玻璃不得压到门扇竖框正面");
      }
    }
    assert.equal(named(model, "门扇中横档").length, 0, "整片玻璃中间不加随意横档");
  }
});

test("剖切仅截原门套、门芯与五金，不能重排门扇或把上横档移到切口", () => {
  const mat = materials();
  for (const kind of ["door", "doubleDoor", "slidingDoor"] as const) for (const top of [700, 1000, 1200, 1800]) {
    const spec: DoorSpec = { at: 1500, sill: 450, w: kind === "door" ? 900 : 1800, h: 2200, kind, side: "in" };
    const full = doorModel(new THREE.Group(), spec, mat), cut = doorModel(new THREE.Group(), spec, mat, { top });
    assert.ok(bounds(cut).max.y <= top + .01);
    assert.equal(named(cut, "门框上梃").length, 0);
    assert.equal(named(cut, "门扇上横档").length, 0);
    assert.equal(named(cut, "推拉门扇上横框").length, 0);
    for (const object of named(cut, "门执手横柄")) {
      const box = bounds(object), reference = named(full, "门执手横柄").map(bounds).find(b => Math.abs(b.min.x - box.min.x) < .05 && Math.abs(b.min.z - box.min.z) < .05)!;
      assert.ok(reference); close(box.min.y, reference.min.y);
    }
    assert.deepEqual(cut.userData.doorDimensions, full.userData.doorDimensions);
  }
});

test("咖色大门有分离双扇、内凹门芯与双面长拉手，中心密封不留下贯通亮缝", () => {
  const mat = materials(), model = doorModel(new THREE.Group(), { at: 0, sill: 0, w: 3200, h: 2800, kind: "doubleDoor" }, mat, { style: "bronze", frame: false, open: false });
  assert.equal(named(model, "平开门扇").length, 2);
  assert.equal(named(model, "弯管门拉手").length, 4);
  assert.ok(named(model, "凹入门芯").length >= 4);
  model.updateMatrixWorld(true);
  for (const sign of [-1, 1]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1400, sign * 1000), new THREE.Vector3(0, 0, -sign));
    assert.ok(ray.intersectObject(model, true).length, "中缝应由背后的密封条封闭");
  }
  for (const width of [750, 1800]) {
    const solid = exteriorDoorModel(new THREE.Group(), { at: 0, sill: 0, w: width, h: 2400, door: true, glazed: true, kind: "door" }, mat, 1);
    assert.equal(named(solid, "平开门扇").length, 1, "主动选单开门时，旧模板的玻璃标记不能强制改为推拉");
    assert.equal(named(solid, "推拉门独立玻璃").length, 0);
  }
});

test("所有保存户型直接重建新门，主辅楼及完整房屋与户型三维尺寸一致且不改源稿", () => {
  const directory = new URL("../data/户型/", import.meta.url);
  for (const file of readdirSync(directory).filter(f => f !== "index.json" && f.endsWith(".json"))) {
    const { layoutDraft: draft } = parseLayoutVersionDocument(JSON.parse(readFileSync(new URL(file, directory), "utf8")));
    const before = JSON.stringify(draft), mat = materials();
    const villa = buildVilla(mat, false, site.roofFenShui, "floating", villaLayoutFromDraft(draft));
    const editor = buildEditorModel(draft, mat, "full"), cut = buildEditorModel(draft, mat, 1200);
    const dimensions = (root: THREE.Object3D) => { const values: string[] = []; root.traverse(o => { if (o.userData.doorDimensions) values.push(JSON.stringify(o.userData.doorDimensions)); }); return values.sort(); };
    assert.deepEqual(dimensions(villa.group), dimensions(editor.root), file);
    // 编辑模型已按材质合批，实体位于可选门根节点，不能只检查原门扇空组或尺寸元数据。
    const doors = (root: THREE.Object3D) => { const result: THREE.Object3D[] = []; root.traverse(o => {
      if (o.userData.layoutSelection?.kind === "door" && (o.userData.entryAssembly || o.userData.editorOpeningKind && !["window", "passage"].includes(o.userData.editorOpeningKind))) result.push(o);
    }); return result; };
    const fullDoors = doors(editor.root), cutDoors = doors(cut.root);
    assert.ok(fullDoors.length > 0, `${file} 应有可核对的门实体`);
    assert.equal(cutDoors.length, fullDoors.length, `${file} 剖切墙仍显示所有完整门`);
    fullDoors.forEach((door, index) => {
      const clipped = cutDoors[index];
      const solids = (root: THREE.Object3D) => {
        const result = new THREE.Box3(); root.updateWorldMatrix(true, true);
        root.traverse(o => { if (o instanceof THREE.Mesh && (!root.userData.entryAssembly || [mat.doorBronze, mat.doorBronzeInset, mat.doorBronzeHardware].includes(o.material))) result.union(bounds(o)); });
        return result;
      };
      const fullBounds = solids(door), cutBounds = solids(clipped);
      assert.ok(!fullBounds.isEmpty() && !cutBounds.isEmpty(), `${file} 缺少合批后的门实体`);
      close(cutBounds.min.y, fullBounds.min.y); close(cutBounds.max.y, fullBounds.max.y);
      const woodDoor = named(clipped, "实木造型室内门")[0];
      if (woodDoor) {
        const handleY = cutBounds.min.y + Math.min(1050, woodDoor.userData.doorDimensions.height * .48);
        let handleVertices = 0;
        clipped.traverse(o => {
          if (!(o instanceof THREE.Mesh) || o.material !== mat.doorHardware) return;
          const positions = o.geometry.getAttribute("position");
          for (let i = 0; i < positions.count; i++) {
            const y = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld).y;
            if (Math.abs(y - handleY) <= 9) handleVertices++;
          }
        });
        assert.ok(handleVertices > 0, `${file} 缺少原标高的执手实体`);
        const heightRatio = (handleY - cutBounds.min.y) / (cutBounds.max.y - cutBounds.min.y);
        assert.ok(heightRatio > .35 && heightRatio < .6, `${file} 把手应位于完整门的中部，不能挤在剖切门顶`);
      }
    });
    const interiorCount = [...draft.floors.flatMap(f => f.partitions), ...draft.annexPartitions].filter(p => p.door && !["passage", "window"].includes(p.door.kind ?? "door")).length;
    assert.ok(dimensions(villa.group).length >= interiorCount && dimensions(villa.group).length > 0, `${file} 应包含原有实体门`);
    assert.equal(JSON.stringify(draft), before, `${file} 构造不覆盖保存数据`);
    disposeEditorModel(editor.root, new THREE.Scene()); disposeEditorModel(cut.root, new THREE.Scene());
  }
});
