import { construction, isPhysicalWall, site, type Floor, type Wall } from "./data";
import type { StairDraft } from "./layout-draft";

/** 图上统一到整数毫米端点；先取端点再相减，分段之和才能严格等于总尺寸。 */
export const planDimMm = (value: number) => Math.round(value);
export const planDimSpanMm = (a: number, b: number) => Math.round(b) - Math.round(a);

type Envelope = { x: number; z: number; w: number; d: number };
export type PlanBuilding = "main" | "annex";

/** 只去掉同一毫米上的重复引用，不用墙厚阈值吞并两道真实墙线。 */
function axes(values: number[], lo: number, hi: number): number[] {
  const start = Math.round(lo);
  const end = Math.round(hi);
  return [...new Set([start, end, ...values.filter(Number.isFinite).map((v) => Math.round(v))])]
    .filter((v) => v >= start && v <= end)
    .sort((a, b) => a - b);
}

/**
 * 外圈墙距只来自实体墙（承重／隔墙）；虚拟分界不投线、不拆段。
 * 只投到实际相交的那一侧外墙：接北标北、接南标南；贯通南北／东西时只标一侧，避免对边重复。
 * 当前编辑器的墙为正交墙，斜墙不冒充水平／竖直定位线。
 */
function wallAxes(body: Envelope, walls: Wall[]) {
  const north = new Map<number, number>(), south = new Map<number, number>();
  const east = new Map<number, number>(), west = new Map<number, number>();
  const vertical = new Map<number, [number, number]>(), horizontal = new Map<number, [number, number]>();
  const x0 = body.x, x1 = body.x + body.w, z0 = body.z, z1 = body.z + body.d;
  const eps = 1;
  const t = construction.outsideWall;
  const collect = (map: Map<number, [number, number]>, at: number, lo: number, hi: number) => {
    const key = planDimMm(at), previous = map.get(key);
    map.set(key, previous ? [Math.min(previous[0], lo), Math.max(previous[1], hi)] : [lo, hi]);
  };
  for (const wall of walls) {
    if (!isPhysicalWall(wall)) continue;
    if (![...wall.a, ...wall.b].every(Number.isFinite)) continue;
    const wx0 = Math.min(wall.a[0], wall.b[0]), wx1 = Math.max(wall.a[0], wall.b[0]);
    const wz0 = Math.min(wall.a[1], wall.b[1]), wz1 = Math.max(wall.a[1], wall.b[1]);
    if (wx1 - wx0 < eps && wz1 - wz0 >= eps) {
      const x = (wx0 + wx1) / 2;
      if (x <= x0 + t || x >= x1 - t) continue;
      if (wz1 <= z0 + t || wz0 >= z1 - t) continue;
      collect(vertical, x, Math.max(z0, wz0), Math.min(z1, wz1));
    } else if (wz1 - wz0 < eps && wx1 - wx0 >= eps) {
      const z = (wz0 + wz1) / 2;
      if (z <= z0 + t || z >= z1 - t) continue;
      if (wx1 <= x0 + t || wx0 >= x1 - t) continue;
      collect(horizontal, z, Math.max(x0, wx0), Math.min(x1, wx1));
    }
  }
  for (const [at, [lo, hi]] of vertical) {
    const touchesNorth = lo - z0 <= t + eps;
    const touchesSouth = z1 - hi <= t + eps;
    // 贯通南北只标南侧，避免上下同一道墙重复；单侧相接则只标该侧。
    if (touchesNorth && touchesSouth) south.set(at, hi);
    else if (touchesNorth) north.set(at, lo);
    else if (touchesSouth) south.set(at, hi);
  }
  for (const [at, [lo, hi]] of horizontal) {
    const touchesWest = lo - x0 <= t + eps;
    const touchesEast = x1 - hi <= t + eps;
    // 贯通东西只标西侧，避免左右重复。
    if (touchesWest && touchesEast) west.set(at, lo);
    else if (touchesWest) west.set(at, lo);
    else if (touchesEast) east.set(at, hi);
  }
  return {
    north: axes([...north.keys()], x0, x1), south: axes([...south.keys()], x0, x1),
    east: axes([...east.keys()], z0, z1), west: axes([...west.keys()], z0, z1),
    horizontalFrom: (side: "north" | "south", x: number) =>
      (side === "north" ? north : south).get(planDimMm(x)) ?? (side === "north" ? z0 : z1),
    verticalFrom: (side: "east" | "west", z: number) =>
      (side === "east" ? east : west).get(planDimMm(z)) ?? (side === "east" ? x1 : x0),
  };
}

