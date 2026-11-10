import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { modelSection } from "../src/section-plan.ts";
import { orthogonalFloorGeometry } from "../src/floor-geometry.ts";

test("剖面保留连续外伸露台、板厚与洞口，不用包围盒补洞", () => {
  const outline: [number, number][] = [[0, -3000], [5000, -3000], [5000, 10000], [0, 10000]];
  const hole: [number, number][] = [[1000, 5000], [3000, 5000], [3000, 8000], [1000, 8000]];
  const mesh = new THREE.Mesh(orthogonalFloorGeometry([outline], [hole], 7200, 120, true));
  const cut = modelSection(mesh, { axis: "x", at: 2000.123, category: () => "solid" });
  const paths = cut[0].paths;
  assert.equal(paths.length, 2);
  const spans = paths.map(points => [Math.min(...points.map(p => p[0])), Math.max(...points.map(p => p[0]))]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(spans, [[-3000, 5000], [8000, 10000]]);
  assert.ok(paths.every(points => Math.min(...points.map(p => p[1])) === -7200 && Math.max(...points.map(p => p[1])) === -7080));
  assert.ok(paths.every(points => JSON.stringify(points[0]) === JSON.stringify(points.at(-1))));
});

test("剖面遵循隐藏组及实例位姿，不把未剖到的瓦片画到原点", () => {
  const root = new THREE.Group();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial(), 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1000, 2000, 3000));
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(5000, 2000, 3000));
  root.add(mesh);
  const hidden = new THREE.Group(); hidden.visible = false;
  hidden.add(new THREE.Mesh(new THREE.BoxGeometry(10000, 10000, 10000))); root.add(hidden);
  const contours = modelSection(root, { axis: "x", at: 1000.123, category: () => "roof" });
  assert.equal(contours.length, 1);
  assert.equal(contours[0].paths.length, 1);
  assert.deepEqual([...new Set(contours[0].paths[0].map(p => p[0]))].filter(z => z === 2950 || z === 3050).sort(), [2950, 3050]);
});
