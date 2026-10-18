/**
 * 方案长度统一为毫米（存储／计算／平面）；Three.js 场景仍用米，经 toM 或根节点 scale 换算。
 * 面积界面仍用㎡：areaM2(wMm, dMm)。
 */

export const MM_PER_M = 1000;
export const LENGTH_UNITS = "mm" as const;
export type LengthUnits = "mm" | "m";

/** 毫米 → 米（三维几何／相机边界）。 */
export function toM(mm: number): number {
  return mm / MM_PER_M;
}

/** 米 → 毫米（仅迁移旧稿）。 */
export function toMm(m: number): number {
  return m * MM_PER_M;
}

/** 长宽均为毫米时的面积（㎡）。 */
export function areaM2(wMm: number, dMm: number): number {
  return (wMm * dMm) / (MM_PER_M * MM_PER_M);
}

/** 默认按 1 mm 吸附；可传 10＝厘米。 */
export function snapMm(value: number, step = 1): number {
  if (!Number.isFinite(value)) return 0;
  const snapped = Math.round(value / step) * step;
  return Math.round(snapped);
}

/** 图面／面板显示用整数毫米（不带单位后缀）。 */
export function formatMm(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value));
}

/** VillaParams 中非长度字段（勿 ×1000）。 */
export const VILLA_PARAM_NON_LENGTH = new Set([
  "roofFenShui",
  "gutterBedSlope",
  "gutterCopingSlope",
]);

/** 根据 units 标记或 mainWidth 量级判断是否为旧米制稿。 */
export function isMeterLengthPayload(
  raw: unknown,
  hint?: { units?: unknown; mainWidth?: unknown },
): boolean {
  if (hint?.units === "mm" || (raw && typeof raw === "object" && (raw as { units?: string }).units === "mm")) {
    return false;
  }
  if (hint?.units === "m" || (raw && typeof raw === "object" && (raw as { units?: string }).units === "m")) {
    return true;
  }
  const mw =
    typeof hint?.mainWidth === "number"
      ? hint.mainWidth
      : raw && typeof raw === "object" && typeof (raw as { mainWidth?: number }).mainWidth === "number"
        ? (raw as { mainWidth: number }).mainWidth
        : raw &&
            typeof raw === "object" &&
            typeof (raw as { villaParams?: { mainWidth?: number } }).villaParams?.mainWidth === "number"
          ? (raw as { villaParams: { mainWidth: number } }).villaParams.mainWidth
          : undefined;
  // 主楼面宽 13.5 m vs 13500 mm；小于 100 视为米。
  return typeof mw === "number" && Number.isFinite(mw) && mw > 0 && mw < 100;
}

/** 户型草稿是否仍是米制（一层层高 3.6 vs 3600）。 */
export function isMeterLayoutDraft(draft: unknown): boolean {
  if (!draft || typeof draft !== "object") return false;
  const floors = (draft as { floors?: unknown }).floors;
  if (!Array.isArray(floors) || !floors.length) return false;
  const h = (floors[0] as { height?: unknown } | undefined)?.height;
  return typeof h === "number" && Number.isFinite(h) && h > 0 && h < 100;
}

function scaleDeep(value: unknown, factor: number, skipKeys?: Set<string>): unknown {
  if (typeof value === "number" && Number.isFinite(value)) return value * factor;
  if (Array.isArray(value)) return value.map((v) => scaleDeep(v, factor, skipKeys));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (skipKeys?.has(k)) {
        out[k] = v;
        continue;
      }
      // 旋转角、枚举字符串、布尔、schema 等
      if (
        k === "rotation" ||
        // 非长度数值：楼层序号、立面序号、踏步数
        k === "floor" ||
        k === "facadeIndex" ||
        k === "risers" ||
        k === "units" ||
        k === "schema" ||
        k === "id" ||
        k === "title" ||
        k === "savedAt" ||
        k === "name" ||
        k === "note" ||
        k === "kind" ||
        k === "role" ||
        k === "hinge" ||
        k === "side" ||
        k === "purposeStatus" ||
        k === "roofStyle" ||
        k === "courtyardFinish" ||
        k === "neighborCourtyardFinish" ||
        k === "file" ||
        k === "source" ||
        typeof v === "string" ||
        typeof v === "boolean" ||
        v == null
      ) {
        out[k] = v;
        continue;
      }
      if (skipKeys && VILLA_PARAM_NON_LENGTH.has(k) && typeof v === "number") {
        out[k] = v;
        continue;
      }
      out[k] = scaleDeep(v, factor, skipKeys);
    }
    return out;
  }
  return value;
}

/** 将米制 VillaParams 转为毫米（角度／分水除外）。 */
export function migrateVillaParamsToMm<T extends Record<string, unknown>>(params: T): T {
  return scaleDeep(params, MM_PER_M, VILLA_PARAM_NON_LENGTH) as T;
}

/**
 * 户型草稿／楼层几何：坐标与尺寸 ×1000。
 * 跳过 rotation、字符串字段。
 */
export function migrateLayoutLengthsToMm<T>(draft: T): T {
  return scaleDeep(draft, MM_PER_M) as T;
}

/** 院坪尺寸线偏移（平面用户单位）米→毫米。 */
export function migrateCourtyardDimLayoutToMm(
  layout: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(layout)) {
    if (typeof v === "number" && Number.isFinite(v)) out[id] = v * MM_PER_M;
  }
  return out;
}
