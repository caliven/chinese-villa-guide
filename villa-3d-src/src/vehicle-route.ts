import * as THREE from "three";
import { carCorners, contains, site, type Point } from "./data";
import { garageLayout, rectangle } from "./garage-layout";
import { roadHeight, surroundings } from "./surroundings";

// 原有空间探索曲线原样保留。它不是按轴距、转向角或最小转弯半径求出的车辆轨迹。
export const vehicleRoute = new THREE.CatmullRomCurve3([
  new THREE.Vector3(surroundings.road.x + surroundings.road.w / 2, 0, -18),
  new THREE.Vector3(surroundings.road.x + surroundings.road.w / 2, 0, -12),
  new THREE.Vector3(surroundings.road.x + surroundings.road.w / 2, 0, -8.5),
  new THREE.Vector3(surroundings.road.x - 0.2, 0, -7.4),
  new THREE.Vector3(28, 0, -7.35),
  new THREE.Vector3(23.2, 0, -7.15),
  new THREE.Vector3(20.2, 0, -6.35),
  new THREE.Vector3(18.6, 0, -4.5),
  new THREE.Vector3(18.5, 0, -2.8),
], false, "centripetal");

export function routeHeight(x: number, z: number, roadY: number, rampLength: number) {
  const surface = roadHeight(z) + roadY - surroundings.road.entryY;
  const t = THREE.MathUtils.clamp((x - site.width) / rampLength, 0, 1);
  return site.garageFloor + t * (surface - site.garageFloor);
}

export function routePose(progress: number, roadY: number, rampLength: number) {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const p = vehicleRoute.getPointAt(t), dir = vehicleRoute.getTangentAt(t);
  const yaw = Math.atan2(-dir.x, -dir.z);
  return {
    progress: t, x: p.x, z: p.z, y: routeHeight(p.x, p.z, roadY, rampLength), yaw,
    corners: carCorners(p.x, p.z, yaw),
  };
}

const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function segmentCuts(a: Point, b: Point, c: Point, d: Point): number[] {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const ux = d[0] - c[0], uz = d[1] - c[1];
  const det = dx * uz - dz * ux;
  if (Math.abs(det) < 1e-10) {
    if (Math.abs(cross(a, b, c)) > 1e-8) return [];
    const length2 = dx * dx + dz * dz;
    if (length2 < 1e-12) return [];
    return [c, d].map((p) => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length2)
      .filter((t) => t >= -1e-8 && t <= 1 + 1e-8).map((t) => Math.max(0, Math.min(1, t)));
  }
  const t = ((c[0] - a[0]) * uz - (c[1] - a[1]) * ux) / det;
  const u = ((c[0] - a[0]) * dz - (c[1] - a[1]) * dx) / det;
  return t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8
    ? [Math.max(0, Math.min(1, t))] : [];
}

// 覆盖柱完全落在车身内、边对边交叉、贴边与任意一方包含另一方，不能只检查车身四角。
export function polygonsOverlap(a: Point[], b: Point[]) {
  if (!a.length || !b.length) return false;
  if (a.some((p) => contains(p, b)) || b.some((p) => contains(p, a))) return true;
  return a.some((p, i) => b.some((q, j) =>
    segmentCuts(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length]).length > 0));
}

// 允许范围是原模型地库、拟接入带与马路的并集；检查边界各交点间的区段，避免凹口漏检。
export function footprintWithin(footprint: Point[], regions: Point[][]) {
  const allowed = (p: Point) => regions.some((polygon) => contains(p, polygon));
  if (!footprint.every(allowed)) return false;
  return footprint.every((a, i) => {
    const b = footprint[(i + 1) % footprint.length];
    const ts = [0, 1, ...regions.flatMap((polygon) => polygon.flatMap((p, j) =>
      segmentCuts(a, b, p, polygon[(j + 1) % polygon.length])))].sort((u, v) => u - v);
    return ts.slice(1).every((t, j) => {
      const mid = (t + ts[j]) / 2;
      return allowed([a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid]);
    });
  });
}

export function convexHull(points: Point[]): Point[] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list: Point[]) => {
    const result: Point[] = [];
    for (const p of list) {
      while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, p) <= 0) result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.slice().reverse())];
}

export const routeRegions = [
  site.field,
  rectangle(garageLayout.entry.x, garageLayout.entry.z, garageLayout.entry.w, garageLayout.entry.d),
  rectangle(surroundings.road.x, surroundings.road.front, surroundings.road.w,
    surroundings.road.back - surroundings.road.front),
];

export function inspectFootprint(footprint: Point[]) {
  return {
    outside: !footprintWithin(footprint, routeRegions),
    // 只作平面潜在冲突筛查；构件实际标高、尺寸和纵向车姿尚未实测。
    obstacles: garageLayout.obstacles.filter((o) => polygonsOverlap(footprint, o.footprint)),
    underDeck: polygonsOverlap(footprint, garageLayout.retainedDeck.footprint),
  };
}

export type SweepCell = ReturnType<typeof inspectFootprint> & {
  from: number;
  to: number;
  footprint: Point[];
};

export function assessVehicleRoute(roadY: number, rampLength: number) {
  const pose = (t: number) => routePose(t, roadY, rampLength);
  const poses = [pose(0)];
  const steps = Math.ceil(vehicleRoute.getLength() / 0.15);
  // 弯道额外细分至相邻偏航角不超过 2°，再连接两次整车占位的凸包。仍是离散近似。
  const append = (a: ReturnType<typeof pose>, b: ReturnType<typeof pose>, depth = 0) => {
    const angle = Math.abs(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)));
    if (angle > Math.PI / 90 && depth < 10) {
      const mid = pose((a.progress + b.progress) / 2);
      append(a, mid, depth + 1);
      append(mid, b, depth + 1);
    } else poses.push(b);
  };
  for (let i = 1; i <= steps; i++) append(poses.at(-1)!, pose(i / steps));
  const cells: SweepCell[] = poses.slice(1).map((b, i) => {
    const a = poses[i];
    const footprint = convexHull([...a.corners, ...b.corners]);
    return { from: a.progress, to: b.progress, footprint, ...inspectFootprint(footprint) };
  });
  const conflicts = garageLayout.obstacles.filter((o) => cells.some((c) => c.obstacles.includes(o)));
  return { poses, cells, conflicts, underDeck: cells.some((c) => c.underDeck), roadY, rampLength };
}

export type RouteAssessment = ReturnType<typeof assessVehicleRoute>;

export function routeRanges(cells: SweepCell[], predicate: (cell: SweepCell) => boolean) {
  const ranges: [number, number][] = [];
  for (const cell of cells.filter(predicate)) {
    const last = ranges.at(-1);
    if (last && cell.from <= last[1] + 1e-7) last[1] = cell.to;
    else ranges.push([cell.from, cell.to]);
  }
  return ranges;
}

export function formatRouteRanges(ranges: [number, number][]) {
  return ranges.map(([from, to]) => `${Math.floor(from * 100)}–${Math.ceil(to * 100)}%`).join("、");
}
