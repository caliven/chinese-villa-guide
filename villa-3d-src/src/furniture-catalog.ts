import type { Furniture } from "./data";
import { floorplanFurniture, getFloorplanFurniture, type FloorplanFurnitureType } from "./floorplan-catalog";

/**
 * 家具局部坐标（rotation = 0）统一约定——按日常用法，不是随意画的：
 *
 * - 局部 +X＝右，−X＝左（人坐／站在使用位、面朝前方时）
 * - 局部 +Z＝后方（靠背、床头、水箱、贴墙背面）
 * - 局部 −Z＝前方（坐下／站立／观看／使用的一侧）
 * - 宽 w 沿左右（X），深 d 沿前后（Z）
 *
 * 旋转：绕竖直轴，正角＝俯视逆时针（与平面 SVG 一致）。
 * 例：床头靠西 → rotation = +90°（局部后方转到世界西）；沙发背靠北墙 → 180°。
 *
 * 无朝向件（圆桌、方桌、茶几）：平面对称，旋转只影响角点对齐。
 */
export const FURNITURE_LOCAL_FRAME =
  "局部：+Z 后方（靠背／床头／贴墙），−Z 前方（坐人／使用）；+X 右，−X 左；w＝左右，d＝前后";

/** 仅为旧户型兼容保留的家具类型，不出现在新库中。 */
export const LEGACY_FURNITURE_KINDS = [
  "bed",
  "tv",
  "sofa",
  "coffeeTable",
  "table",
  "roundTable",
  "chair",
  "dressingTable",
  "cabinet",
  "wardrobe",
  "basin",
  "toilet",
  "squatToilet",
  "shower",
  "counter",
  "stove",
  "hob",
  "sink",
  "altar",
  "shrine",
  "railing",
] as const satisfies readonly Furniture["kind"][];

export const FURNITURE_KINDS = [...LEGACY_FURNITURE_KINDS, ...floorplanFurniture.map(item => item.id)] as const;
export type FurnitureKind = Furniture["kind"];
type LegacyFurnitureKind = (typeof LEGACY_FURNITURE_KINDS)[number];

const legacyFurnitureLabels: Record<LegacyFurnitureKind, string> = {
  bed: "床（含两侧床头柜）",
  tv: "电视机",
  sofa: "沙发",
  coffeeTable: "茶几",
  table: "长桌",
  roundTable: "圆桌",
  chair: "椅子",
  dressingTable: "梳妆台",
  cabinet: "柜子",
  wardrobe: "衣柜",
  basin: "洗漱台",
  toilet: "马桶",
  squatToilet: "蹲便",
  shower: "淋浴间",
  counter: "厨柜",
  stove: "柴火灶",
  hob: "灶台",
  sink: "水槽",
  altar: "神案",
  shrine: "神龛（湖南堂屋）",
  railing: "栏杆",
};

/** 各件在局部坐标下的方位说明（编辑器与协作口述用）。 */
const legacyFurnitureOrientationHints: Record<LegacyFurnitureKind, string> = {
  bed: "后方＝床头（枕头／床头柜）；前方＝床尾；左右＝两侧床头柜",
  tv: "后方＝机背贴墙；前方＝屏幕朝向观看区",
  sofa: "后方＝靠背；前方＝落座；左右＝双侧扶手",
  coffeeTable: "无固定朝向；四周可坐",
  table: "无固定朝向；长边为宽",
  roundTable: "无朝向；直径取宽",
  chair: "后方＝靠背；前方＝落座",
  dressingTable: "后方＝贴墙；前方＝镜面／人坐侧",
  cabinet: "后方＝贴墙；前方＝柜门",
  wardrobe: "后方＝贴墙；前方＝柜门",
  basin: "后方＝贴墙；前方＝站人洗漱",
  toilet: "后方＝水箱贴墙；前方＝坐人",
  squatToilet: "后方＝贴墙／排污侧；前方＝蹲向",
  shower: "后方＝贴墙；前方＝进出／玻璃门外侧",
  counter: "后方＝贴墙；前方＝操作边",
  stove: "后方＝贴墙；前方＝烧火／站人",
  hob: "后方＝贴墙；前方＝灶眼操作边",
  sink: "后方＝贴墙；前方＝洗碗站人",
  altar: "后方＝贴墙；前方＝供奉朝向",
  shrine: "后方＝贴墙柜背；前方＝龛台／供人面朝",
  railing: "宽＝栏杆长度；深＝栏杆厚度；后方＝楼板／安全侧，前方＝临空侧",
};

