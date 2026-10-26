import { mirroredBuildings, mirrorFacade, mainLocalX, hasThirdFloorSideTerraces } from "./building-variants";
import { floors, site, frontElevation, circulation, stairLayout, annexRooms, type Point } from "./data";
import {
  DOOR_OPENING,
  FLOOR1_WINDOW,
  FRONT_OPENING,
  doorCenterAgainstHinge,
  type DoorHinge,
  type DoorSide,
  type OpeningKind,
} from "./openings";
import { fasciaBottomY, openingBelowFasciaClearance } from "./roof-options";

export interface Opening {
  at: number;
  w: number;
  sill: number;
  h: number;
  door?: boolean;
  kind?: OpeningKind;
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
  /** 派生的跨层玻璃ID；墙体只开洞，玻璃与框由跨层构件生成一次。 */
  continuous?: string;
  entryAssembly?: string;
  /** 派生洞口对应的草稿索引，拆分凹入立面后仍保留。 */
  layoutSourceIndex?: number;
}

/** 默认主楼面宽（开间／洞口比例基准）。 */
const MAIN_W0 = 13500;
/** 默认辅楼面宽。 */
const ANNEX_W0 = 4500;

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
  return { ...o, h: Math.max(400, maxHead - o.sill) };
}

/** 二楼正中大门玻璃顶：距二层顶 1.05 m（默认 6.15）。 */
export function secondFloorGlassHeadY() {
  return floors[1].y + floors[1].height - 1050;
}

/** 二楼两侧窗玻璃顶：距二层顶 0.8 m（默认 6.40）。 */
export function secondFloorSideGlassHeadY() {
  return floors[1].y + floors[1].height - 800;
}

/** 茶室开间一二层之间的回纹横披（相对一层顶；宽随正立面茶室窗）。 */
export function eastTransomBand() {
  const f1 = floors[0].height;
  return {
    bottom: f1 - 320,
    top: f1 + 320,
    width: FRONT_OPENING.tea.w * (site.main.w / MAIN_W0),
  };
}

/** @deprecated 用 secondFloorGlassHeadY()；保留常量以免旧引用瞬时炸掉。 */
export const secondFloorGlassHead = 6150;
/** @deprecated 用 secondFloorSideGlassHeadY() */
export const secondFloorSideGlassHead = 6400;
/** @deprecated 用 eastTransomBand() */
export const eastTransom = { bottom: 3280, top: 3920, width: 2500 };

