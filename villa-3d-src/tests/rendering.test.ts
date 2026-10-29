import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { batchScene, batchStatic, removeCoplanarOverlap, visibleSurfaceMeshes } from "../src/render-geometry";
import { architecturalGlass, box, wallWithOpenings, type Mats } from "../src/primitives";
import { floorplanFurnitureModel } from "../src/floorplan-furniture";
import { facades } from "../src/facades";
import { floors, site } from "../src/data";

function hits(root: THREE.Object3D, x: number, z: number) {
  root.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, 8, z), new THREE.Vector3(0, -1, 0))
    .intersectObject(root, true).filter((h) => (h.object as THREE.Mesh).isMesh && Math.abs(h.point.y - 1) < 1e-5);
}

test("主辅楼四向墙角、墙顶和门窗洞口各面的贴图保留真实二维尺寸", () => {
  const material = new THREE.MeshStandardMaterial();
  const mat = new Proxy({} as Mats, { get: () => material });
  for (const floor of [0, 1, 2, 3]) for (const facade of facades(floor)) {
    const group = wallWithOpenings(new THREE.Group(), facade.a, facade.b, 0,
      floor === 3 ? site.annex.height : floors[floor].height, facade.openings, mat);
    group.updateMatrixWorld(true);
    const wall = group.children[0] as THREE.Mesh;
    const position = wall.geometry.getAttribute("position"), uv = wall.geometry.getAttribute("uv");
    for (let i = 0; i < position.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, i + j).applyMatrix4(wall.matrixWorld));
      const surfaceArea = b.sub(a).cross(c.sub(a)).length();
      if (surfaceArea < .01) continue;
      const [u, v, w] = [0, 1, 2].map(j => new THREE.Vector2().fromBufferAttribute(uv, i + j));
      const textureArea = Math.abs(v.sub(u).cross(w.sub(u)));
      assert.ok(Math.abs(textureArea / surfaceArea - 1) < 1e-5,
        `${floor}层墙面贴图不应压成线或拉伸成条纹，实际面积比 ${textureArea / surfaceArea}`);
    }
  }
});

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

test("场地合批共用重复家具表面，编辑合批仍保留逐件选择与显隐", () => {
  const fixture = () => {
    const root = new THREE.Group();
    root.position.set(3000, 1000, -2000);
    root.rotation.y = .4;
    for (let i = 0; i < 4; i++) {
      const furniture = floorplanFurnitureModel({ kind: "chair", x: i * 1000, z: 0, w: 500, d: 500 })!;
      furniture.position.x = i * 1000;
      furniture.userData.layoutSelection = { kind: "furniture", floor: 0, index: i };
      root.add(furniture);
    }
    return root;
  };
  const stats = (root: THREE.Object3D) => {
    let meshes = 0, triangles = 0;
    root.traverseVisible(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      meshes++;
      triangles += (obj.geometry.index?.count ?? obj.geometry.getAttribute("position").count) / 3;
    });
    return { meshes, triangles };
  };
  const scene = fixture(), editor = fixture();
  const before = new THREE.Box3().setFromObject(scene, true);
  batchScene(scene);
  batchStatic(editor);
  assert.equal(stats(scene).triangles, stats(editor).triangles, "不删减家具细节");
  assert.ok(stats(scene).meshes <= stats(editor).meshes / 4, "相同家具材质合成一批");
  const after = new THREE.Box3().setFromObject(scene, true);
  assert.ok(after.min.distanceTo(before.min) < .01 && after.max.distanceTo(before.max) < .01, "变换后的占地与标高不变");
  const count = stats(editor).meshes;
  editor.children[0].visible = false;
  assert.equal(stats(editor).meshes, count * 3 / 4, "编辑模型仍能逐件隐藏");
  assert.equal(editor.children[0].userData.layoutSelection.index, 0);
});

test("场地合批保留独立开关、玻璃差异、表面参数及阴影边界", () => {
  const root = new THREE.Group(), toggle = new THREE.Group();
  const base = new THREE.MeshStandardMaterial({ color: 0x887766, roughness: .7 });
  const glass = architecturalGlass();
  const pair = (material: THREE.Material, castShadow = true) => {
    for (let i = 0; i < 2; i++) {
      const group = new THREE.Group();
      group.userData.layoutSelection = { kind: "furniture", floor: 0, index: i };
      root.add(group);
      const cloned = material.clone(); cloned.onBeforeCompile = material.onBeforeCompile;
      box(group, i * 2000, 1000, root.children.length * 2000, 500, 500, 500, cloned, castShadow);
    }
  };
  pair(base);
  const darker = base.clone(); darker.color.setHex(0x665544); pair(darker);
  pair(base, false);
  pair(glass); pair(architecturalGlass(true));
  const custom = base.clone(); custom.onBeforeCompile = () => {}; pair(custom);
  root.add(toggle);
  const separate = box(toggle, 0, 1000, -2000, 500, 500, 500, base);
  batchScene(root, new Set([toggle]));
  const meshes = visibleSurfaceMeshes(root).filter(mesh => mesh !== separate);
  // 两份自定义着色器不做材质等价合并，其余五种表面分别合成一批。
  assert.equal(meshes.length, 7);
  assert.equal(meshes.filter(mesh => mesh.castShadow && mesh.material instanceof THREE.MeshPhysicalMaterial).length, 0);
  assert.equal(separate.parent, toggle);
  const bounds = new THREE.Box3().setFromObject(separate);
  toggle.visible = false;
  assert.equal(visibleSurfaceMeshes(root).includes(separate), false);
  toggle.visible = true;
  assert.ok(new THREE.Box3().setFromObject(separate).equals(bounds));
});
