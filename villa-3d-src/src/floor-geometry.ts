import * as THREE from "three";
import type { Point } from "./data";
import { polygonContainsPoint } from "./room-geometry";

/** 正交轮廓按真实格网铺面，扣挑空／楼梯洞；支持洞口碰到外边界和凹形分区。 */
export function orthogonalFloorGeometry(paths: Point[][], holes: Point[][], y: number, thickness = 0, bottom = false) {
  const xs = [...new Set([...paths, ...holes].flatMap(path => path.map(p => p[0])))].sort((a, b) => a - b);
  const zs = [...new Set([...paths, ...holes].flatMap(path => path.map(p => p[1])))].sort((a, b) => a - b);
  const positions: number[] = [];
  const cells = new Set<string>();
  const filled = (point: Point) => paths.filter(path => polygonContainsPoint(path, point)).length % 2 === 1 && !holes.some(hole => polygonContainsPoint(hole, point));
  const triangle = (...points: number[][]) => positions.push(...points.flat());
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
    if (!filled([(x0 + x1) / 2, (z0 + z1) / 2])) continue;
    cells.add(`${i}:${j}`);
    triangle([x0, y, z0], [x0, y, z1], [x1, y, z1], [x0, y, z0], [x1, y, z1], [x1, y, z0]);
  }
  if (bottom && thickness) for (const key of cells) {
    const [i, j] = key.split(":").map(Number), x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1], by = y - thickness;
    triangle([x0, by, z0], [x1, by, z1], [x0, by, z1], [x0, by, z0], [x1, by, z0], [x1, by, z1]);
  }
  if (thickness) for (const key of cells) {
    const [i, j] = key.split(":").map(Number), x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
    const edges: [number, number, Point, Point][] = [[i - 1, j, [x0, z0], [x0, z1]], [i + 1, j, [x1, z1], [x1, z0]], [i, j - 1, [x1, z0], [x0, z0]], [i, j + 1, [x0, z1], [x1, z1]]];
    for (const [ni, nj, a, b] of edges) if (!cells.has(`${ni}:${nj}`)) triangle([a[0], y, a[1]], [a[0], y - thickness, a[1]], [b[0], y - thickness, b[1]], [a[0], y, a[1]], [b[0], y - thickness, b[1]], [b[0], y, b[1]]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const uvs: number[] = [];
  for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i], -positions[i + 2]);
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

