/** 两套新建方案的固定身份；每个运行环境从启动到关闭都只属于一个方案。 */
export const constructionSchemes = {
  "three-storey": "三层方案",
  "two-and-half": "两层半方案",
} as const;
export type ConstructionScheme = keyof typeof constructionSchemes;
export function isConstructionScheme(value: unknown): value is ConstructionScheme {
  return value === "three-storey" || value === "two-and-half";
}
export const activeConstructionScheme: ConstructionScheme =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("construction") === "two-and-half"
    ? "two-and-half" : "three-storey";
export const isHalfStoreyScheme = activeConstructionScheme === "two-and-half";
export function schemeDirectory(scheme: ConstructionScheme = activeConstructionScheme) {
  return scheme === "three-storey" ? "scheme" : "scheme/two-and-half";
}
export function dataDirectory(scheme: ConstructionScheme = activeConstructionScheme) {
  return scheme === "three-storey" ? "data" : "data/two-and-half";
}
export function schemeStorageKey(key: string, scheme: ConstructionScheme = activeConstructionScheme) {
  return scheme === "three-storey" ? key : `${key}:two-and-half`;
}
export function assertConstructionScope(value: { constructionScheme?: unknown }, expected = activeConstructionScheme) {
  const actual = value.constructionScheme ?? "three-storey";
  if (!isConstructionScheme(actual) || actual !== expected) throw new Error("文件不属于当前方案，请切换到对应方案后使用");
}
