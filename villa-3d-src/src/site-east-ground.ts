import * as THREE from "three";
import { type Point } from "./data";
import { type Mats } from "./primitives";
import { intersectRoofPolygon, subtractRoofPolygon } from "./roof-surfaces";
import { mountainColor } from "./terrain-horizon";
import { createEasternTerrainSampler, surroundings, villageRoadEdges, northPhotoLayout } from "./surroundings";
import { contourAt } from "./contours";
import { distanceToPhotoPath } from "./photo-context-layout";

/** 东侧按1m共用网格构建土坡及村道，逐三角面裁开路廊。 */
export function buildEasternGround(mat: Mats) {
  const terrain = createEasternTerrainSampler();
  const roadRight = surroundings.road.x + surroundings.road.w;
  const roadPoints = villageRoadEdges.outline;
  const rivers = northPhotoLayout().courses;
  // 平滑路缘含共线采样点，剔除退化三角形，避免零面积裁片重复覆盖整格。
  const roadTriangles = THREE.ShapeUtils.triangulateShape(
    roadPoints.map(([x, z]) => new THREE.Vector2(x, z)), [],
  ).map(indices => {
    const points = indices.map(index => roadPoints[index]);
    return {
      points,
      left: Math.min(...points.map(p => p[0])),
      right: Math.max(...points.map(p => p[0])),
      front: Math.min(...points.map(p => p[1])),
      back: Math.max(...points.map(p => p[1])),
    };
  }).filter(({ points: [a, b, c] }) => Math.abs(
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ) > 0.02);
  const layers = [false, true].map(road => ({
    road,
    positions: [] as number[],
    colors: [] as number[],
    uvs: [] as number[],
    indices: [] as number[],
    vertices: new Map<string, number>(),
  }));
  const add = (polygon: Point[], road: boolean) => {
    const layer = layers[road ? 1 : 0];
    const ids = polygon.map(([x, z]) => {
      const key = `${Math.round(x * 10000)},${Math.round(z * 10000)}`;
      const cached = layer.vertices.get(key);
      if (cached != null) return cached;
      const point = terrain.sample(x, z);
      const height = point.heightMm + (road ? 50 * (1 - point.demWeight) : 0);
      const slope = Math.abs(terrain.sample(x, z + 100).heightMm - terrain.sample(x, z - 100).heightMm) / 200;
      const color = new THREE.Color(0x7b8c50).lerp(new THREE.Color(0x52663d), Math.min(1, slope * 0.6));
      color.lerp(mountainColor(height / 1000, 0), point.demWeight);
      if (z < contourAt(villageRoadEdges.front, x)) for (const river of rivers) {
        const distance = distanceToPhotoPath(x, z, river.points).distance;
        const gravel = Math.max(0, Math.min(1, (river.halfWidth + 1000 - distance) / 2000));
        color.lerp(new THREE.Color(0x989783), gravel * (1 - point.demWeight));
      }
      const index = layer.positions.length / 3;
      layer.positions.push(x, height, z);
      layer.colors.push(color.r, color.g, color.b);
      layer.uvs.push(x / 30, -z / 30);
      layer.vertices.set(key, index);
      return index;
    });
    // X/Z平面顺时针，法线朝上。
    for (let i = 1; i + 1 < ids.length; i++) layer.indices.push(ids[0], ids[i], ids[i + 1]);
  };
  for (let row = 1; row < terrain.zs.length; row++) {
    for (let column = 1; column < terrain.xs.length; column++) {
      const x0 = terrain.xs[column - 1], x1 = terrain.xs[column];
      const z0 = terrain.zs[row - 1], z1 = terrain.zs[row];
      if (x1 <= roadRight && z1 <= surroundings.road.back) continue;
      const candidates = roadTriangles.filter(triangle => triangle.right > x0 && triangle.left < x1
        && triangle.back > z0 && triangle.front < z1);
      for (const triangle of [
        [[x0, z0], [x1, z1], [x1, z0]],
        [[x0, z0], [x0, z1], [x1, z1]],
      ] as Point[][]) {
        let parts = [triangle];
        for (const road of candidates) {
          const remaining: Point[][] = [];
          for (const part of parts) {
            const intersection = intersectRoofPolygon(part, road.points);
            if (intersection.length >= 3) add(intersection, true);
            remaining.push(...subtractRoofPolygon(part, road.points));
          }
          parts = remaining;
        }
        for (const part of parts) add(part, false);
      }
    }
  }
  const group = new THREE.Group();
  group.name = "东侧道路与山坡衔接";
  for (const layer of layers) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(layer.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(layer.colors, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(layer.uvs, 2));
    geometry.setIndex(layer.indices);
    geometry.computeVertexNormals();
    const material = (layer.road ? mat.paving : mat.grass).clone();
    material.color.set(layer.road ? 0x8f8d82 : 0xffffff);
    if (!layer.road) {
      material.map = null;
      material.vertexColors = true;
      material.roughness = 0.96;
      material.envMapIntensity = 0.18;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = layer.road ? "东侧随坡村道" : "东侧连续土坡";
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
