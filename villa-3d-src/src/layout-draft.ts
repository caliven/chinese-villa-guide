import {
  floors,
  site,
  stairLayout,
  circulation,
  annexRooms,
  annexPartitions,
  annexFurniture,
  construction,
  isPhysicalWall,
  wallRoleOf,
  type Floor,
  type Room,
  type Wall,
  type Furniture,
  type Point,
} from "./data";
import { FURNITURE_KINDS, normalizeRotation } from "./furniture-catalog";
import { OPENING_KINDS, normalizeOpening, createOpening, type WallOpening, type OpeningKind } from "./openings";
import {
  facades,
  defaultWindowMaxRatio,
  type Opening as FacadeOpening,
} from "./facades";
import { projectMeta } from "./project-meta";
import { snapMm } from "./units";

export const layoutDraftKey = "anhua-villa-layout-draft-v1";
export const layoutDraftSchema = 1 as const;

export type StairDraft = {
  room: { x: number; z: number; w: number; d: number };
  x: number;
  z: number;
  flight: number;
  gap: number;
  risers: number;
  tread: number;
  landing: number;
  axis: "x" | "z";
  /** 跨向起步侧；缺省：南北向图左／东侧，东西向北侧。 */
  lowerSide?: "min" | "max";
  hole: { x: number; z: number; w: number; d: number };
};

export type PorticoDraft = { x: number; w: number; projection: number };
export type VoidDraft = { x: number; z: number; w: number; d: number };

/** 外墙上的门窗草稿（floor 3 = 辅楼立面）。managed 后即完整列表，含原方案洞口。 */
export type ExteriorOpeningDraft = {
  floor: number;
  facadeIndex: number;
  opening: WallOpening;
};

/** 草稿所依据的主／辅楼外包络；改方案尺寸时相对此包络轴向缩放，避免叠乘。 */
export type LayoutEnvelope = {
  mainX: number;
  mainZ: number;
  mainW: number;
  mainD: number;
  annexX: number;
  annexZ: number;
  annexW: number;
  annexD: number;
};

export interface LayoutDraft {
  schema: typeof layoutDraftSchema;
  revision: string;
  updatedAt: string;
  note: string;
  floors: Floor[];
  annexRooms: Room[];
  annexPartitions: Wall[];
  annexFurniture: Furniture[];
  stairLayout: StairDraft;
  portico: PorticoDraft;
  livingVoid: VoidDraft;
  sideDoorZ: number;
  sideDoorWidth: number;
  exteriorOpenings: ExteriorOpeningDraft[];
  /** true：平面只画 exteriorOpenings，不再叠画 facades.ts 静态洞口。 */
  exteriorManaged: boolean;
  /** 缩放用外包络；缺省时用历史锚点做一次性迁移，见 scaleLayoutDraftToEnvelope。 */
  envelope?: LayoutEnvelope;
}

/** 把立面 Opening（中心定位）转成平面 WallOpening（起点＋宽）。 */
export function facadeOpeningToWallOpening(o: FacadeOpening): WallOpening {
  let kind: OpeningKind = "window";
  if (o.door) {
    if (o.pattern === "sliding" || o.glazed) kind = "slidingDoor";
    else if (o.double) kind = "doubleDoor";
    else if (o.open) kind = "door";
    else kind = o.hinge || o.side ? "door" : "doubleDoor";
  }
  const opening = createOpening(kind, o.at - o.w / 2, o.w);
  if (o.hinge === "start" || o.hinge === "end") opening.hinge = o.hinge;
  if (o.side === "in" || o.side === "out") opening.side = o.side;
  return opening;
}

/** 从当前方案立面收集全部外墙门窗，供编辑器接管。 */
export function collectPublishedExteriorOpenings(): ExteriorOpeningDraft[] {
  const out: ExteriorOpeningDraft[] = [];
  for (const floor of [0, 1, 2, 3]) {
    facades(floor).forEach((facade, facadeIndex) => {
      for (const opening of facade.openings) {
        out.push({
          floor,
          facadeIndex,
          opening: facadeOpeningToWallOpening(opening),
        });
      }
    });
  }
  return out;
}

/**
 * 旧草稿只有「新增」外墙洞口；首次进入编辑时并入原方案洞口，之后删除／移动才生效。
 * 已托管时仍会把明显偏大的窗宽压回现算立面（短墙比例规则更新后，避免平面仍显示旧的「满墙窗」）。
 */
export function ensureExteriorManaged(draft: LayoutDraft): LayoutDraft {
  const published = collectPublishedExteriorOpenings();
  if (!draft.exteriorManaged) {
    const extras = draft.exteriorOpenings.filter((item) => {
      return !published.some(
        (p) =>
          p.floor === item.floor &&
          p.facadeIndex === item.facadeIndex &&
          Math.abs(p.opening.offset - item.opening.offset) < 50 &&
          Math.abs(p.opening.width - item.opening.width) < 50,
      );
    });
    draft.exteriorOpenings = [...published, ...extras];
    draft.exteriorManaged = true;
  }
  return clampOversizedExteriorWindows(draft, published);
}

/** 窗宽超过墙长合理比例时，贴回同位置的现算立面洞口。 */
function clampOversizedExteriorWindows(
  draft: LayoutDraft,
  published: ExteriorOpeningDraft[],
): LayoutDraft {
  const exteriorOpenings = draft.exteriorOpenings.map((item) => {
    if (item.opening.kind !== "window") return item;
    const facade = facades(item.floor)[item.facadeIndex];
    if (!facade) return item;
    const wallLen = Math.hypot(facade.b[0] - facade.a[0], facade.b[1] - facade.a[1]);
    if (!(wallLen > 500)) return item;
    // 略宽于默认上限，避免浮点／手调小数误伤
    if (item.opening.width <= wallLen * defaultWindowMaxRatio(wallLen) + 20) return item;
    const center = item.opening.offset + item.opening.width / 2;
    const match = published.find((p) => {
      if (p.floor !== item.floor || p.facadeIndex !== item.facadeIndex) return false;
      if (p.opening.kind !== "window") return false;
      const pc = p.opening.offset + p.opening.width / 2;
      return Math.abs(pc - center) < 450;
    });
    if (match) {
      return {
        ...item,
        opening: {
          ...item.opening,
          width: match.opening.width,
          offset: match.opening.offset,
        },
      };
    }
    const maxW = wallLen * defaultWindowMaxRatio(wallLen);
    return {
      ...item,
      opening: {
        ...item.opening,
        width: maxW,
        offset: Math.max(0, Math.min(wallLen - maxW, center - maxW / 2)),
      },
    };
  });
  draft.exteriorOpenings = exteriorOpenings;
  return draft;
}