export const furnitureLabels = {
  ...legacyFurnitureLabels,
  ...Object.fromEntries(floorplanFurniture.map(item => [item.id, item.name])),
} as Record<FurnitureKind, string>;

const floorplanOrientationHints: Record<FloorplanFurnitureType, string> = {
  bed: "后方＝床头与枕头；前方＝床尾；床头柜为独立模型",
  crib: "后方＝床头；前方＝床尾",
  nightstand: "后方＝贴墙；前方＝抽屉",
  wardrobe: "后方＝贴墙；前方＝柜门",
  dresser: "后方＝镜面与贴墙；前方＝使用位；座椅需另行放置",
  desk: "后方＝贴墙；前方＝坐人",
  chair: "后方＝靠背；前方＝落座",
  bookshelf: "后方＝贴墙；前方＝取书",
  baycushion: "长边沿飘窗，按现场方向旋转",
  sofa: "后方＝靠背；前方＝落座",
  cornersofa: "后方＝长靠背；前方＝落座与贵妃位",
  armchair: "后方＝靠背；前方＝落座",
  beanbag: "后方＝靠背；前方＝落座",
  coffeetable: "无固定朝向；长边为宽",
  sidetable: "无固定朝向；四周可用",
  tvstand: "后方＝贴墙；前方＝柜门",
  rug: "无固定前后；宽深为地毯边长",
  shoecab: "后方＝贴墙；前方＝柜门",
  floorlamp: "无固定朝向",
  plant: "无固定朝向",
  table: "无固定朝向；长边为宽",
  roundtable: "无朝向；宽深均为直径",
  island: "前方＝操作与收纳面",
  barstool: "前方＝落座",
  counter: "后方＝挡水与贴墙；前方＝操作边",
  stove: "后方＝贴墙；前方＝旋钮与灶眼操作边",
  ksink: "后方＝水龙头；前方＝洗碗站人",
  fridge: "后方＝机背贴墙；前方＝冰箱门",
  cabinet: "后方＝贴墙；前方＝柜门",
  toilet: "后方＝水箱；前方＝坐盆",
  vanity: "后方＝镜面与水龙头；前方＝洗漱",
  shower: "后方＝贴墙；前方＝玻璃门",
  bathtub: "后方＝水龙头；按现场方向旋转",
  washer: "后方＝机背贴墙；前方＝滚筒门",
  waterheater: "后方＝贴墙；前方＝检修面",
  tv: "后方＝机背贴墙；前方＝屏幕",
  aircon: "后方＝机背贴墙；前方＝出风口",
  acwall: "后方＝贴墙；前方＝出风方向",
  dishwasher: "后方＝机背贴墙；前方＝柜门",
  ovencol: "后方＝贴墙；前方＝蒸烤箱门",
  dryer: "后方＝机背贴墙；前方＝滚筒门",
  purifier: "前方＝操作面",
  officechair: "后方＝靠背；前方＝落座",
  piano: "后方＝贴墙；前方＝琴键",
  treadmill: "后方＝仪表台；前方＝跑带进入侧",
};
export const furnitureOrientationHints = {
  ...legacyFurnitureOrientationHints,
  ...Object.fromEntries(floorplanFurniture.map(item => [item.id, floorplanOrientationHints[item.type]])),
} as Record<FurnitureKind, string>;

export function furnitureOrientationHint(kind: Furniture["kind"]): string {
  return furnitureOrientationHints[kind as FurnitureKind] ?? FURNITURE_LOCAL_FRAME;
}

/** 该件是否有明确前后（旋转会影响用法）。 */
export function furnitureHasFacing(kind: Furniture["kind"]): boolean {
  const model = getFloorplanFurniture(kind);
  if (model) return !["coffeetable", "sidetable", "table", "roundtable", "rug", "plant", "floorlamp", "barstool"].includes(model.type);
  return !["coffeeTable", "table", "roundTable"].includes(kind);
}

/** 沿用床、柜体与厨卫操作件的600毫米讨论留位，型号和旧类型共用用途判断。 */
export function furnitureHasUseZone(kind: FurnitureKind): boolean {
  const model = getFloorplanFurniture(kind);
  if (model) return ["bed", "wardrobe", "cabinet", "toilet", "vanity", "ksink", "stove", "dresser"].includes(model.type);
  return ["bed", "wardrobe", "cabinet", "toilet", "squatToilet", "basin", "sink", "stove", "hob", "dressingTable"].includes(kind);
}

