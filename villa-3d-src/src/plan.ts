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
  type Furniture,
} from "./data";
import { contourAt } from "./contours";
import { facades, type Facade } from "./facades";
import { roomFillBounds, roomReference } from "./design-data";
import { ensureFurnitureWallClearance } from "./layout-align";
import type { LayoutDraft, StairDraft, PorticoDraft, VoidDraft, ExteriorOpeningDraft } from "./layout-draft";
import { bedLayout, furnitureHasFacing, furnitureLocalBounds } from "./furniture-catalog";
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
function planFrame(index: number) {
  if (index === 0) {
    return {
      viewBox: "-5.2 -10.4 32.4 27.2",
      board: { x: -4.9, z: -10.1, w: 31.8, h: 26.6 },
    };
  }
  return {
    viewBox: "1.6 -9.8 24.2 26.0",
    board: { x: 1.9, z: -9.5, w: 23.6, h: 25.4 },
  };
}

function planViewCenter(viewBox: string) {
  const [vx, vz, vw, vh] = viewBox.split(/\s+/).map(Number);
  return { cx: vx + vw / 2, cy: vz + vh / 2 };
}

const dimN = (n: number) => Number(n.toFixed(3));

/** 户型图链式标注间距（米）：贴边 → 墙间档 → 总长档。 */
const PLAN_DIM_FACE = 0.5;
const PLAN_DIM_CHAIN = 0.82;
/** 短于该长度的墙间不写数字（仍保留分档短划）。 */
const PLAN_DIM_MIN_LABEL = 0.18;

function mmLabel(meters: number) {
  return String(Math.round(Math.abs(meters) * 1000));
}

/** 合并邻近轴线，避免墙厚双侧重复。 */
function mergeAxes(values: number[], eps = 0.07): number[] {
  const sorted = values
    .map((v) => Number(v.toFixed(3)))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || Math.abs(v - out[out.length - 1]) > eps) out.push(v);
  }
  return out;
}

function clipAxes(values: number[], lo: number, hi: number, pad = 0.04): number[] {
  return mergeAxes(values.filter((v) => v >= lo - pad && v <= hi + pad));
}

/**
 * 按「贴哪一边」收集分档轴，避免把内卫／梯下公卫短墙投影到整边。
 * 例：茶室北侧只出现贴北房间的开间（4500×3），不会出现内卫西墙造成的三个 1500。
 */
function collectPlanAxes(
  index: number,
  front: number,
  south: number,
  source: PlanSource,
): {
  northXs: number[];
  southXs: number[];
  eastZs: number[];
  westZs: number[];
  annexZs: number[];
} {
  const main = site.main;
  const eastFace = main.x + main.w;
  const westFace = main.x;
  const rooms = [...source.floor.rooms, ...(index === 0 ? source.annexRooms : [])];
  const walls = [...source.floor.partitions, ...(index === 0 ? source.annexPartitions : [])];
  const near = (a: number, b: number, tol = 0.12) => Math.abs(a - b) < tol;

  const northXs: number[] = [westFace, eastFace];
  const southXs: number[] = [westFace, eastFace];
  const eastZs: number[] = [front, south];
  const westZs: number[] = [front, south];
  const annexZs: number[] = [];

  if (index === 0) {
    // 一层北／南总宽含西侧间距、辅楼、子孙道
    for (const xs of [northXs, southXs]) {
      xs.push(0, site.sideGap, site.annex.x, site.annex.x + site.annex.w, site.main.x, site.width);
    }
    annexZs.push(site.annex.z, site.annex.z + site.annex.d);
  }

  // 贴该立面的房间边 → 该边尺寸链（含公卫／内卫／过道；只进贴边的链，不投到对面）
  for (const r of rooms) {
    const inAnnex = r.x < westFace - 0.2;
    if (near(r.z, front)) {
      northXs.push(r.x, r.x + r.w);
    }
    if (near(r.z + r.d, south) || (inAnnex && near(r.z + r.d, site.annex.z + site.annex.d))) {
      southXs.push(r.x, r.x + r.w);
    }
    if (near(r.x + r.w, eastFace) || (index === 0 && near(r.x + r.w, site.width))) {
      eastZs.push(r.z, r.z + r.d);
    }
    if (near(r.x, westFace) || (index === 0 && near(r.x, 0))) {
      westZs.push(r.z, r.z + r.d);
    }
    if (inAnnex) {
      annexZs.push(r.z, r.z + r.d);
    }
  }

  // 贴边的隔墙：须真正伸到该边；短于约一开间的不投对面（防茶室北侧假 1500）
  const edgeReach = 0.9;
  const minFacadeSpan = 3.2;
  for (const w of walls) {
    const dx = Math.abs(w.b[0] - w.a[0]);
    const dz = Math.abs(w.b[1] - w.a[1]);
    const x0 = Math.min(w.a[0], w.b[0]);
    const x1 = Math.max(w.a[0], w.b[0]);
    const z0 = Math.min(w.a[1], w.b[1]);
    const z1 = Math.max(w.a[1], w.b[1]);
    const inAnnex = x1 < westFace - 0.2;
    if (dx < 0.05 && dz >= minFacadeSpan) {
      const x = (w.a[0] + w.b[0]) / 2;
      if (z0 <= front + edgeReach) northXs.push(x);
      if (z1 >= south - edgeReach) southXs.push(x);
    } else if (dz < 0.05 && dx >= minFacadeSpan) {
      const z = (w.a[1] + w.b[1]) / 2;
      if (inAnnex) {
        annexZs.push(z);
        continue;
      }
      if (x1 >= eastFace - edgeReach) eastZs.push(z);
      if (x0 <= westFace + edgeReach) westZs.push(z);
    }
  }

  const widthLo = index === 0 ? 0 : westFace;
  const widthHi = index === 0 ? site.width : eastFace;
  return {
    northXs: clipAxes(northXs, widthLo, widthHi),
    southXs: clipAxes(southXs, widthLo, widthHi),
    eastZs: clipAxes(eastZs, front, south),
    westZs: clipAxes(westZs, front, south),
    annexZs: index === 0 ? clipAxes(annexZs, site.annex.z, site.annex.z + site.annex.d) : [],
  };
}

/** 参考户型图：尺寸端点用斜短划，不用正交端线。 */
function dimSlash(x: number, z: number) {
  // 斜短划约为原先 1/3，避免挡毫米数字
  const s = 0.04;
  return `<path d="M${dimN(x - s)} ${dimN(z + s)} L${dimN(x + s)} ${dimN(z - s)}" class="dim-tick-slash"/>`;
}

/**
 * 水平链式墙距（毫米数字，仿参考图）。
 * fromZ＝被量边，引出线连到标注档。
 */
function hDimChain(
  breaks: number[],
  z: number,
  opts: { labelSide: "north" | "south"; fromZ: number },
) {
  if (breaks.length < 2) return "";
  const z0 = dimN(z);
  const from = dimN(opts.fromZ);
  const ext = breaks
    .map((x) => `<path d="M${dimN(x)} ${from} V${z0}" class="dim-ext"/>`)
    .join("");
  const x0 = dimN(breaks[0]);
  const x1 = dimN(breaks[breaks.length - 1]);
  const line = `<path d="M${x0} ${z0} H${x1}" class="dim-line"/>`;
  const ticks = breaks.map((x) => dimSlash(x, z)).join("");
  let labels = "";
  for (let i = 0; i < breaks.length - 1; i++) {
    const a = breaks[i];
    const b = breaks[i + 1];
    const seg = b - a;
    if (seg < PLAN_DIM_MIN_LABEL) continue;
    const mid = dimN((a + b) / 2);
    const ly = dimN(opts.labelSide === "north" ? z - 0.3 : z + 0.36);
    labels += text(mid, ly, mmLabel(seg), "dim-mm");
  }
  return `${ext}${line}${ticks}${labels}`;
}

