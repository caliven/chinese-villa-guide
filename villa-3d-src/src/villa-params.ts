/**
 * 方案尺寸参数：总面宽锁定 21 m；改参后重算场地／主辅楼／院坪，
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
  floatingHatDesign,
  eaveTrimDesign,
  roofTileInset,
  syncRoofTileInset,
} from "./roof-options";
import { rebuildTerraceLinkage, syncNeighborFootprint, syncRoadsideVillaPlacement } from "./surroundings";
import { rebuildGarageLayout } from "./garage-layout";
import { mainEaveY } from "./facades";
import { ensureFurnitureWallClearance } from "./layout-align";

export const LOCKED_SITE_WIDTH = 21;
/** @deprecated 已改存 scheme 文件，仅供旧迁移识别。 */
export const villaParamsPreferenceKey = "anhua-villa-params-v1";

export interface VillaParams {
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
  /** 包角柱比墙面外凸（米）；正面／侧面同值，默认 0.15＝15 cm */
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
  floatingHatRidgeDrop: number;
  oldDepth: number;
  rearGap: number;
  entranceRise: number;
  outsideWall: number;
  partition: number;
  courtyardWestTotal: number;
  courtyardMidTotal: number;
  courtyardEastTotal: number;
  /** 中间取样点距东界的距离（米） */
  courtyardMidFromEast: number;
  neighborWoodWidth: number;
  neighborWoodDepth: number;
  neighborCementDepth: number;
  neighborYardBeyondCement: number;
}

export const DEFAULT_VILLA_PARAMS: VillaParams = {
  westGap: 0.7,
  eastGap: 0.8,
  lane: 1.5,
  mainWidth: 13.5,
  mainDepth: 10,
  floor1Height: 3.6,
  floor2Height: 3.6,
  floor3Height: 3.3,
  thirdSetback: 1.2,
  secondFrontEave: 0.8,
  thirdEave: 0.8,
  porticoWidth: 4.8,
  porticoProjection: 2,
  porticoColumnSize: 0.8,
  /** 派生：外伸 − 半柱；柱心在北沿角上时内侧到前墙＝外伸−半柱。 */
  porticoColumnWallGap: 1.6,
  cornerProject: 0.15,
  annexWidth: 4.5,
  annexDepth: 8,
  annexHeight: 3.6,
  annexSetback: 2,
  annexEave: 0.8,
  roofFenShui: 4.5,
  gutterClearWidth: 0.6,
  gutterClearDepth: 0.2,
  gutterInnerDepth: 0.25,
  gutterOuterTopWidth: 0.3,
  /** 整数度；几何用 tan(°) 转成小数坡度 */
  gutterBedSlope: 1,
  gutterTileGap: 0.05,
  gutterTileOverhang: 0.08,
  gutterCopingSlope: 4,
  corbelLength: 0.5,
  corbelSpacing: 0.7,
  corbelCornerSpacing: 0.6,
  eyelidToFasciaGap: 0.3,
  floatingHatRidgeDrop: 0.5,
  oldDepth: 10.8,
  rearGap: 1.2,
  entranceRise: 0.45,
  outsideWall: 0.24,
  partition: 0.12,
  courtyardWestTotal: 11,
  courtyardMidTotal: 15.8,
  courtyardEastTotal: 19.4,
  courtyardMidFromEast: 11,
  neighborWoodWidth: 13,
  neighborWoodDepth: 8.8,
  neighborCementDepth: 2,
  /** 与自家东界外沿齐平后的派生值；应用时按院坪东端重算 */
  neighborYardBeyondCement: 8.6,
};

/**
 * 柱心距（只读派生）＝门厅面宽。
 * 约定：两根门厅柱心落在外伸投影北沿左右两角的直角处，故心距等于面宽。
 */
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

