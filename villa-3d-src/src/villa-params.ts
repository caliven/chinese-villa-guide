import { mirrorRoom, mirrorWall, mirrorFurniture, porticoFrontZ, porticoWallZ, resizeThirdFloorFront, type PorticoStyle, type BuildingPlacement, type ThirdFloorMode } from "./building-variants";
/**
 * 方案尺寸参数（长度一律毫米）：总面宽锁定 21000 mm；改参后重算场地／主辅楼／院坪，
 * 并按主楼／辅楼面宽、进深轴向比例缩放室内房间与家具（相对默认几何，不叠乘）。
 *
 * 主辅楼改面宽／进深时以南墙、东墙为不动点：只动北墙与西墙。
 * 西侧间距由「东侧＋主楼＋子孙道＋辅楼」反推；辅楼后墙与主楼齐平，内退＝主楼进深−辅楼进深。
 */
import {
  site,
  floors,
  annexRooms,
  annexFurniture,
  annexPartitions,
  frontElevation,
  neighborCourtyardPlan,
  stairLayout,
  circulation,
  construction,
  courtyardArcAnchors,
  circleThrough,
  rebuildCourtyardGeometry,
  syncSideDoorToLivingBridge,
  type Floor,
  type Room,
  type Wall,
  type Furniture,
  type Point,
} from "./data";
import {
  roofGutterDesign,
  annexRoofGutterDesign,
  annexEaveTrimDesign,
  floatingHatDesign,
  eaveTrimDesign,
  roofTileInset,
  syncRoofTileInset,
} from "./roof-options";
import { rebuildTerraceLinkage, syncNeighborFootprint, syncRoadsideVillaPlacement } from "./surroundings";
import { rebuildGarageLayout } from "./garage-layout";
import { rebuildVehicleRoute } from "./vehicle-route";
import { mainEaveY } from "./facades";
import { ensureFurnitureWallClearance } from "./layout-align";
import { formatMm, isMeterLengthPayload, migrateVillaParamsToMm } from "./units";
import { porticoColumnCenters, porticoColumnOuterWidth, porticoWestOffset } from "./frontage-geometry";
import { interiorRailing, isRailingStyle, type RailingStyle } from "./railing-options";

export const LOCKED_SITE_WIDTH = 21000;
/** @deprecated 已改存 scheme 文件，仅供旧迁移识别。 */
export const villaParamsPreferenceKey = "anhua-villa-params-v1";

export interface VillaParams {
  livingRailingStyle: RailingStyle;
  stairRailingStyle: RailingStyle;
  porticoStyle: PorticoStyle;
  buildingPlacement: BuildingPlacement;
  thirdFloorMode: ThirdFloorMode;
  westGap: number;
  eastGap: number;
  lane: number;
  mainWidth: number;
  mainDepth: number;
  floor1Height: number;
  floor2Height: number;
  floor3Height: number;
  thirdSetback: number;
  secondFrontEave: number;
  thirdEave: number;
  porticoWidth: number;
  porticoProjection: number;
  porticoColumnSize: number;
  porticoColumnWallGap: number;
  /** 包角柱比墙面外凸（毫米）；正面／侧面同值，默认 150＝15 cm */
  cornerProject: number;
  annexWidth: number;
  annexDepth: number;
  annexHeight: number;
  annexSetback: number;
  annexEave: number;
  roofFenShui: number;
  gutterClearWidth: number;
  /** 天沟外边反坎高度（槽底以上） */
  gutterClearDepth: number;
  /** 天沟内侧反坎高度；默认高于外侧，满水外溢 */
  gutterInnerDepth: number;
  /** 外边反坎顶部宽度 */
  gutterOuterTopWidth: number;
  /** 槽底找坡（整数度；旧稿 0～0.05 小数坡度加载时会迁成度） */
  gutterBedSlope: number;
  /** 瓦檐底到内侧挡墙顶的竖直间距 */
  gutterTileGap: number;
  /** 瓦边超出内挡沟侧、探入天沟的水平长度 */
  gutterTileOverhang: number;
  gutterCopingSlope: number;
  /** 梁托出挑长度 */
  corbelLength: number;
  /** 同墙面相邻梁托中心距 */
  corbelSpacing: number;
  /** 直角拐角两侧梁托中心沿外沿路径间距 */
  corbelCornerSpacing: number;
  /** 三眼皮最底层底面到下沿线上沿 */
  eyelidToFasciaGap: number;
  /** 辅楼屋面独立控制；不包含官帽。 */
  annexRoofFenShui: number;
  annexGutterClearWidth: number;
  annexGutterClearDepth: number;
  annexGutterInnerDepth: number;
  annexGutterOuterTopWidth: number;
  annexGutterBedSlope: number;
  annexGutterTileGap: number;
  annexGutterTileOverhang: number;
  annexGutterCopingSlope: number;
  annexCorbelLength: number;
  annexCorbelSpacing: number;
  annexCorbelCornerSpacing: number;
  annexEyelidToFasciaGap: number;
  floatingHatRidgeDrop: number;
  oldDepth: number;
  rearGap: number;
  entranceRise: number;
  outsideWall: number;
  partition: number;
  courtyardWestTotal: number;
  courtyardMidTotal: number;
  courtyardEastTotal: number;
  /** 中间取样点距东界的距离（毫米） */
  courtyardMidFromEast: number;
  neighborWoodWidth: number;
  neighborWoodDepth: number;
  neighborCementDepth: number;
  neighborYardBeyondCement: number;
}