const roomKinds: Room["kind"][] = [
  "bed", "living", "hall", "bath", "stair", "kitchen", "dining", "store", "void",
];
const furnitureKinds: Furniture["kind"][] = [...FURNITURE_KINDS];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown, label: string, min = -100000, max = 100000): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 必须是数字`);
  if (value < min || value > max) throw new Error(`${label} 超出范围 ${min}..${max}`);
  return value;
}

function str(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string") throw new Error(`${label} 必须是文字`);
  if (value.length > max) throw new Error(`${label} 过长`);
  return value;
}

function point(value: unknown, label: string): Point {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} 应是 [x,z]`);
  return [num(value[0], `${label}.x`), num(value[1], `${label}.z`)];
}

function parseRoom(value: unknown, i: number): Room {
  if (!isRecord(value)) throw new Error(`房间 ${i} 格式不对`);
  const kind = str(value.kind, `房间 ${i} 类型`) as Room["kind"];
  if (!roomKinds.includes(kind)) throw new Error(`房间 ${i} 类型无效`);
  const room: Room = {
    id: str(value.id, `房间 ${i} id`, 80),
    name: str(value.name, `房间 ${i} 名称`, 40),
    x: num(value.x, `房间 ${i} x`),
    z: num(value.z, `房间 ${i} z`),
    w: num(value.w, `房间 ${i} w`, 300, 30000),
    d: num(value.d, `房间 ${i} d`, 300, 30000),
    kind,
  };
  if (value.note !== undefined) room.note = str(value.note, `房间 ${i} 说明`, 500);
  if (value.label !== undefined) room.label = point(value.label, `房间 ${i} 标签`);
  if (value.purposeStatus === "pending") room.purposeStatus = "pending";
  return room;
}

function parseOpening(value: unknown, label: string): WallOpening {
  if (!isRecord(value)) throw new Error(`${label} 格式不对`);
  const kind = value.kind !== undefined ? (str(value.kind, `${label} 类型`, 40) as OpeningKind) : "door";
  if (!OPENING_KINDS.includes(kind)) throw new Error(`${label} 类型无效`);
  return normalizeOpening({
    offset: num(value.offset, `${label} 偏移`, 0, 40000),
    // 与编辑器最小门宽 300 mm 一致，避免历史回放时解析失败导致撤销／重做中断。
    width: num(value.width, `${label} 宽`, 300, 6000),
    kind,
    hinge: value.hinge === "end" ? "end" : "start",
    side: value.side === "in" ? "in" : "out",
  });
}

function parseWall(value: unknown, i: number): Wall {
  if (!isRecord(value)) throw new Error(`隔墙 ${i} 格式不对`);
  const wall: Wall = { a: point(value.a, `隔墙 ${i} a`), b: point(value.b, `隔墙 ${i} b`) };
  if (value.role === "bearing" || value.role === "partition" || value.role === "virtual") wall.role = value.role;
  if (value.door !== undefined && wall.role !== "virtual") wall.door = parseOpening(value.door, `隔墙 ${i} 门窗`);
  // 旧草稿里可能带 roomId（曾自动造墙），忽略即可。
  return wall;
}

function parseExteriorOpening(value: unknown, i: number): ExteriorOpeningDraft {
  if (!isRecord(value)) throw new Error(`外墙洞口 ${i} 格式不对`);
  return {
    floor: num(value.floor, `外墙洞口 ${i} 楼层`, 0, 3),
    facadeIndex: num(value.facadeIndex, `外墙洞口 ${i} 立面`, 0, 20),
    opening: parseOpening(value.opening, `外墙洞口 ${i}`),
  };
}

function parseFurniture(value: unknown, i: number): Furniture {
  if (!isRecord(value)) throw new Error(`家具 ${i} 格式不对`);
  const kind = str(value.kind, `家具 ${i} 类型`) as Furniture["kind"];
  if (!furnitureKinds.includes(kind)) throw new Error(`家具 ${i} 类型无效`);
  const item: Furniture = {
    kind,
    x: num(value.x, `家具 ${i} x`),
    z: num(value.z, `家具 ${i} z`),
    w: num(value.w, `家具 ${i} w`, 100, 8000),
    d: num(value.d, `家具 ${i} d`, 100, 8000),
  };
  if (value.rotation !== undefined) {
    // 允许历史草稿里累加过大的角，读入后归一化。
    item.rotation = normalizeRotation(num(value.rotation, `家具 ${i} 旋转`, -1e6, 1e6));
  }
  if (value.label !== undefined) item.label = str(value.label, `家具 ${i} 标签`, 40);
  return item;
}

function normalizeDraftRotations(draft: LayoutDraft): LayoutDraft {
  for (const floor of draft.floors) {
    for (const item of floor.furniture) {
      if (item.rotation !== undefined) item.rotation = normalizeRotation(item.rotation);
    }
  }
  for (const item of draft.annexFurniture) {
    if (item.rotation !== undefined) item.rotation = normalizeRotation(item.rotation);
  }
  return draft;
}

function parseFloor(value: unknown, i: number): Floor {
  if (!isRecord(value)) throw new Error(`楼层 ${i} 格式不对`);
  if (!Array.isArray(value.rooms) || value.rooms.length > 40) throw new Error(`楼层 ${i} 房间过多`);
  if (!Array.isArray(value.partitions) || value.partitions.length > 80) throw new Error(`楼层 ${i} 隔墙过多`);
  if (!Array.isArray(value.furniture) || value.furniture.length > 120) throw new Error(`楼层 ${i} 家具过多`);
  return {
    name: str(value.name, `楼层 ${i} 名称`, 20),
    y: num(value.y, `楼层 ${i} y`, -5000, 20000),
    height: num(value.height, `楼层 ${i} 层高`, 2000, 6000),
    front: num(value.front, `楼层 ${i} 前墙`, -5000, 5000),
    rooms: value.rooms.map(parseRoom),
    partitions: value.partitions.map(parseWall),
    furniture: value.furniture.map(parseFurniture),
  };
}

