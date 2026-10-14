import { floors, site, frontElevation, circulation, type Point } from "./data";
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
  if (index === 3)
    return [
      wall(
        [0.8, -0.88],
        [5.3, -0.88],
        [{ at: 2.25, w: 2.7, sill: 0.65, h: 2.35 }],
      ),
      wall(
        [0.92, -0.76],
        [0.92, 8.76],
        [
          { at: 2.1, w: 1.6, sill: 0.7, h: 2.2 },
          { at: 7.5, w: 1, sill: 1.3, h: 1.5 },
        ],
      ),
      wall(
        [5.18, -0.76],
        [5.18, 8.76],
        [
          { at: circulation.sideDoorZ + 0.76, w: circulation.sideDoorWidth, sill: site.entranceRise, h: 2.5 - site.entranceRise, door: true, open: true },
          { at: 6.8, w: 1.2, sill: 1.2, h: 1.5 },
        ],
      ),
      wall(
        [0.8, 8.88],
        [5.3, 8.88],
        [
          { at: 1.1, w: 0.9, sill: 1.3, h: 1.5 },
          { at: 3.3, w: 1.1, sill: 1.1, h: 1.65 },
        ],
      ),
    ];
  const front = floors[index].front,
    back = 9;
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
      : [
          wall(
            [6.8, front + 0.12],
            [20.3, front + 0.12],
            [
              // 三楼正面三樘都是落地玻璃推拉门。门高沿用原来的窗顶，窗台取消。造型，不是测绘。
              { at: 2.35, w: 3.2, sill: 0, h: 2.7, door: true, glazed: true, pattern: "sliding" },
              { at: 6.9, w: 3.1, sill: 0, h: 2.55, door: true, glazed: true, pattern: "sliding" },
              { at: 11.15, w: 2.75, sill: 0, h: 2.7, door: true, glazed: true, pattern: "sliding" },
            ],
          ),
        ];
  // 官帽柱及短侧墙退到栏杆之后。前面露台开敞，后退的柱墙挡住横向通道。
  if (index === 2)
    for (const x of frontElevation.postXs)
      out.push(wall([x, frontElevation.postZ + 0.12], [x, front + 0.12]));
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
            { at: 2.15, w: 1.8, sill: 0.55, h: 2.15 },
            { at: 7.05, w: 0.9, sill: 1.35, h: 1.2 },
            { at: 10.15, w: 1.5, sill: 0.7, h: 1.9 },
            { at: 12.35, w: 1.1, sill: 1.2, h: 1.3 },
          ];
  out.push(wall([site.main.x, back - 0.12], [20.3, back - 0.12], south));
  out.push(
    wall(
      [6.92, front + 0.24],
      [6.92, back - 0.24],
      index === 2
        ? [
            { at: 1.4, w: 1.5, sill: 0.55, h: 2.2 },
            { at: 6.5, w: 1.3, sill: 0.7, h: 1.9 },
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
            { at: 2.3, w: 0.9, sill: 1.15, h: 1.25 },
            { at: 5.7, w: 1.2, sill: 0.55, h: 2.0 },
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
