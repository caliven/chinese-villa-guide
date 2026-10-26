import { construction, isPhysicalWall, wallRoleOf, type Wall } from "./data";

export type ResizeBox = { x: number; z: number; w: number; d: number };

/** 尺寸编辑锁住原位置附近的墙边；无靠墙关系时沿用调用方的中心或固定角。 */
export function anchorResizedBox(
  original: ResizeBox, proposed: ResizeBox, body: ResizeBox, walls: Wall[],
  options: { gap: number; finish?: number; wallLines?: boolean },
): ResizeBox | null {
  const result = { ...proposed };
  // 室外圆桌等已有室外模型仍留在室外，不能因改规格被送进屋内。
  const cx = original.x + original.w / 2, cz = original.z + original.d / 2;
  if (cx < body.x || cx > body.x + body.w || cz < body.z || cz > body.z + body.d) return result;
  for (const [position, size, cross, crossSize, coordinate] of [
    ["x", "w", "z", "d", 0], ["z", "d", "x", "w", 1],
  ] as const) {
    if (Math.abs(original[size] - proposed[size]) < 0.01) continue;
    const lo = original[position], hi = lo + original[size];
    let min = body[position], max = min + body[size];
    for (const wall of walls) {
      if (!isPhysicalWall(wall) || Math.abs(wall.a[coordinate] - wall.b[coordinate]) > 1) continue;
      const other = coordinate === 0 ? 1 : 0;
      const start = Math.min(wall.a[other], wall.b[other]), end = Math.max(wall.a[other], wall.b[other]);
      const overlaps = (box: ResizeBox) => start < box[cross] + box[crossSize] && end > box[cross];
      if (!overlaps(original) && !overlaps(result)) continue;
      const at = (wall.a[coordinate] + wall.b[coordinate]) / 2;
      const half = (wallRoleOf(wall) === "bearing" ? construction.outsideWall : construction.partition) / 2;
      const pad = options.wallLines ? 0 : half + (options.finish ?? 0);
      // 梯间／墙端的定位线可能在原墙带内，保留该真实接触偏移。
      const contact = options.wallLines ? half + 1 : 1;
      if (at <= lo + contact) min = Math.max(min, options.wallLines && Math.abs(at - lo) <= contact ? lo : at + pad);
      else if (at >= hi - contact) max = Math.min(max, options.wallLines && Math.abs(at - hi) <= contact ? hi : at - pad);
    }
    if (result[size] > max - min + 0.01) return null;
    const nearMin = Math.abs(lo - min), nearMax = Math.abs(hi - max);
    if (Math.min(nearMin, nearMax) <= options.gap) {
      result[position] = nearMin <= nearMax ? min : max - result[size];
    }
    result[position] = Math.max(min, Math.min(max - result[size], result[position]));
  }
  return result;
}
