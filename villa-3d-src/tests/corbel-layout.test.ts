import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { buildVilla } from "../src/architecture";
import { construction, site } from "../src/data";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params";
import type { Mats } from "../src/primitives";

const mat = new Proxy({} as Mats, {
  get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide }) as never; },
});
const saved = JSON.parse(readFileSync(new URL("../public/scheme/current.json", import.meta.url), "utf8")).villaParams;
const dispose = (group: THREE.Object3D) => group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
const bounds = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
const corbelsIn = (group: THREE.Object3D) => {
  const result: THREE.Mesh[] = [];
  group.traverse(o => { if (o instanceof THREE.Mesh && o.name === "梁托") result.push(o); });
  return result;
};
test.afterEach(resetVillaParams);
test.after(() => Object.values(mat).forEach(m => m.dispose()));

test("保存稿门厅短返段按实际中距选数量，700中距不再被ceil压成405", () => {
  for (const [spacing, corner, length, count, gap] of [
    [700, 600, 500, 2, 810],
    [1000, 600, 500, 2, 810],
    [700, 700, 500, 2, 760],
    [700, 600, 650, 2, 660],
    [400, 300, 500, 3, 480],
  ]) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, ...saved, corbelSpacing: spacing, corbelCornerSpacing: corner, corbelLength: length });
    const villa = buildVilla(mat, false);
    try {
      const apron = villa.levels[2].getObjectByName("三楼栏杆下飘檐")!;
      const all = corbelsIn(apron);
      for (const x of [site.portico.x + 8, site.portico.x + site.portico.w - 8]) {
        const row = all.filter(c => Math.abs(c.position.x - x) < .1 && Math.abs(Math.sin(c.rotation.y)) < .1)
          .sort((a, b) => a.position.z - b.position.z);
        assert.equal(row.length, count, `${spacing}/${corner}/${length} 的短返段数量`);
        for (let i = 1; i < row.length; i++) assert.ok(Math.abs(row[i].position.z - row[i - 1].position.z - gap) < .1);
        for (const c of row) {
          c.geometry.computeBoundingBox();
          assert.ok(Math.abs(c.geometry.boundingBox!.getSize(new THREE.Vector3()).x - length) < .1, "梁托长度使用完整参数");
        }
      }
    } finally { dispose(villa.group); }
  }
});

test("二楼两侧梁托竖脚位于真实墙皮外，长梁托及小出檐仍完整容纳", () => {
  for (const [length, eave] of [[500, 800], [650, 800], [500, 600]]) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, ...saved, corbelLength: length, secondFrontEave: eave });
    const villa = buildVilla(mat, false);
    try {
      villa.group.updateMatrixWorld(true);
      const apron = villa.levels[2].getObjectByName("三楼栏杆下飘檐")!;
      const board = bounds(apron.getObjectByName("无天沟连续挑檐板")!);
      for (const [face, sign] of [[site.main.x - construction.outsideWall / 2, -1],
        [site.main.x + site.main.w + construction.outsideWall / 2, 1]]) {
        const row = corbelsIn(apron).filter(c => Math.abs(c.position.x - face + sign * 8) < .1);
        assert.ok(row.length >= 3, "两侧均须有完整梁托排布");
        for (const c of row) {
          const b = bounds(c);
          assert.ok(b.min.x >= board.min.x - .1 && b.max.x <= board.max.x + .1, "完整出挑须落在檐板内");
          // 检查靠墙竖脚的侧面，而非只能看到的远端挑头。
          const origin = new THREE.Vector3(face + sign * 25, c.position.y + 30, c.position.z - 100);
          const hit = new THREE.Raycaster(origin, new THREE.Vector3(0, 0, 1)).intersectObject(villa.group, true)[0];
          assert.equal(hit?.object, c, "靠墙竖脚从外部可见，不能被墙或背梁截掉");
        }
      }
    } finally { dispose(villa.group); }
  }
});
