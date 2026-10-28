/** 隔墙／外墙上的洞口（门、窗）。offset 为沿墙从 a 点起的起点。 */
export type OpeningKind = "door" | "doubleDoor" | "slidingDoor" | "passage" | "window";
export type DoorHinge = "start" | "end";
export type DoorSide = "in" | "out";

/** 单开门铰链侧到墙角（或分段端）的统一净距（毫米）。 */
export const DOOR_HINGE_CORNER_GAP = 100;

/**
 * 门洞宽度（毫米）＝墙上网口宽，不是门扇净宽。
 * 依据浙标／沪标下限与市面成品门主流洞口：卧室／过道约 900，厨约 800，卫约 750。
 */
export const DOOR_OPENING = {
  /** 卧室、过道、通辅楼等室内房门 */
  room: 900,
  /** 厨房门（平开） */
  kitchen: 800,
  /** 卫生间／内卫门 */
  bath: 750,
  /** 餐厅—厨房等隔墙推拉门洞口（双扇示意） */
  sliding: 1500,
} as const;

/**
 * 正立面洞口（毫米）· 三开间都偏大气：西挑空通高、中堂屋大门、东茶室高窗。
 * 默认 13500 mm 面宽上的中心距西端；实际随主楼面宽比例缩放。
 */
export const FRONT_OPENING = {
  /** 西开间挑空客厅：通到二楼；两侧约各留 450 墙垛 */
  livingVoid: { at: 2250, w: 3600 },
  /** 中开间堂屋双开大门（一层）；二层上段玻璃同宽 */
  hall: { at: 6750, w: 3200 },
  /** 东开间茶室：竖向长方（高＞宽）；宽略大于 2100，洞高 2700 */
  tea: { at: 11250, w: 2400, sill: 750, h: 2700 },
} as const;

/**
 * 一层非正立面外窗（毫米）· 背立面／山墙／辅楼取适中档。
 */
export const FLOOR1_WINDOW = {
  /** @deprecated 正立面改用 FRONT_OPENING；保留字段以免旧引用 */
  livingVoid: FRONT_OPENING.livingVoid,
  tea: { w: FRONT_OPENING.tea.w, sill: FRONT_OPENING.tea.sill, h: FRONT_OPENING.tea.h },
  /** 南侧房南 */
  spare: { w: 1800, sill: 900, h: 1800 },
  /** 临时餐厅南（门旁） */
  corridor: { w: 2100, sill: 900, h: 1800 },
  /** 尊亲房南 */
  elder: { w: 1800, sill: 900, h: 1800 },
  /** 楼梯间东高窗 */
  stair: { w: 1200, sill: 1200, h: 1200 },
  /** 辅楼餐厅北（朝院） */
  diningNorth: { w: 2100, sill: 900, h: 1800 },
  /** 辅楼餐厅西 */
  diningWest: { w: 1500, sill: 900, h: 1800 },
  /** 辅楼厨房西（台面上方） */
  cookWest: { w: 1500, sill: 1000, h: 1500 },
  /** 辅楼厨房南 */
  cookSouth: { w: 2100, sill: 900, h: 1500 },
} as const;

/**
 * 按铰链侧贴墙角摆门：返回沿墙 offset（洞口起点）。
 * hinge=start → 贴 a 端；hinge=end → 贴 b 端。
 */
export function doorOffsetAgainstHinge(
  wallLen: number,
  width: number,
  hinge: DoorHinge,
  gap = DOOR_HINGE_CORNER_GAP,
): number {
  const w = Math.max(300, width);
  const g = Math.max(0, gap);
  const maxStart = Math.max(g, wallLen - w - g);
  if (hinge === "end") return maxStart;
  return Math.min(g, maxStart);
}

/** 立面用：洞口中心沿墙定位（分段起点 + offset + 半宽）。 */
export function doorCenterAgainstHinge(
  segStart: number,
  segLen: number,
  width: number,
  hinge: DoorHinge,
  gap = DOOR_HINGE_CORNER_GAP,
): number {
  return segStart + doorOffsetAgainstHinge(segLen, width, hinge, gap) + width / 2;
}