export const DEFAULT_VILLA_PARAMS: VillaParams = {
  livingRailingStyle: "glass",
  stairRailingStyle: "wood",
  porticoStyle: "projecting",
  buildingPlacement: "main-east",
  thirdFloorMode: "setback",
  westGap: 800,
  eastGap: 800,
  lane: 1800,
  mainWidth: 13600,
  mainDepth: 10000,
  floor1Height: 3600,
  floor2Height: 3600,
  floor3Height: 3300,
  thirdSetback: 1200,
  secondFrontEave: 800,
  thirdEave: 800,
  /** 门厅面宽及柱心距4600；两翼各4500，沿主楼中轴对称。 */
  porticoWidth: 4600,
  porticoProjection: 2000,
  porticoColumnSize: 800,
  /** 派生：外伸 − 半柱；柱心在北沿时内侧到前墙＝外伸−半柱。 */
  porticoColumnWallGap: 1600,
  cornerProject: 150,
  annexWidth: 4000,
  annexDepth: 8000,
  annexHeight: 3600,
  annexSetback: 2000,
  annexEave: 800,
  roofFenShui: 4.5,
  gutterClearWidth: 600,
  gutterClearDepth: 200,
  gutterInnerDepth: 250,
  gutterOuterTopWidth: 300,
  /** 整数度；几何用 tan(°) 转成小数坡度 */
  gutterBedSlope: 1,
  gutterTileGap: 50,
  gutterTileOverhang: 80,
  gutterCopingSlope: 4,
  corbelLength: 500,
  corbelSpacing: 700,
  corbelCornerSpacing: 600,
  eyelidToFasciaGap: 300,
  annexRoofFenShui: 4.5,
  annexGutterClearWidth: 600,
  annexGutterClearDepth: 200,
  annexGutterInnerDepth: 250,
  annexGutterOuterTopWidth: 300,
  annexGutterBedSlope: 1,
  annexGutterTileGap: 50,
  annexGutterTileOverhang: 80,
  annexGutterCopingSlope: 4,
  annexCorbelLength: 500,
  annexCorbelSpacing: 700,
  annexCorbelCornerSpacing: 600,
  annexEyelidToFasciaGap: 300,
  floatingHatRidgeDrop: 500,
  oldDepth: 10800,
  rearGap: 1200,
  entranceRise: 450,
  outsideWall: 240,
  partition: 120,
  courtyardWestTotal: 11000,
  courtyardMidTotal: 15800,
  courtyardEastTotal: 19400,
  courtyardMidFromEast: 11000,
  neighborWoodWidth: 13000,
  neighborWoodDepth: 8800,
  neighborCementDepth: 2000,
  /** 与自家东界外沿齐平后的派生值；应用时按院坪东端重算 */
  neighborYardBeyondCement: 8600,
};

/** 旧稿共用屋面字段到辅楼独立字段的对应关系；用于补齐和单位迁移后的继承。 */
export const ANNEX_ROOF_PARAM_KEYS = {
  roofFenShui: "annexRoofFenShui",
  gutterClearWidth: "annexGutterClearWidth",
  gutterClearDepth: "annexGutterClearDepth",
  gutterInnerDepth: "annexGutterInnerDepth",
  gutterOuterTopWidth: "annexGutterOuterTopWidth",
  gutterBedSlope: "annexGutterBedSlope",
  gutterTileGap: "annexGutterTileGap",
  gutterTileOverhang: "annexGutterTileOverhang",
  gutterCopingSlope: "annexGutterCopingSlope",
  corbelLength: "annexCorbelLength",
  corbelSpacing: "annexCorbelSpacing",
  corbelCornerSpacing: "annexCorbelCornerSpacing",
  eyelidToFasciaGap: "annexEyelidToFasciaGap",
} as const;

/** 门厅两柱柱心落在前沿两角，柱心距等于门厅面宽。 */
export function porticoColumnSpacing(p: VillaParams) {
  return p.porticoWidth;
}

/** 柱内侧（靠墙一面）到前墙外皮：外伸 − 半个柱截面。 */
export function derivedPorticoColumnWallGap(
  p: Pick<VillaParams, "porticoProjection" | "porticoColumnSize">,
) {
  return p.porticoProjection - p.porticoColumnSize / 2;
}

/** 面板存整数度；旧稿 0～0.05 为小数坡度（0.01＝1%）。 */
export function normalizeGutterBedSlopeDegrees(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 0 && value <= 0.05) return Math.min(15, Math.round(value * 100));
  return Math.min(15, Math.max(0, Math.round(value)));
}

/** 几何用：整数度 → 小数坡度（tan）。 */
export function gutterBedSlopeRatioFromDegrees(degrees: number): number {
  return Math.tan((normalizeGutterBedSlopeDegrees(degrees) * Math.PI) / 180);
}

export type VillaParamsIssue = { field?: keyof VillaParams; message: string };

/** 东墙锚定：西侧间距＝总面宽 − 东侧 − 主楼 − 子孙道 − 辅楼。 */
export function derivedWestGap(p: Pick<VillaParams, "eastGap" | "lane" | "mainWidth" | "annexWidth">) {
  return LOCKED_SITE_WIDTH - p.eastGap - p.lane - p.mainWidth - p.annexWidth;
}

/** 后墙齐平：辅楼相对主楼前墙内退＝主楼进深 − 辅楼进深。 */
export function derivedAnnexSetback(p: Pick<VillaParams, "mainDepth" | "annexDepth">) {
  return p.mainDepth - p.annexDepth;
}

/** 不内退时实际退距为零；保留配置退距，便于切回原方案。 */
export function effectiveThirdSetback(p: Pick<VillaParams, "thirdFloorMode" | "thirdSetback">) {
  return p.thirdFloorMode === "flush" ? 0 : p.thirdSetback;
}

/** 三楼主体最小剩余进深（毫米）；再小则房间／楼梯／门洞无法合理布置。 */
export const MIN_THIRD_BODY_DEPTH = 3000;
/** 门厅柱间净宽下限（含柱脚饰线的相向内皮之间）。 */
export const MIN_PORTICO_CLEAR = 900;
/** 两侧露台最小宽度。 */
export const MIN_SIDE_TERRACE = 150;
/** 瓦面相对外包络的最小半跨净尺寸。 */
export const MIN_ROOF_TILE_RUN = 200;
/** 院坪三点拱高下限（相对弦），过小视为近共线。 */
export const MIN_COURTYARD_SAGITTA = 150;
/** 两跑楼梯跨向净宽＝2×梯段＋缝。 */
export function stairAcrossClear(flight: number, gap: number) {
  return 2 * flight + gap;
}

const GUTTER_INNER_WALL = 55;

/** 固定成品家具：只随房屋平移，不随面宽／进深缩放外形。 */
const FIXED_FURNITURE_KINDS = new Set<Furniture["kind"]>([
  "bed",
  "toilet",
  "squatToilet",
  "shower",
  "roundTable",
  "basin",
  "chair",
  "hob",
  "sink",
  "stove",
]);

function predictedTileInset(p: VillaParams) {
  return p.gutterOuterTopWidth + p.gutterClearWidth + GUTTER_INNER_WALL - p.gutterTileOverhang;
}

/** 院坪三点相对弦的拱高；近共线时趋近 0。 */
export function courtyardAnchorSagitta(p: Pick<
  VillaParams,
  "oldDepth" | "courtyardWestTotal" | "courtyardMidTotal" | "courtyardEastTotal" | "courtyardMidFromEast"
>) {
  const x1 = 0;
  const x2 = LOCKED_SITE_WIDTH - p.courtyardMidFromEast;
  const x3 = LOCKED_SITE_WIDTH;
  const z1 = p.oldDepth - p.courtyardWestTotal;
  const z2 = p.oldDepth - p.courtyardMidTotal;
  const z3 = p.oldDepth - p.courtyardEastTotal;
  const det = 2 * (x1 * (z2 - z3) + x2 * (z3 - z1) + x3 * (z1 - z2));
  const chord = Math.hypot(x3 - x1, z3 - z1) || 1;
  const sagitta = Math.abs((z3 - z1) * x2 - (x3 - x1) * z2 + x3 * z1 - z3 * x1) / chord;
  return { det, sagitta };
}

