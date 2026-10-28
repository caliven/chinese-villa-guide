import { construction, isPhysicalWall, wallRoleOf, type Floor, type Point } from "./data";
import { recessedFootprint } from "./building-variants";
import type { VoidDraft, StairDraft } from "./layout-draft";
import { polygonContainsPoint, roomOutline } from "./room-geometry";
import { stairOpeningBounds, stairOpeningRails, stairShape } from "./stair-geometry";
import { railingThickness, type RailingStyle } from "./railing-options";

export type GuardSegment = [Point, Point];
type Boundary = { a: Point; b: Point };
const rect = (r: { x: number; z: number; w: number; d: number }): Point[] =>
  [[r.x, r.z], [r.x + r.w, r.z], [r.x + r.w, r.z + r.d], [r.x, r.z + r.d]];

function wallPolygon(wall: Boundary, pad: number): Point[] {
  const [a, b] = [wall.a, wall.b], length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const dx = (b[0] - a[0]) / length * pad, dz = (b[1] - a[1]) / length * pad;
  return [[a[0] - dx - dz, a[1] - dz + dx], [b[0] + dx - dz, b[1] + dz + dx],
    [b[0] + dx + dz, b[1] + dz - dx], [a[0] - dx + dz, a[1] - dz - dx]];
}

/** 在几何交点处分段，只保留整段有楼板承托、且不穿实体墙／已有栏杆的部分。 */
function supportedSegments(candidates: GuardSegment[], floor: Floor, boundaries: Boundary[], holes: Point[][], style: RailingStyle): GuardSegment[] {
  const half = railingThickness(style) / 2;
  const outline = recessedFootprint(floor.front);
  const blockers = [
    ...boundaries.map(w => wallPolygon(w, construction.outsideWall / 2 + half + 5)),
    ...floor.partitions.filter(isPhysicalWall).map(w => wallPolygon(w, (wallRoleOf(w) === "bearing" ? construction.outsideWall : construction.partition) / 2 + half + 5)),
    ...floor.furniture.filter(f => f.kind === "railing").map(f => {
      const angle = f.rotation ?? 0, c = Math.cos(angle), s = Math.sin(angle);
      return rect({ x: -f.w / 2 - half, z: -f.d / 2 - half, w: f.w + half * 2, d: f.d + half * 2 })
        .map(([x, z]): Point => [f.x + x * c + z * s, f.z - x * s + z * c]);
    }),
  ];
  const polygons = [outline, ...holes, ...blockers];
  return candidates.flatMap(([a, b]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < 1) return [];
    const normal: Point = [-dz / length, dx / length];
    const point = (t: number, offset = 0): Point => [a[0] + dx * t + normal[0] * offset, a[1] + dz * t + normal[1] * offset];
    const cuts = [0, 1];
    for (const offset of [0, -half, half]) for (const poly of polygons) for (let i = 0; i < poly.length; i++) {
      const p = point(0, offset), c = poly[i], d = poly[(i + 1) % poly.length];
      const sx = d[0] - c[0], sz = d[1] - c[1], denominator = dx * sz - dz * sx;
      if (Math.abs(denominator) < 1e-8) continue;
      const t = ((c[0] - p[0]) * sz - (c[1] - p[1]) * sx) / denominator;
      const u = ((c[0] - p[0]) * dz - (c[1] - p[1]) * dx) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((x, y) => x - y);
    const ranges: [number, number][] = [];
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1], hi = cuts[i];
      if ((hi - lo) * length < .01) continue;
      const center = point((lo + hi) / 2);
      const supported = [-half, half].every(offset => {
        const p = point((lo + hi) / 2, offset);
        return polygonContainsPoint(outline, p) && !holes.some(hole => polygonContainsPoint(hole, p));
      });
      if (!supported || blockers.some(poly => polygonContainsPoint(poly, center))) continue;
      const last = ranges.at(-1);
      if (last && Math.abs(last[1] - lo) < 1e-8) last[1] = hi;
      else ranges.push([lo, hi]);
    }
    return ranges.filter(([lo, hi]) => (hi - lo) * length >= 80).map(([lo, hi]): GuardSegment => [point(lo), point(hi)]);
  });
}

export function livingVoidGuards(living: VoidDraft, floor: Floor, boundaries: Boundary[], style: RailingStyle, stair?: StairDraft): GuardSegment[] {
  if (living.w <= 0 || living.d <= 0) return [];
  const inset = railingThickness(style) / 2 + 20;
  const expanded = rect({ x: living.x - inset, z: living.z - inset, w: living.w + 2 * inset, d: living.d + 2 * inset });
  const holes = [rect(living), ...floor.rooms.filter(r => r.kind === "void").map(roomOutline), ...(stair ? [rect(stairOpeningBounds(stair))] : [])];
  return supportedSegments(expanded.map((p, i) => [p, expanded[(i + 1) % 4]]), floor, boundaries, holes, style);
}

export function stairFloorGuards(stair: StairDraft, floor: Floor, boundaries: Boundary[], style: RailingStyle, living?: VoidDraft): GuardSegment[] {
  const hole = stairOpeningBounds(stair), center: Point = [hole.x + hole.w / 2, hole.z + hole.d / 2];
  const inset = railingThickness(style) / 2 + 20;
  const shape = stairShape(stair), railInset = Math.max(60, inset);
  const candidates = stairOpeningRails(stair).map(([a, b]): GuardSegment => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    let nx = -dz / length, nz = dx / length;
    if (nx * ((a[0] + b[0]) / 2 - center[0]) + nz * ((a[1] + b[1]) / 2 - center[1]) < 0) { nx *= -1; nz *= -1; }
    // 角部相交；通口端不沿梯段入口方向加长，保留起步与到达的通行宽度。
    const shift = (p: Point, sign: number): Point => {
      const point: Point = [p[0] + nx * inset + dx / length * sign, p[1] + nz * inset + dz / length * sign];
      const local = shape.local(p[0], p[1]);
      // 梯井口横段接到两条梯段的内侧轴线。只伸至边侧扶手，不跨通行口。
      if (Math.abs(local.along) < .1) for (const offset of [shape.lowerAcross, shape.upperAcross]) {
        const inner = offset === 0 ? offset + stair.flight : offset;
        if (Math.abs(local.across - inner) > .1) continue;
        const target = shape.point(offset + (offset === 0 ? stair.flight - railInset : railInset), -inset);
        return [target.x, target.z];
      }
      return point;
    };
    const corner = (p: Point) => (Math.abs(p[0] - hole.x) < 1 || Math.abs(p[0] - hole.x - hole.w) < 1)
      && (Math.abs(p[1] - hole.z) < 1 || Math.abs(p[1] - hole.z - hole.d) < 1);
    return [shift(a, corner(a) ? -inset : 0), shift(b, corner(b) ? inset : 0)];
  });
  const holes = [rect(hole), ...floor.rooms.filter(r => r.kind === "void").map(roomOutline), ...(living && living.w > 0 && living.d > 0 ? [rect(living)] : [])];
  return supportedSegments(candidates, floor, boundaries, holes, style);
}
