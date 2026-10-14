import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { batchStatic, removeCoplanarOverlap, visibleSurfaceMeshes } from "../src/render-geometry";
import { architecturalGlass, box } from "../src/primitives";

function hits(root: THREE.Object3D, x: number, z: number) {
  root.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, 8, z), new THREE.Vector3(0, -1, 0))
    .intersectObject(root, true).filter((h) => (h.object as THREE.Mesh).isMesh && Math.abs(h.point.y - 1) < 1e-5);
}

test("缩放碰撞忽略文字标签、路线和隐藏父组，仅命中可见实体", () => {
  const root = new THREE.Group(), hidden = new THREE.Group();
  root.add(hidden, new THREE.Sprite(new THREE.SpriteMaterial()));
  hidden.visible = false;
  box(hidden, 0, 0, 3, 1, 1, 1, new THREE.MeshStandardMaterial());
  box(root, 0, 0, 2, 1, 1, 1, new THREE.MeshBasicMaterial({ depthTest: false }));
  box(root, 0, 0, 1, 1, 1, 1, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false }));
  const wall = box(root, 0, 0, 0, 1, 1, 1, new THREE.MeshStandardMaterial());
  root.updateMatrixWorld(true);
  const surfaces = visibleSurfaceMeshes(root);
  assert.deepEqual(surfaces, [wall]);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
  const intersections = ray.intersectObjects(surfaces, false);
  assert.equal(intersections[0].object, wall);
  assert.equal(intersections[0].distance, 4.5);
});

test("共面窗套、线脚保留覆盖材质，底面裁掉重叠但不出现缺口", () => {
  const root = new THREE.Group();
  const base = new THREE.MeshStandardMaterial(), detail = new THREE.MeshStandardMaterial();
  box(root, 0, 0.5, 0, 4, 1, 4, base);
  const over = box(root, 0.4, 0.8, -0.2, 1.4, 0.4, 2.2, detail);
  const bounds = new THREE.Box3().setFromObject(root);
  assert.ok(removeCoplanarOverlap(root) > 0);
  assert.ok(new THREE.Box3().setFromObject(root).equals(bounds));
  for (let x = -1.83; x < 1.9; x += 0.31)
    for (let z = -1.77; z < 1.9; z += 0.29) {
      const row = hits(root, x, z);
      assert.equal(row.length, 1, `完成面重叠或缺口 @ ${x},${z}`);
      if (x > -0.3 && x < 1.1 && z > -1.3 && z < 0.9)
        assert.equal(row[0].object, over);
    }
});

test("缩放、旋转后的装饰仍裁掉共面，UV 随裁切点插值", () => {
  const scene = new THREE.Group(), root = new THREE.Group();
  root.position.set(3, 2, -4);
  root.rotation.y = 0.7;
  root.scale.set(1.6, 2.1, 0.8);
  scene.add(root);
  const base = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial());
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial());
  root.add(base, cover);
  cover.position.set(0.37, -0.23, 0);
  scene.updateMatrixWorld(true);
  assert.equal(removeCoplanarOverlap(root), 1);
  const positions = base.geometry.getAttribute("position"), uv = base.geometry.getAttribute("uv");
  for (let i = 0; i < positions.count; i++) {
    assert.ok(Math.abs(uv.getX(i) - (positions.getX(i) + 2) / 4) < 1e-5);
    assert.ok(Math.abs(uv.getY(i) - (positions.getY(i) + 2) / 4) < 1e-5);
    assert.ok(Math.abs(positions.getZ(i)) < 1e-5);
  }
});

test("静态合并兼容缺少 UV 的几何，透射玻璃合并而独立开关及透明标记保留", () => {
  const root = new THREE.Group(), toggle = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const a = box(root, -2, 0.5, 0, 1, 1, 1, mat);
  const b = box(root, 2, 0.5, 0, 1, 1, 1, mat);
  b.geometry = b.geometry.clone();
  b.geometry.deleteAttribute("uv");
  root.add(toggle);
  const parked = box(toggle, 0, 0.5, 0, 1, 1, 1, mat);
  const glassMaterial = architecturalGlass();
  const glass = box(root, -1, 2, 0, 1, 1, 0.012, glassMaterial);
  const otherGlass = box(root, 1, 2, 0, 1, 1, 0.012, glassMaterial);
  const overlay = box(root, 0, 3, 0, 1, 1, 0.012,
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false }));
  batchStatic(root, new Set([toggle]));
  assert.equal(a.parent, null);
  assert.equal(b.parent, null);
  assert.equal(parked.parent, toggle);
  assert.equal(glass.parent, null);
  assert.equal(otherGlass.parent, null);
  assert.equal(overlay.parent, root);
  const panes = root.children.filter((obj) => obj instanceof THREE.Mesh && obj.material === glassMaterial);
  assert.equal(panes.length, 1);
  root.updateMatrixWorld(true);
  for (const x of [-1, 1]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x + 0.17, 2.11, -1), new THREE.Vector3(0, 0, 1));
    assert.equal(ray.intersectObjects(panes, false).length, 1);
  }
  const solids = root.children.filter((obj) => obj instanceof THREE.Mesh && obj.material === mat);
  assert.equal(solids.length, 1);
  const bounds = new THREE.Box3().setFromObject(solids[0]);
  assert.equal(bounds.min.x, -2.5);
  assert.equal(bounds.max.x, 2.5);
  toggle.visible = false;
  assert.equal(parked.parent, toggle);
});

test("普通玻璃、Low-E 和栏板使用稳定深度，仍保留更亮的 Low-E 镀膜", () => {
  const ordinary = architecturalGlass(), lowE = architecturalGlass(true);
  for (const material of [ordinary, lowE]) {
    assert.equal(material.transparent, false);
    assert.equal(material.depthWrite, true);
    assert.equal(material.depthTest, true);
    assert.equal(material.side, THREE.FrontSide);
    assert.ok(material.transmission > 0);
  }
  assert.ok(lowE.color.getHSL({ h: 0, s: 0, l: 0 }).l > ordinary.color.getHSL({ h: 0, s: 0, l: 0 }).l);
  assert.ok(lowE.ior > ordinary.ior);
});
