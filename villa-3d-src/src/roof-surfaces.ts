import * as THREE from "three";
import type { Point } from "./data";
import { roofTileInset, roofTileThickness } from "./roof-options";

// 屋面先按平面求交、裁切，再铺瓦；相邻坡面共用交线，瓦垄也在同一边界收口。
export interface RoofFace {
  points: THREE.Vector3[];
  across: Point;
  origin: Point;
  owner: number;
}
export interface RoofRidge { a: THREE.Vector3; b: THREE.Vector3; owner: number }
const epsilon = 1e-5;
/** 面积类容差（mm²）：原米制 1e-8 m²。 */
const areaEpsilon = 1e-2;
// 裁切产生的微小正负误差统一量化，避免把同一坡面的 0 与 -0 分成两组。
const geometryKey = (values: number[]) => values.map(n => Math.round(n * 1e3)).join(":");

function area(polygon: Point[]) {
  return polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
}

function clip(polygon: Point[], a: number, b: number, c: number): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const dp = a * p[0] + b * p[1] + c, dq = a * q[0] + b * q[1] + c;
    if (dp >= -epsilon) result.push(p);
    if ((dp > epsilon && dq < -epsilon) || (dp < -epsilon && dq > epsilon)) {
      const t = dp / (dp - dq);
      result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return result.filter((p, i) => {
    const q = result[(i + result.length - 1) % result.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > epsilon;
  });
}

function edgePlane(a: Point, b: Point, sign: number, inset = 0): [number, number, number] {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  return [-dz * sign, dx * sign, (dz * a[0] - dx * a[1]) * sign - inset * Math.hypot(dx, dz)];
}

// 从凸多边形中减去另一凸多边形，保留互不重叠的凸片。
export function subtractRoofPolygon(subject: Point[], cover: Point[]): Point[][] {
  const sign = Math.sign(area(cover));
  let remainder = subject;
  const pieces: Point[][] = [];
  for (let i = 0; i < cover.length && remainder.length >= 3; i++) {
    const [a, b, c] = edgePlane(cover[i], cover[(i + 1) % cover.length], sign);
    const outside = clip(remainder, -a, -b, -c);
    if (outside.length >= 3 && Math.abs(area(outside)) > areaEpsilon) pieces.push(outside);
    remainder = clip(remainder, a, b, c);
  }
  return pieces;
}

function plane(face: RoofFace) {
  const a = face.points[0];
  let n = new THREE.Vector3();
  for (let i = 1; i < face.points.length - 1; i++) {
    n = face.points[i].clone().sub(a).cross(face.points[i + 1].clone().sub(a));
    if (Math.abs(n.y) > areaEpsilon) break;
  }
  const x = -n.x / n.y, z = -n.z / n.y;
  return { x, z, c: a.y - x * a.x - z * a.z };
}
const footprint = (face: RoofFace): Point[] => face.points.map(p => [p.x, p.z]);

export function roofHeight(face: RoofFace, x: number, z: number) {
  const p = plane(face);
  return p.x * x + p.z * z + p.c;
}

function atHeight(face: RoofFace, polygon: Point[]): RoofFace {
  return { ...face, points: polygon.map(([x, z]) => new THREE.Vector3(x, roofHeight(face, x, z), z)) };
}

export function cutRoofOpenings(faces: RoofFace[], holes: Point[][]) {
  return faces.flatMap(face => {
    let parts = [footprint(face)];
    for (const hole of holes) parts = parts.flatMap(part => subtractRoofPolygon(part, hole));
    return parts.map(part => atHeight(face, part));
  });
}

// 两个屋顶取上包络：只留下外露瓦面，官帽下方的正屋瓦及埋入正屋的官帽瓦均裁去。
export function joinRoofFaces(faces: RoofFace[]) {
  return faces.flatMap(face => {
    const p = plane(face);
    let parts = [footprint(face)];
    for (const other of faces) {
      if (face.owner === other.owner) continue;
      const q = plane(other);
      const cover = clip(footprint(other), q.x - p.x, q.z - p.z, q.c - p.c);
      if (cover.length >= 3 && Math.abs(area(cover)) > areaEpsilon)
        parts = parts.flatMap(part => subtractRoofPolygon(part, cover));
    }
    return parts.map(part => atHeight(face, part));
  });
}

export function hipRoofSurfaces(x: number, z: number, w: number, d: number, eave: number, rise: number, owner = 0) {
  const a = new THREE.Vector3(x, eave, z), b = new THREE.Vector3(x + w, eave, z);
  const c = new THREE.Vector3(x + w, eave, z + d), f = new THREE.Vector3(x, eave, z + d);
  const run = Math.min(w, d) / 2;
  const l = new THREE.Vector3(x + run, eave + rise, z + run);
  const r = new THREE.Vector3(x + w - run, eave + rise, z + d - run);
  const origin: Point = [x + w / 2, z + d / 2];
  const faces: RoofFace[] = w >= d ? [
    { points: [a, b, r, l], across: [1, 0], origin, owner },
    { points: [b, c, r], across: [0, 1], origin, owner },
    { points: [c, f, l, r], across: [1, 0], origin, owner },
    { points: [f, a, l], across: [0, 1], origin, owner },
  ] : [
    { points: [a, b, l], across: [1, 0], origin, owner },
    { points: [b, c, r, l], across: [0, 1], origin, owner },
    { points: [c, f, r], across: [1, 0], origin, owner },
    { points: [f, a, l, r], across: [0, 1], origin, owner },
  ];
  return { faces, ridges: [[a, l], [b, w >= d ? r : l], [c, r], [f, w >= d ? l : r], [l, r]]
    .filter(([p, q]) => p.distanceTo(q) > epsilon).map(([a, b]) => ({ a, b, owner })) };
}

export function hatRoofSurfaces(center: number, front: number, width: number, joinZ: number, eave: number, peak: number, owner = 1, ridgeFront = front + width * 0.42) {
  const a = new THREE.Vector3(center - width / 2 + roofTileInset, eave, front + roofTileInset);
  const b = new THREE.Vector3(center + width / 2 - roofTileInset, eave, front + roofTileInset);
  const ridge = new THREE.Vector3(center, peak, ridgeFront);
  const join = new THREE.Vector3(center, peak, joinZ);
  const origin: Point = [center, front + roofTileInset];
  const faces: RoofFace[] = [
    { points: [a, b, ridge], across: [1, 0], origin, owner },
    { points: [new THREE.Vector3(a.x, eave, joinZ), a, ridge, join], across: [0, 1], origin, owner },
    { points: [b, new THREE.Vector3(b.x, eave, joinZ), join, ridge], across: [0, 1], origin, owner },
  ];
  return { faces, ridges: [[a, ridge], [b, ridge], [ridge, join]].map(([a, b]) => ({ a, b, owner })) };
}

function contains(face: RoofFace, p: THREE.Vector3) {
  const polygon = footprint(face), sign = Math.sign(area(polygon));
  return polygon.every((a, i) => {
    const [x, z, c] = edgePlane(a, polygon[(i + 1) % polygon.length], sign);
    return x * p.x + z * p.z + c >= -epsilon;
  });
}

function roofGeometry(face: RoofFace, thickness = 0, lift = 0) {
  const polygon = footprint(face);
  const triangles = THREE.ShapeUtils.triangulateShape(polygon.map(([x, z]) => new THREE.Vector2(x, -z)), []);
  const positions: number[] = [];
  const add = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, bottom = false) => {
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    for (const p of ((n.y >= 0) !== bottom) ? [a, b, c] : [a, c, b])
      positions.push(p.x, p.y + lift - (bottom ? thickness : 0), p.z);
  };
  for (const [i, j, k] of triangles) {
    add(face.points[i], face.points[j], face.points[k]);
    if (thickness) add(face.points[i], face.points[j], face.points[k], true);
  }
  if (thickness) face.points.forEach((a, i) => {
    const b = face.points[(i + 1) % face.points.length];
    const a0 = a.clone().add(new THREE.Vector3(0, -thickness, 0));
    const b0 = b.clone().add(new THREE.Vector3(0, -thickness, 0));
    // 侧边按轮廓朝外；不会留下只有单面瓦片的透缝。
    const vertices = area(polygon) > 0 ? [a, b, a0, b, b0, a0] : [a, a0, b, b, a0, b0];
    for (const p of vertices) positions.push(p.x, p.y + lift, p.z);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// 在坡面的平面范围内截一条等宽带；瓦垄和搭接线保持平行，不在转角扭成扇形。
function band(polygon: Point[], direction: Point, coordinate: number, halfWidth: number) {
  return clip(clip(polygon, direction[0], direction[1], -coordinate + halfWidth), -direction[0], -direction[1], coordinate + halfWidth);
}

function mergeIntervals(intervals: [number, number][]) {
  const result: [number, number][] = [];
  for (const span of intervals.sort((a, b) => a[0] - b[0])) {
    const last = result[result.length - 1];
    if (last && span[0] <= last[1] + 1e-3) last[1] = Math.max(last[1], span[1]);
    else result.push([...span]);
  }
  return result;
}

function lineIntervals(polygons: Point[][], u: number, across: Point, down: Point) {
  const intervals: [number, number][] = [];
  for (const polygon of polygons) {
    const vs: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = a[0] * across[0] + a[1] * across[1] - u;
      const db = b[0] * across[0] + b[1] * across[1] - u;
      if (Math.abs(da) < epsilon) vs.push(a[0] * down[0] + a[1] * down[1]);
      if (da * db < -epsilon) {
        const t = da / (da - db);
        vs.push((a[0] + (b[0] - a[0]) * t) * down[0] + (a[1] + (b[1] - a[1]) * t) * down[1]);
      }
    }
    if (vs.length > 1) intervals.push([Math.min(...vs), Math.max(...vs)]);
  }
  return mergeIntervals(intervals);
}

export function addTiledRoof(parent: THREE.Object3D, faces: RoofFace[], material: THREE.Material, joint: THREE.Material, ridges: RoofRidge[] = [], originalFaces = faces) {
  const group = new THREE.Group();
  group.name = "裁切拼接的蓝釉瓦面";
  parent.add(group);
  const ribs: [THREE.Vector3, THREE.Vector3][] = [];
  const ribRuns = new Map<string, { face: RoofFace; planeKey: string; u: number; down: Point; originV: number; intervals: [number, number][] }>();
  const coplanar = new Map<string, Point[][]>();
  const seams: THREE.BufferGeometry[] = [];
  for (const face of faces) {
    const mesh = new THREE.Mesh(roofGeometry(face, roofTileThickness), material);
    mesh.name = "封闭瓦面";
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    const polygon = footprint(face), p = plane(face);
    const planeKey = geometryKey([face.owner, p.x, p.z, p.c]);
    if (!coplanar.has(planeKey)) coplanar.set(planeKey, []);
    coplanar.get(planeKey)!.push(polygon);
    const across = face.across, down: Point = [-across[1], across[0]];
    const projection = (q: Point, dir: Point) => q[0] * dir[0] + q[1] * dir[1];
    const originU = projection(face.origin, across), us = polygon.map(q => projection(q, across));
    for (let k = Math.ceil((Math.min(...us) - originU) / 180); k <= Math.floor((Math.max(...us) - originU) / 180); k++) {
      const u = originU + k * 180, points: Point[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const ua = projection(a, across) - u, ub = projection(b, across) - u;
        if (Math.abs(ua) < epsilon) points.push(a);
        if (ua * ub < -epsilon) {
          const t = ua / (ua - ub);
          points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      points.sort((a, b) => projection(a, down) - projection(b, down));
      if (points.length < 2) continue;
      // 裁切会把同一平面分成数片；先合并共线范围，不能在人工分片线上把瓦垄截断。
      const key = geometryKey([face.owner, p.x, p.z, p.c, across[0], across[1], u]);
      if (!ribRuns.has(key)) ribRuns.set(key, { face, planeKey, u, down, originV: projection(face.origin, down), intervals: [] });
      ribRuns.get(key)!.intervals.push([projection(points[0], down), projection(points[points.length - 1], down)]);
    }
    const originV = projection(face.origin, down), vs = polygon.map(q => projection(q, down));
    for (let k = Math.ceil((Math.min(...vs) - originV) / 260); k <= Math.floor((Math.max(...vs) - originV) / 260); k++) {
      const strip = band(polygon, down, originV + k * 260, 3);
      if (strip.length >= 3 && Math.abs(area(strip)) > areaEpsilon)
        seams.push(roofGeometry(atHeight(face, strip), 0, 4));
    }
  }
  for (const run of ribRuns.values()) {
    const p = plane(run.face), normal = new THREE.Vector3(-p.x, 1, -p.z).normalize();
    const axis = new THREE.Vector3(run.down[0], p.x * run.down[0] + p.z * run.down[1], run.down[1]).normalize();
    const lateral = axis.clone().cross(normal).normalize();
    let safe = mergeIntervals(run.intervals);
    // 将整个圆截面都收进真实外露轮廓。沿拼接交线、柱脚和斜脊按半径留位，
    // 而非固定截短轴线；陡坡及小夹角下仍不会伸进相邻瓦面。
    for (let i = 0; i < 24 && safe.length; i++) {
      const angle = i * Math.PI / 12;
      const offset = normal.clone().multiplyScalar(22 + 36 * Math.cos(angle))
        .addScaledVector(lateral, 36 * Math.sin(angle));
      const du = offset.x * run.face.across[0] + offset.z * run.face.across[1];
      const dv = offset.x * run.down[0] + offset.z * run.down[1];
      const allowed = lineIntervals(coplanar.get(run.planeKey)!, run.u + du, run.face.across, run.down)
        .map(([a, b]) => [a - dv, b - dv] as [number, number]);
      safe = safe.flatMap(([a, b]) => allowed.map(([c, d]) => [Math.max(a,c), Math.min(b,d)] as [number, number])
        .filter(([c,d]) => d - c > epsilon));
    }
    for (const [start, end] of safe) {
      const lo = start + 3, hi = end - 3;
      if (hi - lo < 40) continue;
      const cuts = [lo];
      for (let k = Math.ceil((lo - run.originV) / 260); run.originV + k * 260 < hi; k++)
        if (run.originV + k * 260 > lo + epsilon) cuts.push(run.originV + k * 260);
      cuts.push(hi);
      for (let i = 0; i < cuts.length - 1; i++) {
        if (cuts[i + 1] - cuts[i] < 25) continue;
        const ends = [cuts[i] + 1.5, cuts[i + 1] - 1.5].map(v => {
          const x = run.face.across[0] * run.u + run.down[0] * v;
          const z = run.face.across[1] * run.u + run.down[1] * v;
          return new THREE.Vector3(x, roofHeight(run.face, x, z), z).addScaledVector(normal, 22);
        });
        if (ends[0].y > ends[1].y) ends.reverse();
        ribs.push(ends as [THREE.Vector3, THREE.Vector3]);
      }
    }
  }
  const cylinders = (segments: [THREE.Vector3, THREE.Vector3][], radius: number, sides: number, name: string) => {
    if (!segments.length) return;
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, name === "分片筒瓦" ? radius * 1.1 : radius, 1, sides), material, segments.length);
    mesh.name = name;
    const up = new THREE.Vector3(0, 1, 0), matrix = new THREE.Matrix4(), q = new THREE.Quaternion();
    segments.forEach(([a, b], i) => {
      const v = b.clone().sub(a);
      q.setFromUnitVectors(up, v.clone().normalize());
      matrix.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, v.length(), 1));
      mesh.setMatrixAt(i, matrix);
    });
    // 细瓦垄由自身曲面反光表现，避免在白墙上留下亚像素锯齿阴影。
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  cylinders(ribs, 32, 12, "分片筒瓦");
  for (const geometry of seams) {
    const mesh = new THREE.Mesh(geometry, joint);
    mesh.name = "瓦片搭接缝";
    group.add(mesh);
  }
  const visibleRidges: [THREE.Vector3, THREE.Vector3][] = [];
  for (const ridge of ridges) {
    const ts = [0, 1];
    const competing = originalFaces.filter(face => face.owner !== ridge.owner);
    for (const face of competing) {
      const polygon = footprint(face), sign = Math.sign(area(polygon));
      for (let i = 0; i <= polygon.length; i++) {
        const [a, b, c] = i === polygon.length
          ? (() => { const p = plane(face); return [p.x, p.z, p.c] as const; })()
          : edgePlane(polygon[i], polygon[(i + 1) % polygon.length], sign);
        const f0 = a * ridge.a.x + b * ridge.a.z + c - (i === polygon.length ? ridge.a.y : 0);
        const f1 = a * ridge.b.x + b * ridge.b.z + c - (i === polygon.length ? ridge.b.y : 0);
        if (Math.abs(f0 - f1) > epsilon) {
          const t = f0 / (f0 - f1);
          if (t > epsilon && t < 1 - epsilon) ts.push(t);
        }
      }
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i < ts.length - 1; i++) {
      if (ts[i + 1] - ts[i] < epsilon) continue;
      const mid = ridge.a.clone().lerp(ridge.b, (ts[i] + ts[i + 1]) / 2);
      if (competing.some(face => contains(face, mid) && roofHeight(face, mid.x, mid.z) > mid.y + epsilon)) continue;
      visibleRidges.push([ts[i], ts[i + 1]].map(t => ridge.a.clone().lerp(ridge.b, t).add(new THREE.Vector3(0, 55, 0))) as [THREE.Vector3, THREE.Vector3]);
    }
  }
  cylinders(visibleRidges, 75, 16, "相接直脊瓦");
  return group;
}
