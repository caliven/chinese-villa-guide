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
  neighborCourtyardPlan,
  type Floor,
  type Room,
  type Wall,
  type Furniture,
} from "./data";
import { contourAt } from "./contours";
import { facades, type Facade } from "./facades";
import { roomReference } from "./design-data";
import type { LayoutDraft, StairDraft, PorticoDraft, VoidDraft, ExteriorOpeningDraft } from "./layout-draft";
import { bedLayout, furnitureLocalBounds } from "./furniture-catalog";
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
const text = (x: number, y: number, content: string, cls = "room-name") =>
  `<text x="${x}" y="${y}" class="${cls}" text-anchor="middle">${content}</text>`;
const rect = (x: number, z: number, w: number, d: number, attrs = "") =>
  `<rect x="${x}" y="${z}" width="${w}" height="${d}" ${attrs}/>`;

/** 平面白底与视口：北向为门厅与多层面宽标线留空，四周比主体再放大一圈。 */
function planFrame(index: number) {
  if (index === 0) {
    return {
      viewBox: "-3.6 -8.6 29.0 24.2",
      board: { x: -3.3, z: -8.3, w: 28.4, h: 23.6 },
    };
  }
  return {
    viewBox: "3.2 -8.0 20.8 23.2",
    board: { x: 3.5, z: -7.7, w: 20.2, h: 22.6 },
  };
}

const dimN = (n: number) => Number(n.toFixed(3));

/** 水平面宽／总宽尺寸线（Z 向上为北；labelSide 决定文字在标线北侧或南侧）。 */
function hDim(x0: number, x1: number, z: number, label: string, labelSide: "north" | "south" = "north") {
  const mid = dimN((x0 + x1) / 2);
  const z0 = dimN(z);
  const ly = dimN(labelSide === "north" ? z - 0.4 : z + 0.48);
  return `<path d="M${dimN(x0)} ${z0} H${dimN(x1)} M${dimN(x0)} ${dimN(z - 0.28)} V${dimN(z + 0.28)} M${dimN(x1)} ${dimN(z - 0.28)} V${dimN(z + 0.28)}" class="dim-line"/>${text(mid, ly, label, "dim-label")}`;
}

/** 竖直进深尺寸线；side 决定标注在东或西（旋转方向与原东／西侧标注一致）。 */
function vDim(z0: number, z1: number, x: number, label: string, side: "east" | "west" = "east") {
  const mid = dimN((z0 + z1) / 2);
  const xx = dimN(x);
  const lx = dimN(side === "east" ? x + 0.32 : x - 0.32);
  const rot = side === "east" ? 90 : -90;
  return `<path d="M${xx} ${dimN(z0)} V${dimN(z1)} M${dimN(x - 0.28)} ${dimN(z0)} h.56 M${dimN(x - 0.28)} ${dimN(z1)} h.56" class="dim-line"/><text class="dim-label" x="${lx}" y="${mid}" text-anchor="middle" transform="rotate(${rot} ${lx} ${mid})">${label}</text>`;
}

/**
 * 标准户型图四边尺寸：北／南为面宽（一层另加辅楼与总宽），东／西为进深。
 * 北侧标线抬到门厅台阶以北，避免被门厅投影遮挡。
 */
