import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildVilla, mainRoofFootprint, floatingHatLayout, joinedHatLayout, floatingHatTrimGap } from "../src/architecture";
import { construction, floors, frontElevation, site } from "../src/data";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params";
import { fasciaBottomY, frontApronSection } from "../src/roof-options";
import { elevationShell } from "../src/elevation-plan";
import { floatingHatJunctions } from "../src/hat-junctions";
import { hatSupportInset } from "../src/facade-details";
import type { Mats } from "../src/primitives";

const mat = new Proxy({} as Mats, {
  get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide }) as never; },
});
test.afterEach(resetVillaParams);
test.after(() => Object.values(mat).forEach(m => m.dispose()));
const bounds = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
const dispose = (g: THREE.Object3D) => g.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });

test("左右侧下沿线露出墙外并直达瓦檐南端，不再被包角柱颈隔断", () => {
  for (const thirdFloorMode of ["setback", "flush"] as const) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, thirdFloorMode, cornerProject: 250 });
    const villa = buildVilla(mat, false);
    try {
      villa.group.updateMatrixWorld(true);
      const apron = villa.levels[2].getObjectByName("三楼栏杆下飘檐")!;
      const fascia = apron.getObjectByName("连续转角下沿线")!;
      const board = apron.getObjectByName("无天沟连续挑檐板")!;
      const section = frontApronSection(floors[2].y + frontElevation.eaveParapet, frontElevation.tiledEaveDrop);
      assert.equal(villa.portico.getObjectByName("包角柱退进承托柱颈"), undefined);
      for (const [index, outward, wallX] of [[0, -1, site.main.x], [6, 1, site.main.x + site.main.w]]) {
        const strip = fascia.children[index], b = bounds(strip);
        assert.ok(Math.abs(b.max.z - bounds(board).max.z) < .1, "侧线南端须与上方瓦檐板齐平");
        assert.ok(outward < 0 ? b.min.x < wallX - construction.outsideWall / 2 : b.max.x > wallX + construction.outsideWall / 2,
          "侧下沿线不能藏在侧墙实体内");
        for (const z of [b.max.z - 20, (b.min.z + b.max.z) / 2]) {
          const origin = new THREE.Vector3(wallX + outward * 3000, (section.fasciaTopY + section.fasciaBottomY) / 2, z);
          const hit = new THREE.Raycaster(origin, new THREE.Vector3(-outward, 0, 0)).intersectObject(villa.group, true)[0];
          assert.ok(hit && hit.object.parent === fascia, "从侧面看到的第一层须为连续下沿线");
        }
      }
    } finally { dispose(villa.group); }
  }
});

test("门厅外展斜肩填满柱帽至下沿线的空档，原有雕花仍完整", () => {
  for (const porticoColumnSize of [600, 900]) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoColumnSize });
    const villa = buildVilla(mat, false);
    try {
      villa.group.updateMatrixWorld(true);
      const section = frontApronSection(floors[2].y + frontElevation.eaveParapet, frontElevation.tiledEaveDrop);
      const columns = villa.portico.children.filter(o => o.name === "参考图通高门厅雕花柱");
      const shoulders = villa.portico.children.filter(o => o.name === "门厅柱外展斜肩");
      assert.equal(shoulders.length, 2);
      columns.forEach((column, i) => {
        assert.ok(column.getObjectByName("圆形几何团寿浮雕"));
        assert.ok(column.getObjectByName("深底双心折线纹带"));
        assert.ok(column.getObjectByName("柱身上端卷草垂花浮雕"));
        const b = bounds(shoulders[i]);
        assert.ok(Math.abs(b.min.y - bounds(column).max.y) < .1);
        assert.ok(Math.abs(b.max.y - section.fasciaBottomY) < .1);
        assert.ok(b.getSize(new THREE.Vector3()).x > bounds(column).getSize(new THREE.Vector3()).x);
        const x = column.position.x, z = column.position.z;
        for (const t of [.1, .5, .9]) {
          const y = b.min.y + t * (b.max.y - b.min.y);
          assert.ok(new THREE.Raycaster(new THREE.Vector3(x, y, z - 2000), new THREE.Vector3(0, 0, 1))
            .intersectObject(shoulders[i], true).length > 0, "外展斜肩应为连续实体，不能仅有顶盖");
        }
      });
    } finally { dispose(villa.group); }
  }
});

