import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { attachLayoutRoofs, buildVilla, mainRoofFootprint, roofPitch, villaLayoutFromDraft } from "../src/architecture.ts";
import { site } from "../src/data.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model.ts";
import { addTiledRoof, hipRoofSurfaces } from "../src/roof-surfaces.ts";
import { addTimberRoofFrame } from "../src/roof-timber.ts";
import { gutterInnerLipInset, roofGutterDesign, roofTileEaveLift, slabToTileEaveLift, roofTileInset } from "../src/roof-options.ts";
import { resetVillaParams } from "../src/villa-params.ts";
import type { Mats } from "../src/primitives.ts";

const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
const materials = () => new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshStandardMaterial() as never; } });
test.afterEach(resetVillaParams);

test("四坡木屋盖含正脊檩、斜脊梁、檩条与椽子，并落在瓦面以下", () => {
  const main = mainRoofFootprint(), pitch = roofPitch(site.roofFenShui), lift = slabToTileEaveLift();
  const hip = hipRoofSurfaces(main.x + roofTileInset, main.z + roofTileInset, main.w - 2 * roofTileInset, main.d - 2 * roofTileInset, main.eave + lift, pitch.mainRise);
  const root = new THREE.Group();
  addTimberRoofFrame(root, hip, new THREE.MeshStandardMaterial({ color: "#6b4a2e" }));
  const names = new Set<string>();
  root.traverse(child => { if (child.name) names.add(child.name); });
  assert.ok(names.has("木屋盖梁架"));
  assert.ok(names.has("正脊檩"));
  assert.ok(names.has("斜脊梁"));
  assert.ok(names.has("坡面檩条"));
  assert.ok(names.has("木椽"));
  const peak = Math.max(...hip.ridges.map(r => Math.max(r.a.y, r.b.y)));
  let ridgeY = 0;
  root.traverse(child => {
    if (child.name !== "正脊檩") return;
    ridgeY = Math.max(ridgeY, new THREE.Box3().setFromObject(child).max.y);
  });
  assert.ok(ridgeY < peak - 20, "正脊檩须在瓦面之下");
});

test("斜脊梁与檐檩不探出瓦边，也不进入天沟内挡／净宽（水泥区）", () => {
  const main = mainRoofFootprint(), pitch = roofPitch(site.roofFenShui), lift = slabToTileEaveLift();
  const inset = roofTileInset;
  const tile = {
    minX: main.x + inset, minZ: main.z + inset,
    maxX: main.x + main.w - inset, maxZ: main.z + main.d - inset,
  };
  const hip = hipRoofSurfaces(tile.minX, tile.minZ, tile.maxX - tile.minX, tile.maxZ - tile.minZ, main.eave + lift, pitch.mainRise);
  const root = new THREE.Group();
  addTimberRoofFrame(root, hip, new THREE.MeshStandardMaterial({ color: "#6b4a2e" }));
  root.updateMatrixWorld(true);
  const channel = roofGutterDesign.outerTopWidth + roofGutterDesign.clearWidth;
  const innerFace = gutterInnerLipInset();
  const inside = (x: number, z: number, edge: number) =>
    x >= main.x + edge && x <= main.x + main.w - edge && z >= main.z + edge && z <= main.z + main.d - edge;
  let maxOut = 0, gutterHits = 0;
  const v = new THREE.Vector3();
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh) || (child.name !== "斜脊梁" && child.name !== "檐檩" && child.name !== "木椽")) return;
    const pos = child.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      maxOut = Math.max(maxOut, tile.minX - v.x, v.x - tile.maxX, tile.minZ - v.z, v.z - tile.maxZ);
      // 瓦边以外即天沟净宽／内挡水泥区；木梁不得进入。
      if (!inside(v.x, v.z, inset)) gutterHits++;
      else if (inside(v.x, v.z, channel) && !inside(v.x, v.z, innerFace)) gutterHits++;
    }
  });
  assert.ok(maxOut <= 1, `木梁不得探出瓦角，实际外探 ${maxOut.toFixed(1)} mm`);
  assert.equal(gutterHits, 0, "木梁不得进入天沟净宽或内挡水泥带");
});