export function validateVillaParams(p: VillaParams): VillaParamsIssue[] {
  const issues: VillaParamsIssue[] = [];
  const west = derivedWestGap(p);
  if (west <= 0.001) {
    issues.push({
      field: "mainWidth",
      message: `东侧＋主楼＋子孙道＋辅楼过宽，西侧将为 ${west.toFixed(3)} m；东墙不动时须减小主楼／辅楼面宽或东侧／过道`,
    });
  }
  const setback = derivedAnnexSetback(p);
  if (setback < -1e-9) {
    issues.push({
      field: "annexDepth",
      message: `辅楼进深 ${p.annexDepth} m 不能大于主楼进深 ${p.mainDepth} m（后墙与主楼齐平、只动前墙）`,
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
  if (p.porticoWidth <= p.porticoColumnSize) {
    issues.push({ field: "porticoWidth", message: "门厅面宽须大于柱截面" });
  }
  if (p.cornerProject > 0.5) {
    issues.push({ field: "cornerProject", message: "包角柱突出墙面不宜超过 0.5 m（50 cm）" });
  }
  if (p.porticoWidth > p.mainWidth) {
    issues.push({ field: "porticoWidth", message: "门厅面宽不能超过主楼面宽" });
  }
  if (p.roofFenShui < 1 || p.roofFenShui > 10) {
    issues.push({ field: "roofFenShui", message: "分水须在 1～10" });
  }
  if (p.gutterCopingSlope < 0 || p.gutterCopingSlope > 15) {
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
  return {
    ...f,
    x: nE - (oE - f.x) * sx,
    z: nS - (oS - f.z) * sz,
    w: f.w * sx,
    d: f.d * sz,
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

/** 三楼北退加大时，把穿出露台的房间／隔墙／家具北缘钳到 floors[2].front。 */
function clampThirdFloorNorth(floor: Floor, front: number): Floor {
  const clampZ = (z: number) => Math.max(z, front);
  const rooms = floor.rooms.map((r) => {
    const south = r.z + r.d;
    if (south <= front + 0.05) {
      // 整间已在露台内：收到退台墙内侧最小进深，避免消失。
      return { ...r, z: front, d: 0.4, label: r.label ? [r.label[0], clampZ(r.label[1])] as Point : r.label };
    }
    if (r.z >= front) return r;
    return {
      ...r,
      z: front,
      d: Math.max(0.4, south - front),
      label: r.label ? [r.label[0], clampZ(r.label[1])] as Point : r.label,
    };
  });
  const partitions = floor.partitions
    .map((w) => ({
      ...w,
      a: [w.a[0], clampZ(w.a[1])] as Point,
      b: [w.b[0], clampZ(w.b[1])] as Point,
    }))
    .filter((w) => Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]) > 0.01);
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

export function getVillaParams(): VillaParams {
  return { ...currentParams };
}

/** 只更新内存中的当前参数（及分水写回 site），不重算几何。 */
export function rememberVillaParams(params: VillaParams) {
  currentParams = { ...params };
  site.roofFenShui = params.roofFenShui;
}

/** 返回当前内存参数；文件加载由 scheme-store 负责。 */
export function loadVillaParams(): VillaParams {
  return { ...currentParams };
}

/** 只更新内存中的当前参数；落盘请用「保存方案／保存版本」。 */
export function saveVillaParams(params: VillaParams) {
  currentParams = { ...params };
}

/**
 * 将参数写入运行时 `site`／`floors`／院坪／邻居等。
 * 须先通过 `validateVillaParams`；返回用于 UI 的缩放信息。
 */
export function applyVillaParams(params: VillaParams) {
  const issues = validateVillaParams(params);
  if (issues.length) throw new Error(issues.map((i) => i.message).join("；"));

  const base = ensureBaseline();
  // 东墙／南墙锚定：西侧与辅楼内退由其余尺寸反推；辅楼飘檐锁 thirdEave。
  const westGap = derivedWestGap(params);
  const annexSetback = derivedAnnexSetback(params);
  const synced: VillaParams = {
    ...params,
    westGap,
    annexSetback,
    annexEave: params.thirdEave,
    gutterBedSlope: normalizeGutterBedSlopeDegrees(params.gutterBedSlope),
  };
  currentParams = synced;

  // 南墙＝屋后界 − 预留；东墙＝总宽 − 东侧。改面宽／进深只动西墙与北墙。
  const mainSouth = synced.oldDepth - synced.rearGap;
  const mainEast = LOCKED_SITE_WIDTH - synced.eastGap;
  const mainX = mainEast - synced.mainWidth;
  const mainZNext = mainSouth - synced.mainDepth;
  const annexEast = mainX - synced.lane;
  const annexX = annexEast - synced.annexWidth;
  const annexZ = mainSouth - synced.annexDepth;

  site.width = LOCKED_SITE_WIDTH;
  site.sideGap = westGap;
  site.lane = synced.lane;
  site.oldDepth = synced.oldDepth;
  site.rearGap = synced.rearGap;
  site.setback = synced.thirdSetback;
  site.thirdEave = synced.thirdEave;
  site.eave = synced.thirdEave;
  site.secondFrontEave = synced.secondFrontEave;
  site.roofFenShui = params.roofFenShui;
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
  site.portico.x = mainX + (synced.mainWidth - synced.porticoWidth) / 2;

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
  syncRoofTileInset();
  floatingHatDesign.ridgeDrop = params.floatingHatRidgeDrop;
  // 主楼四坡起高随四面统一 thirdEave 后的外包络半坡重算（与 roofPitch 一致）。
  {
    const roofW = params.mainWidth + 2 * params.thirdEave;
    const roofD = params.mainDepth - params.thirdSetback + 2 * params.thirdEave;
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
      front: i === 2 ? nz + synced.thirdSetback : nz,
      rooms,
      partitions,
      furniture,
    };
    return i === 2 ? clampThirdFloorNorth(next, next.front) : next;
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

  const sl = base.stairLayout;
  Object.assign(stairLayout, {
    room: {
      x: nE - (oE - sl.room.x) * sx,
      z: nS - (oS - sl.room.z) * sz,
      w: sl.room.w * sx,
      d: sl.room.d * sz,
    },
    x: nE - (oE - sl.x) * sx,
    z: nS - (oS - sl.z) * sz,
    flight: sl.flight * (sl.axis === "x" ? sx : sz),
    gap: sl.gap * (sl.axis === "x" ? sx : sz),
    tread: sl.tread * (sl.axis === "x" ? sx : sz),
    landing: sl.landing * (sl.axis === "x" ? sx : sz),
    hole: {
      x: nE - (oE - sl.hole.x) * sx,
      z: nS - (oS - sl.hole.z) * sz,
      w: sl.hole.w * sx,
      d: sl.hole.d * sz,
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

  syncFrontElevation(synced);

  // 改尺后家具仍可能压在墙中线上，再钳到墙内皮。
  ensureFurnitureWallClearance();

  return { sx, sz, asx, asz };
}

/**
 * 三楼露台短柱与下层柱同轴：中间两根＝门厅柱延伸，两侧＝包角柱延伸。
 * 改门厅／包角相关参数时由此一处重算，避免错位。
 */
function syncFrontElevation(params: VillaParams) {
  const main = site.main;
  const porch = site.portico;
  const half = params.porticoColumnSize / 2;
  frontElevation.cornerProject = params.cornerProject;
  const project = params.cornerProject;
  const leg = frontElevation.cornerLeg;
  const shortW = frontElevation.shortPostWidth;

  // 门厅柱心落在外伸投影北沿左右两角的直角处（用户约定）：X＝门厅左右边，Z＝北沿。
  frontElevation.postXs = [porch.x, porch.x + porch.w];
  // 官帽柱／墙内构造柱：北皮贴一层前墙外皮（recessedHatPier 进深 0.5 m，中心在外皮以南半深）。
  frontElevation.postZ = main.z + 0.25;
  frontElevation.wallCornerXs = [main.x + 0.27, main.x + main.w - 0.27];
  frontElevation.cornerWestX = main.x + 0.12;
  frontElevation.cornerEastX = main.x + main.w - 0.12;
  const wallGap = derivedPorticoColumnWallGap(params);
  params.porticoColumnWallGap = wallGap;
  frontElevation.porticoColumnWallGap = wallGap;
  frontElevation.porticoColumnDepth = params.porticoColumnSize;
  frontElevation.porticoColumnZ = main.z - params.porticoProjection;

  // 包角柱正面段中心（与下层 L 形柱身同轴）。
  const cornerShaft = (cornerX: number, outward: number) => ({
    x: cornerX + (outward * (project - leg)) / 2,
    z: main.z - 0.12 - project / 2,
    w: shortW,
  });
  const westCorner = cornerShaft(frontElevation.cornerWestX, -1);
  const eastCorner = cornerShaft(frontElevation.cornerEastX, 1);
  const middleWest = {
    x: frontElevation.postXs[0],
    z: frontElevation.porticoColumnZ,
    w: params.porticoColumnSize,
  };
  const middleEast = {
    x: frontElevation.postXs[1],
    z: frontElevation.porticoColumnZ,
    w: params.porticoColumnSize,
  };
  frontElevation.balustradePosts = [westCorner, middleWest, middleEast, eastCorner];

  // 露台北缘包住短柱外皮，与下层柱北缘对齐。
  frontElevation.centerFront = middleWest.z - middleWest.w / 2;
  frontElevation.terraceFront = Math.min(westCorner.z - westCorner.w / 2, eastCorner.z - eastCorner.w / 2);
  frontElevation.terraceBack = main.z + params.thirdSetback + 0.04;
  const cornerOffset = 0.18 * (params.mainWidth / DEFAULT_VILLA_PARAMS.mainWidth);
  frontElevation.sideTerraces = [
    { x: main.x + cornerOffset, w: porch.x - (main.x + cornerOffset) },
    {
      x: porch.x + porch.w,
      w: main.x + main.w - cornerOffset - (porch.x + porch.w),
    },
  ];
  frontElevation.hatFront = main.z - 0.98 * (params.porticoProjection / DEFAULT_VILLA_PARAMS.porticoProjection);
  frontElevation.hatWidth = porch.w + 1.04;
  // 官帽檐口随三层层高累加；悬浮方案另有 floatingHatLayout 抬高。
  frontElevation.hatEave = mainEaveY();
}

export function resetVillaParams() {
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS });
}

// 冻结默认几何快照（须在首次改参前）
ensureBaseline();
