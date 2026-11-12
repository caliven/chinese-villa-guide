/**
 * SRTM／Mapzen Terrain Tiles：以宅址坐标为原点的完整 DEM 网格 + 日照天际线。
 * 近场保留手绘场地及局部衔接带，外围山体与日照共用原始DEM。
 */
import * as THREE from "three";
import type { Mats } from "./primitives.ts";
import { site, frontFieldLevel, courtyardFront, type Point } from "./data.ts";
import { handmadeTerrainBounds, createJoinedTerrainSampler, TERRAIN_JOIN_GRID_STEP_MM, terrainAnalysisData, surroundings, terraceContours, rightTerraceBreak, villageRoadEdges, groundHeight } from "./surroundings.ts";
import { subtractRoofPolygon, intersectRoofPolygon } from "./roof-surfaces.ts";
import {
  defaultTerrainHorizon, handmadeHouseCenterMm, terrainGridCoordinates, terrainHeightM,
  modelPointToTerrain, terrainPointToModel,
  type TerrainGrid, type TerrainHorizonData, type TerrainBoundsMm,
} from "./terrain-elevation.ts";
export * from "./terrain-elevation.ts";

export function mountainColor(relM: number, outFrac: number) {
  const t = THREE.MathUtils.clamp((relM + 20) / 280, 0, 1);
  const low = new THREE.Color(0x687c49);
  const mid = new THREE.Color(0x526d43);
  const high = new THREE.Color(0x5e7555);
  const ridge = new THREE.Color(0x78836c);
  const base =
    t < 0.35
      ? low.clone().lerp(mid, t / 0.35)
      : t < 0.7
        ? mid.clone().lerp(high, (t - 0.35) / 0.35)
        : high.clone().lerp(ridge, (t - 0.7) / 0.3);
  base.lerp(new THREE.Color(0xb8c2bb), outFrac * 0.38);
  return base;
}

type BoundaryEdge = { side: string; axis: "x" | "z"; a: THREE.Vector3; b: THREE.Vector3 };

function boundaryEdges(root: THREE.Object3D, bounds: TerrainBoundsMm) {
  const edges: BoundaryEdge[] = [], seen = new Set<string>();
  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const points = object.geometry.getAttribute("position"), indices = object.geometry.getIndex();
    const at = (index: number) => new THREE.Vector3().fromBufferAttribute(points, indices ? indices.getX(index) : index).applyMatrix4(object.matrixWorld);
    for (let i = 0; i < (indices?.count ?? points.count); i += 3) {
      const triangle = [at(i), at(i + 1), at(i + 2)];
      const [a, b, c] = triangle;
      if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) < 0.01) continue;
      for (let j = 0; j < 3; j++) {
        let a = triangle[j], b = triangle[(j + 1) % 3];
        let side = "", axis: "x" | "z" = "x";
        if (Math.abs(a.x - b.x) < 0.1 && Math.abs(a.z - b.z) > 0.1) {
          if (Math.abs(a.x - bounds.left) < 0.1) side = "left";
          else if (Math.abs(a.x - bounds.right) < 0.1) side = "right";
          axis = "z";
        } else if (Math.abs(a.z - b.z) < 0.1 && Math.abs(a.x - b.x) > 0.1) {
          if (Math.abs(a.z - bounds.front) < 0.1) side = "front";
          else if (Math.abs(a.z - bounds.back) < 0.1) side = "back";
        }
        if (!side) continue;
        if (a[axis] > b[axis]) [a, b] = [b, a];
        const key = [side, a[axis], a.y, b[axis], b.y].map(value => typeof value === "number" ? Math.round(value * 10) : value).join(",");
        if (!seen.has(key)) { edges.push({ side, axis, a, b }); seen.add(key); }
      }
    }
  });
  return edges;
}