function planOuterDimensions(
  index: number,
  floorHeight: number,
  front: number,
  depth: number,
  northClear: number,
) {
  const main = site.main;
  const annex = site.annex;
  const south = front + depth;
  const gap = 0.55;
  // 由近到远：靠建筑 → 总宽在最外侧
  const n0 = northClear - 0.75;
  const n1 = n0 - gap;
  const n2 = n1 - gap;
  const s0 = south + 0.75;
  const s1 = s0 + gap;
  const s2 = s1 + gap;
  const heightNote = text(
    index === 0 ? site.width + 0.05 : main.x + main.w + 0.05,
    n0 - 0.08,
    `层高 ${floorHeight.toFixed(1)} m`,
    "dim-label",
  );

  if (index === 0) {
    const eastGap = site.width - main.x - main.w;
    return [
      // 北：辅楼 → 主楼 → 总宽
      hDim(annex.x, annex.x + annex.w, n0, `辅楼面宽 ${annex.w.toFixed(1)} m`),
      hDim(main.x, main.x + main.w, n1, `主楼面宽 ${main.w.toFixed(1)} m`),
      hDim(0, site.width, n2, `东西总宽 ${site.width.toFixed(1)} m`),
      heightNote,
      // 南：同样三根面宽（文字在标线以南）
      hDim(annex.x, annex.x + annex.w, s0, `辅楼面宽 ${annex.w.toFixed(1)} m`, "south"),
      hDim(main.x, main.x + main.w, s1, `主楼面宽 ${main.w.toFixed(1)} m`, "south"),
      hDim(0, site.width, s2, `东西总宽 ${site.width.toFixed(1)} m`, "south"),
      // 西／东：进深；两侧过道净宽贴在建筑前墙外；辅楼相对主楼前墙内退
      vDim(annex.z, annex.z + annex.d, -0.75, `辅楼进深 ${annex.d.toFixed(1)} m`, "west"),
      vDim(front, annex.z, -1.9, `内退 ${(annex.z - front).toFixed(1)} m`, "west"),
      vDim(front, south, site.width + 0.55, `主楼进深 ${depth.toFixed(1)} m`, "east"),
      hDim(0, site.sideGap, front - 0.42, `西侧 ${site.sideGap.toFixed(1)} m`),
      hDim(main.x + main.w, site.width, front - 0.42, `东侧 ${eastGap.toFixed(1)} m`),
    ].join("");
  }

  return [
    hDim(main.x, main.x + main.w, n0, `主楼面宽 ${main.w.toFixed(1)} m`),
    heightNote,
    hDim(main.x, main.x + main.w, s0, `主楼面宽 ${main.w.toFixed(1)} m`, "south"),
    vDim(front, south, main.x - 0.55, `进深 ${depth.toFixed(1)} m`, "west"),
    vDim(front, south, main.x + main.w + 0.55, `进深 ${depth.toFixed(1)} m`, "east"),
  ].join("");
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
) {
  const angle = (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI,
    len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  const thick = construction.partition;
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
  return `<g transform="translate(${p.a[0]} ${p.a[1]}) rotate(${angle})" data-wall="${index}">${hit}<path d="M0 0 H${len}" class="partition" stroke-width="${thick}"/>${opening}${wallSel}</g>${widthMark}`;
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
        .map(
          (o) =>
            `<path d="M${o.at - o.w / 2} 0 h${o.w}" class="door-gap" stroke-width="${thick + 0.02}"/>${
              o.open
                ? ""
                : `<path d="M${o.at - o.w / 2} -.07 h${o.w} M${o.at - o.w / 2} .07 h${o.w}" class="window ${o.door ? "entry-door" : ""}"/>`
            }`,
        )
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
  return `<g transform="translate(${p.a[0]} ${p.a[1]}) rotate(${angle})" data-facade="${facadeIndex}">${hit}<path d="M0 0 H${len}" class="outside-wall" stroke-width="${thick}"/>${published}${extras}</g>${widthMark}`;
}
/** pick：写在真实绘制图形上，空白／外包矩形不能点选。 */
function furnitureSymbol(f: Furniture, pick = "") {
  const cls = `furniture ${f.kind}`;
  const a = (classes: string, extra = "") => `${extra} class="${classes}"${pick}`.trim();
  if (f.kind === "roundTable") {
    return `<circle cx="0" cy="0" r="${f.w / 2}" ${a(cls)}/><circle r="${Math.min(0.58, f.w * 0.28)}" ${a("furniture")}/>`;
  }
  if (f.kind === "bed") {
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
    return `${mattress}${pillow}${night}`;
  }
  if (f.kind === "tv") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".04"'))}${rect(-f.w / 2 + 0.06, -f.d / 2 + 0.04, f.w - 0.12, f.d * 0.35, a("furniture tv-screen"))}`;
  }
  if (f.kind === "sofa") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".08"'))}${rect(-f.w / 2, -f.d / 2, 0.14, f.d, a("furniture sofa-arm", 'rx=".04"'))}${rect(-f.w / 2, f.d / 2 - 0.16, f.w, 0.16, a("furniture sofa-back", 'rx=".04"'))}`;
  }
  if (f.kind === "toilet") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d * 0.55, a(cls, 'rx=".08"'))}${rect(-f.w / 2, -f.d / 2 + f.d * 0.5, f.w, f.d * 0.5, a(cls, 'rx=".04"'))}`;
  }
  if (f.kind === "squatToilet") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".05"'))}<ellipse cx="0" cy="0" rx="${f.w * 0.22}" ry="${f.d * 0.32}" ${a("furniture squat-hole")}/>`;
  }
  if (f.kind === "basin") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".05"'))}<ellipse cx="0" cy="0" rx="${f.w * 0.32}" ry="${f.d * 0.28}" ${a("furniture basin-bowl")}/>`;
  }
  if (f.kind === "chair") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d * 0.62, a(cls, 'rx=".05"'))}${rect(-f.w / 2, f.d / 2 - 0.08, f.w, 0.08, a(cls))}`;
  }
  if (f.kind === "dressingTable") {
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".05"'))}${rect(-f.w / 2 + 0.08, -f.d / 2, f.w - 0.16, 0.06, a("furniture mirror-base"))}`;
  }
  if (f.kind === "shrine") {
    // 湖南堂屋神龛：贴墙柜体 + 三层龛台示意（靠后墙一侧）。
    const shelf = [-0.28, 0, 0.28]
      .map((t) => rect(-f.w / 2 + 0.1, t * f.d * 0.55 - 0.04, f.w - 0.2, 0.08, a("furniture shrine-shelf")))
      .join("");
    return `${rect(-f.w / 2, -f.d / 2, f.w, f.d, a(cls, 'rx=".04"'))}${shelf}${rect(-f.w / 2 + 0.06, -f.d / 2, f.w - 0.12, 0.06, a("furniture shrine-back"))}`;
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
  const caption = f.label ? text(f.x, f.z + 0.06, f.label, "furniture-label") : "";
  return `<g class="furniture-root" transform="translate(${f.x} ${f.z}) rotate(${(-(f.rotation ?? 0) * 180) / Math.PI})" data-furniture="${index}">${furnitureSymbol(f, pick)}${outline}${handles}</g>${caption}`;
}
function room(r: Room, editable: boolean) {
  const hit = editable ? ` data-edit="room" data-id="${r.id}"` : "";
  return `<g tabindex="0" role="button" data-room="${r.id}" aria-label="${r.name}，${r.note ?? "点击查看空间说明"}"${hit}>${rect(r.x + 0.08, r.z + 0.08, r.w - 0.16, r.d - 0.16, `fill="${colors[r.kind]}" class="room-fill"`)}</g>`;
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
  /** 多选高亮（含主选）。 */
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

function porticoPosts(porch: PorticoDraft) {
  return [
    { x: porch.x + 0.38, w: 0.8 },
    { x: porch.x + porch.w - 0.38, w: 0.8 },
  ];
}

export function floorPlan(index: number, clearance: boolean, balcony: boolean, options: PlanOptions = {}, source?: PlanSource) {
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
  const labels = allRooms
    .map((r) => {
      const [x, z] = r.label ?? [r.x + r.w / 2, r.z + r.d / 2];
      const ref = roomReference(r, index);
      return `<g class="room-label" pointer-events="none">${text(x, z - 0.05, r.name)}${text(x, z + 0.37, r.kind === "void" ? "两层通高 · 无楼板" : `${r.w.toFixed(1)} × ${r.d.toFixed(1)} m`, "room-size")}${options.inside && r.kind !== "void" ? text(x, z + .67, `内侧约${ref.w.toFixed(2)}×${ref.d.toFixed(2)}${ref.nested.length ? " · 含套内空间" : ""}`, "inside-label") : ""}</g>`;
    })
    .join("");
  const stair = src.stair;
  const stepLines = Array.from({ length: 9 }, (_, i) => {
    const sx = stair.x, sz = stair.z, flight = stair.flight, gap = stair.gap;
    return stair.axis === "x"
      ? `<path d="M${sx + i * stair.tread} ${sz} v${flight} M${sx + (8 - i) * stair.tread} ${sz + flight + gap} v${flight}" class="step-line"/>`
      : `<path d="M${sx} ${sz + i * stair.tread} h${flight} M${sx + flight + gap} ${sz + (8 - i) * stair.tread} h${flight}" class="step-line"/>`;
  }).join("");
  const columnNorth = elevation.porticoColumnZ - elevation.porticoColumnDepth / 2;
  const landingFront = columnNorth - construction.entranceLandingOffset;
  const tread = construction.entranceTread;
  const stepFront = landingFront - tread * 2;
  const westOuter = middleWest.x - middleWest.w / 2;
  const westInner = middleWest.x + middleWest.w / 2;
  const eastInner = middleEast.x - middleEast.w / 2;
  const eastOuter = middleEast.x + middleEast.w / 2;
  const rampRun = construction.entranceRampRun;
  const eastEnd = eastOuter + rampRun;
  const westEnd = westOuter - rampRun;
  const stone = `fill="#3a2422" stroke="#241614" stroke-width=".02"`;
  const grooves = (x0: number, x1: number) => {
    const dir = Math.sign(x1 - x0);
    let marks = "";
    for (let traveled = 0.28; traveled < rampRun - 0.18; traveled += 0.3)
      marks += `<path d="M${x0 + dir * traveled} ${columnNorth - 0.08} V${site.main.z + 0.08}" stroke="#5a4038" stroke-width=".016"/>`;
    return marks;
  };
  const approach = index === 0
    ? `<rect x="${westInner}" y="${stepFront}" width="${eastInner - westInner}" height="${landingFront - stepFront}" fill="#3a2422"/>
      <rect x="${westOuter}" y="${stepFront}" width="${westInner - westOuter}" height="${landingFront - stepFront}" fill="#3a2422"/>
      <rect x="${eastInner}" y="${stepFront}" width="${eastOuter - eastInner}" height="${landingFront - stepFront}" fill="#3a2422"/>
      <path d="M${westInner} ${landingFront - tread} H${eastInner} M${westInner} ${stepFront} H${eastInner}" class="step-line"/>
      <path d="M${eastOuter} ${columnNorth} H${eastEnd} V${site.main.z} H${eastOuter} Z" ${stone}/>
      <path d="M${westEnd} ${columnNorth} H${westOuter} V${site.main.z} H${westEnd} Z" ${stone}/>
      ${grooves(eastOuter, eastEnd)}${grooves(westOuter, westEnd)}
      ${text((westInner + eastInner) / 2, stepFront - 0.28, "柱间三步", "room-size")}
      ${text((eastOuter + eastEnd) / 2, columnNorth - 0.32, "朝东", "room-size")}
      ${text((westOuter + westEnd) / 2, columnNorth - 0.32, "朝西", "room-size")}`
    : "";
  const diningFurniture = src.annexFurniture.filter((item) => options.dining !== "daily" || !(item.kind === "roundTable" || (item.kind === "chair" && Math.hypot(item.x - 2.9, item.z - 1.12) < 1.6)));
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
  if (selected?.kind === "furniture" && selected.index != null) selectedFurniture.add(selected.index);
  const selectedRooms = new Set(options.selectedRooms ?? []);
  if (selected?.kind === "room" && selected.id) selectedRooms.add(selected.id);
  const selectedDoorIndex =
    selected?.kind === "door" && !selected.exterior ? selected.index : undefined;
  const selectedWallIndex =
    selected?.kind === "wall" ? { index: selected.index, annex: !!selected.annex } : null;
  const selectedExteriorIndex =
    selected?.kind === "door" && selected.exterior ? selected.index ?? null : null;
  const roomSelections = editable
    ? [...selectedRooms]
        .map((id) => {
          const r = allRooms.find((room) => room.id === id);
          if (!r) return "";
          const primary = selected?.kind === "room" && selected.id === id;
          const handles = primary
            ? [["nw", r.x, r.z], ["ne", r.x + r.w, r.z], ["sw", r.x, r.z + r.d], ["se", r.x + r.w, r.z + r.d]]
                .map(([c, x, z]) => `<rect x="${Number(x) - 0.12}" y="${Number(z) - 0.12}" width=".24" height=".24" class="edit-handle" data-edit="room-handle" data-corner="${c}" data-id="${r.id}"/>`)
                .join("")
            : "";
          return `${rect(r.x, r.z, r.w, r.d, 'class="edit-selection" fill="none"')}${handles}`;
        })
        .join("")
    : "";
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
  const bodyDepth = index === 2 ? site.main.d - site.setback : site.main.d;
  const northClear =
    index === 0
      ? Math.min(porchFront, stepFront, columnNorth)
      : index === 2
        ? Math.min(elevation.centerFront, elevation.terraceFront, porchY)
        : Math.min(porchFront, columnNorth);
  const southDimOuter = f.front + bodyDepth + 0.75 + (index === 0 ? 1.1 : 0);
  const noteZ = southDimOuter + 1.15;
  const compassZ = southDimOuter + 1.35;
  const footnoteZ = southDimOuter + 2.15;
  return `<svg class="floor-svg ${index > 0 ? "main-floor-svg" : ""} ${editable ? "editing" : ""}" xmlns="http://www.w3.org/2000/svg" viewBox="${frame.viewBox}" aria-label="${f.name}户型平面图，北向上，东向右${options.dining === "daily" ? "，餐厅日常6座建议情景" : ""}${editable ? "，编辑模式" : ""}">
    ${s}<rect x="${frame.board.x}" y="${frame.board.z}" width="${frame.board.w}" height="${frame.board.h}" rx=".2" fill="#fbfaf6"/>
    ${planOuterDimensions(index, f.height, f.front, bodyDepth, northClear)}
    ${index === 2 ? `${elevation.sideTerraces.map(t => rect(t.x, elevation.terraceFront, t.w, elevation.terraceBack - elevation.terraceFront, 'fill="#e9e2d4" stroke="#b4b6a9" stroke-width=".06"')).join("")}${text(8.85, -0.2, "西侧露台", "dim-label")}${text(18.4, -0.2, "东侧露台", "dim-label")}` : ""}
    ${porticoHit}${rect(porch.x, porchY, porch.w, porchH, `fill="${index === 1 ? "url(#void)" : "#e9e2d4"}" stroke="#b4b6a9" stroke-width=".06"`)}
    ${text(porch.x + porch.w / 2, -1.95, index === 2 ? "中央露台 · 前方敞开" : index === 1 ? "门厅上空 · 无楼板" : `门厅 ${porch.w.toFixed(1)}×${porch.projection.toFixed(1)} m · 另计`, "dim-label")}
    ${approach}
    ${index < 2 ? `${posts.map(p => rect(p.x - p.w / 2, elevation.porticoColumnZ - elevation.porticoColumnDepth / 2, p.w, elevation.porticoColumnDepth, 'fill="#879183"')).join("")}${cornerColumn(elevation.cornerWestX, f.front - 0.12, -1)}${cornerColumn(elevation.cornerEastX, f.front - 0.12, 1)}` : `${terraceRails}${elevation.balustradePosts.map(p => rect(p.x - p.w / 2, p.z - p.w / 2, p.w, p.w, 'fill="#c3bba9" stroke="#777872" stroke-width=".04"')).join("")}${posts.map(p => rect(p.x - elevation.dividerWidth / 2, elevation.postZ - .25, elevation.dividerWidth, .5, 'fill="#879183"')).join("")}${text(13.7, -0.48, "内退柱墙隔开两侧 · 官帽柱贴前墙构造柱", "room-size")}`}${cornerColumn(site.main.x, site.main.z + site.main.d, -1, 1)}${cornerColumn(site.main.x + site.main.w, site.main.z + site.main.d, 1, 1)}
    ${index === 0 ? (() => {
      const yardZ = contourAt(courtyardFront, 3);
      const pathD = site.annex.z - yardZ;
      return rect(.18, yardZ, 5.12, pathD, 'fill="none" stroke="#a9b9a1" stroke-width=".04" stroke-dasharray=".14 .12"')
        + text(3, (yardZ + site.annex.z) / 2, `辅楼前约${pathD.toFixed(1)}m · 内退1m`, "room-size")
        + hDim(site.annex.x, site.annex.x + 1.2, site.main.z - 0.35, "内退 1.0 m");
    })() : ""}
    ${allRooms.map((r) => room(r, editable)).join("")}
    ${options.useZones ? allFurniture.map(useZone).join("") : ""}
    ${stairHit}${stepLines}
    ${f.partitions.map((p, i) => partition(p, i, editable, selectedDoorIndex === i && !selected?.annex, !!selectedWallIndex && !selectedWallIndex.annex && selectedWallIndex.index === i, showWallWidth)).join("")}
    ${facades(index).map((p, fi) => facade(p, fi, index, editable, src.exteriorOpenings, selectedExteriorIndex, src.exteriorManaged, showWallWidth)).join("")}
    ${index === 0
      ? src.annexPartitions.map((p, i) => partition(p, 1000 + i, editable, selectedDoorIndex === i && !!selected?.annex, !!selectedWallIndex && selectedWallIndex.annex && selectedWallIndex.index === i, showWallWidth)).join("")
        + facades(3).map((p, fi) => facade(p, fi, 3, editable, src.exteriorOpenings, selectedExteriorIndex, src.exteriorManaged, showWallWidth)).join("")
      : ""}
    ${showWallWidth ? text(index === 0 ? 3.2 : 8.2, northClear - 3.35, `墙厚标注 · 外墙${Math.round(construction.outsideWall * 1000)}／隔墙${Math.round(construction.partition * 1000)}（毫米 · 示意）`, "wall-thick-legend") : ""}
    ${index === 1 ? `<path d="M${src.livingVoid.x + src.livingVoid.w} ${src.livingVoid.z + 0.16} V${src.livingVoid.z + src.livingVoid.d} H${src.livingVoid.x + 0.16}" class="balustrade"/>` : ""}
    ${index === 0 ? `<path d="M${site.annex.x + site.annex.w} ${src.sideDoorZ - src.sideDoorWidth / 2} H${site.main.x} M${site.annex.x + site.annex.w} ${src.sideDoorZ + src.sideDoorWidth / 2} H${site.main.x}" class="dim-line"/>${text(laneLabelX, src.sideDoorZ, "通辅楼", "room-size")}` : ""}
    ${index === 0 && clearance ? `${options.dining !== "daily" ? '<circle cx="2.9" cy="1.12" r="1.85" class="clearance"/>' : text(2.9, 1.6, "日常示意：圆桌收起 · 收纳待定", "room-size")}<rect x="1.09" y="2.89" width="3.72" height="2.42" class="clearance"/>` : ""}
    ${balcony && index === 2 ? rect(12.65, site.main.z + site.main.d, 2.5, 1.2, 'class="clearance"') + text(13.9, site.main.z + site.main.d + 0.7, "局部浅阳台", "room-size") : ""}
    ${selection}
    ${/* 家具画在墙／房间之上，避免点选被房间或隔墙热区抢走 */ ""}
    ${floorFurniture.map((item, i) => furniture(item, i, editable, selectedFurniture.has(i), selected?.kind === "furniture" && selected.index === i)).join("")}
    ${index === 0 ? diningFurniture.map((item) => furniture(item, -1, false)).join("") : ""}
    ${labels}${index === 0 ? `<text x="${laneLabelX}" y="${laneLabelZ}" class="dim-label" text-anchor="middle" transform="rotate(-90 ${laneLabelX} ${laneLabelZ})">子孙道 · ${site.lane.toFixed(1)} m</text>` : ""}
    ${text(13.55, noteZ, `南侧高田 +2.5 m · 屋后留 ${site.rearGap} m`, "dim-label")}
    <g transform="translate(${index === 0 ? ".5" : "6.5"} ${compassZ})"><path d="M0 .8 V-.55 m-.15 .25 .15-.25 .15 .25" class="dim-line"/>${text(0, -0.85, "北 N", "dim-label")}<path d="M.45 .8 H2.6 m0-.12 v.24" class="dim-line"/>${text(2.6, 1.4, "东 E", "room-size")}</g>
    ${text(13.1, footnoteZ, editable ? "编辑 · Shift多选 · 方向键微调 · 0.1m吸附 · 北向上" : "主数字为外轮廓 · 内侧约值未扣装修柱及套内占用 · 北向上", "footnote")}
    ${index === 0 ? text(site.width / 2, footnoteZ + 0.4, "地库柱：外沿一排、房前墙下一排，柱距4.2m，见地库视图", "footnote") : ""}
    ${options.drawGuide ? renderDrawGuide(options.drawGuide) : ""}
    ${options.alignGuide ? renderAlignGuide(options.alignGuide) : ""}
  </svg>`;
}

export function diningClearance() {
  const wallX = site.annex.x + 0.24,
    wallZ = site.annex.z + 0.24;
  const radius = 1.85;
  return {
    west: 2.9 - radius - wallX,
    north: 1.12 - radius - wallZ,
    east: site.annex.x + site.annex.w - 0.24 - 2.9 - radius,
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
  const midFront = frontAt(10);
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
    yardVDim(midFront, siteRear, 10, 11.35, `中总进深 ${meters(totalMid)}`, {
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