/** 在两栋楼各自的实际面宽内核对院坪弧线，不能拿东侧最深处当作全场进深。 */
export function buildingDepthLimits(p: VillaParams) {
  const circle = circleThrough([
    [0, p.oldDepth - p.courtyardWestTotal],
    [LOCKED_SITE_WIDTH - p.courtyardMidFromEast, p.oldDepth - p.courtyardMidTotal],
    [LOCKED_SITE_WIDTH, p.oldDepth - p.courtyardEastTotal],
  ]);
  const east = LOCKED_SITE_WIDTH - p.eastGap;
  const mainWest = p.buildingPlacement === "main-west" ? derivedWestGap(p) : east - p.mainWidth;
  const mainEast = mainWest + p.mainWidth;
  const annexEast = p.buildingPlacement === "main-west" ? east : mainWest - p.lane;
  const porticoWest = mainWest + porticoWestOffset(p);
  const depth = (lo: number, hi: number) => {
    // 圆弧在区间内唯一可能的极值是圆心X；同时检查两端。
    const xs = [lo, hi, Math.max(lo, Math.min(hi, circle.h))];
    const front = Math.max(...xs.map((x) => circle.k + circle.sign * Math.sqrt(Math.max(0, circle.radius ** 2 - (x - circle.h) ** 2))));
    return p.oldDepth - front;
  };
  return {
    main: depth(mainWest, mainEast),
    annex: depth(annexEast - p.annexWidth, annexEast),
    portico: depth(porticoWest, porticoWest + p.porticoWidth),
  };
}

