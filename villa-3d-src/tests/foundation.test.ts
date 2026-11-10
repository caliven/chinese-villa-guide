import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { AssemblyExplosion } from "../src/assembly-explosion";
import { batchScene } from "../src/render-geometry";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture";
import { construction, floors, site } from "../src/data";
import { cornerPedestalTop } from "../src/entrance-carvings";
import {
  FOUNDATION_FOOTING_DEPTH,
  PLINTH_CORNER_INSET,
  buildFoundation,
  exteriorPlinthBand,
  firstFloorPlinthTop,
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

test("勒脚四向转角斜接封闭，合批前后近角射线无拼接孔", () => {
  const root = new THREE.Group();
  const points: [number, number][] = [[0, 0], [2000, 0], [2000, 2000], [0, 2000]];
  exteriorPlinthBand(root, points.map((a, i) => ({ a, b: points[(i + 1) % 4] })),
    450, 650, [1000, 1000], mat.british);
  for (const batched of [false, true]) {
    if (batched) batchScene(root);
    root.updateMatrixWorld(true);
    for (const [x, z] of points) for (const offset of [131, 139, 147]) {
      const sx = x === 0 ? -1 : 1, sz = z === 0 ? -1 : 1;
      const ray = new THREE.Raycaster(new THREE.Vector3(x + sx * 1000, 550, z + sz * offset),
        new THREE.Vector3(-sx, 0, 0));
      assert.ok(ray.intersectObject(root, true).length, `转角 ${x},${z} 距轴线 ${offset} 应封闭`);
    }
  }
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
      assert.deepEqual(mesh.material, name === "三楼楼板" ? [mat.concrete, mat.british] : mat.concrete, name);
    }
  } finally {
    resetVillaParams();
  }
});

test("一层勒脚与四根包角柱脚方座同为英国棕且顶齐平", () => {
  const model = buildVilla(mat, false);
  const plinthTop = firstFloorPlinthTop();
  assert.equal(plinthTop, cornerPedestalTop(undefined, site.entranceRise));
  assert.ok(plinthTop > site.entranceRise, "勒脚顶应高于地基抬高层");
  const band = model.levels[0].getObjectByName("外墙英国棕勒脚");
  assert.ok(band, "主楼一层应有外墙勒脚带");
  const bandBox = new THREE.Box3().setFromObject(band!);
  assert.ok(Math.abs(bandBox.max.y - plinthTop) < 2, "勒脚顶对齐包角柱脚");
  assert.ok(Math.abs(bandBox.min.y - site.entranceRise) < 2, "勒脚从室内抬高起接");
  assert.equal(model.annex.getObjectByName("外墙英国棕勒脚"), undefined, "辅楼墙面不设英国棕勒脚");
  let annexBeamCount = 0;
  model.annexFoundation.traverse(obj => {
    if (!(obj instanceof THREE.Mesh) || obj.material !== mat.british) return;
    annexBeamCount++;
    assert.ok(new THREE.Box3().setFromObject(obj).max.y <= site.entranceRise, "辅楼英国棕仅到地基梁顶");
  });
  assert.ok(annexBeamCount > 0, "辅楼地基梁保留英国棕");
  // 勒脚须接到转角附近，禁止墙厚级内收在包角柱旁露白麻。
  assert.ok(PLINTH_CORNER_INSET < construction.outsideWall * 0.2, "转角内收不得接近墙厚");
  for (const [root, label] of [[model.levels[0], "主楼"]] as const) {
    const plinth = root.getObjectByName("外墙英国棕勒脚");
    assert.ok(plinth, `${label}须有勒脚`);
    const pieces = plinth!.children.filter(c => c instanceof THREE.Mesh);
    assert.ok(pieces.length >= 3, `${label}勒脚应覆盖多面外墙`);
  }
  const corners = model.facadeColumns.children.filter(o => o.name === "包角柱");
  assert.equal(corners.length, 4);
  for (const col of corners) {
    let britishBase = false;
    col.updateWorldMatrix(true, true);
    col.traverse(obj => {
      if (!(obj instanceof THREE.Mesh) || obj.material !== mat.british) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (box.min.y < plinthTop * 0.45 && box.max.y > plinthTop * 0.25) britishBase = true;
    });
    assert.ok(britishBase, "包角柱脚方座应为英国棕");
    // 前包角三联双心：花板居中且明显小于方座，侧面原点对齐 L 形外皮中心。
    const plinthDecor = col.getObjectByName("包角柱柱脚三联双心纹");
    if (plinthDecor) {
      const local = new THREE.Box3().setFromObject(plinthDecor);
      const mid = (local.min.y + local.max.y) / 2;
      const h = local.max.y - local.min.y;
      assert.ok(Math.abs(mid - plinthTop / 2) < 40, "柱脚花纹应在方座截面垂直居中");
      // 与门厅柱脚 min(span-180,440*s)／760*s ≈ 0.58 同口径，略小于方座。
      assert.ok(h > plinthTop * 0.5 && h < plinthTop * 0.7, "方花板比例应对齐门厅柱脚");
    }
    const side = col.getObjectByName("包角柱侧面");
    if (side) {
      const project = 150, leg = 500;
      assert.ok(Math.abs(side.position.z - (leg - project) / 2) < 1, "侧面花纹应在截面居中");
    }
  }
});


test("门厅后主楼地基内部保留实体基层，拆分时留原位且合拢贴住楼板底", () => {
  const model = buildVilla(mat, false);
  const fill = model.foundation.getObjectByName("主楼地基内部实体基层");
  assert.ok(fill);
  const before = new THREE.Box3().setFromObject(fill);
  assert.ok(before.min.y > 0);
  assert.equal(before.max.y, site.entranceRise - construction.floorSlab);
  const x = site.main.x + site.main.w / 2;
  const z = site.main.z + construction.outsideWall + 400;
  const hits = new THREE.Raycaster(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0)).intersectObject(fill, true);
  assert.ok(hits.length, "前墙内侧原镂空处必须有实体顶面");
  const explosion = new AssemblyExplosion(model, floors.map(f => f.name), false);
  explosion.apply(1);
  const after = new THREE.Box3().setFromObject(fill);
  assert.ok(after.equals(before), "实体基层应随地基留原位");
  explosion.dispose();
});