function parseStair(value: unknown): StairDraft {
  if (!isRecord(value)) throw new Error("楼梯数据格式不对");
  if (!isRecord(value.room) || !isRecord(value.hole)) throw new Error("楼梯房间或洞口格式不对");
  const axis = value.axis === "z" ? "z" : value.axis === "x" ? "x" : null;
  if (!axis) throw new Error("楼梯方向应为 x 或 z");
  return {
    room: {
      x: num(value.room.x, "楼梯房间 x"),
      z: num(value.room.z, "楼梯房间 z"),
      w: num(value.room.w, "楼梯房间 w", 1000, 10000),
      d: num(value.room.d, "楼梯房间 d", 1000, 10000),
    },
    x: num(value.x, "楼梯起点 x"),
    z: num(value.z, "楼梯起点 z"),
    flight: num(value.flight, "梯段宽", 600, 2000),
    gap: num(value.gap, "梯井缝", 0, 1000),
    risers: Math.round(num(value.risers, "踢面数", 10, 40)),
    tread: num(value.tread, "踏步深", 150, 400),
    landing: num(value.landing, "休息平台", 400, 2000),
    axis,
    lowerSide: value.lowerSide === "min" || value.lowerSide === "max" ? value.lowerSide : undefined,
    hole: {
      x: num(value.hole.x, "楼梯洞 x"),
      z: num(value.hole.z, "楼梯洞 z"),
      w: num(value.hole.w, "楼梯洞 w", 1000, 8000),
      d: num(value.hole.d, "楼梯洞 d", 1000, 8000),
    },
  };
}

export function envelopeFromSite(): LayoutEnvelope {
  return {
    mainX: site.main.x,
    mainZ: site.main.z,
    mainW: site.main.w,
    mainD: site.main.d,
    annexX: site.annex.x,
    annexZ: site.annex.z,
    annexW: site.annex.w,
    annexD: site.annex.d,
  };
}

export function clonePublishedLayout(): LayoutDraft {
  return ensureExteriorManaged({
    schema: layoutDraftSchema,
    revision: projectMeta.revision,
    updatedAt: new Date().toISOString(),
    note: "布局草稿 · 设计建议 · 非施工图。定稿后导出 JSON 再回写模型。",
    floors: structuredClone(floors),
    annexRooms: structuredClone(annexRooms),
    annexPartitions: structuredClone(annexPartitions),
    annexFurniture: structuredClone(annexFurniture),
    stairLayout: structuredClone(stairLayout) as StairDraft,
    portico: structuredClone(site.portico),
    livingVoid: structuredClone(circulation.livingVoid),
    sideDoorZ: circulation.sideDoorZ,
    sideDoorWidth: circulation.sideDoorWidth,
    exteriorOpenings: [],
    exteriorManaged: false,
    envelope: envelopeFromSite(),
  });
}

/** 任一楼层仍有 kind=stair 的房间框，即视为本方案含楼梯模型。 */
export function floorsHaveStair(floorList: Floor[]): boolean {
  return floorList.some((floor) => floor.rooms.some((r) => r.kind === "stair"));
}

export function draftHasStair(draft: LayoutDraft): boolean {
  return floorsHaveStair(draft.floors);
}

/** 删除全部楼梯房间框（踏步几何仍保留在 stairLayout，供再次放置）。 */
export function removeStairFromDraft(draft: LayoutDraft): void {
  for (const floor of draft.floors) {
    floor.rooms = floor.rooms.filter((r) => r.kind !== "stair");
  }
}

/** 三层都保证有楼梯房间框，并与 stairLayout.room 对齐。 */
export function ensureStairRooms(draft: LayoutDraft): void {
  const room = draft.stairLayout.room;
  const ids = ["stair0", "stair1", "stair2"] as const;
  draft.floors.forEach((floor, i) => {
    let existing = floor.rooms.find((r) => r.kind === "stair");
    if (!existing) {
      existing = {
        id: ids[i] ?? `stair${i}`,
        name: "楼梯",
        x: room.x,
        z: room.z,
        w: room.w,
        d: room.d,
        kind: "stair",
        label: [room.x + room.w / 2, room.z + room.d / 2],
        note: "编辑器放置的楼梯示意；踏步、净高与洞口待结构核定。",
      };
      floor.rooms.push(existing);
    } else {
      existing.x = room.x;
      existing.z = room.z;
      existing.w = room.w;
      existing.d = room.d;
      if (!existing.name.trim()) existing.name = "楼梯";
      existing.label = [room.x + room.w / 2, room.z + room.d / 2];
    }
  });
}

/** 主楼既有竖向开间轴（房间边＋隔墙），供楼梯落位吸附。 */
function collectMainVerticalAnchors(draft: LayoutDraft): number[] {
  const xs = [site.main.x, site.main.x + site.main.w];
  for (const floor of draft.floors) {
    for (const r of floor.rooms) {
      if (r.kind === "stair") continue;
      xs.push(r.x, r.x + r.w);
    }
    for (const w of floor.partitions) {
      if (Math.abs(w.a[0] - w.b[0]) < 50) xs.push((w.a[0] + w.b[0]) / 2);
    }
  }
  return [...new Set(xs.map((v) => Math.round(v)))].sort((a, b) => a - b);
}

