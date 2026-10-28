import { alignedEntryOpenings } from "./entry-assembly";
import { recessedFloor, recessedPortico, porticoFrontZ as currentPorticoFrontZ, porticoWallZ, mainLocalX, mirroredBuildings, recessFrontFacades, recessedFootprint, fitFacadeOpening, hasThirdFloorSideTerraces, frontTerracePosts, thirdFloorWingIsClosed } from "./building-variants";
import { porticoColumnCenters, porticoColumnOuterWidth } from "./frontage-geometry";
import {
  floors,
  site,
  frontElevation,
  stairLayout,
  circulation,
  annexRooms,
  annexFurniture,
  annexPartitions,
  construction,
  courtyardFront,
  courtyardArcAnchors,
  neighborCourtyardPlan,
  type Floor,
  type Room,
  type Wall,
  wallRoleOf,
  isPhysicalWall,
  type Furniture,
} from "./data";
import { contourAt } from "./contours";
import { facades, type Facade } from "./facades";
import { roomAreaLabels, roomAreas, roomFillBounds, roomFillGeometry, roomLabelPosition } from "./design-data";
import { physicalWallJoinExtensions, roomIsRectangular } from "./room-geometry";
import { formatMm } from "./units";
import { collectPlanDimensions, collectPlanSiteDimensions, planDimSpanMm, type PlanBuilding } from "./plan-dimensions";
import { virtualWallRegions } from "./plan-regions";
import { ensureFurnitureWallClearance } from "./layout-align";
import type { LayoutDraft, StairDraft, PorticoDraft, VoidDraft, ExteriorOpeningDraft } from "./layout-draft";
import { draftHasStair } from "./layout-draft";
import { stairShape, stairWellBounds, fitStairToRoom } from "./stair-geometry";
import { livingVoidGuards, stairFloorGuards } from "./interior-guards";
import { canonicalRailingStyle, resolvedRailingStyle, railingStyleLabels, railingThickness } from "./railing-options";
import { bedLayout, furnitureHasFacing, furnitureHasUseZone, furnitureLocalBounds, isRoundFurniture } from "./furniture-catalog";
import { floorplanFurnitureSymbol } from "./floorplan-furniture";
import { openingSymbolSvg, openingHandlesSvg, normalizeOpening } from "./openings";
import {
  type CourtyardDimLayout,
  yardDimDir,
  yardDimDirectEps,
  yardDimLabelGap,
  yardDimTick,
} from "./courtyard-dim-drag";

const colors: Record<Room["kind"], string> = {
  bed: "#e1e9de",
  living: "#eee7d6",
  hall: "#f0ecdf",
  bath: "#dfe9e9",
  stair: "#e3e3dc",
  kitchen: "#e9ded0",
  dining: "#eee3ce",
  store: "#e5dfd1",
  void: "url(#void)",
};
export { colors as planRoomColors };
/**
 * 户型平面图整体旋转 180°：门头（北）朝下、屋后（南）朝上。
 * 世界坐标仍为 X 东、Z 南；仅改变 SVG 观看方向。院坪总图不转。
 */
export const PLAN_ENTRANCE_DOWN = true;

/** 文字在旋转组内再转 180°，屏幕上保持正读；extraRotate 用于竖排尺寸等。 */
const text = (x: number, y: number, content: string, cls = "room-name", extraRotate?: number) => {
  const parts: string[] = [];
  if (PLAN_ENTRANCE_DOWN) parts.push(`rotate(180 ${x} ${y})`);
  if (extraRotate != null) parts.push(`rotate(${extraRotate} ${x} ${y})`);
  const tAttr = parts.length ? ` transform="${parts.join(" ")}"` : "";
  return `<text x="${x}" y="${y}" class="${cls}" text-anchor="middle"${tAttr}>${content}</text>`;
};
const rect = (x: number, z: number, w: number, d: number, attrs = "") =>
  `<rect x="${x}" y="${z}" width="${w}" height="${d}" ${attrs}/>`;

/**
 * 平面白底与视口：四周为链式墙距标线留空（内档墙间＋外档总宽／总进深）。
 * 编辑拖墙时标线随 PlanSource 重算，故视口略放大以免短边溢出。
 */
function planFrame(xLo: number, xHi: number, north: number, south: number) {
  const x = dimN(xLo - 3000), z = dimN(north - 2200);
  const w = dimN(xHi - xLo + 6000), h = dimN(south - north + 3800);
  return { viewBox: `${x} ${z} ${w} ${h}`, board: { x, z, w, h } };
}

function planViewCenter(viewBox: string) {
  const [vx, vz, vw, vh] = viewBox.split(/\s+/).map(Number);
  return { cx: vx + vw / 2, cy: vz + vh / 2 };
}

/** 平面 SVG 用户单位＝mm；坐标取整即可。 */
const dimN = (n: number) => Math.round(n);

/** 户型图链式标注间距（mm）：贴边 → 墙间档 → 总长档。 */
const PLAN_DIM_FACE = 500;
const PLAN_DIM_CHAIN = 820;
/** 参考户型图：尺寸端点用斜短划，不用正交端线。 */
function dimSlash(x: number, z: number) {
  // 斜短划约为原先 1/3，避免挡毫米数字
  const s = 40;
  return `<path d="M${dimN(x - s)} ${dimN(z + s)} L${dimN(x + s)} ${dimN(z - s)}" class="dim-tick-slash"/>`;
}

/**
 * 水平链式墙距（毫米数字，仿参考图）。
 * fromZ＝被量边，引出线连到标注档。
 */
function hDimChain(
  breaks: number[],
  z: number,
  opts: { labelSide: "north" | "south"; fromZ: number | ((x: number) => number) },
) {
  if (breaks.length < 2) return "";
  const z0 = dimN(z);
  const from = (x: number) => dimN(typeof opts.fromZ === "function" ? opts.fromZ(x) : opts.fromZ);
  const ext = breaks
    .map((x) => `<path d="M${dimN(x)} ${from(x)} V${z0}" class="dim-ext"/>`)
    .join("");
  const x0 = dimN(breaks[0]);
  const x1 = dimN(breaks[breaks.length - 1]);
  const line = `<path d="M${x0} ${z0} H${x1}" class="dim-line"/>`;
  const ticks = breaks.map((x) => dimSlash(x, z)).join("");
  let labels = "";
  for (let i = 0; i < breaks.length - 1; i++) {
    const a = breaks[i];
    const b = breaks[i + 1];
    const seg = planDimSpanMm(a, b);
    if (seg <= 0) continue;
    const mid = dimN((a + b) / 2);
    const ly = dimN(opts.labelSide === "north" ? z - 300 : z + 360);
    labels += text(mid, ly, String(seg), "dim-mm");
  }
  return `${ext}${line}${ticks}${labels}`;
}

/** 竖直链式墙距（毫米）。 */
function vDimChain(
  breaks: number[],
  x: number,
  opts: { side: "east" | "west"; fromX: number | ((z: number) => number); inwardLabel?: boolean },
) {
  if (breaks.length < 2) return "";
  const xx = dimN(x);
  const from = (z: number) => dimN(typeof opts.fromX === "function" ? opts.fromX(z) : opts.fromX);
  const ext = breaks
    .map((z) => `<path d="M${from(z)} ${dimN(z)} H${xx}" class="dim-ext"/>`)
    .join("");
  const z0 = dimN(breaks[0]);
  const z1 = dimN(breaks[breaks.length - 1]);
  const line = `<path d="M${xx} ${z0} V${z1}" class="dim-line"/>`;
  const ticks = breaks.map((z) => dimSlash(x, z)).join("");
  const rot = opts.side === "east" ? 90 : -90;
  let labels = "";
  for (let i = 0; i < breaks.length - 1; i++) {
    const a = breaks[i];
    const b = breaks[i + 1];
    const seg = planDimSpanMm(a, b);
    if (seg <= 0) continue;
    const mid = dimN((a + b) / 2);
    const offset = (opts.inwardLabel ? -1 : 1) * 300;
    const lx = dimN(opts.side === "east" ? x + offset : x - offset);
    labels += text(lx, mid, String(seg), "dim-mm", rot);
  }
  return `${ext}${line}${ticks}${labels}`;
}

/**
 * 外圈：接外墙的墙线定位（只标相交侧）＋主楼堂屋开间控制＋外皮总尺寸。
 * 总宽只标北侧、总进深只标东侧，避免对边重复；贯通墙的定位尺寸在相交两侧均保留。
 */
function planOuterDimensions(index: number, northClear: number, source: PlanSource, building: PlanBuilding, continuous = false, selectedStair = false) {
  const body = building === "annex" ? site.annex : site.main;
  const dims = collectPlanDimensions(index, source.floor, source.annexPartitions, building);
  const { northXs, southXs, eastZs, westZs, controls, xLo, xHi, front, south } = dims;
  const porticoControl = building === "main" && controls.length > 2;
  // 同一组毫米端点只画一条链；不能用近似距离吞掉真实的墙线偏移。
  const sameNorthChain = porticoControl && northXs.length === controls.length
    && northXs.every((x, i) => dimN(x) === dimN(controls[i]));
  const northDetail = northXs.length > 2 && !sameNorthChain, southDetail = southXs.length > 2;
  const eastDetail = eastZs.length > 2, westDetail = westZs.length > 2;
  const nInner = northClear - PLAN_DIM_FACE;
  const sInner = south + PLAN_DIM_FACE;
  const nWall = nInner;
  const sWall = sInner;
  // 门头朝下时北侧在画面下方：墙线 → 堂屋开间控制（4500｜4500｜4600）→ 总宽。
  const nControl = nWall - (northDetail ? PLAN_DIM_CHAIN : 0);
  const nOuter = nControl - (porticoControl ? PLAN_DIM_CHAIN : 0);
  // 梯间模型边框不是墙线；仅在选中楼梯时补局部宽深，不拆整栋外圈定位链。
  const stair = building === "main" && source.stairPresent && selectedStair ? source.stair.room : null;
  const sStair = sWall + (southDetail ? PLAN_DIM_CHAIN : 0);
  const sOuter = stair ? sStair : sWall;
  const eastFace = body.x + body.w;
  const westFace = body.x;
  const eInner = eastFace + PLAN_DIM_FACE;
  const eWall = eInner;
  const eOuter = eWall + (eastDetail ? PLAN_DIM_CHAIN : 0);
  const wInner = westFace - PLAN_DIM_FACE;
  const wWall = wInner;
  const wOuter = wWall - (westDetail ? PLAN_DIM_CHAIN : 0);
  // 连续画布的子孙道只有1800：两侧仅放墙线链，数字各自朝向所属建筑；
  // 辅楼总进深移到外侧，不能与主楼西侧墙距占同一条线。
  const gapSide = continuous && index === 0;
  const annexOverallWest = gapSide && building === "annex" && !mirroredBuildings();
  const overallWest = gapSide && building === "main" && mirroredBuildings() || annexOverallWest;
  const caption = (x: number, content: string) => continuous ? text(x, south + 850, content, "dim-chain-caption") : "";
  const group = (side: string, kind: string, title: string, svg: string) =>
    `<g data-dim-side="${side}" data-dim-kind="${kind}"><title>${title}</title>${svg}</g>`;
  const horizontal = (side: "north" | "south", breaks: number[], z: number) =>
    group(side, "walls", "墙线定位：标注与该侧外墙相交的实体墙及虚拟分界（贯通线两侧均标）",
      hDimChain(breaks, z, { labelSide: side, fromZ: (x) => dims.horizontalFrom(side, x) }));
  const parts = [
    northDetail ? horizontal("north", northXs, nWall) : "",
    porticoControl
      ? group(
          "north",
          "control",
          "面宽分档：客厅侧｜堂屋／门厅｜另一翼（门头侧；旋转后在画面下方）",
          hDimChain(controls, nControl, {
            labelSide: "north",
            // 中间4500两端是堂屋开间边线，与外伸门厅柱最外缘对齐。
            fromZ: (x) => {
              const porch = source.portico;
              const atCol =
                Math.abs(x - porch.x) < 2 || Math.abs(x - (porch.x + porch.w)) < 2;
              return atCol ? frontElevation.porticoColumnZ : front;
            },
          }),
        )
      : "",
    group("north", "overall", "外轮廓总宽", hDimChain([xLo, xHi], nOuter, {
      labelSide: "north",
      fromZ: porticoControl ? nControl : northDetail ? nWall : front,
    })),
    southDetail ? horizontal("south", southXs, sWall) : "",
    stair ? group("south", "stair", "选中梯间局部宽度（模型边框，非墙线或净宽）",
      hDimChain([stair.x, stair.x + stair.w], sStair, { labelSide: "south", fromZ: stair.z + stair.d })) : "",
    stair ? (() => {
      const west = stair.x + stair.w / 2 < (xLo + xHi) / 2;
      const x = west ? wOuter - (overallWest ? PLAN_DIM_CHAIN : 0)
        : eOuter + (overallWest ? 0 : PLAN_DIM_CHAIN);
      return group(west ? "west" : "east", "stair", "选中梯间局部进深（模型边框，非墙线或净宽）",
        vDimChain([stair.z, stair.z + stair.d], x, { side: west ? "west" : "east", fromX: west ? stair.x : stair.x + stair.w }));
    })() : "",
    // 总宽只保留北侧；南侧仅保留接南墙的墙线定位。
    eastDetail ? group("east", "walls", `${building === "main" ? "主楼" : "辅楼"}东侧墙线定位（外皮至墙线；仅接东外墙的实体墙及虚拟分界）`, vDimChain(eastZs, eWall, { side: "east", fromX: (z) => dims.verticalFrom("east", z), inwardLabel: gapSide && (mirroredBuildings() ? building === "main" : building === "annex") }) + (gapSide && (mirroredBuildings() ? building === "main" : building === "annex") ? caption(eWall, building === "main" ? "主楼东侧" : "辅楼东侧") : "")) : "",
    group(overallWest ? "west" : "east", "overall", "外皮总进深", vDimChain([front, south], overallWest ? wOuter : eOuter, { side: overallWest ? "west" : "east", fromX: overallWest ? westDetail ? wWall : westFace : eastDetail ? eWall : eastFace })),
    westDetail ? group("west", "walls", `${building === "main" ? "主楼" : "辅楼"}西侧墙线定位（外皮至墙线；仅接西外墙的实体墙及虚拟分界；贯通线两侧均标）`, vDimChain(westZs, wWall, { side: "west", fromX: (z) => dims.verticalFrom("west", z), inwardLabel: gapSide && (mirroredBuildings() ? building === "annex" : building === "main") }) + (gapSide && (mirroredBuildings() ? building === "annex" : building === "main") ? caption(wWall, building === "main" ? "主楼西侧" : "辅楼西侧") : "")) : "",
    // 总进深只保留东侧；西侧仅保留接西墙的墙线定位。
  ];
  return { svg: parts.join(""), northOuter: nOuter, southOuter: sOuter };
}