/** 编辑器只展示上游完整目录；旧类型仅用于读取已存户型。 */
export const furniturePickerOrder: FurnitureKind[] = floorplanFurniture.map(item => item.id);

export const bedNightstand = { w: 450, d: 400, gap: 20 };

/**
 * 床的占地拆分：参数宽／深是房间内 1:1 外轮廓（与墙、房间同比例），
 * 两侧床头柜画在轮廓以内，不再外扩。
 */
export function bedLayout(f: Pick<Furniture, "w" | "d">) {
  const ns = bedNightstand;
  const minMattress = 900;
  let nsW = ns.w;
  let gap = ns.gap;
  let mattressW = f.w - 2 * (nsW + gap);
  if (mattressW < minMattress) {
    const avail = Math.max(0, (f.w - minMattress) / 2);
    nsW = Math.min(ns.w, Math.max(0, avail * 0.85));
    gap = Math.min(ns.gap, Math.max(0, avail - nsW));
    mattressW = f.w - 2 * (nsW + gap);
  }
  if (mattressW < 600 || nsW < 120) {
    return {
      mattressW: f.w,
      nsW: 0,
      gap: 0,
      nsD: 0,
      showNightstands: false as const,
    };
  }
  return {
    mattressW,
    nsW,
    gap,
    nsD: Math.min(ns.d, f.d * 0.45),
    showNightstands: true as const,
  };
}

export function defaultFurnitureSize(kind: FurnitureKind): { w: number; d: number } {
  const model = getFloorplanFurniture(kind);
  if (model) return { w: model.w, d: model.d };
  switch (kind) {
    case "bed":
      // 历史床的外轮廓含两侧床头柜；新库床和床头柜分别放置。
      return { w: 2960, d: 2220 };
    case "tv":
      return { w: 1200, d: 350 };
    case "sofa":
      return { w: 2200, d: 900 };
    case "coffeeTable":
      return { w: 1100, d: 600 };
    case "table":
      return { w: 1600, d: 800 };
    case "roundTable":
      return { w: 1200, d: 1200 };
    case "chair":
      return { w: 500, d: 550 };
    case "dressingTable":
      return { w: 1000, d: 450 };
    case "cabinet":
      return { w: 1000, d: 550 };
    case "wardrobe":
      return { w: 1600, d: 550 };
    case "basin":
      return { w: 800, d: 450 };
    case "toilet":
      return { w: 400, d: 700 };
    case "squatToilet":
      return { w: 450, d: 650 };
    case "shower":
      // 常见整体淋浴房／淋浴区占地约 900×900；可拉角改成矩形。
      return { w: 900, d: 900 };
    case "counter":
      return { w: 1500, d: 600 };
    case "stove":
      return { w: 900, d: 700 };
    case "hob":
      return { w: 750, d: 600 };
    case "sink":
      return { w: 800, d: 550 };
    case "altar":
      return { w: 1200, d: 500 };
    case "shrine":
      // 湖南农村堂屋靠后墙神龛：面宽约一开间中段，进深浅，贴墙。
      return { w: 1500, d: 450 };
    case "railing":
      // 默认一段约 3.6 m；拉角改长度，厚度保持窄条。
      return { w: 3600, d: 100 };
    default:
      throw new Error(`未知家具类型：${kind}`);
  }
}

/** 平面图／卡片上的显示名：自定义 label 优先，否则用种类默认名。 */
export function furnitureDisplayName(f: Pick<Furniture, "kind" | "label">): string {
  const custom = f.label?.trim();
  if (custom) return custom;
  return furnitureLabels[f.kind as FurnitureKind] ?? f.kind;
}

export function createFurniture(kind: FurnitureKind, x: number, z: number): Furniture {
  const { w, d } = defaultFurnitureSize(kind);
  return { kind, x, z, w, d, rotation: 0, label: furnitureLabels[kind] };
}

/**
 * 家具局部包围：宽／深即平面占地（毫米），与房间、墙同一比例，不再外扩。
 * 床的床头柜含在宽以内；圆桌按直径 w。
 */
export function furnitureLocalBounds(f: Furniture): { x0: number; z0: number; x1: number; z1: number } {
  if (isRoundFurniture(f.kind)) {
    const r = f.w / 2;
    return { x0: -r, z0: -r, x1: r, z1: r };
  }
  return { x0: -f.w / 2, z0: -f.d / 2, x1: f.w / 2, z1: f.d / 2 };
}