function snapToNearestAnchor(value: number, anchors: number[], maxDist: number): number {
  let best = value;
  let bestDist = maxDist;
  for (const a of anchors) {
    const d = Math.abs(a - value);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best;
}

/**
 * 在点击／拖放点放置（或移到）楼梯：保持踏步相对楼梯间的内偏，并同步三层房间框。
 * 左右边尽量吸到开间轴，避免比 4500 开间偏出几十毫米后尺寸链拆成 2800+1620。
 */
export function placeStairAt(draft: LayoutDraft, cx: number, cz: number): void {
  const s = draft.stairLayout;
  const ox = s.x - s.room.x;
  const oz = s.z - s.room.z;
  const hx = s.hole.x - s.room.x;
  const hz = s.hole.z - s.room.z;
  const anchors = collectMainVerticalAnchors(draft);
  let x = cx - s.room.w / 2;
  const z = cz - s.room.d / 2;
  const snapLeft = snapToNearestAnchor(x, anchors, 400);
  const snapRight = snapToNearestAnchor(x + s.room.w, anchors, 400);
  const leftDist = Math.abs(snapLeft - x);
  const rightDist = Math.abs(snapRight - (x + s.room.w));
  if (leftDist <= rightDist && leftDist < 400) x = snapLeft;
  else if (rightDist < 400) x = snapRight - s.room.w;
  s.room.x = snapMeter(x);
  s.room.z = snapMeter(z);
  s.x = snapMeter(s.room.x + ox);
  s.z = snapMeter(s.room.z + oz);
  s.hole.x = snapMeter(s.room.x + hx);
  s.hole.z = snapMeter(s.room.z + hz);
  ensureStairRooms(draft);
}

/** 以东南角为不动点（与 villa-params 主辅楼改尺一致）。 */
function scalePointDraft(p: Point, oE: number, oS: number, nE: number, nS: number, sx: number, sz: number): Point {
  return [nE - (oE - p[0]) * sx, nS - (oS - p[1]) * sz];
}

function scaleRoomDraft(r: Room, oE: number, oS: number, nE: number, nS: number, sx: number, sz: number): Room {
  const next: Room = {
    ...r,
    x: nE - (oE - r.x) * sx,
    z: nS - (oS - r.z) * sz,
    w: r.w * sx,
    d: r.d * sz,
  };
  if (r.label) next.label = scalePointDraft(r.label, oE, oS, nE, nS, sx, sz);
  return next;
}

/** 与方案尺寸缩放一致：床／洁具等成品只平移，不缩外形。 */
const FIXED_FURNITURE_KINDS = new Set<Furniture["kind"]>([
  "bed",
  "toilet",
  "squatToilet",
  "shower",
  "roundTable",
  "basin",
  "chair",
  "hob",
  "sink",
  "stove",
]);

function scaleFurnitureDraft(f: Furniture, oE: number, oS: number, nE: number, nS: number, sx: number, sz: number): Furniture {
  const fixed = FIXED_FURNITURE_KINDS.has(f.kind);
  return {
    ...f,
    x: nE - (oE - f.x) * sx,
    z: nS - (oS - f.z) * sz,
    w: fixed ? f.w : f.w * sx,
    d: fixed ? f.d : f.d * sz,
  };
}

/** 层高、三楼退台前缘、门厅外伸以当前 site／floors 为准，避免旧草稿盖掉已应用尺寸。 */
export function alignLayoutDraftToSite(draft: LayoutDraft): LayoutDraft {
  return {
    ...draft,
    floors: draft.floors.map((floor, i) => {
      const live = floors[i];
      if (!live) return floor;
      return {
        ...floor,
        y: live.y,
        height: live.height,
        front: live.front,
      };
    }),
    portico: {
      x: site.portico.x,
      w: site.portico.w,
      projection: site.portico.projection,
    },
    // 不覆盖调用方刚写入的 envelope，避免二次缩放叠乘。
    envelope: draft.envelope ?? envelopeFromSite(),
  };
}

function scaleWallDraft(w: Wall, oE: number, oS: number, nE: number, nS: number, sx: number, sz: number): Wall {
  const alongX = Math.abs(w.a[0] - w.b[0]) >= Math.abs(w.a[1] - w.b[1]);
  const along = alongX ? sx : sz;
  return {
    ...w,
    a: scalePointDraft(w.a, oE, oS, nE, nS, sx, sz),
    b: scalePointDraft(w.b, oE, oS, nE, nS, sx, sz),
    door: w.door
      ? { ...w.door, offset: w.door.offset * along, width: w.door.width * along }
      : undefined,
  };
}

function openingAxisScale(floor: number, facadeIndex: number, sx: number, sz: number, asx: number, asz: number) {
  if (floor === 3) return facadeIndex === 0 || facadeIndex === 3 ? asx : asz;
  if (floor === 2) return facadeIndex === 0 || facadeIndex === 3 ? sx : sz;
  return facadeIndex <= 1 ? sx : sz;
}

/**
 * 按主／辅楼外包络轴向比例变换草稿（相对草稿自带 envelope，缺省为默认包络）。
 * 以南／东墙为不动点缩放，与方案参数改尺一致；不叠乘。
 */
export function scaleLayoutDraftToEnvelope(draft: LayoutDraft, target: LayoutEnvelope): LayoutDraft {
  // 无 envelope 的旧草稿：用改 rearGap 前的历史外轮廓作一次性迁移锚点（非当前 site 默认）。
  const from = draft.envelope ?? {
    mainX: 6800,
    mainZ: -1000,
    mainW: 13500,
    mainD: 10000,
    annexX: 800,
    annexZ: 0,
    annexW: 4500,
    annexD: 9000,
  };
  const sx = target.mainW / from.mainW;
  const sz = target.mainD / from.mainD;
  const asx = target.annexW / from.annexW;
  const asz = target.annexD / from.annexD;
  const nearlyOne =
    Math.abs(sx - 1) < 1e-9 &&
    Math.abs(sz - 1) < 1e-9 &&
    Math.abs(asx - 1) < 1e-9 &&
    Math.abs(asz - 1) < 1e-9 &&
    Math.abs(target.mainX - from.mainX) < 1e-9 &&
    Math.abs(target.mainZ - from.mainZ) < 1e-9 &&
    Math.abs(target.annexX - from.annexX) < 1e-9 &&
    Math.abs(target.annexZ - from.annexZ) < 1e-9;
  if (nearlyOne) return alignLayoutDraftToSite({ ...draft, envelope: target });

  const oE = from.mainX + from.mainW;
  const oS = from.mainZ + from.mainD;
  const nE = target.mainX + target.mainW;
  const nS = target.mainZ + target.mainD;
  const aoE = from.annexX + from.annexW;
  const aoS = from.annexZ + from.annexD;
  const anE = target.annexX + target.annexW;
  const anS = target.annexZ + target.annexD;
  const sl = draft.stairLayout;
  const acrossMin = 2 * sl.flight + sl.gap;
  const holeW = Math.max(sl.hole.w * sx, sl.axis === "z" ? acrossMin : 1500);
  const holeD = Math.max(sl.hole.d * sz, sl.axis === "x" ? acrossMin : 1500);

  const scaled: LayoutDraft = {
    ...draft,
    note: draft.note.includes("已随方案参数重算")
      ? draft.note
      : `${draft.note}${draft.note ? " · " : ""}已随方案参数重算`,
    floors: draft.floors.map((floor) => ({
      ...floor,
      rooms: floor.rooms.map((r) => scaleRoomDraft(r, oE, oS, nE, nS, sx, sz)),
      partitions: floor.partitions.map((w) => scaleWallDraft(w, oE, oS, nE, nS, sx, sz)),
      furniture: floor.furniture.map((f) => scaleFurnitureDraft(f, oE, oS, nE, nS, sx, sz)),
    })),
    annexRooms: draft.annexRooms.map((r) => scaleRoomDraft(r, aoE, aoS, anE, anS, asx, asz)),
    annexPartitions: draft.annexPartitions.map((w) => scaleWallDraft(w, aoE, aoS, anE, anS, asx, asz)),
    annexFurniture: draft.annexFurniture.map((f) => scaleFurnitureDraft(f, aoE, aoS, anE, anS, asx, asz)),
    stairLayout: {
      ...sl,
      room: {
        x: nE - (oE - sl.room.x) * sx,
        z: nS - (oS - sl.room.z) * sz,
        w: Math.max(sl.room.w * sx, sl.axis === "z" ? acrossMin + 200 : sl.room.w * sx),
        d: Math.max(sl.room.d * sz, sl.axis === "x" ? acrossMin + 200 : sl.room.d * sz),
      },
      x: nE - (oE - sl.x) * sx,
      z: nS - (oS - sl.z) * sz,
      // 梯段实体尺寸不随房屋等比缩小
      flight: sl.flight,
      gap: sl.gap,
      tread: sl.tread,
      landing: sl.landing,
      hole: {
        x: nE - (oE - sl.hole.x) * sx,
        z: nS - (oS - sl.hole.z) * sz,
        w: holeW,
        d: holeD,
      },
    },
    portico: {
      x: site.portico.x,
      w: site.portico.w,
      projection: site.portico.projection,
    },
    livingVoid: {
      x: nE - (oE - draft.livingVoid.x) * sx,
      z: nS - (oS - draft.livingVoid.z) * sz,
      w: draft.livingVoid.w * sx,
      d: draft.livingVoid.d * sz,
    },
    sideDoorZ: nS - (oS - draft.sideDoorZ) * sz,
    sideDoorWidth: draft.sideDoorWidth, // 门洞宽保持房门口径，不随进深比放大
    exteriorOpenings: draft.exteriorOpenings.map((item) => {
      const s = openingAxisScale(item.floor, item.facadeIndex, sx, sz, asx, asz);
      return {
        ...item,
        opening: {
          ...item.opening,
          offset: item.opening.offset * s,
          width: item.opening.width * s,
        },
      };
    }),
    envelope: target,
  };
  return alignLayoutDraftToSite(scaled);
}

export function parseLayoutDraft(raw: string): LayoutDraft {
  if (raw.length > 4_000_000) throw new Error("草稿超过 4MB");
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) throw new Error("草稿不是对象");
  if (value.schema !== layoutDraftSchema) throw new Error(`草稿版本应为 ${layoutDraftSchema}`);
  if (!Array.isArray(value.floors) || value.floors.length !== 3) throw new Error("应包含三层楼");
  return {
    schema: layoutDraftSchema,
    revision: str(value.revision, "revision", 100),
    updatedAt: str(value.updatedAt, "updatedAt", 40),
    note: str(value.note ?? "", "note", 1000),
    floors: value.floors.map(parseFloor),
    annexRooms: Array.isArray(value.annexRooms) ? value.annexRooms.map(parseRoom) : [],
    annexPartitions: Array.isArray(value.annexPartitions) ? value.annexPartitions.map(parseWall) : [],
    annexFurniture: Array.isArray(value.annexFurniture) ? value.annexFurniture.map(parseFurniture) : [],
    stairLayout: parseStair(value.stairLayout),
    portico: (() => {
      if (!isRecord(value.portico)) throw new Error("门厅数据格式不对");
      return {
        x: num(value.portico.x, "门厅 x"),
        w: num(value.portico.w, "门厅 w", 2000, 8000),
        projection: num(value.portico.projection, "门厅外伸", 500, 4000),
      };
    })(),
    livingVoid: (() => {
      if (!isRecord(value.livingVoid)) throw new Error("挑空数据格式不对");
      return {
        x: num(value.livingVoid.x, "挑空 x"),
        z: num(value.livingVoid.z, "挑空 z"),
        w: num(value.livingVoid.w, "挑空 w", 1000, 10000),
        d: num(value.livingVoid.d, "挑空 d", 1000, 12000),
      };
    })(),
    sideDoorZ: num(value.sideDoorZ ?? circulation.sideDoorZ, "辅楼门 Z"),
    sideDoorWidth: num(value.sideDoorWidth ?? circulation.sideDoorWidth, "辅楼门宽", 700, 2500),
    exteriorOpenings: Array.isArray(value.exteriorOpenings)
      ? value.exteriorOpenings.map(parseExteriorOpening)
      : [],
    exteriorManaged: value.exteriorManaged === true,
    envelope: isRecord(value.envelope)
      ? {
          mainX: num(value.envelope.mainX, "envelope.mainX"),
          mainZ: num(value.envelope.mainZ, "envelope.mainZ"),
          mainW: num(value.envelope.mainW, "envelope.mainW", 1000, 40000),
          mainD: num(value.envelope.mainD, "envelope.mainD", 1000, 40000),
          annexX: num(value.envelope.annexX, "envelope.annexX"),
          annexZ: num(value.envelope.annexZ, "envelope.annexZ"),
          annexW: num(value.envelope.annexW, "envelope.annexW", 1000, 20000),
          annexD: num(value.envelope.annexD, "envelope.annexD", 1000, 20000),
        }
      : undefined,
  };
}

