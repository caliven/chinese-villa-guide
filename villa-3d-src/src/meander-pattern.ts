import * as THREE from "three";
import type { Point } from "./data.ts";

// 等宽单线回纹的完整笔画轮廓，按七等分网格构成方折回旋。
// 相邻笔画间留同宽净空，端头平收，避免逐段盒子重叠或只画半截回折。
const singleMeander: Point[] = [
  [-3.5, -3], [-3.5, 3.5], [3.5, 3.5], [3.5, -3.5],
  [-1.5, -3.5], [-1.5, 1.5], [1.5, 1.5], [1.5, -1],
  [.5, -1], [.5, .5], [-.5, .5], [-.5, -2.5],
  [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5], [-2.5, -3],
];

/** 原点为纹带中心，正反单回纹等距排布，单元保持方形，两端等距留边。 */
export function meanderBandOutlines(width: number, height: number): Point[][] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const count = Math.max(1, Math.floor(width / (height * 1.25)));
  const pitch = width / count;
  const size = Math.min(height, pitch * .82);
  return Array.from({ length: count }, (_, i) => {
    const center = -width / 2 + (i + .5) * pitch;
    const direction = i % 2 === 0 ? 1 : -1;
    const points = singleMeander.map(([x, y]): Point => [center + direction * x * size / 7, y * size / 7]);
    return direction < 0 ? points.reverse() : points;
  });
}

/** 局部−Z朝外，front为笔画外表面，实体向基层方向挤出。 */
export function addMeanderBand(parent: THREE.Object3D, x: number, y: number, front: number,
  width: number, height: number, material: THREE.Material, depth = 12) {
  const outlines = meanderBandOutlines(width, height);
  if (!outlines.length) return;
  const shapes = outlines.map(points => new THREE.Shape(points.map(point => new THREE.Vector2(...point))));
  const bevel = Math.min(.8, height / 200, depth / 5);
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth, steps: 1, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "正反单回纹完整纹带";
  mesh.position.set(x, y, front);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
