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
  // 门厅柱已经外伸，中间墙与两侧房间齐平，不再内凹。
  const out: Facade[] =
    index < 2
      ? [
          wall(
            [6.8, front + 0.12],
            [20.3, front + 0.12],
            [
              { at: 2.3, w: 2.85, sill: 0.55, h: 2.55 },
              {
                at: 6.9,
                w: 1.85,
                sill: index === 0 ? 0 : 0.4,
                h: index === 0 ? 2.85 : 2.5,
                door: index === 0,
              },
              { at: 11.35, w: 2.1, sill: 0.65, h: 2.35 },
            ],
          ),
        ]
      : [
          wall(
            [6.8, front + 0.12],
            [20.3, front + 0.12],
            [
              { at: 2.6, w: 3.15, sill: 0.55, h: 2.25 },
              { at: 6.9, w: 1.8, sill: 0, h: 2.7, door: true },
              { at: 11.25, w: 2.25, sill: 0.55, h: 2.25 },
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