/** 导入／历史 JSON：补齐外墙洞口托管，避免刷新后又变回不可点的静态窗。 */
export function parseLayoutDraftManaged(raw: string): LayoutDraft {
  return ensureExteriorManaged(parseLayoutDraft(raw));
}

/** 内存中的布局草稿；持久化改走 scheme 文件，不再写 localStorage。 */
let memoryLayoutDraft: LayoutDraft | null = null;

export function loadLayoutDraft(): LayoutDraft | null {
  return memoryLayoutDraft ? structuredClone(memoryLayoutDraft) : null;
}

export function saveLayoutDraft(draft: LayoutDraft) {
  const next = normalizeDraftRotations({
    ...draft,
    floors: draft.floors.map((f) => ({
      ...f,
      furniture: f.furniture.map((item) => ({ ...item })),
    })),
    annexFurniture: draft.annexFurniture.map((item) => ({ ...item })),
    updatedAt: new Date().toISOString(),
  });
  memoryLayoutDraft = next;
  return next;
}

export function clearLayoutDraft() {
  memoryLayoutDraft = null;
}

/** 供方案文件加载时写入内存草稿。 */
export function replaceLayoutDraftMemory(draft: LayoutDraft | null) {
  memoryLayoutDraft = draft ? structuredClone(draft) : null;
}

