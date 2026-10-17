import type { Furniture } from "./data";

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

/** 平面／编辑器用的家具种类（含厨房既有件）。 */
export const FURNITURE_KINDS = [
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
] as const satisfies readonly Furniture["kind"][];

export type FurnitureKind = (typeof FURNITURE_KINDS)[number];

export const furnitureLabels: Record<FurnitureKind, string> = {
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
};

/** 各件在局部坐标下的方位说明（编辑器与协作口述用）。 */
export const furnitureOrientationHints: Record<FurnitureKind, string> = {
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
};

export function furnitureOrientationHint(kind: Furniture["kind"]): string {
  return furnitureOrientationHints[kind as FurnitureKind] ?? FURNITURE_LOCAL_FRAME;
}

/** 该件是否有明确前后（旋转会影响用法）。 */
export function furnitureHasFacing(kind: Furniture["kind"]): boolean {
  return !["coffeeTable", "table", "roundTable"].includes(kind);
}

/** 编辑器下拉：常用项在前。 */
export const furniturePickerOrder: FurnitureKind[] = [
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
];

export const bedNightstand = { w: 0.45, d: 0.4, gap: 0.02 };

/**
 * 床的占地拆分：参数宽／深是房间内 1:1 外轮廓（与墙、房间同比例），
 * 两侧床头柜画在轮廓以内，不再外扩。
 */
export function bedLayout(f: Pick<Furniture, "w" | "d">) {
  const ns = bedNightstand;
  const minMattress = 0.9;
  let nsW = ns.w;
  let gap = ns.gap;
  let mattressW = f.w - 2 * (nsW + gap);
  if (mattressW < minMattress) {
    const avail = Math.max(0, (f.w - minMattress) / 2);
    nsW = Math.min(ns.w, Math.max(0, avail * 0.85));
    gap = Math.min(ns.gap, Math.max(0, avail - nsW));
    mattressW = f.w - 2 * (nsW + gap);
  }
  if (mattressW < 0.6 || nsW < 0.12) {
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
  switch (kind) {
    case "bed":
      // 外轮廓约 2.7×2.1：含两侧床头柜后仍对应常见 1.8 米床垫观感。
      return { w: 2.7, d: 2.1 };
    case "tv":
      return { w: 1.2, d: 0.35 };
    case "sofa":
      return { w: 2.2, d: 0.9 };
    case "coffeeTable":
      return { w: 1.1, d: 0.6 };
    case "table":
      return { w: 1.6, d: 0.8 };
    case "roundTable":
      return { w: 1.2, d: 1.2 };
    case "chair":
      return { w: 0.5, d: 0.55 };
    case "dressingTable":
      return { w: 1.0, d: 0.45 };
    case "cabinet":
      return { w: 1.0, d: 0.45 };
    case "wardrobe":
      return { w: 1.6, d: 0.55 };
    case "basin":
      return { w: 0.8, d: 0.45 };
    case "toilet":
      return { w: 0.4, d: 0.7 };
    case "squatToilet":
      return { w: 0.45, d: 0.65 };
    case "shower":
      // 常见整体淋浴房／淋浴区占地约 0.9×0.9；可拉角改成矩形。
      return { w: 0.9, d: 0.9 };
    case "counter":
      return { w: 1.5, d: 0.6 };
    case "stove":
      return { w: 0.9, d: 0.7 };
    case "hob":
      return { w: 0.75, d: 0.6 };
    case "sink":
      return { w: 0.8, d: 0.55 };
    case "altar":
      return { w: 1.2, d: 0.5 };
    case "shrine":
      // 湖南农村堂屋靠后墙神龛：面宽约一开间中段，进深浅，贴墙。
      return { w: 1.5, d: 0.45 };
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
 * 家具局部包围：宽／深即平面占地（米），与房间、墙同一比例，不再外扩。
 * 床的床头柜含在宽以内；圆桌按直径 w。
 */
export function furnitureLocalBounds(f: Furniture): { x0: number; z0: number; x1: number; z1: number } {
  if (f.kind === "roundTable") {
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
  minSize = 0.3,
  grabOffset?: { dlx: number; dlz: number },
): Pick<Furniture, "x" | "z" | "w" | "d"> {
  const b = furnitureLocalBounds(orig);
  const fixedLx = corner.includes("w") ? b.x1 : b.x0;
  const fixedLz = corner.includes("n") ? b.z1 : b.z0;
  const local = worldToFurnitureLocal(worldX, worldZ, orig);
  const lx = local.lx - (grabOffset?.dlx ?? 0);
  const lz = local.lz - (grabOffset?.dlz ?? 0);
  let w = Math.max(minSize, Math.abs(lx - fixedLx));
  let d = Math.max(minSize, Math.abs(lz - fixedLz));
  if (orig.kind === "roundTable") {
    const size = Math.max(w, d);
    w = size;
    d = size;
  }
  // 只吸附宽深；位置由固定角反算，不再对 x／z 二次吸附以免对角漂移。
  w = Math.round(w * 100) / 100;
  d = Math.round(d * 100) / 100;
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
