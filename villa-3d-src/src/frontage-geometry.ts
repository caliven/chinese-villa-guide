/** 门厅柱脚／柱头最外层饰线，和 entrance-carvings.ts 共用。 */
export const PORTICO_COLUMN_MAX_TRIM = 50;

/** 柱间雕花横梁的实体进深，沿两根门厅柱的截面中线居中。 */
export const PORTICO_BEAM_DEPTH = 500;

export const porticoColumnOuterWidth = (shaftWidth: number) => shaftWidth + 2 * PORTICO_COLUMN_MAX_TRIM;

/**
 * 门厅前沿两个直角顶点为柱心（平面 X）；改柱截面或饰线不改变定位轴线。
 * 飘檐下沿线折角的平面位置与柱心重合：X＝本函数，Z＝`porticoColumnZ`／`centerFront`。
 */
export function porticoColumnCenters(porch: { x: number; w: number }): [number, number] {
  return [porch.x, porch.x + porch.w];
}

/** 门厅沿主楼中轴居中；默认13600＝4500＋4600＋4500，主辅楼换位仍对称。 */
export function porticoWestOffset(params: { mainWidth: number; porticoWidth: number; buildingPlacement: string }) {
  return Math.round((params.mainWidth - params.porticoWidth) / 2);
}
