import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { stairModelDefaults } from "../src/stair-geometry.ts";
import { stairRailingSections } from "../src/stair-railing.ts";
import { railingNetwork, type RailingSection } from "../src/railing-network.ts";
import type { RailingStyle } from "../src/railing-options.ts";

const styles: RailingStyle[] = ["wood", "steel", "glass", "marble"];

function checkBottomClearance(section: RailingSection, root: THREE.Object3D) {
  const length = Math.hypot(section.b.x - section.a.x, section.b.z - section.a.z);
  const support = (x: number) => section.footing!.filter(point => point.t <= x / length + 1e-8).at(-1)!.y;
  const panels: THREE.Mesh[] = [];
  root.traverse(object => {
    if (object instanceof THREE.Mesh && ["下横档", "石质下横梁", "独立玻璃片"].includes(object.name)) panels.push(object);
  });
  assert.ok(panels.length > 0, "各造型均有随踏步下落的防护下沿");
  const stops = [0, ...section.footing!.map(point => point.t * length).filter(x => x > 0 && x < length), length];
  const direction = section.b.clone().sub(section.a).setY(0).normalize();
  let checked = 0;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i] - stops[i - 1] < 1) continue;
    let hitsInInterval = 0;
    for (const fraction of [.1, .2, .3, .4, .5, .6, .7, .8, .9]) {
      const x = stops[i - 1] + (stops[i] - stops[i - 1]) * fraction;
      const foot = support(x);
      const origin = section.a.clone().addScaledVector(direction, x).setY(foot + 1);
      const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, 1, 0));
      const first = ray.intersectObjects(panels, false)[0];
      // 玻璃与立柱之间保留接缝，此处只测量实际面板的下沿。
      if (!first) continue;
      const gap = first.point.y - foot;
      assert.ok(gap >= 49.99 && gap <= 50.01, `${section.style} 下沿离踏步 ${gap}，应为50`);
      assert.ok(gap <= 110, "梯段底部净空不超过110");
      checked++;
      hitsInInterval++;
    }
    const endJoint = section.style === "glass" && (stops[i - 1] === 0 || stops[i] === length) && stops[i] - stops[i - 1] <= 110;
    assert.ok(hitsInInterval > 0 || endJoint, `${section.style} 每段踏步支承范围均有下沿防护 ${stops[i - 1]}..${stops[i]} / ${length}`);
  }
  assert.ok(checked > 0);
}

function dispose(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  materials.forEach(material => material.dispose());
}

test("双跑三跑、双轴、正反方向及四种造型的下沿随实际踏步起落", () => {
  const draft = clonePublishedLayout();
  for (const model of ["double", "triple"] as const) for (const axis of ["x", "z"] as const)
    for (const direction of ["positive", "negative"] as const) for (const lowerSide of ["min", "max"] as const) for (const style of styles) {
      const stair = { ...stairModelDefaults(draft.stairLayout, model, draft.floors), axis, direction, lowerSide, risers: 21 };
      const sections = stairRailingSections(stair, 450, 3150, style);
      const root = new THREE.Group();
      const rails = railingNetwork(sections).render(root);
      root.updateWorldMatrix(true, true);
      sections.forEach((section, index) => {
        if (section.footing) checkBottomClearance(section, rails[index]);
      });
      dispose(root);
    }
});

test("当前西南楼梯二层下跑的大开口收敛到踏步上50", () => {
  const draft = clonePublishedLayout();
  const stair = { ...draft.stairLayout, model: "double" as const, axis: "z" as const, direction: "positive" as const,
    x: 8660, z: 5500, flight: 1270, gap: 180, landing: 1200, tread: 266, risers: 21, lowerSide: "max" as const };
  const sections = stairRailingSections(stair, 3600, 3600, "wood");
  const root = new THREE.Group();
  const rails = railingNetwork(sections).render(root);
  root.updateWorldMatrix(true, true);
  checkBottomClearance(sections[0], rails[0]);
  checkBottomClearance(sections[1], rails[1]);
  dispose(root);
});
