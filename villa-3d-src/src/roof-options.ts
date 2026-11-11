export const roofStyleLabels = {
  floating: "悬浮官帽",
  joined: "普通官帽",
} as const;

export type RoofStyle = keyof typeof roofStyleLabels;
export const DEFAULT_ROOF_STYLE: RoofStyle = "floating";
export const roofStylePreferenceKey = "anhua-villa-roof-style-v1";

/** 室内楼板与外伸檐板共用的结构厚度（毫米）。 */
export const floorSlabThickness = 120;

/** 槽底找坡层在结构板顶以上的最低厚度（毫米）。 */
export const gutterBedTop = 30;
export const gutterCopingThickness = 30;

/**
 * 天沟设计参数（毫米、度）。可由方案尺寸「主楼／辅楼」改写。
 * - clearDepth：外边反坎从结构板顶起砌的高度，不含压顶
 * - innerDepth：内侧反坎从同一结构板顶起砌的高度
 * - outerTopWidth：外边反坎顶部宽度（不含压顶外飘）
 * - innerWallThickness：内侧反坎厚度（模型取值，非用户口述）
 * - tileGap：瓦檐面到内侧挡墙顶的竖直高差；瓦片厚度向下挤出，不再另加高度
 * - tileOverhang：瓦边超出内挡沟侧、探入天沟净宽的水平长度
 * - bedSlope：槽底从高点到排水口的坡度（小数＝tan(度)；面板存整数度）
 * - copingSlopeDegrees：外挡压顶顶面内倾（石材压顶）
 */
export let roofGutterDesign = {
  clearWidth: 600,
  clearDepth: 200,
  innerDepth: 250,
  outerTopWidth: 300,
  /** 内侧反坎厚度：用户未口述，沿用原挡墙模型厚。 */
  innerWallThickness: 55,
  tileGap: 50,
  tileOverhang: 200,
  /** 默认 1° → tan(1°) */
  bedSlope: Math.tan((1 * Math.PI) / 180),
  copingSlopeDegrees: 4,
};

/**
 * 三眼皮造型（毫米）。最下级共用结构板，上两级随外挡高度分配。
 * 最上层外沿与屋面外轮廓齐平；默认 thirdEave=800 时下层出檐 600。
 */
export const eyelidFixed = {
  /** 每一级比下一级多探出 */
  stepExtra: 100,
  /** 最下级就是结构板；上两级按100∶150分配外挡高度。 */
  rises: [floorSlabThickness, 100, 150] as const,
  /** 石材压顶相对三眼皮外沿再飘出 */
  copingOverhang: 20,
  /** 下沿线突出墙体 */
  fasciaProtrusion: 100,
  /** 下沿线高度 */
  fasciaHeight: 100,
};

/**
 * 檐下梁托／下沿线间距等动态参数（毫米）。可由「主楼／辅楼」改写。
 * - eyelidToFascia：三眼皮最底层底面到下沿线上沿
 *
 * 出挑关系（相对该墙面屋面外皮出挑 O）：
 * 最上层＝O，中层＝O−step，最下层＝O−2×step。
 * 梁托为独立成品尺寸，默认长 500／高 200／宽 160mm，不随各面出檐缩放。
 */
export let eaveTrimDesign = {
  /** 梁托出挑，用户指定 500mm；各墙面共用，仅由「梁托长度」主动改写 */
  corbelLength: 500,
  corbelSpacing: 700,
  corbelCornerSpacing: 600,
  eyelidToFascia: 300,
  /** 梁托沿墙厚度，款式07落款：160 */
  corbelWidth: 160,
  /** 梁托贴墙高度，款式07落款：200 */
  corbelHeight: 200,
};

/** 辅楼持有独立参数；主楼及官帽沿用默认上下文。 */
export const annexRoofGutterDesign = { ...roofGutterDesign };
export const annexEaveTrimDesign = { ...eaveTrimDesign };

/**
 * 几何生成是同步的：在辅楼生成范围内选择其屋面构造，结束或抛错均恢复。
 * 复用同一套天沟、梁托和灯带算法，避免主辅楼形成两套造型实现。
 * 回调不得异步执行；生成的网格不在后续渲染中读取此上下文。
 */
