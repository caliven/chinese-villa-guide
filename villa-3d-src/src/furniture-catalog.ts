import type { Furniture } from "./data";

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
  counter: "厨柜",
  stove: "柴火灶",
  hob: "灶台",
  sink: "水槽",
  altar: "神案",
  shrine: "神龛（湖南堂屋）",
};

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

export function createFurniture(kind: FurnitureKind, x: number, z: number): Furniture {
  const { w, d } = defaultFurnitureSize(kind);
  return { kind, x, z, w, d, rotation: 0 };
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

export function worldToFurnitureLocal(wx: number, wz: number, f: Pick<Furniture, "x" | "z" | "rotation">) {
  const rot = f.rotation ?? 0;
  const dx = wx - f.x;
  const dz = wz - f.z;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return { lx: dx * cos + dz * sin, lz: -dx * sin + dz * cos };
}

export function furnitureLocalToWorld(lx: number, lz: number, f: Pick<Furniture, "x" | "z" | "rotation">) {
  const rot = f.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return {
    x: f.x + lx * cos - lz * sin,
    z: f.z + lx * sin + lz * cos,
  };
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