/** 逐段连接田坎的真实边缘与DEM洞缘，补齐台地高差造成的三角细缝。 */
function closeTerrainJoin(join: THREE.Group, nearMesh: THREE.Mesh, ground: THREE.Object3D, bounds: TerrainBoundsMm) {
  const positions: number[] = [];
  const terrainEdges = boundaryEdges(nearMesh, bounds);
  const pointAt = (edge: BoundaryEdge, station: number) => edge.a.clone().lerp(edge.b, (station - edge.a[edge.axis]) / (edge.b[edge.axis] - edge.a[edge.axis]));
  for (const local of boundaryEdges(ground, bounds)) {
    for (const terrain of terrainEdges) {
      if (local.side !== terrain.side) continue;
      const start = Math.max(local.a[local.axis], terrain.a[terrain.axis]);
      const end = Math.min(local.b[local.axis], terrain.b[terrain.axis]);
      if (end - start < 0.1) continue;
      const d0 = pointAt(local, start).y - pointAt(terrain, start).y;
      const d1 = pointAt(local, end).y - pointAt(terrain, end).y;
      if (Math.max(Math.abs(d0), Math.abs(d1)) < 0.1) continue;
      const stations = [start, ...(d0 * d1 < 0 ? [start + (end - start) * d0 / (d0 - d1)] : []), end];
      for (let i = 1; i < stations.length; i++) {
        const quad = [pointAt(local, stations[i - 1]), pointAt(local, stations[i]), pointAt(terrain, stations[i]), pointAt(terrain, stations[i - 1])];
        for (const triangle of [[0, 1, 2], [0, 2, 3]]) {
          const [a, b, c] = triangle.map(index => quad[index]);
          if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 0.01) continue;
          positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
        }
      }
    }
  }
  if (!positions.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x697951, roughness: 1, side: THREE.DoubleSide });
  const closure = new THREE.Mesh(geometry, material);
  closure.name = "近场接缝竖向收边";
  closure.castShadow = closure.receiveShadow = true;
  join.add(closure);
}

