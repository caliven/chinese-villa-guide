export const courtyardFinishLabels = {
  concrete: "普通水泥地",
  tile: "灰色仿石地砖",
} as const;

export type CourtyardFinish = keyof typeof courtyardFinishLabels;
export const courtyardPreferenceKey = "anhua-villa-courtyard-finishes-v1";

export function parseCourtyardFinish(value: unknown): CourtyardFinish {
  // 兼容增加铺装选项之前保存的会议快照。
  if (value === undefined) return "concrete";
  if (value === "concrete" || value === "tile") return value;
  throw new Error("院坪铺装选项无效");
}