test("三楼包角及两种官帽的柱冠止于对应下沿线，立面与三维共用斜肩轮廓", () => {
  for (const style of ["joined", "floating"] as const) {
    const villa = buildVilla(mat, false, 4.5, style);
    try {
      villa.group.updateMatrixWorld(true);
      const corners = villa.levels[2].children.filter(o => o.name === "三楼包角柱");
      assert.equal(corners.length, 2);
      for (const c of corners) {
        assert.equal(c.position.z, floors[2].front);
        assert.ok(Math.abs(bounds(c).max.y - fasciaBottomY(mainRoofFootprint().eave, 0)) < .1);
        for (const name of ["圆形几何团寿浮雕", "包角柱深底回纹带", "包角柱单黑线柱身", "下段回折卷草花板"])
          assert.ok(c.getObjectByName(name), `三楼包角柱保留同系列${name}`);
      }
      const h = style === "floating" ? floatingHatLayout(4.5) : joinedHatLayout(4.5);
      for (const pier of villa.levels[2].getObjectByName("三楼官帽柱")!.children) {
        assert.ok(pier.getObjectByName("官帽柱外展斜肩"));
        assert.ok(Math.abs(bounds(pier).max.y - fasciaBottomY(h.eave, 0)) < .1);
      }
      for (const view of ["north", "east", "west"] as const) {
        const surfaces = elevationShell(view, style).surfaces.filter(s => s.part === "column-shoulder");
        assert.ok(surfaces.length > 20, "立面须包含门厅、包角及官帽柱的外展斜肩");
        assert.ok(surfaces.flatMap(s => s.points).every(p => Number.isFinite(p.x + p.y + p.z)));
      }
    } finally { dispose(villa.group); }
  }
});

test("悬浮官帽的两端有连续实体转接梁，接柱冠、正屋旧檐端头及墙顶，排托不穿入", () => {
  for (const thirdFloorMode of ["setback", "flush"] as const) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, thirdFloorMode });
    const villa = buildVilla(mat, false, 4.5, "floating");
    try {
      villa.group.updateMatrixWorld(true);
      const meshes: THREE.Object3D[] = [], corbels: THREE.Object3D[] = [];
      villa.group.traverse(o => {
        if (o.name === "悬浮官帽柱顶封闭转接梁") meshes.push(o);
        if (o.name === "梁托") corbels.push(o);
      });
      assert.equal(meshes.length, 2);
      const h = floatingHatLayout(4.5), m = mainRoofFootprint();
      const joints = floatingHatJunctions(h.z, h.eave, m.eave, floors[2].front, hatSupportInset());
      const gap = floatingHatTrimGap();
      assert.equal(joints[0].x, gap[0]);
      assert.equal(joints[1].x + joints[1].width, gap[1]);
      for (const [i, mesh] of meshes.entries()) {
        const j = joints[i], b = bounds(mesh);
        assert.ok(b.max.z >= floors[2].front - .1, "转接梁后端接入正屋墙顶");
        assert.equal(j.width, frontElevation.dividerWidth, "转接梁收在柱身宽度内，不向深色线脚外伸出");
        assert.ok(Math.abs(b.min.y - fasciaBottomY(h.eave, 0)) < .1, "梁底保持水平，不再下垂出斜腋");
        // 柱顶到墙顶之间保持封闭的平底实体。
        for (const z of [frontElevation.postZ, (frontElevation.postZ + floors[2].front) / 2]) {
          const origin = new THREE.Vector3(j.x - 1000, fasciaBottomY(h.eave, 0) + 150, z);
          assert.ok(new THREE.Raycaster(origin, new THREE.Vector3(1, 0, 0)).intersectObject(mesh).length > 0);
        }
        for (const corbel of corbels) {
          const overlap = b.clone().intersect(bounds(corbel)).getSize(new THREE.Vector3());
          assert.ok(overlap.x * overlap.y * overlap.z < 1, "檐下梁托不能穿进转接梁");
        }
      }
      assert.ok(elevationShell("north", "floating").surfaces.some(s => s.part === "hat-junction"));
      assert.ok(elevationShell("east", "floating").surfaces.some(s => s.part === "hat-junction"));
    } finally { dispose(villa.group); }
  }
});