function buildGridTerrain(group: THREE.Group, data: TerrainHorizonData, grid: TerrainGrid, ground?: THREE.Object3D) {
  if (grid.relativeHeightM.length !== grid.cols * grid.rows) throw new Error("DEM 网格大小无效");
  const { extentM } = grid;
  // 手绘外围回到DEM，近段原始地形独立参与近场阴影。
  const bounds = handmadeTerrainBounds();
  const { left, right, front, back } = bounds;
  const localBounds = terrainAnalysisData(data).localModelBoundsMm!;
  const coordinates = terrainGridCoordinates(grid);
  const joinCorners = [[localBounds.left, localBounds.front], [localBounds.right, localBounds.front],
    [localBounds.right, localBounds.back], [localBounds.left, localBounds.back]].map(([x, z]) => modelPointToTerrain(x, 0, z, data));
  const joinBounds = {
    left: Math.min(...joinCorners.map(p => p.eastM)), right: Math.max(...joinCorners.map(p => p.eastM)),
    front: Math.min(...joinCorners.map(p => p.northM)), back: Math.max(...joinCorners.map(p => p.northM)),
  };
  const hole: Point[] = [[left, back], [right, back], [right, front], [left, front]].map(([x, z]) => {
    const p = modelPointToTerrain(x, 0, z, data);
    return [p.eastM * 1000, p.northM * 1000];
  });
  const holeBounds = {
    left: Math.min(...hole.map(p => p[0])), right: Math.max(...hole.map(p => p[0])),
    back: Math.min(...hole.map(p => p[1])), front: Math.max(...hole.map(p => p[1])),
  };
  const cols = coordinates.length, rows = cols;
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
  const vertexIndex = new Int32Array(cols * rows).fill(-1);
  const eastAt = (c: number) => coordinates[c];
  const northAt = (r: number) => coordinates[r];
  const sampleJoin = createJoinedTerrainSampler(data);
  const displayHeight = (east: number, north: number) => {
    const model = terrainPointToModel(east, north, 0, data);
    return sampleJoin(model.x, model.z);
  };
  const basePositions: number[] = [], naturalPositions: number[] = [], naturalIndices: number[] = [];
  const localVertices = new Map<string, number>();
  const addVertex = (east: number, north: number, heightM = displayHeight(east, north)) => {
    const local = east >= joinBounds.left - 10 && east <= joinBounds.right + 10
      && north >= joinBounds.front - 10 && north <= joinBounds.back + 10;
    const key = `${Math.round(east * 1e6)},${Math.round(north * 1e6)}`;
    if (local && localVertices.has(key)) return localVertices.get(key)!;
    const yM = heightM;
    const model = terrainPointToModel(east, north, yM, data);
    const color = mountainColor(yM, Math.min(1, Math.hypot(east, north) / extentM));
    const index = positions.length / 3;
    positions.push(model.x, model.y, model.z);
    colors.push(color.r, color.g, color.b);
    uvs.push((east + extentM) / (extentM * 2), (north + extentM) / (extentM * 2));
    if (local) localVertices.set(key, index);
    return index;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      vertexIndex[r * cols + c] = addVertex(eastAt(c), northAt(r));
    }
  }

  const addCell = (x0: number, n0: number, x1: number, n1: number, corners: number[]) => {
    const [i00, i10, i01, i11] = corners;
    if (x1 <= holeBounds.left || x0 >= holeBounds.right || n1 <= holeBounds.back || n0 >= holeBounds.front) {
      indices.push(i00, i10, i11, i00, i11, i01);
      return;
    }
    // 裁洞交点沿当前三角平面插值，共用顶点避免裂缝与法线硬边。
    const triangles: Point[][] = [
      [[x0, n0], [x1, n0], [x1, n1]],
      [[x0, n0], [x1, n1], [x0, n1]],
    ];
    const [h00, h10, h01, h11] = corners.map(index => positions[index * 3 + 1] / 1000);
    for (const [triangle, polygon] of triangles.entries()) {
      // 完整生成宅院下方DEM。叠合视图的开挖底面位于台地之下，原始坡面供单独核对。
      const inside = intersectRoofPolygon(polygon, hole);
      for (let i = 1; i + 1 < inside.length; i++) {
        for (const [east, north] of [inside[0], inside[i], inside[i + 1]]) {
          const u = (east - x0) / (x1 - x0), v = (north - n0) / (n1 - n0);
          const height = triangle === 0
            ? h00 + u * (h10 - h00) + v * (h11 - h10)
            : h00 + u * (h11 - h01) + v * (h01 - h00);
          const model = terrainPointToModel(east / 1000, north / 1000, height, data);
          naturalPositions.push(model.x, model.y, model.z);
          naturalIndices.push(addVertex(east / 1000, north / 1000, height));
          basePositions.push(model.x, Math.min(model.y, Math.min(groundHeight(model.x, model.z), surroundings.frontHouse.y, site.garageFloor) - 500), model.z);
        }
      }
      for (const part of subtractRoofPolygon(polygon, hole)) {
        const vertices = part.map(([east, north]) => {
          const u = (east - x0) / (x1 - x0), v = (north - n0) / (n1 - n0);
          const height = triangle === 0
            ? h00 + u * (h10 - h00) + v * (h11 - h10)
            : h00 + u * (h11 - h01) + v * (h01 - h00);
          return addVertex(east / 1000, north / 1000, height);
        });
        for (let i = 1; i < vertices.length - 1; i++) indices.push(vertices[0], vertices[i], vertices[i + 1]);
      }
    }
  };
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const east = eastAt(c), north = northAt(r), width = eastAt(c + 1) - east, depth = northAt(r + 1) - north;
      const near = east + width > joinBounds.left && east < joinBounds.right
        && north + depth > joinBounds.front && north < joinBounds.back;
      if (!near) {
        addCell(east * 1000, north * 1000, (east + width) * 1000, (north + depth) * 1000,
          [vertexIndex[r * cols + c], vertexIndex[r * cols + c + 1], vertexIndex[(r + 1) * cols + c], vertexIndex[(r + 1) * cols + c + 1]]);
        continue;
      }
      const steps = Math.ceil(Math.max(width, depth) * 1000 / TERRAIN_JOIN_GRID_STEP_MM);
      for (let j = 0; j < steps; j++) {
        for (let i = 0; i < steps; i++) {
          const x0 = east + width * i / steps, x1 = east + width * (i + 1) / steps;
          const n0 = north + depth * j / steps, n1 = north + depth * (j + 1) / steps;
          addCell(x0 * 1000, n0 * 1000, x1 * 1000, n1 * 1000,
            [addVertex(x0, n0), addVertex(x1, n0), addVertex(x0, n1), addVertex(x1, n1)]);
        }
      }
    }
  }

  if (indices.length < 3) return;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([...indices, ...naturalIndices]);
  geometry.computeVertexNormals();

  const nearIndices: number[] = [], farIndices: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = indices.slice(i, i + 3);
    const xs = triangle.map(index => positions[index * 3]);
    const zs = triangle.map(index => positions[index * 3 + 2]);
    const near = Math.max(...xs) >= localBounds.left && Math.min(...xs) <= localBounds.right
      && Math.max(...zs) >= localBounds.front && Math.min(...zs) <= localBounds.back;
    (near ? nearIndices : farIndices).push(...triangle);
  }
  geometry.setIndex(farIndices);

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      name: "SRTM原始地形",
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0.18,
      flatShading: false,
      side: THREE.FrontSide,
    }),
  );
  mesh.material.shadowSide = THREE.DoubleSide;
  mesh.name = "DEM山体曲面";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // 接缝与手绘地面一起参与近场射线与阴影，远场天际线从接缝外沿开始。
  const nearGeometry = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color", "uv"]) {
    const attribute = geometry.getAttribute(name);
    const values = nearIndices.flatMap(index => Array.from({ length: attribute.itemSize }, (_, axis) => attribute.array[index * attribute.itemSize + axis]));
    nearGeometry.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize));
  }
  const join = new THREE.Group();
  join.name = "DEM近场衔接带";
  const nearMesh = new THREE.Mesh(nearGeometry, mesh.material);
  nearMesh.name = "DEM近场衔接面";
  nearMesh.castShadow = nearMesh.receiveShadow = true;
  join.add(nearMesh);
  for (const [name, points] of [["宅院下方地形底面", basePositions], ["宅院下方原始DEM", naturalPositions]] as const) {
    const baseGeometry = new THREE.BufferGeometry();
    baseGeometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const colors: number[] = [];
    for (let i = 0; i < points.length; i += 3) {
      const color = mountainColor(points[i + 1] / 1000, 0);
      colors.push(color.r, color.g, color.b);
    }
    baseGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    baseGeometry.computeVertexNormals();
    if (name === "宅院下方原始DEM") {
      for (const attribute of ["position", "normal", "color", "uv"]) {
        baseGeometry.setAttribute(attribute, geometry.getAttribute(attribute));
      }
      baseGeometry.setIndex(naturalIndices);
    }
    const base = new THREE.Mesh(baseGeometry, mesh.material);
    base.name = name;
    base.castShadow = base.receiveShadow = true;
    base.visible = name === "宅院下方地形底面";
    join.add(base);
  }

  if (ground) closeTerrainJoin(join, nearMesh, ground, bounds);
  group.add(join);

  // 外缘竖裙
  const edge: number[] = [];
  const pushEdge = (r: number, c: number) => {
    const i = vertexIndex[r * cols + c];
    if (i >= 0) edge.push(i);
  };
  for (let c = 0; c < cols; c++) pushEdge(0, c);
  for (let r = 1; r < rows; r++) pushEdge(r, cols - 1);
  for (let c = cols - 2; c >= 0; c--) pushEdge(rows - 1, c);
  for (let r = rows - 2; r >= 1; r--) pushEdge(r, 0);

  if (edge.length >= 2) {
    const skirtPos: number[] = [];
    const skirtCol: number[] = [];
    const drop = 80 * 1000;
    const haze = new THREE.Color(0x9aa59c);
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i];
      const b = edge[(i + 1) % edge.length];
      const ax = positions[a * 3],
        ay = positions[a * 3 + 1],
        az = positions[a * 3 + 2];
      const bx = positions[b * 3],
        by = positions[b * 3 + 1],
        bz = positions[b * 3 + 2];
      const quad = [
        [ax, ay, az],
        [bx, by, bz],
        [bx, by - drop, bz],
        [ax, ay - drop, az],
      ];
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const p = quad[index];
        skirtPos.push(p[0], p[1], p[2]);
        skirtCol.push(haze.r, haze.g, haze.b);
      }
    }
    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute("position", new THREE.Float32BufferAttribute(skirtPos, 3));
    skirtGeo.setAttribute("color", new THREE.Float32BufferAttribute(skirtCol, 3));
    skirtGeo.computeVertexNormals();
    const skirt = new THREE.Mesh(
      skirtGeo,
      new THREE.MeshStandardMaterial({
        name: "DEM外缘收边",
        vertexColors: true,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    skirt.name = "DEM外缘竖裙";
    skirt.castShadow = false;
    skirt.receiveShadow = false;
    group.add(skirt);
  }
}

/** @deprecated 仅兼容旧 ring 数据 */
function buildRingTerrain(group: THREE.Group, data: TerrainHorizonData) {
  const ring = data.ring!;
  const { azimuthCount: na, radialCount: nr, innerM, outerM, relativeHeightM } = ring;
  if (relativeHeightM.length !== na * nr || na < 3 || nr < 2) return;
  const origin = handmadeHouseCenterMm(data);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const heightAt = (ai: number, ri: number) =>
    relativeHeightM[(((ai % na) + na) % na) * nr + ri];
  for (let ai = 0; ai < na; ai++) {
    const az = (ai / na) * Math.PI * 2;
    for (let ri = 0; ri < nr; ri++) {
      const frac = ri / (nr - 1);
      const dM = innerM + (outerM - innerM) * frac;
      const east = Math.sin(az) * dM;
      const north = Math.cos(az) * dM;
      const yM = heightAt(ai, ri);
      const c = mountainColor(yM, frac);
      positions.push(origin.x + east * 1000, yM * 1000, origin.z - north * 1000);
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let ai = 0; ai < na; ai++) {
    const a0 = ai * nr;
    const a1 = ((ai + 1) % na) * nr;
    for (let ri = 0; ri < nr - 1; ri++) {
      indices.push(a0 + ri, a1 + ri, a1 + ri + 1, a0 + ri, a1 + ri + 1, a0 + ri + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    }),
  );
  mesh.name = "远山示意曲面";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function buildDistantTerrainFresh(data: TerrainHorizonData, ground?: THREE.Object3D) {
  const group = new THREE.Group();
  group.name = "SRTM地形";
  if (data.grid) buildGridTerrain(group, data, data.grid, ground);
  else if (data.ring) buildRingTerrain(group, data);
  return group;
}

/** 默认 DEM 只建一次，clone 共享 BufferGeometry，避免测试／反复切场景爆内存。 */
let defaultDistantTerrain: THREE.Group | null = null;
let defaultDistantTerrainKey = "";

/**
 * 完整 DEM 山体（或旧环数据）。原点为固定地理锚点，不随新房参数移动。
 * 近场接缝单独保留，以便画面和日照使用相同三角面。
 */
export function buildDistantTerrain(
  _mat: Mats,
  data: TerrainHorizonData = defaultTerrainHorizon,
  ground?: THREE.Object3D,
) {
  if (data === defaultTerrainHorizon) {
    const key = JSON.stringify([!!ground, handmadeTerrainBounds(), data.reference, site, frontFieldLevel, courtyardFront, surroundings, terraceContours, rightTerraceBreak, villageRoadEdges]);
    if (!defaultDistantTerrain || key !== defaultDistantTerrainKey) {
      defaultDistantTerrain = buildDistantTerrainFresh(data, ground);
      defaultDistantTerrainKey = key;
    }
    return defaultDistantTerrain.clone(true);
  }
  return buildDistantTerrainFresh(data, ground);
}