/** 房间框开间×进深（毫米）；不据此生成建筑外部定位尺寸。 */
function roomSizeMm(r: Room) {
  return `${Math.round(r.w)}×${Math.round(r.d)}`;
}

/** 墙段中点旁标注厚度（毫米），短墙段跳过。 */
function wallThicknessLabel(a: [number, number], b: [number, number], thickness: number, outward = 1) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 900) return "";
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  const nx = (-(b[1] - a[1]) / len) * 320 * outward;
  const nz = ((b[0] - a[0]) / len) * 320 * outward;
  const mm = Math.round(thickness);
  return text(mx + nx, mz + nz, String(mm), "wall-thick-label");
}

export interface PlanSource {
  floor: Floor;
  annexRooms: Room[];
  annexPartitions: Wall[];
  annexFurniture: Furniture[];
  portico: PorticoDraft;
  stair: StairDraft;
  livingVoid: VoidDraft;
  sideDoorZ: number;
  sideDoorWidth: number;
  thirdFront: number;
  exteriorOpenings: ExteriorOpeningDraft[];
  /** 草稿已接管外墙洞口时，不再叠画 facades 静态窗。 */
  exteriorManaged: boolean;
  /** 无楼梯房间时不画踏步／命中框，避免只剩「楼梯」字或空踏步。 */
  stairPresent: boolean;
}

export function planSourceFromPublished(index: number): PlanSource {
  return {
    floor: recessedFloor(floors[index]),
    annexRooms,
    annexPartitions,
    annexFurniture,
    portico: site.portico,
    stair: fitStairToRoom(stairLayout as StairDraft, floors),
    livingVoid: circulation.livingVoid,
    sideDoorZ: circulation.sideDoorZ,
    sideDoorWidth: circulation.sideDoorWidth,
    thirdFront: floors[2].front,
    exteriorOpenings: [],
    exteriorManaged: false,
    stairPresent: floors.some((f) => f.rooms.some((r) => r.kind === "stair")),
  };
}

export function planSourceFromDraft(draft: LayoutDraft, index: number): PlanSource {
  return {
    floor: recessedFloor(draft.floors[index]),
    annexRooms: draft.annexRooms,
    annexPartitions: draft.annexPartitions,
    annexFurniture: draft.annexFurniture,
    portico: draft.portico,
    stair: fitStairToRoom(draft.stairLayout, draft.floors),
    livingVoid: draft.livingVoid,
    sideDoorZ: draft.sideDoorZ,
    sideDoorWidth: draft.sideDoorWidth,
    thirdFront: draft.floors[2].front,
    exteriorOpenings: alignedEntryOpenings(draft).map(item => item.opening.kind === "slidingDoor" && thirdFloorWingIsClosed(item.floor, item.facadeIndex, item.opening.offset + item.opening.width / 2)
      ? { ...item, opening: { ...item.opening, kind: "window" as const } } : item),
    exteriorManaged: draft.exteriorManaged,
    stairPresent: draftHasStair(draft),
  };
}