export interface WallOpening {
  offset: number;
  width: number;
  kind?: OpeningKind;
  /** 窗洞高度；缺省沿用原规格。通高窗在下层洞口保存整窗高度。 */
  height?: number;
  /** 窗台距所属层完成地面的高度；缺省沿用原规格。 */
  sill?: number;
  /** 铰链在门洞起点或终点；双开／推拉／窗忽略 */
  hinge?: DoorHinge;
  /**
   * 开启侧：沿墙 a→b 的左侧为 out，右侧为 in（内部坐标，≠口语内外开）。
   * 与用户沟通时一律用「站在门外面对这扇门，往左／往右」描述门扇叠靠侧。
   */
  side?: DoorSide;
}

export const OPENING_KINDS: OpeningKind[] = ["door", "doubleDoor", "slidingDoor", "passage", "window"];

export const openingLabels: Record<OpeningKind, string> = {
  door: "单开门",
  doubleDoor: "双开门",
  slidingDoor: "推拉门",
  passage: "门洞（无门）",
  window: "窗",
};

export function defaultOpeningWidth(kind: OpeningKind): number {
  switch (kind) {
    case "door":
      return DOOR_OPENING.room;
    case "doubleDoor":
      return 1800;
    case "slidingDoor":
      return 2000;
    case "passage":
      return 1200;
    case "window":
      return 1500;
  }
}

export function normalizeOpening(raw: Partial<WallOpening> & Pick<WallOpening, "offset" | "width">): WallOpening {
  const kind = raw.kind && OPENING_KINDS.includes(raw.kind) ? raw.kind : "door";
  return {
    offset: raw.offset,
    width: raw.width,
    kind,
    ...(kind === "window" && Number.isFinite(raw.height) && raw.height! >= 200 ? { height: Math.round(raw.height!) } : {}),
    ...(kind === "window" && Number.isFinite(raw.sill) && raw.sill! >= 0 ? { sill: Math.round(raw.sill!) } : {}),
    hinge: raw.hinge === "end" ? "end" : "start",
    side: raw.side === "in" ? "in" : "out",
  };
}

export function createOpening(kind: OpeningKind, offset: number, width?: number): WallOpening {
  return normalizeOpening({
    kind,
    offset,
    width: width ?? defaultOpeningWidth(kind),
    hinge: "start",
    side: "out",
  });
}

/** 室内洞口相对本层完成面的统一标高；剖切只改变显示，不改变这份实体规格。 */
export function interiorOpeningProfile(raw: WallOpening, wallHeight: number) {
  const opening = normalizeOpening(raw), window = opening.kind === "window";
  const defaultSill = window ? 900 : 0;
  const sill = window && opening.sill != null ? Math.min(opening.sill, Math.max(0, wallHeight - 280)) : defaultSill;
  return { ...opening, sill, height: Math.max(0, Math.min(window ? opening.height ?? 1500 : 2200, wallHeight - sill - 80)), door: !window };
}