export function withAnnexRoofDesign<T>(build: () => T): T {
  const gutter = roofGutterDesign, trim = eaveTrimDesign, inset = roofTileInset;
  roofGutterDesign = annexRoofGutterDesign;
  eaveTrimDesign = annexEaveTrimDesign;
  syncRoofTileInset();
  try { return build(); }
  finally {
    roofGutterDesign = gutter;
    eaveTrimDesign = trim;
    roofTileInset = inset;
  }
}

export function annexRoofProfile() {
  return withAnnexRoofDesign(() => ({
    tileInset: roofTileInset, tileLift: slabToTileEaveLift(), clearWidth: roofGutterDesign.clearWidth,
    innerLipInset: gutterInnerLipInset(), outerWallTop: gutterOuterWallTop(),
  }));
}

/** @deprecated 兼容旧名：外挡厚度现为 outerTopWidth */
Object.defineProperty(roofGutterDesign, "wallThickness", {
  get() {
    return roofGutterDesign.outerTopWidth;
  },
  set(value: number) {
    roofGutterDesign.outerTopWidth = value;
  },
  enumerable: false,
  configurable: true,
});

/** 内挡沟侧立面相对外轮廓的缩进（瓦盖内挡顶的外沿基准）。 */
export function gutterInnerLipInset() {
  return (
    roofGutterDesign.outerTopWidth +
    roofGutterDesign.clearWidth +
    roofGutterDesign.innerWallThickness
  );
}

/** 封闭瓦面挤出厚度（毫米）；略薄于旧值，减轻瓦底与天沟构件共面闪线。 */
export const roofTileThickness = 50;

/** 二楼顶部的无天沟瓦挑檐；檐板与室内结构板同厚、同标高。 */
export const apronEaveDesign = {
  boardThickness: floorSlabThickness,
  tileDrop: 380,
  /** 水泥坡面外沿起厚，坡面向内随瓦檐升高。 */
  beddingThickness: 40,
  get parapetHeight() { return this.beddingThickness + this.tileDrop + roofTileThickness; },
  fasciaHeight: 100,
  fasciaProtrusion: 100,
  parapetThickness: 280,
  /** 雕花柱冠与下沿线之间的外展斜肩高度，不占梁托空档。 */
  cornerCapitalDrop: 180,
};

export function frontApronSection(parapetTop: number, drop: number,
  slabTop = parapetTop - drop - roofTileThickness - apronEaveDesign.beddingThickness) {
  const tileOuterY = slabTop + apronEaveDesign.beddingThickness + roofTileThickness;
  const tileInnerY = tileOuterY + drop;
  const boardOuterTop = slabTop;
  const soffitY = boardOuterTop - apronEaveDesign.boardThickness;
  const fasciaTopY = soffitY - eaveTrimDesign.corbelHeight;
  const fasciaBottomY = fasciaTopY - apronEaveDesign.fasciaHeight;
  return { tileInnerY, tileOuterY, boardOuterTop, soffitY, fasciaTopY, fasciaBottomY,
    columnTopY: fasciaBottomY - apronEaveDesign.cornerCapitalDrop,
    porticoTopY: fasciaBottomY };
}

/** 自屋面外轮廓到瓦边：内挡沟侧再减去探出量，瓦边伸进沟内。 */
export let roofTileInset = gutterInnerLipInset() - roofGutterDesign.tileOverhang;

export function syncRoofTileInset() {
  roofTileInset = gutterInnerLipInset() - roofGutterDesign.tileOverhang;
}

/**
 * 瓦檐相对结构板顶：内侧挡顶＋竖直间距。
 */
export function roofTileEaveLift() {
  return roofGutterDesign.innerDepth + roofGutterDesign.tileGap;
}

/**
 * 板底／梁托顶 → 瓦檐：一层结构板厚＋内挡高度＋瓦隙。
 * 三眼皮是外挡外侧的阶梯造型，不额外抬高天沟和瓦面。
 */
export function slabToTileEaveLift() {
  return floorSlabThickness + roofTileEaveLift();
}

/** 压顶最高点相对结构板顶；沟内侧保留完整压顶厚度，外侧向上找坡。 */
export function gutterOuterWallTop() {
  return (
    roofGutterDesign.clearDepth +
    gutterCopingThickness +
    (roofGutterDesign.outerTopWidth + eyelidFixed.copingOverhang) *
      Math.tan((roofGutterDesign.copingSlopeDegrees * Math.PI) / 180)
  );
}

/** 内侧挡墙顶相对结构板顶。 */
export function gutterInnerWallTop() {
  return roofGutterDesign.innerDepth;
}

