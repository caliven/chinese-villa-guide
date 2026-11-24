import { site } from "./data.ts";
import type { TerracePiece } from "./annex-terrace.ts";

/** 开敞式阳光雨棚的效果尺寸，非厂家构件或施工核定规格。 */
export function annexGlassCanopy(
  deckY: number, bounds: { x: number; z: number; w: number; d: number },
) {
  if (site.annexRoofType !== "flat" || site.annexCanopy !== "glass") return null;
  const a = site.annex, east = site.main.x > a.x;
  // 覆盖到三眼皮最外缘之外；烟管另行绕到棚外，不能靠缩小雨棚给烟管让位。
  const outward = east ? -1 : 1;
  const far = east ? a.x - site.eave - 180 : a.x + a.w + site.eave + 180;
  const near = east ? site.main.x - 3 : site.main.x + site.main.w + 3;
  const x0 = Math.min(far, near), x1 = Math.max(far, near);
  const z0 = a.z - site.eave - 180, z1 = a.z + a.d + site.eave + 180;
  const lowY = deckY + 2450, highY = deckY + 2850;
  const slopeX = (highY - lowY) / (near - far);
  const yAt = (x: number) => lowY + (x - far) * slopeX;
  const pieces: TerracePiece[] = [];
  const add = (name: string, finish: TerracePiece["finish"], x: number, z: number, w: number, d: number,
    bottom: number, top: number, slope = 0, slopeZ = 0) => {
    if (w > 0 && d > 0 && top > bottom) pieces.push({ name, finish, x, z, w, d, bottom, top, slopeX: slope, slopeZ });
  };
  const beam = 80, depth = 140;
  // 前后边梁和中间主椽顺坡，玻璃嵌在分格内，避免面与框叠压。
  const bays = Math.max(2, Math.ceil((z1 - z0) / 1100));
  const zs = Array.from({ length: bays + 1 }, (_, i) => z0 + (z1 - z0) * i / bays);
  for (const z of zs)
    add("阳光雨棚顺坡梁", "metal", (x0 + x1) / 2, z, x1 - x0, beam, yAt((x0 + x1) / 2) - depth, yAt((x0 + x1) / 2), slopeX);
  const xs = [x0 + beam / 2, (x0 + x1) / 2, x1 - beam / 2];
  for (const x of xs) for (let j = 0; j < zs.length - 1; j++)
    add("阳光雨棚纵向框梁", "metal", x, (zs[j] + zs[j + 1]) / 2, beam, zs[j + 1] - zs[j] - beam,
      yAt(x) - depth, yAt(x), slopeX);
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const left = xs[i] + beam / 2 + 4, right = xs[i + 1] - beam / 2 - 4, x = (left + right) / 2;
    add("阳光雨棚分格玻璃顶", "canopyGlass", x, (zs[j] + zs[j + 1]) / 2,
      right - left, zs[j + 1] - zs[j] - beam - 8, yAt(x) - 24, yAt(x) - 12, slopeX);
  }
  // 每列仅在南北两端各设一根柱，中间不再增加落地柱，连接平台由顶梁跨接。
  // 栏杆靠边不带着雨棚承重柱一起外移；棚沿可探出，落地柱仍独立内收。
  const supportInset = Math.min(450, bounds.w / 6, bounds.d / 6);
  const farPost = east ? bounds.x + supportInset : bounds.x + bounds.w - supportInset;
  const nearPost = east ? bounds.x + bounds.w - supportInset - 120 : bounds.x + supportInset + 120;
  const front = bounds.z + supportInset, back = bounds.z + bounds.d - supportInset;
  for (const x of [farPost, nearPost]) {
    for (const z of [front, back])
      add("阳光雨棚落地立柱", "metal", x, z, 100, 100, deckY + 3, yAt(x) - depth - 3);
    // 柱头承托梁与顺坡梁分层相接，不把立柱挂在玻璃下面。
    add("阳光雨棚柱顶承托梁", "metal", x, (front + back) / 2, 120, back - front + 100,
      yAt(x) - depth - 120, yAt(x) - depth - 3);
  }
  // 靠主楼高边设上翻泛水；低边收水槽在挑檐外，南北两端敞口顺槽排水。
  add("阳光雨棚靠墙泛水", "metal", near + outward * 35, (z0 + z1) / 2, 64, z1 - z0,
    yAt(near + outward * 35) + 3, yAt(near + outward * 35) + 100, slopeX);
  const drainX = far + outward * 75, gutterWidth = 190, gutterBottom = lowY - 180;
  const middleZ = (z0 + z1) / 2;
  for (const [start, end, rise] of [[z0 - 40, middleZ, 20], [middleZ, z1 + 40, -20]])
    add("阳光雨棚外侧收水槽底", "metal", drainX, (start + end) / 2, gutterWidth, end - start,
      gutterBottom + 10, gutterBottom + 18, 0, rise / (end - start));
  for (const x of [drainX - gutterWidth / 2 + 4, drainX + gutterWidth / 2 - 4])
    add("阳光雨棚外侧收水槽壁", "metal", x, middleZ, 8, z1 - z0 + 80, gutterBottom + 8,
      x === drainX - outward * (gutterWidth / 2 - 4) ? lowY - 30 : lowY + 8);
  // 两端不设封堵端板或向西伸出的水嘴，水沿槽底坡向从南北端直接流出。
  const outlets = [z0 - 40, z1 + 40].map(z => ({ x: drainX, z }));
  const peak = Math.max(...pieces.flatMap(p => terracePieceCorners(p).map(v => v[1])));
  return { x: x0, z: z0, w: x1 - x0, d: z1 - z0, lowY, highY, peak, slopeX, pieces,
    far, near, drainX, outlets, outerEdgeX: drainX + outward * gutterWidth / 2 };
}

/** 共用倾斜薄盒的角点，立面投影与Three.js使用同一剪切斜率。 */
export function terracePieceCorners(p: TerracePiece): [number, number, number][] {
  return [p.bottom, p.top].flatMap(y => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) =>
    [p.x + sx * p.w / 2, y + sx * p.w / 2 * (p.slopeX ?? 0) + sz * p.d / 2 * (p.slopeZ ?? 0), p.z + sz * p.d / 2] as [number, number, number]));
}