export interface Facade {
  a: Point;
  b: Point;
  openings: Opening[];
  sourceFacadeIndex?: number;
  sourceOffset?: number;
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

/** 市面常用窗宽（米）；含短墙用的 0.6／0.75／0.9，按墙段净长选档并居中。 */
const WINDOW_WIDTHS = [600, 750, 900, 1200, 1500, 1800, 2100, 2400] as const;

/** 短于该长度的墙段按短墙比例取窗。 */
export const SHORT_WINDOW_SPAN = 2600;
/** 短墙默认窗宽／墙长上限。 */
export const SHORT_WINDOW_MAX_RATIO = 0.32;
/** 常规开间默认窗宽／墙长上限。 */
export const NORMAL_WINDOW_MAX_RATIO = 0.4;

/** 墙段默认最大窗宽比（与 centeredWindowOnSpan 一致）。 */
export function defaultWindowMaxRatio(spanLen: number) {
  return spanLen < SHORT_WINDOW_SPAN ? SHORT_WINDOW_MAX_RATIO : NORMAL_WINDOW_MAX_RATIO;
}

/**
 * 在墙段长度 spanLen 内选主流窗宽并居中。
 * 常规开间默认约占墙长 40%、两侧各留 ≥0.4 m 垛（4.5 m 开间仍可选 1.8 m）。
 * 短墙（＜2.6 m）默认约 32%、垛 ≥0.5 m，并允许小于 0.9 m，避免「窗占满墙」。
 * @returns at＝洞口中心距墙段起点（与 facades Opening.at 约定一致）；w＝洞宽
 */
export function centeredWindowOnSpan(
  spanLen: number,
  preferred = 1800,
  opts?: { maxRatio?: number; edgeClear?: number },
): { at: number; w: number } {
  if (!(spanLen > 500)) return { at: Math.max(0, spanLen) / 2, w: Math.max(400, spanLen * 0.45) };
  const short = spanLen < SHORT_WINDOW_SPAN;
  const maxRatio = opts?.maxRatio ?? defaultWindowMaxRatio(spanLen);
  const edgeClear = opts?.edgeClear ?? (short ? 500 : 400);
  const byRatio = spanLen * maxRatio;
  const byClear = spanLen - 2 * edgeClear;
  // 短墙允许小于 0.9；下限随墙长收，避免再被抬到「几乎满墙」。
  const maxW = Math.max(450, Math.min(byRatio, byClear));
  const fit = WINDOW_WIDTHS.filter((w) => w <= maxW + 1e-3);
  const w =
    fit.length === 0
      ? Math.min(preferred, maxW)
      : fit.reduce((best, c) => (Math.abs(c - preferred) < Math.abs(best - preferred) ? c : best), fit[0]!);
  return { at: spanLen / 2, w };
}

/** 正面洞口中心世界 X（at0 为默认 13.5 m 墙长上的中心距西端）。 */
export function mainFrontOpeningX(at0: number) {
  return mainLocalX(scaleMainAt(at0));
}

// 平面图和3D使用同一组墙体/洞口。坐标位于墙厚中心线。
export function facades(index: number): Facade[] {
  const faces = unmirroredFacades(index);
  if (!mirroredBuildings()) return faces;
  const body = index === 3 ? site.annex : site.main;
  return faces.map(f => mirrorFacade(f, body.x * 2 + body.w));
}

function unmirroredFacades(index: number): Facade[] {
  if (index === 3) {
    const ax = site.annex.x;
    const aw = site.annex.w;
    const ad = site.annex.d;
    const front = site.annex.z + 120;
    const back = site.annex.z + ad - 120;
    const side0 = front + 120;
    const side1 = back - 120;
    const west = ax + 120;
    const east = ax + aw - 120;
    const sideLen = side1 - side0;
    // 南／北窗居中；西墙按餐厅／厨房分段各居中一樘；东墙仅餐厅通楼门（无厨东门／无厨东窗）
    const northWin = centeredWindowOnSpan(aw, FLOOR1_WINDOW.diningNorth.w);
    const southWin = centeredWindowOnSpan(aw, FLOOR1_WINDOW.cookSouth.w);
    const dining = annexRooms.find((r) => r.id === "dining")!;
    const cook = annexRooms.find((r) => r.id === "cook")!;
    const seg = (z0: number, z1: number) => {
      const a = Math.max(0, z0 - side0);
      const b = Math.min(sideLen, z1 - side0);
      return { a, len: Math.max(800, b - a) };
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
        h: Math.max(1800, site.annex.height - 200 - site.entranceRise),
        door: true,
        hinge: "start",
        side: "out",
      },
    ];
    const annexMaxHead = Math.max(1200, site.annex.height - 120);
    const clampAnnex = (o: Opening) => clampOpeningHead(o, annexMaxHead);
    return [
      wall([ax, front], [ax + aw, front], [
        clampAnnex({
          at: northWin.at,
          w: northWin.w,
          sill: FLOOR1_WINDOW.diningNorth.sill,
          h: FLOOR1_WINDOW.diningNorth.h,
        }),
      ]),
      wall([west, side0], [west, side1], [
        clampAnnex({
          at: diningSeg.a + diningWestWin.at,
          w: diningWestWin.w,
          sill: FLOOR1_WINDOW.diningWest.sill,
          h: FLOOR1_WINDOW.diningWest.h,
        }),
        clampAnnex({
          at: cookSeg.a + cookWestWin.at,
          w: cookWestWin.w,
          sill: FLOOR1_WINDOW.cookWest.sill,
          h: FLOOR1_WINDOW.cookWest.h,
        }),
      ]),
      wall([east, side0], [east, side1], eastOpenings),
      wall([ax, back], [ax + aw, back], [
        clampAnnex({
          at: southWin.at,
          w: southWin.w,
          sill: FLOOR1_WINDOW.cookSouth.sill,
          h: FLOOR1_WINDOW.cookSouth.h,
        }),
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
            [mx, front + 120],
            [me, front + 120],
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
                    h: sideGlassHead - transom.top + 40,
                    pattern: "villa",
                  },
                ],
          ),
        ]
      : (() => {
          const maxH = thirdFloorMaxOpeningHead();
          return [
            wall(
              [mx, front + 120],
              [me, front + 120],
              [
                clampOpeningHead(
                  {
                    at: livingAt,
                    w: livingW,
                    sill: hasThirdFloorSideTerraces() ? 0 : 900,
                    h: hasThirdFloorSideTerraces() ? 2700 : 1800,
                    door: hasThirdFloorSideTerraces(),
                    glazed: true,
                    pattern: hasThirdFloorSideTerraces() ? "sliding" : "villa",
                  },
                  maxH,
                ),
                clampOpeningHead(
                  {
                    at: hallAt,
                    w: hallW,
                    sill: 0,
                    h: 2550,
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
                    sill: hasThirdFloorSideTerraces() ? 0 : 900,
                    h: hasThirdFloorSideTerraces() ? 2700 : 1800,
                    door: hasThirdFloorSideTerraces(),
                    glazed: true,
                    pattern: hasThirdFloorSideTerraces() ? "sliding" : "villa",
                  },
                  maxH,
                ),
              ],
            ),
          ];
        })();