function partition(
  p: Wall,
  index: number,
  editable: boolean,
  selectedDoor = false,
  selectedWall = false,
  showWallWidth = false,
  /** null＝整段；否则只画保留段（选中房间贴边已抠掉）。 */
  strokeKeep: [number, number][] | null = null,
  peers: WallStrokePeer[] = [],
) {
  const angle = (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI,
    len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  const role = wallRoleOf(p);
  const virtual = role === "virtual";
  const bearing = role === "bearing";
  const thick = bearing ? construction.outsideWall : construction.partition;
  const cls = bearing ? "bearing-wall" : "partition";
  // 虚拟墙可视线极细，命中区单独加宽；实体墙沿用原热区宽度。
  const hit = editable
    ? `<path d="M0 0 H${len}" class="edit-hit${virtual ? " virtual-wall-hit" : ""}" data-edit="wall" data-index="${index}" stroke-width="${virtual ? "280" : "350"}"/>`
    : "";
  let opening = "";
  const openingHide: [number, number][] = [];
  if (p.door && !virtual) {
    const o = normalizeOpening(p.door);
    openingHide.push([o.offset, o.offset + o.width]);
    opening = editable
      ? openingHandlesSvg(o, index, false, selectedDoor, thick)
      : openingSymbolSvg(o, thick);
    if (editable && selectedDoor) {
      opening += `<rect x="${o.offset}" y="-160" width="${o.width}" height="320" class="edit-selection" fill="none"/>`;
    }
  }
  const wallSel = editable && selectedWall
    ? `<path d="M0 0 H${len}" class="edit-selection" fill="none" stroke-width="120"/>
      <rect x="-120" y="-120" width="240" height="240" class="edit-handle" data-edit="wall-handle" data-end="a" data-index="${index}"/>
      <rect x="${len - 120}" y="-120" width="240" height="240" class="edit-handle" data-edit="wall-handle" data-end="b" data-index="${index}"/>`
    : "";
  const widthMark = showWallWidth && !virtual
    ? wallThicknessLabel(p.a, p.b, thick)
    : "";
  const join = wallStrokeJoinExtend(p, peers);
  const stroke = virtual ? `<path d="M0 0 H${len}" class="virtual-wall"/>` : wallStrokePaths(
    cutStrokeKeepByOpenings(len, strokeKeep, openingHide),
    len,
    cls,
    thick,
    join,
  );
  return `<g transform="translate(${p.a[0]} ${p.a[1]}) rotate(${angle})" data-wall="${index}" data-wall-role="${role}">${hit}${stroke}${opening}${wallSel}</g>${widthMark}`;
}
function cornerColumn(x: number, z: number, outward: number, outwardZ = -1) {
  const project = frontElevation.cornerProject, leg = frontElevation.cornerLeg;
  const style = 'fill="#d7d0c2" stroke="#8a8c83" stroke-width="30"';
  const x0 = Math.min(x + outward * project, x - outward * leg);
  const faceZ = Math.min(z, z + outwardZ * project);
  const sideZ = outwardZ < 0 ? z : z - leg;
  return rect(x0, faceZ, leg + project, project, style) + rect(Math.min(x, x + outward * project), sideZ, project, leg, style);
}
function facade(
  p: Facade,
  facadeIndex: number,
  floorKey: number,
  editable: boolean,
  draftOpenings: ExteriorOpeningDraft[],
  selectedExteriorIndex: number | null,
  exteriorManaged: boolean,
  showWallWidth = false,
  /** null＝整段；否则只画保留段（选中房间贴边已抠掉）。 */
  strokeKeep: [number, number][] | null = null,
  peers: WallStrokePeer[] = [],
) {
  const angle = (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI,
    len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  if (p.sourceFacadeIndex != null) {
    const sourceIndex = p.sourceFacadeIndex, shift = p.sourceOffset ?? 0;
    draftOpenings = draftOpenings.map(item => {
      if (item.floor !== floorKey || item.facadeIndex !== sourceIndex) return { ...item, floor: -1 };
      const center = item.opening.offset + item.opening.width / 2;
      const fitted = sourceIndex === 0 ? fitFacadeOpening(center, item.opening.width, shift, shift + len)
        : { offset: item.opening.offset - shift, width: item.opening.width };
      if (!fitted) return { ...item, floor: -1 };
      return { ...item, facadeIndex, opening: { ...item.opening, ...fitted } };
    });
  }
  const thick = construction.outsideWall;
  const hit = editable && (!recessedPortico() || p.sourceFacadeIndex != null)
    ? `<path d="M0 0 H${len}" class="edit-hit" data-edit="facade" data-index="${facadeIndex}" data-floor="${floorKey}" stroke-width="400"/>`
    : "";
  const openingHide: [number, number][] = [];
  // 已托管时只画草稿洞口，避免静态窗盖住／挡住可拖手柄。
  const published = exteriorManaged
    ? ""
    : p.openings
        .map((o) => {
          openingHide.push([o.at - o.w / 2, o.at + o.w / 2]);
          const gap = `<path d="M${o.at - o.w / 2} 0 h${o.w}" class="door-gap" stroke-width="${thick + 40}"/>`;
          if (o.open) return gap;
          if (o.door) {
            const wallO = normalizeOpening({
              offset: o.at - o.w / 2,
              width: o.w,
              kind: o.double ? "doubleDoor" : "door",
              hinge: o.hinge,
              side: o.side,
            });
            return gap + openingSymbolSvg(wallO, thick);
          }
          return `${gap}<path d="M${o.at - o.w / 2} -70 h${o.w} M${o.at - o.w / 2} 70 h${o.w}" class="window"/>`;
        })
        .join("");
  const extras = draftOpenings
    .map((item, globalIndex) => {
      if (item.floor !== floorKey || item.facadeIndex !== facadeIndex) return "";
      const o = normalizeOpening(item.opening);
      openingHide.push([o.offset, o.offset + o.width]);
      const selected = selectedExteriorIndex === globalIndex;
      const body = editable
        ? openingHandlesSvg(o, globalIndex, true, selected, thick)
        : openingSymbolSvg(o, thick);
      const sel =
        editable && selected
          ? `<rect x="${o.offset}" y="-160" width="${o.width}" height="320" class="edit-selection" fill="none"/>`
          : "";
      return body + sel;
    })
    .join("");
  const widthMark = showWallWidth && len >= 1200
    ? wallThicknessLabel(p.a, p.b, thick, -1)
    : "";
  const join = wallStrokeJoinExtend(p, peers);
  const stroke = wallStrokePaths(
    cutStrokeKeepByOpenings(len, strokeKeep, openingHide),
    len,
    "outside-wall",
    thick,
    join,
  );
  return `<g transform="translate(${p.a[0]} ${p.a[1]}) rotate(${angle})" data-facade="${facadeIndex}">${hit}${stroke}${published}${extras}</g>${widthMark}`;
}
/**
 * 家具平面符号局部约定（与 furniture-catalog 一致）：
 * +Z＝后方（靠背／床头／贴墙），−Z＝前方（落座／使用），±X＝左右扶手。
 * 前方尖角示意「人站／坐／看」的一侧。
 */
function furnitureFacingMark(f: Furniture, pick: string) {
  if (!furnitureHasFacing(f.kind)) return "";
  const tip = -f.d / 2 - 60;
  const base = -f.d / 2 + Math.min(120, f.d * 0.12);
  const half = Math.min(100, f.w * 0.12);
  return `<path d="M0 ${tip} L${-half} ${base} L${half} ${base} Z" class="furniture facing-mark"${pick}/>`;
}

/** pick：写在真实绘制图形上，空白／外包矩形不能点选。 */
export function furnitureSymbol(f: Furniture, pick = "") {
  const upstream = floorplanFurnitureSymbol(f, pick);
  if (upstream !== undefined) return upstream + furnitureFacingMark(f, pick);
  const cls = `furniture ${f.kind}`;
  const a = (classes: string, extra = "") => `${extra} class="${classes}"${pick}`.trim();
  const face = furnitureFacingMark(f, pick);
  if (f.kind === "roundTable") {
    return `<circle cx="0" cy="0" r="${f.w / 2}" ${a(cls)}/><circle r="${Math.min(580, f.w * 0.28)}" ${a("furniture")}/>`;
  }
  if (f.kind === "bed") {
    // 后方＝床头（枕头＋床头柜）；前方＝床尾
    const layout = bedLayout(f);
    const mattress = rect(
      -layout.mattressW / 2,
      -f.d / 2,
      layout.mattressW,
      f.d,
      a(cls, 'rx="60"'),
    );
    const pillow = rect(
      -layout.mattressW / 2 + 80,
      f.d / 2 - 500,
      Math.max(300, layout.mattressW - 160),
      340,
      a("furniture pillow", 'rx="70"'),
    );
    const night = layout.showNightstands
      ? [-1, 1]
          .map((side) => {
            const x = side * (f.w / 2 - layout.nsW / 2);
            const z = f.d / 2 - layout.nsD;
            return rect(x - layout.nsW / 2, z, layout.nsW, layout.nsD, a("furniture nightstand", 'rx="40"'));
          })
          .join("")
      : "";
    return `${mattress}${pillow}${night}${face}`;
  }
  if (f.kind === "tv") {
    // 前方＝屏幕（−Z）；后方＝机背贴墙
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx="40"'))}${rect(-f.w / 2 + 60, -f.d / 2 + 40, f.w - 120, f.d * 0.35, a("furniture tv-screen"))}${face}`;
  }
  if (f.kind === "sofa") {
    // 后方靠背、前方落座、左右双侧扶手
    const arm = 140;
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx="80"'))}${rect(-f.w / 2, -f.d / 2, arm, f.d, a("furniture sofa-arm", 'rx="40"'))}${rect(f.w / 2 - arm, -f.d / 2, arm, f.d, a("furniture sofa-arm", 'rx="40"'))}${rect(-f.w / 2 + arm, f.d / 2 - 160, f.w - 2 * arm, 160, a("furniture sofa-back", 'rx="40"'))}${face}`;
  }
  if (f.kind === "toilet") {
    // 前方坐盆，后方水箱
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d * 0.55, a(cls, 'rx="80"'))}${rect(-f.w / 2, -f.d / 2 + f.d * 0.5, f.w, f.d * 0.5, a("furniture toilet-tank", 'rx="40"'))}${face}`;
  }
  if (f.kind === "squatToilet") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx="50"'))}<ellipse cx="0" cy="0" rx="${f.w * 0.22}" ry="${f.d * 0.32}" ${a("furniture squat-hole")}/>${face}`;
  }
  if (f.kind === "basin") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx="50"'))}<ellipse cx="0" cy="${-f.d * 0.06}" rx="${f.w * 0.32}" ry="${f.d * 0.28}" ${a("furniture basin-bowl")}/>${face}`;
  }
  if (f.kind === "shower") {
    // 托盘＋地漏；前方开门侧用虚线表示玻璃门
    const door = `<path d="M${-f.w / 2 + 60} ${-f.d / 2} H${f.w / 2 - 60}" class="furniture shower-door"${pick}/>`;
    const drain = `<circle cx="0" cy="${f.d * 0.12}" r="${Math.min(f.w, f.d) * 0.08}" class="furniture shower-drain"${pick}/>`;
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx="40"'))}${drain}${door}${face}`;
  }
  if (f.kind === "chair") {
    // 前方坐面，后方靠背条
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d * 0.62, a(cls, 'rx="50"'))}${rect(-f.w / 2, f.d / 2 - 80, f.w, 80, a("furniture chair-back"))}${face}`;
  }
  if (f.kind === "dressingTable") {
    // 前方镜面／人坐侧
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx="50"'))}${rect(-f.w / 2 + 80, -f.d / 2, f.w - 160, 60, a("furniture mirror-base"))}${face}`;
  }
  if (f.kind === "wardrobe" || f.kind === "cabinet") {
    // 前方柜门中缝
    const door = `<path d="M0 ${-f.d / 2} V${f.d / 2}" class="furniture door-seam"${pick}/><path d="M${-f.w / 4} ${-f.d / 2 + 80} H${-f.w / 4 + 60} M${f.w / 4} ${-f.d / 2 + 80} H${f.w / 4 - 60}" class="furniture door-knob"${pick}/>`;
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx="60"'))}${door}${face}`;
  }
  if (f.kind === "shrine") {
    // 后方贴墙柜背（+Z），前方龛台朝人（−Z）
    const shelf = [-0.28, 0, 0.28]
      .map((t) => rect(-f.w / 2 + 100, t * f.d * 0.55 - 40, f.w - 200, 80, a("furniture shrine-shelf")))
      .join("");
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx="40"'))}${shelf}${rect(-f.w / 2 + 60, f.d / 2 - 60, f.w - 120, 60, a("furniture shrine-back"))}${face}`;
  }
  if (f.kind === "counter" || f.kind === "stove" || f.kind === "hob" || f.kind === "sink" || f.kind === "altar") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx="60"'))}${face}`;
  }
  if (f.kind === "railing") {
    // 窄条＋虚线表示栏杆；前方＝临空，后方＝楼板侧
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls))}
      <path d="M${-f.w / 2} 0 H${f.w / 2}" class="furniture railing-line"${pick}/>${face}`;
  }
  return rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx="60"'));
}

function furniture(f: Furniture, index: number, editable: boolean, selected = false, primary = false) {
  const b = furnitureLocalBounds(f);
  // 点选写在真实图形上，不再用外扩矩形热区。
  const pick = editable ? ` data-edit="furniture" data-index="${index}"` : "";
  // 多选时非主项只画选中框；缩放／旋转手柄留给主选，避免误触。
  const outline =
    editable && selected
      ? rect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0, 'class="edit-selection" fill="none"')
      : "";
  // 角点手柄略缩进，避免伸出体块太多误点空白；旋转只保留蓝点本体。
  const handles =
    editable && selected && primary
      ? `${[["nw", b.x0, b.z0], ["ne", b.x1, b.z0], ["sw", b.x0, b.z1], ["se", b.x1, b.z1]]
          .map(([c, x, z]) => `<rect x="${Number(x) - 80}" y="${Number(z) - 80}" width="160" height="160" class="edit-handle" data-edit="furniture-handle" data-corner="${c}" data-index="${index}"/>`)
          .join("")}
        <circle cx="0" cy="${b.z0 - 350}" r="120" class="edit-rotate-handle" data-edit="furniture-rotate" data-index="${index}"/>
        <path d="M0 ${b.z0} V${b.z0 - 350}" class="edit-rotate-stem"/>`
      : "";
  // 家具不在图上写名称，避免与房间标注抢视线；名称只在属性卡片里改。
  return `<g class="furniture-root" transform="translate(${f.x} ${f.z}) rotate(${(-(f.rotation ?? 0) * 180) / Math.PI})" data-furniture="${index}">${furnitureSymbol(f, pick)}${outline}${handles}</g>`;
}
function room(r: Room, floorIndex: number, editable: boolean, annex = false, partitions?: Wall[]) {
  const hit = editable
    ? ` data-edit="room" data-id="${r.id}"${annex ? ' data-annex="1"' : ""}`
    : "";
  const status = r.boundary?.status === "unbounded" ? "墙边界已失去围合" : r.boundary?.status === "open" ? "开敞分区" : "";
  return `<g tabindex="0" role="button" data-room="${r.id}" aria-label="${r.name}，${status || r.note || "点击查看空间说明"}"${hit}>${roomFillShape(r, floorIndex, partitions, "room-fill")}</g>`;
}

function roomFillShape(r: Room, floorIndex: number, partitions: Wall[] | undefined, cls: string) {
  if (r.outline?.length || r.boundary) return `<path d="${roomFillGeometry(r, floorIndex, partitions).pathData}" fill="${colors[r.kind]}" fill-rule="evenodd" class="${cls}"/>`;
  const b = roomFillBounds(r, floorIndex, partitions);
  return rect(b.x, b.z, b.w, b.d, `fill="${colors[r.kind]}" class="${cls}"`);
}

/** 一层返跑在头顶，不能把其投影填成落地房间；上层表达完整梯井。 */
function stairPlan(s: StairDraft, floorIndex: number, editable: boolean, roomId: string) {
  const g = stairShape(s), well = stairWellBounds(s);
  const box = (b: typeof well, cls: string) => rect(b.x, b.z, b.w, b.d, `class="${cls}"`);
  const path = (a: number, l: number, b: number, m: number, cls: string) => {
    const p = g.point(a, l), q = g.point(b, m);
    return `<path d="M${p.x} ${p.z} L${q.x} ${q.z}" class="${cls}"/>`;
  };
  if (g.model === "triple") {
    const flights = g.flights.map((f, index) => {
      const overhead = floorIndex === 0 && index > 0;
      const lines = Array.from({ length: f.risers }, (_, i) => f.axis === "along"
        ? path(f.cross, f.along + i * f.tread, f.cross + f.crossSize, f.along + i * f.tread, "step-line")
        : path(f.cross + i * f.tread, f.along, f.cross + i * f.tread, f.along + f.alongSize, "step-line")).join("");
      const length = f.axis === "along" ? f.alongSize : f.crossSize;
      const sign = f.sign * (floorIndex === 2 ? -1 : 1);
      const pt = (t: number) => g.point(f.cross + (f.axis === "across" ? length * t : f.crossSize / 2), f.along + (f.axis === "along" ? length * t : f.alongSize / 2));
      const a = pt(sign > 0 ? .2 : .8), b = pt(sign > 0 ? .8 : .2);
      const len = Math.hypot(b.x - a.x, b.z - a.z), u = (b.x - a.x) / len, v = (b.z - a.z) / len;
      const arrow = `<path d="M${a.x} ${a.z} L${b.x} ${b.z} M${b.x - u * 140 - v * 80} ${b.z - v * 140 + u * 80} L${b.x} ${b.z} L${b.x - u * 140 + v * 80} ${b.z - v * 140 - u * 80}" class="stair-arrow"/>${text(a.x, a.z, floorIndex === 2 ? "下" : "上", "stair-note")}`;
      return `<g data-stair-flight="${index + 1}">${box(f.bounds, overhead ? "stair-overhead" : "stair-flight")}${!overhead ? lines : ""}
        ${!overhead ? rect(f.bounds.x, f.bounds.z, f.bounds.w, f.bounds.d, `class="edit-hit" ${editable ? 'data-edit="stair"' : ''} fill="transparent"`) : ""}
        <g pointer-events="none">${!overhead ? arrow : ""}</g></g>`;
    }).join("");
    const platforms = g.platforms.map((p, i) => `${box(p.bounds, floorIndex === 0 && i === 1 ? "stair-overhead" : "stair-platform")}${floorIndex > 0 || i === 0 ? rect(p.bounds.x, p.bounds.z, p.bounds.w, p.bounds.d, `class="edit-hit" ${editable ? 'data-edit="stair"' : ''} fill="transparent"`) : ""}`).join("");
    const label = g.point(g.across / 2, g.run / 2);
    return `<g data-stair-floor="${floorIndex}" data-stair-model="triple" data-stair-direction="${s.axis}:${g.direction}" data-lower-side="${g.lowerSide}" data-room="${roomId}" tabindex="0" role="button" aria-label="三跑楼梯，三段直梯与两个转角平台">
      ${flights}${platforms}<g pointer-events="none">${text(label.x, label.z, "三跑楼梯", "stair-note")}${text(label.x, label.z + 230, `梯间 ${Math.round(well.w)}×${Math.round(well.d)}`, "stair-size")}</g></g>`;
  }
  const treads = (cross: number, start: number, count: number) => Array.from({length: count + 1}, (_, i) =>
    path(cross, start + i * s.tread, cross + s.flight, start + i * s.tread, "step-line")).join("");
  const arrow = (cross: number, reverse: boolean, label: string) => {
    const a = g.point(cross + s.flight / 2, g.run * (reverse ? 0.8 : 0.15));
    const b = g.point(cross + s.flight / 2, g.run * (reverse ? 0.15 : 0.8));
    const u = (b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z), v = (b.z - a.z) / Math.hypot(b.x - a.x, b.z - a.z);
    return `<path d="M${a.x} ${a.z} L${b.x} ${b.z} M${b.x - u * 180 - v * 100} ${b.z - v * 180 + u * 100} L${b.x} ${b.z} L${b.x - u * 180 + v * 100} ${b.z - v * 180 - u * 100}" class="stair-arrow"/>${text(a.x, a.z, label, "stair-note")}`;
  };
  // 仅实体梯段／平台可选中；一层右侧梯下留给房间与家具的命中区域。
  const hits = [g.lower, g.landing, ...(floorIndex > 0 ? [g.upper] : [])].map(b =>
    rect(b.x, b.z, b.w, b.d, `class="edit-hit" ${editable ? 'data-edit="stair"' : ''} fill="transparent"`)).join("");
  const label = g.point(g.lowerAcross + s.flight / 2, g.run / 2);
  const free = g.point(g.upperAcross + s.flight / 2, g.run / 2);
  const size = g.point(g.across / 2, g.run + s.landing / 2);
  return `<g data-stair-floor="${floorIndex}" data-stair-direction="${s.axis}:${g.direction}" data-lower-side="${g.lowerSide}" data-room="${roomId}" tabindex="0" role="button" aria-label="楼梯，一层返跑下方可用，两侧优先共用已有墙体">
    ${box(g.lower, "stair-flight")}${box(g.landing, "stair-platform")}
    ${floorIndex > 0 ? box(g.upper, "stair-flight") : box(g.upper, "stair-overhead")}
    ${treads(g.lowerAcross, g.lowerStart, g.lowerTreads)}
    ${floorIndex > 0 ? treads(g.upperAcross, g.upperStart, g.upperTreads) : ""}
    ${hits}
    <g pointer-events="none">${arrow(g.lowerAcross, floorIndex === 2, floorIndex === 2 ? "下" : "上")}
    ${floorIndex > 0 ? arrow(g.upperAcross, false, "下") : text(free.x, free.z, "梯下可用", "stair-note")}
    ${text(label.x, label.z, "楼梯", "stair-note")}
    ${text(size.x, size.z, `梯间 ${Math.round(well.w)}×${Math.round(well.d)}`, "stair-size")}
    </g></g>`;
}

/** 墙段参数区间：与选中房间外包络重合的部分（用来藏绿墙线，避免与橙框叠粗）。 */
function wallHideIntervalsForRoom(w: Pick<Wall, "a" | "b">, r: Room): [number, number][] {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  if (len < 1e-6) return [];
  const near = (a: number, b: number) => Math.abs(a - b) < 20;
  const toT = (x: number, z: number) => {
    const dx = x - w.a[0];
    const dz = z - w.a[1];
    return (dx * (w.b[0] - w.a[0]) + dz * (w.b[1] - w.a[1])) / len;
  };
  const occlude = (at: number, lo: number, hi: number, axis: 0 | 1): [number, number] | null => {
    if (!near(w.a[axis], at) || !near(w.b[axis], at)) return null;
    const other = (1 - axis) as 0 | 1;
    const w0 = Math.min(w.a[other], w.b[other]);
    const w1 = Math.max(w.a[other], w.b[other]);
    const o0 = Math.max(w0, lo);
    const o1 = Math.min(w1, hi);
    if (o1 - o0 <= 50) return null;
    const p0: [number, number] = axis === 0 ? [at, o0] : [o0, at];
    const p1: [number, number] = axis === 0 ? [at, o1] : [o1, at];
    const t0 = toT(p0[0], p0[1]);
    const t1 = toT(p1[0], p1[1]);
    return [Math.min(t0, t1), Math.max(t0, t1)];
  };
  return [
    occlude(r.x, r.z, r.z + r.d, 0),
    occlude(r.x + r.w, r.z, r.z + r.d, 0),
    occlude(r.z, r.x, r.x + r.w, 1),
    occlude(r.z + r.d, r.x, r.x + r.w, 1),
  ].filter((x): x is [number, number] => !!x);
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1] + 10) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push([sorted[i][0], sorted[i][1]]);
  }
  return out;
}

/** 去掉选中房间贴边后，墙线仍应保留的段。 */
function wallStrokeKeepSegments(
  w: Pick<Wall, "a" | "b">,
  rooms: Room[],
): [number, number][] | null {
  if (!rooms.length) return null;
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const hide = mergeIntervals(
    rooms.flatMap((r) => wallHideIntervalsForRoom(w, r)).map(([a, b]) => [Math.max(0, a), Math.min(len, b)]),
  );
  if (!hide.length) return null;
  const keep: [number, number][] = [];
  let cursor = 0;
  for (const [h0, h1] of hide) {
    if (h0 > cursor + 20) keep.push([cursor, h0]);
    cursor = Math.max(cursor, h1);
  }
  if (len > cursor + 20) keep.push([cursor, len]);
  return keep;
}

/**
 * 在已有保留段上再抠掉门窗洞口，避免外墙线整段穿过洞口、短墙上窗看起来「占满」。
 * roomKeep＝null 表示整段墙；有洞口时改为画垛段。
 */
function cutStrokeKeepByOpenings(
  len: number,
  roomKeep: [number, number][] | null,
  openingHide: [number, number][],
): [number, number][] | null {
  const hide = mergeIntervals(
    openingHide
      .map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(len, Math.max(a, b))] as [number, number])
      .filter(([a, b]) => b - a > 20),
  );
  if (!hide.length) return roomKeep;
  const base = roomKeep ?? ([[0, len]] as [number, number][]);
  const out: [number, number][] = [];
  for (const [k0, k1] of base) {
    let cursor = k0;
    for (const [h0, h1] of hide) {
      if (h1 <= k0 || h0 >= k1) continue;
      const cut0 = Math.max(h0, k0);
      const cut1 = Math.min(h1, k1);
      if (cut0 > cursor + 20) out.push([cursor, cut0]);
      cursor = Math.max(cursor, cut1);
    }
    if (k1 > cursor + 20) out.push([cursor, k1]);
  }
  return out;
}

/** 平面墙描边的邻墙（中心线＋厚度），用于直角外角补齐。 */
export type WallStrokePeer = {
  a: [number, number];
  b: [number, number];
  thick: number;
};

/**
 * 墙端落到正交墙附近时，沿墙轴伸出到对侧外皮，避免 butt 端点在直角外角留下缺口。
 * 伸出量＝到对侧外皮的剩余距离（已偏出中线则少伸，避免外角凸包）；共线墙端不伸。
 */
export function wallStrokeJoinExtend(
  wall: Pick<Wall, "a" | "b">,
  peers: WallStrokePeer[],
  opts: { endpointTol?: number; collinearDot?: number } = {},
): { start: number; end: number } {
  return physicalWallJoinExtensions(wall, peers, { epsilon: opts.endpointTol ?? 1, collinearDot: opts.collinearDot });
}

function wallStrokePaths(
  keep: [number, number][] | null,
  len: number,
  className: string,
  thick: number,
  joinExtend: { start: number; end: number } = { start: 0, end: 0 },
) {
  const path = (t0: number, t1: number) => {
    // 只在整段墙的真实端头伸出；门洞切开的内端保持 butt，避免伸进洞口。
    const a = t0 <= 1e-6 ? t0 - joinExtend.start : t0;
    const b = t1 >= len - 1e-6 ? t1 + joinExtend.end : t1;
    return `<path d="M${a} 0 H${b}" class="${className}" stroke-width="${thick}"/>`;
  };
  if (keep === null) return path(0, len);
  return keep.map(([t0, t1]) => path(t0, t1)).join("");
}
export interface DrawGuide {
  ax: number;
  az: number;
  bx?: number;
  bz?: number;
  guideXs?: number[];
  guideZs?: number[];
  length?: number;
  hint?: string;
}

export type AlignGuide =
  | { kind: "bay"; a: [number, number]; b: [number, number]; bayStart: number; bayEnd: number }
  | { kind: "room"; x: number; z: number; w: number; d: number };

export interface PlanOptions {
  /** 编辑器连续画布；普通图纸导出保留完整制图表达。 */
  editorCanvas?: boolean;
  inside?: boolean;
  useZones?: boolean;
  dining?: "full" | "daily";
  editable?: boolean;
  selected?: { kind: string; id?: string; index?: number; annex?: boolean; exterior?: boolean } | null;
  /** 多选高亮（含主选）。辅楼家具下标为 1000+index，与隔墙约定一致。 */
  selectedFurniture?: number[];
  selectedRooms?: string[];
  /** 显示墙厚毫米标注（外墙／隔墙）。 */
  showWallWidth?: boolean;
  drawGuide?: DrawGuide | null;
  /** 选中门窗／家具时的开间或房间淡标。 */
  alignGuide?: AlignGuide | null;
}

export function renderAlignGuide(g: AlignGuide) {
  if (g.kind === "room") {
    return `<g class="align-guide" pointer-events="none">${rect(g.x, g.z, g.w, g.d, 'class="align-guide-room" fill="none"')}</g>`;
  }
  const len = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) || 1;
  const ux = (g.b[0] - g.a[0]) / len;
  const uz = (g.b[1] - g.a[1]) / len;
  const nx = -uz;
  const nz = ux;
  const mark = (along: number) => {
    const x = g.a[0] + ux * along;
    const z = g.a[1] + uz * along;
    const h = 280;
    return `<path d="M${x - nx * h} ${z - nz * h} L${x + nx * h} ${z + nz * h}" class="align-guide-bay"/>`;
  };
  const x0 = g.a[0] + ux * g.bayStart;
  const z0 = g.a[1] + uz * g.bayStart;
  const x1 = g.a[0] + ux * g.bayEnd;
  const z1 = g.a[1] + uz * g.bayEnd;
  return `<g class="align-guide" pointer-events="none">${mark(g.bayStart)}${mark(g.bayEnd)}<path d="M${x0} ${z0} L${x1} ${z1}" class="align-guide-bay-span"/></g>`;
}

/** 画墙橡皮筋、十字线与对齐引导（mm）。 */
export function renderDrawGuide(g: DrawGuide) {
  const span = 40000;
  const axes = `<path d="M${g.ax - span} ${g.az} H${g.ax + span} M${g.ax} ${g.az - span} V${g.az + span}" class="edit-guide-axis"/>`;
  const alignX = (g.guideXs ?? [])
    .map((x) => `<path d="M${x} ${g.az - span} V${g.az + span}" class="edit-guide-align"/>`)
    .join("");
  const alignZ = (g.guideZs ?? [])
    .map((z) => `<path d="M${g.ax - span} ${z} H${g.ax + span}" class="edit-guide-align"/>`)
    .join("");
  const start = `<circle cx="${g.ax}" cy="${g.az}" r="120" class="edit-guide-point"/>`;
  if (g.bx === undefined || g.bz === undefined) {
    return `<g id="edit-draw-guide" class="edit-draw-guide" pointer-events="none">${axes}${alignX}${alignZ}${start}</g>`;
  }
  const rubber = `<path d="M${g.ax} ${g.az} L${g.bx} ${g.bz}" class="edit-guide-wall"/>`;
  const end = `<circle cx="${g.bx}" cy="${g.bz}" r="120" class="edit-guide-point"/>`;
  const mx = (g.ax + g.bx) / 2;
  const mz = (g.az + g.bz) / 2;
  const len = g.length ?? Math.hypot(g.bx - g.ax, g.bz - g.az);
  const label = text(mx, mz - 280, formatMm(len), "edit-guide-label");
  const hint = g.hint ? text(mx, mz + 420, g.hint, "edit-guide-hint") : "";
  return `<g id="edit-draw-guide" class="edit-draw-guide" pointer-events="none">${axes}${alignX}${alignZ}${rubber}${start}${end}${label}${hint}</g>`;
}
function useZone(f: Furniture) {
  if (!furnitureHasUseZone(f.kind)) return "";
  const b = furnitureLocalBounds(f);
  return `<g pointer-events="none" transform="translate(${f.x} ${f.z}) rotate(${(-(f.rotation ?? 0) * 180) / Math.PI})">${rect(b.x0 - 600, b.z0 - 600, b.x1 - b.x0 + 1200, b.z1 - b.z0 + 1200, 'class="use-zone"')}<title>家具四周600讨论留位；使用方向、门扇及实际净宽待设计</title></g>`;
}

/** 平面含柱脚／柱头饰线，柱心落在门厅前沿两角。 */
function porticoPosts(porch: PorticoDraft) {
  const shaft = frontElevation.porticoColumnDepth;
  const w = porticoColumnOuterWidth(shaft);
  return porticoColumnCenters(porch).map(x => ({ x, w }));
}

export function floorPlan(index: number, clearance: boolean, balcony: boolean, options: PlanOptions = {}, source?: PlanSource) {
  if (!source) ensureFurnitureWallClearance();
  if (options.editorCanvas) {
    const src = source ?? planSourceFromPublished(index);
    const west = index === 0 ? Math.min(site.annex.x, site.main.x) : site.main.x;
    const north = Math.min(src.floor.front, currentPorticoFrontZ());
    const frame = planFrame(west, index === 0 ? Math.max(site.annex.x + site.annex.w, site.main.x + site.main.w) : site.main.x + site.main.w, north - 1000, site.main.z + site.main.d + 1000);
    const { cx, cy } = planViewCenter(frame.viewBox);
    return `<svg class="floor-svg editor-floor-svg ${options.editable ? "editing" : ""}" data-plan-building="all" data-canvas-floor="${index}" xmlns="http://www.w3.org/2000/svg" viewBox="${frame.viewBox}" aria-label="${src.floor.name}统一户型编辑画布，南向上，西向右，长度单位毫米">
      <defs><pattern id="editor-dot-grid" patternUnits="userSpaceOnUse" width="500" height="500"><circle cx="250" cy="250" r="18" fill="#d4cbbb"/></pattern></defs>
      <g class="plan-world" transform="rotate(180 ${dimN(cx)} ${dimN(cy)})">
        <rect class="editor-world-grid" x="-100000" y="-100000" width="200000" height="200000" fill="url(#editor-dot-grid)"/>
        ${buildingFloorPlan(index, clearance, balcony, options, src, "main")}
        ${index === 0 ? buildingFloorPlan(index, clearance, balcony, options, src, "annex") : ""}
      </g>
    </svg>`;
  }
  const shared = collectPlanSiteDimensions();
  const m = (mm: number) => formatMm(mm);
  const names = ["西侧", "辅楼", "子孙道", "主楼", "东侧"];
  const summary = `<details class="plan-shared-dimensions" aria-label="主辅楼统一尺寸约束">
    <summary>统一尺寸 · 两图联动 <span>总面宽 ${m(shared.totalWidthMm)}</span></summary>
    <div class="plan-shared-body">
    <span>总面宽 ${m(shared.totalWidthMm)}＝${shared.widthSegmentsMm.map((mm, i) => `${names[i]} ${m(mm)}`).join("＋")}</span>
    <span>主楼进深 ${m(shared.mainDepthMm)}＝辅楼 ${m(shared.annexDepthMm)}＋前墙内退 ${m(shared.annexSetbackMm)} · 后墙齐平</span>
    <span>屋后预留 ${m(site.rearGap)} · 两栋楼及门厅按各自位置的院坪进深统一校验</span>
    <small>两图分开标注，图间留白不代表实际间距；外轮廓与子孙道在「尺寸设置」统一调整、校验。</small>
    </div>
  </details>`;
  const sheet = (building: PlanBuilding) => `<section class="plan-sheet" data-plan-sheet="${building}">
    <div class="plan-sheet-head">
      <h3>${building === "main" ? "主楼" : "辅楼"} · ${building === "main" ? floors[index].name : "一层"}</h3>
      ${options.editable
        ? `<button type="button" class="secondary-button plan-auto-rooms" data-auto-rooms="${building}" title="按当前墙体围合自动生成／更新房间">自动生成房间</button>`
        : ""}
    </div>
    ${buildingFloorPlan(index, clearance, balcony, options, source, building)}</section>`;
  return `${summary}<div class="plan-sheets${index === 0 ? " plan-sheets-split" : ""}">${sheet("main")}${index === 0 ? sheet("annex") : ""}</div>`;
}

function buildingFloorPlan(index: number, clearance: boolean, balcony: boolean, options: PlanOptions, source: PlanSource | undefined, building: PlanBuilding) {
  const src = source ?? planSourceFromPublished(index);
  const isAnnex = building === "annex";
  const f = src.floor;
  const editable = !!options.editable;
  const allRooms = isAnnex ? src.annexRooms : f.rooms;
  const porch = src.portico;
  const porchFront = currentPorticoFrontZ();
  const elevation = frontElevation;
  const posts = porticoPosts(porch);
  const [westPost, , , eastPost] = elevation.balustradePosts;
  const middleWest = { ...elevation.balustradePosts[1], x: posts[0].x };
  const wallFace = src.thirdFront;
  const sideFront = elevation.terraceFront;
  const terraceRails = `<path d="${hasThirdFloorSideTerraces() ? `M${westPost.x} ${wallFace} V${sideFront} H${porch.x} M${eastPost.x} ${wallFace} V${sideFront} H${porch.x + porch.w} ` : ""}M${porch.x} ${elevation.postZ} V${middleWest.z} H${porch.x + porch.w} V${elevation.postZ}" class="balustrade"/>`;
  const s = `<defs><pattern id="void" patternUnits="userSpaceOnUse" width="280" height="280" patternTransform="rotate(45)"><rect width="280" height="280" fill="#f4f3ee"/><path d="M0 0 V280" stroke="#d8d6cc" stroke-width="45"/></pattern></defs>`;
  const mainPartitions = f.partitions;
  const annexParts = src.annexPartitions;
  const partitionsFor = (r: Room) => (src.annexRooms.some((a) => a.id === r.id) ? annexParts : mainPartitions);
  // 门头朝下时整图旋转 180°：本地 Z 越大屏幕越靠上。偏移按「屏幕上名称→建筑→套内」排列。
  const labelStack = PLAN_ENTRANCE_DOWN
    ? { name: 480, mid: 160, net: -40 }
    : { name: -40, mid: 280, net: 480 };
  const labels = allRooms.filter(r => r.kind !== "stair")
    .map((r) => {
      const [x, z] = r.outline?.length || r.boundary ? roomLabelPosition(r, index, partitionsFor(r)) : r.label ?? [r.x + r.w / 2, r.z + r.d / 2];
      // 所有区域保留两组尺寸及面积；凹形尺寸是包络，面积仍按实际轮廓。
      const fill = roomFillBounds(r, index, partitionsFor(r));
      const irregular = !roomIsRectangular(r);
      const areas = roomAreas(r, index, partitionsFor(r));
      if (options.editorCanvas) {
        const lines = roomAreaLabels(r, index, partitionsFor(r));
        const direction = PLAN_ENTRANCE_DOWN ? -1 : 1;
        return `<g class="room-label" data-label-x="${x}" data-label-z="${z}" pointer-events="none">${text(x, z, r.name)}${lines.map((line, i) => text(x, z + direction * (i + 1) * 400, line, i === 0 && r.kind !== "void" && r.boundary?.status !== "unbounded" ? "room-area-building" : "room-area-net")).join("")}</g>`;
      }
      const buildingMm = irregular
        ? `墙线 ${areas.building.toFixed(2)}㎡ · 包络 ${Math.round(r.w)}×${Math.round(r.d)}`
        : `${Math.round(r.w)}×${Math.round(r.d)}=${areas.building.toFixed(2)}㎡`;
      const netMm = Math.abs(fill.w * fill.d / 1_000_000 - areas.interior) > .001
        ? `净空 ${areas.interior.toFixed(2)}㎡ · 包络 ${Math.round(fill.w)}×${Math.round(fill.d)}`
        : `${Math.round(fill.w)}×${Math.round(fill.d)}=${areas.interior.toFixed(2)}㎡`;
      const status = [r.kind === "void" ? "两层通高 · 无楼板" : "", irregular ? "凹形：包络尺寸／轮廓面积" : "", r.boundary?.status === "unbounded" ? "失去围合 · 面积待核" : r.boundary?.status === "open" ? "开敞分区" : ""].filter(Boolean).join(" · ");
      return `<g class="room-label" pointer-events="none">${text(x, z + labelStack.name, r.name)}${text(x, z + labelStack.mid, buildingMm, "room-size")}${text(x, z + labelStack.net, netMm, "room-area-net")}${status ? text(x, z + (PLAN_ENTRANCE_DOWN ? -300 : 740), status, "room-area-net") : ""}</g>`;
    })
    .join("");
  const stair = src.stair;
  const livingStyle = resolvedRailingStyle(src.livingVoid.railingStyle, "living"), stairStyle = resolvedRailingStyle(stair.railingStyle, "stair");
  const boundaries = recessFrontFacades(facades(index), f.front);
  const autoGuards = isAnnex ? "" : [
    ...(index === 1 ? livingVoidGuards(src.livingVoid, f, boundaries, livingStyle, src.stairPresent ? stair : undefined).map(segment => ({ segment, style: livingStyle, type: "living" })) : []),
    ...(index > 0 && src.stairPresent ? stairFloorGuards(stair, f, boundaries, stairStyle, index === 1 ? src.livingVoid : undefined).map(segment => ({ segment, style: stairStyle, type: "stair" })) : []),
  ].map(({ segment, style, type }) => ({ segment, style: canonicalRailingStyle(style), type }))
    .map(({ segment: [a, b], style, type }) => `<path data-auto-guard="${type}" data-railing-style="${style}" d="M${a[0]} ${a[1]} L${b[0]} ${b[1]}" fill="none" stroke="${style === "marble" ? "#b8ad99" : style === "wood" ? "#865632" : style === "glass" ? "#70a6aa" : "#384744"}" stroke-width="${railingThickness(style)}" pointer-events="none"><title>自动栏杆 · ${railingStyleLabels[style]}</title></path>`).join("");
  const stairBounds = stairShape(stair).footprint;
  const stepLines = !isAnnex && src.stairPresent ? stairPlan(stair, index, editable, f.rooms.find(r => r.kind === "stair")?.id ?? `stair${index}`) : "";
  // 户型图不画门厅柱间三步与左右侧坡道（仅立体模型保留）。
  const columnNorth = elevation.porticoColumnZ - elevation.porticoColumnDepth / 2;
  const roundTables = src.annexFurniture.filter(item => isRoundFurniture(item.kind));
  const roundTable = roundTables[0];
  // 圆桌椅环半径与摆放一致；勿用过大圆域。
  const isRoundChair = (item: (typeof src.annexFurniture)[number]) =>
    item.kind === "chair" && roundTables.some(table =>
      Math.abs(Math.hypot(item.x - table.x, item.z - table.z) - (table.w / 2 + 250)) < 250);
  const diningFurniture = src.annexFurniture.filter(
    (item) => options.dining !== "daily" || !(isRoundFurniture(item.kind) || isRoundChair(item)),
  );
  const diningRanges = roundTables.map(table => {
    const range = diningClearance([table])!;
    return `<circle cx="${range.cx}" cy="${range.cz}" r="${range.radius}" class="clearance" data-dining-table="${src.annexFurniture.indexOf(table)}" pointer-events="none"><title>圆桌周边拉椅留位示意</title></circle>`;
  }).join("");
  const diningOverlay = !isAnnex || !clearance ? "" : options.dining === "daily"
    ? roundTable ? text(roundTable.x, roundTable.z + 480, "日常示意：圆桌收起 · 收纳待定", "room-size") : ""
    : diningRanges;
  const floorFurniture = isAnnex ? [] : f.furniture;
  const allFurniture = isAnnex ? diningFurniture : floorFurniture;
  const porchY = index === 2 ? elevation.centerFront : porchFront;
  const porchH = index === 2 ? elevation.terraceBack - elevation.centerFront : porch.projection;
  const porticoHit = !isAnnex && editable
    ? rect(porch.x, porchY, porch.w, porchH, `class="edit-hit portico-hit" data-edit="portico"`)
    : "";
  const selected = options.selected;
  const selectedFurniture = new Set(options.selectedFurniture ?? []);
  if (selected?.kind === "furniture" && selected.index != null) {
    selectedFurniture.add(selected.annex ? 1000 + selected.index : selected.index);
  }
  const selectedRooms = new Set(options.selectedRooms ?? []);
  if (selected?.kind === "room" && selected.id) selectedRooms.add(selected.id);
  const selectedDoorIndex =
    selected?.kind === "door" && !selected.exterior ? selected.index : undefined;
  const selectedWallIndex =
    selected?.kind === "wall" ? { index: selected.index, annex: !!selected.annex } : null;
  const selectedExteriorIndex =
    selected?.kind === "door" && selected.exterior ? selected.index ?? null : null;
  const selectedRoomList = editable
    ? [...selectedRooms]
        .map((id) => allRooms.find((room) => room.id === id))
        .filter((r): r is Room => !!r)
    : [];
  // 选中房间：色块抬过邻房但仍在家具之下；框线与拉角手柄都贴墙内皮（套内），避免角点飘在开间外。
  const roomLiftFills = selectedRoomList
    .map((r) => roomFillShape(r, index, partitionsFor(r), "room-fill room-fill-lifted"))
    .join("");
  const roomSelectionChrome = selectedRoomList
    .map((r) => {
      const annex = src.annexRooms.some((room) => room.id === r.id);
      const primary = selected?.kind === "room" && selected.id === r.id;
      const b = roomFillBounds(r, index, partitionsFor(r));
      // 框与手柄同一套内角，视觉对齐；拉角仍改开间外轮廓（鼠标世界坐标），不跟手柄像素绑死。
      const pad = 40;
      const fx = b.x + pad;
      const fz = b.z + pad;
      const fw = Math.max(100, b.w - 2 * pad);
      const fd = Math.max(100, b.d - 2 * pad);
      const frame = r.outline?.length || r.boundary
        ? `<path d="${roomFillGeometry(r, index, partitionsFor(r)).pathData}" class="edit-selection edit-selection-room" fill="none"/>`
        : rect(fx, fz, fw, fd, 'class="edit-selection edit-selection-room" fill="none"');
      const handles = primary && roomIsRectangular(r) && r.boundary?.status !== "unbounded"
        ? [
            ["nw", b.x, b.z],
            ["ne", b.x + b.w, b.z],
            ["sw", b.x, b.z + b.d],
            ["se", b.x + b.w, b.z + b.d],
          ]
            .map(
              ([c, x, z]) =>
                `<rect x="${Number(x) - 120}" y="${Number(z) - 120}" width="240" height="240" class="edit-handle" data-edit="room-handle" data-corner="${c}" data-id="${r.id}"${annex ? ' data-annex="1"' : ""}/>`,
            )
            .join("")
        : "";
      return `<g class="room-selection-top" pointer-events="none">${frame}</g>${handles}`;
    })
    .join("");
  const selection =
    roomSelectionChrome ||
    (!isAnnex && editable && selected?.kind === "portico"
      ? rect(porch.x, porchY, porch.w, porchH, 'class="edit-selection" fill="none"')
      : !isAnnex && editable && src.stairPresent && selected?.kind === "stair"
        ? `${rect(stairBounds.x, stairBounds.z, stairBounds.w, stairBounds.d, 'class="edit-selection" data-stair-selection="1" fill="none"')}
              ${[["nw", stairBounds.x, stairBounds.z], ["ne", stairBounds.x + stairBounds.w, stairBounds.z], ["sw", stairBounds.x, stairBounds.z + stairBounds.d], ["se", stairBounds.x + stairBounds.w, stairBounds.z + stairBounds.d]]
                .map(([c, x, z]) => `<rect x="${Number(x) - 120}" y="${Number(z) - 120}" width="240" height="240" class="edit-handle" data-edit="stair-handle" data-corner="${c}"/>`)
                .join("")}`
        : "");

  const showWallWidth = !!options.showWallWidth;
  const northClear = isAnnex
    ? site.annex.z
    : index === 2
      ? Math.min(elevation.centerFront, elevation.terraceFront, porchY)
      : Math.min(porchFront, columnNorth);
  const dimensions = planOuterDimensions(index, northClear, src, building, !!options.editorCanvas, editable && selected?.kind === "stair");
  const body = isAnnex ? site.annex : site.main;
  const regionBody = isAnnex ? body : { ...body, z: f.front, d: site.main.z + site.main.d - f.front };
  // 「分区／分区包络」易与房间混淆：仅在虚线分区中心尚未被房间占用时标注，并改用更明确文案。
  const regionLabels = virtualWallRegions(regionBody, isAnnex ? annexParts : mainPartitions)
    .filter((r) => !allRooms.some((room) =>
      room.kind !== "stair" &&
      r.x >= room.x && r.x <= room.x + room.w &&
      r.z >= room.z && r.z <= room.z + room.d,
    ))
    .map((r) =>
      `<g pointer-events="none"><title>虚拟墙分出的参考开间（非房间模型）：外墙外皮／内墙中线／虚线本身；矩形，未扣墙厚。</title>${text(r.x, r.z, `虚线分间 ${r.wMm}×${r.dMm}`, "virtual-region-size")}</g>`,
    )
    .join("");
  // 同图内所有墙段作邻墙：直角相交端头伸出对侧半厚，外角无缺口。
  const wallPeers: WallStrokePeer[] = isAnnex
    ? [
        ...src.annexPartitions.filter(isPhysicalWall).map((w) => ({
          a: w.a,
          b: w.b,
          thick: wallRoleOf(w) === "bearing" ? construction.outsideWall : construction.partition,
        })),
        ...facades(3).map((w) => ({ a: w.a, b: w.b, thick: construction.outsideWall })),
      ]
    : [
        ...f.partitions.filter(isPhysicalWall).map((w) => ({
          a: w.a,
          b: w.b,
          thick: wallRoleOf(w) === "bearing" ? construction.outsideWall : construction.partition,
        })),
        ...recessFrontFacades(facades(index), f.front).map((w) => ({ a: w.a, b: w.b, thick: construction.outsideWall })),
      ];
  // 固定预留标注空间；实体墙增减尺寸分段时坐标系保持不变。
  const frame = planFrame(
    body.x,
    body.x + body.w,
    northClear - PLAN_DIM_FACE - 3 * PLAN_DIM_CHAIN,
    body.z + body.d + PLAN_DIM_FACE + 3 * PLAN_DIM_CHAIN,
  );
  const noteZ = dimensions.southOuter + 950;
  const { cx, cy } = planViewCenter(frame.viewBox);
  const orientLabel = PLAN_ENTRANCE_DOWN ? "南向上，西向右（门头朝下）" : "北向上，东向右";
  const worldOpen = options.editorCanvas ? `<g class="editor-building" data-plan-building="${building}">` : PLAN_ENTRANCE_DOWN
    ? `<g class="plan-world" transform="rotate(180 ${dimN(cx)} ${dimN(cy)})">`
    : `<g class="plan-world">`;
  return `${options.editorCanvas ? "" : `<svg data-plan-building="${building}" class="floor-svg ${isAnnex ? "annex-floor-svg" : "main-floor-svg"} ${editable ? "editing" : ""}" xmlns="http://www.w3.org/2000/svg" viewBox="${frame.viewBox}" aria-label="${isAnnex ? "辅楼一层" : `主楼${f.name}`}户型平面图，${orientLabel}${options.dining === "daily" ? "，餐厅日常6座建议情景" : ""}${editable ? "，编辑模式" : ""}">`}
    ${s}${options.editorCanvas ? "" : `<rect x="${frame.board.x}" y="${frame.board.z}" width="${frame.board.w}" height="${frame.board.h}" rx="200" fill="#fbfaf6"/>`}
    ${worldOpen}
    ${dimensions.svg}
    ${!isAnnex && index === 2 && hasThirdFloorSideTerraces() ? `${elevation.sideTerraces.map(t => rect(t.x, elevation.terraceFront, t.w, f.front + 40 - elevation.terraceFront, 'fill="#e9e2d4" stroke="#b4b6a9" stroke-width="60"')).join("")}${text(8850, -200, "西侧露台", "dim-label")}${text(18400, -200, "东侧露台", "dim-label")}` : ""}
    ${porticoHit}${!isAnnex ? rect(porch.x, porchY, porch.w, porchH, `fill="${index === 1 ? "url(#void)" : "#e9e2d4"}" stroke="#b4b6a9" stroke-width="60"`) : ""}
    ${!isAnnex ? text(porch.x + porch.w / 2, -1950, index === 2 ? "中央露台 · 前方敞开" : index === 1 ? "门厅上空 · 无楼板" : `门厅 ${formatMm(porch.w)}×${formatMm(porch.projection)} · 计入首层合计`, "dim-label") : ""}
    ${!isAnnex ? `${index < 2 ? `${posts.map(p => rect(p.x - p.w / 2, elevation.porticoColumnZ - elevation.porticoColumnDepth / 2, p.w, elevation.porticoColumnDepth, 'fill="#879183"')).join("")}${cornerColumn(site.main.x + 120, f.front + 120, -1)}${cornerColumn(site.main.x + site.main.w - 120, f.front + 120, 1)}` : `${terraceRails}${frontTerracePosts().map(p => rect(p.x - p.w / 2, p.z - p.w / 2, p.w, p.w, 'fill="#c3bba9" stroke="#777872" stroke-width="40"')).join("")}${[porch.x, porch.x + porch.w].map(x => rect(x - elevation.dividerWidth / 2, elevation.postZ - 250, elevation.dividerWidth, 500, 'fill="#879183"')).join("")}${text(site.portico.x + site.portico.w / 2, elevation.centerFront - 400, hasThirdFloorSideTerraces() ? "内退柱墙隔开两侧 · 官帽柱贴前墙构造柱" : "三楼不内退 · 仅保留中央门厅露台", "room-size")}`}${cornerColumn(site.main.x + 120, site.main.z + site.main.d - 120, -1, 1)}${cornerColumn(site.main.x + site.main.w - 120, site.main.z + site.main.d - 120, 1, 1)}` : ""}
    ${!isAnnex ? f.rooms.filter(r => r.kind !== "stair").map((r) => room(r, index, editable, false, mainPartitions)).join("") : ""}
    ${isAnnex ? src.annexRooms.map((r) => room(r, index, editable, true, annexParts)).join("") : ""}
    ${options.useZones ? allFurniture.map(useZone).join("") : ""}
    ${stepLines}
    ${autoGuards}
    ${roomLiftFills ? `<g class="room-lift-under-furniture" pointer-events="none">${roomLiftFills}</g>` : ""}
    ${(isAnnex ? [] : f.partitions)
      .map((p, i) => ({ p, i: p.sourceIndex ?? i }))
      .sort((a, b) => Number(wallRoleOf(a.p) === "bearing") - Number(wallRoleOf(b.p) === "bearing"))
      .map(({ p, i }) =>
        partition(
          p,
          i,
          editable,
          selectedDoorIndex === i && !selected?.annex,
          !!selectedWallIndex && !selectedWallIndex.annex && selectedWallIndex.index === i,
          showWallWidth,
          null,
          wallPeers,
        ),
      )
      .join("")}
    ${(isAnnex ? [] : recessFrontFacades(facades(index), f.front))
      .map((p, fi) =>
        facade(
          p,
          fi,
          index,
          editable,
          src.exteriorOpenings,
          selectedExteriorIndex,
          src.exteriorManaged,
          showWallWidth,
          null,
          wallPeers,
        ),
      )
      .join("")}
    ${isAnnex
      ? src.annexPartitions
          .map((p, i) => ({ p, i: p.sourceIndex ?? i }))
          .sort((a, b) => Number(wallRoleOf(a.p) === "bearing") - Number(wallRoleOf(b.p) === "bearing"))
          .map(({ p, i }) =>
            partition(
              p,
              1000 + i,
              editable,
              selectedDoorIndex === i && !!selected?.annex,
              !!selectedWallIndex && selectedWallIndex.annex && selectedWallIndex.index === i,
              showWallWidth,
              null,
              wallPeers,
            ),
          )
          .join("") +
        facades(3)
          .map((p, fi) =>
            facade(
              p,
              fi,
              3,
              editable,
              src.exteriorOpenings,
              selectedExteriorIndex,
              src.exteriorManaged,
              showWallWidth,
              null,
              wallPeers,
            ),
          )
          .join("")
      : ""}
    ${text(
      body.x + body.w / 2,
      Math.min(northClear - 3350, dimensions.northOuter - 1550),
      showWallWidth
        ? `墙示意 · 外墙／内承重${Math.round(construction.outsideWall)} · 隔墙${Math.round(construction.partition)} · 细灰虚线＝虚拟分界（无厚度）`
        : "墙示意 · 绿系实线＝承重 · 灰色实线＝隔墙 · 细灰虚线＝虚拟分界（无实体）",
      "wall-role-legend",
    )}
    ${diningOverlay}
    ${!isAnnex && balcony && index === 2 ? (() => {
      const bx = mainLocalX(site.main.w * (12650 - 6800) / 13500 + (mirroredBuildings() ? 2500 * site.main.w / 13500 : 0));
      const bw = 2500 * (site.main.w / 13500);
      const bz = site.main.z + site.main.d;
      return rect(bx, bz, bw, 1200, 'class="clearance"') + text(bx + bw / 2, bz + 700, "局部浅阳台", "room-size");
    })() : ""}
    ${floorFurniture.map((item, i) => furniture(item, i, editable, selectedFurniture.has(i), selected?.kind === "furniture" && !selected.annex && selected.index === i)).join("")}
    ${isAnnex
      ? diningFurniture
          .map((item) => {
            const i = src.annexFurniture.indexOf(item);
            return furniture(
              item,
              1000 + i,
              editable,
              selectedFurniture.has(1000 + i),
              selected?.kind === "furniture" && !!selected.annex && selected.index === i,
            );
          },
          )
          .join("")
      : ""}
    ${selection}
    ${labels}
    ${regionLabels}
    ${text(body.x + body.w / 2, noteZ, `南侧高田 +${formatMm(site.rearField)} · 屋后留 ${formatMm(site.rearGap)}`, "dim-label")}
    ${options.drawGuide && (options.drawGuide.ax >= site.annex.x && options.drawGuide.ax <= site.annex.x + site.annex.w) === isAnnex ? renderDrawGuide(options.drawGuide) : ""}
    ${options.alignGuide && ((options.alignGuide.kind === "room" ? options.alignGuide.x : options.alignGuide.a[0]) >= site.annex.x && (options.alignGuide.kind === "room" ? options.alignGuide.x : options.alignGuide.a[0]) <= site.annex.x + site.annex.w) === isAnnex ? renderAlignGuide(options.alignGuide) : ""}
    </g>
  ${options.editorCanvas ? "" : "</svg>"}`;
}

export function diningClearance(furniture: Furniture[] = annexFurniture) {
  // 与图面共用当前圆桌；桌缘外550为拉椅讨论留位，不是固定房间范围。
  const round = furniture.find(f => isRoundFurniture(f.kind));
  if (!round) return null;
  const cx = round.x;
  const cz = round.z;
  const radius = round.w / 2 + 550;
  return {
    west: cx - radius - site.annex.x,
    north: cz - radius - site.annex.z,
    east: site.annex.x + site.annex.w - (cx + radius),
    cx,
    cz,
    radius,
  };
}

/** 院坪尺寸标签：整数 mm，不带单位后缀。 */
function dimMm(n: number) {
  return formatMm(n);
}

type YardVOpts = {
  id: string;
  /** 默认在被量边哪一侧放尺寸线；拖过边后以实际位置为准 */
  side?: "east" | "west";
  small?: boolean;
  /** 仅影响初始是否画虚线：direct＝尺寸线贴边；extend＝尺寸线离开边 */
  style?: "extend" | "direct";
  /** 尺寸线相对默认 dimX 的偏移（mm）；拖动只改此项，黄点不动 */
  shift?: number;
};

type YardHOpts = {
  id: string;
  labelSide?: "north" | "south";
  small?: boolean;
  shift?: number;
};

/**
 * 院坪总图竖直尺寸。
 * 黄点固定在被量边 edgeX；尺寸线在 dimX+shift，虚线随其长短／左右翻转；字紧贴尺寸线。
 */
function yardVDim(
  z0: number,
  z1: number,
  edgeX: number,
  dimX: number,
  label: string,
  opts: YardVOpts,
) {
  const side = opts.side ?? "east";
  const small = opts.small ?? false;
  const style = opts.style ?? "extend";
  const shift = opts.shift ?? 0;
  const a = dimN(Math.min(z0, z1));
  const b = dimN(Math.max(z0, z1));
  const ex = dimN(edgeX);
  // direct：默认尺寸线贴边；仍可用 shift 拖开并出现虚线。
  const baseDim = style === "direct" ? edgeX : dimX;
  const dx = dimN(baseDim + shift);
  const mid = dimN((a + b) / 2);
  const fallback = side === "east" ? 1 : -1;
  const dir = yardDimDir(edgeX, baseDim + shift, fallback);
  const lx = dimN(dx + dir * yardDimLabelGap);
  const rot = dir >= 0 ? 90 : -90;
  const tick = yardDimTick;
  const ah = 130;
  const aw = 110;
  const r = 60;
  const sep = Math.abs(baseDim + shift - edgeX);
  const showExt = sep >= yardDimDirectEps;
  const stop = dimN(ex + dir * Math.max(sep - 120, sep * 0.88));
  const mark =
    `<path class="dim-arrow" d="M${dx} ${a} l${-ah} ${aw} M${dx} ${a} l${ah} ${aw} M${dx} ${b} l${-ah} ${-aw} M${dx} ${b} l${ah} ${-aw}"/>` +
    `<path class="dim-tick" d="M${dimN(dx - tick)} ${a} H${dimN(dx + tick)} M${dimN(dx - tick)} ${b} H${dimN(dx + tick)}"/>`;
  const ext = showExt
    ? `<path class="dim-ext" d="M${ex} ${a} H${stop} M${ex} ${b} H${stop}"/>`
    : "";
  const labelCls = small ? "dim-label-sm" : "dim-label";
  const kind = showExt ? "extend" : "direct";
  const sh = dimN(shift);
  return `<g class="yard-dim yard-dim-${kind}" data-yard-dim="${opts.id}" data-axis="x" data-edge="${ex}" data-base-dim="${dimN(baseDim)}" data-z0="${a}" data-z1="${b}" data-side="${side}" data-small="${small ? "1" : "0"}" data-shift="${sh}">
    <circle class="dim-anchor" cx="${ex}" cy="${a}" r="${r}"/><circle class="dim-anchor" cx="${ex}" cy="${b}" r="${r}"/>
    ${ext}<path class="dim-span" d="M${dx} ${a} V${b}"/>${mark}
    <text class="${labelCls}" x="${lx}" y="${mid}" text-anchor="middle" transform="rotate(${rot} ${lx} ${mid})">${label}</text>
    <path class="yard-dim-hit" d="M${dx} ${a} V${b}" />
  </g>`;
}

/**
 * 院坪总图水平尺寸。
 * 黄点固定在被量边 edgeZ；尺寸线在 dimZ+shift，虚线可上下拉长／翻到另一侧；字紧贴尺寸线。
 */
function yardHDim(
  x0: number,
  x1: number,
  edgeZ: number,
  dimZ: number,
  label: string,
  opts: YardHOpts,
) {
  const labelSide = opts.labelSide ?? "south";
  const small = opts.small ?? false;
  const shift = opts.shift ?? 0;
  const a = dimN(Math.min(x0, x1));
  const b = dimN(Math.max(x0, x1));
  const ez = dimN(edgeZ);
  const dz = dimN(dimZ + shift);
  const mid = dimN((a + b) / 2);
  const fallback = labelSide === "south" ? 1 : -1;
  const dir = yardDimDir(edgeZ, dimZ + shift, fallback);
  const sep = Math.abs(dimZ + shift - edgeZ);
  const showExt = sep >= yardDimDirectEps;
  const stop = dimN(ez + dir * Math.max(sep - 120, sep * 0.88));
  const ly = dimN(dz + dir * yardDimLabelGap);
  const tick = yardDimTick;
  const ah = 130;
  const aw = 110;
  const r = 60;
  const ext = showExt
    ? `<path class="dim-ext" d="M${a} ${ez} V${stop} M${b} ${ez} V${stop}"/>`
    : "";
  const labelCls = small ? "dim-label-sm" : "dim-label";
  const kind = showExt ? "extend" : "direct";
  const sh = dimN(shift);
  return `<g class="yard-dim yard-dim-${kind}" data-yard-dim="${opts.id}" data-axis="z" data-edge="${ez}" data-base-dim="${dimN(dimZ)}" data-x0="${a}" data-x1="${b}" data-side="${labelSide}" data-small="${small ? "1" : "0"}" data-shift="${sh}">
    <circle class="dim-anchor" cx="${a}" cy="${ez}" r="${r}"/><circle class="dim-anchor" cx="${b}" cy="${ez}" r="${r}"/>
    ${ext}<path class="dim-span" d="M${a} ${dz} H${b}"/>
    <path class="dim-arrow" d="M${a} ${dz} l${aw} ${-ah} M${a} ${dz} l${aw} ${ah} M${b} ${dz} l${-aw} ${-ah} M${b} ${dz} l${-aw} ${ah}"/>
    <path class="dim-tick" d="M${a} ${dimN(dz - tick)} V${dimN(dz + tick)} M${b} ${dimN(dz - tick)} V${dimN(dz + tick)}"/>
    <text class="${labelCls}" x="${mid}" y="${ly}" text-anchor="middle">${label}</text>
    <path class="yard-dim-hit" d="M${a} ${dz} H${b}" />
  </g>`;
}

/**
 * 整体院坪平面：自家主／辅楼外轮廓＋邻居木房占位，不画室内布局。
 * 尺寸取自当前 site／院坪弧线与 neighborCourtyardPlan，供建成后余量核对，非测绘。
 * `layout` 为各标注线拖动偏移（纵线＝ΔX，横线＝ΔZ），浏览器内可拖并记住。
 */
export function courtyardSitePlan(layout: CourtyardDimLayout = {}) {
  const sh = (id: string) => layout[id] ?? 0;
  const main = site.main;
  const annex = site.annex;
  const porch = site.portico;
  const elev = frontElevation;
  const nbr = neighborCourtyardPlan;
  const wallZ = main.z;
  const rearZ = main.z + main.d;
  const siteRear = site.oldDepth;
  const porchFront = currentPorticoFrontZ();
  const colNorth = elev.porticoColumnZ - elev.porticoColumnDepth / 2;
  const porticoCx = porch.x + porch.w / 2;
  const westCornerX = Math.min(main.x, annex.x);
  const eastCornerX = Math.max(main.x + main.w, annex.x + annex.w);
  const westGap = site.sideGap;
  const eastGap = site.width - eastCornerX;
  const laneX0 = Math.min(annex.x + annex.w, main.x + main.w);
  const laneX1 = Math.max(annex.x, main.x);

  const frontAt = (x: number) => contourAt(courtyardFront, x);
  const depthFrom = (zFrom: number, x: number) => zFrom - frontAt(x);

  const westFront = frontAt(0);
  const eastFront = frontAt(site.width);
  const midX = courtyardArcAnchors[1][0];
  const midFront = frontAt(midX);
  const annexEastX = annex.x + annex.w;
  const annexEastFront = frontAt(annexEastX);
  const eastCornerFront = frontAt(eastCornerX);
  const porticoFrontZ = frontAt(porticoCx);

  const nbrWoodFront = nbr.cementFront + nbr.cementDepth;
  const nbrWoodRear = nbrWoodFront + nbr.woodDepth;
  // 邻院北缘与自家东界外沿最宽处齐平向东拉，不再比自家多伸出。
  const nbrYardFront = frontAt(site.width);
  const nbrYardBeyond = nbr.cementFront - nbrYardFront;
  const nbrEast = nbr.x + nbr.w;

  const ourPath = [
    `M0 ${siteRear}`,
    `H${site.width}`,
    ...[...courtyardFront].reverse().map(([x, z]) => `L${dimN(x)} ${dimN(z)}`),
    "Z",
  ].join(" ");

  const posts = porticoPosts(porch);
  const annexFront = annex.z;
  const annexRear = annex.z + annex.d;
  const wallDepthAnnexE = depthFrom(annexFront, annexEastX);
  const wallDepthE = depthFrom(wallZ, eastCornerX);
  // 主楼西墙（面对房子最右侧）前墙→该处外沿
  const mainWestFront = frontAt(main.x);
  const wallDepthMainW = depthFrom(wallZ, main.x);
  const wallDepthMid = depthFrom(wallZ, porticoCx);
  // 两根罗马柱北皮中点→该柱 X 处外沿（面对房子：左＝东、右＝西）
  const westCol = posts[0];
  const eastCol = posts[1];
  const westColFront = frontAt(westCol.x);
  const eastColFront = frontAt(eastCol.x);
  const westColOuterToFront = depthFrom(colNorth, westCol.x);
  const eastColOuterToFront = depthFrom(colNorth, eastCol.x);
  // 主楼左／右开间中心（面对房子：左＝东、右＝西）前墙→外沿
  const rightBayCx = (main.x + porch.x) / 2;
  const leftBayCx = (porch.x + porch.w + main.x + main.w) / 2;
  const rightBayFront = frontAt(rightBayCx);
  const leftBayFront = frontAt(leftBayCx);
  const rightBayWallToFront = depthFrom(wallZ, rightBayCx);
  const leftBayWallToFront = depthFrom(wallZ, leftBayCx);
  const annexSetback = annexFront - wallZ;
  const totalWest = siteRear - westFront;
  const totalMid = siteRear - midFront;
  const totalEast = siteRear - eastFront;
  const annexCornerDim = annexEastX + 1000;
  const mainDepthDim = main.x - 400;
  const eastCornerDim = eastCornerX - 550;
  // 内退：尺寸线落在辅楼前墙面宽中点（图示红框位置）
  const annexFrontMidX = annex.x + annex.w / 2;
  // 竖墙皮：图内纵向标线压到这些 X 时改回虚线引出
  const wallXs = [0, annex.x, annexEastX, main.x, eastCornerX, site.width, porch.x, porch.x + porch.w];
  const onWall = (x: number) => wallXs.some((w) => Math.abs(w - x) < 120);
  const insideV = (dimX: number): "extend" | "direct" => (onWall(dimX) ? "extend" : "direct");

  // 图外纵向仍用虚线引出；图内纵向默认点对点实线，压墙才引出；均可拖动
  const dims = [
    yardVDim(westFront, siteRear, 0, -5200, `西总进深 ${dimMm(totalWest)}`, { id: "v-west-total", side: "west", shift: sh("v-west-total") }),
    yardVDim(westFront, annexFront, 0, -3600, `外沿→辅楼前 ${dimMm(annexFront - westFront)}`, {
      id: "v-west-front-annex", side: "west", small: true, shift: sh("v-west-front-annex"),
    }),
    yardVDim(annexFront, annexRear, westCornerX, -3600, `辅楼进深 ${dimMm(annex.d)}`, {
      id: "v-annex-depth", side: "west", small: true, shift: sh("v-annex-depth"),
    }),
    yardVDim(wallZ, annexFront, annexFrontMidX, annexFrontMidX + 550, `内退 ${dimMm(annexSetback)}`, {
      id: "v-setback", side: "east", small: true, style: "direct", shift: sh("v-setback"),
    }),
    yardVDim(annexEastFront, annexFront, annexEastX, annexCornerDim, `辅楼角→外沿 ${dimMm(wallDepthAnnexE)}`, {
      id: "v-annex-corner-front", side: "east", small: true, style: insideV(annexCornerDim), shift: sh("v-annex-corner-front"),
    }),
    yardVDim(midFront, siteRear, midX, midX + 1350, `中总进深 ${dimMm(totalMid)}`, {
      id: "v-mid-total", side: "east", style: "direct", shift: sh("v-mid-total"),
    }),
    yardVDim(eastCornerFront, wallZ, eastCornerX, eastCornerDim, `主楼前墙→外沿 ${dimMm(wallDepthE)}`, {
      id: "v-east-wall-front", side: "west", small: true, style: "direct", shift: sh("v-east-wall-front"),
    }),
    yardVDim(mainWestFront, wallZ, main.x, main.x - 550, `主楼右角→外沿 ${dimMm(wallDepthMainW)}`, {
      id: "v-main-west-wall-front", side: "west", small: true, style: insideV(main.x - 550), shift: sh("v-main-west-wall-front"),
    }),
    yardVDim(eastFront, siteRear, site.width, site.width + 4400, `东总进深 ${dimMm(totalEast)}`, {
      id: "v-east-total", side: "east", shift: sh("v-east-total"),
    }),
    yardVDim(eastFront, 0, site.width, site.width + 2900, `外沿→水泥边 ${dimMm(0 - eastFront)}`, {
      id: "v-east-front-cement", side: "east", small: true, shift: sh("v-east-front-cement"),
    }),
    yardVDim(0, siteRear, site.width, site.width + 2900, `水泥边→屋后 ${dimMm(siteRear)}`, {
      id: "v-east-cement-rear", side: "east", small: true, shift: sh("v-east-cement-rear"),
    }),
    yardVDim(rearZ, siteRear, eastCornerX, site.width + 1500, `屋后留 ${dimMm(siteRear - rearZ)}`, {
      id: "v-rear-leave", side: "east", small: true, shift: sh("v-rear-leave"),
    }),
    yardVDim(porticoFrontZ, wallZ, porticoCx, porticoCx + 1700, `门厅中心前墙→外沿 ${dimMm(wallDepthMid)}`, {
      id: "v-portico-wall-front", side: "east", small: true, style: insideV(porticoCx + 1700), shift: sh("v-portico-wall-front"),
    }),
    yardVDim(westColFront, colNorth, westCol.x, westCol.x - 550, `右柱外缘→外沿 ${dimMm(westColOuterToFront)}`, {
      id: "v-west-col-outer-front", side: "west", small: true, style: insideV(westCol.x - 550), shift: sh("v-west-col-outer-front"),
    }),
    yardVDim(eastColFront, colNorth, eastCol.x, eastCol.x + 550, `左柱外缘→外沿 ${dimMm(eastColOuterToFront)}`, {
      id: "v-col-outer-front", side: "east", small: true, style: insideV(eastCol.x + 550), shift: sh("v-col-outer-front"),
    }),
    yardVDim(leftBayFront, wallZ, leftBayCx, leftBayCx + 700, `左开间墙→外沿 ${dimMm(leftBayWallToFront)}`, {
      id: "v-left-bay-front", side: "east", small: true, style: insideV(leftBayCx + 700), shift: sh("v-left-bay-front"),
    }),
    yardVDim(rightBayFront, wallZ, rightBayCx, rightBayCx - 700, `右开间墙→外沿 ${dimMm(rightBayWallToFront)}`, {
      id: "v-right-bay-front", side: "west", small: true, style: insideV(rightBayCx - 700), shift: sh("v-right-bay-front"),
    }),
    yardVDim(nbrYardFront, nbr.cementFront, nbrEast, nbrEast + 2200, `邻院外 ${dimMm(nbrYardBeyond)}`, {
      id: "v-nbr-yard", side: "east", small: true, shift: sh("v-nbr-yard"),
    }),
    yardVDim(nbr.cementFront, nbrWoodFront, nbrEast, nbrEast + 2200, `邻水泥 ${dimMm(nbr.cementDepth)}`, {
      id: "v-nbr-cement", side: "east", small: true, shift: sh("v-nbr-cement"),
    }),
    yardVDim(nbrWoodFront, nbrWoodRear, nbrEast, nbrEast + 2200, `邻木房 ${dimMm(nbr.woodDepth)}`, {
      id: "v-nbr-wood", side: "east", small: true, shift: sh("v-nbr-wood"),
    }),
    yardHDim(0, site.width, westFront, Math.min(westFront, nbrYardFront) - 1800, `自家面宽 ${dimMm(site.width)}`, {
      id: "h-own-width", labelSide: "north", shift: sh("h-own-width"),
    }),
    yardHDim(nbr.x, nbrEast, nbrYardFront, Math.min(westFront, nbrYardFront) - 1800, `邻居面宽 ${dimMm(nbr.w)}`, {
      id: "h-nbr-width", labelSide: "north", shift: sh("h-nbr-width"),
    }),
    yardHDim(0, nbrEast, Math.min(westFront, nbrYardFront), Math.min(westFront, nbrYardFront) - 2900, `合计面宽 ${dimMm(nbrEast)}`, {
      id: "h-total-width", labelSide: "north", shift: sh("h-total-width"),
    }),
    yardHDim(0, westGap, siteRear, siteRear + 1100, `西侧 ${dimMm(westGap)}`, {
      id: "h-west-gap", labelSide: "south", small: true, shift: sh("h-west-gap"),
    }),
    yardHDim(annex.x, annex.x + annex.w, siteRear, siteRear + 1100, `辅楼 ${dimMm(annex.w)}`, {
      id: "h-annex-w", labelSide: "south", small: true, shift: sh("h-annex-w"),
    }),
    yardHDim(laneX0, laneX1, siteRear, siteRear + 1100, `子孙道 ${dimMm(site.lane)}`, {
      id: "h-lane", labelSide: "south", small: true, shift: sh("h-lane"),
    }),
    yardHDim(main.x, main.x + main.w, siteRear, siteRear + 1100, `主楼 ${dimMm(main.w)}`, {
      id: "h-main-w", labelSide: "south", small: true, shift: sh("h-main-w"),
    }),
    yardHDim(eastCornerX, site.width, siteRear, siteRear + 1100, `东侧 ${dimMm(eastGap)}`, {
      id: "h-east-gap", labelSide: "south", small: true, shift: sh("h-east-gap"),
    }),
    yardHDim(nbr.x, nbrEast, nbrWoodRear, siteRear + 1100, `邻居 ${dimMm(nbr.w)}`, {
      id: "h-nbr-w", labelSide: "south", small: true, shift: sh("h-nbr-w"),
    }),
    yardVDim(wallZ, rearZ, main.x, mainDepthDim, `主楼进深 ${dimMm(main.d)}`, {
      id: "v-main-depth", side: "west", small: true, style: insideV(mainDepthDim), shift: sh("v-main-depth"),
    }),
  ].join("");

  const porchLabelZ = porchFront + porch.projection / 2;
  const callouts = [
    text(annex.x + annex.w / 2, annex.z + annex.d / 2, `辅楼 ${formatMm(annex.w)}×${formatMm(annex.d)}`, "room-name"),
    text(main.x + main.w / 2, main.z + main.d / 2 + 350, `主楼 ${formatMm(main.w)}×${formatMm(main.d)}`, "room-name"),
    // 门厅尺寸写在门厅投影内，不再外挂一条尺寸线
    text(porticoCx, porchLabelZ - 220, recessedPortico() ? "凹入式门厅" : "凸出式罗马柱门厅", "room-name"),
    text(porticoCx, porchLabelZ + 320, `${formatMm(porch.w)}×${formatMm(porch.projection)}`, "room-size"),
    text(nbr.x + nbr.w / 2, nbrWoodFront + nbr.woodDepth / 2, `邻居木房 ${formatMm(nbr.w)}×${formatMm(nbr.woodDepth)}`, "room-name"),
    text(nbr.x + nbr.w / 2, nbr.cementFront + nbr.cementDepth / 2, "邻水泥地", "room-size"),
    text(nbr.x + nbr.w / 2, (nbrYardFront + nbr.cementFront) / 2, "邻院坪", "room-size"),
    text(site.width / 2, siteRear + 2000, "南 · 屋后梯田", "dim-label-sm"),
  ].join("");

  const notes = [
    text(17000, siteRear + 2700, "尺寸线可拖：竖线左右、横线上下；线与文字一体。左右按面对房子：左＝东、右＝西。", "footnote"),
    text(
      17000,
      siteRear + 3200,
      `总进深 西${dimMm(totalWest)}／中${dimMm(totalMid)}／东${dimMm(totalEast)} · 辅楼内退${dimMm(annexSetback)} · 口述过圆，待复核`,
      "footnote",
    ),
  ].join("");

  const viewBox = "-10200 -14600 55400 34000";
  const board = { x: -9800, z: -14200, w: 54600, h: 33200 };

  return `<svg class="floor-svg courtyard-site-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" aria-label="整体院坪平面图，含自家与邻居，北向上，东向右">
    <rect x="${board.x}" y="${board.z}" width="${board.w}" height="${board.h}" rx="200" fill="#fbfaf6"/>
    <path d="${ourPath}" fill="#e8ebe3" stroke="#8a9580" stroke-width="80"/>
    <path d="M${nbr.x} ${nbrYardFront} H${nbrEast} V${nbr.cementFront} H${nbr.x} Z" fill="#e4e8e0" stroke="#8a9580" stroke-width="60"/>
    <path d="M${nbr.x} ${nbr.cementFront} H${nbrEast} V${nbrWoodFront} H${nbr.x} Z" fill="#d9ddd4" stroke="#7d8676" stroke-width="50"/>
    ${rect(nbr.x, nbrWoodFront, nbr.w, nbr.woodDepth, 'fill="#efe6d6" stroke="#8a7d68" stroke-width="80"')}
    ${rect(0, wallZ, site.width, main.d, 'fill="none" stroke="#b7b9ae" stroke-width="40" stroke-dasharray="200 140"')}
    ${rect(annex.x, annex.z, annex.w, annex.d, 'fill="#f3f0e8" stroke="#5f6a58" stroke-width="100"')}
    ${recessedPortico() ? `<path d="${recessedFootprint(main.z).map(([x, z], i) => `${i ? "L" : "M"}${x} ${z}`).join(" ")} Z" fill="#f3f0e8" stroke="#5f6a58" stroke-width="100"/>` : rect(main.x, main.z, main.w, main.d, 'fill="#f3f0e8" stroke="#5f6a58" stroke-width="100"')}
    ${rect(porch.x, porchFront, porch.w, porch.projection, 'fill="#e9e2d4" stroke="#b4b6a9" stroke-width="70"')}
    ${posts.map((p) => rect(p.x - p.w / 2, colNorth, p.w, elev.porticoColumnDepth, 'fill="#879183"')).join("")}
    <path d="M${nbr.x} ${nbrYardFront} V${nbrWoodRear}" stroke="#8a9580" stroke-width="50" stroke-dasharray="160 120"/>
    ${dims}${callouts}${notes}
    <g transform="translate(-6400 ${siteRear + 200})"><path d="M0 800 V-550 m-150 250 150-250 150 250" class="dim-span"/>${text(0, -850, "北 N", "dim-label")}<path d="M450 800 H2600 m0-120 v240" class="dim-span"/>${text(2600, 1400, "东 E", "room-size")}</g>
  </svg>`;
}
