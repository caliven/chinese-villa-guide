import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { annexRoofFootprint, attachRoofs } from "../src/architecture";
import { tiledApron } from "../src/facade-details";
import { setEaveWashAppearance, setEaveWashVisible } from "../src/eave-lighting";
import { visibleSurfaceMeshes, batchStatic } from "../src/render-geometry";
import { frontApronSection, apronFasciaBottom, eaveTrimDesign } from "../src/roof-options";
import type { Mats } from "../src/primitives";

const mat = new Proxy({} as Mats, {
  get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; },
});
const washes = (root: THREE.Object3D) => {
  const result: THREE.Object3D[] = [];
  root.traverse(o => { if (o.userData.eaveWash) result.push(o); });
  return result;
};

function endpoints(group: THREE.Object3D, name: string) {
  const mesh = group.getObjectByName(name) as THREE.Mesh;
  mesh.updateWorldMatrix(true, false);
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!;
  return [box.min.x, box.max.x].map(x => mesh.localToWorld(new THREE.Vector3(x, 0, 0)));
}
function joinedEnds(groups: THREE.Object3D[], name: string) {
  return groups.map(group => endpoints(group, name)).flat().map((point, index, all) =>
    all.some((other, i) => i !== index && point.distanceTo(other) < 0.01));
}

test("主楼两种官帽及辅楼四面屋檐均生成可切换的灯带", () => {
  for (const style of ["joined", "floating"] as const) {
    const main = new THREE.Group(), annex = new THREE.Group();
    attachRoofs(main, annex, mat, 4.5, style);
    assert.ok(washes(main).length >= 7, `${style} 主屋及官帽`);
    assert.equal(washes(annex).length, 4, `${style} 辅楼四面`);
    assert.ok(joinedEnds(washes(annex), "暖白灯带").every(Boolean), "辅楼四个转角灯带闭合");
    assert.ok(joinedEnds(washes(annex), "洗墙渐隐光晕").every(Boolean), "辅楼四个转角光晕闭合");
    const fasciaTop = apronFasciaBottom(annexRoofFootprint().eave, 0) - eaveTrimDesign.eyelidToFascia;
    for (const group of washes(annex)) {
      const strip = group.getObjectByName("暖白灯带")!;
      const glow = group.getObjectByName("洗墙渐隐光晕")!;
      const bounds = new THREE.Box3().setFromObject(glow);
      assert.equal(strip.position.y - 12, fasciaTop);
      assert.ok(Math.abs(bounds.min.y - fasciaTop) < 0.001);
      assert.ok(Math.abs(bounds.max.y - fasciaTop - eaveTrimDesign.eyelidToFascia) < 0.001);
    }
    assert.ok(washes(main).every(o => !o.visible));
    setEaveWashVisible(main, true);
    assert.ok(washes(main).every(o => o.visible));
    setEaveWashVisible(main, false);
    assert.ok(washes(main).every(o => !o.visible));
  }
});

test("二楼折线飘檐逐边铺灯，合批后仍能控制且不阻挡缩放", () => {
  const root = new THREE.Group();
  const inner: [number, number][] = [[0, 0], [4000, 0], [4000, -2000], [8000, -2000]];
  const outer: [number, number][] = [[0, -800], [4800, -800], [4800, -2800], [8000, -2800]];
  tiledApron(root, inner, outer, 7200, 200, mat);
  assert.equal(washes(root).length, 3);
  for (const name of ["暖白灯带", "洗墙渐隐光晕"]) {
    assert.equal(joinedEnds(washes(root), name).filter(Boolean).length, 4, `${name} 阴阳两处折角闭合`);
  }
  const section = frontApronSection(7200, 200);
  for (const group of washes(root)) {
    const strip = group.getObjectByName("暖白灯带")!;
    const glow = group.getObjectByName("洗墙渐隐光晕")!;
    const bounds = new THREE.Box3().setFromObject(glow);
    assert.equal(strip.position.y - 12, section.fasciaTopY);
    assert.ok(Math.abs(bounds.min.y - section.fasciaTopY) < 0.001);
    assert.ok(Math.abs(bounds.max.y - section.soffitY) < 0.001);
  }
  batchStatic(root);
  setEaveWashVisible(root, true);
  assert.equal(washes(root).length, 3);
  const hitSurfaces = visibleSurfaceMeshes(root);
  for (const group of washes(root)) {
    assert.equal(group.children.length, 2);
    assert.ok(group.children.every(child => !hitSurfaces.includes(child as THREE.Mesh)));
  }
});


test("颜色与亮度同步作用于灯带和光晕且零亮度熄灭", () => {
  const main = new THREE.Group(), annex = new THREE.Group(), root = new THREE.Group();
  root.add(main, annex);
  attachRoofs(main, annex, mat, 4.5, "joined");
  setEaveWashAppearance(root, "#ffd99a", 1);
  for (const group of washes(root)) {
    const strip = group.getObjectByName("暖白灯带") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const glow = group.getObjectByName("洗墙渐隐光晕") as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    assert.equal(strip.material.color.getHexString(), "ffd99a");
    assert.deepEqual(glow.material.uniforms.washColor.value.toArray(), [1, 0.56, 0.22]);
  }
  setEaveWashAppearance(root, "#3399ff", 1.5);
  for (const group of washes(root)) {
    const strip = group.getObjectByName("暖白灯带") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const glow = group.getObjectByName("洗墙渐隐光晕") as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    assert.equal(strip.material.color.getHexString(), "3399ff");
    assert.deepEqual(glow.material.uniforms.washColor.value.toArray(), [0.2, 0.6, 1]);
    assert.equal(glow.material.uniforms.brightness.value, 1.5);
  }
  setEaveWashAppearance(root, "#3399ff", 0);
  for (const group of washes(root)) {
    const strip = group.getObjectByName("暖白灯带") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const glow = group.getObjectByName("洗墙渐隐光晕") as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    assert.equal(strip.material.opacity, 0);
    assert.equal(glow.material.uniforms.brightness.value, 0);
  }
});
