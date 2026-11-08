import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { AssemblyExplosion } from "../src/assembly-explosion";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture";
import { floors, site } from "../src/data";
import {
  FOUNDATION_FOOTING_DEPTH,
  buildFoundation,
  foundationSegments,
  porticoFoundationSegments,
  raiseOpeningsToFinish,
} from "../src/foundation";
import { clonePublishedLayout } from "../src/layout-draft";
import type { Mats } from "../src/primitives";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params";

const mat = new Proxy({} as Mats, {
  get(target, key: keyof Mats) {
    return target[key] ??= new THREE.MeshPhysicalMaterial() as never;
  },
});

test("一层洞口随室内抬高改相对墙底，门洞落到完成面", () => {
  const raised = raiseOpeningsToFinish([
    { at: 1000, w: 900, sill: 450, h: 2200, door: true },
    { at: 3000, w: 1500, sill: 900, h: 1500 },
    { at: 5000, w: 2000, sill: 0, h: 3600, span: "upper" },
  ], 450);
  assert.deepEqual(raised[0], { at: 1000, w: 900, sill: 0, h: 2200, door: true });
  assert.deepEqual(raised[1], { at: 3000, w: 1500, sill: 450, h: 1500 });
  assert.equal(raised[2].sill, 0);
  assert.equal(raised[2].h, 3150);
});

test("条基轴线含外墙与承重墙，虚拟墙和隔墙不入模", () => {
  const segments = foundationSegments({
    exterior: [{ a: [0, 0], b: [4000, 0] }, { a: [0, 0], b: [0, 3000] }],
    partitions: [
      { a: [1000, 0], b: [1000, 3000], role: "bearing" },
      { a: [2000, 0], b: [2000, 3000], role: "partition" },
      { a: [3000, 0], b: [3000, 3000], role: "virtual" },
    ],
  });
  assert.equal(segments.length, 3);
  assert.ok(segments.every(s => s.thickness === 240 || s.thickness > 0));
});

test("凸出门厅生成前沿与两侧地梁，平齐式不生成", () => {
  const projecting = porticoFoundationSegments();
  assert.equal(projecting.length, 3);
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoStyle: "recessed" });
    assert.equal(porticoFoundationSegments().length, 0);
  } finally {
    resetVillaParams();
  }
});

test("地基层高度跟随一层室内抬高，垫层在院坪以下且用水泥材质", () => {
  const thickness = 240;
  const root = buildFoundation(mat, [
    { a: [0, 0], b: [5000, 0], thickness },
  ], 450);
  assert.equal(root.name, "地基");
  assert.equal(root.userData.foundationMode, "strip");
  const bounds = new THREE.Box3().setFromObject(root);
  assert.ok(Math.abs(bounds.max.y - 450) < 1);
  assert.ok(Math.abs(bounds.min.y + FOUNDATION_FOOTING_DEPTH) < 1);
  // 单段地梁外皮止于墙厚外缘，端头不外挑。
  assert.ok(Math.abs(bounds.max.z - thickness / 2) < 1);
  assert.ok(Math.abs(bounds.min.z + thickness / 2) < 1);
  assert.ok(Math.abs(bounds.min.x) < 1);
  assert.ok(Math.abs(bounds.max.x - 5000) < 1);
  assert.equal(root.getObjectByName("条基转角"), undefined);
  const stem = root.getObjectByName("条基地梁") as THREE.Mesh;
  const pad = root.getObjectByName("条基垫层") as THREE.Mesh;
  assert.equal(stem.material, mat.british, "抬高层用英国棕勒脚色");
  assert.equal(pad.material, mat.concrete, "埋深垫层仍为水泥灰");
});

