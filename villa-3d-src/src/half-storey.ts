import type { VillaParams, VillaParamsIssue } from "./villa-params";
import { site, floors } from "./data";
import { roofTileInset, roofTileEaveLift } from "./roof-options";
import { clipRailingBelowRoof } from "./roof-railing-clearance";
import type { Object3D, Vector3 } from "three";
import type { Facade } from "./facades";

/** 两层半独立初始参数：首层参数含450抬高，半层高度是到脊瓦最高点的总预算。 */
export function halfStoreyDefaults(base: VillaParams): VillaParams {
  return { ...base, floor1Height: 3750, floor2Height: 3000, floor3Height: 3000 };
}
export function initializeHalfStorey() {
  const floor = floors[2], m = site.main;
  floor.name = "半层";
  floor.rooms = [
    ...floor.rooms.filter(room => room.kind === "stair"),
    { id: "attic-activity", name: "中央活动区 · 净高待核", kind: "living", x: m.x + 3000, z: (floor.front + m.z + m.d) / 2 - 1000, w: Math.max(1000, m.w - 6000), d: 2000 },
    { id: "attic-storage", name: "坡脚储藏区", kind: "store", x: m.x + 300, z: floor.front + 300, w: Math.max(1000, m.w - 600), d: 1200 },
  ];
  floor.partitions = [];
  floor.furniture = [];
}
export function validateHalfStoreyParams(p: VillaParams): VillaParamsIssue[] {
  const issues: VillaParamsIssue[] = [];
  if (p.floor1Height - p.entranceRise < 3000) issues.push({ field: "floor1Height", message: "两层半方案的一层完成面层高须至少3000（另计室内抬高）" });
  if (p.floor2Height < 3000) issues.push({ field: "floor2Height", message: "两层半方案的二层层高须至少3000" });
  if (p.floor1Height + p.floor2Height + p.floor3Height > 10000) issues.push({ field: "floor3Height", message: "屋脊最高点不能超过10000，请调整层高或半层屋脊预算" });
  const inset = p.gutterOuterTopWidth + p.gutterClearWidth + 55 - p.gutterTileOverhang;
  const run = (Math.min(p.mainWidth + 2 * p.thirdEave, p.mainDepth - (p.thirdFloorMode === "flush" ? 0 : p.thirdSetback) + 2 * p.thirdEave) - 2 * inset) / 2;
  const knee = p.floor3Height - 130 - (30 + p.gutterInnerDepth + p.gutterTileGap) - run * p.roofFenShui / 10;
  if (knee < 300) issues.push({ field: "floor3Height", message: "当前坡度、出檐与半层预算使矮墙不足300，请增加预算或调整屋面" });
  const annexInset = p.annexGutterOuterTopWidth + p.annexGutterClearWidth + 55 - p.annexGutterTileOverhang;
  const annexPeak = p.annexHeight + 30 + p.annexGutterInnerDepth + p.annexGutterTileGap + (Math.min(p.annexWidth, p.annexDepth) + 2 * p.annexEave - 2 * annexInset) / 2 * p.annexRoofFenShui / 10;
  if (annexPeak + 1720 > 10000) issues.push({ field: "annexHeight", message: "辅楼屋面与烟囱高度预算超过10000，请降低辅楼或屋面" });
  return issues;
}
export function halfStoreyRoof() {
  const m = site.main, e = site.thirdEave;
  const x = m.x - e + roofTileInset, z = floors[2].front - e + roofTileInset;
  const w = m.w + 2 * e - 2 * roofTileInset;
  const d = m.z + m.d + e - roofTileInset - z;
  const slope = site.roofFenShui / 10;
  const peak = floors[2].y + floors[2].height;
  const eave = peak - 130 - Math.min(w, d) / 2 * slope;
  return { x, z, w, d, slope, eave, peak, wallTop: eave - roofTileEaveLift() };
}
/** 独立的四面半层围护，不带旧三楼门厅返墙或默认露台门窗。 */
export function halfStoreyFacades(): Facade[] {
  const m = site.main, front = floors[2].front, back = m.z + m.d, east = m.x + m.w;
  return [
    { a: [m.x, front + 120], b: [east, front + 120], openings: [] },
    { a: [m.x + 120, front], b: [m.x + 120, back], openings: [] },
    { a: [east - 120, front], b: [east - 120, back], openings: [] },
    { a: [m.x, back - 120], b: [east, back - 120], openings: [] },
  ];
}
/** 复用已有四坡面裁切算法；只在新方案中裁切墙、隔断和家具，不改变保存的尺寸。 */
export function clipHalfStorey(root: Object3D) {
  if (root.userData.halfStoreyClipped) return;
  clipRailingBelowRoof(root, halfStoreyRoof(), 220);
  root.userData.halfStoreyClipped = true;
}
/** 立面与实体采用同一坡下边界，避免把半层画成平顶矮墙。 */
export function clipHalfStoreyPolygon(points: Vector3[]) {
  const r = halfStoreyRoof();
  const planes = [
    (p: Vector3) => r.eave + r.slope * (p.x - r.x) - 220 - p.y,
    (p: Vector3) => r.eave + r.slope * (r.x + r.w - p.x) - 220 - p.y,
    (p: Vector3) => r.eave + r.slope * (p.z - r.z) - 220 - p.y,
    (p: Vector3) => r.eave + r.slope * (r.z + r.d - p.z) - 220 - p.y,
  ];
  for (const plane of planes) {
    const next: Vector3[] = [];
    points.forEach((a, i) => {
      const b = points[(i + 1) % points.length], da = plane(a), db = plane(b);
      if (da >= 0) next.push(a);
      if ((da >= 0) !== (db >= 0)) next.push(a.clone().lerp(b, da / (da - db)));
    });
    points = next;
  }
  return points;
}
