import { frontElevation, type Point } from "./data";
import { hatPierDesign } from "./column-profiles";
import { eyelidFixed, eyelidStackHeight, fasciaBottomY } from "./roof-options";

export type HatJunction = { x: number; width: number; section: Point[] };

/** 柱冠以上用平底转接梁接入正屋墙顶，不向下附加外露斜腋。 */
export function floatingHatJunctions(hatFront: number, hatEave: number, _mainEave: number,
  wallFront: number, supportInset: number,
  columns: Pick<typeof frontElevation, "postXs" | "postZ" | "dividerWidth"> = frontElevation): HatJunction[] {
  const top = hatEave - eyelidStackHeight(), bottom = fasciaBottomY(hatEave, 0);
  const front = Math.min(hatFront + supportInset - eyelidFixed.fasciaProtrusion,
    columns.postZ - hatPierDesign.capDepth / 2);
  const rear = Math.max(front, columns.postZ + hatPierDesign.capDepth / 2);
  const back = Math.max(rear + 20, wallFront);
  // 梁身与柱身同宽，收在官帽最低层深色线脚内；柱冠保留原有外展。
  const width = columns.dividerWidth;
  return columns.postXs.map(x => ({ x: x - width / 2, width,
    section: [[front, bottom], [back, bottom], [back, top], [front, top]] }));
}

/** 同一闭合棱柱轮廓供三维实体与四向立面投影使用。 */
export function hatJunctionFaces(j: HatJunction): [number, number, number][][] {
  const left = j.section.map(([z, y]): [number, number, number] => [j.x, y, z]);
  const right = j.section.map(([z, y]): [number, number, number] => [j.x + j.width, y, z]);
  return [left.slice().reverse(), right,
    ...left.map((p, i) => { const k = (i + 1) % left.length; return [p, left[k], right[k], right[i]]; })];
}
