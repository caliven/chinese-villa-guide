import { floors, site, frontElevation, circulation, stairLayout, annexRooms, type Point } from "./data";
import {
  DOOR_OPENING,
  FLOOR1_WINDOW,
  FRONT_OPENING,
  doorCenterAgainstHinge,
  type DoorHinge,
  type DoorSide,
} from "./openings";
import { fasciaBottomY, openingBelowFasciaClearance } from "./roof-options";

export interface Opening {
  at: number;
  w: number;
  sill: number;
  h: number;
  door?: boolean;
  /** 双扇平开（堂屋大门等）；默认单开 */
  double?: boolean;
  glazed?: boolean;
  open?: boolean;
  pattern?: "villa" | "panorama" | "lattice" | "sliding";
  /** 平面门扇铰链／开向；仅 door 洞口使用 */
  hinge?: DoorHinge;
  side?: DoorSide;
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

/** 茶室开间一二层之间的回纹横披（相对一层顶；宽随正立面茶室窗）。 */
export function eastTransomBand() {
  const f1 = floors[0].height;
  return {
    bottom: f1 - 0.32,
    top: f1 + 0.32,
    width: FRONT_OPENING.tea.w * (site.main.w / MAIN_W0),
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

/** 市面常用窗宽（米）；按墙段净长选档并居中。 */
const WINDOW_WIDTHS = [1.2, 1.5, 1.8, 2.1, 2.4] as const;

/**
 * 在墙段长度 spanLen 内选主流窗宽并居中。
 * @returns at＝洞口中心距墙段起点（与 facades Opening.at 约定一致）；w＝洞宽
 */
export function centeredWindowOnSpan(
  spanLen: number,
  preferred = 1.8,
  opts?: { maxRatio?: number; edgeClear?: number },
): { at: number; w: number } {
  const maxRatio = opts?.maxRatio ?? 0.55;
  const edgeClear = opts?.edgeClear ?? 0.35;
  const maxW = Math.max(0.9, Math.min(spanLen * maxRatio, spanLen - 2 * edgeClear));
  const fit = WINDOW_WIDTHS.filter((w) => w <= maxW + 1e-6);
  const w =
    fit.length === 0
      ? Math.min(1.2, maxW)
      : fit.reduce((best, c) => (Math.abs(c - preferred) < Math.abs(best - preferred) ? c : best), fit[0]);
  return { at: spanLen / 2, w };
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
    const sideLen = side1 - side0;
    // 南／北窗居中；西墙按餐厅／厨房分段各居中一樘；东墙仅餐厅通楼门（无厨东门／无厨东窗）
    const northWin = centeredWindowOnSpan(aw, FLOOR1_WINDOW.diningNorth.w);
    const southWin = centeredWindowOnSpan(aw, FLOOR1_WINDOW.cookSouth.w, { maxRatio: 0.6 });
    const dining = annexRooms.find((r) => r.id === "dining")!;
    const cook = annexRooms.find((r) => r.id === "cook")!;
    const seg = (z0: number, z1: number) => {
      const a = Math.max(0, z0 - side0);
      const b = Math.min(sideLen, z1 - side0);
      return { a, len: Math.max(0.8, b - a) };
    };
    const diningSeg = seg(dining.z, dining.z + dining.d);
    const cookSeg = seg(cook.z, cook.z + cook.d);
    const diningWestWin = centeredWindowOnSpan(diningSeg.len, FLOOR1_WINDOW.diningWest.w);
    const cookWestWin = centeredWindowOnSpan(cookSeg.len, FLOOR1_WINDOW.cookWest.w);
    const doorW = circulation.sideDoorWidth;
    // 与主楼西墙通辅楼门同轴。口语约定：站在门外面对门说往左／往右。
    // 东墙 a→b＝北→南；side=out 扇叶进餐厅（西）；hinge=start 铰链在北
    // → 面对门推入时门扇往右手边（北）。
    const doorCenter = Math.max(
      doorW / 2,
      Math.min(sideLen - doorW / 2, circulation.sideDoorZ - side0),
    );
    const eastOpenings: Opening[] = [
      {
        at: doorCenter,
        w: doorW,
        sill: site.entranceRise,
        h: Math.max(1.8, site.annex.height - 0.2 - site.entranceRise),
        door: true,
        hinge: "start",
        side: "out",
      },
    ];
    return [
      wall([ax, front], [ax + aw, front], [
        {
          at: northWin.at,
          w: northWin.w,
          sill: FLOOR1_WINDOW.diningNorth.sill,
          h: FLOOR1_WINDOW.diningNorth.h,
        },
      ]),
      wall([west, side0], [west, side1], [
        {
          at: diningSeg.a + diningWestWin.at,
          w: diningWestWin.w,
          sill: FLOOR1_WINDOW.diningWest.sill,
          h: FLOOR1_WINDOW.diningWest.h,
        },
        {
          at: cookSeg.a + cookWestWin.at,
          w: cookWestWin.w,
          sill: FLOOR1_WINDOW.cookWest.sill,
          h: FLOOR1_WINDOW.cookWest.h,
        },
      ]),
      wall([east, side0], [east, side1], eastOpenings),
      wall([ax, back], [ax + aw, back], [
        {
          at: southWin.at,
          w: southWin.w,
          sill: FLOOR1_WINDOW.cookSouth.sill,
          h: FLOOR1_WINDOW.cookSouth.h,
        },
      ]),
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
  // 正立面三开间：西挑空通高、中堂屋大门、东茶室高窗（均偏大气）
  const livingAt = scaleMainAt(FRONT_OPENING.livingVoid.at);
  const livingW = scaleMainW(FRONT_OPENING.livingVoid.w);
  const hallAt = scaleMainAt(FRONT_OPENING.hall.at);
  const hallW = scaleMainW(FRONT_OPENING.hall.w);
  const teaAt = scaleMainAt(FRONT_OPENING.tea.at);
  const teaW = transom.width;
  const teaSill = FRONT_OPENING.tea.sill;
  const teaLowerH = FRONT_OPENING.tea.h;
  const out: Facade[] =
    index < 2
      ? [
          wall(
            [mx, front + 0.12],
            [me, front + 0.12],
            index === 0
              ? [
                  {
                    at: livingAt,
                    w: livingW,
                    sill: site.entranceRise,
                    h: h0 - site.entranceRise,
                    span: "lower",
                  },
                  {
                    at: hallAt,
                    w: hallW,
                    sill: site.entranceRise,
                    h: h0 - site.entranceRise,
                    door: true,
                    double: true,
                    side: "out",
                    span: "lower",
                  },
                  {
                    at: teaAt,
                    w: teaW,
                    sill: teaSill,
                    h: teaLowerH,
                    pattern: "villa",
                  },
                ]
              : [
                  { at: livingAt, w: livingW, sill: 0, h: sideHead, span: "upper" },
                  { at: hallAt, w: hallW, sill: 0, h: upperHead, span: "upper" },
                  {
                    at: teaAt,
                    w: teaW,
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
                  {
                    at: livingAt,
                    w: livingW,
                    sill: 0,
                    h: 2.7,
                    door: true,
                    glazed: true,
                    pattern: "sliding",
                  },
                  maxH,
                ),
                clampOpeningHead(
                  {
                    at: hallAt,
                    w: hallW,
                    sill: 0,
                    h: 2.55,
                    door: true,
                    glazed: true,
                    pattern: "sliding",
                  },
                  maxH,
                ),
                clampOpeningHead(
                  {
                    at: teaAt,
                    w: teaW,
                    sill: 0,
                    h: 2.7,
                    door: true,
                    glazed: true,
                    pattern: "sliding",
                  },
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
  const bay = mw / 3; // 三开间等分示意（4.5 / 13.5）
  const south =
    index === 0
      ? (() => {
          // 横墙向东：in＝扇叶向北（内开入室），out＝向南。屋后看铰链左＝西＝start
          const spareWin = centeredWindowOnSpan(bay, FLOOR1_WINDOW.spare.w);
          const elderWin = centeredWindowOnSpan(bay, FLOOR1_WINDOW.elder.w);
          const dineDoorW = DOOR_OPENING.room;
          const dineDoorCenter = doorCenterAgainstHinge(bay, bay, dineDoorW, "start");
          const dineWinSeg0 = dineDoorCenter + dineDoorW / 2 + 0.2;
          const dineWinSegLen = Math.max(1.2, bay * 2 - dineWinSeg0);
          const dineWin = centeredWindowOnSpan(dineWinSegLen, FLOOR1_WINDOW.corridor.w, {
            maxRatio: 0.7,
            edgeClear: 0.2,
          });
          return [
            {
              at: spareWin.at,
              w: spareWin.w,
              sill: FLOOR1_WINDOW.spare.sill,
              h: FLOOR1_WINDOW.spare.h,
            },
            {
              at: dineDoorCenter,
              w: dineDoorW,
              sill: 0,
              h: 2.4,
              door: true,
              hinge: "start",
              side: "in",
            },
            {
              at: dineWinSeg0 + dineWin.at,
              w: dineWin.w,
              sill: FLOOR1_WINDOW.corridor.sill,
              h: FLOOR1_WINDOW.corridor.h,
            },
            {
              at: bay * 2 + elderWin.at,
              w: elderWin.w,
              sill: FLOOR1_WINDOW.elder.sill,
              h: FLOOR1_WINDOW.elder.h,
            },
          ];
        })()
      : index === 1
        ? (() => {
            // 与一层同开间模数：西主卧／东卧室＝1.8；中开间衣帽间＋公卫用高窗
            const masterWin = centeredWindowOnSpan(bay, FLOOR1_WINDOW.spare.w);
            const closetWin = centeredWindowOnSpan(bay / 2, 1.2);
            const bathWin = centeredWindowOnSpan(bay / 2, FLOOR1_WINDOW.stair.w);
            const eastBedWin = centeredWindowOnSpan(bay, FLOOR1_WINDOW.elder.w);
            return [
              {
                at: masterWin.at,
                w: masterWin.w,
                sill: FLOOR1_WINDOW.spare.sill,
                h: FLOOR1_WINDOW.spare.h,
              },
              {
                at: bay + closetWin.at,
                w: closetWin.w,
                sill: 1.2,
                h: 1.35,
              },
              {
                at: bay + bay / 2 + bathWin.at,
                w: bathWin.w,
                sill: FLOOR1_WINDOW.stair.sill,
                h: FLOOR1_WINDOW.stair.h,
              },
              {
                at: bay * 2 + eastBedWin.at,
                w: eastBedWin.w,
                sill: FLOOR1_WINDOW.elder.sill,
                h: FLOOR1_WINDOW.elder.h,
              },
            ];
          })()
        : (() => {
            const a = centeredWindowOnSpan(bay, 1.5);
            const b = centeredWindowOnSpan(bay, 1.2);
            const c = centeredWindowOnSpan(bay * 0.55, 1.5);
            const d = centeredWindowOnSpan(bay * 0.45, 1.2);
            return [
              clampOpeningHead({ at: a.at, w: a.w, sill: 0.55, h: 2.0 }, thirdMax),
              clampOpeningHead({ at: bay + b.at, w: b.w, sill: 1.2, h: 1.25 }, thirdMax),
              clampOpeningHead({ at: bay * 2 + c.at, w: c.w, sill: 0.7, h: 1.85 }, thirdMax),
              clampOpeningHead({ at: bay * 2.55 + d.at, w: d.w, sill: 1.15, h: 1.25 }, thirdMax),
            ];
          })();
  out.push(wall([mx, back - 0.12], [me, back - 0.12], south));

  const sideLen = back - 0.24 - (front + 0.24);
  const westX = mx + 0.12;
  const eastX = me - 0.12;
  out.push(
    wall(
      [westX, front + 0.24],
      [westX, back - 0.24],
      index === 2
        ? (() => {
            const a = centeredWindowOnSpan(sideLen * 0.45, 1.5);
            const b = centeredWindowOnSpan(sideLen * 0.4, 1.3);
            return [
              clampOpeningHead({ at: a.at, w: a.w, sill: 0.55, h: 2.1 }, thirdMax),
              clampOpeningHead({ at: sideLen * 0.55 + b.at, w: b.w, sill: 0.7, h: 1.85 }, thirdMax),
            ];
          })()
        : index === 0
          ? [
              // 通辅楼门：客厅过道中线；扇叶开向主楼内侧（东＝in）
              {
                at: circulation.sideDoorZ - (front + 0.24),
                w: circulation.sideDoorWidth,
                sill: site.entranceRise,
                h: 2.5 - site.entranceRise,
                door: true,
                hinge: "start",
                side: "in",
              },
            ]
          : // 二楼西山：挑空客厅与主卧套间均不开窗
            [],
    ),
  );
  out.push(
    wall(
      [eastX, front + 0.24],
      [eastX, back - 0.24],
      index === 2
        ? (() => {
            const a = centeredWindowOnSpan(sideLen * 0.35, 1.2);
            const b = centeredWindowOnSpan(sideLen * 0.4, 1.2);
            return [
              clampOpeningHead({ at: sideLen * 0.15 + a.at, w: a.w, sill: 1.15, h: 1.25 }, thirdMax),
              clampOpeningHead({ at: sideLen * 0.5 + b.at, w: b.w, sill: 0.55, h: 1.95 }, thirdMax),
            ];
          })()
        : index === 0 || index === 1
          ? (() => {
              // 一／二楼东山：删卧室东窗；楼梯段一樘居中高窗（同模数）
              const stairSpan = stairLayout.room.d;
              const stairStart = stairLayout.room.z - (front + 0.24);
              const win = centeredWindowOnSpan(stairSpan, FLOOR1_WINDOW.stair.w);
              return [
                {
                  at: Math.max(0, stairStart) + win.at,
                  w: win.w,
                  sill: FLOOR1_WINDOW.stair.sill,
                  h: FLOOR1_WINDOW.stair.h,
                },
              ];
            })()
          : (() => {
              const a = centeredWindowOnSpan(sideLen * 0.35, 1.2);
              const b = centeredWindowOnSpan(sideLen * 0.4, 1.2);
              return [
                clampOpeningHead({ at: sideLen * 0.15 + a.at, w: a.w, sill: 1.15, h: 1.25 }, thirdMax),
                clampOpeningHead({ at: sideLen * 0.5 + b.at, w: b.w, sill: 0.55, h: 1.95 }, thirdMax),
              ];
            })(),
    ),
  );
  return out;
}
