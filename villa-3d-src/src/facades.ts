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

/** 三楼洞口上沿不得越过下沿线板底（留 clearance）。正屋檐口基准 10.5。 */
export function thirdFloorMaxOpeningHead(eaveY = 10.5) {
  return fasciaBottomY(eaveY, 0) - openingBelowFasciaClearance - floors[2].y;
}

function clampOpeningHead(o: Opening, maxHead: number): Opening {
  const top = o.sill + o.h;
  if (top <= maxHead) return o;
  return { ...o, h: Math.max(0.4, maxHead - o.sill) };
}

// 二楼层顶 7.2 米。正中大门玻璃顶仍停在 6.15 米。两侧窗玻璃顶距层顶 80 厘米，停在 6.40 米，不顶到上面的挑檐。都是造型，不是测绘。
export const secondFloorGlassHead = 6.15;
export const secondFloorSideGlassHead = 7.2 - 0.8;
// 烤火房一二层之间的回纹横披。绝对标高，宽度与窗洞一致。
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

// 平面图和3D使用同一组墙体/洞口。坐标位于墙厚中心线。
export function facades(index: number): Facade[] {
  if (index === 3) {
    // 辅楼外墙中线：前墙外皮 site.annex.z，后墙外皮仍与主楼齐平。
    const front = site.annex.z + 0.12;
    const back = site.annex.z + site.annex.d - 0.12;
    const side0 = front + 0.12;
    const side1 = back - 0.12;
    return [
      wall(
        [0.8, front],
        [5.3, front],
        [{ at: 2.25, w: 2.7, sill: 0.65, h: 2.35 }],
      ),
      wall(
        [0.92, side0],
        [0.92, side1],
        [
          { at: 2.1, w: 1.6, sill: 0.7, h: 2.2 },
          { at: 6.5, w: 1, sill: 1.3, h: 1.5 },
        ],
      ),
      wall(
        [5.18, side0],
        [5.18, side1],
        [
          { at: circulation.sideDoorZ - side0, w: circulation.sideDoorWidth, sill: site.entranceRise, h: 2.5 - site.entranceRise, door: true, open: true },
          { at: 5.8, w: 1.2, sill: 1.2, h: 1.5 },
        ],
      ),
      wall(
        [0.8, back],
        [5.3, back],
        [
          { at: 1.1, w: 0.9, sill: 1.3, h: 1.5 },
          { at: 3.3, w: 1.1, sill: 1.1, h: 1.65 },
        ],
      ),
    ];
  }
  const front = floors[index].front,
    back = site.main.z + site.main.d;
  // 门厅柱已经外伸，房间前墙仍与两侧齐平。正中大门和二楼玻璃是一门到顶，墙洞不断开。
  const upperHead = secondFloorGlassHead - 3.6;
  const sideHead = secondFloorSideGlassHead - 3.6;
  const eastSill = site.entranceRise + 0.34;
  const out: Facade[] =
    index < 2
      ? [
          wall(
            [6.8, front + 0.12],
            [20.3, front + 0.12],
            index === 0
              ? [
                  // 挑空客厅正面：从窗台接到一层墙顶，和二楼玻璃合成一块。
                  { at: 2.35, w: 3.15, sill: site.entranceRise, h: 3.6 - site.entranceRise, span: "lower" },
                  { at: 6.9, w: 2.3, sill: site.entranceRise, h: 3.6 - site.entranceRise, door: true, span: "lower" },
                  { at: 11.15, w: eastTransom.width, sill: eastSill, h: eastTransom.bottom - eastSill, pattern: "villa" },
                ]
              : [
                  // 正中仍停在 6.15 米。两侧玻璃上沿在 6.40 米，墙洞再高 4 厘米，留给窗框内收。
                  { at: 2.35, w: 3.15, sill: 0, h: sideHead, span: "upper" },
                  { at: 6.9, w: 2.3, sill: 0, h: upperHead, span: "upper" },
                  {
                    at: 11.15,
                    w: eastTransom.width,
                    sill: eastTransom.top - 3.6,
                    h: secondFloorSideGlassHead - eastTransom.top + 0.04,
                    pattern: "villa",
                  },
                ],
          ),
        ]
      : (() => {
          const maxH = thirdFloorMaxOpeningHead();
          return [
            wall(
              [6.8, front + 0.12],
              [20.3, front + 0.12],
              [
                // 三楼正面三樘落地玻璃推拉门；上沿压在下沿线以下。
                clampOpeningHead({ at: 2.35, w: 3.2, sill: 0, h: 2.7, door: true, glazed: true, pattern: "sliding" }, maxH),
                clampOpeningHead({ at: 6.9, w: 3.1, sill: 0, h: 2.55, door: true, glazed: true, pattern: "sliding" }, maxH),
                clampOpeningHead({ at: 11.15, w: 2.75, sill: 0, h: 2.7, door: true, glazed: true, pattern: "sliding" }, maxH),
              ],
            ),
          ];
        })();
  // 官帽柱贴一层前墙构造柱垂直面；短侧墙接到三楼退台前墙，挡住横向通道。
  if (index === 2)
    for (const x of frontElevation.postXs)
      out.push(wall([x, frontElevation.postZ + 0.12], [x, front + 0.12]));
  const thirdMax = index === 2 ? thirdFloorMaxOpeningHead() : Infinity;
  const south =
    index === 0
      ? [
          { at: 2.25, w: 2.1, sill: 0.55, h: 2.5 },
          { at: 7.15, w: 0.8, sill: 1.45, h: 1.15 },
          { at: 11.7, w: 2.3, sill: 0.55, h: 2.55 },
        ]
      : index === 1
        ? [
            { at: 2.25, w: 2.1, sill: 0.45, h: 2.6 },
            { at: 7.15, w: 0.8, sill: 1.45, h: 1.15 },
            { at: 11.5, w: 2.2, sill: 0.55, h: 2.45 },
          ]
        : [
            clampOpeningHead({ at: 2.15, w: 1.8, sill: 0.55, h: 2.15 }, thirdMax),
            clampOpeningHead({ at: 7.05, w: 0.9, sill: 1.35, h: 1.2 }, thirdMax),
            clampOpeningHead({ at: 10.15, w: 1.5, sill: 0.7, h: 1.9 }, thirdMax),
            clampOpeningHead({ at: 12.35, w: 1.1, sill: 1.2, h: 1.3 }, thirdMax),
          ];
  out.push(wall([site.main.x, back - 0.12], [20.3, back - 0.12], south));
  out.push(
    wall(
      [6.92, front + 0.24],
      [6.92, back - 0.24],
      index === 2
        ? [
            clampOpeningHead({ at: 1.4, w: 1.5, sill: 0.55, h: 2.2 }, thirdMax),
            clampOpeningHead({ at: 6.5, w: 1.3, sill: 0.7, h: 1.9 }, thirdMax),
          ]
        : [
            { at: 2.05, w: 1.7, sill: 0.55, h: 2.4 },
            ...(index === 0 ? [{ at: circulation.sideDoorZ - (front + 0.24), w: circulation.sideDoorWidth, sill: site.entranceRise, h: 2.5 - site.entranceRise, door: true, open: true }] : []),
            { at: 8.05, w: 1.5, sill: 0.55, h: 2.4 },
          ],
    ),
  );
  out.push(
    wall(
      [20.18, front + 0.24],
      [20.18, back - 0.24],
      index === 2
        ? [
            clampOpeningHead({ at: 2.3, w: 0.9, sill: 1.15, h: 1.25 }, thirdMax),
            clampOpeningHead({ at: 5.7, w: 1.2, sill: 0.55, h: 2.0 }, thirdMax),
          ]
        : index === 0
          ? [
              { at: 1.35, w: 1.5, sill: 0.6, h: 2.35 },
              { at: 4.15, w: 0.8, sill: 1.35, h: 1.15 },
              { at: 8.45, w: 1.0, sill: 0.6, h: 2.3 },
            ]
          : [
              { at: 1.35, w: 1.4, sill: 0.6, h: 2.35 },
              { at: 4.15, w: 0.8, sill: 1.2, h: 1.35 },
              { at: 8.45, w: 1.0, sill: 0.6, h: 2.3 },
            ],
    ),
  );
  return out;
}