/** 三眼皮总高含最下层结构板；上两级与外挡同顶。 */
export function eyelidStackHeight() {
  return floorSlabThickness + roofGutterDesign.clearDepth;
}

/** 第 i 层（0＝最上层／最外）相对外沿的水平内收。 */
export function eyelidInset(i: number) {
  return Math.min(eyelidFixed.stepExtra, roofGutterDesign.outerTopWidth / 3) * i;
}

/**
 * 飘檐底／梁托顶／封顶楼板平面。
 * `tileTop` 为屋面板底基准（墙顶）。梁托与共同结构板底贴合。
 */
export function apronFasciaBottom(tileTop: number, drop: number) {
  return tileTop - drop;
}

/** 下沿线上沿：楼板／梁托顶再往下 eyelidToFascia。 */
export function fasciaTopY(tileTop: number, drop: number) {
  return apronFasciaBottom(tileTop, drop) - eaveTrimDesign.eyelidToFascia;
}

/** 下沿线板底。 */
export function fasciaBottomY(tileTop: number, drop: number) {
  return fasciaTopY(tileTop, drop) - eyelidFixed.fasciaHeight;
}

/**
 * 包角柱顶标高：默认贴下沿线板底（gap=0）。
 * 三层／两层半四周檐口包角与三楼北面包角统一对齐；需要留空时显式传入 gap。
 */
export const cornerPilasterBelowFascia = 0;

export function cornerPilasterTopY(tileTop: number, drop = 0, gap = cornerPilasterBelowFascia) {
  return fasciaBottomY(tileTop, drop) - gap;
}

/** 洞口上沿须低于下沿线板底的净距（毫米）。 */
export const openingBelowFasciaClearance = 50;

/** 洞口最高绝对 Y：下沿线板底再往下 clearance。 */
export function maxOpeningTopY(eaveY: number, drop = 0) {
  return fasciaBottomY(eaveY, drop) - openingBelowFasciaClearance;
}

// 升降零点：帽脊默认低于主脊约 50cm，纵脊直接接入正屋前坡。
// 极缓坡保留柱头净空及最小起坡；这些是造型建议，非实测或结构尺寸。
export const floatingHatDesign = { heightOffset: 0, minEaveLift: 270, minRise: 50 };

/** 以主屋瓦檐为脊高零点、主屋檐口为檐高零点；升降保持官帽自身坡度。 */
export function floatingHatLevels(mainRise: number, run: number, slope: number, frontToRidge: number,
  requestedOffset: number) {
  const { minEaveLift, minRise } = floatingHatDesign;
  let basePeak = Math.max(mainRise - 500, Math.min(minEaveLift + minRise, mainRise - 50));
  let baseEave = Math.max(minEaveLift, basePeak - run * slope);
  // 深凹门厅的自动位置也保留最短接脊；修正计入零点，保证升降数值始终相对该零点。
  const automaticLift = Math.max(0, Math.ceil((frontToRidge + 50) * slope - basePeak - 1e-7));
  if (basePeak + automaticLift <= mainRise + 1e-7) {
    basePeak += automaticLift;
    baseEave += automaticLift;
  }
  // 柱顶保持净空，纵脊至少向后接入50；帽脊最高接到主屋脊，不越过前坡。
  const minOffset = Math.ceil(Math.max(minEaveLift - baseEave, (frontToRidge + 50) * slope - basePeak) - 1e-7);
  const maxOffset = Math.floor(mainRise - basePeak + 1e-7);
  // 户型草稿可改变门厅进深；在实际上下文中再约束，避免保存后草稿导致反向屋脊。
  const offset = minOffset <= maxOffset ? Math.max(minOffset, Math.min(maxOffset, requestedOffset)) : 0;
  return { peakLift: basePeak + offset, eaveLift: baseEave + offset, offset, minOffset, maxOffset };
}

/** 普通官帽独立控制有效瓦宽；天沟向外增加，不再挤占瓦面。均为造型建议值。 */
export const joinedHatDesign = { tileWidthExtra: 750, minWingWidth: 1000 };

export function parseRoofStyle(value: unknown): RoofStyle {
  // 缺字段是历史普通官帽稿；新建／初始化通过 DEFAULT_ROOF_STYLE 指定悬浮。
  if (value === undefined || value === "joined") return "joined";
  if (value === "floating") return "floating";
  throw new Error("官帽造型选项无效");
}