/** 竖直链式墙距（毫米）。 */
function vDimChain(
  breaks: number[],
  x: number,
  opts: { side: "east" | "west"; fromX: number },
) {
  if (breaks.length < 2) return "";
  const xx = dimN(x);
  const from = dimN(opts.fromX);
  const ext = breaks
    .map((z) => `<path d="M${from} ${dimN(z)} H${xx}" class="dim-ext"/>`)
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
    const seg = b - a;
    if (seg < PLAN_DIM_MIN_LABEL) continue;
    const mid = dimN((a + b) / 2);
    const lx = dimN(opts.side === "east" ? x + 0.3 : x - 0.3);
    labels += text(lx, mid, mmLabel(seg), "dim-mm", rot);
  }
  return `${ext}${line}${ticks}${labels}`;
}

/**
 * 四边链式尺寸：内档＝各墙轴线间距，外档＝总面宽／总进深（毫米，参考新中式户型图标法）。
 * 数据取自当前 PlanSource，编辑拖墙／改房间后 redraw 即更新。
 */
function planOuterDimensions(
  index: number,
  front: number,
  depth: number,
  northClear: number,
  source: PlanSource,
) {
  const main = site.main;
  const south = front + depth;
  const { northXs, southXs, eastZs, westZs, annexZs } = collectPlanAxes(
    index,
    front,
    south,
    source,
  );
  const xLo = Math.min(northXs[0] ?? main.x, southXs[0] ?? main.x);
  const xHi = Math.max(
    northXs[northXs.length - 1] ?? main.x + main.w,
    southXs[southXs.length - 1] ?? main.x + main.w,
  );
  const zLo = front;
  const zHi = south;

  const nInner = northClear - PLAN_DIM_FACE;
  const nOuter = nInner - PLAN_DIM_CHAIN;
  const sInner = south + PLAN_DIM_FACE;
  const sOuter = sInner + PLAN_DIM_CHAIN;
  const eastFace = index === 0 ? site.width : main.x + main.w;
  const westFace = index === 0 ? 0 : main.x;
  const eInner = eastFace + PLAN_DIM_FACE;
  const eOuter = eInner + PLAN_DIM_CHAIN;
  const wInner = westFace - PLAN_DIM_FACE;
  const wOuter = wInner - PLAN_DIM_CHAIN;

  const unitNote = text(xLo + 0.35, nOuter - 0.55, "单位 mm", "dim-unit");

  const parts = [
    // 北／南：只按贴该边的开间分档＋总宽
    hDimChain(northXs, nInner, { labelSide: "north", fromZ: northClear }),
    hDimChain([xLo, xHi], nOuter, { labelSide: "north", fromZ: nInner }),
    hDimChain(southXs, sInner, { labelSide: "south", fromZ: south }),
    hDimChain([xLo, xHi], sOuter, { labelSide: "south", fromZ: sInner }),
    // 东：只按贴东墙的进深分档＋总进深
    vDimChain(eastZs, eInner, { side: "east", fromX: eastFace }),
    vDimChain([zLo, zHi], eOuter, { side: "east", fromX: eInner }),
    // 西：一层辅楼进深；二／三楼贴西墙进深
    index === 0 && annexZs.length >= 2
      ? [
          vDimChain(annexZs, wInner, { side: "west", fromX: westFace }),
          vDimChain([annexZs[0], annexZs[annexZs.length - 1]], wOuter, {
            side: "west",
            fromX: wInner,
          }),
        ].join("")
      : [
          vDimChain(westZs, wInner, { side: "west", fromX: westFace }),
          vDimChain([zLo, zHi], wOuter, { side: "west", fromX: wInner }),
        ].join(""),
    unitNote,
  ];
  return parts.join("");
}

/** 南侧最外一档尺寸线 Z，供屋后说明避让。 */
function planSouthDimOuter(south: number) {
  return south + PLAN_DIM_FACE + PLAN_DIM_CHAIN;
}

/** 房间开间×进深（毫米），与外边链式标注同一口径。 */
function roomSizeMm(r: Room) {
  return `${Math.round(r.w * 1000)}×${Math.round(r.d * 1000)}`;
}

/** 墙段中点旁标注厚度（毫米），短墙段跳过。 */
function wallThicknessLabel(a: [number, number], b: [number, number], thickness: number, outward = 1) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.9) return "";
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  const nx = (-(b[1] - a[1]) / len) * 0.32 * outward;
  const nz = ((b[0] - a[0]) / len) * 0.32 * outward;
  const mm = Math.round(thickness * 1000);
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
}

export function planSourceFromPublished(index: number): PlanSource {
  return {
    floor: floors[index],
    annexRooms,
    annexPartitions,
    annexFurniture,
    portico: site.portico,
    stair: stairLayout as StairDraft,
    livingVoid: circulation.livingVoid,
    sideDoorZ: circulation.sideDoorZ,
    sideDoorWidth: circulation.sideDoorWidth,
    thirdFront: floors[2].front,
    exteriorOpenings: [],
    exteriorManaged: false,
  };
}

