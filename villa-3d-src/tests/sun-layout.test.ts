import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { floors, site } from "../src/data";
import { facades } from "../src/facades";
import { southWindowProbes } from "../src/design-data";
import { clonePublishedLayout } from "../src/layout-draft";
import { DEFAULT_VILLA_PARAMS, applyVillaParams, resetVillaParams } from "../src/villa-params";
import { VillaViewer, defaultView } from "../src/viewer";

test.afterEach(resetVillaParams);

test("默认南窗探针兼容无草稿及空覆盖，不修改全局或传入草稿", () => {
  resetVillaParams();
  const draft = clonePublishedLayout();
  const before = JSON.stringify({ floors, site, facades: [facades(0), facades(1)], draft });
  const probes = southWindowProbes();
  assert.equal(probes.length, 4);
  assert.deepEqual(southWindowProbes(null), probes);
  assert.deepEqual(southWindowProbes(draft), probes);
  assert.equal(JSON.stringify({ floors, site, facades: [facades(0), facades(1)], draft }), before);
});

test("当前南窗移动、改窗高窗台和房间名即时更新探针，删除及改门后取消采样", () => {
  const draft = clonePublishedLayout();
  const baseline = southWindowProbes(draft);
  const index = draft.exteriorOpenings.findIndex(item => item.floor === 0 && item.facadeIndex === 1 && item.opening.kind === "window" && item.opening.width > 1500);
  assert.ok(index >= 0);
  const opening = draft.exteriorOpenings[index].opening;
  opening.offset += 200;
  opening.height = 1000;
  opening.sill = 1100;
  const x = baseline[0].x + 200;
  const room = draft.floors[0].rooms.find(room => room.kind === "bed" && x >= room.x && x <= room.x + room.w && room.z + room.d >= site.main.z + site.main.d - 250)!;
  assert.ok(room);
  room.name = "调整后的卧室";
  const before = JSON.stringify(draft);
  const probes = southWindowProbes(draft);
  const moved = probes.find(probe => probe.name === "一层调整后的卧室南窗")!;
  assert.ok(moved);
  assert.equal(moved.x, x);
  assert.equal(moved.y, draft.floors[0].y + site.entranceRise + 1100 + 500);
  assert.equal(moved.sampleOffset, 300);
  assert.equal(probes.length, baseline.length);
  assert.equal(JSON.stringify(draft), before, "分析只能读取当前草稿");
  opening.kind = "door";
  assert.equal(southWindowProbes(draft).length, baseline.length - 1);
  draft.exteriorOpenings.splice(index, 1);
  assert.equal(southWindowProbes(draft).length, baseline.length - 1);
  draft.exteriorOpenings = [];
  assert.deepEqual(southWindowProbes(draft), [], "完整管理列表为空时不能重新出现模板窗");
  assert.deepEqual(southWindowProbes(), baseline, "草稿修改不能污染源码默认探针");
});

test("主辅楼镜像时南窗沿实际墙向定位，移动仍同向跟随当前洞口", () => {
  resetVillaParams();
  const originalX = site.main.x;
  const original = southWindowProbes();
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement: "main-west" });
  const mirrored = southWindowProbes();
  assert.equal(mirrored.length, original.length);
  for (const [i, probe] of mirrored.entries()) {
    assert.ok(Math.abs(probe.x - (site.main.x + site.main.w - (original[i].x - originalX))) < 1e-6);
    assert.ok(probe.x > site.main.x && probe.x < site.main.x + site.main.w);
    assert.equal(probe.name, original[i].name);
  }
  const draft = clonePublishedLayout();
  const opening = draft.exteriorOpenings.find(item => item.floor === 0 && item.facadeIndex === 1 && item.opening.width > 1500)!;
  opening.opening.offset += 200;
  const current = southWindowProbes(draft);
  assert.ok(Math.abs(current[0].x - mirrored[0].x + 200) < 1e-6);
});

test("场地查看器日照分析采用当前已重建户型，删除全部南窗后不再输出旧结果", () => {
  const draft = clonePublishedLayout();
  draft.exteriorOpenings = [];
  const state = { ...defaultView, existing: true, roof: false };
  const viewer = {
    state: { ...state }, layoutLive: draft,
    scene: new THREE.Scene(),
    villa: { group: new THREE.Group(), balcony: new THREE.Group() },
    land: { context: new THREE.Group(), fixed: new THREE.Group(), deck: new THREE.Group(), cutOutline: new THREE.Group() },
    setState(next: object) { Object.assign(this.state, next); },
  };
  const rows = VillaViewer.prototype.analyzeSun.call(viewer as unknown as VillaViewer, "2026-10-26");
  assert.deepEqual(rows, []);
  assert.deepEqual(viewer.state, state, "分析完成后恢复原视图");
});