export function validateVillaParams(p: VillaParams): VillaParamsIssue[] {
  const issues: VillaParamsIssue[] = [];
  for (const field of ["livingRailingStyle", "stairRailingStyle"] as const) {
    if (p[field] !== undefined && !isRailingStyle(p[field])) issues.push({ field, message: "栏杆造型无效" });
  }
  if (p.porticoStyle !== undefined && !["projecting", "recessed"].includes(p.porticoStyle)) issues.push({ field: "porticoStyle", message: "门厅造型无效" });
  if (p.buildingPlacement !== undefined && !["main-east", "main-west"].includes(p.buildingPlacement)) issues.push({ field: "buildingPlacement", message: "主辅楼位置无效" });
  if (p.thirdFloorMode !== undefined && !["setback", "flush"].includes(p.thirdFloorMode)) issues.push({ field: "thirdFloorMode", message: "三楼模式无效" });
  const west = derivedWestGap(p);
  if (west <= 1) {
    issues.push({
      field: "mainWidth",
      message: `东侧＋主楼＋子孙道＋辅楼过宽，西侧将为 ${formatMm(west)} mm；东墙不动时须减小主楼／辅楼面宽或东侧／过道`,
    });
  }
  const setback = derivedAnnexSetback(p);
  if (setback < -1e-6) {
    issues.push({
      field: "annexDepth",
      message: `辅楼进深 ${p.annexDepth} mm 不能大于主楼进深 ${p.mainDepth} mm（后墙与主楼齐平、只动前墙）`,
    });
  }
  const positive: (keyof VillaParams)[] = [
    "westGap", "eastGap", "lane", "mainWidth", "mainDepth",
    "floor1Height", "floor2Height", "floor3Height", "thirdSetback",
    "secondFrontEave", "thirdEave", "porticoWidth", "porticoProjection",
    "porticoColumnSize", "porticoColumnWallGap", "cornerProject", "annexWidth", "annexDepth",
    "annexHeight", "annexEave", "roofFenShui", "gutterClearWidth", "gutterClearDepth",
    "gutterInnerDepth", "gutterOuterTopWidth",
    "corbelLength", "corbelSpacing", "corbelCornerSpacing", "eyelidToFasciaGap",
    "oldDepth", "courtyardWestTotal", "courtyardMidTotal", "courtyardEastTotal",
    "courtyardMidFromEast", "neighborWoodWidth", "neighborWoodDepth",
    "neighborCementDepth", "neighborYardBeyondCement",
    "outsideWall", "partition", "entranceRise",
  ];
  for (const key of positive) {
    const v = p[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      issues.push({ field: key, message: `${String(key)} 须为正数` });
    }
  }
  if (typeof p.floatingHatRidgeDrop !== "number" || !Number.isFinite(p.floatingHatRidgeDrop) || p.floatingHatRidgeDrop < 0) {
    issues.push({ field: "floatingHatRidgeDrop", message: "悬浮官帽落脊不能为负" });
  }
  if (p.annexSetback < 0 || !Number.isFinite(p.annexSetback)) {
    issues.push({ field: "annexSetback", message: "辅楼内退不能为负" });
  }
  if (porticoColumnSpacing(p) <= porticoColumnOuterWidth(p.porticoColumnSize)) {
    issues.push({ field: "porticoWidth", message: "门厅柱心距须大于含柱脚饰线的柱外包宽度" });
  }
  if (p.cornerProject > 500) {
    issues.push({ field: "cornerProject", message: "包角柱突出墙面不宜超过 500 mm（50 cm）" });
  }
  if (p.porticoWidth > p.mainWidth) {
    issues.push({ field: "porticoWidth", message: "门厅面宽不能超过主楼面宽" });
  }
  if (p.roofFenShui < 1 || p.roofFenShui > 10) {
    issues.push({ field: "roofFenShui", message: "分水须在 1～10" });
  }
  if (typeof p.gutterCopingSlope !== "number" || !Number.isFinite(p.gutterCopingSlope) || p.gutterCopingSlope < 0 || p.gutterCopingSlope > 15) {
    issues.push({ field: "gutterCopingSlope", message: "天沟顶面内倾宜在 0～15°" });
  }
  if (typeof p.gutterBedSlope !== "number" || !Number.isFinite(p.gutterBedSlope)) {
    issues.push({ field: "gutterBedSlope", message: "天沟找坡须为数字" });
  } else {
    const bedDeg = normalizeGutterBedSlopeDegrees(p.gutterBedSlope);
    if (bedDeg < 0 || bedDeg > 15) {
      issues.push({ field: "gutterBedSlope", message: "天沟找坡宜在 0～15°（整数）" });
    }
  }
  if (p.gutterInnerDepth <= p.gutterClearDepth) {
    issues.push({ field: "gutterInnerDepth", message: "天沟内侧高度须大于外侧，满水才能外溢" });
  }
  if (p.corbelLength > p.thirdEave) {
    issues.push({ field: "corbelLength", message: "梁托长度不宜超过三楼檐口挑出" });
  }
  // 二楼无天沟挑檐为完整檐板，梁托须收在实际挑出内，不再扣除屋顶三眼皮级差。
  if (p.corbelLength > p.secondFrontEave + 1e-6) {
    issues.push({
      field: "corbelLength",
      message: `梁托 ${p.corbelLength} mm 超过二楼前檐挑出 ${formatMm(p.secondFrontEave)} mm；请减小梁托或加大二楼前檐`,
    });
  }
  if (p.corbelCornerSpacing > p.corbelSpacing) {
    issues.push({ field: "corbelCornerSpacing", message: "拐角梁托间距宜不大于同墙面间距" });
  }
  // 允许 0：瓦檐可贴内挡顶；不能为负。
  if (typeof p.gutterTileGap !== "number" || !Number.isFinite(p.gutterTileGap) || p.gutterTileGap < 0) {
    issues.push({ field: "gutterTileGap", message: "瓦片至内侧天沟顶不能为负" });
  }
  if (typeof p.gutterTileOverhang !== "number" || !Number.isFinite(p.gutterTileOverhang) || p.gutterTileOverhang < 0) {
    issues.push({ field: "gutterTileOverhang", message: "瓦边探入天沟不能为负" });
  } else if (p.gutterTileOverhang >= p.gutterClearWidth) {
    issues.push({ field: "gutterTileOverhang", message: "瓦边探入须小于天沟净宽，避免顶到外挡" });
  }
  const annexFields = ANNEX_ROOF_PARAM_KEYS;
  for (const main of ["roofFenShui", "gutterClearWidth", "gutterClearDepth", "gutterInnerDepth", "gutterOuterTopWidth", "corbelLength", "corbelSpacing", "corbelCornerSpacing", "eyelidToFasciaGap"] as const) {
    const field = annexFields[main], value = p[field];
    if (!Number.isFinite(value) || value <= 0) issues.push({ field, message: `辅楼 ${field} 须为正数` });
  }
  if (p.annexRoofFenShui < 1 || p.annexRoofFenShui > 10) issues.push({ field: "annexRoofFenShui", message: "辅楼分水须在 1～10" });
  for (const field of ["annexGutterBedSlope", "annexGutterCopingSlope"] as const) {
    if (!Number.isFinite(p[field]) || p[field] < 0 || p[field] > 15) issues.push({ field, message: "辅楼天沟坡度须在 0～15°" });
  }
  if (p.annexGutterInnerDepth <= p.annexGutterClearDepth) issues.push({ field: "annexGutterInnerDepth", message: "辅楼天沟内侧高度须大于外侧，满水才能外溢" });
  if (p.annexCorbelLength > p.annexEave) issues.push({ field: "annexCorbelLength", message: "辅楼梁托长度不宜超过辅楼檐口挑出" });
  if (p.annexCorbelCornerSpacing > p.annexCorbelSpacing) issues.push({ field: "annexCorbelCornerSpacing", message: "辅楼拐角梁托间距宜不大于同墙面间距" });
  if (!Number.isFinite(p.annexGutterTileGap) || p.annexGutterTileGap < 0) issues.push({ field: "annexGutterTileGap", message: "辅楼瓦片至内侧天沟顶不能为负" });
  if (!Number.isFinite(p.annexGutterTileOverhang) || p.annexGutterTileOverhang < 0 || p.annexGutterTileOverhang >= p.annexGutterClearWidth) issues.push({ field: "annexGutterTileOverhang", message: "辅楼瓦边探入须非负且小于辅楼天沟净宽" });
  if (p.courtyardMidFromEast >= LOCKED_SITE_WIDTH) {
    issues.push({ field: "courtyardMidFromEast", message: "中间取样距东界须小于总面宽" });
  }
  if (typeof p.rearGap !== "number" || !Number.isFinite(p.rearGap) || p.rearGap <= 0) {
    issues.push({ field: "rearGap", message: "屋后至梯田边预留须大于 0" });
  }
  for (const [key, total] of [
    ["courtyardWestTotal", p.courtyardWestTotal],
    ["courtyardMidTotal", p.courtyardMidTotal],
    ["courtyardEastTotal", p.courtyardEastTotal],
  ] as const) {
    if (total <= p.oldDepth) {
      issues.push({ field: key, message: "院坪总进深须大于屋后至老水泥边" });
    }
  }

  // —— 几何包络／净空约束（无效组合直接拒绝应用）——
  const thirdSetback = effectiveThirdSetback(p);
  if (p.porticoStyle === "recessed" && p.mainDepth - thirdSetback - p.porticoProjection < MIN_THIRD_BODY_DEPTH) issues.push({ field: "porticoProjection", message: "凹入门厅后，三层中央剩余进深须至少 3000 mm" });
  const bodyDepth = p.mainDepth - thirdSetback;
  if (!(thirdSetback < p.mainDepth - MIN_THIRD_BODY_DEPTH + 1e-6)) {
    issues.push({
      field: "thirdSetback",
      message: `三楼北退后剩余进深须至少 ${MIN_THIRD_BODY_DEPTH} mm（当前约 ${formatMm(bodyDepth)} mm）；请减小北退或加大主楼进深`,
    });
  }

  const { det: courtyardDet, sagitta } = courtyardAnchorSagitta(p);
  if (!Number.isFinite(courtyardDet) || Math.abs(courtyardDet) < 100 || sagitta < MIN_COURTYARD_SAGITTA) {
    issues.push({
      field: "courtyardMidTotal",
      message: `院坪西／中／东三点近共线（拱高约 ${formatMm(sagitta)} mm），圆弧无法生成；请让中间总进深明显不同于两端`,
    });
  } else if (west > 0 && [p.mainDepth, p.annexDepth, p.rearGap, p.porticoProjection].every(Number.isFinite)) {
    const limits = buildingDepthLimits(p);
    for (const [field, name, used, limit] of [
      ["mainDepth", "主楼＋屋后预留", p.mainDepth + p.rearGap, limits.main],
      ["annexDepth", "辅楼＋屋后预留", p.annexDepth + p.rearGap, limits.annex],
      ["porticoProjection", "主楼＋门厅外伸＋屋后预留", p.mainDepth + (p.porticoStyle === "recessed" ? 0 : p.porticoProjection) + p.rearGap, limits.portico],
    ] as const) {
      if (used > limit + 1) issues.push({
        field,
        message: `${name}共 ${formatMm(used)} mm，超过该面宽范围内的院坪总进深 ${formatMm(limit)} mm；请缩小进深／外伸或调整院坪尺寸`,
      });
    }
  }

  const roofChecks = [
    { name: "主楼", w: p.mainWidth + 2 * p.thirdEave, d: bodyDepth + 2 * p.thirdEave,
      inset: predictedTileInset(p), depth: p.gutterClearDepth, bed: p.gutterBedSlope,
      widthField: "gutterClearWidth", bedField: "gutterBedSlope" },
    { name: "辅楼", w: p.annexWidth + 2 * p.annexEave, d: p.annexDepth + 2 * p.annexEave,
      inset: p.annexGutterOuterTopWidth + p.annexGutterClearWidth + GUTTER_INNER_WALL - p.annexGutterTileOverhang,
      depth: p.annexGutterClearDepth, bed: p.annexGutterBedSlope,
      widthField: "annexGutterClearWidth", bedField: "annexGutterBedSlope" },
  ] as const;
  for (const roof of roofChecks) {
    const run = (Math.min(roof.w, roof.d) - 2 * roof.inset) / 2;
    if (run < MIN_ROOF_TILE_RUN) issues.push({ field: roof.widthField,
      message: `${roof.name}天沟／瓦边缩进后屋面净半跨过小（${formatMm(run)} mm）；请减小该楼天沟净宽或外边宽度` });
    const bedDeg = normalizeGutterBedSlopeDegrees(roof.bed);
    const halfSpan = Math.max(500, Math.min(roof.w, roof.d) / 2);
    const bedRise = Math.tan((bedDeg * Math.PI) / 180) * halfSpan;
    if (bedRise >= roof.depth - 20) issues.push({ field: roof.bedField,
      message: `${roof.name}天沟找坡 ${bedDeg}° 在约 ${formatMm(halfSpan)} mm 跨度上抬升 ${formatMm(bedRise)} mm，将高过外挡 ${roof.depth} mm；请减小找坡或加深外侧反坎` });
  }

  const porticoClear = porticoColumnSpacing(p) - porticoColumnOuterWidth(p.porticoColumnSize);
  if (porticoClear < MIN_PORTICO_CLEAR) {
    issues.push({
      field: "porticoWidth",
      message: `门厅柱间净宽约 ${formatMm(porticoClear)} mm，须至少 ${MIN_PORTICO_CLEAR} mm`,
    });
  }
  const wallGapCheck = derivedPorticoColumnWallGap(p);
  if (wallGapCheck <= 50) {
    issues.push({
      field: "porticoProjection",
      message: `门厅外伸过小，柱内侧到前墙为 ${formatMm(wallGapCheck)} mm；外伸须大于半柱截面`,
    });
  }
  const cornerOffsetCheck = 180 * (p.mainWidth / DEFAULT_VILLA_PARAMS.mainWidth);
  const westWing = porticoWestOffset(p);
  const sideTerrace = Math.min(westWing, p.mainWidth - p.porticoWidth - westWing) - cornerOffsetCheck;
  if (sideTerrace < MIN_SIDE_TERRACE) {
    issues.push({
      field: "porticoWidth",
      message: `门厅过宽导致两侧露台约 ${formatMm(sideTerrace)} mm；请减小门厅面宽以保留至少 ${MIN_SIDE_TERRACE} mm`,
    });
  }

  if (p.annexHeight < 2900) {
    issues.push({
      field: "annexHeight",
      message: `辅楼墙高 ${p.annexHeight} mm 低于常用窗顶约 2700 mm；请至少 2900 mm 或改小洞口后再调`,
    });
  }
  if (p.entranceRise >= p.floor1Height - 200) {
    issues.push({
      field: "entranceRise",
      message: `入口抬高 ${p.entranceRise} mm 不低于一层层高，楼梯高差将不合理`,
    });
  }

  // 楼梯跨向：默认 axis=x，两跑占进深方向；缩进深时洞口不能小于 2×flight＋gap。
  const baseGeom = ensureBaseline();
  const szCheck = p.mainDepth / baseGeom.main.d;
  const sxCheck = p.mainWidth / baseGeom.main.w;
  const sl0 = baseGeom.stairLayout;
  const acrossNeed = stairAcrossClear(sl0.flight, sl0.gap);
  const holeAcross = sl0.axis === "x" ? sl0.hole.d * szCheck : sl0.hole.w * sxCheck;
  if (holeAcross + 1e-6 < acrossNeed) {
    issues.push({
      field: sl0.axis === "x" ? "mainDepth" : "mainWidth",
      message: `楼梯两跑需约 ${formatMm(acrossNeed)} mm，按比例缩放后洞口仅 ${formatMm(holeAcross)} mm；请加大主楼对应尺寸或改楼梯布局`,
    });
  }

  return issues;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type MainBaseline = {
  main: { x: number; z: number; w: number; d: number };
  annex: { x: number; z: number; w: number; d: number };
  floors: Floor[];
  annexRooms: Room[];
  annexFurniture: Furniture[];
  annexPartitions: Wall[];
  stairLayout: typeof stairLayout;
  circulation: typeof circulation;
};

let baseline: MainBaseline | null = null;

function ensureBaseline() {
  if (baseline) return baseline;
  baseline = {
    main: { ...site.main },
    annex: { x: site.annex.x, z: site.annex.z, w: site.annex.w, d: site.annex.d },
    floors: cloneJson(floors),
    annexRooms: cloneJson(annexRooms),
    annexFurniture: cloneJson(annexFurniture),
    annexPartitions: cloneJson(annexPartitions),
    stairLayout: cloneJson(stairLayout),
    circulation: cloneJson(circulation),
  };
  return baseline;
}

/** 以东南角（东墙 X、南墙 Z）为不动点缩放。oE/oS＝旧东南，nE/nS＝新东南。 */
function scalePoint(p: Point, oE: number, oS: number, nE: number, nS: number, sx: number, sz: number): Point {
  return [nE - (oE - p[0]) * sx, nS - (oS - p[1]) * sz];
}

function scaleRoom(r: Room, oE: number, oS: number, nE: number, nS: number, sx: number, sz: number): Room {
  const next: Room = {
    ...r,
    x: nE - (oE - r.x) * sx,
    z: nS - (oS - r.z) * sz,
    w: r.w * sx,
    d: r.d * sz,
  };
  if (r.label) next.label = scalePoint(r.label, oE, oS, nE, nS, sx, sz);
  return next;
}

function scaleFurniture(f: Furniture, oE: number, oS: number, nE: number, nS: number, sx: number, sz: number): Furniture {
  const fixed = FIXED_FURNITURE_KINDS.has(f.kind);
  return {
    ...f,
    x: nE - (oE - f.x) * sx,
    z: nS - (oS - f.z) * sz,
    w: fixed ? f.w : f.w * sx,
    d: fixed ? f.d : f.d * sz,
  };
}

function scaleWall(w: Wall, oE: number, oS: number, nE: number, nS: number, sx: number, sz: number): Wall {
  return {
    ...w,
    a: scalePoint(w.a, oE, oS, nE, nS, sx, sz),
    b: scalePoint(w.b, oE, oS, nE, nS, sx, sz),
    door: w.door
      ? {
          ...w.door,
          offset: w.door.offset * (Math.abs(w.a[0] - w.b[0]) >= Math.abs(w.a[1] - w.b[1]) ? sx : sz),
          width: w.door.width * (Math.abs(w.a[0] - w.b[0]) >= Math.abs(w.a[1] - w.b[1]) ? sx : sz),
        }
      : undefined,
  };
}

/** 墙长不足时删门或缩门，避免门洞超出墙段。 */
function fitDoorToWall(w: Wall): Wall {
  if (!w.door) return w;
  const len = Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]);
  const margin = 80;
  if (len < w.door.width + margin) {
    if (len < 550) {
      const { door: _drop, ...rest } = w;
      return rest;
    }
    const width = Math.max(500, len - margin);
    return {
      ...w,
      door: {
        ...w.door,
        width,
        offset: Math.min(w.door.offset, Math.max(0, len - width)),
      },
    };
  }
  if (w.door.offset + w.door.width > len - 20) {
    return {
      ...w,
      door: {
        ...w.door,
        offset: Math.max(0, len - w.door.width - 20),
      },
    };
  }
  return w;
}

