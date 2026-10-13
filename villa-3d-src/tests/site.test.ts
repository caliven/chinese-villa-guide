import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { site, frontFieldLevel } from "../src/data";
import { buildContextGround, buildRoad } from "../src/site-ground";
import { buildSurroundingHouses, makeRamp, buildCourtyard } from "../src/terrain";
import { surroundings as c, forestTrees } from "../src/surroundings";
import type { Mats } from "../src/primitives";

const mats = Object.fromEntries(
  [
    "wall",
    "trim",
    "stone",
    "paving",
    "roof",
    "dark",
    "wood",
    "grass",
    "soil",
    "metal",
    "glass",
    "inside",
    "floor",
    "fabric",
    "foliage",
    "trunk",
    "gold",
  ].map((key) => [key, new THREE.MeshStandardMaterial()]),
) as Mats;
const ground = buildContextGround(mats);
ground.updateMatrixWorld(true);
function hits(root: THREE.Object3D, x: number, z: number) {
  root.updateMatrixWorld(true);
  return new THREE.Raycaster(
    new THREE.Vector3(x, 50, z),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(root, true).filter(hit => hit.object instanceof THREE.Mesh);
}

test("道路在邻居木房左墙外且只有一层路面，地形不穿过道路", () => {
  const road = buildRoad(mats);
  assert.equal(c.road.x, c.sideHouse.x + c.sideHouse.w);
  for (const z of [-27.1, -24.7, -17.3, -12.4, -7.5, -4.3, 3.7, 12.7, 17.1]) {
    for (const offset of [0.47, 1.91, 2.81]) {
      const x = c.road.x + offset;
      assert.equal(hits(road, x, z).length, 1, `路面重叠或缺口 @ ${x},${z}`);
      assert.equal(hits(ground, x, z).length, 0, `地形侵入道路 @ ${x},${z}`);
    }
  }
});

test("坡长调整后仍接到左侧道路，坡道与接入段不叠面", () => {
  for (const length of [3, 5, 10]) {
    const ramp = makeRamp(new THREE.Group(), mats, -2, length);
    for (const x of [21.45, 23.8, 26.37, 29.67, 33.4]) {
      const h = hits(ramp, x, -7.57);
      assert.equal(h.length, 1, `接入断开或重叠 @ ${x},坡长${length}`);
      assert.equal(hits(ground, x, -7.57).length, 0, `原地形挡住接入段 @ ${x}`);
      const expected =
        site.garageFloor +
        Math.min(1, (x - site.width) / length) * (-2 - site.garageFloor);
      assert.ok(Math.abs(h[0].point.y - expected) < 1e-5);
    }
  }
});

test("辅楼右侧为两级田，后方木房落在第二田，左侧高地高于院坪", () => {
  const top = hits(ground, -0.31, 8.2)[0].point.y;
  const low = hits(ground, -0.31, 2.1)[0].point.y;
  assert.ok(Math.abs(top) < 1e-5);
  assert.ok(Math.abs(low - site.garageFloor) < 1e-5);
  assert.equal(hits(ground, 12.12, 12.7)[0].point.y, 2.5);
  assert.equal(hits(ground, 20.12, 21.7)[0].point.y, c.rearHouse.y);
  assert.ok(hits(ground, 40.12, -3.7)[0].point.y > 0);
  const houses = buildSurroundingHouses(mats);
  const sideBody = houses.getObjectByName("左侧邻居木房")!.children[0];
  const rearBody = houses.getObjectByName("后方第二层梯田木房")!.children[0];
  const sideBounds = new THREE.Box3().setFromObject(sideBody);
  const rearBounds = new THREE.Box3().setFromObject(rearBody);
  assert.ok(Math.abs(sideBounds.max.x - rearBounds.max.x) < 1e-5);
  assert.ok(
    Math.abs(rearBounds.min.x - (site.main.x + site.main.w / 2)) < 1e-5,
  );
  assert.ok(Math.abs(rearBounds.min.y - c.rearSecond.y) < 1e-5);
  assert.equal(c.frontHouse.floors, 2);
  assert.equal(c.frontHouse.x + c.frontHouse.w, sideBounds.max.x);
  assert.equal(c.frontHouse.x, site.main.x + (site.main.w * 2) / 3);
  assert.equal(c.neighborYard.x + c.neighborYard.w, sideBounds.max.x);
});

test("树干与树冠都在后方木房之后，两侧田地不再生成树木", () => {
  const trees = forestTrees();
  assert.ok(trees.length > 0);
  assert.ok(trees.every((t) => t.z >= c.forestStart));
  assert.ok(trees.every((t) => t.z - t.r * 2 > c.rearHouse.z + c.rearHouse.d));
});

test("院坪原楼梯洞已填平，辅楼前与右侧通道接到同高梯田", () => {
  const deck = buildCourtyard(mats);
  for (const z of [-4.8, -3.2, -1.4])
    assert.ok(Math.abs(hits(deck, 11, z)[0].point.y) < 1e-5);
  const clear = (a: THREE.Vector3, b: THREE.Vector3) => {
    const direction = b.clone().sub(a);
    const ray = new THREE.Raycaster(a, direction.clone().normalize(), 0, direction.length());
    assert.equal(ray.intersectObject(deck, true).length, 0, "人行通道被护栏封住");
  };
  clear(new THREE.Vector3(5.25, 1, -2), new THREE.Vector3(.48, 1, -2));
  clear(new THREE.Vector3(.48, 1, -2), new THREE.Vector3(.48, 1, 7));
  clear(new THREE.Vector3(.48, 1, 7), new THREE.Vector3(-.5, 1, 7));
  assert.ok(Math.abs(hits(ground, -.5, 7)[0].point.y) < 1e-5);
  assert.ok(Math.abs(site.annex.z - site.field.at(-1)![1] - 2.1) < 1e-5);
});

test("地库前第一田低2米，前方两层砖房所在台地再低1.5米", () => {
  const first = hits(ground, 10, -9.5)[0].point.y;
  const second = hits(ground, 10, -16.5)[0].point.y;
  assert.ok(Math.abs(site.garageFloor - first - 2) < 1e-5);
  assert.ok(Math.abs(first - second - 1.5) < 1e-5);
  assert.ok(Math.abs(first - frontFieldLevel) < 1e-5);
  assert.ok(Math.abs(second - c.frontHouse.y) < 1e-5);
});