test("斜脊筒瓦檐口端收回，圆截面不探进天沟", () => {
  const main = mainRoofFootprint(), pitch = roofPitch(site.roofFenShui), lift = slabToTileEaveLift();
  const inset = roofTileInset;
  const tile = {
    minX: main.x + inset, minZ: main.z + inset,
    maxX: main.x + main.w - inset, maxZ: main.z + main.d - inset,
    eaveY: main.eave + lift,
  };
  const hip = hipRoofSurfaces(tile.minX, tile.minZ, tile.maxX - tile.minX, tile.maxZ - tile.minZ, tile.eaveY, pitch.mainRise);
  const root = new THREE.Group();
  addTiledRoof(root, hip.faces, new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial(), hip.ridges);
  const ridges = root.getObjectByName("相接直脊瓦") as THREE.InstancedMesh;
  assert.ok(ridges);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const up = new THREE.Vector3();
  let maxOut = 0;
  for (let i = 0; i < ridges.count; i++) {
    ridges.getMatrixAt(i, m);
    m.decompose(p, q, s);
    up.set(0, 1, 0).applyQuaternion(q);
    for (const t of [-0.5, 0.5]) {
      const end = p.clone().addScaledVector(up, s.y * t);
      // 只查接近檐口标高的端头；半径已含在几何里，端心须落在瓦面内。
      if (end.y > tile.eaveY + 200) continue;
      maxOut = Math.max(maxOut, tile.minX - end.x, end.x - tile.maxX, tile.minZ - end.z, end.z - tile.maxZ);
    }
  }
  assert.ok(maxOut <= 1, `斜脊筒瓦檐口端不得探出瓦角，实际外探 ${maxOut.toFixed(1)} mm`);
});

test("完整房屋与漫游顶板均挂木梁架和瓦屋面；顶板洞口四边有栏杆", () => {
  const draft = clonePublishedLayout();
  const mat = materials();
  const layout = villaLayoutFromDraft(draft);
  const villa = buildVilla(mat, false, site.roofFenShui, "floating", layout);
  assert.ok(villa.roof.getObjectByName("木屋盖梁架"));
  assert.ok(villa.roof.getObjectByName("裁切拼接的蓝釉瓦面") || villa.roof.getObjectByName("封闭瓦面") || [...villa.roof.children].some(c => c.name.includes("瓦") || c.getObjectByName("封闭瓦面")));
  assert.ok(villa.annexRoof.getObjectByName("木屋盖梁架"));
  const editor = buildEditorModel(draft, mat, "full", { walking: true, fenShui: site.roofFenShui, roofStyle: "floating" });
  assert.ok(editor.root.getObjectByName("漫游屋顶层"));
  assert.ok(editor.root.getObjectByName("木屋盖梁架"));
  assert.ok(editor.root.getObjectByName("漫游主楼坡屋面"));
  const roof = editor.root.getObjectByName("漫游屋顶层")!;
  const rails: THREE.Object3D[] = [];
  roof.traverse(child => { if (child.userData.railingEndpoints) rails.push(child); });
  assert.ok(rails.length >= 3, "顶板洞口须有栏杆，上跑通口侧横封");
  const slab = roof.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh;
  const material = slab.material as THREE.MeshStandardMaterial;
  assert.ok(material.polygonOffset && material.polygonOffsetFactor > 0);
  assert.equal(material.side, THREE.FrontSide);
  disposeEditorModel(editor.root, new THREE.Scene());
  villa.group.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose(); });
});

test("屋面开关重建仍保留木梁架", () => {
  const root = new THREE.Group(), annex = new THREE.Group(), mat = materials();
  attachLayoutRoofs(root, annex, mat, site.roofFenShui, "joined", villaLayoutFromDraft(clonePublishedLayout()));
  assert.ok(root.getObjectByName("木屋盖梁架"));
  assert.ok(annex.getObjectByName("木屋盖梁架"));
});
