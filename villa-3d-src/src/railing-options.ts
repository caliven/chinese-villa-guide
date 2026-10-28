export const railingStyleLabels = {
  glass: "玻璃 · 通透分片",
  wood: "实木 · 扶手竖栏",
  marble: "大理石栏杆",
  steel: "钢制 · 简约竖杆",
} as const;

/** brick 仅兼容旧方案，显示与渲染统一使用 marble。 */
export type RailingStyle = keyof typeof railingStyleLabels | "brick";
export const canonicalRailingStyle = (style: RailingStyle) => style === "brick" ? "marble" : style;
export const isRailingStyle = (value: unknown): value is RailingStyle =>
  value === "brick" || typeof value === "string" && Object.hasOwn(railingStyleLabels, value);

/** 旧方案参数及缺省造型；新选择保存在楼梯／挑空对象上。 */
export const interiorRailing = { living: "glass" as RailingStyle, stair: "wood" as RailingStyle };
export const resolvedRailingStyle = (own: RailingStyle | undefined, kind: keyof typeof interiorRailing) => canonicalRailingStyle(own ?? interiorRailing[kind]);
export function parseOptionalRailingStyle(value: unknown, label: string): RailingStyle | undefined {
  if (value === undefined) return undefined;
  if (!isRailingStyle(value)) throw new Error(`${label}栏杆造型无效`);
  return value;
}
export const railingThickness = (style: RailingStyle) => style === "brick" || style === "marble" ? 150 : style === "wood" ? 100 : 70;