export function draftToJson(draft: LayoutDraft) {
  const cleaned = normalizeDraftRotations(structuredClone(draft));
  return `${JSON.stringify(cleaned, null, 2)}\n`;
}

/**
 * 长度吸附（毫米）；默认 1 mm，传 10＝厘米。保留旧导出名以免改动全部调用点。
 */
export function snapMeter(value: number, step = 1) {
  return snapMm(value, step);
}

/** 隔墙默认正交：取较大位移轴，画成水平或竖直。 */
export function orthoSnap(
  ax: number,
  az: number,
  x: number,
  z: number,
  freeAngle = false,
): { x: number; z: number; ortho: "h" | "v" | "free" } {
  if (freeAngle) {
    return { x: snapMeter(x), z: snapMeter(z), ortho: "free" };
  }
  const dx = Math.abs(x - ax);
  const dz = Math.abs(z - az);
  if (dx >= dz) return { x: snapMeter(x), z: az, ortho: "h" };
  return { x: ax, z: snapMeter(z), ortho: "v" };
}

export type AnchorPoint = { x: number; z: number };

/** 画墙贴墙身／外皮的默认阈值（mm）；大于外墙半厚，手感宽松。 */
export const WALL_EDGE_SNAP_GAP = 250;

/** 墙段吸附目标：中线轴＋半厚（虚线 half=0）。 */
export type WallSnapSeg = {
  axis: "h" | "v";
  at: number;
  lo: number;
  hi: number;
  half: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
};

function wallSnapHalf(wall: Pick<Wall, "a" | "b" | "role">): number {
  if (!isPhysicalWall(wall as Wall)) return 0;
  return (wallRoleOf(wall as Wall) === "bearing" ? construction.outsideWall : construction.partition) / 2;
}

/** 隔墙／外墙 → 正交墙段；斜墙跳过。 */
export function collectWallSnapSegs(walls: Pick<Wall, "a" | "b" | "role">[]): WallSnapSeg[] {
  const out: WallSnapSeg[] = [];
  for (const wall of walls) {
    const ax = wall.a[0], az = wall.a[1], bx = wall.b[0], bz = wall.b[1];
    const dx = Math.abs(bx - ax), dz = Math.abs(bz - az);
    if (dx < 50 && dz < 50) continue;
    const half = wallSnapHalf(wall);
    if (dz < dx * 0.35) {
      // 近水平
      const at = snapMeter((az + bz) / 2);
      out.push({
        axis: "h",
        at,
        lo: Math.min(ax, bx),
        hi: Math.max(ax, bx),
        half,
        ax,
        az: at,
        bx,
        bz: at,
      });
    } else if (dx < dz * 0.35) {
      const at = snapMeter((ax + bx) / 2);
      out.push({
        axis: "v",
        at,
        lo: Math.min(az, bz),
        hi: Math.max(az, bz),
        half,
        ax: at,
        az,
        bx: at,
        bz,
      });
    }
  }
  return out;
}

/**
 * 落点贴墙：优先墙尖，其次墙身中线投影（可沿段外扩 half）。
 * 用于画墙起点；优先于房间角点，避免错误房间框带偏。
 */
export function snapPointToWallEdge(
  x: number,
  z: number,
  segs: WallSnapSeg[],
  threshold = WALL_EDGE_SNAP_GAP,
): { x: number; z: number; snapped: boolean; guideXs: number[]; guideZs: number[] } {
  let bestTipD = threshold;
  let bestTip: { x: number; z: number } | null = null;
  for (const s of segs) {
    for (const p of [
      { x: s.ax, z: s.az },
      { x: s.bx, z: s.bz },
    ]) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bestTipD) {
        bestTipD = d;
        bestTip = p;
      }
    }
  }
  if (bestTip) {
    return {
      x: snapMeter(bestTip.x),
      z: snapMeter(bestTip.z),
      snapped: true,
      guideXs: [bestTip.x],
      guideZs: [bestTip.z],
    };
  }

  let bestBodyD = threshold;
  let bestBody: { x: number; z: number; guideXs: number[]; guideZs: number[] } | null = null;
  for (const s of segs) {
    const pad = s.half + threshold * 0.25;
    if (s.axis === "h") {
      const dist = Math.abs(z - s.at);
      if (dist > threshold) continue;
      if (x < s.lo - pad || x > s.hi + pad) continue;
      const px = Math.min(s.hi, Math.max(s.lo, x));
      if (dist < bestBodyD) {
        bestBodyD = dist;
        bestBody = { x: snapMeter(px), z: s.at, guideXs: [px], guideZs: [s.at] };
      }
    } else {
      const dist = Math.abs(x - s.at);
      if (dist > threshold) continue;
      if (z < s.lo - pad || z > s.hi + pad) continue;
      const pz = Math.min(s.hi, Math.max(s.lo, z));
      if (dist < bestBodyD) {
        bestBodyD = dist;
        bestBody = { x: s.at, z: snapMeter(pz), guideXs: [s.at], guideZs: [pz] };
      }
    }
  }
  if (bestBody) {
    return { ...bestBody, snapped: true };
  }
  return { x: snapMeter(x), z: snapMeter(z), snapped: false, guideXs: [], guideZs: [] };
}