test("垂直梁转角外角填实，且外围不外挑", () => {
  const thickness = 240;
  const rise = 450;
  const root = buildFoundation(mat, [
    { a: [0, 0], b: [5000, 0], thickness },
    { a: [0, 0], b: [0, 4000], thickness },
    { a: [5000, 0], b: [5000, 4000], thickness },
    { a: [0, 4000], b: [5000, 4000], thickness },
  ], rise);
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root);
  assert.ok(Math.abs(bounds.min.x + thickness / 2) < 1, "西侧外皮不外挑");
  assert.ok(Math.abs(bounds.max.x - (5000 + thickness / 2)) < 1, "东侧外皮不外挑");
  assert.ok(Math.abs(bounds.min.z + thickness / 2) < 1, "前侧外皮不外挑");
  assert.ok(Math.abs(bounds.max.z - (4000 + thickness / 2)) < 1, "后侧外皮不外挑");
  // 外角缺口中心：相对轴线交点向外偏四分之一墙厚。
  const samples: [number, number][] = [
    [-thickness / 4, -thickness / 4],
    [5000 + thickness / 4, -thickness / 4],
    [-thickness / 4, 4000 + thickness / 4],
    [5000 + thickness / 4, 4000 + thickness / 4],
  ];
  for (const [x, z] of samples) {
    const hit = new THREE.Raycaster(
      new THREE.Vector3(x, rise + 100, z),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(root, true);
    assert.ok(hit.length > 0, `转角 (${x},${z}) 应被填实`);
  }
  assert.ok(root.getObjectByName("条基转角"));
  assert.ok(root.getObjectByName("条基转角垫层"));
});

test("主辅楼分设地基，门厅地梁并入主楼地基，拆分可分开观察", () => {
  const draft = clonePublishedLayout();
  const model = buildVilla(mat, false, DEFAULT_VILLA_PARAMS.roofFenShui, "floating", villaLayoutFromDraft(draft));
  assert.ok(model.foundation.children.length > 0);
  assert.ok(model.annexFoundation.children.length > 0);
  assert.equal(model.foundation.name, "地基");
  assert.equal(model.annexFoundation.name, "辅楼地基");
  const mainBounds = new THREE.Box3().setFromObject(model.foundation);
  assert.ok(mainBounds.min.z < site.main.z - 100, "门厅外伸段地梁应向前伸出主楼前墙");
  assert.ok(Math.abs(mainBounds.max.y - site.entranceRise) < 1);

  const explosion = new AssemblyExplosion(model, floors.map(f => f.name), false);
  assert.ok(explosion.parts.some(p => p.name === "地基"));
  assert.ok(explosion.parts.some(p => p.name === "辅楼地基"));
  explosion.apply(1);
  assert.equal(model.foundation.position.y, 0);
  assert.equal(model.annexFoundation.position.y, 0);
  assert.ok(model.levels[0].position.y > 2000);
  assert.ok(model.annex.position.y > 2000);
  explosion.dispose();

  draft.floors[0].partitions.push({
    a: [9000, 3000],
    b: [12000, 3000],
    role: "bearing",
  });
  const next = buildVilla(mat, false, DEFAULT_VILLA_PARAMS.roofFenShui, "floating", villaLayoutFromDraft(draft), model);
  assert.ok(next.foundation.children.length > model.foundation.children.length);
  assert.notEqual(next.foundation, model.foundation);
});

test("抬高参数变化时地基层高度联动；结构楼板为120厚水泥色", () => {
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, entranceRise: 600 });
    const model = buildVilla(mat, false);
    const foundation = new THREE.Box3().setFromObject(model.foundation);
    assert.ok(Math.abs(foundation.max.y - 600) < 1);
    for (const [root, name] of [
      [model.levels[0], "一楼楼板"],
      [model.levels[1], "二楼楼板"],
      [model.levels[2], "三楼楼板"],
      [model.annex, "辅楼一楼楼板"],
    ] as const) {
      const mesh = root.getObjectByName(name)! as THREE.Mesh;
      const box = new THREE.Box3().setFromObject(mesh);
      assert.ok(Math.abs(box.max.y - box.min.y - 120) < 1, name);
      assert.equal(mesh.material, mat.concrete, name);
    }
  } finally {
    resetVillaParams();
  }
});
