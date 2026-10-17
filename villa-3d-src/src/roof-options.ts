export const roofStyleLabels = {
  joined: "原有官帽",
  floating: "悬浮官帽",
} as const;

export type RoofStyle = keyof typeof roofStyleLabels;
export const roofStylePreferenceKey = "anhua-villa-roof-style-v1";

/** 槽底相对屋面基准的抬高（米）；找坡以此为最低排水口标高。 */
export const gutterBedTop = 0.03;

/**
 * 天沟设计参数（米、度）。可由方案尺寸「屋面」改写。
 * - clearDepth：外边反坎高度（槽底以上）
 * - innerDepth：内侧反坎高度，默认高于外侧，满水时外溢
 * - outerTopWidth：外边反坎顶部宽度（不含压顶外飘）
 * - innerWallThickness：内侧反坎厚度（模型取值，非用户口述）
 * - tileGap：瓦檐底到内侧挡墙顶的竖直间距
 * - tileOverhang：瓦边超出内挡沟侧、探入天沟净宽的水平长度
 * - bedSlope：槽底从高点到排水口的坡度（小数＝tan(度)；面板存整数度）
 * - copingSlopeDegrees：外挡压顶顶面内倾（石材压顶）
 */
export const roofGutterDesign = {
  clearWidth: 0.6,
  clearDepth: 0.2,
  innerDepth: 0.25,
  outerTopWidth: 0.3,
  /** 内侧反坎厚度：用户未口述，沿用原挡墙模型厚。 */
  innerWallThickness: 0.055,
  tileGap: 0.05,
  tileOverhang: 0.08,
  /** 默认 1° → tan(1°) */
  bedSlope: Math.tan((1 * Math.PI) / 180),
  copingSlopeDegrees: 4,
};

/**
 * 三眼皮固定造型（米）。出檐台阶与级高差不进参数面板。
 * 最上层外沿与屋面外轮廓齐平；默认 thirdEave=0.8 时下层出檐 0.6。
 */
export const eyelidFixed = {
  /** 每一级比下一级多探出 */
  stepExtra: 0.1,
  /** 级间高度差：自下而上（底层板厚含缝、中层、上层至槽底） */
  rises: [0.1, 0.1, 0.15] as const,
  /** 石材压顶相对三眼皮外沿再飘出 */
  copingOverhang: 0.02,
  /** 下沿线突出墙体 */
  fasciaProtrusion: 0.1,
  /** 下沿线高度 */
  fasciaHeight: 0.1,
};

/**
 * 檐下梁托／下沿线间距等动态参数（米）。可由「屋面」改写。
 * - eyelidToFascia：三眼皮最底层底面到下沿线上沿
 *
 * 出挑关系（相对该墙面屋面外皮出挑 O）：
 * 最上层＝O，中层＝O−step，最下层＝O−2×step。
 * 梁托为独立成品尺寸，默认长 500／高 200／宽 160mm，不随各面出檐缩放。
 */
export const eaveTrimDesign = {
  /** 梁托出挑，用户指定 500mm；各墙面共用，仅由「梁托长度」主动改写 */
  corbelLength: 0.5,
  corbelSpacing: 0.7,
  corbelCornerSpacing: 0.6,
  eyelidToFascia: 0.3,
  /** 梁托沿墙厚度，款式07落款：160 */
  corbelWidth: 0.16,
  /** 梁托贴墙高度，款式07落款：200 */
  corbelHeight: 0.2,
};

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

/** 封闭瓦面挤出厚度（米）；略薄于旧值，减轻瓦底与天沟构件共面闪线。 */
export const roofTileThickness = 0.05;

/** 自屋面外轮廓到瓦边：内挡沟侧再减去探出量，瓦边伸进沟内。 */
export let roofTileInset = gutterInnerLipInset() - roofGutterDesign.tileOverhang;

export function syncRoofTileInset() {
  roofTileInset = gutterInnerLipInset() - roofGutterDesign.tileOverhang;
}

/** 瓦檐相对屋面基准：内侧挡顶＋竖直间距。 */
export function roofTileEaveLift() {
  return gutterBedTop + roofGutterDesign.innerDepth + roofGutterDesign.tileGap;
}

/** 外侧挡墙顶相对屋面基准（含顶面内倾在挡厚上的抬高）。 */
export function gutterOuterWallTop() {
  return (
    gutterBedTop +
    roofGutterDesign.clearDepth +
    roofGutterDesign.outerTopWidth *
      Math.tan((roofGutterDesign.copingSlopeDegrees * Math.PI) / 180)
  );
}

/** 内侧挡墙顶相对屋面基准。 */
export function gutterInnerWallTop() {
  return gutterBedTop + roofGutterDesign.innerDepth;
}

/** 三眼皮总高度（最上层顶到最下层底）。 */
export function eyelidStackHeight() {
  return eyelidFixed.rises[0] + eyelidFixed.rises[1] + eyelidFixed.rises[2];
}

/** 第 i 层（0＝最上层／最外）相对外沿的水平内收。 */
export function eyelidInset(i: number) {
  return eyelidFixed.stepExtra * i;
}

/**
 * 三眼皮最下层板底相对屋面基准（tileTop）再减去 drop。
 * 最上层顶面贴在 tileTop - drop 下沿（紧贴天沟槽底之下）。
 */
export function apronFasciaBottom(tileTop: number, drop: number) {
  return tileTop - drop - eyelidStackHeight();
}

/** 下沿线上沿：三眼皮最底层底面再往下 eyelidToFascia。 */
export function fasciaTopY(tileTop: number, drop: number) {
  return apronFasciaBottom(tileTop, drop) - eaveTrimDesign.eyelidToFascia;
}

/** 下沿线板底。 */
export function fasciaBottomY(tileTop: number, drop: number) {
  return fasciaTopY(tileTop, drop) - eyelidFixed.fasciaHeight;
}

/**
 * 包角柱顶标高：下沿线板底再往下 gap（默认 0.1 m）。
 * 柱顶不通到屋顶／三眼皮下沿，与梁托下的下沿线留空。
 */
export const cornerPilasterBelowFascia = 0.1;

export function cornerPilasterTopY(tileTop: number, drop = 0, gap = cornerPilasterBelowFascia) {
  return fasciaBottomY(tileTop, drop) - gap;
}

/** 洞口上沿须低于下沿线板底的净距（米）。 */
export const openingBelowFasciaClearance = 0.05;

/** 洞口最高绝对 Y：下沿线板底再往下 clearance。 */
export function maxOpeningTopY(eaveY: number, drop = 0) {
  return fasciaBottomY(eaveY, drop) - openingBelowFasciaClearance;
}

// 按最新参考：帽脊低于主脊约 50cm，纵脊直接接入正屋前坡。
// 极缓坡保留柱头净空及最小起坡；这些是造型建议，非实测或结构尺寸。
export const floatingHatDesign = { ridgeDrop: 0.5, minEaveLift: 0.27, minRise: 0.05 };

export function parseRoofStyle(value: unknown): RoofStyle {
  if (value === undefined || value === "joined") return "joined";
  if (value === "floating") return "floating";
  throw new Error("官帽造型选项无效");
}