/**
 * 正交墙终点贴附近墙（中线口径，与墙厚绘制／转角伸出一致）：
 * 1. 任意墙尖（含直角 L 角）→ 精确落到该端点；
 * 2. 正交墙身中段 T 接 → 落到中线交点（不伸外皮，外皮由描边转角处理）。
 * 旧「伸到对侧外皮」会把 L 角竖墙停在 5280 而对面横墙在 5400，造成 3900／3945 这类对不齐。
 */
export function extendOrthoEndToFarFace(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  segs: WallSnapSeg[],
  threshold = WALL_EDGE_SNAP_GAP,
): { x: number; z: number; snapped: boolean; guideXs: number[]; guideZs: number[] } {
  const ortho: "h" | "v" = Math.abs(bx - ax) >= Math.abs(bz - az) ? "h" : "v";

  // 1) 任意墙尖：直角 L 与平行对接都落到同一中线角点
  let bestTipD = threshold;
  let bestTip: { x: number; z: number } | null = null;
  for (const s of segs) {
    for (const tip of [
      { x: s.ax, z: s.az },
      { x: s.bx, z: s.bz },
    ]) {
      const d = Math.hypot(bx - tip.x, bz - tip.z);
      if (d < bestTipD) {
        bestTipD = d;
        bestTip = tip;
      }
    }
  }
  // 沿轴向已对准、只差一段到达墙尖时也要吸上（拖墙很难手动对齐）
  if (!bestTip) {
    let bestAxisTipD = threshold;
    for (const s of segs) {
      for (const tip of [
        { x: s.ax, z: s.az },
        { x: s.bx, z: s.bz },
      ]) {
        if (ortho === "h") {
          if (Math.abs(az - tip.z) > threshold * 0.5) continue;
          const d = Math.abs(bx - tip.x);
          if (d < bestAxisTipD) {
            bestAxisTipD = d;
            bestTip = tip;
            bestTipD = d;
          }
        } else {
          if (Math.abs(ax - tip.x) > threshold * 0.5) continue;
          const d = Math.abs(bz - tip.z);
          if (d < bestAxisTipD) {
            bestAxisTipD = d;
            bestTip = tip;
            bestTipD = d;
          }
        }
      }
    }
  }
  if (bestTip) {
    return {
      x: snapMeter(bestTip.x),
      z: snapMeter(bestTip.z),
      snapped: true,
      guideXs: [bestTip.x],
      guideZs: [bestTip.z],
    };
  }

  // 2) 正交墙身 T 接：中线交点（不伸外皮）
  let bestDist = threshold;
  let best: { x: number; z: number; guideXs: number[]; guideZs: number[] } | null = null;
  if (ortho === "v") {
    for (const s of segs) {
      if (s.axis !== "h") continue;
      const tipBand = Math.max(s.half, 80);
      // 投影落在端点带内时留给墙尖逻辑；此处只接墙身
      if (ax < s.lo + tipBand || ax > s.hi - tipBand) continue;
      const distCenter = Math.abs(bz - s.at);
      if (distCenter > threshold || distCenter >= bestDist) continue;
      bestDist = distCenter;
      best = { x: ax, z: s.at, guideXs: [ax], guideZs: [s.at] };
    }
  } else {
    for (const s of segs) {
      if (s.axis !== "v") continue;
      const tipBand = Math.max(s.half, 80);
      if (az < s.lo + tipBand || az > s.hi - tipBand) continue;
      const distCenter = Math.abs(bx - s.at);
      if (distCenter > threshold || distCenter >= bestDist) continue;
      bestDist = distCenter;
      best = { x: s.at, z: az, guideXs: [s.at], guideZs: [az] };
    }
  }
  if (best) return { ...best, snapped: true };
  return { x: snapMeter(bx), z: snapMeter(bz), snapped: false, guideXs: [], guideZs: [] };
}

/** 房间四角与隔墙端点，供端点／对齐吸附。 */
export function collectLayoutAnchors(
  rooms: Room[],
  partitions: Wall[],
  extra: AnchorPoint[] = [],
): AnchorPoint[] {
  const pts: AnchorPoint[] = [...extra];
  for (const r of rooms) {
    pts.push(
      { x: r.x, z: r.z },
      { x: r.x + r.w, z: r.z },
      { x: r.x, z: r.z + r.d },
      { x: r.x + r.w, z: r.z + r.d },
    );
  }
  for (const wall of partitions) {
    pts.push({ x: wall.a[0], z: wall.a[1] }, { x: wall.b[0], z: wall.b[1] });
  }
  return pts;
}