/**
 * 与平面 SVG `translate(x,z) rotate(-θ°)` 一致的局部↔世界变换。
 * （旧实现与 SVG 左右手法相反，旋转 90° 的衣柜拉角会算错并跳成近似正方形。）
 */
export function worldToFurnitureLocal(wx: number, wz: number, f: Pick<Furniture, "x" | "z" | "rotation">) {
  const rot = f.rotation ?? 0;
  const dx = wx - f.x;
  const dz = wz - f.z;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return { lx: dx * cos - dz * sin, lz: dx * sin + dz * cos };
}

export function furnitureLocalToWorld(lx: number, lz: number, f: Pick<Furniture, "x" | "z" | "rotation">) {
  const rot = f.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return {
    x: f.x + lx * cos + lz * sin,
    z: f.z - lx * sin + lz * cos,
  };
}

export function furnitureCornerLocal(f: Furniture, corner: string) {
  const b = furnitureLocalBounds(f);
  return {
    lx: corner.includes("e") ? b.x1 : b.x0,
    lz: corner.includes("s") ? b.z1 : b.z0,
  };
}

/**
 * 四角拉伸：对角在世界坐标固定，只改被拖角；尺寸可吸附，中心由对角＋尺寸反算，避免跳位。
 * corner：nw／ne／sw／se（局部 −Z 为北）。
 * grabOffset：按下时指针相对角点的局部偏移，避免点手柄中心就整块跳尺寸。
 */
export function resizeFurnitureFromCorner(
  orig: Furniture,
  corner: string,
  worldX: number,
  worldZ: number,
  minSize = 300,
  grabOffset?: { dlx: number; dlz: number },
): Pick<Furniture, "x" | "z" | "w" | "d"> {
  const b = furnitureLocalBounds(orig);
  const fixedLx = corner.includes("w") ? b.x1 : b.x0;
  const fixedLz = corner.includes("n") ? b.z1 : b.z0;
  const local = worldToFurnitureLocal(worldX, worldZ, orig);
  const lx = local.lx - (grabOffset?.dlx ?? 0);
  const lz = local.lz - (grabOffset?.dlz ?? 0);
  const minimum = minimumFurnitureSize(orig.kind, minSize);
  let w = Math.max(minimum.w, Math.abs(lx - fixedLx));
  let d = Math.max(minimum.d, Math.abs(lz - fixedLz));
  if (isRoundFurniture(orig.kind)) {
    const size = Math.max(w, d);
    w = size;
    d = size;
  }
  // 只吸附宽深；位置由固定角反算，不再对 x／z 二次吸附以免对角漂移。
  w = Math.round(w);
  d = Math.round(d);
  const sx = corner.includes("e") ? 1 : -1;
  const sz = corner.includes("s") ? 1 : -1;
  const center = furnitureLocalToWorld(fixedLx + sx * (w / 2), fixedLz + sz * (d / 2), orig);
  return { x: center.x, z: center.z, w, d };
}

/** 把任意旋转角归一到 (-π, π]，避免多次旋转后数值爆掉导致导入／刷新失败。 */
export function normalizeRotation(radians: number) {
  if (!Number.isFinite(radians)) return 0;
  const twoPi = Math.PI * 2;
  let r = radians % twoPi;
  if (r <= -Math.PI) r += twoPi;
  if (r > Math.PI) r -= twoPi;
  // 消掉 -0
  return Object.is(r, -0) ? 0 : r;
}

export function snapRotation(radians: number, stepDeg = 15) {
  const step = (stepDeg * Math.PI) / 180;
  return normalizeRotation(Math.round(radians / step) * step);
}

export function rotationToDeg(radians: number) {
  return Math.round((((normalizeRotation(radians) * 180) / Math.PI) % 360 + 360) % 360);
}

export function degToRotation(deg: number) {
  return normalizeRotation(((deg % 360) * Math.PI) / 180);
}

/** 上游圆桌始终保持直径一致。 */
export function isRoundFurniture(kind: FurnitureKind): boolean {
  return kind === "roundTable" || getFloorplanFurniture(kind)?.type === "roundtable";
}

/** 薄电视、挂机等保留上游尺寸，编辑时不被旧的 300 下限拉厚。 */
export function minimumFurnitureSize(kind: FurnitureKind, minimum = 300) {
  const model = getFloorplanFurniture(kind);
  return model ? { w: Math.min(minimum, model.w), d: Math.min(minimum, model.d) } : { w: minimum, d: minimum };
}
