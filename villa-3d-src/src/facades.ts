import { floors, site, type Point } from "./data";
export interface Opening {
  at: number;
  w: number;
  sill: number;
  h: number;
  door?: boolean;
}
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
          { at: 3.0, w: 1.1, sill: 0, h: 2.5, door: true },
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
  // 门厅柱已经外伸，房间前墙仍与两侧齐平。正面窗洞按效果图拉高，门上留横披。
  const out: Facade[] =
    index < 2
      ? [
          wall(
            [6.8, front + 0.12],
            [20.3, front + 0.12],
            index === 0
              ? [
                  { at: 2.35, w: 3.15, sill: 0.38, h: 2.78 },
                  { at: 6.9, w: 1.65, sill: 0, h: 2.52, door: true },
                  { at: 6.9, w: 1.65, sill: 2.66, h: 0.64 },
                  { at: 11.15, w: 2.55, sill: 0.38, h: 2.78 },
                ]
              : [
                  { at: 2.35, w: 3.15, sill: 0.42, h: 2.52 },
                  { at: 6.9, w: 1.65, sill: 0.48, h: 2.42 },
                  { at: 11.15, w: 2.4, sill: 0.42, h: 2.52 },
                ],
          ),
        ]
      : [
          wall(
            [6.8, front + 0.12],
            [20.3, front + 0.12],
            [
              { at: 2.35, w: 3.2, sill: 0.38, h: 2.35 },
              { at: 6.9, w: 1.7, sill: 0, h: 2.55, door: true },
              { at: 11.15, w: 2.35, sill: 0.38, h: 2.35 },
            ],
          ),
        ];
  const south =
    index === 0
      ? [
          { at: 2.3, w: 2.9, sill: 0.55, h: 2.6 },
          { at: 5.2, w: 0.75, sill: 0.7, h: 2.3 },
          { at: 7, w: 0.85, sill: 1.5, h: 1.25 },
          { at: 11.2, w: 2.5, sill: 0.65, h: 2.45 },
        ]
      : index === 1
        ? [
            { at: 2.3, w: 2.9, sill: 0.25, h: 2.9 },
            { at: 6.7, w: 2.65, sill: 0.65, h: 2.4 },
            { at: 11.2, w: 2.65, sill: 0.65, h: 2.4 },
          ]
        : [
            { at: 3, w: 3, sill: 0.65, h: 2.2 },
            { at: 7.1, w: 1.45, sill: 0, h: 2.6 },
            { at: 11.1, w: 2.65, sill: 0.65, h: 2.2 },
          ];
  out.push(wall([site.main.x, back - 0.12], [20.3, back - 0.12], south));
  out.push(
    wall(
      [6.92, front + 0.24],
      [6.92, back - 0.24],
      [
        { at: 2, w: 1.85, sill: 0.7, h: 2.2 },
        { at: back - front - 2.6, w: 2.6, sill: 0.55, h: 2.5 },
      ],
    ),
  );
  out.push(
    wall(
      [20.18, front + 0.24],
      [20.18, back - 0.24],
      [
        { at: 2.4, w: 1.25, sill: 1.3, h: 1.45 },
        { at: back - front - 2.1, w: 1.5, sill: 0.7, h: 2.3 },
      ],
    ),
  );
  return out;
}