/** 三楼北退加大时，把穿出露台的房间／隔墙／家具北缘钳到 floors[2].front。 */
function clampThirdFloorNorth(floor: Floor, front: number): Floor {
  const clampZ = (z: number) => Math.max(z, front);
  const rooms = floor.rooms.map((r) => {
    const south = r.z + r.d;
    if (south <= front + 50) {
      // 整间已在露台内：收到退台墙内侧最小进深，避免消失。
      return { ...r, z: front, d: 400, label: r.label ? [r.label[0], clampZ(r.label[1])] as Point : r.label };
    }
    if (r.z >= front) return r;
    return {
      ...r,
      z: front,
      d: Math.max(400, south - front),
      label: r.label ? [r.label[0], clampZ(r.label[1])] as Point : r.label,
    };
  });
  const partitions = floor.partitions
    .map((w) => ({
      ...w,
      a: [w.a[0], clampZ(w.a[1])] as Point,
      b: [w.b[0], clampZ(w.b[1])] as Point,
    }))
    .filter((w) => Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]) > 10)
    .map(fitDoorToWall);
  const furniture = floor.furniture.map((f) => ({
    ...f,
    z: clampZ(f.z),
  }));
  return { ...floor, rooms, partitions, furniture };
}

function replaceArray<T>(target: T[], next: T[]) {
  target.length = 0;
  target.push(...next);
}