export function snapToAnchors(
  x: number,
  z: number,
  anchors: AnchorPoint[],
  threshold = 150,
): { x: number; z: number; snapped: boolean; guideXs: number[]; guideZs: number[] } {
  let bestD = threshold;
  let best: AnchorPoint | null = null;
  for (const a of anchors) {
    const d = Math.hypot(x - a.x, z - a.z);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  if (best) {
    return {
      x: best.x,
      z: best.z,
      snapped: true,
      guideXs: [best.x],
      guideZs: [best.z],
    };
  }
  let sx = snapMeter(x);
  let sz = snapMeter(z);
  let snapped = false;
  const guideXs: number[] = [];
  const guideZs: number[] = [];
  for (const a of anchors) {
    if (Math.abs(x - a.x) <= threshold) {
      sx = a.x;
      if (!guideXs.includes(a.x)) guideXs.push(a.x);
      snapped = true;
    }
    if (Math.abs(z - a.z) <= threshold) {
      sz = a.z;
      if (!guideZs.includes(a.z)) guideZs.push(a.z);
      snapped = true;
    }
  }
  return { x: sx, z: sz, snapped, guideXs, guideZs };
}

/**
 * 第二点：默认正交，再贴墙段外皮／墙尖；无墙段命中时回退角点吸附。
 * segs 优先于 anchors，避免错误房间角带偏。
 */
export function refineWallEnd(
  ax: number,
  az: number,
  x: number,
  z: number,
  anchors: AnchorPoint[],
  freeAngle = false,
  threshold = 150,
  segs: WallSnapSeg[] = [],
): { x: number; z: number; ortho: "h" | "v" | "free"; guideXs: number[]; guideZs: number[] } {
  const edgeGap = Math.max(threshold, WALL_EDGE_SNAP_GAP);
  if (freeAngle) {
    if (segs.length) {
      const wallSnap = snapPointToWallEdge(x, z, segs, edgeGap);
      if (wallSnap.snapped) {
        return {
          x: wallSnap.x,
          z: wallSnap.z,
          ortho: "free",
          guideXs: wallSnap.guideXs,
          guideZs: wallSnap.guideZs,
        };
      }
    }
    const snapped = snapToAnchors(x, z, anchors, threshold);
    return { x: snapped.x, z: snapped.z, ortho: "free", guideXs: snapped.guideXs, guideZs: snapped.guideZs };
  }
  const ortho = orthoSnap(ax, az, x, z, false);
  let bx = ortho.x;
  let bz = ortho.z;
  if (segs.length) {
    const extended = extendOrthoEndToFarFace(ax, az, bx, bz, segs, edgeGap);
    if (extended.snapped) {
      return {
        x: extended.x,
        z: extended.z,
        ortho: ortho.ortho,
        guideXs: extended.guideXs,
        guideZs: extended.guideZs,
      };
    }
  }
  // 回退：角点／轴线吸附（旧行为）
  if (ortho.ortho === "h") {
    const guideXs: number[] = [];
    for (const a of anchors) {
      if (Math.abs(x - a.x) <= threshold) {
        bx = a.x;
        if (!guideXs.includes(a.x)) guideXs.push(a.x);
      }
    }
    for (const a of anchors) {
      if (Math.hypot(bx - a.x, az - a.z) <= threshold) {
        return { x: a.x, z: a.z, ortho: "h", guideXs: [a.x], guideZs: [a.z] };
      }
    }
    return { x: bx, z: az, ortho: "h", guideXs, guideZs: [az] };
  }
  const guideZs: number[] = [];
  for (const a of anchors) {
    if (Math.abs(z - a.z) <= threshold) {
      bz = a.z;
      if (!guideZs.includes(a.z)) guideZs.push(a.z);
    }
  }
  for (const a of anchors) {
    if (Math.hypot(ax - a.x, bz - a.z) <= threshold) {
      return { x: a.x, z: a.z, ortho: "v", guideXs: [a.x], guideZs: [a.z] };
    }
  }
  return { x: ax, z: bz, ortho: "v", guideXs: [ax], guideZs };
}

export function wallLength(wall: Wall) {
  return Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
}

/** 隔墙主向：水平（东西）或竖直（南北）。接近 45° 时取位移较大轴。 */
export function wallAxis(wall: Pick<Wall, "a" | "b">): "h" | "v" {
  return Math.abs(wall.b[0] - wall.a[0]) >= Math.abs(wall.b[1] - wall.a[1]) ? "h" : "v";
}

/**
 * 强制水平或竖直，消除拖动／浮点造成的歪斜。
 * 水平墙取两端 Z 中值；竖直墙取两端 X 中值。
 */
export function forceOrthoWall(wall: Wall): Wall {
  if (wallAxis(wall) === "h") {
    const z = snapMeter((wall.a[1] + wall.b[1]) / 2);
    wall.a = [snapMeter(wall.a[0]), z];
    wall.b = [snapMeter(wall.b[0]), z];
  } else {
    const x = snapMeter((wall.a[0] + wall.b[0]) / 2);
    wall.a = [x, snapMeter(wall.a[1])];
    wall.b = [x, snapMeter(wall.b[1])];
  }
  return wall;
}

/** 改隔墙长度：先正交，再沿主轴伸缩；center 则两端对称。 */
export function setWallLength(wall: Wall, length: number, anchor: "a" | "center" = "a") {
  forceOrthoWall(wall);
  const cur = wallLength(wall);
  const L = Math.max(300, snapMeter(length));
  if (cur < 1e-6) {
    wall.b = [snapMeter(wall.a[0] + L), wall.a[1]];
    return wall;
  }
  const axis = wallAxis(wall);
  if (anchor === "center") {
    const cx = (wall.a[0] + wall.b[0]) / 2;
    const cz = (wall.a[1] + wall.b[1]) / 2;
    if (axis === "h") {
      wall.a = [snapMeter(cx - L / 2), snapMeter(cz)];
      wall.b = [snapMeter(cx + L / 2), snapMeter(cz)];
    } else {
      wall.a = [snapMeter(cx), snapMeter(cz - L / 2)];
      wall.b = [snapMeter(cx), snapMeter(cz + L / 2)];
    }
  } else if (axis === "h") {
    const dir = Math.sign(wall.b[0] - wall.a[0]) || 1;
    wall.b = [snapMeter(wall.a[0] + dir * L), wall.a[1]];
  } else {
    const dir = Math.sign(wall.b[1] - wall.a[1]) || 1;
    wall.b = [wall.a[0], snapMeter(wall.a[1] + dir * L)];
  }
  return wall;
}

export function newRoomId(prefix: string, existing: Room[]) {
  let n = 1;
  const ids = new Set(existing.map((r) => r.id));
  while (ids.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}
