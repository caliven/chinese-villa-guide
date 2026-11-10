import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { AssemblyExplosion, ASSEMBLY_DURATION } from "../src/assembly-explosion";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture";
import { floors } from "../src/data";
import { clonePublishedLayout } from "../src/layout-draft";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, getVillaParams, resetVillaParams } from "../src/villa-params";
import type { Mats } from "../src/primitives";
import { batchScene, visibleSurfaceMeshes } from "../src/render-geometry";

const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) {
  return target[key] ??= new THREE.MeshPhysicalMaterial() as never;
} });
function fixture() {
  const draft = clonePublishedLayout();
  const model = buildVilla(mat, false, DEFAULT_VILLA_PARAMS.roofFenShui, "floating", villaLayoutFromDraft(draft));
  return { model, draft, explosion: new AssemblyExplosion(model, floors.map(f => f.name), false) };
}
function visibleBounds(root: THREE.Object3D, excludeIndependent = false) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  for (const mesh of visibleSurfaceMeshes(root)) {
    let independent = false;
    for (let parent: THREE.Object3D | null = mesh; parent && parent !== root; parent = parent.parent)
      if (parent.userData.assemblyPart) independent = true;
    if (!excludeIndependent || !independent) bounds.union(new THREE.Box3().setFromObject(mesh));
  }
  return bounds;
}

test("完整房屋可分层、抬屋顶、分开门厅与辅楼，反复合拢精确还原且不改方案", () => {
  const { model, draft, explosion } = fixture();
  const original = JSON.stringify({ draft, params: getVillaParams() });
  const homes = new Map(explosion.parts.flatMap(p => p.roots.map(r => [r, r.position.clone()] as const)));
  const bounds = new THREE.Box3().setFromObject(model.group);
  explosion.apply(1);
  for (let i = 1; i < 3; i++) {
    const lower = visibleBounds(model.levels[i - 1], true);
    const upper = visibleBounds(model.levels[i], true);
    assert.ok(upper.min.y - lower.max.y >= 2399, "完整墙体、家具和楼梯之间留出观察空隙");
  }
  const foundationPart = explosion.parts.find(p => p.name === "地基")!;
  const firstFloor = explosion.parts.find(p => p.name === floors[0].name)!;
  assert.ok(foundationPart);
  assert.equal(model.foundation.position.lengthSq(), 0, "地基留在原位");
  assert.ok(model.levels[0].position.y > 0, "一层抬起后可看见地基");
  assert.ok(visibleBounds(model.levels[0], true).min.y - visibleBounds(model.foundation).max.y >= 2399);
  assert.ok(model.roof.position.y > model.levels[2].position.y);
  assert.ok(model.portico.position.z < -3000);
  assert.equal(model.annexFoundation.position.lengthSq(), 0, "辅楼地基留在原位");
  assert.ok(model.annex.position.y > 0, "辅楼主体抬起露出辅楼地基");
  assert.equal(model.annexRoof.position.y, model.topSlabs.annex.position.y);
  assert.equal(
    model.facadeColumns.position.y - homes.get(model.facadeColumns)!.y,
    firstFloor.offset.y,
    "通高包角柱随一层抬起",
  );
  for (const name of ["门厅一二层通高门", "挑空客厅一二层通高玻璃", "烤火房回纹横披"]) {
    const root = model.group.getObjectByName(name)!;
    assert.equal(root.position.y - homes.get(root)!.y, firstFloor.offset.y, `${name} 贴合一层抬起`);
    assert.ok(firstFloor.roots.includes(root));
  }
  assert.ok(firstFloor.roots.includes(model.facadeColumns));
  assert.ok(foundationPart.roots.includes(model.foundation));
  assert.ok(!explosion.parts.some(p => /通高|顶板/.test(p.name)), "通高件归一楼，顶板归屋顶下部");
  const decor = model.roof.getObjectByName("官帽承托梁回纹")!;
  assert.ok(decor && decor.children.length > 0, "官帽回纹归属屋顶");
  assert.equal(model.levels[2].getObjectByName("官帽承托梁回纹"), undefined);
  assert.equal(model.portico.getObjectByName("主楼通高包角柱"), undefined);
  assert.ok(model.portico.getObjectByName("门厅地坪投影计入首层合计"));
  for (let i = 0; i < 30; i++) { explosion.apply(1); explosion.apply(0); }
  for (const [root, home] of homes) assert.deepEqual(root.position, home, root.name);
  assert.deepEqual(new THREE.Box3().setFromObject(model.group), bounds);
  assert.equal(JSON.stringify({ draft, params: getVillaParams() }), original);
  explosion.dispose();
});

