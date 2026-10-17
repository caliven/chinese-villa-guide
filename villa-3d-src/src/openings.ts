/** 隔墙／外墙上的洞口（门、窗）。offset 为沿墙从 a 点起的起点。 */
export type OpeningKind = "door" | "doubleDoor" | "slidingDoor" | "window";
export type DoorHinge = "start" | "end";
export type DoorSide = "in" | "out";

/** 单开门铰链侧到墙角（或分段端）的统一净距（米）。 */
export const DOOR_HINGE_CORNER_GAP = 0.1;

/**
 * 门洞宽度（米）＝墙上网口宽，不是门扇净宽。
 * 依据浙标／沪标下限与市面成品门主流洞口：卧室／过道约 900，厨约 800，卫约 750。
 */
export const DOOR_OPENING = {
  /** 卧室、过道、通辅楼等室内房门 */
  room: 0.9,
  /** 厨房门（平开） */
  kitchen: 0.8,
  /** 卫生间／内卫门 */
  bath: 0.75,
  /** 餐厅—厨房等隔墙推拉门洞口（双扇示意） */
  sliding: 1.5,
} as const;

/**
 * 正立面洞口（米）· 三开间都偏大气：西挑空通高、中堂屋大门、东茶室高窗。
 * 默认 13.5 m 面宽上的中心距西端；实际随主楼面宽比例缩放。
 */
export const FRONT_OPENING = {
  /** 西开间挑空客厅：通到二楼；两侧约各留 0.45 墙垛 */
  livingVoid: { at: 2.25, w: 3.6 },
  /** 中开间堂屋双开大门（一层）；二层上段玻璃同宽 */
  hall: { at: 6.9, w: 3.2 },
  /** 东开间茶室：竖向长方（高＞宽）；宽略大于 2100，洞高 2700 */
  tea: { at: 11.25, w: 2.4, sill: 0.75, h: 2.7 },
} as const;

/**
 * 一层非正立面外窗（米）· 背立面／山墙／辅楼取适中档。
 */
export const FLOOR1_WINDOW = {
  /** @deprecated 正立面改用 FRONT_OPENING；保留字段以免旧引用 */
  livingVoid: FRONT_OPENING.livingVoid,
  tea: { w: FRONT_OPENING.tea.w, sill: FRONT_OPENING.tea.sill, h: FRONT_OPENING.tea.h },
  /** 南侧房南 */
  spare: { w: 1.8, sill: 0.9, h: 1.8 },
  /** 临时餐厅南（门旁） */
  corridor: { w: 2.1, sill: 0.9, h: 1.8 },
  /** 尊亲房南 */
  elder: { w: 1.8, sill: 0.9, h: 1.8 },
  /** 楼梯间东高窗 */
  stair: { w: 1.2, sill: 1.2, h: 1.2 },
  /** 辅楼餐厅北（朝院） */
  diningNorth: { w: 2.1, sill: 0.9, h: 1.8 },
  /** 辅楼餐厅西 */
  diningWest: { w: 1.5, sill: 0.9, h: 1.8 },
  /** 辅楼厨房西（台面上方） */
  cookWest: { w: 1.5, sill: 1.0, h: 1.5 },
  /** 辅楼厨房南 */
  cookSouth: { w: 2.1, sill: 0.9, h: 1.5 },
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
  const w = Math.max(0.3, width);
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
  /** 铰链在门洞起点或终点；双开／推拉／窗忽略 */
  hinge?: DoorHinge;
  /**
   * 开启侧：沿墙 a→b 的左侧为 out，右侧为 in（内部坐标，≠口语内外开）。
   * 与用户沟通时一律用「站在门外面对这扇门，往左／往右」描述门扇叠靠侧。
   */
  side?: DoorSide;
}

export const OPENING_KINDS: OpeningKind[] = ["door", "doubleDoor", "slidingDoor", "window"];

export const openingLabels: Record<OpeningKind, string> = {
  door: "单开门",
  doubleDoor: "双开门",
  slidingDoor: "推拉门",
  window: "窗",
};

export function defaultOpeningWidth(kind: OpeningKind): number {
  switch (kind) {
    case "door":
      return DOOR_OPENING.room;
    case "doubleDoor":
      return 1.8;
    case "slidingDoor":
      return 2.0;
    case "window":
      return 1.5;
  }
}

export function normalizeOpening(raw: Partial<WallOpening> & Pick<WallOpening, "offset" | "width">): WallOpening {
  const kind = raw.kind && OPENING_KINDS.includes(raw.kind) ? raw.kind : "door";
  return {
    offset: raw.offset,
    width: raw.width,
    kind,
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

/** 平面门窗符号（墙局部坐标：X 沿墙，Y 垂直墙面向外/左）。 */
export function openingSymbolSvg(raw: WallOpening): string {
  const o = normalizeOpening(raw);
  const x0 = o.offset;
  const x1 = o.offset + o.width;
  const w = o.width;
  const gap = `<path d="M${x0} 0 h${w}" class="door-gap"/>`;

  if (o.kind === "window") {
    const mid = (x0 + x1) / 2;
    return `${gap}
      <path d="M${x0} -.08 H${x1} M${x0} .08 H${x1}" class="window"/>
      <path d="M${mid} -.12 V.12" class="window"/>
      <path d="M${x0} -.14 V.14 M${x1} -.14 V.14" class="window"/>`;
  }

  if (o.kind === "slidingDoor") {
    const half = w / 2;
    const panel = half * 0.92;
    return `${gap}
      <rect x="${x0 + 0.04}" y="-.1" width="${panel}" height=".2" class="sliding-panel"/>
      <rect x="${x1 - panel - 0.04}" y="-.1" width="${panel}" height=".2" class="sliding-panel"/>
      <path d="M${x0 + half * 0.35} 0 h${half * 0.25} m0 0 l-.08 -.06 m.08 .06 l-.08 .06" class="sliding-arrow"/>
      <path d="M${x1 - half * 0.35} 0 h${-half * 0.25} m0 0 l.08 -.06 m-.08 .06 l.08 .06" class="sliding-arrow"/>`;
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

export function openingHandlesSvg(o: WallOpening, index: number, exterior = false): string {
  const x0 = o.offset;
  const x1 = o.offset + o.width;
  const ext = exterior ? ` data-exterior="1"` : "";
  return `${openingSymbolSvg(o)}
    <rect x="${x0}" y="-.22" width="${Math.max(0.05, o.width)}" height=".44" class="edit-hit" data-edit="door" data-index="${index}"${ext}/>
    <rect x="${x0 - 0.1}" y="-.12" width=".2" height=".24" class="edit-handle" data-edit="door-handle" data-end="start" data-index="${index}"${ext}/>
    <rect x="${x1 - 0.1}" y="-.12" width=".2" height=".24" class="edit-handle" data-edit="door-handle" data-end="end" data-index="${index}"${ext}/>`;
}
