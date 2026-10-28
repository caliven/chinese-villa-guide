import { construction, site, type Floor, type Wall } from "./data";

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
 * 外圈定位来自接触外墙的实体墙或虚拟分界；房屋内部悬空线不投线、不拆段。
 * 按实际相交侧分别投线：接北标北、接南标南；贯通墙在两端外墙均保留定位。
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
    if (touchesNorth) north.set(at, lo);
    if (touchesSouth) south.set(at, hi);
  }
  for (const [at, [lo, hi]] of horizontal) {
    const touchesWest = lo - x0 <= t + eps;
    const touchesEast = x1 - hi <= t + eps;
    if (touchesWest) west.set(at, lo);
    if (touchesEast) east.set(at, hi);
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

export function collectPlanDimensions(index: number, floor: Floor, annexWalls: Wall[], building: PlanBuilding = "main", porch = site.portico) {
  // 后墙来自外包络；不能用 floor.front + (main.d - setback)，旧稿前缘会把后墙算偏。
  const south = site.main.z + site.main.d;
  const main = { ...site.main, z: floor.front, d: south - floor.front };
  const mainAxes = wallAxes(main, floor.partitions);
  const annexAxes = wallAxes(site.annex, annexWalls);
  const body = building === "annex" ? site.annex : main;
  const bodyAxes = building === "annex" ? annexAxes : mainAxes;
  const lo = body.x;
  const hi = body.x + body.w;
  // 楼梯只是模型，不是墙；其框边不参与外圈墙线定位，也不与自画侧墙拆出碎档。
  const northXs = bodyAxes.north;
  const southXs = bodyAxes.south;
  // 主楼：堂屋两端分档线＋主楼西／东外皮；门头朝下默认4500＋4600＋4500。
  // 辅楼：无门厅控制档，controls 仅外皮两端。
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
  const breaks = [0, site.annex.x, site.annex.x + site.annex.w, site.main.x, site.main.x + site.main.w, site.width].sort((a, b) => a - b);
  return {
    widthSegmentsMm: breaks.slice(1).map((v, i) => planDimSpanMm(breaks[i], v)),
    totalWidthMm: planDimSpanMm(0, site.width),
    mainDepthMm: planDimSpanMm(site.main.z, site.main.z + site.main.d),
    annexDepthMm: planDimSpanMm(site.annex.z, site.annex.z + site.annex.d),
    annexSetbackMm: planDimSpanMm(site.main.z, site.annex.z),
  };
}