test("动画中反向点击从当前帧合拢，端点点击不会继续错误方向", () => {
  const { explosion } = fixture();
  explosion.setExpanded(true, true, 0);
  explosion.update(ASSEMBLY_DURATION / 2);
  assert.ok(explosion.progress > 0 && explosion.progress < 1);
  const mid = explosion.progress;
  explosion.setExpanded(false, true, ASSEMBLY_DURATION / 2);
  assert.equal(explosion.progress, mid);
  explosion.update(ASSEMBLY_DURATION);
  assert.equal(explosion.progress, 0);
  explosion.setExpanded(true, true, 1000);
  explosion.setExpanded(false, true, 1000);
  explosion.update(2000);
  assert.equal(explosion.progress, 0);
  explosion.setExpanded(true, false, 2000);
  assert.equal(explosion.progress, 1, "减少动态效果时直接到达端点");
  explosion.dispose();
});

test("隐藏构件仍保留拆分规则，销毁后复用构件回到原位", () => {
  const { model, explosion: initial } = fixture();
  initial.dispose();
  model.roof.visible = model.annex.visible = model.balcony.visible = false;
  const explosion = new AssemblyExplosion(model, floors.map(f => f.name), false);
  explosion.apply(1);
  assert.ok(model.roof.position.y > 0);
  assert.ok(model.annex.position.y > 0);
  model.roof.visible = true;
  assert.ok(explosion.expandedBounds().max.y > 20000);
  explosion.dispose();
  assert.equal(model.roof.position.lengthSq(), 0);
  assert.equal(model.annex.position.lengthSq(), 0);
});

test("主辅楼换位和不同层高时辅楼仍只竖向抬起，楼层按实体留缝", () => {
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement: "main-west", floor1Height: 4200, floor2Height: 3900 });
    const { model, explosion } = fixture();
    explosion.apply(1);
    assert.equal(model.annex.position.x, 0);
    assert.equal(model.annex.position.z, 0);
    assert.ok(model.annex.position.y > 0);
    assert.equal(model.annexRoof.position.x, 0);
    assert.equal(model.annexRoof.position.z, 0);
    for (let i = 1; i < 3; i++) assert.ok(visibleBounds(model.levels[i], true).min.y
      - visibleBounds(model.levels[i - 1], true).max.y >= 2399);
    explosion.dispose();
  } finally { resetVillaParams(); }
});

test("两种官帽主辅楼均拆出带楼板的天沟基座和瓦片木架，合批后仍独立且合拢精确归位", () => {
  for (const style of ["joined", "floating"] as const) {
    const model = buildVilla(mat, false, DEFAULT_VILLA_PARAMS.roofFenShui, style);
    for (const root of [...model.levels, model.roof, model.annexRoof]) batchScene(root);
    model.group.updateMatrixWorld(true);
    const before = new Map(visibleSurfaceMeshes(model.group).map(mesh => [mesh, mesh.matrixWorld.clone()]));
    const explosion = new AssemblyExplosion(model, floors.map(f => f.name), false);
    for (const progress of [.4, 1]) {
      explosion.apply(progress); model.group.updateMatrixWorld(true);
      for (const [name, roof, slab] of [["主楼", model.roof, model.topSlabs.main], ["辅楼", model.annexRoof, model.topSlabs.annex]] as const) {
        const cover = roof.getObjectByName("屋顶瓦片与木架")!;
        assert.ok(visibleSurfaceMeshes(cover).length > 0, "合批保留独立瓦面木架");
        assert.ok(cover.getObjectByName("木屋盖梁架"));
        assert.equal(cover.getObjectByName("天沟槽底"), undefined);
        const base = visibleBounds(roof, true).union(visibleBounds(slab));
        assert.ok(slab.children.length > 0, "主辅楼屋顶下均有实体楼板");
        assert.equal(slab.position.y, roof.position.y, "楼板与天沟按同一偏移移动");
        assert.ok(explosion.parts.find(p => p.name === `${name}楼板与天沟`)!.roots.includes(slab));
        if (progress === 1) assert.ok(visibleBounds(cover).min.y - base.max.y >= 1999, "瓦架和天沟基座间留出观察空隙");
      }
    }
    explosion.apply(0); model.group.updateMatrixWorld(true);
    for (const [mesh, matrix] of before) assert.deepEqual(mesh.matrixWorld, matrix, "所有合批实体精确归位");
    explosion.dispose();
  }
});

