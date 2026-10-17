import { floors, site, frontElevation, circulation, type Point } from "./data";
import { fasciaBottomY, openingBelowFasciaClearance } from "./roof-options";

export interface Opening {
  at: number;
  w: number;
  sill: number;
  h: number;
  door?: boolean;
  glazed?: boolean;
  open?: boolean;
  pattern?: "villa" | "panorama" | "lattice" | "sliding";
  // 挑空客厅和正中大门：下层接到本层墙顶，上层从墙底接上，中间不砌墙。
  span?: "lower" | "upper";
}

/** 默认主楼面宽（开间／洞口比例基准）。 */
const MAIN_W0 = 13.5;
/** 默认辅楼面宽。 */
const ANNEX_W0 = 4.5;

/** 正屋檐口完成面标高＝三层层高累加（默认 10.5）。 */
export function mainEaveY() {
  return floors[0].height + floors[1].height + floors[2].height;
}

/** 三楼洞口上沿不得越过下沿线板底（留 clearance）。 */
export function thirdFloorMaxOpeningHead(eaveY = mainEaveY()) {
  return fasciaBottomY(eaveY, 0) - openingBelowFasciaClearance - floors[2].y;
}

function clampOpeningHead(o: Opening, maxHead: number): Opening {
  const top = o.sill + o.h;
  if (top <= maxHead) return o;
  return { ...o, h: Math.max(0.4, maxHead - o.sill) };
}

/** 二楼正中大门玻璃顶：距二层顶 1.05 m（默认 6.15）。 */
export function secondFloorGlassHeadY() {
  return floors[1].y + floors[1].height - 1.05;
}

/** 二楼两侧窗玻璃顶：距二层顶 0.8 m（默认 6.40）。 */
export function secondFloorSideGlassHeadY() {
  return floors[1].y + floors[1].height - 0.8;
}

/** 烤火房一二层之间的回纹横披（相对一层顶）。 */
export function eastTransomBand() {
  const f1 = floors[0].height;
  return {
    bottom: f1 - 0.32,
    top: f1 + 0.32,
    width: 2.5 * (site.main.w / MAIN_W0),
  };
}

/** @deprecated 用 secondFloorGlassHeadY()；保留常量以免旧引用瞬时炸掉。 */
export const secondFloorGlassHead = 6.15;
/** @deprecated 用 secondFloorSideGlassHeadY() */
export const secondFloorSideGlassHead = 6.4;
/** @deprecated 用 eastTransomBand() */
export const eastTransom = { bottom: 3.28, top: 3.92, width: 2.5 };

export interface Facade {
  a: Point;
  b: Point;
  openings: Opening[];
}
const wall = (a: Point, b: Point, openings: Opening[] = []): Facade => ({
  a,
  b,
  openings,
});

function scaleMainAt(at0: number) {
  return at0 * (site.main.w / MAIN_W0);
}
function scaleMainW(w0: number) {
  return w0 * (site.main.w / MAIN_W0);
}
function scaleAnnexAt(at0: number) {
  return at0 * (site.annex.w / ANNEX_W0);
}
function scaleAnnexAlong(at0: number, along0: number) {
  return at0 * (site.annex.d / along0);
}

/** 正面洞口中心世界 X（at0 为默认 13.5 m 墙长上的中心距西端）。 */
export function mainFrontOpeningX(at0: number) {
  return site.main.x + scaleMainAt(at0);
}