let currentParams: VillaParams = { ...DEFAULT_VILLA_PARAMS };

/**
 * 若载入的参数像旧米制稿（mainWidth<100），迁成毫米；已是毫米则原样返回副本。
 * 应用／记忆／保存前统一走这里，避免米制 JSON 直接进入毫米管线。
 */
export function normalizeVillaParamsLengths(input: Partial<VillaParams>): VillaParams {
  const raw = isMeterLengthPayload(input, { mainWidth: input.mainWidth })
    ? migrateVillaParamsToMm({ ...input }) : { ...input };
  const params = { ...DEFAULT_VILLA_PARAMS, ...raw };
  const independent = Object.values(ANNEX_ROOF_PARAM_KEYS).some(key => raw[key] !== undefined);
  for (const [main, annex] of Object.entries(ANNEX_ROOF_PARAM_KEYS) as [keyof typeof ANNEX_ROOF_PARAM_KEYS, typeof ANNEX_ROOF_PARAM_KEYS[keyof typeof ANNEX_ROOF_PARAM_KEYS]][]) {
    if (raw[annex] === undefined) params[annex] = params[main];
  }
  // 旧 annexEave 曾被强制覆盖，按当时真正生效的主楼出檐恢复，避免旧稿外观突变。
  if (!independent) params.annexEave = params.thirdEave;
  params.gutterBedSlope = normalizeGutterBedSlopeDegrees(params.gutterBedSlope);
  params.annexGutterBedSlope = normalizeGutterBedSlopeDegrees(params.annexGutterBedSlope);
  return params;
}

export function getVillaParams(): VillaParams {
  return { ...currentParams };
}

/** 只更新内存中的当前参数（及分水写回 site），不重算几何。 */
export function rememberVillaParams(input: VillaParams) {
  const params = normalizeVillaParamsLengths(input);
  currentParams = { ...params };
  site.roofFenShui = params.roofFenShui;
  site.annexRoofFenShui = params.annexRoofFenShui;
}

/** 返回当前内存参数；文件加载由 scheme-store 负责。 */
export function loadVillaParams(): VillaParams {
  return { ...currentParams };
}

/** 只更新内存中的当前参数；落盘请用「保存方案／保存版本」。 */
export function saveVillaParams(params: VillaParams) {
  currentParams = normalizeVillaParamsLengths(params);
}

/**
 * 将参数写入运行时 `site`／`floors`／院坪／邻居等。
 * 须先通过 `validateVillaParams`；返回用于 UI 的缩放信息。
 */