test("三楼外侧组只带瓦片、玻璃栏杆和短柱，楼板、挡墙、承托和高柱随三层主体", () => {
  for (const style of ["joined", "floating"] as const) for (const batched of [false, true]) {
    const model = buildVilla(mat, false, DEFAULT_VILLA_PARAMS.roofFenShui, style);
    const thirdFloor = model.levels[2];
    const exterior = thirdFloor.getObjectByName("三楼飘檐与露台")!;
    const independentNames = ["裁切拼接的蓝釉瓦面", "三楼通透玻璃栏板与细金属框", "四根露台短柱"];
    assert.deepEqual(new Set(exterior.children.map(child => child.name)), new Set(independentNames));
    const bodyNames = ["三楼楼板", "三楼屋檐内挡墙", "梁托", "连续转角下沿线", "三楼官帽柱", "三楼包角柱"];
    for (const name of bodyNames) {
      assert.ok(thirdFloor.getObjectByName(name), name);
      assert.equal(exterior.getObjectByName(name), undefined, `${name} 应归三层主体`);
    }
    if (batched) batchScene(thirdFloor);
    const explosion = new AssemblyExplosion(model, floors.map(f => f.name), false);
    model.group.updateMatrixWorld(true);
    const matrices = new Map(visibleSurfaceMeshes(thirdFloor).map(mesh => [mesh, mesh.matrixWorld.clone()]));
    const before = visibleBounds(exterior), body = visibleBounds(thirdFloor, true);
    for (const progress of [.4, 1]) {
      explosion.apply(progress);
      const after = visibleBounds(exterior), movedBody = visibleBounds(thirdFloor, true);
      assert.equal(after.min.z - before.min.z, -5000 * progress);
      assert.equal(after.max.z - before.max.z, -5000 * progress, "瓦片、栏杆和短柱同步前移");
      assert.equal(movedBody.min.z, body.min.z);
      assert.equal(movedBody.max.z, body.max.z, "露台楼板、承托与高柱保留三层水平位置");
      assert.equal(after.min.y - before.min.y, movedBody.min.y - body.min.y, "两组同步随三层抬高");
      if (progress === 1) assert.ok(after.max.z < movedBody.min.z, "外侧组与三层主体分开可见");
    }
    explosion.dispose();
    model.group.updateMatrixWorld(true);
    for (const [mesh, matrix] of matrices) assert.deepEqual(mesh.matrixWorld, matrix, "所有三层实体精确归位");
    assert.deepEqual(visibleBounds(exterior), before);
  }
});

test("旋转观察时辅楼及其屋顶标注均留在模型画面右侧", () => {
  const previousDocument = globalThis.document;
  const context = new Proxy({ measureText: () => ({ width: 300 }) }, {
    get(target, key) { return Reflect.get(target, key) ?? (() => {}); },
  });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
  try {
    const { model, explosion: initial } = fixture(); initial.dispose();
    const explosion = new AssemblyExplosion(model, floors.map(f => f.name));
    explosion.apply(1);
    const camera = new THREE.PerspectiveCamera(38, 1.6, 40, 350000);
    for (const position of [[40000, 35000, -50000], [-35000, 30000, 45000]]) {
      camera.position.fromArray(position); camera.lookAt(11000, 6000, 4000); camera.updateMatrixWorld(true);
      explosion.updateLabels(camera);
      for (const part of explosion.parts.filter(p => p.labelRight)) {
        const box = part.bounds.clone().translate(part.offset);
        let right = -Infinity;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z])
          right = Math.max(right, new THREE.Vector3(x, y, z).project(camera).x);
        assert.ok(part.label!.position.clone().project(camera).x > right, part.name);
      }
    }
    explosion.dispose();
  } finally { globalThis.document = previousDocument; }
});
