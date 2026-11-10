/** 门厅柱脚／柱头最外层饰线，和 entrance-carvings.ts 共用。 */
export const PORTICO_COLUMN_MAX_TRIM = 50;

/** 参考图一层包角柱脚缩放；造型方座顶＝760×此值。 */
export const CORNER_PEDESTAL_SCALE = 0.82;

/**
 * 包角柱脚方座顶相对院坪的高度。
 * `rise` 取室内抬高时，方座不低于完成面，与外墙英国棕勒脚顶齐平。
 */
export function cornerPedestalTop(scale = CORNER_PEDESTAL_SCALE, rise = 0) {
  return Math.max(760 * scale, rise);
}

/** 柱间雕花横梁的实体进深，沿两根门厅柱的截面中线居中。 */
export const PORTICO_BEAM_DEPTH = 500;

export const porticoColumnOuterWidth = (shaftWidth: number) => shaftWidth + 2 * PORTICO_COLUMN_MAX_TRIM;

/** 飘檐可见收口拐角距柱身外沿留截面的1/8；800柱留100，1000柱留125。 */
export const PORTICO_EAVE_CORNER_INSET_RATIO = 1 / 8;

/** 承托线另扣外凸线脚，保证最终可见拐角按比例落在柱身上。 */
export const porticoEaveCornerOffset = (size: number, fasciaProjection: number) =>
  Math.max(0, size * (0.5 - PORTICO_EAVE_CORNER_INSET_RATIO) - fasciaProjection);

/**
 * 门厅前沿两个直角顶点为柱心（平面 X）；改柱截面或饰线不改变定位轴线。
 * 飘檐折角由 frontApronOutline 单独向柱身外侧偏移，不移动柱轴或门厅控制区。
 */
export function porticoColumnCenters(porch: { x: number; w: number }): [number, number] {
  return [porch.x, porch.x + porch.w];
}

/** 门厅沿主楼中轴居中；默认13600＝4500＋4600＋4500，主辅楼换位仍对称。 */
export function porticoWestOffset(params: { mainWidth: number; porticoWidth: number; buildingPlacement: string }) {
  return Math.round((params.mainWidth - params.porticoWidth) / 2);
}
