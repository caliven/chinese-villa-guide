import { threeFlightShape, threeFlightCounts } from "./three-flight-stair";
import { construction, floors, site, wallRoleOf, isPhysicalWall, type Floor } from "./data";
import type { StairDraft } from "./layout-draft";

export type StairRect = { x: number; z: number; w: number; d: number };
export type StairShapeInput = Pick<StairDraft, "model" | "x" | "z" | "axis" | "flight" | "gap" | "tread" | "middleTread" | "risers" | "landing" | "lowerSide" | "direction">;

/** 毫米制实体梯段共用几何；南北向默认在图左（东侧）起步，返跑下方在图右。 */
export function stairShape(s: StairShapeInput) {
  if (s.model === "triple") return threeFlightShape(s);
  const risers = Math.max(4, Math.round(s.risers));
  const lowerRisers = Math.floor(risers / 2), upperRisers = risers - lowerRisers;
  const lowerTreads = lowerRisers - 1, upperTreads = upperRisers - 1;
  const run = Math.max(lowerTreads, upperTreads) * s.tread;
  const length = run + s.landing;
  const across = 2 * s.flight + s.gap;
  const lowerSide = s.lowerSide ?? (s.axis === "z" ? "max" : "min");
  const lowerAcross = lowerSide === "min" ? 0 : s.flight + s.gap;
  const upperAcross = lowerSide === "min" ? s.flight + s.gap : 0;
  const direction = s.direction ?? "positive";
  const point = (cross: number, along: number) => {
    const distance = direction === "negative" ? length - along : along;
    return s.axis === "z" ? { x: s.x + cross, z: s.z + distance } : { x: s.x + distance, z: s.z + cross };
  };
  const local = (x: number, z: number) => {
    const distance = s.axis === "z" ? z - s.z : x - s.x;
    return { across: s.axis === "z" ? x - s.x : z - s.z, along: direction === "negative" ? length - distance : distance };
  };
  const rect = (cross: number, along: number, width: number, depth: number): StairRect => {
    const a = point(cross, along), b = point(cross + width, along + depth);
    return { x: Math.min(a.x, b.x), z: Math.min(a.z, b.z), w: Math.abs(b.x - a.x), d: Math.abs(b.z - a.z) };
  };
  return {
    model: "double" as const, risers, lowerRisers, upperRisers, lowerTreads, upperTreads, run, across,
    lowerSide, lowerAcross, upperAcross, direction, length, point, local, rect,
    lowerStart: run - lowerTreads * s.tread,
    upperStart: run - upperTreads * s.tread,
    lower: rect(lowerAcross, run - lowerTreads * s.tread, s.flight, lowerTreads * s.tread),
    upper: rect(upperAcross, run - upperTreads * s.tread, s.flight, upperTreads * s.tread),
    landing: rect(0, run, across, s.landing),
    footprint: rect(0, 0, across, run + s.landing),
  };
}

function union(...rs: StairRect[]): StairRect {
  const x = Math.min(...rs.map(r => r.x)), z = Math.min(...rs.map(r => r.z));
  return { x, z, w: Math.max(...rs.map(r => r.x + r.w)) - x, d: Math.max(...rs.map(r => r.z + r.d)) - z };
}

/** 上层楼板洞口至少包含实际两跑与平台，不能让草稿踏步穿入楼板。 */
export const stairOpeningBounds = (s: StairDraft) => union(s.hole, stairShape(s).footprint);
/** 梯间定位包住实体与洞口；贴边排布后的范围与梯间框一致。 */
export const stairWellBounds = (s: StairDraft) => union(s.room, stairOpeningBounds(s));

/** 顶层显示下层来梯；首层实际升高扣除入口完成面高差。 */
export function stairStoryHeight(floorList: Floor[], index: number): number {
  const from = Math.max(0, Math.min(index, floorList.length - 2));
  return floorList[from].height - (from === 0 ? site.entranceRise : 0);
}

/** 洞口围栏在上跑到达端留出整跑宽入口，反向后入口随实体换边。 */
export function stairOpeningRails(s: StairDraft): [number, number][][] {
  const opening = stairOpeningBounds(s), shape = stairShape(s);
  const crossMin = s.axis === "x" ? opening.z : opening.x;
  const crossMax = crossMin + (s.axis === "x" ? opening.d : opening.w);
  const alongMin = s.axis === "x" ? opening.x : opening.z;
  const alongMax = alongMin + (s.axis === "x" ? opening.w : opening.d);
  const entry = shape.direction === "negative" ? alongMax : alongMin;
  const far = shape.direction === "negative" ? alongMin : alongMax;
  const start = Math.max(crossMin, (s.axis === "x" ? s.z : s.x) + shape.upperAcross);
  const end = Math.min(crossMax, start + s.flight);
  const point = (cross: number, along: number): [number, number] => s.axis === "x" ? [along, cross] : [cross, along];
  return [
    [point(crossMin, entry), point(crossMin, far)],
    [point(crossMin, far), point(crossMax, far)],
    [point(crossMax, far), point(crossMax, entry)],
    ...(start > crossMin ? [[point(crossMin, entry), point(start, entry)]] : []),
    ...(end < crossMax ? [[point(end, entry), point(crossMax, entry)]] : []),
  ];
}

