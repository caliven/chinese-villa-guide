import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { parseLayoutVersionDocument } from "../src/data-versions.ts";
import { bedroomSummary } from "../src/design-data.ts";
import { fitStairToRoom, stairShape } from "../src/stair-geometry.ts";
import { furnish, stairSoffitClearHeight, type Mats } from "../src/primitives.ts";
import { planSourceFromDraft } from "../src/plan.ts";
import { resolveLayoutFacades } from "../src/facade-layout.ts";
import { interiorRailingLayout } from "../src/interior-railing.ts";
import { furniturePositionIsClear } from "../src/furniture-placement.ts";

const load = () => parseLayoutVersionDocument(JSON.parse(readFileSync(new URL("../data/户型/户型-20261023-210731.json", import.meta.url), "utf8"))).layoutDraft;

test("当前确认房名的用途统计为2／3／2间卧室", () => {
  const draft = load();
  assert.deepEqual(draft.floors.map((f, i) => bedroomSummary(i, f.rooms)), ["2间卧室", "3间卧室", "2间卧室"]);
  assert.ok(draft.floors.flatMap(f => f.rooms).filter(r => /卫/.test(r.name)).every(r => r.kind === "bath"));
  assert.ok(draft.floors.flatMap(f => f.rooms).filter(r => /衣帽/.test(r.name)).every(r => r.kind === "store"));
});

test("450低窗内防护与平面和完整三维共用，挑空处不放悬空栏杆", () => {
  const draft = load(), source = planSourceFromDraft(draft, 1);
  const stair = fitStairToRoom(draft.stairLayout, draft.floors);
  const facades = resolveLayoutFacades(draft).facades;
  const layout = interiorRailingLayout(draft.floors, stair, draft.livingVoid, facades, true);
  const guards = source.entryGuards!;
  assert.equal(guards.length, 2, "通高入口上窗及北面东侧低窗各有防护");
  assert.equal(layout.windowGuards[1].length, guards.length);
  assert.ok(guards.some(([a, b]) => (a[0] + b[0]) / 2 > 17000 && a[1] < 1000));
  assert.ok(guards.every(([a, b]) => Math.min(a[0], b[0]) > 11500), "不在客厅挑空中放防护");
});

test("家政洗烘叠放有真实标高和托板，操作区净高至少2100且避开门及起步", () => {
  const draft = load(), f = draft.floors[0];
  const washer = f.furniture.find(item => item.kind === "fp-washer")!;
  const dryer = f.furniture.find(item => item.kind === "fp-dryer")!;
  assert.equal(dryer.mountHeight, 870);
  assert.equal(washer.x, dryer.x); assert.equal(washer.z, dryer.z);
  assert.equal(washer.rotation, -Math.PI / 2);
  assert.equal(f.furniture.filter(item => item.kind === "fp-vanity").length, 2, "公卫及内卫台盆保留，取消梯下重复台盆");
  const stair = fitStairToRoom(draft.stairLayout, draft.floors), shape = stairShape(stair);
  const door = f.partitions.find(part => part.id === "wall-17")!.door!;
  assert.ok(washer.z - 300 > 6000 + door.offset + door.width + 100);
  assert.ok(washer.x + 300 + 600 < shape.lower.x);
  for (const x of [washer.x - 300, washer.x + 300, washer.x + 900]) {
    for (const z of [washer.z - 300, washer.z, washer.z + 300]) {
      const height = stairSoffitClearHeight(x, z, stair, f.height - 450);
      assert.ok(height !== null && height >= 2100, `操作区${x},${z}净高${height}`);
    }
  }
  assert.ok(furniturePositionIsClear(washer, f.partitions, [washer, dryer]));
  assert.ok(furniturePositionIsClear(dryer, f.partitions, [washer, dryer]));
  const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; } });
  const root = new THREE.Group();
  const lower = furnish(root, washer, 450, mat), upper = furnish(root, dryer, 450, mat);
  root.updateWorldMatrix(true, true);
  const lowBounds = new THREE.Box3().setFromObject(lower), upperBounds = new THREE.Box3().setFromObject(upper);
  assert.ok(Math.abs(lowBounds.max.y - 1300) < .01);
  assert.ok(Math.abs(upperBounds.min.y - lowBounds.max.y) < .01, "叠放托板接触洗衣机顶");
  assert.ok(upperBounds.max.y < 450 + 2100);
  assert.ok(upper.getObjectByName("洗烘叠放连接托板"));
  Object.values(mat).forEach(material => material.dispose());
});
