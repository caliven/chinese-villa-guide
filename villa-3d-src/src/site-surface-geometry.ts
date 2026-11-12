import * as THREE from "three";
import type { Point } from "./data.ts";
import { intersectRoofPolygon } from "./roof-surfaces.ts";

/** 与高度查询共用2m网格及对角线，相邻田块裁切后仍沿同一曲面相接。 */
export function terrainSurfaceGeometry(points: Point[], height: (x: number, z: number) => number, step = 2000) {
  const flat = new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z))));
  flat.rotateX(-Math.PI / 2);
  const source = flat.getAttribute("position"), sourceIndices = flat.getIndex()!;
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [];
  const vertices = new Map<string, number>();
  const vertex = (x: number, z: number) => {
    const key = `${Math.round(x * 10000)},${Math.round(z * 10000)}`;
    const cached = vertices.get(key);
    if (cached != null) return cached;
    const index = positions.length / 3;
    positions.push(x, height(x, z), z);
    uvs.push(x / 30, -z / 30);
    vertices.set(key, index);
    return index;
  };
  for (let i = 0; i < sourceIndices.count; i += 3) {
    const triangle: Point[] = [0, 1, 2].map(offset => {
      const index = sourceIndices.getX(i + offset);
      return [source.getX(index), source.getZ(index)];
    });
    const xs = triangle.map(p => p[0]), zs = triangle.map(p => p[1]);
    for (let x = Math.floor(Math.min(...xs) / step) * step; x < Math.max(...xs); x += step) {
      for (let z = Math.floor(Math.min(...zs) / step) * step; z < Math.max(...zs); z += step) {
        for (const cell of [
          [[x, z], [x + step, z], [x + step, z + step]],
          [[x, z], [x + step, z + step], [x, z + step]],
        ] as Point[][]) {
          const part = intersectRoofPolygon(triangle, cell);
          const ids = part.map(([px, pz]) => vertex(px, pz));
          for (let j = 1; j + 1 < ids.length; j++) indices.push(ids[0], ids[j], ids[j + 1]);
        }
      }
    }
  }
  flat.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

