import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildVilla, villaLayoutFacades, villaLayoutFromDraft } from "../src/architecture.ts";
import { clonePublishedLayout, ensureExteriorManaged } from "../src/layout-draft.ts";
import { site, frontElevation } from "../src/data.ts";
import { VillaViewer, defaultView } from "../src/viewer.ts";
import type { Mats } from "../src/primitives.ts";

// 三维几何测试不创建 WebGL；只为标签的 CanvasTexture 提供绘图替身。
const context = new Proxy({ measureText: () => ({ width: 100 }) }, {
  get(target, key) { return Reflect.get(target, key) ?? (() => {}); },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;

function materials() {
  return new Proxy({} as Mats, {
    get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; },
  });
}

function fixture() {
  const draft = ensureExteriorManaged(clonePublishedLayout());
  const mat = materials();
  const viewer = Object.create(VillaViewer.prototype) as VillaViewer;
  viewer.mat = mat;
  viewer.fenShui = site.roofFenShui;
  viewer.state = { ...defaultView };
  viewer.layoutLive = villaLayoutFromDraft(draft);
  viewer.villa = buildVilla(mat, true, site.roofFenShui, "joined", viewer.layoutLive);
  viewer.livingGlass = viewer.villa.group.getObjectByName("挑空客厅一二层通高玻璃")!;
  viewer.entryBay = viewer.villa.group.getObjectByName("门厅一二层通高门")!;
  viewer.eastBand = viewer.villa.group.getObjectByName("烤火房回纹横披")!;
  viewer.scene = new THREE.Scene();
  viewer.mmRoot = new THREE.Group();
  viewer.scene.add(viewer.mmRoot);
  viewer.mmRoot.add(viewer.villa.group);
  const landRoot = new THREE.Group();
  viewer.land = { context: landRoot } as typeof viewer.land;
  viewer.routeGroup = new THREE.Group();
  viewer.ramp = new THREE.Group();
  viewer.mmRoot.add(landRoot, viewer.routeGroup, viewer.ramp);
  viewer.setState = () => {};
  return { viewer, draft };
}

test("家具修改仅重建对应层，保留场地、路线、屋顶和门厅；同稿重复更新不重建", () => {
  const { viewer, draft } = fixture();
  const old = viewer.villa, land = viewer.land, route = viewer.routeGroup, ramp = viewer.ramp;
  const originalLevels = [...old.levels];
  draft.floors[0].furniture[0].x += 100;
  viewer.rebuildLayout(villaLayoutFromDraft(draft));
  assert.notEqual(viewer.villa.levels[0], originalLevels[0]);
  assert.equal(viewer.villa.levels[1], originalLevels[1]);
  assert.equal(viewer.villa.levels[2], originalLevels[2]);
  for (const key of ["roof", "annexRoof", "portico", "balcony", "annex"] as const)
    assert.equal(viewer.villa[key], old[key], key);
  assert.equal(viewer.land, land);
  assert.equal(viewer.routeGroup, route);
  assert.equal(viewer.ramp, ramp);
  assert.equal(land.context.parent, viewer.mmRoot);
  assert.equal(viewer.villa.group.parent, viewer.mmRoot);
  const updated = viewer.villa;
  viewer.rebuildLayout(villaLayoutFromDraft(draft));
  assert.equal(viewer.villa, updated);
});

test("内墙修改只重建对应层，辅楼家具修改只重建辅楼", () => {
  const { viewer, draft } = fixture();
  const old = viewer.villa;
  draft.floors[1].partitions[0].a[0] += 100;
  draft.floors[1].partitions[0].b[0] += 100;
  viewer.rebuildLayout(villaLayoutFromDraft(draft));
  assert.equal(viewer.villa.levels[0], old.levels[0]);
  assert.notEqual(viewer.villa.levels[1], old.levels[1]);
  assert.equal(viewer.villa.levels[2], old.levels[2]);
  const beforeAnnex = viewer.villa;
  draft.annexFurniture[0].x += 100;
  viewer.rebuildLayout(villaLayoutFromDraft(draft));
  assert.notEqual(viewer.villa.annex, beforeAnnex.annex);
  assert.ok(viewer.villa.levels.every((level, i) => level === beforeAnnex.levels[i]));
  assert.equal(viewer.villa.annexRoof, old.annexRoof);
});

test("楼梯参数使全部梯段与洞口失效，挑空修改更新二层楼板", () => {
  const { viewer, draft } = fixture();
  const old = viewer.villa;
  draft.stairLayout.room.w -= 100;
  viewer.rebuildLayout(villaLayoutFromDraft(draft));
  assert.ok(viewer.villa.levels.every((level, i) => level !== old.levels[i]));
  assert.equal(viewer.villa.roof, old.roof);
  const beforeVoid = viewer.villa;
  draft.livingVoid.d += 100;
  viewer.rebuildLayout(villaLayoutFromDraft(draft));
  assert.equal(viewer.villa.levels[0], beforeVoid.levels[0]);
  assert.notEqual(viewer.villa.levels[1], beforeVoid.levels[1]);
  assert.equal(viewer.villa.levels[2], beforeVoid.levels[2]);
});

test("外墙洞口删除与移动反映到立面，正立面改动不残留旧通高玻璃", () => {
  const { viewer, draft } = fixture();
  const old = viewer.villa;
  const frontIndex = draft.exteriorOpenings.findIndex(item => item.floor === 0 && item.facadeIndex === 0);
  const count = villaLayoutFacades(0, villaLayoutFromDraft(draft))[0].openings.length;
  draft.exteriorOpenings.splice(frontIndex, 1);
  const side = draft.exteriorOpenings.find(item => item.floor === 2 && item.facadeIndex === 0)!;
  side.opening.offset += 100;
  const changed = villaLayoutFacades(0, villaLayoutFromDraft(draft));
  assert.equal(changed[0].openings.length, count - 1);
  assert.ok(changed[0].openings.every(opening => opening.span === undefined));
  viewer.rebuildLayout(villaLayoutFromDraft(draft));
  assert.equal(viewer.livingGlass.children.length, 0);
  assert.notEqual(viewer.villa.levels[0], old.levels[0]);
  assert.notEqual(viewer.villa.levels[2], old.levels[2]);
  assert.equal(viewer.villa.roof, old.roof);
  const sideFacade = villaLayoutFacades(2, villaLayoutFromDraft(draft))[0];
  assert.ok(sideFacade.openings.some(opening => opening.at === side.opening.offset + side.opening.width / 2));
});

test("门厅尺寸更新门厅、官帽和露台，构建后共享尺寸事实源恢复原值", () => {
  const { viewer, draft } = fixture();
  const old = viewer.villa;
  const porch = structuredClone(site.portico), elevation = structuredClone(frontElevation);
  draft.portico.x += 100;
  draft.portico.projection += 100;
  viewer.rebuildLayout(villaLayoutFromDraft(draft));
  assert.notEqual(viewer.villa.portico, old.portico);
  assert.notEqual(viewer.villa.roof, old.roof);
  assert.notEqual(viewer.villa.levels[2], old.levels[2]);
  assert.deepEqual(site.portico, porch);
  assert.deepEqual(frontElevation, elevation);
  const updated = viewer.villa;
  viewer.rebuildLayout(villaLayoutFromDraft(draft));
  assert.equal(viewer.villa, updated);
});

test("外轮廓尺寸变化不复用旧构件，清空 live 户型恢复源码几何", () => {
  const { viewer, draft } = fixture();
  const old = viewer.villa;
  const width = site.main.w;
  try {
    site.main.w += 100;
    viewer.rebuildLayout(villaLayoutFromDraft(draft));
    assert.notEqual(viewer.villa.roof, old.roof);
    assert.ok(viewer.villa.levels.every((level, i) => level !== old.levels[i]));
  } finally { site.main.w = width; }
  viewer.rebuildLayout(null);
  assert.equal(viewer.layoutLive, null);
  assert.equal(viewer.villa.levels.length, 3);
});
