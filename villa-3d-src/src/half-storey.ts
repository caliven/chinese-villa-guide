import type { VillaParams, VillaParamsIssue } from "./villa-params.ts";
import { site, floors, circulation } from "./data.ts";
import { roofTileInset, slabToTileEaveLift } from "./roof-options.ts";
import { clipRailingBelowRoof } from "./roof-railing-clearance.ts";
import type { Object3D, Vector3 } from "three";
import type { Facade } from "./facades.ts";

/** 两层半层高从本层完成面起算，半层高度量至檐口板顶，含120板厚。 */
export function halfStoreyDefaults(base: VillaParams): VillaParams {
  const porticoColumnSize = 700;
  return {
    ...base,
    halfStoreyHeightMode: "storey",
    thirdFloorMode: "flush",
    thirdSetback: 0,
    floor1Height: 3600,
    floor2Height: 3300,
    floor3Height: 2000,
    porticoColumnSize,
    porticoColumnWallGap: base.porticoProjection - porticoColumnSize / 2,
  };
}

/** 候选包络预算，不依赖尚未应用的 site。预留脊瓦130；实际最高点由屋面几何计算。 */
export function halfStoreyHeightProfile(p: VillaParams) {
  const inset = p.gutterOuterTopWidth + p.gutterClearWidth + 55 - p.gutterTileOverhang;
  const run = (Math.min(p.mainWidth, p.mainDepth) + 2 * p.thirdEave - 2 * inset) / 2;
  const roofHeight = p.gutterInnerDepth + p.gutterTileGap + run * p.roofFenShui / 10 + 130;
  const firstFloorTop = p.entranceRise + p.floor1Height;
  const halfFloorY = firstFloorTop + p.floor2Height;
  return {
    firstFloorTop,
    envelopeHeight: p.floor3Height + roofHeight,
    peak: halfFloorY + p.floor3Height + roofHeight,
  };
}

/** 旧半层稿存的是院坪到二层、半层到屋脊预算。转换一次后随参数保存标记。 */
export function normalizeHalfStoreyParams(p: VillaParams, raw: Partial<VillaParams>): VillaParams {
  const next = { ...p, halfStoreyHeightMode: "storey" as const, thirdFloorMode: "flush" as const, thirdSetback: 0 };
  if (raw.halfStoreyHeightMode !== "storey") {
    if (raw.floor1Height !== undefined) next.floor1Height = p.floor1Height - p.entranceRise;
    if (raw.floor3Height !== undefined) {
      const roofHeight = halfStoreyHeightProfile(next).envelopeHeight - next.floor3Height;
      next.floor3Height = Math.round(p.floor3Height - roofHeight);
    }
  }
  return next;
}
export function initializeHalfStorey() {
  // 半层仍布置居住房间，具体布局由本方案独立保存的户型稿提供。
  floors[2].name = "半层";
  floors[1].rooms = floors[1].rooms.map(room => room.kind === "void"
    ? { ...room, name: "西北卧室", kind: "bed" as const, note: "原挑空区补齐楼板，作为独立卧室。" } : room);
  for (const room of floors[0].rooms) {
    if (room.name.includes("挑空")) room.name = room.name.replace("挑空", "");
  }
  circulation.livingVoid = { ...circulation.livingVoid, w: 0, d: 0 };
}
export function validateHalfStoreyParams(p: VillaParams): VillaParamsIssue[] {
  const issues: VillaParamsIssue[] = [];
  if (p.floor1Height < 3000) issues.push({ field: "floor1Height", message: "两层半方案的一层层高须至少3000（入户抬高另计）" });
  if (p.floor2Height < 3000) issues.push({ field: "floor2Height", message: "两层半方案的二层层高须至少3000" });
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
  return { x, z, w, d, slope, eave, peak, wallTop: eave - slabToTileEaveLift() };
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