// 平面图和3D使用同一组墙体/洞口。坐标位于墙厚中心线。
export function facades(index: number): Facade[] {
  if (index === 3) {
    const ax = site.annex.x;
    const aw = site.annex.w;
    const ad = site.annex.d;
    const front = site.annex.z + 0.12;
    const back = site.annex.z + ad - 0.12;
    const side0 = front + 0.12;
    const side1 = back - 0.12;
    const west = ax + 0.12;
    const east = ax + aw - 0.12;
    const d0 = 8; // 默认辅楼进深（DEFAULT annexDepth），侧墙洞口沿进深比例
    return [
      wall(
        [ax, front],
        [ax + aw, front],
        [{ at: scaleAnnexAt(2.25), w: scaleAnnexAt(2.7), sill: 0.65, h: 2.35 }],
      ),
      wall(
        [west, side0],
        [west, side1],
        [
          { at: scaleAnnexAlong(2.1, d0), w: scaleAnnexAlong(1.6, d0), sill: 0.7, h: 2.2 },
          { at: scaleAnnexAlong(6.5, d0), w: scaleAnnexAlong(1, d0), sill: 1.3, h: 1.5 },
        ],
      ),
      wall(
        [east, side0],
        [east, side1],
        [
          {
            at: circulation.sideDoorZ - side0,
            w: circulation.sideDoorWidth,
            sill: site.entranceRise,
            h: Math.max(1.8, site.annex.height - 0.2 - site.entranceRise),
            door: true,
            open: true,
          },
          { at: scaleAnnexAlong(5.8, d0), w: scaleAnnexAlong(1.2, d0), sill: 1.2, h: 1.5 },
        ],
      ),
      wall(
        [ax, back],
        [ax + aw, back],
        [
          { at: scaleAnnexAt(1.1), w: scaleAnnexAt(0.9), sill: 1.3, h: 1.5 },
          { at: scaleAnnexAt(3.3), w: scaleAnnexAt(1.1), sill: 1.1, h: 1.65 },
        ],
      ),
    ];
  }

  const mx = site.main.x;
  const mw = site.main.w;
  const me = mx + mw;
  const front = floors[index].front;
  const back = site.main.z + site.main.d;
  const h0 = floors[0].height;
  const h1 = floors[1].height;
  const glassHead = secondFloorGlassHeadY();
  const sideGlassHead = secondFloorSideGlassHeadY();
  const transom = eastTransomBand();
  const upperHead = glassHead - h0;
  const sideHead = sideGlassHead - h0;
  const eastSill = site.entranceRise + 0.34;
  const out: Facade[] =
    index < 2
      ? [
          wall(
            [mx, front + 0.12],
            [me, front + 0.12],
            index === 0
              ? [
                  {
                    at: scaleMainAt(2.35),
                    w: scaleMainW(3.15),
                    sill: site.entranceRise,
                    h: h0 - site.entranceRise,
                    span: "lower",
                  },
                  {
                    at: scaleMainAt(6.9),
                    w: scaleMainW(2.3),
                    sill: site.entranceRise,
                    h: h0 - site.entranceRise,
                    door: true,
                    span: "lower",
                  },
                  {
                    at: scaleMainAt(11.15),
                    w: transom.width,
                    sill: eastSill,
                    h: transom.bottom - eastSill,
                    pattern: "villa",
                  },
                ]
              : [
                  { at: scaleMainAt(2.35), w: scaleMainW(3.15), sill: 0, h: sideHead, span: "upper" },
                  { at: scaleMainAt(6.9), w: scaleMainW(2.3), sill: 0, h: upperHead, span: "upper" },
                  {
                    at: scaleMainAt(11.15),
                    w: transom.width,
                    sill: transom.top - h0,
                    h: sideGlassHead - transom.top + 0.04,
                    pattern: "villa",
                  },
                ],
          ),
        ]
      : (() => {
          const maxH = thirdFloorMaxOpeningHead();
          return [
            wall(
              [mx, front + 0.12],
              [me, front + 0.12],
              [
                clampOpeningHead(
                  { at: scaleMainAt(2.35), w: scaleMainW(3.2), sill: 0, h: 2.7, door: true, glazed: true, pattern: "sliding" },
                  maxH,
                ),
                clampOpeningHead(
                  { at: scaleMainAt(6.9), w: scaleMainW(3.1), sill: 0, h: 2.55, door: true, glazed: true, pattern: "sliding" },
                  maxH,
                ),
                clampOpeningHead(
                  { at: scaleMainAt(11.15), w: scaleMainW(2.75), sill: 0, h: 2.7, door: true, glazed: true, pattern: "sliding" },
                  maxH,
                ),
              ],
            ),
          ];
        })();

  if (index === 2)
    for (const x of frontElevation.postXs)
      out.push(wall([x, frontElevation.postZ + 0.12], [x, front + 0.12]));

  const thirdMax = index === 2 ? thirdFloorMaxOpeningHead() : Infinity;
  const southScale = mw / MAIN_W0;
  const south =
    index === 0
      ? [
          { at: 2.25 * southScale, w: 2.1 * southScale, sill: 0.55, h: 2.5 },
          { at: 7.15 * southScale, w: 0.8 * southScale, sill: 1.45, h: 1.15 },
          { at: 11.7 * southScale, w: 2.3 * southScale, sill: 0.55, h: 2.55 },
        ]
      : index === 1
        ? [
            { at: 2.25 * southScale, w: 2.1 * southScale, sill: 0.45, h: 2.6 },
            { at: 7.15 * southScale, w: 0.8 * southScale, sill: 1.45, h: 1.15 },
            { at: 11.5 * southScale, w: 2.2 * southScale, sill: 0.55, h: 2.45 },
          ]
        : [
            clampOpeningHead({ at: 2.15 * southScale, w: 1.8 * southScale, sill: 0.55, h: 2.15 }, thirdMax),
            clampOpeningHead({ at: 7.05 * southScale, w: 0.9 * southScale, sill: 1.35, h: 1.2 }, thirdMax),
            clampOpeningHead({ at: 10.15 * southScale, w: 1.5 * southScale, sill: 0.7, h: 1.9 }, thirdMax),
            clampOpeningHead({ at: 12.35 * southScale, w: 1.1 * southScale, sill: 1.2, h: 1.3 }, thirdMax),
          ];
  out.push(wall([mx, back - 0.12], [me, back - 0.12], south));

  const depth0 = 10;
  const sideScale = site.main.d / depth0;
  const westX = mx + 0.12;
  const eastX = me - 0.12;
  out.push(
    wall(
      [westX, front + 0.24],
      [westX, back - 0.24],
      index === 2
        ? [
            clampOpeningHead({ at: 1.4 * sideScale, w: 1.5 * sideScale, sill: 0.55, h: 2.2 }, thirdMax),
            clampOpeningHead({ at: 6.5 * sideScale, w: 1.3 * sideScale, sill: 0.7, h: 1.9 }, thirdMax),
          ]
        : [
            { at: 2.05 * sideScale, w: 1.7 * sideScale, sill: 0.55, h: 2.4 },
            ...(index === 0
              ? [
                  {
                    at: circulation.sideDoorZ - (front + 0.24),
                    w: circulation.sideDoorWidth,
                    sill: site.entranceRise,
                    h: 2.5 - site.entranceRise,
                    door: true,
                    open: true,
                  },
                ]
              : []),
            { at: 8.05 * sideScale, w: 1.5 * sideScale, sill: 0.55, h: 2.4 },
          ],
    ),
  );
  out.push(
    wall(
      [eastX, front + 0.24],
      [eastX, back - 0.24],
      index === 2
        ? [
            clampOpeningHead({ at: 2.3 * sideScale, w: 0.9 * sideScale, sill: 1.15, h: 1.25 }, thirdMax),
            clampOpeningHead({ at: 5.7 * sideScale, w: 1.2 * sideScale, sill: 0.55, h: 2.0 }, thirdMax),
          ]
        : index === 0
          ? [
              { at: 1.35 * sideScale, w: 1.5 * sideScale, sill: 0.6, h: 2.35 },
              { at: 4.15 * sideScale, w: 0.8 * sideScale, sill: 1.35, h: 1.15 },
              { at: 8.45 * sideScale, w: 1.0 * sideScale, sill: 0.6, h: 2.3 },
            ]
          : [
              { at: 1.35 * sideScale, w: 1.4 * sideScale, sill: 0.6, h: 2.35 },
              { at: 4.15 * sideScale, w: 0.8 * sideScale, sill: 1.2, h: 1.35 },
              { at: 8.45 * sideScale, w: 1.0 * sideScale, sill: 0.6, h: 2.3 },
            ],
    ),
  );
  return out;
}