export function collectPlanDimensions(index: number, floor: Floor, annexWalls: Wall[], building: PlanBuilding = "main", stair?: StairDraft) {
  // 后墙来自外包络；不能用 floor.front + (main.d - setback)，旧稿前缘会把后墙算偏。
  const south = site.main.z + site.main.d;
  const main = { ...site.main, z: floor.front, d: south - floor.front };
  const mainAxes = wallAxes(main, floor.partitions);
  const annexAxes = wallAxes(site.annex, annexWalls);
  const body = building === "annex" ? site.annex : main;
  const bodyAxes = building === "annex" ? annexAxes : mainAxes;
  const lo = body.x;
  const hi = body.x + body.w;
  // 有楼梯间时，只在实际贴靠的那一侧外侧链插入梯间左右边（贯通南北时只标南侧，避免对边重复）。
  let northXs = bodyAxes.north;
  let southXs = bodyAxes.south;
  if (building === "main" && stair) {
    const r = stair.room;
    const x0 = planDimMm(r.x), x1 = planDimMm(r.x + r.w);
    if (x1 > x0) {
      const t = construction.outsideWall;
      const touchesNorth = Math.abs(r.z - body.z) <= t + 1;
      const touchesSouth = Math.abs(r.z + r.d - (body.z + body.d)) <= t + 1;
      if (touchesNorth && touchesSouth) southXs = axes([...southXs, x0, x1], lo, hi);
      else if (touchesNorth) northXs = axes([...northXs, x0, x1], lo, hi);
      else if (touchesSouth) southXs = axes([...southXs, x0, x1], lo, hi);
    }
  }
  // 主楼：门厅两柱心＋主楼西／东外皮 → 左余量｜柱心距｜右余量（默认 4500＋4600＋4500）。
  // 辅楼：无门厅控制档，controls 仅外皮两端。
  const porch = site.portico;
  const controlBreaks =
    building === "main"
      ? axes([porch.x, porch.x + porch.w], lo, hi)
      : axes([], lo, hi);
  return {
    controls: controlBreaks, northXs, southXs,
    northDetail: northXs.length > 2,
    southDetail: southXs.length > 2,
    eastZs: bodyAxes.east, westZs: bodyAxes.west, annexZs: annexAxes.west,
    xLo: planDimMm(lo), xHi: planDimMm(hi),
    front: planDimMm(body.z), south: planDimMm(body.z + body.d),
    horizontalFrom: bodyAxes.horizontalFrom, verticalFrom: bodyAxes.verticalFrom,
  };
}

/** 两张图共用真实场地坐标，图纸留白不计入子孙道或总宽。 */
export function collectPlanSiteDimensions() {
  const breaks = [0, site.annex.x, site.annex.x + site.annex.w, site.main.x, site.main.x + site.main.w, site.width];
  return {
    widthSegmentsMm: breaks.slice(1).map((v, i) => planDimSpanMm(breaks[i], v)),
    totalWidthMm: planDimSpanMm(0, site.width),
    mainDepthMm: planDimSpanMm(site.main.z, site.main.z + site.main.d),
    annexDepthMm: planDimSpanMm(site.annex.z, site.annex.z + site.annex.d),
    annexSetbackMm: planDimSpanMm(site.main.z, site.annex.z),
  };
}