export function applyVillaParams(input: VillaParams) {
  const params = normalizeVillaParamsLengths(input);
  const issues = validateVillaParams(params);
  if (issues.length) throw new Error(issues.map((i) => i.message).join("；"));

  const base = ensureBaseline();
  // 东墙／南墙锚定：西侧与辅楼内退由其余尺寸反推；屋面参数分别应用。
  const westGap = derivedWestGap(params);
  const annexSetback = derivedAnnexSetback(params);
  const synced: VillaParams = {
    ...params,
    westGap,
    annexSetback,
    gutterBedSlope: normalizeGutterBedSlopeDegrees(params.gutterBedSlope),
  };
  currentParams = synced;
  interiorRailing.living = synced.livingRailingStyle;
  interiorRailing.stair = synced.stairRailingStyle;

  // 南墙＝屋后界 − 预留；东墙＝总宽 − 东侧。改面宽／进深只动西墙与北墙。
  const mainSouth = synced.oldDepth - synced.rearGap;
  const east = LOCKED_SITE_WIDTH - synced.eastGap;
  const mainX = synced.buildingPlacement === "main-west" ? westGap : east - synced.mainWidth;
  const mainEast = mainX + synced.mainWidth;
  const mainZNext = mainSouth - synced.mainDepth;
  const annexEast = synced.buildingPlacement === "main-west" ? east : mainX - synced.lane;
  const annexX = annexEast - synced.annexWidth;
  const annexZ = mainSouth - synced.annexDepth;

  site.porticoStyle = synced.porticoStyle;
  site.buildingPlacement = synced.buildingPlacement;
  site.width = LOCKED_SITE_WIDTH;
  site.sideGap = westGap;
  site.lane = synced.lane;
  site.oldDepth = synced.oldDepth;
  site.rearGap = synced.rearGap;
  site.setback = effectiveThirdSetback(synced);
  site.thirdEave = synced.thirdEave;
  site.eave = synced.annexEave;
  site.secondFrontEave = synced.secondFrontEave;
  site.roofFenShui = params.roofFenShui;
  site.annexRoofFenShui = params.annexRoofFenShui;
  site.entranceRise = params.entranceRise;
  site.main.x = mainX;
  site.main.z = mainZNext;
  site.main.w = synced.mainWidth;
  site.main.d = synced.mainDepth;
  site.annex.x = annexX;
  site.annex.z = annexZ;
  site.annex.w = synced.annexWidth;
  site.annex.d = synced.annexDepth;
  site.annex.height = synced.annexHeight;
  site.portico.w = synced.porticoWidth;
  site.portico.projection = synced.porticoProjection;
  site.portico.x = mainX + porticoWestOffset(synced);

  roofGutterDesign.clearWidth = params.gutterClearWidth;
  roofGutterDesign.clearDepth = params.gutterClearDepth;
  roofGutterDesign.innerDepth = params.gutterInnerDepth;
  roofGutterDesign.outerTopWidth = params.gutterOuterTopWidth;
  roofGutterDesign.bedSlope = gutterBedSlopeRatioFromDegrees(synced.gutterBedSlope);
  roofGutterDesign.tileGap = params.gutterTileGap;
  roofGutterDesign.tileOverhang = params.gutterTileOverhang;
  roofGutterDesign.copingSlopeDegrees = params.gutterCopingSlope;
  eaveTrimDesign.corbelLength = params.corbelLength;
  eaveTrimDesign.corbelSpacing = params.corbelSpacing;
  eaveTrimDesign.corbelCornerSpacing = params.corbelCornerSpacing;
  eaveTrimDesign.eyelidToFascia = params.eyelidToFasciaGap;
  Object.assign(annexRoofGutterDesign, {
    clearWidth: params.annexGutterClearWidth, clearDepth: params.annexGutterClearDepth,
    innerDepth: params.annexGutterInnerDepth, outerTopWidth: params.annexGutterOuterTopWidth,
    bedSlope: gutterBedSlopeRatioFromDegrees(params.annexGutterBedSlope),
    tileGap: params.annexGutterTileGap, tileOverhang: params.annexGutterTileOverhang,
    copingSlopeDegrees: params.annexGutterCopingSlope,
  });
  Object.assign(annexEaveTrimDesign, {
    corbelLength: params.annexCorbelLength, corbelSpacing: params.annexCorbelSpacing,
    corbelCornerSpacing: params.annexCorbelCornerSpacing, eyelidToFascia: params.annexEyelidToFasciaGap,
  });
  syncRoofTileInset();
  floatingHatDesign.ridgeDrop = params.floatingHatRidgeDrop;
  // 主楼四坡起高随四面统一 thirdEave 后的外包络半坡重算（与 roofPitch 一致）。
  {
    const roofW = params.mainWidth + 2 * params.thirdEave;
    const roofD = params.mainDepth - site.setback + 2 * params.thirdEave;
    site.roofRise = (params.roofFenShui / 10) * (Math.min(roofW, roofD) - 2 * roofTileInset) / 2;
  }

  construction.outsideWall = params.outsideWall;
  construction.partition = params.partition;

  const midX = LOCKED_SITE_WIDTH - params.courtyardMidFromEast;
  courtyardArcAnchors[0] = [0, params.oldDepth - params.courtyardWestTotal];
  courtyardArcAnchors[1] = [midX, params.oldDepth - params.courtyardMidTotal];
  courtyardArcAnchors[2] = [LOCKED_SITE_WIDTH, params.oldDepth - params.courtyardEastTotal];
  neighborCourtyardPlan.x = site.width;
  neighborCourtyardPlan.w = params.neighborWoodWidth;
  neighborCourtyardPlan.woodDepth = params.neighborWoodDepth;
  neighborCourtyardPlan.cementDepth = params.neighborCementDepth;
  // 先写邻居／蓝顶房再重建梯田与地库，避免路边 X 仍用旧值。
  syncNeighborFootprint(params.neighborWoodWidth, params.neighborWoodDepth);
  syncRoadsideVillaPlacement();
  rebuildCourtyardGeometry();
  rebuildTerraceLinkage();
  rebuildGarageLayout();
  rebuildVehicleRoute();
  // 邻院北缘已在 rebuildCourtyardGeometry 里与自家东界外沿拉齐；回写派生值供面板显示。
  synced.neighborYardBeyondCement = neighborCourtyardPlan.yardBeyondCement;
  currentParams = synced;

  const sx = synced.mainWidth / base.main.w;
  const sz = synced.mainDepth / base.main.d;
  const asx = synced.annexWidth / base.annex.w;
  const asz = synced.annexDepth / base.annex.d;
  const oE = base.main.x + base.main.w;
  const oS = base.main.z + base.main.d;
  const nE = site.main.x + site.main.w;
  const nS = site.main.z + site.main.d;
  const aoE = base.annex.x + base.annex.w;
  const aoS = base.annex.z + base.annex.d;
  const anE = site.annex.x + site.annex.w;
  const anS = site.annex.z + site.annex.d;
  const nz = site.main.z;

  const y0 = 0;
  const y1 = synced.floor1Height;
  const y2 = synced.floor1Height + synced.floor2Height;
  const heights = [synced.floor1Height, synced.floor2Height, synced.floor3Height];
  const ys = [y0, y1, y2];

  const nextFloors = base.floors.map((floor, i) => {
    const rooms = floor.rooms.map((r) => scaleRoom(r, oE, oS, nE, nS, sx, sz));
    const partitions = floor.partitions.map((w) => scaleWall(w, oE, oS, nE, nS, sx, sz));
    const furniture = floor.furniture.map((f) => scaleFurniture(f, oE, oS, nE, nS, sx, sz));
    const next: Floor = {
      ...floor,
      y: ys[i] ?? floor.y,
      height: heights[i] ?? floor.height,
      front: i === 2 ? nS - (oS - floor.front) * sz : nz,
      rooms,
      partitions,
      furniture,
    };
    return i === 2 ? clampThirdFloorNorth(resizeThirdFloorFront(next, nz + site.setback), nz + site.setback) : next;
  });
  replaceArray(floors, nextFloors);

  replaceArray(
    annexRooms,
    base.annexRooms.map((r) => scaleRoom(r, aoE, aoS, anE, anS, asx, asz)),
  );
  replaceArray(
    annexFurniture,
    base.annexFurniture.map((f) => scaleFurniture(f, aoE, aoS, anE, anS, asx, asz)),
  );
  replaceArray(
    annexPartitions,
    base.annexPartitions.map((w) => scaleWall(w, aoE, aoS, anE, anS, asx, asz)),
  );

  // 楼梯：位置随外包络；梯段／缝／踏深保持实体尺寸；洞口跨向不低于两跑净宽。
  const sl = base.stairLayout;
  const acrossOnZ = String(sl.axis) !== "z"; // 默认 axis=x：两跑占进深（Z）
  const acrossMin = stairAcrossClear(sl.flight, sl.gap);
  const holeW = Math.max(sl.hole.w * sx, acrossOnZ ? 1500 : acrossMin);
  const holeD = Math.max(sl.hole.d * sz, acrossOnZ ? acrossMin : 1500);
  Object.assign(stairLayout, {
    room: {
      x: nE - (oE - sl.room.x) * sx,
      z: nS - (oS - sl.room.z) * sz,
      w: Math.max(sl.room.w * sx, acrossOnZ ? sl.room.w * sx : acrossMin + 200),
      d: Math.max(sl.room.d * sz, acrossOnZ ? acrossMin + 200 : sl.room.d * sz),
    },
    x: nE - (oE - sl.x) * sx,
    z: nS - (oS - sl.z) * sz,
    flight: sl.flight,
    gap: sl.gap,
    tread: sl.tread,
    landing: sl.landing,
    hole: {
      x: nE - (oE - sl.hole.x) * sx,
      z: nS - (oS - sl.hole.z) * sz,
      w: holeW,
      d: holeD,
    },
  });

  const lv = base.circulation.livingVoid;
  circulation.livingVoid = {
    x: nE - (oE - lv.x) * sx,
    z: nS - (oS - lv.z) * sz,
    w: lv.w * sx,
    d: lv.d * sz,
  };
  // 通辅楼门宽不随进深比例放大（保持房门洞口）；中线对齐过道。
  circulation.sideDoorWidth = base.circulation.sideDoorWidth;
  syncSideDoorToLivingBridge();

  if (synced.buildingPlacement === "main-west") {
    const sum = site.main.x * 2 + site.main.w, asum = site.annex.x * 2 + site.annex.w;
    for (const f of floors) {
      f.rooms = f.rooms.map(r => mirrorRoom(r, sum));
      f.partitions = f.partitions.map(w => mirrorWall(w, sum));
      f.furniture = f.furniture.map(f => mirrorFurniture(f, sum));
    }
    replaceArray(annexRooms, annexRooms.map(r => mirrorRoom(r, asum)));
    replaceArray(annexPartitions, annexPartitions.map(w => mirrorWall(w, asum)));
    replaceArray(annexFurniture, annexFurniture.map(f => mirrorFurniture(f, asum)));
    const stairOffsetX = stairLayout.x - stairLayout.room.x;
    stairLayout.room.x = sum - stairLayout.room.x - stairLayout.room.w;
    stairLayout.hole.x = sum - stairLayout.hole.x - stairLayout.hole.w;
    stairLayout.x = stairLayout.room.x + stairOffsetX;
    if (stairLayout.axis === "x") stairLayout.direction = sl.direction === "negative" ? "positive" : "negative";
    else stairLayout.lowerSide = sl.lowerSide === "max" ? "min" : "max";
    circulation.livingVoid.x = sum - circulation.livingVoid.x - circulation.livingVoid.w;
  } else {
    stairLayout.direction = sl.direction;
    stairLayout.lowerSide = sl.lowerSide;
  }
  syncFrontElevation(synced);

  // 改尺后家具仍可能压在墙中线上，再钳到墙内皮。
  ensureFurnitureWallClearance();

  return { sx, sz, asx, asz };
}

