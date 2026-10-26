/** 门厅柱脚／柱头最外层饰线，和 entrance-carvings.ts 共用。 */
export const PORTICO_COLUMN_MAX_TRIM = 50;

export const porticoColumnOuterWidth = (shaftWidth: number) => shaftWidth + 2 * PORTICO_COLUMN_MAX_TRIM;

/** 门厅前沿两个直角顶点为柱心；改柱截面或饰线不改变定位轴线。 */
export function porticoColumnCenters(porch: { x: number; w: number }): [number, number] {
  return [porch.x, porch.x + porch.w];
}

/** 两翼余宽按客厅4600、另一翼4500分配；主辅楼换位时一起镜像。 */
export function porticoWestOffset(params: { mainWidth: number; porticoWidth: number; buildingPlacement: string }) {
  const westWing = params.buildingPlacement === "main-west" ? 4500 : 4600;
  return Math.round((params.mainWidth - params.porticoWidth) * westWing / 9100);
}