export function planSourceFromDraft(draft: LayoutDraft, index: number): PlanSource {
  return {
    floor: draft.floors[index],
    annexRooms: draft.annexRooms,
    annexPartitions: draft.annexPartitions,
    annexFurniture: draft.annexFurniture,
    portico: draft.portico,
    stair: draft.stairLayout,
    livingVoid: draft.livingVoid,
    sideDoorZ: draft.sideDoorZ,
    sideDoorWidth: draft.sideDoorWidth,
    thirdFront: draft.floors[2].front,
    exteriorOpenings: draft.exteriorOpenings,
    exteriorManaged: draft.exteriorManaged,
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
) {
  const angle = (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI,
    len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  const bearing = wallRoleOf(p) === "bearing";
  const thick = bearing ? construction.outsideWall : construction.partition;
  const cls = bearing ? "bearing-wall" : "partition";
  const hit = editable
    ? `<path d="M0 0 H${len}" class="edit-hit" data-edit="wall" data-index="${index}" stroke-width=".35"/>`
    : "";
  let opening = "";
  if (p.door) {
    const o = normalizeOpening(p.door);
    opening = editable
      ? openingHandlesSvg(o, index, false)
      : openingSymbolSvg(o);
    if (editable && selectedDoor) {
      opening += `<rect x="${o.offset}" y="-.28" width="${o.width}" height=".56" class="edit-selection" fill="none"/>`;
    }
  }
  const wallSel = editable && selectedWall
    ? `<path d="M0 0 H${len}" class="edit-selection" fill="none" stroke-width=".12"/>
      <rect x="-0.12" y="-0.12" width=".24" height=".24" class="edit-handle" data-edit="wall-handle" data-end="a" data-index="${index}"/>
      <rect x="${len - 0.12}" y="-0.12" width=".24" height=".24" class="edit-handle" data-edit="wall-handle" data-end="b" data-index="${index}"/>`
    : "";
  const widthMark = showWallWidth
    ? wallThicknessLabel(p.a, p.b, thick)
    : "";
  const stroke = wallStrokePaths(strokeKeep, len, cls, thick);
  return `<g transform="translate(${p.a[0]} ${p.a[1]}) rotate(${angle})" data-wall="${index}" data-wall-role="${bearing ? "bearing" : "partition"}">${hit}${stroke}${opening}${wallSel}</g>${widthMark}`;
}
function cornerColumn(x: number, z: number, outward: number, outwardZ = -1) {
  const project = frontElevation.cornerProject, leg = frontElevation.cornerLeg;
  const style = 'fill="#d7d0c2" stroke="#8a8c83" stroke-width=".03"';
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
) {
  const angle = (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI,
    len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  const thick = construction.outsideWall;
  const hit = editable
    ? `<path d="M0 0 H${len}" class="edit-hit" data-edit="facade" data-index="${facadeIndex}" data-floor="${floorKey}" stroke-width=".4"/>`
    : "";
  // 已托管时只画草稿洞口，避免静态窗盖住／挡住可拖手柄。
  const published = exteriorManaged
    ? ""
    : p.openings
        .map((o) => {
          const gap = `<path d="M${o.at - o.w / 2} 0 h${o.w}" class="door-gap" stroke-width="${thick + 0.02}"/>`;
          if (o.open) return gap;
          if (o.door) {
            const wallO = normalizeOpening({
              offset: o.at - o.w / 2,
              width: o.w,
              kind: o.double ? "doubleDoor" : "door",
              hinge: o.hinge,
              side: o.side,
            });
            return gap + openingSymbolSvg(wallO);
          }
          return `${gap}<path d="M${o.at - o.w / 2} -.07 h${o.w} M${o.at - o.w / 2} .07 h${o.w}" class="window"/>`;
        })
        .join("");
  const extras = draftOpenings
    .map((item, globalIndex) => {
      if (item.floor !== floorKey || item.facadeIndex !== facadeIndex) return "";
      const o = normalizeOpening(item.opening);
      const body = editable ? openingHandlesSvg(o, globalIndex, true) : openingSymbolSvg(o);
      const sel =
        editable && selectedExteriorIndex === globalIndex
          ? `<rect x="${o.offset}" y="-.28" width="${o.width}" height=".56" class="edit-selection" fill="none"/>`
          : "";
      return body + sel;
    })
    .join("");
  const widthMark = showWallWidth && len >= 1.2
    ? wallThicknessLabel(p.a, p.b, thick, -1)
    : "";
  const stroke = wallStrokePaths(strokeKeep, len, "outside-wall", thick);
  return `<g transform="translate(${p.a[0]} ${p.a[1]}) rotate(${angle})" data-facade="${facadeIndex}">${hit}${stroke}${published}${extras}</g>${widthMark}`;
}
/**
 * 家具平面符号局部约定（与 furniture-catalog 一致）：
 * +Z＝后方（靠背／床头／贴墙），−Z＝前方（落座／使用），±X＝左右扶手。
 * 前方尖角示意「人站／坐／看」的一侧。
 */
function furnitureFacingMark(f: Furniture, pick: string) {
  if (!furnitureHasFacing(f.kind)) return "";
  const tip = -f.d / 2 - 0.06;
  const base = -f.d / 2 + Math.min(0.12, f.d * 0.12);
  const half = Math.min(0.1, f.w * 0.12);
  return `<path d="M0 ${tip} L${-half} ${base} L${half} ${base} Z" class="furniture facing-mark"${pick}/>`;
}

/** pick：写在真实绘制图形上，空白／外包矩形不能点选。 */
function furnitureSymbol(f: Furniture, pick = "") {
  const cls = `furniture ${f.kind}`;
  const a = (classes: string, extra = "") => `${extra} class="${classes}"${pick}`.trim();
  const face = furnitureFacingMark(f, pick);
  if (f.kind === "roundTable") {
    return `<circle cx="0" cy="0" r="${f.w / 2}" ${a(cls)}/><circle r="${Math.min(0.58, f.w * 0.28)}" ${a("furniture")}/>`;
  }
  if (f.kind === "bed") {
    // 后方＝床头（枕头＋床头柜）；前方＝床尾
    const layout = bedLayout(f);
    const mattress = rect(
      -layout.mattressW / 2,
      -f.d / 2,
      layout.mattressW,
      f.d,
      a(cls, 'rx=".06"'),
    );
    const pillow = rect(
      -layout.mattressW / 2 + 0.08,
      f.d / 2 - 0.5,
      Math.max(0.3, layout.mattressW - 0.16),
      0.34,
      a("furniture pillow", 'rx=".07"'),
    );
    const night = layout.showNightstands
      ? [-1, 1]
          .map((side) => {
            const x = side * (f.w / 2 - layout.nsW / 2);
            const z = f.d / 2 - layout.nsD;
            return rect(x - layout.nsW / 2, z, layout.nsW, layout.nsD, a("furniture nightstand", 'rx=".04"'));
          })
          .join("")
      : "";
    return `${mattress}${pillow}${night}${face}`;
  }
  if (f.kind === "tv") {
    // 前方＝屏幕（−Z）；后方＝机背贴墙
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".04"'))}${rect(-f.w / 2 + 0.06, -f.d / 2 + 0.04, f.w - 0.12, f.d * 0.35, a("furniture tv-screen"))}${face}`;
  }
  if (f.kind === "sofa") {
    // 后方靠背、前方落座、左右双侧扶手
    const arm = 0.14;
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".08"'))}${rect(-f.w / 2, -f.d / 2, arm, f.d, a("furniture sofa-arm", 'rx=".04"'))}${rect(f.w / 2 - arm, -f.d / 2, arm, f.d, a("furniture sofa-arm", 'rx=".04"'))}${rect(-f.w / 2 + arm, f.d / 2 - 0.16, f.w - 2 * arm, 0.16, a("furniture sofa-back", 'rx=".04"'))}${face}`;
  }
  if (f.kind === "toilet") {
    // 前方坐盆，后方水箱
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d * 0.55, a(cls, 'rx=".08"'))}${rect(-f.w / 2, -f.d / 2 + f.d * 0.5, f.w, f.d * 0.5, a("furniture toilet-tank", 'rx=".04"'))}${face}`;
  }
  if (f.kind === "squatToilet") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".05"'))}<ellipse cx="0" cy="0" rx="${f.w * 0.22}" ry="${f.d * 0.32}" ${a("furniture squat-hole")}/>${face}`;
  }
  if (f.kind === "basin") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".05"'))}<ellipse cx="0" cy="${-f.d * 0.06}" rx="${f.w * 0.32}" ry="${f.d * 0.28}" ${a("furniture basin-bowl")}/>${face}`;
  }
  if (f.kind === "shower") {
    // 托盘＋地漏；前方开门侧用虚线表示玻璃门
    const door = `<path d="M${-f.w / 2 + 0.06} ${-f.d / 2} H${f.w / 2 - 0.06}" class="furniture shower-door"${pick}/>`;
    const drain = `<circle cx="0" cy="${f.d * 0.12}" r="${Math.min(f.w, f.d) * 0.08}" class="furniture shower-drain"${pick}/>`;
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".04"'))}${drain}${door}${face}`;
  }
  if (f.kind === "chair") {
    // 前方坐面，后方靠背条
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d * 0.62, a(cls, 'rx=".05"'))}${rect(-f.w / 2, f.d / 2 - 0.08, f.w, 0.08, a("furniture chair-back"))}${face}`;
  }
  if (f.kind === "dressingTable") {
    // 前方镜面／人坐侧
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".05"'))}${rect(-f.w / 2 + 0.08, -f.d / 2, f.w - 0.16, 0.06, a("furniture mirror-base"))}${face}`;
  }
  if (f.kind === "wardrobe" || f.kind === "cabinet") {
    // 前方柜门中缝
    const door = `<path d="M0 ${-f.d / 2} V${f.d / 2}" class="furniture door-seam"${pick}/><path d="M${-f.w / 4} ${-f.d / 2 + 0.08} H${-f.w / 4 + 0.06} M${f.w / 4} ${-f.d / 2 + 0.08} H${f.w / 4 - 0.06}" class="furniture door-knob"${pick}/>`;
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".06"'))}${door}${face}`;
  }
  if (f.kind === "shrine") {
    // 后方贴墙柜背（+Z），前方龛台朝人（−Z）
    const shelf = [-0.28, 0, 0.28]
      .map((t) => rect(-f.w / 2 + 0.1, t * f.d * 0.55 - 0.04, f.w - 0.2, 0.08, a("furniture shrine-shelf")))
      .join("");
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".04"'))}${shelf}${rect(-f.w / 2 + 0.06, f.d / 2 - 0.06, f.w - 0.12, 0.06, a("furniture shrine-back"))}${face}`;
  }
  if (f.kind === "counter" || f.kind === "stove" || f.kind === "hob" || f.kind === "sink" || f.kind === "altar") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".06"'))}${face}`;
  }
  return rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".06"'));
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
          .map(([c, x, z]) => `<rect x="${Number(x) - 0.08}" y="${Number(z) - 0.08}" width=".16" height=".16" class="edit-handle" data-edit="furniture-handle" data-corner="${c}" data-index="${index}"/>`)
          .join("")}
        <circle cx="0" cy="${b.z0 - 0.35}" r=".12" class="edit-rotate-handle" data-edit="furniture-rotate" data-index="${index}"/>
        <path d="M0 ${b.z0} V${b.z0 - 0.35}" class="edit-rotate-stem"/>`
      : "";
  // 家具不在图上写名称，避免与房间标注抢视线；名称只在属性卡片里改。
  return `<g class="furniture-root" transform="translate(${f.x} ${f.z}) rotate(${(-(f.rotation ?? 0) * 180) / Math.PI})" data-furniture="${index}">${furnitureSymbol(f, pick)}${outline}${handles}</g>`;
}
function room(r: Room, floorIndex: number, editable: boolean, annex = false, partitions?: Wall[]) {
  const hit = editable
    ? ` data-edit="room" data-id="${r.id}"${annex ? ' data-annex="1"' : ""}`
    : "";
  // 房间 x/z/w/d 是开间外轮廓；色块缩到墙内侧（套内）。开敞边不缩，相邻房间色块相接无白缝。
  const b = roomFillBounds(r, floorIndex, partitions);
  return `<g tabindex="0" role="button" data-room="${r.id}" aria-label="${r.name}，${r.note ?? "点击查看空间说明"}"${hit}>${rect(b.x, b.z, b.w, b.d, `fill="${colors[r.kind]}" class="room-fill"`)}</g>`;
}

/** 墙段参数区间：与选中房间外包络重合的部分（用来藏绿墙线，避免与橙框叠粗）。 */
function wallHideIntervalsForRoom(w: Pick<Wall, "a" | "b">, r: Room): [number, number][] {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  if (len < 1e-6) return [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
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
    if (o1 - o0 <= 0.05) return null;
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
    if (sorted[i][0] <= last[1] + 0.01) last[1] = Math.max(last[1], sorted[i][1]);
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
    if (h0 > cursor + 0.02) keep.push([cursor, h0]);
    cursor = Math.max(cursor, h1);
  }
  if (len > cursor + 0.02) keep.push([cursor, len]);
  return keep;
}

function wallStrokePaths(
  keep: [number, number][] | null,
  len: number,
  className: string,
  thick: number,
) {
  if (keep === null) {
    return `<path d="M0 0 H${len}" class="${className}" stroke-width="${thick}"/>`;
  }
  return keep
    .map(([t0, t1]) => `<path d="M${t0} 0 H${t1}" class="${className}" stroke-width="${thick}"/>`)
    .join("");
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
    const h = 0.28;
    return `<path d="M${x - nx * h} ${z - nz * h} L${x + nx * h} ${z + nz * h}" class="align-guide-bay"/>`;
  };
  const x0 = g.a[0] + ux * g.bayStart;
  const z0 = g.a[1] + uz * g.bayStart;
  const x1 = g.a[0] + ux * g.bayEnd;
  const z1 = g.a[1] + uz * g.bayEnd;
  return `<g class="align-guide" pointer-events="none">${mark(g.bayStart)}${mark(g.bayEnd)}<path d="M${x0} ${z0} L${x1} ${z1}" class="align-guide-bay-span"/></g>`;
}

/** 画墙橡皮筋、十字线与对齐引导（米制坐标）。 */
export function renderDrawGuide(g: DrawGuide) {
  const span = 40;
  const axes = `<path d="M${g.ax - span} ${g.az} H${g.ax + span} M${g.ax} ${g.az - span} V${g.az + span}" class="edit-guide-axis"/>`;
  const alignX = (g.guideXs ?? [])
    .map((x) => `<path d="M${x} ${g.az - span} V${g.az + span}" class="edit-guide-align"/>`)
    .join("");
  const alignZ = (g.guideZs ?? [])
    .map((z) => `<path d="M${g.ax - span} ${z} H${g.ax + span}" class="edit-guide-align"/>`)
    .join("");
  const start = `<circle cx="${g.ax}" cy="${g.az}" r=".12" class="edit-guide-point"/>`;
  if (g.bx === undefined || g.bz === undefined) {
    return `<g id="edit-draw-guide" class="edit-draw-guide" pointer-events="none">${axes}${alignX}${alignZ}${start}</g>`;
  }
  const rubber = `<path d="M${g.ax} ${g.az} L${g.bx} ${g.bz}" class="edit-guide-wall"/>`;
  const end = `<circle cx="${g.bx}" cy="${g.bz}" r=".12" class="edit-guide-point"/>`;
  const mx = (g.ax + g.bx) / 2;
  const mz = (g.az + g.bz) / 2;
  const len = g.length ?? Math.hypot(g.bx - g.ax, g.bz - g.az);
  const label = text(mx, mz - 0.28, `${len.toFixed(1)} m`, "edit-guide-label");
  const hint = g.hint ? text(mx, mz + 0.42, g.hint, "edit-guide-hint") : "";
  return `<g id="edit-draw-guide" class="edit-draw-guide" pointer-events="none">${axes}${alignX}${alignZ}${rubber}${start}${end}${label}${hint}</g>`;
}
function useZone(f: Furniture) {
  if (!["bed", "wardrobe", "cabinet", "toilet", "squatToilet", "basin", "sink", "stove", "hob", "dressingTable"].includes(f.kind)) return "";
  const b = furnitureLocalBounds(f);
  return `<g pointer-events="none" transform="translate(${f.x} ${f.z}) rotate(${(-(f.rotation ?? 0) * 180) / Math.PI})">${rect(b.x0 - .6, b.z0 - .6, b.x1 - b.x0 + 1.2, b.z1 - b.z0 + 1.2, 'class="use-zone"')}<title>家具四周0.60m讨论留位；使用方向、门扇及实际净宽待设计</title></g>`;
}

/** 平面门厅柱：柱心在外伸北沿左右两角（与 frontElevation / syncFrontElevation 一致）。 */
function porticoPosts(porch: PorticoDraft) {
  const w = frontElevation.porticoColumnDepth;
  return [
    { x: porch.x, w },
    { x: porch.x + porch.w, w },
  ];
}

export function floorPlan(index: number, clearance: boolean, balcony: boolean, options: PlanOptions = {}, source?: PlanSource) {
  // 未托管草稿时，把源码家具钳到墙内皮外侧，避免压墙线。
  if (!source) ensureFurnitureWallClearance();
  const src = source ?? planSourceFromPublished(index);
  const f = src.floor;
  const editable = !!options.editable;
  const allRooms = [...f.rooms, ...(index === 0 ? src.annexRooms : [])];
  const porch = src.portico;
  const porchFront = site.main.z - porch.projection;
  const elevation = frontElevation;
  const posts = porticoPosts(porch);
  const [westPost, , , eastPost] = elevation.balustradePosts;
  const middleWest = { ...elevation.balustradePosts[1], x: posts[0].x, w: posts[0].w };
  const middleEast = { ...elevation.balustradePosts[2], x: posts[1].x, w: posts[1].w };
  const wallFace = src.thirdFront;
  const sideFront = elevation.terraceFront;
  const terraceRails = `<path d="M${westPost.x} ${wallFace} V${sideFront} H${middleWest.x} M${eastPost.x} ${wallFace} V${sideFront} H${middleEast.x} M${middleWest.x} ${elevation.postZ} V${middleWest.z} H${middleEast.x} V${elevation.postZ}" class="balustrade"/>`;
  const s = `<defs><pattern id="void" patternUnits="userSpaceOnUse" width=".28" height=".28" patternTransform="rotate(45)"><rect width=".28" height=".28" fill="#f4f3ee"/><path d="M0 0 V.28" stroke="#d8d6cc" stroke-width=".045"/></pattern></defs>`;
  const mainPartitions = f.partitions;
  const annexParts = src.annexPartitions;
  const partitionsFor = (r: Room) => (src.annexRooms.some((a) => a.id === r.id) ? annexParts : mainPartitions);
  const bodyDepth = index === 2 ? site.main.d - site.setback : site.main.d;
  const bodySouth = f.front + bodyDepth;
  const labels = allRooms
    .map((r) => {
      const [x, z] = r.label ?? [r.x + r.w / 2, r.z + r.d / 2];
      const ref = roomReference(r, index, partitionsFor(r));
      const sizeTxt =
        r.kind === "void" ? "两层通高 · 无楼板" : roomSizeMm(r);
      const insideTxt =
        options.inside && r.kind !== "void"
          ? text(
              x,
              z + 0.5,
              `内侧约${Math.round(ref.w * 1000)}×${Math.round(ref.d * 1000)}${ref.nested.length ? " · 含套内空间" : ""}`,
              "inside-label",
            )
          : "";
      return `<g class="room-label" pointer-events="none">${text(x, z - 0.04, r.name)}${text(x, z + 0.28, sizeTxt, "room-size")}${insideTxt}</g>`;
    })
    .join("");
  const stair = src.stair;
  const stepLines = Array.from({ length: 9 }, (_, i) => {
    const sx = stair.x, sz = stair.z, flight = stair.flight, gap = stair.gap;
    return stair.axis === "x"
      ? `<path d="M${sx + i * stair.tread} ${sz} v${flight} M${sx + (8 - i) * stair.tread} ${sz + flight + gap} v${flight}" class="step-line"/>`
      : `<path d="M${sx} ${sz + i * stair.tread} h${flight} M${sx + flight + gap} ${sz + (8 - i) * stair.tread} h${flight}" class="step-line"/>`;
  }).join("");
  // 户型图不画门厅柱间三步与左右侧坡道（仅立体模型保留）。
  const columnNorth = elevation.porticoColumnZ - elevation.porticoColumnDepth / 2;
  const roundTable = src.annexFurniture.find((item) => item.kind === "roundTable");
  const roundCx = roundTable?.x ?? site.annex.x + site.annex.w / 2;
  const roundCz = roundTable?.z ?? site.annex.z - 1.35;
  const roundChairR = 1.05;
  // 圆桌椅环半径与摆放一致；勿用过大圆域。
  const isRoundChair = (item: (typeof src.annexFurniture)[number]) =>
    item.kind === "chair" && Math.abs(Math.hypot(item.x - roundCx, item.z - roundCz) - roundChairR) < 0.25;
  const diningFurniture = src.annexFurniture.filter(
    (item) => options.dining !== "daily" || !(item.kind === "roundTable" || isRoundChair(item)),
  );
  const dineClear = diningClearance();
  // 子孙道竖排标注放在通辅楼门洞以北，避免压到门洞与「通辅楼」字。
  const laneLabelX = (site.annex.x + site.annex.w + site.main.x) / 2;
  const laneLabelZ = src.sideDoorZ - src.sideDoorWidth / 2 - 1.9;
  const floorFurniture = f.furniture;
  const allFurniture = [...floorFurniture, ...(index === 0 ? diningFurniture : [])];
  const porchY = index === 2 ? elevation.centerFront : porchFront;
  const porchH = index === 2 ? elevation.terraceBack - elevation.centerFront : porch.projection;
  const porticoHit = editable
    ? rect(porch.x, porchY, porch.w, porchH, `class="edit-hit portico-hit" data-edit="portico"`)
    : "";
  const stairHit = editable
    ? rect(stair.room.x, stair.room.z, stair.room.w, stair.room.d, `class="edit-hit" data-edit="stair" fill="transparent"`)
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
  const roomSelections = selectedRoomList
    .map((r) => {
      const annex = src.annexRooms.some((room) => room.id === r.id);
      const primary = selected?.kind === "room" && selected.id === r.id;
      const b = roomFillBounds(r, index, partitionsFor(r));
      // 抬到最上层：本房色块盖住邻房共边
      const lift = rect(b.x, b.z, b.w, b.d, `fill="${colors[r.kind]}" class="room-fill room-fill-lifted"`);
      // 框按房间外包络统一内缩，四边同粗；贴边绿墙已在墙线上抠掉，不再叠粗
      const pad = 0.05;
      const fx = r.x + pad;
      const fz = r.z + pad;
      const fw = Math.max(0.1, r.w - 2 * pad);
      const fd = Math.max(0.1, r.d - 2 * pad);
      const frame = rect(fx, fz, fw, fd, 'class="edit-selection edit-selection-room" fill="none"');
      const handles = primary
        ? [["nw", r.x, r.z], ["ne", r.x + r.w, r.z], ["sw", r.x, r.z + r.d], ["se", r.x + r.w, r.z + r.d]]
            .map(
              ([c, x, z]) =>
                `<rect x="${Number(x) - 0.12}" y="${Number(z) - 0.12}" width=".24" height=".24" class="edit-handle" data-edit="room-handle" data-corner="${c}" data-id="${r.id}"${annex ? ' data-annex="1"' : ""}/>`,
            )
            .join("")
        : "";
      return `<g class="room-selection-top" pointer-events="none">${lift}${frame}</g>${handles}`;
    })
    .join("");
  const selection =
    roomSelections ||
    (editable && selected?.kind === "portico"
      ? rect(porch.x, porchY, porch.w, porchH, 'class="edit-selection" fill="none"')
      : editable && selected?.kind === "stair"
        ? `${rect(stair.room.x, stair.room.z, stair.room.w, stair.room.d, 'class="edit-selection" fill="none"')}
              ${[["nw", stair.room.x, stair.room.z], ["ne", stair.room.x + stair.room.w, stair.room.z], ["sw", stair.room.x, stair.room.z + stair.room.d], ["se", stair.room.x + stair.room.w, stair.room.z + stair.room.d]]
                .map(([c, x, z]) => `<rect x="${Number(x) - 0.12}" y="${Number(z) - 0.12}" width=".24" height=".24" class="edit-handle" data-edit="stair-handle" data-corner="${c}"/>`)
                .join("")}`
        : "");

  const frame = planFrame(index);
  const showWallWidth = !!options.showWallWidth;
  const northClear =
    index === 2
      ? Math.min(elevation.centerFront, elevation.terraceFront, porchY)
      : Math.min(porchFront, columnNorth);
  const southEdge = bodySouth;
  const southDimOuter = planSouthDimOuter(southEdge);
  const noteZ = southDimOuter + 0.95;
  const { cx, cy } = planViewCenter(frame.viewBox);
  const orientLabel = PLAN_ENTRANCE_DOWN ? "南向上，西向右（门头朝下）" : "北向上，东向右";
  const worldOpen = PLAN_ENTRANCE_DOWN
    ? `<g class="plan-world" transform="rotate(180 ${dimN(cx)} ${dimN(cy)})">`
    : `<g class="plan-world">`;
  return `<svg class="floor-svg ${index > 0 ? "main-floor-svg" : ""} ${editable ? "editing" : ""}" xmlns="http://www.w3.org/2000/svg" viewBox="${frame.viewBox}" aria-label="${f.name}户型平面图，${orientLabel}${options.dining === "daily" ? "，餐厅日常6座建议情景" : ""}${editable ? "，编辑模式" : ""}">
    ${s}<rect x="${frame.board.x}" y="${frame.board.z}" width="${frame.board.w}" height="${frame.board.h}" rx=".2" fill="#fbfaf6"/>
    ${worldOpen}
    ${planOuterDimensions(index, f.front, bodyDepth, northClear, src)}
    ${index === 2 ? `${elevation.sideTerraces.map(t => rect(t.x, elevation.terraceFront, t.w, elevation.terraceBack - elevation.terraceFront, 'fill="#e9e2d4" stroke="#b4b6a9" stroke-width=".06"')).join("")}${text(8.85, -0.2, "西侧露台", "dim-label")}${text(18.4, -0.2, "东侧露台", "dim-label")}` : ""}
    ${porticoHit}${rect(porch.x, porchY, porch.w, porchH, `fill="${index === 1 ? "url(#void)" : "#e9e2d4"}" stroke="#b4b6a9" stroke-width=".06"`)}
    ${text(porch.x + porch.w / 2, -1.95, index === 2 ? "中央露台 · 前方敞开" : index === 1 ? "门厅上空 · 无楼板" : `门厅 ${porch.w.toFixed(1)}×${porch.projection.toFixed(1)} m · 另计`, "dim-label")}
    ${index < 2 ? `${posts.map(p => rect(p.x - p.w / 2, elevation.porticoColumnZ - elevation.porticoColumnDepth / 2, p.w, elevation.porticoColumnDepth, 'fill="#879183"')).join("")}${cornerColumn(site.main.x + 0.12, f.front + 0.12, -1)}${cornerColumn(site.main.x + site.main.w - 0.12, f.front + 0.12, 1)}` : `${terraceRails}${elevation.balustradePosts.map(p => rect(p.x - p.w / 2, p.z - p.w / 2, p.w, p.w, 'fill="#c3bba9" stroke="#777872" stroke-width=".04"')).join("")}${posts.map(p => rect(p.x - elevation.dividerWidth / 2, elevation.postZ - .25, elevation.dividerWidth, .5, 'fill="#879183"')).join("")}${text(13.7, -0.48, "内退柱墙隔开两侧 · 官帽柱贴前墙构造柱", "room-size")}`}${cornerColumn(site.main.x + 0.12, site.main.z + site.main.d - 0.12, -1, 1)}${cornerColumn(site.main.x + site.main.w - 0.12, site.main.z + site.main.d - 0.12, 1, 1)}
    ${f.rooms.map((r) => room(r, index, editable, false, mainPartitions)).join("")}
    ${index === 0 ? src.annexRooms.map((r) => room(r, index, editable, true, annexParts)).join("") : ""}
    ${options.useZones ? allFurniture.map(useZone).join("") : ""}
    ${stairHit}${stepLines}
    ${f.partitions
      .map((p, i) =>
        partition(
          p,
          i,
          editable,
          selectedDoorIndex === i && !selected?.annex,
          !!selectedWallIndex && !selectedWallIndex.annex && selectedWallIndex.index === i,
          showWallWidth,
          wallStrokeKeepSegments(p, selectedRoomList),
        ),
      )
      .join("")}
    ${facades(index)
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
          wallStrokeKeepSegments(p, selectedRoomList),
        ),
      )
      .join("")}
    ${index === 0
      ? src.annexPartitions
          .map((p, i) =>
            partition(
              p,
              1000 + i,
              editable,
              selectedDoorIndex === i && !!selected?.annex,
              !!selectedWallIndex && selectedWallIndex.annex && selectedWallIndex.index === i,
              showWallWidth,
              wallStrokeKeepSegments(p, selectedRoomList),
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
              wallStrokeKeepSegments(p, selectedRoomList),
            ),
          )
          .join("")
      : ""}
    ${text(
      index === 0 ? 3.2 : 8.2,
      northClear - 3.35,
      showWallWidth
        ? `墙示意 · 外墙／内承重${Math.round(construction.outsideWall * 1000)} · 隔墙（灰）${Math.round(construction.partition * 1000)}（毫米 · 非结构图）`
        : "墙示意 · 绿系实线＝承重 · 灰色＝室内隔墙（方案非结构图）",
      "wall-role-legend",
    )}
    ${index === 1 ? `<path d="M${src.livingVoid.x + src.livingVoid.w} ${src.livingVoid.z + 0.16} V${src.livingVoid.z + src.livingVoid.d} H${src.livingVoid.x + 0.16}" class="balustrade"/>` : ""}
    ${index === 0 ? `<path d="M${site.annex.x + site.annex.w} ${src.sideDoorZ - src.sideDoorWidth / 2} H${site.main.x} M${site.annex.x + site.annex.w} ${src.sideDoorZ + src.sideDoorWidth / 2} H${site.main.x}" class="dim-line"/>${text(laneLabelX, src.sideDoorZ, "通辅楼", "room-size")}` : ""}
    ${index === 0 && clearance ? `${options.dining !== "daily" ? `<circle cx="${dineClear.cx}" cy="${dineClear.cz}" r="${dineClear.radius}" class="clearance"/>` : text(roundCx, roundCz + 0.48, "日常示意：圆桌收起 · 收纳待定", "room-size")}` : ""}
    ${balcony && index === 2 ? (() => {
      const bx = site.main.x + site.main.w * (12.65 - 6.8) / 13.5;
      const bw = 2.5 * (site.main.w / 13.5);
      const bz = site.main.z + site.main.d;
      return rect(bx, bz, bw, 1.2, 'class="clearance"') + text(bx + bw / 2, bz + 0.7, "局部浅阳台", "room-size");
    })() : ""}
    ${/* 家具画在墙／房间之上，避免点选被房间或隔墙热区抢走 */ ""}
    ${floorFurniture.map((item, i) => furniture(item, i, editable, selectedFurniture.has(i), selected?.kind === "furniture" && !selected.annex && selected.index === i)).join("")}
    ${index === 0
      ? diningFurniture
          .map((item, i) =>
            furniture(
              item,
              1000 + i,
              editable,
              selectedFurniture.has(1000 + i),
              selected?.kind === "furniture" && !!selected.annex && selected.index === i,
            ),
          )
          .join("")
      : ""}
    ${/* 选中房间最后抬到最上层：色块盖住邻房共边，框线整圈等宽 */ ""}
    ${selection}
    ${labels}${index === 0 ? text(laneLabelX, laneLabelZ, `子孙道 · ${site.lane.toFixed(1)} m`, "dim-label", -90) : ""}
    ${text(13.55, noteZ, `南侧高田 +2.5 m · 屋后留 ${site.rearGap} m`, "dim-label")}
    ${options.drawGuide ? renderDrawGuide(options.drawGuide) : ""}
    ${options.alignGuide ? renderAlignGuide(options.alignGuide) : ""}
    </g>
  </svg>`;
}

export function diningClearance() {
  // 圆桌在辅楼餐厅居中；半径按桌＋椅占地示意。
  const round = annexFurniture.find((f) => f.kind === "roundTable");
  const cx = round?.x ?? site.annex.x + site.annex.w / 2;
  const cz = round?.z ?? site.annex.z + 2.4;
  const radius = (round?.w ?? 1.6) / 2 + 0.55;
  return {
    west: cx - radius - site.annex.x,
    north: cz - radius - site.annex.z,
    east: site.annex.x + site.annex.w - (cx + radius),
    cx,
    cz,
    radius,
  };
}

/** 米数标签：整数用一位小数，其余去掉多余尾零。 */
function meters(n: number) {
  const t = Math.round(n * 100) / 100;
  return `${Number.isInteger(t) ? t.toFixed(1) : String(t)} m`;
}

type YardVOpts = {
  id: string;
  /** 默认在被量边哪一侧放尺寸线；拖过边后以实际位置为准 */
  side?: "east" | "west";
  small?: boolean;
  /** 仅影响初始是否画虚线：direct＝尺寸线贴边；extend＝尺寸线离开边 */
  style?: "extend" | "direct";
  /** 尺寸线相对默认 dimX 的偏移（米）；拖动只改此项，黄点不动 */
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
  const ah = 0.13;
  const aw = 0.11;
  const r = 0.06;
  const sep = Math.abs(baseDim + shift - edgeX);
  const showExt = sep >= yardDimDirectEps;
  const stop = dimN(ex + dir * Math.max(sep - 0.12, sep * 0.88));
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
  const stop = dimN(ez + dir * Math.max(sep - 0.12, sep * 0.88));
  const ly = dimN(dz + dir * yardDimLabelGap);
  const tick = yardDimTick;
  const ah = 0.13;
  const aw = 0.11;
  const r = 0.06;
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
  const porchFront = wallZ - porch.projection;
  const colNorth = elev.porticoColumnZ - elev.porticoColumnDepth / 2;
  const porticoCx = porch.x + porch.w / 2;
  const westCornerX = annex.x;
  const eastCornerX = main.x + main.w;
  const westGap = site.sideGap;
  const eastGap = site.width - eastCornerX;
  const laneX0 = annex.x + annex.w;
  const laneX1 = main.x;

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

  const posts = [
    { x: porch.x + 0.38, w: 0.8 },
    { x: porch.x + porch.w - 0.38, w: 0.8 },
  ];
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
  const leftBayCx = (porch.x + porch.w + eastCornerX) / 2;
  const rightBayFront = frontAt(rightBayCx);
  const leftBayFront = frontAt(leftBayCx);
  const rightBayWallToFront = depthFrom(wallZ, rightBayCx);
  const leftBayWallToFront = depthFrom(wallZ, leftBayCx);
  const annexSetback = annexFront - wallZ;
  const totalWest = siteRear - westFront;
  const totalMid = siteRear - midFront;
  const totalEast = siteRear - eastFront;
  const annexCornerDim = annexEastX + 1.0;
  const mainDepthDim = main.x - 0.4;
  const eastCornerDim = eastCornerX - 0.55;
  // 内退：尺寸线落在辅楼前墙面宽中点（图示红框位置）
  const annexFrontMidX = annex.x + annex.w / 2;
  // 竖墙皮：图内纵向标线压到这些 X 时改回虚线引出
  const wallXs = [0, annex.x, annexEastX, main.x, eastCornerX, site.width, porch.x, porch.x + porch.w];
  const onWall = (x: number) => wallXs.some((w) => Math.abs(w - x) < 0.12);
  const insideV = (dimX: number): "extend" | "direct" => (onWall(dimX) ? "extend" : "direct");

  // 图外纵向仍用虚线引出；图内纵向默认点对点实线，压墙才引出；均可拖动
  const dims = [
    yardVDim(westFront, siteRear, 0, -5.2, `西总进深 ${meters(totalWest)}`, { id: "v-west-total", side: "west", shift: sh("v-west-total") }),
    yardVDim(westFront, annexFront, 0, -3.6, `外沿→辅楼前 ${meters(annexFront - westFront)}`, {
      id: "v-west-front-annex", side: "west", small: true, shift: sh("v-west-front-annex"),
    }),
    yardVDim(annexFront, annexRear, westCornerX, -3.6, `辅楼进深 ${meters(annex.d)}`, {
      id: "v-annex-depth", side: "west", small: true, shift: sh("v-annex-depth"),
    }),
    yardVDim(wallZ, annexFront, annexFrontMidX, annexFrontMidX + 0.55, `内退 ${meters(annexSetback)}`, {
      id: "v-setback", side: "east", small: true, style: "direct", shift: sh("v-setback"),
    }),
    yardVDim(annexEastFront, annexFront, annexEastX, annexCornerDim, `辅楼角→外沿 ${meters(wallDepthAnnexE)}`, {
      id: "v-annex-corner-front", side: "east", small: true, style: insideV(annexCornerDim), shift: sh("v-annex-corner-front"),
    }),
    yardVDim(midFront, siteRear, midX, midX + 1.35, `中总进深 ${meters(totalMid)}`, {
      id: "v-mid-total", side: "east", style: "direct", shift: sh("v-mid-total"),
    }),
    yardVDim(eastCornerFront, wallZ, eastCornerX, eastCornerDim, `主楼前墙→外沿 ${meters(wallDepthE)}`, {
      id: "v-east-wall-front", side: "west", small: true, style: "direct", shift: sh("v-east-wall-front"),
    }),
    yardVDim(mainWestFront, wallZ, main.x, main.x - 0.55, `主楼右角→外沿 ${meters(wallDepthMainW)}`, {
      id: "v-main-west-wall-front", side: "west", small: true, style: insideV(main.x - 0.55), shift: sh("v-main-west-wall-front"),
    }),
    yardVDim(eastFront, siteRear, site.width, site.width + 4.4, `东总进深 ${meters(totalEast)}`, {
      id: "v-east-total", side: "east", shift: sh("v-east-total"),
    }),
    yardVDim(eastFront, 0, site.width, site.width + 2.9, `外沿→水泥边 ${meters(0 - eastFront)}`, {
      id: "v-east-front-cement", side: "east", small: true, shift: sh("v-east-front-cement"),
    }),
    yardVDim(0, siteRear, site.width, site.width + 2.9, `水泥边→屋后 ${meters(siteRear)}`, {
      id: "v-east-cement-rear", side: "east", small: true, shift: sh("v-east-cement-rear"),
    }),
    yardVDim(rearZ, siteRear, eastCornerX, site.width + 1.5, `屋后留 ${meters(siteRear - rearZ)}`, {
      id: "v-rear-leave", side: "east", small: true, shift: sh("v-rear-leave"),
    }),
    yardVDim(porticoFrontZ, wallZ, porticoCx, porticoCx + 1.7, `门厅中心前墙→外沿 ${meters(wallDepthMid)}`, {
      id: "v-portico-wall-front", side: "east", small: true, style: insideV(porticoCx + 1.7), shift: sh("v-portico-wall-front"),
    }),
    yardVDim(westColFront, colNorth, westCol.x, westCol.x - 0.55, `右柱外缘→外沿 ${meters(westColOuterToFront)}`, {
      id: "v-west-col-outer-front", side: "west", small: true, style: insideV(westCol.x - 0.55), shift: sh("v-west-col-outer-front"),
    }),
    yardVDim(eastColFront, colNorth, eastCol.x, eastCol.x + 0.55, `左柱外缘→外沿 ${meters(eastColOuterToFront)}`, {
      id: "v-col-outer-front", side: "east", small: true, style: insideV(eastCol.x + 0.55), shift: sh("v-col-outer-front"),
    }),
    yardVDim(leftBayFront, wallZ, leftBayCx, leftBayCx + 0.7, `左开间墙→外沿 ${meters(leftBayWallToFront)}`, {
      id: "v-left-bay-front", side: "east", small: true, style: insideV(leftBayCx + 0.7), shift: sh("v-left-bay-front"),
    }),
    yardVDim(rightBayFront, wallZ, rightBayCx, rightBayCx - 0.7, `右开间墙→外沿 ${meters(rightBayWallToFront)}`, {
      id: "v-right-bay-front", side: "west", small: true, style: insideV(rightBayCx - 0.7), shift: sh("v-right-bay-front"),
    }),
    yardVDim(nbrYardFront, nbr.cementFront, nbrEast, nbrEast + 2.2, `邻院外 ${meters(nbrYardBeyond)}`, {
      id: "v-nbr-yard", side: "east", small: true, shift: sh("v-nbr-yard"),
    }),
    yardVDim(nbr.cementFront, nbrWoodFront, nbrEast, nbrEast + 2.2, `邻水泥 ${meters(nbr.cementDepth)}`, {
      id: "v-nbr-cement", side: "east", small: true, shift: sh("v-nbr-cement"),
    }),
    yardVDim(nbrWoodFront, nbrWoodRear, nbrEast, nbrEast + 2.2, `邻木房 ${meters(nbr.woodDepth)}`, {
      id: "v-nbr-wood", side: "east", small: true, shift: sh("v-nbr-wood"),
    }),
    yardHDim(0, site.width, westFront, Math.min(westFront, nbrYardFront) - 1.8, `自家面宽 ${meters(site.width)}`, {
      id: "h-own-width", labelSide: "north", shift: sh("h-own-width"),
    }),
    yardHDim(nbr.x, nbrEast, nbrYardFront, Math.min(westFront, nbrYardFront) - 1.8, `邻居面宽 ${meters(nbr.w)}`, {
      id: "h-nbr-width", labelSide: "north", shift: sh("h-nbr-width"),
    }),
    yardHDim(0, nbrEast, Math.min(westFront, nbrYardFront), Math.min(westFront, nbrYardFront) - 2.9, `合计面宽 ${meters(nbrEast)}`, {
      id: "h-total-width", labelSide: "north", shift: sh("h-total-width"),
    }),
    yardHDim(0, westGap, siteRear, siteRear + 1.1, `西侧 ${meters(westGap)}`, {
      id: "h-west-gap", labelSide: "south", small: true, shift: sh("h-west-gap"),
    }),
    yardHDim(annex.x, annex.x + annex.w, siteRear, siteRear + 1.1, `辅楼 ${meters(annex.w)}`, {
      id: "h-annex-w", labelSide: "south", small: true, shift: sh("h-annex-w"),
    }),
    yardHDim(laneX0, laneX1, siteRear, siteRear + 1.1, `子孙道 ${meters(site.lane)}`, {
      id: "h-lane", labelSide: "south", small: true, shift: sh("h-lane"),
    }),
    yardHDim(main.x, eastCornerX, siteRear, siteRear + 1.1, `主楼 ${meters(main.w)}`, {
      id: "h-main-w", labelSide: "south", small: true, shift: sh("h-main-w"),
    }),
    yardHDim(eastCornerX, site.width, siteRear, siteRear + 1.1, `东侧 ${meters(eastGap)}`, {
      id: "h-east-gap", labelSide: "south", small: true, shift: sh("h-east-gap"),
    }),
    yardHDim(nbr.x, nbrEast, nbrWoodRear, siteRear + 1.1, `邻居 ${meters(nbr.w)}`, {
      id: "h-nbr-w", labelSide: "south", small: true, shift: sh("h-nbr-w"),
    }),
    yardVDim(wallZ, rearZ, main.x, mainDepthDim, `主楼进深 ${meters(main.d)}`, {
      id: "v-main-depth", side: "west", small: true, style: insideV(mainDepthDim), shift: sh("v-main-depth"),
    }),
  ].join("");

  const porchLabelZ = (porchFront + wallZ) / 2;
  const callouts = [
    text(annex.x + annex.w / 2, annex.z + annex.d / 2, `辅楼 ${annex.w.toFixed(1)}×${annex.d.toFixed(1)}`, "room-name"),
    text(main.x + main.w / 2, main.z + main.d / 2 + 0.35, `主楼 ${main.w.toFixed(1)}×${main.d.toFixed(1)}`, "room-name"),
    // 门厅尺寸写在门厅投影内，不再外挂一条尺寸线
    text(porticoCx, porchLabelZ - 0.22, "罗马柱门厅", "room-name"),
    text(porticoCx, porchLabelZ + 0.32, `${porch.w.toFixed(1)}×${porch.projection.toFixed(1)}`, "room-size"),
    text(nbr.x + nbr.w / 2, nbrWoodFront + nbr.woodDepth / 2, `邻居木房 ${nbr.w.toFixed(1)}×${nbr.woodDepth.toFixed(1)}`, "room-name"),
    text(nbr.x + nbr.w / 2, nbr.cementFront + nbr.cementDepth / 2, "邻水泥地", "room-size"),
    text(nbr.x + nbr.w / 2, (nbrYardFront + nbr.cementFront) / 2, "邻院坪", "room-size"),
    text(site.width / 2, siteRear + 2.0, "南 · 屋后梯田", "dim-label-sm"),
  ].join("");

  const notes = [
    text(17, siteRear + 2.7, "尺寸线可拖：竖线左右、横线上下；线与文字一体。左右按面对房子：左＝东、右＝西。", "footnote"),
    text(
      17,
      siteRear + 3.2,
      `总进深 西${meters(totalWest)}／中${meters(totalMid)}／东${meters(totalEast)} · 辅楼内退${meters(annexSetback)} · 口述过圆，待复核`,
      "footnote",
    ),
  ].join("");

  const viewBox = "-10.2 -14.6 55.4 34.0";
  const board = { x: -9.8, z: -14.2, w: 54.6, h: 33.2 };

  return `<svg class="floor-svg courtyard-site-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" aria-label="整体院坪平面图，含自家与邻居，北向上，东向右">
    <rect x="${board.x}" y="${board.z}" width="${board.w}" height="${board.h}" rx=".2" fill="#fbfaf6"/>
    <path d="${ourPath}" fill="#e8ebe3" stroke="#8a9580" stroke-width=".08"/>
    <path d="M${nbr.x} ${nbrYardFront} H${nbrEast} V${nbr.cementFront} H${nbr.x} Z" fill="#e4e8e0" stroke="#8a9580" stroke-width=".06"/>
    <path d="M${nbr.x} ${nbr.cementFront} H${nbrEast} V${nbrWoodFront} H${nbr.x} Z" fill="#d9ddd4" stroke="#7d8676" stroke-width=".05"/>
    ${rect(nbr.x, nbrWoodFront, nbr.w, nbr.woodDepth, 'fill="#efe6d6" stroke="#8a7d68" stroke-width=".08"')}
    ${rect(0, wallZ, site.width, main.d, 'fill="none" stroke="#b7b9ae" stroke-width=".04" stroke-dasharray=".2 .14"')}
    ${rect(annex.x, annex.z, annex.w, annex.d, 'fill="#f3f0e8" stroke="#5f6a58" stroke-width=".1"')}
    ${rect(main.x, main.z, main.w, main.d, 'fill="#f3f0e8" stroke="#5f6a58" stroke-width=".1"')}
    ${rect(porch.x, porchFront, porch.w, porch.projection, 'fill="#e9e2d4" stroke="#b4b6a9" stroke-width=".07"')}
    ${posts.map((p) => rect(p.x - p.w / 2, colNorth, p.w, elev.porticoColumnDepth, 'fill="#879183"')).join("")}
    <path d="M${nbr.x} ${nbrYardFront} V${nbrWoodRear}" stroke="#8a9580" stroke-width=".05" stroke-dasharray=".16 .12"/>
    ${dims}${callouts}${notes}
    <g transform="translate(-6.4 ${siteRear + 0.2})"><path d="M0 .8 V-.55 m-.15 .25 .15-.25 .15 .25" class="dim-span"/>${text(0, -0.85, "北 N", "dim-label")}<path d="M.45 .8 H2.6 m0-.12 v.24" class="dim-span"/>${text(2.6, 1.4, "东 E", "room-size")}</g>
  </svg>`;
}