  if (index === 2)
    for (const x of frontElevation.postXs)
      out.push(wall([x, frontElevation.postZ + 120], [x, front + 120]));

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
          const dineWinSeg0 = dineDoorCenter + dineDoorW / 2 + 200;
          const dineWinSegLen = Math.max(1200, bay * 2 - dineWinSeg0);
          const dineWin = centeredWindowOnSpan(dineWinSegLen, FLOOR1_WINDOW.corridor.w, {
            maxRatio: 0.4,
            edgeClear: 350,
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
              h: 2400,
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
            const closetWin = centeredWindowOnSpan(bay / 2, 1200);
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
                sill: 1200,
                h: 1350,
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
            const a = centeredWindowOnSpan(bay, 1500);
            const b = centeredWindowOnSpan(bay, 1200);
            const c = centeredWindowOnSpan(bay * 0.55, 1500);
            const d = centeredWindowOnSpan(bay * 0.45, 1200);
            return [
              clampOpeningHead({ at: a.at, w: a.w, sill: 550, h: 2000 }, thirdMax),
              clampOpeningHead({ at: bay + b.at, w: b.w, sill: 1200, h: 1250 }, thirdMax),
              clampOpeningHead({ at: bay * 2 + c.at, w: c.w, sill: 700, h: 1850 }, thirdMax),
              clampOpeningHead({ at: bay * 2.55 + d.at, w: d.w, sill: 1150, h: 1250 }, thirdMax),
            ];
          })();
  out.push(wall([mx, back - 120], [me, back - 120], south));

  const sideLen = back - 240 - (front + 240);
  const westX = mx + 120;
  const eastX = me - 120;
  out.push(
    wall(
      [westX, front + 240],
      [westX, back - 240],
      index === 2
        ? (() => {
            const a = centeredWindowOnSpan(sideLen * 0.45, 1500);
            const b = centeredWindowOnSpan(sideLen * 0.4, 1300);
            return [
              clampOpeningHead({ at: a.at, w: a.w, sill: 550, h: 2100 }, thirdMax),
              clampOpeningHead({ at: sideLen * 0.55 + b.at, w: b.w, sill: 700, h: 1850 }, thirdMax),
            ];
          })()
        : index === 0
          ? [
              // 通辅楼门：客厅过道中线；扇叶开向主楼内侧（东＝in）
              {
                at: circulation.sideDoorZ - (front + 240),
                w: circulation.sideDoorWidth,
                sill: site.entranceRise,
                h: 2500 - site.entranceRise,
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
      [eastX, front + 240],
      [eastX, back - 240],
      index === 2
        ? (() => {
            const a = centeredWindowOnSpan(sideLen * 0.35, 1200);
            const b = centeredWindowOnSpan(sideLen * 0.4, 1200);
            return [
              clampOpeningHead({ at: sideLen * 0.15 + a.at, w: a.w, sill: 1150, h: 1250 }, thirdMax),
              clampOpeningHead({ at: sideLen * 0.5 + b.at, w: b.w, sill: 550, h: 1950 }, thirdMax),
            ];
          })()
        : index === 0 || index === 1
          ? (() => {
              // 一／二楼东山：删卧室东窗；楼梯段一樘居中高窗（同模数）
              const stairSpan = stairLayout.room.d;
              const stairStart = stairLayout.room.z - (front + 240);
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
              const a = centeredWindowOnSpan(sideLen * 0.35, 1200);
              const b = centeredWindowOnSpan(sideLen * 0.4, 1200);
              return [
                clampOpeningHead({ at: sideLen * 0.15 + a.at, w: a.w, sill: 1150, h: 1250 }, thirdMax),
                clampOpeningHead({ at: sideLen * 0.5 + b.at, w: b.w, sill: 550, h: 1950 }, thirdMax),
              ];
            })(),
    ),
  );
  return out;
}

/** 编辑已有洞口时保持源偏移轴，同时采用该开间真实的凹入墙面。 */
export function openingFacade(floor: number, facadeIndex: number, offset: number): Facade {
  const face = facades(floor)[facadeIndex];
  if (floor === 3 || facadeIndex !== 0 || site.porticoStyle !== "recessed") return face;
  const length = Math.abs(face.b[0] - face.a[0]);
  const x = face.a[0] + (face.b[0] - face.a[0]) * offset / length;
  const shift = x > site.portico.x && x < site.portico.x + site.portico.w ? site.portico.projection : 0;
  return { ...face, a: [face.a[0], face.a[1] + shift], b: [face.b[0], face.b[1] + shift] };
}