/** 平面门窗符号（墙局部坐标：X 沿墙，Y 垂直墙面向外/左）。 */
export function openingSymbolSvg(raw: WallOpening, wallThick = 240): string {
  const o = normalizeOpening(raw);
  const x0 = o.offset;
  const x1 = o.offset + o.width;
  const w = o.width;
  // gap 须略宽于墙线，才能盖住线端圆头；墙线已按洞口断开时仍保留底板色。
  const gap = `<path d="M${x0} 0 h${w}" class="door-gap" stroke-width="${wallThick + 40}"/>`;

  if (o.kind === "passage") return gap;

  if (o.kind === "window") {
    const mid = (x0 + x1) / 2;
    const half = wallThick / 2, stroke = Math.min(40, wallThick / 4);
    return `${gap}
      <g stroke-width="${stroke}" class="window-symbol">
      <path d="M${x0 + stroke / 2} ${-half + stroke / 2} H${x1 - stroke / 2} M${x0 + stroke / 2} ${half - stroke / 2} H${x1 - stroke / 2}" class="window" style="stroke-width:inherit"/>
      <path d="M${mid} ${-half + stroke / 2} V${half - stroke / 2}" class="window" style="stroke-width:inherit"/>
      <path d="M${x0 + stroke / 2} ${-half + stroke / 2} V${half - stroke / 2} M${x1 - stroke / 2} ${-half + stroke / 2} V${half - stroke / 2}" class="window" style="stroke-width:inherit"/></g>`;
  }

  if (o.kind === "slidingDoor") {
    const half = w / 2;
    const panel = half * 0.92;
    const depth = Math.min(60, wallThick - 30);
    return `${gap}
      <rect x="${x0 + 40}" y="${-depth / 2}" width="${panel}" height="${depth}" class="sliding-panel"/>
      <rect x="${x1 - panel - 40}" y="${-depth / 2}" width="${panel}" height="${depth}" class="sliding-panel"/>
      <path d="M${x0 + half * 0.35} 0 h${half * 0.25} m0 0 l-80 -60 m80 60 l-80 60" class="sliding-arrow"/>
      <path d="M${x1 - half * 0.35} 0 h${-half * 0.25} m0 0 l80 -60 m-80 60 l80 60" class="sliding-arrow"/>`;
  }

  const s = o.side === "in" ? -1 : 1;
  const sweepOut = s > 0 ? 0 : 1;
  const sweepIn = s > 0 ? 1 : 0;

  if (o.kind === "doubleDoor") {
    const mid = x0 + w / 2;
    const hw = w / 2;
    return `${gap}
      <path d="M${x0} 0 v${s * hw} A${hw} ${hw} 0 0 ${sweepOut} ${mid} 0" class="door-swing"/>
      <path d="M${x1} 0 v${s * hw} A${hw} ${hw} 0 0 ${sweepIn} ${mid} 0" class="door-swing"/>
      <path d="M${x0} 0 L${x0} ${s * hw}" class="door-leaf"/>
      <path d="M${x1} 0 L${x1} ${s * hw}" class="door-leaf"/>`;
  }

  // 单开门
  if (o.hinge === "end") {
    return `${gap}
      <path d="M${x1} 0 v${s * w} A${w} ${w} 0 0 ${sweepIn} ${x0} 0" class="door-swing"/>
      <path d="M${x1} 0 L${x1} ${s * w}" class="door-leaf"/>`;
  }
  return `${gap}
    <path d="M${x0} 0 v${s * w} A${w} ${w} 0 0 ${sweepOut} ${x1} 0" class="door-swing"/>
    <path d="M${x0} 0 L${x0} ${s * w}" class="door-leaf"/>`;
}

/**
 * 可编辑门窗：命中条贴着墙缝／窗线（约 ±100 mm），不包外围空白。
 * 两端缩放手柄仅在选中时出现，避免点旁边空白误选。
 */
export function openingHandlesSvg(
  o: WallOpening,
  index: number,
  exterior = false,
  selected = false,
  wallThick = 240,
): string {
  const x0 = o.offset;
  const x1 = o.offset + o.width;
  const ext = exterior ? ` data-exterior="1"` : "";
  // 贴着 door-gap 与窗线外端（±140）；比旧 ±0.22 窄一截，少点空。
  const hit = `<rect x="${x0}" y="-120" width="${Math.max(50, o.width)}" height="240" class="edit-hit" data-edit="door" data-index="${index}"${ext}/>`;
  const handles = selected
    ? `<rect x="${x0 - 100}" y="-120" width="200" height="240" class="edit-handle" data-edit="door-handle" data-end="start" data-index="${index}"${ext}/>
    <rect x="${x1 - 100}" y="-120" width="200" height="240" class="edit-handle" data-edit="door-handle" data-end="end" data-index="${index}"${ext}/>`
    : "";
  return `${openingSymbolSvg(o, wallThick)}${hit}${handles}`;
}