/**
 * 三楼露台短柱与下层柱同轴；贴前墙的官帽柱另按堂屋两端分档线定位。
 * 改门厅／包角相关参数时由此一处重算，避免错位。
 */
function syncFrontElevation(params: VillaParams) {
  const main = site.main;
  const porch = site.portico;
  frontElevation.cornerProject = params.cornerProject;
  const project = params.cornerProject;
  const leg = frontElevation.cornerLeg;
  const shortW = frontElevation.shortPostWidth;

  // 官帽柱与门厅柱共用堂屋开间两端的X轴线；门厅柱心在前沿两角。
  frontElevation.postXs = [porch.x, porch.x + porch.w];
  // 官帽柱／墙内构造柱：北皮贴一层前墙外皮（recessedHatPier 进深 500 mm，中心在外皮以南半深）。
  frontElevation.postZ = porticoWallZ() + 250;
  frontElevation.wallCornerXs = [main.x + 270, main.x + main.w - 270];
  frontElevation.cornerWestX = main.x + 120;
  frontElevation.cornerEastX = main.x + main.w - 120;
  const wallGap = derivedPorticoColumnWallGap(params);
  params.porticoColumnWallGap = wallGap;
  frontElevation.porticoColumnWallGap = wallGap;
  frontElevation.porticoColumnDepth = params.porticoColumnSize;
  frontElevation.porticoColumnZ = porticoFrontZ();

  // 短柱外侧与下层包角柱外皮对齐；其余深度退向墙体。仅为外观示意，实际支承待结构设计。
  const cornerShaft = (cornerX: number, outward: number) => ({
    x: cornerX + (outward * (project - leg)) / 2,
    z: main.z - 120 - project + shortW / 2,
    w: shortW,
  });
  const westCorner = cornerShaft(frontElevation.cornerWestX, -1);
  const eastCorner = cornerShaft(frontElevation.cornerEastX, 1);
  const columnXs = porticoColumnCenters(porch);
  const middleWest = {
    x: columnXs[0],
    z: frontElevation.porticoColumnZ,
    w: params.porticoColumnSize,
  };
  const middleEast = {
    x: columnXs[1],
    z: frontElevation.porticoColumnZ,
    w: params.porticoColumnSize,
  };
  frontElevation.balustradePosts = [westCorner, middleWest, middleEast, eastCorner];

  // 飘檐／露台折角北缘落在门厅柱心：柱在下方承托整段下沿线，直角拐弯对柱顶中心。
  frontElevation.centerFront = middleWest.z;
  frontElevation.terraceFront = Math.min(westCorner.z - westCorner.w / 2, eastCorner.z - eastCorner.w / 2);
  frontElevation.terraceBack = porticoWallZ(main.z + effectiveThirdSetback(params)) + 40;
  const cornerOffset = 180 * (params.mainWidth / DEFAULT_VILLA_PARAMS.mainWidth);
  frontElevation.sideTerraces = [
    { x: main.x + cornerOffset, w: porch.x - (main.x + cornerOffset) },
    {
      x: porch.x + porch.w,
      w: main.x + main.w - cornerOffset - (porch.x + porch.w),
    },
  ];
  frontElevation.hatFront = main.z - 980 * (params.porticoProjection / DEFAULT_VILLA_PARAMS.porticoProjection) + (params.porticoStyle === "recessed" ? params.porticoProjection : 0);
  frontElevation.hatWidth = porch.w + 1040;
  // 官帽檐口随三层层高累加；悬浮方案另有 floatingHatLayout 抬高。
  frontElevation.hatEave = mainEaveY();
}

export function resetVillaParams() {
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS });
}

// 冻结默认几何快照（须在首次改参前），再应用默认参数以同步立面柱位等派生项。
ensureBaseline();
applyVillaParams({ ...DEFAULT_VILLA_PARAMS });
