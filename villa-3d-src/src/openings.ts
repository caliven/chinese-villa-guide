/** 隔墙／外墙上的洞口（门、窗）。offset 为沿墙从 a 点起的起点。 */
export type OpeningKind = "door" | "doubleDoor" | "slidingDoor" | "window";
export type DoorHinge = "start" | "end";
export type DoorSide = "in" | "out";

export interface WallOpening {
  offset: number;
  width: number;
  kind?: OpeningKind;
  /** 铰链在门洞起点或终点；双开／推拉／窗忽略 */
  hinge?: DoorHinge;
  /** 开启侧：沿墙 a→b 的左侧为 out，右侧为 in */
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
      return 0.9;
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