/**
 * 用梯间框排布两跑和平台，只为真实墙体留厚度，不保留历史踏步／洞口的四周内偏。
 * 三层共用墙内侧包络，保持上下跑贯通；返回派生几何，不改写已保存的草稿。
 */
export function fitStairToRoom(s: StairDraft, floorList: Floor[] = floors): StairDraft {
  const r = s.room, eps = 1;
  let x0 = r.x, x1 = r.x + r.w, z0 = r.z, z1 = r.z + r.d;
  const outer = construction.outsideWall;
  const front = floorList[0]?.front ?? site.main.z;
  const back = site.main.z + site.main.d;
  if (Math.abs(r.x - site.main.x) <= outer + eps) x0 = Math.max(x0, site.main.x + outer);
  if (Math.abs(x1 - (site.main.x + site.main.w)) <= outer + eps) x1 = Math.min(x1, site.main.x + site.main.w - outer);
  if (Math.abs(r.z - front) <= outer + eps) z0 = Math.max(z0, front + outer);
  if (Math.abs(z1 - back) <= outer + eps) z1 = Math.min(z1, back - outer);
  // 只用用户画的隔墙／承重墙取内侧净空；楼梯不再自带侧墙。
  const walls = floorList.flatMap((floor) => floor.partitions);
  const overlaps = (a: number, b: number, lo: number, hi: number) =>
    Math.min(a, b) < hi - eps && Math.max(a, b) > lo + eps;
  for (const wall of walls) {
    if (!isPhysicalWall(wall)) continue;
    const half = (wallRoleOf(wall) === "bearing" ? outer : construction.partition) / 2;
    // 直接取实体墙内侧的包络；共用、重叠或交叉的墙取 max/min，厚度不累加。
    if (Math.abs(wall.a[0] - wall.b[0]) < 1 && overlaps(wall.a[1], wall.b[1], r.z, r.z + r.d)) {
      const at = (wall.a[0] + wall.b[0]) / 2;
      if (Math.abs(at - r.x) <= half + eps) x0 = Math.max(x0, at + half);
      if (Math.abs(at - (r.x + r.w)) <= half + eps) x1 = Math.min(x1, at - half);
    } else if (Math.abs(wall.a[1] - wall.b[1]) < 1 && overlaps(wall.a[0], wall.b[0], r.x, r.x + r.w)) {
      const at = (wall.a[1] + wall.b[1]) / 2;
      if (Math.abs(at - r.z) <= half + eps) z0 = Math.max(z0, at + half);
      if (Math.abs(at - (r.z + r.d)) <= half + eps) z1 = Math.min(z1, at - half);
    }
  }
  const across = Math.max(100, s.axis === "z" ? x1 - x0 : z1 - z0);
  const along = Math.max(100, s.axis === "z" ? z1 - z0 : x1 - x0);
  if (s.model === "triple") {
    const counts = threeFlightCounts(s.risers);
    const landing = Math.min(s.landing, across / 3, along / 2);
    const flight = Math.min(s.flight, landing);
    // 两个轴分别排满净包络；不能再用原踏面进深封顶，否则放大只有空边框。
    const tread = Math.max(1, (along - landing) / (counts.outer - 1));
    const middleTread = Math.max(1, (across - 2 * landing) / (counts.middle - 1));
    return { ...s, x: x0, z: z0, flight, landing, tread, middleTread,
      hole: { x: x0, z: z0, w: x1 - x0, d: z1 - z0 } };
  }
  const gap = Math.min(s.gap, across / 3);
  const landing = Math.min(s.landing, along / 2);
  const risers = Math.max(4, Math.round(s.risers));
  const treadCount = Math.max(Math.floor(risers / 2), Math.ceil(risers / 2)) - 1;
  return {
    ...s,
    x: x0, z: z0,
    flight: (across - gap) / 2,
    gap, landing,
    tread: (along - landing) / treadCount,
    // 洞口与本次实体同步，不能继续把旧洞口的偏移和空白并进来。
    hole: { x: x0, z: z0, w: s.axis === "z" ? across : along, d: s.axis === "z" ? along : across },
  };
}

/** 切换模型使用常用住宅概念规格，保留中心与方向；不改写其它房间和墙。 */
export function stairModelDefaults(s: StairDraft, model: "double" | "triple", floorList: Floor[] = floors): StairDraft {
  const maxHeight = Math.max(...floorList.slice(0, -1).map((_, i) => stairStoryHeight(floorList, i)), 3000);
  const risers = Math.max(12, Math.min(40, Math.ceil(maxHeight / 175)));
  const next = { ...s, model, flight: 1100, tread: 280, middleTread: model === "triple" ? 280 : undefined, landing: 1200, gap: 180, risers };
  const body = stairShape(next).footprint;
  const x = Math.round(s.room.x + (s.room.w - body.w) / 2), z = Math.round(s.room.z + (s.room.d - body.d) / 2);
  return { ...next, x, z, room: { x, z, w: body.w, d: body.d }, hole: { x, z, w: body.w, d: body.d } };
}
