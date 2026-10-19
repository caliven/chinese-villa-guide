import type { Furniture, Room, Wall, Point, WallRole } from "./data";
import { site, wallRoleOf, isPhysicalWall } from "./data";
import {
  type LayoutDraft,
  clonePublishedLayout,
  loadLayoutDraft,
  saveLayoutDraft,
  clearLayoutDraft,
  draftToJson,
  parseLayoutDraft,
  ensureExteriorManaged,
  snapMeter,
  wallLength,
  wallAxis,
  forceOrthoWall,
  setWallLength,
  newRoomId,
  collectLayoutAnchors,
  collectWallSnapSegs,
  snapPointToWallEdge,
  snapToAnchors,
  refineWallEnd,
  WALL_EDGE_SNAP_GAP,
  draftHasStair,
  removeStairFromDraft,
  placeStairAt,
  ensureStairRooms,
} from "./layout-draft";
import { downloadFile, escapeHtml } from "./project-meta";
import { renderDrawGuide, type DrawGuide } from "./plan";
import { stairShape, stairWellBounds, fitStairToRoom } from "./stair-geometry";
import {
  createFurniture,
  furnitureDisplayName,
  furnitureLabels,
  furnitureOrientationHint,
  furnitureHasFacing,
  FURNITURE_LOCAL_FRAME,
  furnitureCornerLocal,
  resizeFurnitureFromCorner,
  worldToFurnitureLocal,
  snapRotation,
  normalizeRotation,
  rotationToDeg,
  degToRotation,
  type FurnitureKind,
} from "./furniture-catalog";
import {
  createOpening,
  normalizeOpening,
  openingLabels,
  type OpeningKind,
  type WallOpening,
} from "./openings";
import { facades } from "./facades";
import { roomAreas } from "./design-data";
import { formatMm } from "./units";
import {
  applyRoomToEnclosedRegion,
  roomRegionOverlap,
  findEnclosedRegionAt,
} from "./plan-regions";
import { constrainWallEdits } from "./wall-constraints";
import { syncRoomsFromWalls } from "./room-sync";
import {
  validateProtectedRoomOverlaps,
  syncRoomsToMovedWalls,
  alignWallToNearestSide,
  bayAlongWall,
  centerFurnitureAgainstNearestWall,
  centerOpeningInBay,
  collectBayStations,
  collectCornerSnapPoints,
  collectRoomSnapAxes,
  findRoomContaining,
  furnitureUsesWallCenter,
  nearestRoomWall,
  pullFurnitureClearOfWalls,
  resizeRoomFromCorner,
  roomMargins,
  roomWallLabels,
  porticoBayAlign,
  centerPorticoInBay,
  snapFurnitureDuringDrag,
  snapRoomToNearestWalls,
  snapWallDuringDrag,
  translateFurnitureInsideRoom,
  anchorRoomSizeAgainstEnvelope,
  clampRoomToEnvelope,
  syncInteriorWallsToRoom,
  type OpeningBay,
  type PorticoBayAlign,
  type RoomMargins,
  type WallAlignSide,
} from "./layout-align";

export type EditorTool = "select" | "wall" | "room" | "door" | "furniture";
export type SelectionItem =
  | { kind: "room"; id: string; floor: number; annex?: boolean }
  | { kind: "wall"; index: number; floor: number; annex?: boolean }
  | { kind: "door"; index: number; floor: number; annex?: boolean; exterior?: boolean }
  | { kind: "furniture"; index: number; floor: number; annex?: boolean }
  | { kind: "stair" }
  | { kind: "portico" };
export type Selection = SelectionItem | null;

type GroupMoveItem =
  | { kind: "furniture"; index: number; annex: boolean; orig: Furniture }
  | { kind: "room"; id: string; annex: boolean; orig: Room };

type DragState =
  | {
      type: "group-move";
      startX: number;
      startZ: number;
      items: GroupMoveItem[];
      /** 拖始隔墙／房间／家具快照（独占墙与房内家具跟移用）。 */
      partitionsOrig: Wall[];
      annexPartitionsOrig: Wall[];
      roomsOrig: Room[];
      annexRoomsOrig: Room[];
      furnitureOrig: Furniture[];
      annexFurnitureOrig: Furniture[];
    }
  | {
      type: "room-handle";
      id: string;
      annex: boolean;
      corner: string;
      orig: Room;
      partitionsOrig: Wall[];
      roomsOrig: Room[];
    }
  | { type: "furniture-handle"; index: number; annex: boolean; corner: string; orig: Furniture; grabDlx: number; grabDlz: number }
  | { type: "furniture-rotate"; index: number; annex: boolean; startAngle: number; origRotation: number; orig: Furniture }
  | { type: "wall"; index: number; annex: boolean; end: "a" | "b" | "move"; startX: number; startZ: number; orig: Wall; wallsOrig: Wall[]; roomsOrig: Room[] }
  | { type: "door"; index: number; annex: boolean; exterior: boolean; startOffset: number; startX: number; startZ: number; origOpening: WallOpening; wallA: Point; wallB: Point }
  | { type: "door-handle"; index: number; annex: boolean; exterior: boolean; end: "start" | "end"; origOpening: WallOpening; wallA: Point; wallB: Point }
  | { type: "portico"; startX: number; origX: number; origW: number; mode: "move" | "resize-e" | "resize-w" }
  | { type: "stair"; startX: number; startZ: number; origRoom: LayoutDraft["stairLayout"]["room"]; origX: number; origZ: number; origHole: LayoutDraft["stairLayout"]["hole"] }
  | { type: "stair-handle"; corner: string; origRoom: LayoutDraft["stairLayout"]["room"]; origX: number; origZ: number; origHole: LayoutDraft["stairLayout"]["hole"]; origFlight: number; origTread: number }
  | { type: "draw-wall"; ax: number; az: number }
  | null;

function restoreRecord<T extends object>(target: T, source: T) {
  for (const key of Object.keys(target)) delete (target as Record<string, unknown>)[key];
  Object.assign(target, structuredClone(source));
}

function alongWall(a: Point, b: Point, x: number, z: number) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len;
  const uz = (b[1] - a[1]) / len;
  return (x - a[0]) * ux + (z - a[1]) * uz;
}

export type LayoutEditorHost = {
  getFloor: () => number;
  redraw: () => void;
  toast: (message: string) => void;
  onDraftSaved?: (updatedAt: string, manual: boolean) => void;
};

const MAX_HISTORY = 40;
/** 每次粘贴相对剪贴板原位的步进（mm）。 */
const PASTE_STEP = 500;

type LayoutClipboard = {
  furniture: Furniture[];
  annexFurniture: Furniture[];
  rooms: Room[];
  annexRooms: Room[];
  walls: Wall[];
  annexWalls: Wall[];
};

/** 平面图辅楼家具／隔墙共用的下标偏移（≥1000 表示辅楼）。 */
const ANNEX_INDEX_BASE = 1000;

export class LayoutEditor {
  draft: LayoutDraft;
  tool: EditorTool = "select";
  /**
   * 拖墙／家具时自动吸附附近墙线、墙尖与居中线。
   * 按住 Shift 拖可暂时关闭；也可用顶栏「吸附对齐」关掉。
   */
  magnetSnap = true;
  /** 多选列表；末项为属性面板主选。 */
  selections: SelectionItem[] = [];
  private history: string[] = [];
  private future: string[] = [];
  /** 最近一次入栈内容指纹（忽略 updatedAt），避免点选空松手污染撤销栈。 */
  private lastHistoryKey = "";
  /** 拖拽开始时的内容指纹；松手时若未变则不提交历史。 */
  private dragStartKey = "";
  private drag: DragState = null;
  /** 拖拽吸附引导线（重绘／getDrawGuide 用）。 */
  private dragGuides: { ax: number; az: number; xs: number[]; zs: number[] } | null = null;
  private host: LayoutEditorHost;
  private clipboard: LayoutClipboard | null = null;
  private pasteCount = 0;

  get selection(): Selection {
    return this.selections.at(-1) ?? null;
  }

  set selection(value: Selection) {
    this.selections = value ? [value] : [];
  }

  private selKey(s: SelectionItem): string {
    if (s.kind === "room") return `room:${s.floor}:${s.annex ? 1 : 0}:${s.id}`;
    if (s.kind === "furniture") return `furniture:${s.floor}:${s.annex ? 1 : 0}:${s.index}`;
    if (s.kind === "wall") return `wall:${s.floor}:${s.annex ? 1 : 0}:${s.index}`;
    if (s.kind === "door") {
      return `door:${s.floor}:${s.annex ? 1 : 0}:${s.exterior ? 1 : 0}:${s.index}`;
    }
    return s.kind;
  }

  private isSelectedItem(s: SelectionItem): boolean {
    const key = this.selKey(s);
    return this.selections.some((item) => this.selKey(item) === key);
  }

  private isAdditiveClick(event: PointerEvent | KeyboardEvent): boolean {
    return event.shiftKey || event.metaKey || event.ctrlKey;
  }

  /** 仅房间／家具参与整体平移。 */
  private collectGroupMoveItems(floor: number): GroupMoveItem[] {
    const items: GroupMoveItem[] = [];
    for (const s of this.selections) {
      if (s.kind === "furniture" && s.floor === floor) {
        const item = this.furnitureList(floor, !!s.annex)[s.index];
        if (item) items.push({ kind: "furniture", index: s.index, annex: !!s.annex, orig: structuredClone(item) });
      } else if (s.kind === "room" && s.floor === floor) {
        const found = this.findRoomRef(s.id, floor, !!s.annex);
        if (found) items.push({ kind: "room", id: s.id, annex: found.annex, orig: structuredClone(found.room) });
      }
    }
    return items;
  }

  private toggleSelectable(s: SelectionItem) {
    const key = this.selKey(s);
    const i = this.selections.findIndex((item) => this.selKey(item) === key);
    if (i >= 0) this.selections.splice(i, 1);
    else this.selections.push(s);
  }

  /**
   * 方向键微调：Arrow 1 mm，Shift+Arrow 10 mm（由 main 传入）。
   * dx/dz 为世界坐标（X 东、Z 南）；调用方须按当前平面朝向换算屏幕方向键。
   */
  nudgeSelection(dx: number, dz: number) {
    if (!this.selections.length) return;
    const floor = this.selectionFloor();
    const before = structuredClone(this.draft);
    const groups = [false, true].map(annex => ({ annex,
      originals: structuredClone(annex ? this.draft.annexPartitions : this.floorData(floor).partitions),
      rooms: structuredClone(this.roomList(floor, annex)),
      furniture: structuredClone(this.furnitureList(floor, annex)), indices: [] as number[] }));
    let moved = 0;
    const selectedFurniture = new Set(this.selections.filter(s=>s.kind === "furniture").map(s=>`${!!s.annex}:${s.index}`));
    for (const s of this.selections) {
      if ("floor" in s && s.floor !== floor) continue;
      if (s.kind === "wall") {
        const group = groups[s.annex ? 1 : 0]!;
        const wall = (s.annex ? this.draft.annexPartitions : this.floorData(floor).partitions)[s.index];
        if (!wall) continue;
        wall.a = [snapMeter(wall.a[0]+dx), snapMeter(wall.a[1]+dz)];
        wall.b = [snapMeter(wall.b[0]+dx), snapMeter(wall.b[1]+dz)];
        group.indices.push(s.index);
      } else if (s.kind === "furniture") {
        const item = this.furnitureList(floor, !!s.annex)[s.index];
        if (!item) continue;
        item.x = snapMeter(item.x+dx); item.z = snapMeter(item.z+dz);
      } else if (s.kind === "room") {
        const found = this.findRoomRef(s.id, floor, !!s.annex);
        if (!found || found.room.kind === "stair" || found.room.kind === "void") continue;
        const group = groups[found.annex ? 1 : 0]!;
        const orig = group.rooms.find(r=>r.id === s.id)!;
        const bounded = this.roomTranslation(orig, orig.x+dx, orig.z+dz, floor, found.annex);
        this.translateRoom(found.room, orig, bounded.x-orig.x, bounded.z-orig.z);
        const skip = new Set(this.furnitureList(floor, found.annex).map((_,i)=>i).filter(i=>selectedFurniture.has(`${found.annex}:${i}`)));
        translateFurnitureInsideRoom(orig, found.room.x-orig.x, found.room.z-orig.z, this.furnitureList(floor, found.annex), group.furniture, group.rooms, skip);
      } else if (s.kind === "stair") {
        const stair = this.draft.stairLayout;
        stair.room.x = snapMeter(stair.room.x+dx); stair.room.z = snapMeter(stair.room.z+dz);
        this.syncStairRooms();
      } else if (s.kind === "portico") {
        this.draft.portico.x = snapMeter(this.draft.portico.x+dx);
      } else continue;
      moved++;
    }
    for (const group of groups) if (group.indices.length) {
      if (!this.finishWallEdit(floor, group.annex, group.originals, group.indices, group.rooms)) {
        this.draft = before;
        this.host.redraw();
        return;
      }
      this.afterWallsChanged(floor, group.annex, (group.annex ? this.draft.annexPartitions : this.floorData(floor).partitions)[group.indices[0]!]);
    }
    for (const group of groups) {
      const protection = validateProtectedRoomOverlaps(group.rooms, this.roomList(floor, group.annex));
      if (!protection.ok) {
        this.draft = before;
        this.host.toast(protection.reason ?? "房间不能新增覆盖楼梯或挑空");
        this.host.redraw();
        return;
      }
    }
    for (const s of this.selections) if (s.kind === "furniture") this.clearFurnitureFromWalls(floor, !!s.annex, s.index);
    if (!moved) { this.host.toast("门窗请拖动调整；挑空与楼梯房间请调整对应模型"); return; }
    this.commit();
  }

  /** 画墙：起点 + 当前预览终点（含对齐引导）。 */
  private wallDraft: {
    ax: number;
    az: number;
    bx: number;
    bz: number;
    guideXs: number[];
    guideZs: number[];
    freeAngle: boolean;
  } | null = null;
  private wallPreviewAttached = false;
  /** 两张图仍共用同一草稿；重绘和 window 拖动按起始图纸恢复坐标系。 */
  private activePlanBuilding = "main";
  private onWallPreviewMove = (event: PointerEvent) => {
    if (!this.wallDraft || this.tool !== "wall") {
      this.detachWallPreview();
      return;
    }
    const liveSvg = this.currentSvg();
    if (!liveSvg) return;
    const raw = this.clientToMeter(liveSvg, event.clientX, event.clientY);
    const magnet = this.magnetActive(event);
    const segs = magnet ? this.floorWallSegs() : [];
    const anchors = magnet ? this.floorAnchors() : [];
    const end = refineWallEnd(
      this.wallDraft.ax,
      this.wallDraft.az,
      raw.x,
      raw.z,
      anchors,
      false,
      magnet ? WALL_EDGE_SNAP_GAP : 0,
      segs,
    );
    this.wallDraft = {
      ...this.wallDraft,
      bx: end.x,
      bz: end.z,
      guideXs: end.guideXs,
      guideZs: end.guideZs,
      freeAngle: false,
    };
    this.paintDrawGuide(liveSvg);
  };
  furnitureKind: FurnitureKind = "bed";
  openingKind: OpeningKind = "door";
  roomKind: Room["kind"] = "bed";
  wallRole: WallRole = "partition";

  constructor(host: LayoutEditorHost, draft?: LayoutDraft | null) {
    this.host = host;
    const stored = draft == null ? loadLayoutDraft() : null;
    this.draft = ensureExteriorManaged(draft ?? stored ?? clonePublishedLayout());
    this.ensureWallIds();
    // 旧草稿首次接管外墙洞口后立刻落盘，避免刷新又变回静态窗。
    try {
      this.draft = saveLayoutDraft(this.draft);
      this.host.onDraftSaved?.(this.draft.updatedAt, false);
    } catch {
      /* 本机不可写时仍可编辑，导出 JSON 可备份 */
    }
    this.pushHistory();
    if (stored) {
      queueMicrotask(() => this.host.toast("已载入方案文件中的布局草稿"));
    }
  }

  private ensureWallIds() {
    const all = [...this.draft.floors.flatMap(f => f.partitions), ...this.draft.annexPartitions];
    const used = new Set(all.map(w => w.id).filter((id): id is string => !!id));
    const seen = new Set<string>();
    let n = 1;
    for (const wall of all) {
      if (!wall.id || seen.has(wall.id)) {
        while (used.has(`wall-${n}`)) n++;
        wall.id = `wall-${n++}`;
        used.add(wall.id);
      }
      seen.add(wall.id);
    }
  }

  /** 整次操作按原始快照求解；四个方向键、拖动、长度输入与靠墙共用。 */
  private finishWallEdit(floor: number, annex: boolean, originals: Wall[], indices: number[], roomsOrig: Room[], notify = true): boolean {
    const walls = annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
    const rooms = this.roomList(floor, annex);
    const restore = () => {
      walls.forEach((wall, i) => restoreRecord(wall, originals[i]!));
      rooms.forEach((room, i) => restoreRecord(room, roomsOrig[i]!));
    };
    const result = constrainWallEdits(walls, originals, indices);
    if (!result.ok) {
      restore();
      if (notify) this.host.toast(result.reason ?? "墙体约束冲突");
      return false;
    }
    const body = this.planBody(floor, annex);
    const outside = (p: Point) => p[0] < body.x - 1 || p[0] > body.x + body.w + 1 || p[1] < body.z - 1 || p[1] > body.z + body.d + 1;
    if (walls.some((w, i) => (outside(w.a) && !outside(originals[i]!.a)) || (outside(w.b) && !outside(originals[i]!.b)))) {
      restore();
      if (notify) this.host.toast("墙体不能越出本层外墙包络");
      return false;
    }
    const sync = syncRoomsToMovedWalls(originals, walls, roomsOrig, rooms, body);
    if (!sync.ok) {
      restore();
      if (notify) this.host.toast(sync.reason ?? "房间边界无法同步");
      return false;
    }
    return this.syncRoomBoundaries(floor, annex, originals, roomsOrig, notify);
  }

  /** 在候选墙、房提交前统一重算并校验；失败恢复整次几何。 */
  private syncRoomBoundaries(floor: number, annex: boolean, wallsOrig: Wall[], roomsOrig: Room[], notify = true): boolean {
    const walls = annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
    const rooms = this.roomList(floor, annex);
    let protection = validateProtectedRoomOverlaps(roomsOrig, rooms);
    let conflict = protection.reason;
    if (protection.ok) {
      const sync = syncRoomsFromWalls(this.planBody(floor, annex), walls, rooms, { create: false });
      protection = validateProtectedRoomOverlaps(roomsOrig, rooms);
      conflict = sync.conflicts?.[0] ?? protection.reason;
    }
    if (conflict || !protection.ok) {
      walls.forEach((wall, i) => restoreRecord(wall, wallsOrig[i]!));
      rooms.forEach((room, i) => restoreRecord(room, roomsOrig[i]!));
      if (notify) this.host.toast(conflict ?? "房间不能新增覆盖楼梯或挑空");
      return false;
    }
    return true;
  }

  private roomTranslation(original: Room, requestedX: number, requestedZ: number, floor: number, annex: boolean) {
    const body = this.planBody(floor, annex);
    return {
      x: Math.max(body.x, Math.min(body.x + body.w - original.w, snapMeter(requestedX))),
      z: Math.max(body.z, Math.min(body.z + body.d - original.d, snapMeter(requestedZ))),
    };
  }

  private validateGroupRoomMove(floor: number, drag: Extract<NonNullable<DragState>, { type: "group-move" }>, notify = false): boolean {
    for (const annex of [false, true]) {
      const originalRooms = annex ? drag.annexRoomsOrig : drag.roomsOrig;
      const result = validateProtectedRoomOverlaps(originalRooms, this.roomList(floor, annex));
      if (result.ok) continue;
      for (const restoreAnnex of [false, true]) {
        this.roomList(floor, restoreAnnex).forEach((room, i) => restoreRecord(room, (restoreAnnex ? drag.annexRoomsOrig : drag.roomsOrig)[i]!));
        this.furnitureList(floor, restoreAnnex).forEach((item, i) => restoreRecord(item, (restoreAnnex ? drag.annexFurnitureOrig : drag.furnitureOrig)[i]!));
      }
      if (notify) this.host.toast(result.reason ?? "房间不能新增覆盖楼梯或挑空");
      return false;
    }
    return true;
  }

  private translateRoom(room: Room, original: Room, dx: number, dz: number) {
    room.x = snapMeter(original.x + dx);
    room.z = snapMeter(original.z + dz);
    const tx = room.x - original.x, tz = room.z - original.z;
    room.label = original.label ? [snapMeter(original.label[0] + tx), snapMeter(original.label[1] + tz)] : (tx || tz) ? [room.x + room.w / 2, room.z + room.d / 2] : undefined;
    if (original.outline) room.outline = original.outline.map(([x,z]) => [snapMeter(x + tx), snapMeter(z + tz)]);
    if (tx || tz || !original.boundary) delete room.boundary;
    else room.boundary = structuredClone(original.boundary);
  }

  /** 手动保存到内存；随后由「保存」写入 data/户型/（一二三楼一体）。 */
  saveNow(options?: { silent?: boolean }) {
    try {
      this.draft = saveLayoutDraft(this.draft);
      this.host.onDraftSaved?.(this.draft.updatedAt, true);
      if (!options?.silent) {
        this.host.toast("布局已写入内存，可点「保存」存为户型版本");
      }
    } catch (error) {
      this.host.toast(error instanceof Error ? error.message : "草稿保存失败");
    }
  }

  /** 载入完整户型版本（一二三楼一体），重置撤销栈。 */
  loadDraft(draft: LayoutDraft) {
    this.draft = ensureExteriorManaged(structuredClone(draft));
    this.ensureWallIds();
    try {
      this.draft = saveLayoutDraft(this.draft);
      this.host.onDraftSaved?.(this.draft.updatedAt, false);
    } catch {
      /* ignore */
    }
    this.history = [JSON.stringify(this.draft)];
    this.lastHistoryKey = this.contentKey();
    this.future = [];
    this.selection = null;
    this.host.redraw();
  }

  get canUndo() {
    return this.history.length > 1;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** 布局内容指纹：忽略 updatedAt，否则每次暂存都会当成新步骤。 */
  private contentKey(draft: LayoutDraft = this.draft): string {
    return JSON.stringify({ ...draft, updatedAt: "" });
  }

  private pushHistory() {
    const key = this.contentKey();
    if (key === this.lastHistoryKey) return;
    this.history.push(JSON.stringify(this.draft));
    this.lastHistoryKey = key;
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    this.future = [];
  }

  private commit() {
    this.ensureWallIds();
    try {
      this.draft = saveLayoutDraft(this.draft);
      this.host.onDraftSaved?.(this.draft.updatedAt, false);
    } catch (error) {
      this.host.toast(error instanceof Error ? error.message : "草稿保存失败");
      return;
    }
    this.pushHistory();
    this.host.redraw();
  }

  undo() {
    if (this.history.length < 2) {
      this.host.toast("没有可撤销的操作");
      return;
    }
    try {
      const current = this.history.pop()!;
      this.future.push(current);
      this.draft = ensureExteriorManaged(parseLayoutDraft(this.history[this.history.length - 1]!));
      this.draft = saveLayoutDraft(this.draft);
      this.lastHistoryKey = this.contentKey();
      this.host.onDraftSaved?.(this.draft.updatedAt, false);
      this.selection = null;
      this.host.redraw();
    } catch (error) {
      this.host.toast(error instanceof Error ? error.message : "撤销失败");
    }
  }

  redo() {
    const next = this.future.pop();
    if (!next) {
      this.host.toast("没有可重做的操作");
      return;
    }
    try {
      this.history.push(next);
      this.draft = ensureExteriorManaged(parseLayoutDraft(next));
      this.draft = saveLayoutDraft(this.draft);
      this.lastHistoryKey = this.contentKey();
      this.host.onDraftSaved?.(this.draft.updatedAt, false);
      this.selection = null;
      this.host.redraw();
    } catch (error) {
      this.host.toast(error instanceof Error ? error.message : "重做失败");
    }
  }

  resetToPublished() {
    clearLayoutDraft();
    this.draft = clonePublishedLayout();
    this.ensureWallIds();
    this.history = [];
    this.future = [];
    this.pushHistory();
    saveLayoutDraft(this.draft);
    this.selection = null;
    this.host.toast("已恢复为正式数据副本");
    this.host.redraw();
  }

  exportJson() {
    const name = `layout-draft-${this.draft.updatedAt.slice(0, 10)}.json`;
    downloadFile(name, draftToJson(this.draft), "application/json");
    this.host.toast(`已导出 ${name}，请放到 villa-3d-src/references/layout-draft.json`);
  }

  importJson(raw: string) {
    this.draft = ensureExteriorManaged(parseLayoutDraft(raw));
    this.ensureWallIds();
    saveLayoutDraft(this.draft);
    this.history = [];
    this.future = [];
    this.pushHistory();
    this.selection = null;
    this.host.toast("已导入布局草稿");
    this.host.redraw();
  }

  setTool(tool: EditorTool) {
    this.tool = tool;
    this.cancelWallDraft(false);
    this.host.redraw();
  }

  /** 从工具条拖放到平面图后放置，并切回选择以便调方位／大小。 */
  dropPlace(svg: SVGSVGElement, clientX: number, clientY: number, category: "room" | "door" | "furniture" | "wall", kind: string) {
    this.activePlanBuilding = svg.dataset.planBuilding ?? "main";
    const raw = this.clientToMeter(svg, clientX, clientY);
    const x = snapMeter(raw.x);
    const z = snapMeter(raw.z);
    if (category === "wall") {
      if (kind !== "bearing" && kind !== "partition" && kind !== "virtual") return;
      this.wallRole = kind;
      const floor = this.host.getFloor();
      const annex = this.inAnnexFootprint(x, z, floor);
      const body = annex ? site.annex : {
        ...site.main, z: this.floorData(floor).front,
        d: site.main.z + site.main.d - this.floorData(floor).front,
      };
      // 虚拟墙默认略短，便于拖入后拉到两侧实体墙；实体墙仍用 2000 mm。
      // 横墙 Z 避开外皮，避免落在外轮廓线上被分区算法直接排除。
      const length = Math.min(kind === "virtual" ? 1500 : 2000, body.w);
      const inset = kind === "virtual" ? 150 : 0;
      const start = Math.max(body.x, Math.min(body.x + body.w - length, x - length / 2));
      const at = Math.max(body.z + inset, Math.min(body.z + body.d - inset, z));
      const walls = annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
      const placed: Wall = { a: [start, at], b: [start + length, at], role: kind };
      walls.push(placed);
      this.selection = { kind: "wall", index: walls.length - 1, floor, annex: annex || undefined };
      this.tool = "select";
      const sync = this.afterWallsChanged(floor, annex, placed);
      this.commit();
      if (kind === "virtual" && sync.created === 0 && sync.updated === 0) {
        this.host.toast("已放置虚拟墙：细灰虚线分界；拉长两端接墙后显示分区尺寸");
      }
      return;
    }
    if (category === "room") {
      if (kind === "stair") {
        this.placeStairModelAt(x, z);
        return;
      }
      this.roomKind = kind as Room["kind"];
      this.placeRoomAt(x, z);
      return;
    }
    if (category === "furniture") {
      this.furnitureKind = kind as FurnitureKind;
      this.placeFurnitureAt(x, z);
      return;
    }
    this.openingKind = kind as OpeningKind;
    if (!this.placeOpeningNear(raw.x, raw.z)) {
      this.host.toast("请拖到隔墙或外墙附近");
    }
  }

  /** 放置／移动整套楼梯（三层房间框＋踏步几何一体）。 */
  placeStairModelAt(x: number, z: number) {
    if (this.inAnnexFootprint(x, z, this.host.getFloor())) {
      this.host.toast("楼梯请放在主楼范围内");
      return;
    }
    const existed = draftHasStair(this.draft);
    placeStairAt(this.draft, x, z);
    const snapped = this.magnetSnap && this.snapStairEdges(400);
    this.selection = { kind: "stair" };
    this.tool = "select";
    this.commit();
    this.host.toast(
      existed
        ? snapped
          ? "已将楼梯移到此处并贴附近墙体内侧（一二三层同步）"
          : "已将楼梯移到此处（一二三层同步；开间轴已吸附）"
        : snapped
          ? "已添加楼梯并贴附近墙体内侧（一二三层同步）"
          : "已添加楼梯（一二三层同步；侧墙请自行绘制，一层返跑下方可用）",
    );
  }

  placeRoomAt(x: number, z: number) {
    const floor = this.host.getFloor();
    const annex = this.inAnnexFootprint(x, z, floor);
    const list = this.roomList(floor, annex);
    const body = this.planBody(floor, annex);
    const walls = annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
    const region = findEnclosedRegionAt(x, z, body, walls);
    if (region) {
      const occupied = list.find(r => (!!region.boundaryKey && r.boundary?.key === region.boundaryKey) ||
        (r.x === region.x && r.z === region.z && r.w === region.w && r.d === region.d && roomRegionOverlap(r, region).iou > 0.999));
      if (occupied) {
        this.selection = { kind: "room", id: occupied.id, floor, annex: annex || undefined };
        this.tool = "select";
        this.host.redraw();
        this.host.toast("该围合区已有房间，已选中");
        return;
      }
      if (list.some(r => (r.kind === "void" || r.kind === "stair") && x >= r.x && x <= r.x+r.w && z >= r.z && z <= r.z+r.d)) {
        this.host.toast("此处为挑空或楼梯范围，请先调整对应模型");
        return;
      }
    }
    const room: Room = {
      id: newRoomId("room", list),
      name: annex ? "辅楼房间" : "新房间",
      x: snapMeter(x - 1500),
      z: snapMeter(z - 1500),
      w: 3000,
      d: 3000,
      kind: this.roomKind,
      note: region
        ? "按墙边界生成；色块表示模型净空。设计建议。"
        : "编辑器新增，设计建议。",
    };
    if (region) applyRoomToEnclosedRegion(room, region);
    if (!region) this.snapRoomEdges(room, floor);
    const protection = validateProtectedRoomOverlaps(list, [...list, room]);
    if (!protection.ok) { this.host.toast(protection.reason ?? "该区域覆盖楼梯或挑空"); return; }
    list.push(room);
    this.selection = { kind: "room", id: room.id, floor, annex: annex || undefined };
    this.tool = "select";
    this.commit();
    if (region) this.host.toast("已按墙边界生成房间");
  }

  placeFurnitureAt(x: number, z: number) {
    const floor = this.host.getFloor();
    const annex = this.inAnnexFootprint(x, z, floor);
    const list = this.furnitureList(floor, annex);
    const item = createFurniture(this.furnitureKind, snapMeter(x), snapMeter(z));
    list.push(item);
    this.selection = {
      kind: "furniture",
      index: list.length - 1,
      floor,
      annex: annex || undefined,
    };
    this.tool = "select";
    this.commit();
  }

  /** 在最近点的隔墙／外墙上开门窗；成功返回 true。 */
  placeOpeningNear(x: number, z: number): boolean {
    const floor = this.host.getFloor();
    type Cand = {
      dist: number;
      along: number;
      len: number;
      a: Point;
      b: Point;
      mode: "partition" | "facade";
      index: number;
      annex?: boolean;
      facadeFloor?: number;
    };
    const cands: Cand[] = [];
    const consider = (
      a: Point,
      b: Point,
      mode: Cand["mode"],
      index: number,
      extra: Partial<Cand> = {},
    ) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const along = alongWall(a, b, x, z);
      const t = Math.max(0, Math.min(len, along));
      const px = a[0] + ((b[0] - a[0]) / len) * t;
      const pz = a[1] + ((b[1] - a[1]) / len) * t;
      const dist = Math.hypot(x - px, z - pz);
      if (dist <= 550) cands.push({ dist, along: t, len, a, b, mode, index, ...extra });
    };
    this.floorData(floor).partitions.forEach((w, i) => {
      if (isPhysicalWall(w)) consider(w.a, w.b, "partition", i);
    });
    if (floor === 0) {
      this.draft.annexPartitions.forEach((w, i) => {
        if (isPhysicalWall(w)) consider(w.a, w.b, "partition", i, { annex: true });
      });
    }
    facades(floor).forEach((f, i) => consider(f.a, f.b, "facade", i, { facadeFloor: floor }));
    if (floor === 0) {
      facades(3).forEach((f, i) => consider(f.a, f.b, "facade", i, { facadeFloor: 3 }));
    }
    cands.sort((a, b) => a.dist - b.dist);
    const best = cands[0];
    if (!best) return false;
    const opening = createOpening(this.openingKind, 0);
    opening.offset = snapMeter(
      Math.max(0, Math.min(best.len - opening.width, best.along - opening.width / 2)),
    );
    if (best.mode === "partition") {
      const walls = best.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
      walls[best.index]!.door = opening;
      this.selection = { kind: "door", index: best.index, floor, annex: best.annex };
    } else {
      this.draft = ensureExteriorManaged(this.draft);
      this.draft.exteriorOpenings.push({
        floor: best.facadeFloor ?? floor,
        facadeIndex: best.index,
        opening,
      });
      this.selection = {
        kind: "door",
        index: this.draft.exteriorOpenings.length - 1,
        floor,
        exterior: true,
      };
    }
    this.tool = "select";
    this.commit();
    return true;
  }

  floorData(index = this.host.getFloor()) {
    return this.draft.floors[index];
  }

  /** 选中项所属楼层；无楼层字段时用当前楼层。 */
  private selectionFloor() {
    const sel = this.selection;
    if (sel && "floor" in sel) return sel.floor;
    return this.host.getFloor();
  }

  /** 点是否落在辅楼外轮廓内（一层才有辅楼）。 */
  private inAnnexFootprint(x: number, z: number, floor = this.host.getFloor()) {
    if (floor !== 0) return false;
    const a = site.annex;
    return x >= a.x && x <= a.x + a.w && z >= a.z && z <= a.z + a.d;
  }

  /** 当前平面所属主／辅楼包络（主楼用该层前墙起算进深）。 */
  private planBody(floor: number, annex: boolean) {
    if (annex) return { ...site.annex };
    const f = this.floorData(floor);
    return { ...site.main, z: f.front, d: site.main.z + site.main.d - f.front };
  }

  /**
   * 闭合墙分区：按稳定边界关联已有房间，否则在空区新建。
   * touchWall：只处理贴着刚改墙段的区，避免整层扫走廊。
   */
  private ensureAutoRoomsFromWalls(
    floor: number,
    annex: boolean,
    touchWall?: Wall,
    associateExisting = false,
  ): { created: number; updated: number; issues: string[] } {
    this.ensureWallIds();
    return syncRoomsFromWalls(this.planBody(floor, annex),
      annex ? this.draft.annexPartitions : this.floorData(floor).partitions,
      this.roomList(floor, annex), { touchWall, associateExisting, namePrefix: annex ? "辅楼房间" : "房间" });
  }

  /** 墙体落成／拖完后同步房间；有新建或改尺寸则提示。 */
  private afterWallsChanged(
    floor: number,
    annex: boolean,
    touchWall?: Wall,
    associateExisting = false,
  ): { created: number; updated: number; issues: string[] } {
    const sync = this.ensureAutoRoomsFromWalls(floor, annex, touchWall, associateExisting);
    if (sync.created > 0 && sync.updated > 0) {
      this.host.toast(`已同步房间：新建 ${sync.created} · 更新 ${sync.updated}`);
    } else if (sync.created > 0) {
      this.host.toast(sync.created === 1 ? "已自动生成房间（贴墙内皮）" : `已自动生成 ${sync.created} 个房间`);
    } else if (sync.updated > 0) {
      this.host.toast(sync.updated === 1 ? "已更新房间尺寸" : `已更新 ${sync.updated} 个房间尺寸`);
    }
    if (sync.issues.length) this.host.toast(sync.issues[0]!);
    return sync;
  }

  /** 顶栏按钮：按当前楼层全部墙体围合重新生成／更新房间（不限刚拖的那道墙）。 */
  generateAutoRooms(annex = false): { created: number; updated: number } {
    const floor = this.host.getFloor();
    const before = this.contentKey();
    const sync = this.afterWallsChanged(floor, annex, undefined, true);
    if (sync.created === 0 && sync.updated === 0) {
      this.host.toast(sync.issues[0] ?? "没有新增或变化的闭合房间；开敞分区请手动放置房间");
    } else if (this.contentKey() !== before) {
      this.commit();
    } else {
      this.host.redraw();
    }
    return sync;
  }

  /** 手动放置可采纳闭合区或明确标记的开敞候选区。 */
  private tryFillRoomToRegion(room: Room, floor: number, annex: boolean): boolean {
    if ((room.outline?.length ?? 0) > 4) return false;
    const body = this.planBody(floor, annex);
    const walls = annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
    const region = findEnclosedRegionAt(room.x + room.w / 2, room.z + room.d / 2, body, walls);
    if (!region || room.kind === "void" || room.kind === "stair") return false;
    if (this.roomList(floor, annex).some(r => r.id !== room.id && ((!!region.boundaryKey && r.boundary?.key === region.boundaryKey) ||
      (r.x === region.x && r.z === region.z && r.w === region.w && r.d === region.d && roomRegionOverlap(r, region).iou > 0.999)))) return false;
    const before = structuredClone(room);
    const candidate = structuredClone(room);
    applyRoomToEnclosedRegion(candidate, region);
    const rooms = this.roomList(floor, annex);
    if (!validateProtectedRoomOverlaps(rooms, rooms.map(r => r.id === room.id ? candidate : r)).ok) return false;
    restoreRecord(room, candidate);
    return JSON.stringify(before) !== JSON.stringify(room);
  }

  private roomList(floor: number, annex: boolean): Room[] {
    return annex ? this.draft.annexRooms : this.floorData(floor).rooms;
  }

  private furnitureList(floor: number, annex: boolean): Furniture[] {
    return annex ? this.draft.annexFurniture : this.floorData(floor).furniture;
  }

  private findRoomRef(id: string, floor: number, annexHint?: boolean): { room: Room; annex: boolean } | null {
    if (annexHint) {
      const room = this.draft.annexRooms.find((r) => r.id === id);
      return room ? { room, annex: true } : null;
    }
    if (annexHint === false) {
      const room = this.floorData(floor).rooms.find((r) => r.id === id);
      return room ? { room, annex: false } : null;
    }
    const main = this.floorData(floor).rooms.find((r) => r.id === id);
    if (main) return { room: main, annex: false };
    if (floor === 0) {
      const annex = this.draft.annexRooms.find((r) => r.id === id);
      if (annex) return { room: annex, annex: true };
    }
    return null;
  }

  private parseEditIndex(raw: string | undefined): { index: number; annex: boolean } {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return { index: -1, annex: false };
    if (n >= ANNEX_INDEX_BASE) return { index: n - ANNEX_INDEX_BASE, annex: true };
    return { index: n, annex: false };
  }

  clearSelectionOnFloorChange() {
    this.selection = null;
    this.cancelWallDraft(false);
  }

  getDrawGuide(): DrawGuide | null {
    if (this.wallDraft) {
      const { ax, az, bx, bz, guideXs, guideZs } = this.wallDraft;
      const length = Math.hypot(bx - ax, bz - az);
      return {
        ax,
        az,
        bx,
        bz,
        guideXs,
        guideZs,
        length,
        hint: "水平／竖直 · Esc 取消",
      };
    }
    if (this.dragGuides && (this.dragGuides.xs.length || this.dragGuides.zs.length)) {
      return {
        ax: this.dragGuides.ax,
        az: this.dragGuides.az,
        guideXs: this.dragGuides.xs,
        guideZs: this.dragGuides.zs,
        hint: this.magnetSnap ? "已吸附 · Shift 暂关" : undefined,
      };
    }
    return null;
  }

  /** 是否对本次拖拽启用吸附（总开关开，且未按 Shift）。 */
  private magnetActive(event: PointerEvent) {
    return this.magnetSnap && !event.shiftKey;
  }

  cancelWallDraft(redraw = true) {
    if (!this.wallDraft && !this.wallPreviewAttached) return;
    this.wallDraft = null;
    this.detachWallPreview();
    if (redraw) this.host.redraw();
  }

  private attachWallPreview() {
    if (this.wallPreviewAttached) return;
    window.addEventListener("pointermove", this.onWallPreviewMove);
    this.wallPreviewAttached = true;
  }

  private detachWallPreview() {
    window.removeEventListener("pointermove", this.onWallPreviewMove);
    this.wallPreviewAttached = false;
  }

  private floorAnchors(floor = this.host.getFloor()) {
    const data = this.floorData(floor);
    const annex = floor === 0 ? this.draft.annexPartitions : [];
    const annexRooms = floor === 0 ? this.draft.annexRooms : [];
    return collectLayoutAnchors(
      [...data.rooms, ...annexRooms],
      [...data.partitions, ...annex],
    );
  }

  /** 画墙贴墙吸附：本层隔墙＋辅楼隔墙＋外墙（facade）。 */
  private floorWallSegs(floor = this.host.getFloor()) {
    const data = this.floorData(floor);
    const annex = floor === 0 ? this.draft.annexPartitions : [];
    const walls: Wall[] = [
      ...data.partitions,
      ...annex,
      ...facades(floor).map((f) => ({ a: [...f.a] as Point, b: [...f.b] as Point, role: "bearing" as const })),
    ];
    if (floor === 0) {
      for (const f of facades(3)) {
        walls.push({ a: [...f.a] as Point, b: [...f.b] as Point, role: "bearing" });
      }
    }
    return collectWallSnapSegs(walls);
  }

  private clientToMeter(svg: SVGSVGElement, clientX: number, clientY: number) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    // 户型图内容在 .plan-world（可整体旋转 180°）；用该组 CTM 才能得到世界毫米坐标。
    const world = svg.querySelector(".plan-world") as SVGGElement | null;
    const ctm = world?.getScreenCTM() ?? svg.getScreenCTM();
    if (!ctm) return { x: 0, z: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, z: local.y };
  }

  private currentSvg(fallback?: SVGSVGElement | null) {
    return (document.querySelector(`svg.floor-svg[data-plan-building="${this.activePlanBuilding}"]`) as SVGSVGElement | null)
      ?? fallback ?? (document.querySelector("svg.floor-svg") as SVGSVGElement | null);
  }

  /** 引导线画在 .plan-world 内，与房间／墙同一坐标系。 */
  private planWorldRoot(svg: SVGSVGElement) {
    return (svg.querySelector(".plan-world") as SVGGElement | null) ?? svg;
  }

  private paintDrawGuide(svg: SVGSVGElement) {
    const guide = this.getDrawGuide();
    const existing = svg.querySelector("#edit-draw-guide");
    if (!guide) {
      existing?.remove();
      return;
    }
    const html = renderDrawGuide(guide);
    if (existing) {
      existing.outerHTML = html;
      return;
    }
    this.planWorldRoot(svg).insertAdjacentHTML("beforeend", html);
  }

  bind(svg: SVGSVGElement) {
    const detachWindowDrag = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    const attachWindowDrag = () => {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      const building = svg.dataset.planBuilding ?? "main";
      if (building !== this.activePlanBuilding && this.wallDraft) this.cancelWallDraft(false);
      this.activePlanBuilding = building;
      const edit = target.closest("[data-edit]") as HTMLElement | null;
      const floor = this.host.getFloor();
      const liveSvg = this.currentSvg(svg);
      if (!liveSvg) return;
      // 点画布后移走工具栏按钮焦点，否则方向键会被工具栏吃掉。
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        active !== document.body &&
        active.tagName !== "INPUT" &&
        active.tagName !== "TEXTAREA" &&
        active.tagName !== "SELECT" &&
        !active.isContentEditable
      ) {
        active.blur();
      }
      const raw = this.clientToMeter(liveSvg, event.clientX, event.clientY);
      const { x, z } = { x: snapMeter(raw.x), z: snapMeter(raw.z) };

      if (this.tool === "wall") {
        const magnet = this.magnetActive(event);
        const anchors = magnet ? this.floorAnchors(floor) : [];
        const segs = magnet ? this.floorWallSegs(floor) : [];
        if (!this.wallDraft) {
          const wallStart = magnet
            ? snapPointToWallEdge(raw.x, raw.z, segs, WALL_EDGE_SNAP_GAP)
            : { x: snapMeter(raw.x), z: snapMeter(raw.z), snapped: false, guideXs: [] as number[], guideZs: [] as number[] };
          const start = wallStart.snapped
            ? wallStart
            : magnet
              ? snapToAnchors(raw.x, raw.z, anchors, WALL_EDGE_SNAP_GAP)
              : { x: snapMeter(raw.x), z: snapMeter(raw.z), snapped: false, guideXs: [] as number[], guideZs: [] as number[] };
          this.wallDraft = {
            ax: start.x,
            az: start.z,
            bx: start.x,
            bz: start.z,
            guideXs: start.guideXs,
            guideZs: start.guideZs,
            freeAngle: false,
          };
          this.attachWallPreview();
          this.host.toast("移动定水平或竖直方向，再点完成；Esc 取消");
          this.host.redraw();
          const after = this.currentSvg(svg);
          if (after) {
            this.attachWallPreview();
            this.paintDrawGuide(after);
          }
          return;
        }
        // 新建隔墙只允许水平／竖直，不再支持斜墙。
        const end = refineWallEnd(
          this.wallDraft.ax,
          this.wallDraft.az,
          raw.x,
          raw.z,
          anchors,
          false,
          magnet ? WALL_EDGE_SNAP_GAP : 0,
          segs,
        );
        if (Math.hypot(end.x - this.wallDraft.ax, end.z - this.wallDraft.az) < 300) {
          this.host.toast("隔墙太短，请再移远一点");
          return;
        }
        const wall: Wall = {
          a: [this.wallDraft.ax, this.wallDraft.az],
          b: [end.x, end.z],
          role: this.wallRole,
        };
        forceOrthoWall(wall);
        this.detachWallPreview();
        this.wallDraft = null;
        const midX = (wall.a[0] + wall.b[0]) / 2;
        const midZ = (wall.a[1] + wall.b[1]) / 2;
        const annex = this.inAnnexFootprint(midX, midZ, floor);
        const walls = annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
        walls.push(wall);
        this.selection = {
          kind: "wall",
          index: walls.length - 1,
          floor,
          annex: annex || undefined,
        };
        this.afterWallsChanged(floor, annex, wall);
        this.commit();
        return;
      }

      if (this.tool === "room") {
        if (this.roomKind === "stair") {
          this.placeStairModelAt(x, z);
          return;
        }
        this.placeRoomAt(x, z);
        return;
      }

      if (this.tool === "furniture") {
        this.placeFurnitureAt(x, z);
        return;
      }

      if (this.tool === "door") {
        if (!this.placeOpeningNear(raw.x, raw.z)) {
          this.host.toast("点到隔墙或外墙附近放置门／窗");
        }
        return;
      }

      if (!edit) {
        if (!this.isAdditiveClick(event)) this.selection = null;
        this.host.redraw();
        return;
      }

      const kind = edit.dataset.edit;
      const additive = this.isAdditiveClick(event);

      if (kind === "room") {
        const id = edit.dataset.id!;
        const annex = edit.dataset.annex === "1";
        const found = this.findRoomRef(id, floor, annex);
        if (!found) return;
        // 楼梯房间框与踏步几何一体：点选房间即选中楼梯模型，避免只删一层留下「楼梯」字。
        if (found.room.kind === "stair" && !annex) {
          this.selection = { kind: "stair" };
          this.drag = {
            type: "stair",
            startX: x,
            startZ: z,
            origRoom: structuredClone(this.draft.stairLayout.room),
            origX: this.draft.stairLayout.x,
            origZ: this.draft.stairLayout.z,
            origHole: structuredClone(this.draft.stairLayout.hole),
          };
          this.host.redraw();
          return;
        }
        const target: SelectionItem = {
          kind: "room",
          id,
          floor,
          annex: found.annex || undefined,
        };
        if (additive) {
          this.toggleSelectable(target);
          this.host.redraw();
          return;
        }
        if (!this.isSelectedItem(target)) this.selection = target;
        if (this.healRoomEnvelope(found.room, floor, found.annex)) {
          this.commit();
          this.host.toast("已将贴外皮的房间边对齐楼体外墙");
        }
        const items = this.collectGroupMoveItems(floor);
        this.drag = {
          type: "group-move",
          startX: x,
          startZ: z,
          items: items.length
            ? items
            : [{ kind: "room", id, annex: found.annex, orig: structuredClone(found.room) }],
          partitionsOrig: structuredClone(this.floorData(floor).partitions),
          annexPartitionsOrig: structuredClone(this.draft.annexPartitions),
          roomsOrig: structuredClone(this.floorData(floor).rooms),
          annexRoomsOrig: structuredClone(this.draft.annexRooms),
          furnitureOrig: structuredClone(this.floorData(floor).furniture),
          annexFurnitureOrig: structuredClone(this.draft.annexFurniture),
        };
      } else if (kind === "room-handle") {
        const id = edit.dataset.id!;
        const annex = edit.dataset.annex === "1";
        const found = this.findRoomRef(id, floor, annex);
        if (!found) return;
        if (found.room.kind === "stair" && !annex) {
          this.selection = { kind: "stair" };
          const s = this.draft.stairLayout;
          this.drag = {
            type: "stair-handle",
            corner: edit.dataset.corner!,
            origRoom: structuredClone(s.room),
            origX: s.x,
            origZ: s.z,
            origHole: structuredClone(s.hole),
            origFlight: s.flight,
            origTread: s.tread,
          };
          this.host.redraw();
          return;
        }
        this.selection = { kind: "room", id, floor, annex: found.annex || undefined };
        this.drag = {
          type: "room-handle",
          id,
          annex: found.annex,
          corner: edit.dataset.corner!,
          orig: structuredClone(found.room),
          partitionsOrig: structuredClone(
            found.annex ? this.draft.annexPartitions : this.floorData(floor).partitions,
          ),
          roomsOrig: structuredClone(
            found.annex ? this.draft.annexRooms : this.floorData(floor).rooms,
          ),
        };
      } else if (kind === "furniture") {
        const { index, annex } = this.parseEditIndex(edit.dataset.index);
        const item = this.furnitureList(floor, annex)[index];
        if (!item || index < 0) return;
        const target: SelectionItem = { kind: "furniture", index, floor, annex: annex || undefined };
        if (additive) {
          this.toggleSelectable(target);
          this.host.redraw();
          return;
        }
        if (!this.isSelectedItem(target)) this.selection = target;
        const items = this.collectGroupMoveItems(floor);
        this.drag = {
          type: "group-move",
          startX: x,
          startZ: z,
          items: items.length
            ? items
            : [{ kind: "furniture", index, annex, orig: structuredClone(item) }],
          partitionsOrig: structuredClone(this.floorData(floor).partitions),
          annexPartitionsOrig: structuredClone(this.draft.annexPartitions),
          roomsOrig: structuredClone(this.floorData(floor).rooms),
          annexRoomsOrig: structuredClone(this.draft.annexRooms),
          furnitureOrig: structuredClone(this.floorData(floor).furniture),
          annexFurnitureOrig: structuredClone(this.draft.annexFurniture),
        };
      } else if (kind === "furniture-handle") {
        const { index, annex } = this.parseEditIndex(edit.dataset.index);
        const item = this.furnitureList(floor, annex)[index];
        if (!item || index < 0) return;
        const corner = edit.dataset.corner ?? "se";
        this.selection = { kind: "furniture", index, floor, annex: annex || undefined };
        const cornerLocal = furnitureCornerLocal(item, corner);
        const tip = worldToFurnitureLocal(x, z, item);
        this.drag = {
          type: "furniture-handle",
          index,
          annex,
          corner,
          orig: structuredClone(item),
          grabDlx: tip.lx - cornerLocal.lx,
          grabDlz: tip.lz - cornerLocal.lz,
        };
      } else if (kind === "furniture-rotate") {
        // 蓝点只旋转已选中家具；周边空白与未选中时都不当选中入口。
        const { index, annex } = this.parseEditIndex(edit.dataset.index);
        const item = this.furnitureList(floor, annex)[index];
        if (!item || index < 0) return;
        const target: SelectionItem = { kind: "furniture", index, floor, annex: annex || undefined };
        if (!this.isSelectedItem(target)) return;
        this.drag = {
          type: "furniture-rotate",
          index,
          annex,
          startAngle: Math.atan2(z - item.z, x - item.x),
          origRotation: item.rotation ?? 0,
          orig: structuredClone(item),
        };
      } else if (kind === "wall" || kind === "wall-handle") {
        const { index: wallIndex, annex } = this.parseEditIndex(edit.dataset.index);
        const wall = (annex ? this.draft.annexPartitions : this.floorData(floor).partitions)[wallIndex];
        if (!wall) return;
        this.selection = { kind: "wall", index: wallIndex, floor, annex };
        const end =
          kind === "wall-handle" && (edit.dataset.end === "a" || edit.dataset.end === "b")
            ? edit.dataset.end
            : "move";
        // 开拖前先扶正，后续只沿水平／竖直轴移动。
        forceOrthoWall(wall);
        this.drag = { type: "wall", index: wallIndex, annex, end, startX: x, startZ: z, orig: structuredClone(wall), wallsOrig: structuredClone(annex ? this.draft.annexPartitions : this.floorData(floor).partitions), roomsOrig: structuredClone(this.roomList(floor, annex)) };
      } else if (kind === "door" || kind === "door-handle") {
        const exterior = edit.dataset.exterior === "1";
        if (exterior) {
          const index = Number(edit.dataset.index);
          const item = this.draft.exteriorOpenings[index];
          if (!item) return;
          const facade = facades(item.floor)[item.facadeIndex];
          if (!facade) return;
          this.selection = { kind: "door", index, floor, exterior: true };
          if (kind === "door-handle") {
            this.drag = {
              type: "door-handle",
              index,
              annex: false,
              exterior: true,
              end: (edit.dataset.end as "start" | "end") ?? "start",
              origOpening: structuredClone(normalizeOpening(item.opening)),
              wallA: [...facade.a] as Point,
              wallB: [...facade.b] as Point,
            };
          } else {
            this.drag = {
              type: "door",
              index,
              annex: false,
              exterior: true,
              startOffset: item.opening.offset,
              startX: x,
              startZ: z,
              origOpening: structuredClone(normalizeOpening(item.opening)),
              wallA: [...facade.a] as Point,
              wallB: [...facade.b] as Point,
            };
          }
        } else {
          const { index: wallIndex, annex } = this.parseEditIndex(edit.dataset.index);
          const wall = (annex ? this.draft.annexPartitions : this.floorData(floor).partitions)[wallIndex];
          if (!wall?.door) return;
          this.selection = { kind: "door", index: wallIndex, floor, annex };
          if (kind === "door-handle") {
            this.drag = {
              type: "door-handle",
              index: wallIndex,
              annex,
              exterior: false,
              end: (edit.dataset.end as "start" | "end") ?? "start",
              origOpening: structuredClone(normalizeOpening(wall.door)),
              wallA: [...wall.a] as Point,
              wallB: [...wall.b] as Point,
            };
          } else {
            this.drag = {
              type: "door",
              index: wallIndex,
              annex,
              exterior: false,
              startOffset: wall.door.offset,
              startX: x,
              startZ: z,
              origOpening: structuredClone(normalizeOpening(wall.door)),
              wallA: [...wall.a] as Point,
              wallB: [...wall.b] as Point,
            };
          }
        }
      } else if (kind === "portico") {
        this.selection = { kind: "portico" };
        const edge = Math.abs(x - (this.draft.portico.x + this.draft.portico.w)) < 350
          ? "resize-e"
          : Math.abs(x - this.draft.portico.x) < 350
            ? "resize-w"
            : "move";
        this.drag = {
          type: "portico",
          startX: x,
          origX: this.draft.portico.x,
          origW: this.draft.portico.w,
          mode: edge,
        };
      } else if (kind === "stair") {
        this.selection = { kind: "stair" };
        this.drag = {
          type: "stair",
          startX: x,
          startZ: z,
          origRoom: structuredClone(this.draft.stairLayout.room),
          origX: this.draft.stairLayout.x,
          origZ: this.draft.stairLayout.z,
          origHole: structuredClone(this.draft.stairLayout.hole),
        };
      } else if (kind === "stair-handle") {
        this.selection = { kind: "stair" };
        const s = this.draft.stairLayout;
        this.drag = {
          type: "stair-handle",
          corner: edit.dataset.corner!,
          origRoom: structuredClone(s.room),
          origX: s.x,
          origZ: s.z,
          origHole: structuredClone(s.hole),
          origFlight: s.flight,
          origTread: s.tread,
        };
      } else {
        return;
      }

      // 拖拽期间 SVG 会整页重绘，监听挂在 window 上以免 pointerup 丢失。
      this.dragStartKey = this.contentKey();
      attachWindowDrag();
      this.host.redraw();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!this.drag) return;
      const liveSvg = this.currentSvg(svg);
      if (!liveSvg) return;
      const { x, z } = this.clientToMeter(liveSvg, event.clientX, event.clientY);
      const floor = this.selectionFloor();

      if (this.drag.type === "group-move") {
        const drag = this.drag;
        const dx = x - drag.startX;
        const dz = z - drag.startZ;
        this.dragGuides = null;
        for (const item of drag.items) {
          if (item.kind === "furniture") {
            const furn = this.furnitureList(floor, item.annex)[item.index];
            if (!furn) continue;
            furn.x = snapMeter(item.orig.x + dx);
            furn.z = snapMeter(item.orig.z + dz);
          } else {
            const found = this.findRoomRef(item.id, floor, item.annex);
            if (!found) continue;
            const room = found.room;
            if (room.kind === "void" || room.kind === "stair") continue;
            const clamped = this.roomTranslation(item.orig, item.orig.x + dx, item.orig.z + dz, floor, item.annex);
            this.translateRoom(room, item.orig, clamped.x - item.orig.x, clamped.z - item.orig.z);
          }
        }
        // 单件家具：贴墙内皮／净空角；接近中线出引导并吸居中。Shift 暂关。
        if (this.magnetActive(event) && drag.items.length === 1 && drag.items[0]!.kind === "furniture") {
          const only = drag.items[0]!;
          const furn = this.furnitureList(floor, only.annex)[only.index];
          if (furn) {
            const ctx = this.furnitureMagnetContext(floor, only.annex);
            const room = findRoomContaining(furn, ctx.rooms);
            const guides = snapFurnitureDuringDrag(furn, ctx.xs, ctx.zs, {
              corners: ctx.corners,
              room,
              floorIndex: floor,
              partitions: ctx.partitions,
              furniture: ctx.furniture,
              excludeFurnitureIndex: only.index,
              allowCenter: true,
            });
            this.setDragGuides(furn.x, furn.z, guides.guideXs, guides.guideZs);
          }
        } else if (this.magnetActive(event) && drag.items.length === 1 && drag.items[0]!.kind === "room") {
          const only = drag.items[0]!;
          const found = this.findRoomRef(only.id, floor, only.annex);
          if (found) {
            const before = { x: found.room.x, z: found.room.z };
            this.snapRoomEdges(found.room, floor, 150);
            if (found.room.x !== before.x || found.room.z !== before.z) {
              this.setDragGuides(found.room.x + found.room.w / 2, found.room.z + found.room.d / 2, [found.room.x, found.room.x + found.room.w], [found.room.z, found.room.z + found.room.d]);
            }
          }
        }
        // 房内家具按房间最终位移（含磁吸）从拖始快照对齐；墙体不随房间移动。
        for (const item of drag.items) {
          if (item.kind !== "room") continue;
          const found = this.findRoomRef(item.id, floor, item.annex);
          if (!found) continue;
          const rdx = found.room.x - item.orig.x;
          const rdz = found.room.z - item.orig.z;
          const rooms = item.annex ? drag.annexRoomsOrig : drag.roomsOrig;
          const furn = item.annex ? this.draft.annexFurniture : this.floorData(floor).furniture;
          const furnOrig = item.annex ? drag.annexFurnitureOrig : drag.furnitureOrig;
          const skip = new Set(
            drag.items
              .filter((it): it is Extract<GroupMoveItem, { kind: "furniture" }> =>
                it.kind === "furniture" && it.annex === item.annex,
              )
              .map((it) => it.index),
          );
          translateFurnitureInsideRoom(item.orig, rdx, rdz, furn, furnOrig, rooms, skip);
        }
        this.validateGroupRoomMove(floor, drag);
        this.host.redraw();
      } else if (this.drag.type === "room-handle") {
        const drag = this.drag;
        const found = this.findRoomRef(drag.id, floor, drag.annex);
        if (!found) return;
        const room = found.room;
        if ((drag.orig.outline?.length ?? 0) > 4 || room.kind === "void" || room.kind === "stair") return;
        const next = resizeRoomFromCorner(drag.orig, drag.corner, x, z);
        const walls = drag.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
        const rooms = this.roomList(floor, drag.annex);
        walls.forEach((w,i) => restoreRecord(w, drag.partitionsOrig[i]!));
        rooms.forEach((r,i) => restoreRecord(r, drag.roomsOrig[i]!));
        const bounded = clampRoomToEnvelope({ ...drag.orig, ...next }, this.planBody(floor, drag.annex), 0);
        const result = syncInteriorWallsToRoom(drag.orig, bounded, walls, rooms, this.planBody(floor, drag.annex));
        if (result.ok) {
          Object.assign(room, bounded);
          room.label = [room.x + room.w/2, room.z + room.d/2];
          delete room.outline;
          this.syncRoomBoundaries(floor, drag.annex, drag.partitionsOrig, drag.roomsOrig, false);
        }
        this.host.redraw();
      } else if (this.drag.type === "furniture-handle") {
        const drag = this.drag;
        const item = this.furnitureList(floor, drag.annex)[drag.index];
        if (!item) return;
        const o = drag.orig;
        const next = resizeFurnitureFromCorner(o, drag.corner, x, z, 300, {
          dlx: drag.grabDlx,
          dlz: drag.grabDlz,
        });
        item.w = next.w;
        item.d = next.d;
        item.x = next.x;
        item.z = next.z;
        item.rotation = o.rotation;
        this.host.redraw();
      } else if (this.drag.type === "furniture-rotate") {
        const drag = this.drag;
        const item = this.furnitureList(floor, drag.annex)[drag.index];
        if (!item) return;
        const angle = Math.atan2(z - drag.orig.z, x - drag.orig.x);
        let next = drag.origRotation + (angle - drag.startAngle);
        if (!event.shiftKey) next = snapRotation(next, 15);
        else next = normalizeRotation(next);
        item.rotation = next;
        item.x = drag.orig.x;
        item.z = drag.orig.z;
        this.host.redraw();
      } else if (this.drag.type === "wall") {
        const walls = this.drag.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
        const wall = walls[this.drag.index];
        if (!wall) return;
        const wallDrag = this.drag;
        walls.forEach((w, i) => restoreRecord(w, wallDrag.wallsOrig[i]!));
        this.roomList(floor, wallDrag.annex).forEach((r, i) => restoreRecord(r, wallDrag.roomsOrig[i]!));
        // 隔墙始终水平／竖直：平移只走垂直于墙的方向，拉端点只沿原轴向伸缩。
        const axis = wallAxis(this.drag.orig);
        this.dragGuides = null;
        if (this.drag.end === "move") {
          let dx = x - this.drag.startX;
          let dz = z - this.drag.startZ;
          if (axis === "h") dx = 0;
          else dz = 0;
          wall.a = [snapMeter(this.drag.orig.a[0] + dx), snapMeter(this.drag.orig.a[1] + dz)];
          wall.b = [snapMeter(this.drag.orig.b[0] + dx), snapMeter(this.drag.orig.b[1] + dz)];
          forceOrthoWall(wall);
        } else {
          const fixed = this.drag.end === "a" ? this.drag.orig.b : this.drag.orig.a;
          const other: Point =
            axis === "h" ? [snapMeter(x), fixed[1]] : [fixed[0], snapMeter(z)];
          if (Math.hypot(other[0] - fixed[0], other[1] - fixed[1]) < 300) {
            this.host.redraw();
            return;
          }
          if (this.drag.end === "a") {
            wall.a = other;
            wall.b = [...fixed] as Point;
          } else {
            wall.a = [...fixed] as Point;
            wall.b = other;
          }
          forceOrthoWall(wall);
        }

        if (this.magnetActive(event)) {
          const anchors = this.roomSnapAxes(floor);
          const guides = snapWallDuringDrag(
            wall,
            this.drag.end,
            this.wallMagnetCandidates(floor, this.drag.index, this.drag.annex),
            anchors,
          );

          const midX = (wall.a[0] + wall.b[0]) / 2;
          const midZ = (wall.a[1] + wall.b[1]) / 2;
          this.setDragGuides(midX, midZ, guides.guideXs, guides.guideZs);
        }
        this.finishWallEdit(floor, this.drag.annex, this.drag.wallsOrig, [this.drag.index], this.drag.roomsOrig, false);
        this.host.redraw();
      } else if (this.drag.type === "door") {
        const drag = this.drag;
        const opening = this.getOpeningRef(drag.index, drag.annex, drag.exterior);
        if (!opening) return;
        const len = Math.hypot(drag.wallB[0] - drag.wallA[0], drag.wallB[1] - drag.wallA[1]) || 1;
        const ux = (drag.wallB[0] - drag.wallA[0]) / len;
        const uz = (drag.wallB[1] - drag.wallA[1]) / len;
        const along = (x - drag.startX) * ux + (z - drag.startZ) * uz;
        opening.offset = snapMeter(Math.min(len - opening.width, Math.max(0, drag.startOffset + along)));
        this.host.redraw();
      } else if (this.drag.type === "door-handle") {
        const drag = this.drag;
        const opening = this.getOpeningRef(drag.index, drag.annex, drag.exterior);
        if (!opening) return;
        const len = Math.hypot(drag.wallB[0] - drag.wallA[0], drag.wallB[1] - drag.wallA[1]) || 1;
        const along = alongWall(drag.wallA, drag.wallB, x, z);
        const o = drag.origOpening;
        if (drag.end === "start") {
          const end = o.offset + o.width;
          const next = snapMeter(Math.max(0, Math.min(end - 300, along)));
          opening.offset = next;
          opening.width = snapMeter(end - next);
        } else {
          const next = snapMeter(Math.max(o.offset + 300, Math.min(len, along)));
          opening.offset = o.offset;
          opening.width = snapMeter(next - o.offset);
        }
        this.host.redraw();
      } else if (this.drag.type === "portico") {
        const dx = x - this.drag.startX;
        if (this.drag.mode === "move") {
          this.draft.portico.x = snapMeter(this.drag.origX + dx);
        } else if (this.drag.mode === "resize-e") {
          this.draft.portico.w = Math.max(2400, snapMeter(this.drag.origW + dx));
        } else {
          const nextX = snapMeter(this.drag.origX + dx);
          const nextW = Math.max(2400, snapMeter(this.drag.origW - dx));
          this.draft.portico.x = nextX;
          this.draft.portico.w = nextW;
        }
        this.host.redraw();
      } else if (this.drag.type === "stair") {
        const dx = x - this.drag.startX;
        const dz = z - this.drag.startZ;
        const room = this.draft.stairLayout.room;
        room.x = snapMeter(this.drag.origRoom.x + dx);
        room.z = snapMeter(this.drag.origRoom.z + dz);
        this.draft.stairLayout.x = snapMeter(this.drag.origX + dx);
        this.draft.stairLayout.z = snapMeter(this.drag.origZ + dz);
        this.draft.stairLayout.hole.x = snapMeter(this.drag.origHole.x + dx);
        this.draft.stairLayout.hole.z = snapMeter(this.drag.origHole.z + dz);
        this.syncStairRooms();
        // 拖移中也贴附近墙体内侧（与房间一致；松手再吸一次作兜底）
        if (this.magnetActive(event) && this.snapStairEdges(150)) {
          this.setDragGuides(
            room.x + room.w / 2,
            room.z + room.d / 2,
            [room.x, room.x + room.w],
            [room.z, room.z + room.d],
          );
        }
        this.host.redraw();
      } else if (this.drag.type === "stair-handle") {
        const drag = this.drag;
        const o = drag.origRoom;
        const room = this.draft.stairLayout.room;
        const next = resizeRoomFromCorner(o, drag.corner, x, z, 2400);
        room.x = next.x;
        room.z = next.z;
        room.w = next.w;
        room.d = next.d;
        this.syncStairRooms();
        this.host.redraw();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!this.drag) {
        detachWindowDrag();
        return;
      }
      const ended = this.drag;
      const floorNow = this.selectionFloor();
      this.drag = null;
      this.dragGuides = null;
      detachWindowDrag();
      const changedDuringDrag = this.contentKey() !== this.dragStartKey;
      // 房间拖移：磁吸开启时可采纳分区；尺寸拉角按墙体事务同步。
      if (changedDuringDrag && ended.type === "room-handle") {
        const found = this.findRoomRef(ended.id, floorNow, ended.annex);
        if (found) this.syncRoomBoundaries(floorNow, ended.annex, ended.partitionsOrig, ended.roomsOrig);
      } else if (changedDuringDrag && ended.type === "group-move") {
        for (const item of ended.items) {
          if (item.kind === "room") {
            const found = this.findRoomRef(item.id, floorNow, item.annex);
            if (found) {
              if (this.magnetActive(event)) this.snapRoomEdges(found.room, floorNow);
              // 磁吸开启才采纳分区，关闭或Shift时保持手动轮廓
              if (this.magnetActive(event) && this.tryFillRoomToRegion(found.room, floorNow, !!item.annex)) {
                this.host.toast("房间已撑满围合区");
              }
              const rdx = found.room.x - item.orig.x;
              const rdz = found.room.z - item.orig.z;
              const rooms = item.annex ? ended.annexRoomsOrig : ended.roomsOrig;
              const furn = item.annex ? this.draft.annexFurniture : this.floorData(floorNow).furniture;
              const furnOrig = item.annex ? ended.annexFurnitureOrig : ended.furnitureOrig;
              const skip = new Set(
                ended.items
                  .filter((it): it is Extract<GroupMoveItem, { kind: "furniture" }> =>
                    it.kind === "furniture" && it.annex === item.annex,
                  )
                  .map((it) => it.index),
              );
              translateFurnitureInsideRoom(item.orig, rdx, rdz, furn, furnOrig, rooms, skip);
            }
          } else {
            this.clearFurnitureFromWalls(floorNow, item.annex, item.index);
          }
        }
        this.validateGroupRoomMove(floorNow, ended, true);
      } else if (changedDuringDrag && (ended.type === "furniture-handle" || ended.type === "furniture-rotate")) {
        this.clearFurnitureFromWalls(floorNow, ended.annex, ended.index);
      } else if (changedDuringDrag && ended.type === "wall") {
        const walls = ended.annex ? this.draft.annexPartitions : this.floorData(floorNow).partitions;
        const wall = walls[ended.index];
        if (wall) {
          this.afterWallsChanged(floorNow, !!ended.annex, wall);
        }
      } else if (
        changedDuringDrag &&
        (ended.type === "stair" || ended.type === "stair-handle") &&
        this.magnetActive(event)
      ) {
        if (this.snapStairEdges(ended.type === "stair-handle" ? 200 : 150)) {
          this.host.toast("楼梯间已贴附近墙体内侧");
        }
      }
      // 仅点选、未真正改几何时不入撤销栈（否则点一次撤销像没反应）。
      if (this.contentKey() !== this.dragStartKey) this.commit();
      else this.host.redraw();
    };

    svg.addEventListener("pointerdown", onPointerDown);
    if (this.wallDraft && (svg.dataset.planBuilding ?? "main") === this.activePlanBuilding) {
      this.attachWallPreview();
      this.paintDrawGuide(svg);
    }

    return () => {
      svg.removeEventListener("pointerdown", onPointerDown);
      // 拖拽／画墙预览挂在 window，重绘 unbind 时勿摘掉。
      if (!this.drag) detachWindowDrag();
    };
  }

  /** 拖隔墙时的其它墙候选（本楼隔墙＋外墙＋辅楼隔墙，排除自身）。 */
  private wallMagnetCandidates(floor: number, index: number, annex: boolean): Wall[] {
    const main = this.floorData(floor).partitions;
    const annexWalls = floor === 0 ? this.draft.annexPartitions : [];
    const list: Wall[] = [];
    main.forEach((w, i) => {
      if (!annex && i === index) return;
      list.push(w);
    });
    annexWalls.forEach((w, i) => {
      if (annex && i === index) return;
      list.push(w);
    });
    for (const facade of facades(floor)) {
      list.push({ a: [...facade.a] as Point, b: [...facade.b] as Point });
    }
    if (floor === 0) {
      for (const facade of facades(3)) {
        list.push({ a: [...facade.a] as Point, b: [...facade.b] as Point });
      }
    }
    return list;
  }

  /** 家具磁吸上下文：房内用净空锚点；房外退回墙线／外轮廓。 */
  private furnitureMagnetContext(floor: number, annex = false) {
    const { xs, zs } = this.roomSnapAxes(floor);
    const roomPartitions = annex
      ? this.draft.annexPartitions
      : this.floorData(floor).partitions;
    const partitions = [
      ...this.floorData(floor).partitions,
      ...(floor === 0 ? this.draft.annexPartitions : []),
    ];
    for (const facade of facades(floor)) {
      partitions.push({ a: [...facade.a] as Point, b: [...facade.b] as Point });
    }
    const rooms = annex
      ? this.draft.annexRooms
      : floor === 0
        ? [...this.floorData(0).rooms, ...this.draft.annexRooms]
        : this.floorData(floor).rooms;
    const furniture = this.furnitureList(floor, annex);
    const bounds =
      floor === 0
        ? [
            {
              x0: site.annex.x,
              x1: site.annex.x + site.annex.w,
              z0: site.annex.z,
              z1: site.annex.z + site.annex.d,
            },
            {
              x0: site.main.x,
              x1: site.main.x + site.main.w,
              z0: site.main.z,
              z1: site.main.z + site.main.d,
            },
          ]
        : [
            {
              x0: site.main.x,
              x1: site.main.x + site.main.w,
              z0: this.floorData(floor).front,
              z1: site.main.z + site.main.d,
            },
          ];
    const corners = collectCornerSnapPoints({ partitions, rooms, bounds });
    return {
      xs,
      zs,
      corners,
      rooms,
      partitions: roomPartitions,
      furniture,
    };
  }

  private setDragGuides(ax: number, az: number, xs: number[], zs: number[]) {
    if (!xs.length && !zs.length) {
      this.dragGuides = null;
      return;
    }
    this.dragGuides = { ax, az, xs, zs };
  }

  /** 房间框沿用外皮口径，不吸到外墙中线；主辅楼分开收集，避免隔空吸附。 */
  private roomSnapAxes(floor: number, excludeRoomId?: string, forRoom?: Room) {
    const isAnnex = floor === 0 && (
      (forRoom && this.draft.annexRooms.some((r) => r.id === forRoom.id)) ||
      (excludeRoomId != null && this.draft.annexRooms.some((r) => r.id === excludeRoomId))
    );
    const bodies = excludeRoomId || forRoom
      ? [isAnnex ? site.annex : { ...site.main, z: this.floorData(floor).front, d: site.main.z + site.main.d - this.floorData(floor).front }]
      : [
          { ...site.main, z: this.floorData(floor).front, d: site.main.z + site.main.d - this.floorData(floor).front },
          ...(floor === 0 ? [site.annex] : []),
        ];
    const partitions = excludeRoomId || forRoom
      ? isAnnex ? this.draft.annexPartitions : this.floorData(floor).partitions
      : [...this.floorData(floor).partitions, ...(floor === 0 ? this.draft.annexPartitions : [])];
    const rooms = excludeRoomId || forRoom
      ? isAnnex ? this.draft.annexRooms : this.floorData(floor).rooms
      : [...this.floorData(floor).rooms, ...(floor === 0 ? this.draft.annexRooms : [])];
    return collectRoomSnapAxes({
      partitions, rooms, excludeRoomId, forRoom,
      bounds: bodies.map((b) => ({ x0: b.x, x1: b.x + b.w, z0: b.z, z1: b.z + b.d })),
    });
  }

  /** 只在鼠标附近贴墙体内侧，不能松手后跨数米移动整间房，也不能吸到墙中／外侧。 */
  private snapRoomEdges(room: Room, floor: number, maxGap = 150) {
    if ((room.outline?.length ?? 0) > 4 || room.kind === "void" || room.kind === "stair") return false;
    const before = { x: room.x, z: room.z };
    const annex = this.draft.annexRooms.some((r) => r.id === room.id);
    const partitions = annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
    const { xs, zs } = this.roomSnapAxes(floor, room.id, room);
    const original = structuredClone(room);
    snapRoomToNearestWalls(room, xs, zs, maxGap, partitions);
    this.translateRoom(room, original, room.x - before.x, room.z - before.z);
    return room.x !== before.x || room.z !== before.z;
  }

  /**
   * 房间边若已靠近楼体外皮却差几毫米／十来毫米，吸到外皮精确坐标并推内墙。
   * 避免面板宽 3900、外圈标线却是 3888。
   */
  private healRoomEnvelope(room: Room, floor: number, annex: boolean): boolean {
    const body = annex
      ? site.annex
      : {
          ...site.main,
          z: this.floorData(floor).front,
          d: site.main.z + site.main.d - this.floorData(floor).front,
        };
    const rooms = annex ? this.draft.annexRooms : this.floorData(floor).rooms;
    const walls = annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
    const roomOrig = {
      ...room,
      label: room.label ? ([...room.label] as [number, number]) : undefined,
    };
    const clamped = clampRoomToEnvelope(room, body);
    if (
      Math.abs(clamped.x - room.x) < 0.5 &&
      Math.abs(clamped.z - room.z) < 0.5 &&
      Math.abs(clamped.w - room.w) < 0.5 &&
      Math.abs(clamped.d - room.d) < 0.5
    ) {
      return false;
    }
    if (!syncInteriorWallsToRoom(roomOrig, clamped, walls, rooms, body).ok) return false;
    room.x = clamped.x;
    room.z = clamped.z;
    room.w = clamped.w;
    room.d = clamped.d;
    room.label = [room.x + room.w / 2, room.z + room.d / 2];
    return true;
  }

  /**
   * 楼梯间框吸附到附近墙体内侧（与房间同一套内侧轴），并带着踏步／洞口整体平移。
   * 返回是否发生了位移。
   */
  private snapStairEdges(maxGap = 150): boolean {
    const s = this.draft.stairLayout;
    const room = s.room;
    const before = { x: room.x, z: room.z, sx: s.x, sz: s.z, hx: s.hole.x, hz: s.hole.z };
    const floor = this.host.getFloor();
    const partitions = this.floorData(floor).partitions;
    const { xs, zs } = this.roomSnapAxes(floor, undefined, room as Room);
    snapRoomToNearestWalls(room as Room, xs, zs, maxGap, partitions);
    const dx = room.x - before.x;
    const dz = room.z - before.z;
    if (Math.abs(dx) < 0.5 && Math.abs(dz) < 0.5) return false;
    s.x = snapMeter(before.sx + dx);
    s.z = snapMeter(before.sz + dz);
    s.hole.x = snapMeter(before.hx + dx);
    s.hole.z = snapMeter(before.hz + dz);
    this.syncStairRooms();
    return true;
  }

  updateSelectedNumber(field: string, value: number) {
    if (!Number.isFinite(value)) return;
    const floor = this.selectionFloor();
    const sel = this.selection;
    if (!sel) return;
    if (sel.kind === "room") {
      const found = this.findRoomRef(sel.id, floor, !!sel.annex);
      if (!found) return;
      const room = found.room;
      if (field === "x" || field === "z" || field === "w" || field === "d") {
        const next = field === "w" || field === "d" ? Math.max(800, value) : value;
        if (room.kind === "void" || room.kind === "stair") {
          this.host.toast("挑空与楼梯请通过对应模型参数调整，保持各层洞口一致");
          return;
        }
        const original = structuredClone(room);
        const body = this.planBody(floor, found.annex);
        if (field === "x" || field === "z") {
          const bounded = this.roomTranslation(original, field === "x" ? next : room.x, field === "z" ? next : room.z, floor, found.annex);
          const furniture = this.furnitureList(floor, found.annex);
          const furnitureOrig = structuredClone(furniture);
          const roomsOrig = structuredClone(this.roomList(floor, found.annex));
          this.translateRoom(room, original, bounded.x-original.x, bounded.z-original.z);
          const protection = validateProtectedRoomOverlaps(roomsOrig, this.roomList(floor, found.annex));
          if (!protection.ok) {
            restoreRecord(room, original);
            this.host.toast(protection.reason ?? "房间不能新增覆盖楼梯或挑空");
            this.host.redraw();
            return;
          }
          translateFurnitureInsideRoom(original, room.x-original.x, room.z-original.z, furniture, furnitureOrig, roomsOrig);
        } else {
          if ((room.outline?.length ?? 0) > 4) {
            this.host.toast("凹形房间请调整各段墙线；外包络宽深不能代表各边尺寸");
            return;
          }
          const rooms = this.roomList(floor, found.annex);
          const walls = found.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
          const wallsOrig = structuredClone(walls);
          const roomsOrig = structuredClone(rooms);
          const anchored = anchorRoomSizeAgainstEnvelope(room, field, next, body, this.magnetSnap ? 120 : 0);
          if (!this.magnetSnap) {
            // 无磁吸时不改无关轴坐标；仍保留恰好贴外墙时的锁边约束。
            if (field === "d") { anchored.x = original.x; anchored.w = original.w; }
            else { anchored.z = original.z; anchored.d = original.d; }
          }
          if (Math.abs(anchored[field] - snapMeter(next)) > 1) {
            this.host.toast("请求尺寸超出本层外墙包络，未修改");
            return;
          }
          const result = syncInteriorWallsToRoom(original, anchored, walls, rooms, body);
          if (!result.ok) { this.host.toast(result.reason ?? "房间尺寸与相邻边界冲突"); return; }
          Object.assign(room, anchored);
          delete room.outline;
          room.label = [room.x+room.w/2, room.z+room.d/2];
          if (!this.syncRoomBoundaries(floor, found.annex, wallsOrig, roomsOrig)) return;
          this.host.toast("已同步房间与相接墙线；尺寸为墙线控制尺寸");
        }
      }
    } else if (sel.kind === "furniture") {
      const item = this.furnitureList(floor, !!sel.annex)[sel.index];
      if (!item) return;
      if (field === "x" || field === "z") item[field] = snapMeter(value);
      if (field === "w" || field === "d") {
        const next = Math.max(300, snapMeter(value));
        if (item.kind === "roundTable") {
          item.w = next;
          item.d = next;
        } else {
          item[field] = next;
        }
      }
      if (field === "rotationDeg") item.rotation = degToRotation(value);
      if (field === "rotation") item.rotation = normalizeRotation(value);
    } else if (sel.kind === "door") {
      const opening = this.getOpeningRef(sel.index, !!sel.annex, !!sel.exterior);
      if (!opening) return;
      const endpoints = this.getSelectedOpeningWall();
      if (!endpoints) return;
      const length = Math.hypot(endpoints.b[0]-endpoints.a[0], endpoints.b[1]-endpoints.a[1]);
      if (field === "offset") opening.offset = snapMeter(Math.max(0, Math.min(length-opening.width, value)));
      if (field === "width" || field === "length") {
        const width = snapMeter(Math.max(300, value));
        if (width > length) { this.host.toast("门窗洞口宽度不能大于所在墙段"); return; }
        opening.width = width;
        opening.offset = snapMeter(Math.max(0, Math.min(length-width, opening.offset)));
      }
    } else if (sel.kind === "wall") {
      const walls = sel.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
      const wall = walls[sel.index];
      if (!wall) return;
      if (field === "length") {
        const originals = structuredClone(walls);
        const roomsOrig = structuredClone(this.roomList(floor, !!sel.annex));
        if (wall.door && value < wall.door.width) { this.host.toast("墙长不能小于门窗洞口宽度"); return; }
        setWallLength(wall, value, "center");
        if (!this.finishWallEdit(floor, !!sel.annex, originals, [sel.index], roomsOrig)) return;
        this.afterWallsChanged(floor, !!sel.annex, wall);
      }
    } else if (sel.kind === "portico") {
      if (field === "x" || field === "w" || field === "projection") this.draft.portico[field] = snapMeter(value);
    } else if (sel.kind === "stair") {
      const s = this.draft.stairLayout;
      const fitted = fitStairToRoom(s, this.draft.floors);
      if (field === "x" || field === "z") {
        // 起点是贴边排布的派生值；改坐标须移动整个梯间，不能把踏步单独挪出框。
        s.room[field] = snapMeter(s.room[field] + value - fitted[field]);
      }
      if (field === "flight") {
        const axis = s.axis === "z" ? "w" : "d";
        s.room[axis] = Math.max(2400, snapMeter(s.room[axis] + 2 * (Math.max(800, value) - fitted.flight)));
      }
      if (field === "gap") s.gap = Math.max(100, snapMeter(value));
      if (field === "tread") {
        const axis = s.axis === "z" ? "d" : "w";
        const shape = stairShape(fitted);
        const count = Math.max(shape.lowerTreads, shape.upperTreads);
        s.room[axis] = Math.max(2400, snapMeter(s.room[axis] + count * (Math.max(200, value) - fitted.tread)));
      }
      if (field === "landing") s.landing = Math.max(500, snapMeter(value));
      if (field === "roomW") s.room.w = Math.max(2400, snapMeter(value));
      if (field === "roomD") s.room.d = Math.max(2400, snapMeter(value));
      this.syncStairRooms();
    }
    this.commit();
  }

  /**
   * 切换楼梯走向：x＝两跑沿东西（下跑向东），z＝两跑沿南北（下跑向南）。
   * 以楼梯间中心为不动点对调宽／进深，再按新边界排布踏步和洞口。
   */
  setStairAxis(next: "x" | "z") {
    if (this.selection?.kind !== "stair") return;
    const s = this.draft.stairLayout;
    if (s.axis === next) return;
    const room = s.room;
    const rcx = room.x + room.w / 2;
    const rcz = room.z + room.d / 2;
    const rw = room.w;
    room.w = room.d;
    room.d = rw;
    room.x = snapMeter(rcx - room.w / 2);
    room.z = snapMeter(rcz - room.d / 2);
    s.axis = next;
    this.syncStairRooms();
    this.commit();
    this.host.toast(next === "x" ? "楼梯已改为东西向（左右折返）" : "楼梯已改为南北向（竖向折返）");
  }

  setStairLowerSide(side: "min" | "max") {
    if (this.selection?.kind !== "stair") return;
    this.draft.stairLayout.lowerSide = side;
    this.syncStairRooms();
    this.commit();
  }

  updateSelectedName(name: string) {
    const sel = this.selection;
    if (!sel) return;
    const next = name.slice(0, 40);
    if (sel.kind === "room") {
      const found = this.findRoomRef(sel.id, this.selectionFloor(), !!sel.annex);
      if (!found) return;
      found.room.name = next;
      this.commit();
      return;
    }
    if (sel.kind === "furniture") {
      const item = this.furnitureList(this.selectionFloor(), !!sel.annex)[sel.index];
      if (!item) return;
      item.label = next;
      this.commit();
    }
  }

  rotateSelectedFurniture(deltaDeg: number) {
    if (this.selection?.kind !== "furniture") return;
    const item = this.furnitureList(this.selectionFloor(), !!this.selection.annex)[this.selection.index];
    if (!item) return;
    item.rotation = snapRotation((item.rotation ?? 0) + degToRotation(deltaDeg), 15);
    this.commit();
  }

  /** 当前选中门窗所在墙段两端。 */
  getSelectedOpeningWall(): { a: Point; b: Point } | null {
    const sel = this.selection;
    if (!sel || sel.kind !== "door") return null;
    if (sel.exterior) {
      const item = this.draft.exteriorOpenings[sel.index];
      if (!item) return null;
      const facade = facades(item.floor)[item.facadeIndex];
      if (!facade) return null;
      return { a: [...facade.a] as Point, b: [...facade.b] as Point };
    }
    const data = this.draft.floors[sel.floor];
    const walls = sel.annex ? this.draft.annexPartitions : (data?.partitions ?? []);
    const wall = walls[sel.index];
    if (!wall) return null;
    return { a: [...wall.a] as Point, b: [...wall.b] as Point };
  }

  /**
   * 开间站点用的布局楼层。facades(3) 是辅楼外墙键，没有 draft.floors[3]。
   */
  private bayLayoutFloor(floor: number, annex: boolean): { layoutFloor: number; useAnnex: boolean } {
    if (floor === 3 || annex) return { layoutFloor: 0, useAnnex: true };
    return { layoutFloor: floor, useAnnex: floor === 0 };
  }

  private bayStationsForWall(a: Point, b: Point, floor: number, annex: boolean) {
    const { layoutFloor, useAnnex } = this.bayLayoutFloor(floor, annex);
    const data = this.draft.floors[layoutFloor];
    const partitions = [
      ...(data?.partitions ?? []),
      ...(useAnnex ? this.draft.annexPartitions : []),
    ];
    const rooms = useAnnex
      ? [...(this.draft.floors[0]?.rooms ?? []), ...this.draft.annexRooms]
      : (data?.rooms ?? []);
    return collectBayStations(a, b, partitions, rooms);
  }

  getSelectedOpeningBay(): OpeningBay | null {
    const sel = this.selection;
    if (!sel || sel.kind !== "door") return null;
    const opening = this.getOpeningRef(sel.index, !!sel.annex, !!sel.exterior);
    const wall = this.getSelectedOpeningWall();
    if (!opening || !wall) return null;
    const floor = sel.exterior
      ? (this.draft.exteriorOpenings[sel.index]?.floor ?? this.selectionFloor())
      : sel.floor;
    const annex = !!sel.annex || floor === 3;
    const stations = this.bayStationsForWall(wall.a, wall.b, floor, annex);
    return bayAlongWall(wall.a, wall.b, opening, stations);
  }

  getSelectedFurnitureMargins(): RoomMargins | null {
    const sel = this.selection;
    if (!sel || sel.kind !== "furniture") return null;
    const item = this.furnitureList(sel.floor, !!sel.annex)[sel.index];
    if (!item) return null;
    const rooms =
      sel.floor === 0
        ? [...this.floorData(0).rooms, ...this.draft.annexRooms]
        : this.floorData(sel.floor).rooms;
    const partitions = sel.annex
      ? this.draft.annexPartitions
      : this.floorData(sel.floor).partitions;
    const room = findRoomContaining(item, rooms);
    if (!room) return null;
    return roomMargins(item, room, sel.floor, partitions);
  }

  /** 拖完家具后退出墙厚，按套内净空（扣墙）贴墙内皮。 */
  private clearFurnitureFromWalls(floor: number, annex: boolean, index: number) {
    const item = this.furnitureList(floor, annex)[index];
    if (!item) return;
    const rooms = annex
      ? this.draft.annexRooms
      : floor === 0
        ? [...this.floorData(0).rooms, ...this.draft.annexRooms]
        : this.floorData(floor).rooms;
    const partitions = annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
    const room = findRoomContaining(item, rooms);
    if (room) pullFurnitureClearOfWalls(item, room, annex ? 0 : floor, undefined, partitions);
  }

  getSelectedPorticoAlign(): PorticoBayAlign | null {
    if (this.selection?.kind !== "portico") return null;
    return porticoBayAlign(this.draft.portico, this.floorData(0).rooms);
  }

  /** 平面淡标：开间端点、家具所在房间，或门厅对应中开间。 */
  getAlignGuide():
    | { kind: "bay"; a: Point; b: Point; bayStart: number; bayEnd: number }
    | { kind: "room"; x: number; z: number; w: number; d: number }
    | null {
    if (this.selections.length !== 1) return null;
    const sel = this.selection;
    if (!sel) return null;
    if (sel.kind === "door") {
      const wall = this.getSelectedOpeningWall();
      const bay = this.getSelectedOpeningBay();
      if (!wall || !bay) return null;
      return { kind: "bay", a: wall.a, b: wall.b, bayStart: bay.bayStart, bayEnd: bay.bayEnd };
    }
    if (sel.kind === "furniture") {
      const m = this.getSelectedFurnitureMargins();
      if (!m) return null;
      return { kind: "room", x: m.room.x, z: m.room.z, w: m.room.w, d: m.room.d };
    }
    if (sel.kind === "portico") {
      const align = this.getSelectedPorticoAlign();
      if (!align) return null;
      // 淡标中开间在前墙一带的投影宽度，便于对照门厅左右探出。
      const frontZ = this.floorData(0).front;
      return {
        kind: "room",
        x: align.bayStart,
        z: frontZ - this.draft.portico.projection - 150,
        w: align.bayWidth,
        d: this.draft.portico.projection + 300,
      };
    }
    return null;
  }

  centerSelectedOpeningInBay() {
    const sel = this.selection;
    if (!sel || sel.kind !== "door") return;
    const opening = this.getOpeningRef(sel.index, !!sel.annex, !!sel.exterior);
    const bay = this.getSelectedOpeningBay();
    if (!opening || !bay) {
      this.host.toast("无法计算当前开间");
      return;
    }
    opening.offset = centerOpeningInBay(bay, opening.width);
    this.commit();
    this.host.toast("已按开间居中");
  }

  centerSelectedFurnitureInRoom() {
    const sel = this.selection;
    if (!sel || sel.kind !== "furniture") return;
    const item = this.furnitureList(sel.floor, !!sel.annex)[sel.index];
    if (!item) return;
    if (!furnitureUsesWallCenter(item.kind)) {
      this.host.toast("桌椅等可灵活摆放，不提供靠墙居中");
      return;
    }
    const m = this.getSelectedFurnitureMargins();
    if (!m) {
      this.host.toast("未找到所在房间，无法靠墙居中");
      return;
    }
    const floor = sel.floor;
    const partitions = sel.annex
      ? this.draft.annexPartitions
      : this.floorData(floor).partitions;
    const before = nearestRoomWall(item, m.room, floor, partitions);
    centerFurnitureAgainstNearestWall(item, m.room, floor, undefined, partitions);
    this.commit();
    this.host.toast(`已靠${roomWallLabels[before.side]}居中（套内墙内皮）`);
  }

  centerSelectedPorticoInBay() {
    if (this.selection?.kind !== "portico") return;
    centerPorticoInBay(this.draft.portico, this.floorData(0).rooms);
    this.commit();
    this.host.toast("门厅已按中开间居中");
  }

  /** 当前层可对齐候选墙：其它隔墙＋外墙轮廓（不含自身）。 */
  private wallAlignCandidates(floor: number, excludeIndex: number, annex: boolean): Wall[] {
    const out: Wall[] = [];
    const push = (w: Wall, skip: boolean) => {
      if (!skip) out.push(w);
    };
    this.floorData(floor).partitions.forEach((w, i) => push(w, !annex && i === excludeIndex));
    if (floor === 0) {
      this.draft.annexPartitions.forEach((w, i) => push(w, annex && i === excludeIndex));
    }
    for (const facade of facades(floor)) {
      out.push({ a: [...facade.a] as Point, b: [...facade.b] as Point });
    }
    if (floor === 0) {
      for (const facade of facades(3)) {
        out.push({ a: [...facade.a] as Point, b: [...facade.b] as Point });
      }
    }
    return out;
  }

  alignSelectedWall(side: WallAlignSide) {
    const sel = this.selection;
    if (!sel || sel.kind !== "wall") return;
    const floor = this.selectionFloor();
    const walls = sel.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
    const wall = walls[sel.index];
    if (!wall) return;
    const originals = structuredClone(walls);
    const roomsOrig = structuredClone(this.roomList(floor, !!sel.annex));
    const result = alignWallToNearestSide(
      wall,
      side,
      this.wallAlignCandidates(floor, sel.index, !!sel.annex),
    );
    if (!result.ok) {
      this.host.toast(result.reason);
      return;
    }
    if (!this.finishWallEdit(floor, !!sel.annex, originals, [sel.index], roomsOrig)) return;
    this.afterWallsChanged(floor, !!sel.annex, wall);
    this.commit();
    this.host.toast(`已靠${result.sideLabel}侧最近墙对齐`);
  }

  private getOpeningRef(index: number, annex: boolean, exterior: boolean): WallOpening | null {
    if (exterior) {
      const item = this.draft.exteriorOpenings[index];
      return item ? item.opening : null;
    }
    const walls = annex ? this.draft.annexPartitions : this.floorData(this.selectionFloor()).partitions;
    return walls[index]?.door ?? null;
  }

  private syncStairRooms() {
    if (!draftHasStair(this.draft)) return;
    const s = this.draft.stairLayout;
    const fitted = fitStairToRoom(s, this.draft.floors);
    s.x = fitted.x;
    s.z = fitted.z;
    Object.assign(s.hole, fitted.hole);
    ensureStairRooms(this.draft);
  }

  /** 删除整套楼梯（三层房间框）；踏步参数留在 stairLayout 供再次拖入。 */
  private deleteStairModel() {
    removeStairFromDraft(this.draft);
    this.selection = null;
    this.commit();
    this.host.toast("已删除楼梯；可在「房间」里再拖入楼梯");
  }

  updateOpeningField(field: string, value: string) {
    if (this.selection?.kind !== "door") return;
    const opening = this.getOpeningRef(
      this.selection.index,
      !!this.selection.annex,
      !!this.selection.exterior,
    );
    if (!opening) return;
    if (field === "kind" && (value === "door" || value === "doubleDoor" || value === "slidingDoor" || value === "window")) {
      opening.kind = value;
      if (value === "window" || value === "slidingDoor" || value === "doubleDoor") {
        // keep width; clear irrelevant hinge for clarity
      }
    } else if (field === "hinge" && (value === "start" || value === "end")) {
      opening.hinge = value;
    } else if (field === "side" && (value === "in" || value === "out")) {
      opening.side = value;
    } else return;
    this.commit();
  }

  updateWallField(field: string, value: string) {
    if (this.selection?.kind !== "wall") return;
    const floor = this.selectionFloor();
    const walls = this.selection.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
    const wall = walls[this.selection.index];
    if (!wall) return;
    if (field === "role" && (value === "bearing" || value === "partition" || value === "virtual")) {
      wall.role = value as WallRole;
      if (value === "virtual") delete wall.door;
      this.afterWallsChanged(floor, !!this.selection.annex, wall);
      this.commit();
    }
  }

  /** 复制当前可复制选中项（家具／房间／隔墙）；门厅、楼梯、外墙洞口不复制。 */
  copySelection() {
    if (!this.selections.length) {
      this.host.toast("请先选中要复制的模型");
      return;
    }
    const floor = this.selectionFloor();
    const furniture: Furniture[] = [];
    const annexFurniture: Furniture[] = [];
    const rooms: Room[] = [];
    const annexRooms: Room[] = [];
    const walls: Wall[] = [];
    const annexWalls: Wall[] = [];
    let skipped = false;
    for (const s of this.selections) {
      if (s.kind === "furniture" && s.floor === floor) {
        const item = this.furnitureList(floor, !!s.annex)[s.index];
        if (item) (s.annex ? annexFurniture : furniture).push(structuredClone(item));
      } else if (s.kind === "room" && s.floor === floor) {
        const found = this.findRoomRef(s.id, floor, !!s.annex);
        if (found) (found.annex ? annexRooms : rooms).push(structuredClone(found.room));
      } else if (s.kind === "wall" && s.floor === floor) {
        const list = s.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
        const wall = list[s.index];
        if (wall) (s.annex ? annexWalls : walls).push(structuredClone(wall));
      } else {
        skipped = true;
      }
    }
    if (
      !furniture.length &&
      !annexFurniture.length &&
      !rooms.length &&
      !annexRooms.length &&
      !walls.length &&
      !annexWalls.length
    ) {
      this.host.toast(skipped ? "门厅、楼梯和外墙洞口不支持复制" : "没有可复制的内容");
      return;
    }
    this.clipboard = { furniture, annexFurniture, rooms, annexRooms, walls, annexWalls };
    this.pasteCount = 0;
    const n =
      furniture.length +
      annexFurniture.length +
      rooms.length +
      annexRooms.length +
      walls.length +
      annexWalls.length;
    this.host.toast(skipped ? `已复制 ${n} 项（部分类型已跳过）` : `已复制 ${n} 项`);
  }

  /** 粘贴剪贴板内容到当前层，相对原位偏移，并选中新对象。 */
  pasteClipboard() {
    if (!this.clipboard) {
      this.host.toast("剪贴板为空，请先复制");
      return;
    }
    const { furniture, annexFurniture, rooms, annexRooms, walls, annexWalls } = this.clipboard;
    if (
      !furniture.length &&
      !annexFurniture.length &&
      !rooms.length &&
      !annexRooms.length &&
      !walls.length &&
      !annexWalls.length
    ) {
      this.host.toast("剪贴板为空，请先复制");
      return;
    }
    this.pasteCount += 1;
    const dx = snapMeter(PASTE_STEP * this.pasteCount);
    const dz = snapMeter(PASTE_STEP * this.pasteCount);
    const floor = this.host.getFloor();
    const next: SelectionItem[] = [];

    const pasteFurniture = (srcList: Furniture[], annex: boolean) => {
      if (annex && floor !== 0) return;
      const target = this.furnitureList(floor, annex);
      for (const src of srcList) {
        const item = structuredClone(src);
        item.x = snapMeter(item.x + dx);
        item.z = snapMeter(item.z + dz);
        target.push(item);
        next.push({
          kind: "furniture",
          index: target.length - 1,
          floor,
          annex: annex || undefined,
        });
      }
    };
    pasteFurniture(furniture, false);
    pasteFurniture(annexFurniture, true);

    const pasteRooms = (srcList: Room[], annex: boolean) => {
      if (annex && floor !== 0) return;
      const target = this.roomList(floor, annex);
      for (const src of srcList) {
        const room = structuredClone(src);
        room.id = newRoomId("room", target);
        delete room.boundary;
        if (room.outline) room.outline = room.outline.map(([x,z]) => [snapMeter(x+dx), snapMeter(z+dz)]);
        room.x = snapMeter(room.x + dx);
        room.z = snapMeter(room.z + dz);
        if (room.label) {
          room.label = [snapMeter(room.label[0] + dx), snapMeter(room.label[1] + dz)];
        }
        target.push(room);
        next.push({ kind: "room", id: room.id, floor, annex: annex || undefined });
      }
    };
    pasteRooms(rooms, false);
    pasteRooms(annexRooms, true);

    const pasteWalls = (srcList: Wall[], annex: boolean) => {
      if (annex && floor !== 0) return;
      const target = annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
      for (const src of srcList) {
        const wall = structuredClone(src);
        delete wall.id;
        wall.a = [snapMeter(wall.a[0] + dx), snapMeter(wall.a[1] + dz)];
        wall.b = [snapMeter(wall.b[0] + dx), snapMeter(wall.b[1] + dz)];
        target.push(wall);
        next.push({ kind: "wall", index: target.length - 1, floor, annex: annex || undefined });
      }
    };
    pasteWalls(walls, false);
    pasteWalls(annexWalls, true);

    this.selections = next;
    this.tool = "select";
    this.commit();
    this.host.toast(`已粘贴 ${next.length} 项`);
  }

  deleteSelection() {
    if (!this.selections.length) return;
    const floor = this.selectionFloor();
    if (this.selections.length > 1) {
      const rooms = this.selections.filter((s) => s.kind === "room" && s.floor === floor) as Extract<
        SelectionItem,
        { kind: "room" }
      >[];
      const furniture = (
        this.selections.filter((s) => s.kind === "furniture" && s.floor === floor) as Extract<
          SelectionItem,
          { kind: "furniture" }
        >[]
      ).sort((a, b) => b.index - a.index);
      const deletesStair = rooms.some((s) => {
        const found = this.findRoomRef(s.id, floor, !!s.annex);
        return found?.room.kind === "stair";
      }) || this.selections.some((s) => s.kind === "stair");
      if (deletesStair) {
        this.deleteStairModel();
        return;
      }
      for (const s of rooms) {
        const list = this.roomList(floor, !!s.annex);
        const i = list.findIndex((r) => r.id === s.id);
        if (i >= 0) list.splice(i, 1);
      }
      for (const s of furniture) {
        this.furnitureList(floor, !!s.annex).splice(s.index, 1);
      }
      this.selection = null;
      this.commit();
      return;
    }
    const sel = this.selection;
    if (!sel) return;
    if (sel.kind === "stair") {
      this.deleteStairModel();
      return;
    }
    if (sel.kind === "room") {
      const rooms = this.roomList(floor, !!sel.annex);
      const i = rooms.findIndex((r) => r.id === sel.id);
      if (i >= 0) {
        if (rooms[i]!.kind === "stair") {
          this.deleteStairModel();
          return;
        }
        rooms.splice(i, 1);
      }
    } else if (sel.kind === "furniture") {
      this.furnitureList(floor, !!sel.annex).splice(sel.index, 1);
    } else if (sel.kind === "wall" || sel.kind === "door") {
      if (sel.kind === "door" && sel.exterior) {
        this.draft.exteriorOpenings.splice(sel.index, 1);
      } else {
        const walls = sel.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
        if (sel.kind === "door") {
          const wall = walls[sel.index];
          if (wall) delete wall.door;
        } else { walls.splice(sel.index, 1); this.afterWallsChanged(floor, !!sel.annex); }
      }
    } else if (sel.kind === "portico") {
      this.host.toast("门厅不能删除，只能移动或改参数");
      return;
    } else {
      return;
    }
    this.selection = null;
    this.commit();
  }

  inspectorHtml() {
    const sel = this.selection;
    if (!sel) return "";
    const head = (title: string, deletable = true) =>
      `<div class="layout-inspector-head"><strong class="layout-inspector-title">${title}</strong>${
        deletable
          ? `<button type="button" class="layout-delete-link" data-edit-delete>${this.selections.length > 1 ? "删除所选" : "删除"}</button>`
          : ""
      }</div>`;
    const field = (label: string, control: string) =>
      `<label class="select-label"><span class="layout-field-name">${label}</span>${control}</label>`;
    // 用 text + inputmode=decimal：type=number 在部分键盘／输入法下打不出小数点。
    const num = (id: string, label: string, value: number, step = 1, angle = false) =>
      field(
        label,
        `<input type="text" inputmode="decimal" data-edit-field="${id}" data-edit-step="${step}" value="${angle ? String(Math.round(value * 100) / 100) : formatMm(value)}" autocomplete="off" spellcheck="false"/>`,
      );

    if (this.selections.length > 1) {
      const nFurn = this.selections.filter((s) => s.kind === "furniture").length;
      const nRoom = this.selections.filter((s) => s.kind === "room").length;
      const parts = [
        nFurn ? `家具 ${nFurn}` : "",
        nRoom ? `房间 ${nRoom}` : "",
        this.selections.length - nFurn - nRoom ? `其他 ${this.selections.length - nFurn - nRoom}` : "",
      ].filter(Boolean);
      return `${head(`已选 ${this.selections.length} 项（${parts.join(" · ")}）`)}`;
    }
    const floor = this.selectionFloor();

    if (sel.kind === "room") {
      const found = this.findRoomRef(sel.id, floor, !!sel.annex);
      if (!found) return "";
      const room = found.room;
      const partitions = found.annex
        ? this.draft.annexPartitions
        : this.floorData(floor).partitions;
      const areas = roomAreas(room, floor, partitions);
      return `${head(found.annex ? "辅楼房间" : "房间")}
        ${field("名称", `<input type="text" id="edit-model-name" value="${escapeHtml(room.name)}"/>`)}
        ${num("x", "X 东", room.x)}${num("z", "Z 南", room.z)}${num("w", "宽", room.w)}${num("d", "进深", room.d)}
        <p class="layout-align-hint">墙线面积 ${areas.building.toFixed(2)} m² · 净空面积 ${areas.interior.toFixed(2)} m²</p>
        <p class="layout-align-hint">${escapeHtml(areas.note)} · ${room.boundary?.status === "unbounded" ? "已失围合，请补墙或重新关联" : room.boundary?.status === "open" ? "开敞分区" : "墙线控制尺寸"}</p>
        <p class="layout-align-hint">${(room.outline?.length ?? 0)>4 ? "凹形房间请分段调整墙线" : "改宽／进深同步相接内墙；外墙锁定，冲突时不修改"}；移动房间只移动分区及所属家具</p>`;
    }
    if (sel.kind === "furniture") {
      const item = this.furnitureList(floor, !!sel.annex)[sel.index];
      if (!item) return "";
      const kindLabel = furnitureLabels[item.kind as FurnitureKind] ?? item.kind;
      const displayName = furnitureDisplayName(item);
      const margins = this.getSelectedFurnitureMargins();
      const wallCenter = furnitureUsesWallCenter(item.kind);
      let align = `<p class="layout-align-hint">未落入房间轮廓，无法计算边距</p>`;
      if (margins) {
        if (wallCenter) {
          const wall = nearestRoomWall(item, margins.room);
          align = `<p class="layout-align-hint">最近${roomWallLabels[wall.side]} · 距墙 ${formatMm(wall.gap)} · 沿墙居中偏差 ${formatMm(wall.alongDelta)} · 距左 ${formatMm(margins.left)} · 距右 ${formatMm(margins.right)} · 距北 ${formatMm(margins.front)} · 距南 ${formatMm(margins.back)}</p>
            <div class="layout-align-actions"><button type="button" class="layout-align-link" data-align-center="furniture">靠墙居中</button></div>`;
        } else {
          align = `<p class="layout-align-hint">桌椅灵活摆放 · 距左 ${formatMm(margins.left)} · 距右 ${formatMm(margins.right)} · 距北 ${formatMm(margins.front)} · 距南 ${formatMm(margins.back)}（不提供房间居中）</p>`;
        }
      }
      const sizeHint =
        item.kind === "bed"
          ? `<p class="layout-align-hint">宽／深为占地外轮廓，含两侧床头柜，与房间墙同比例 1:1</p>`
          : `<p class="layout-align-hint">宽／深为占地外轮廓，与房间墙同比例 1:1</p>`;
      const facingHint = furnitureHasFacing(item.kind)
        ? `<p class="layout-align-hint">方位：${escapeHtml(furnitureOrientationHint(item.kind))}。${escapeHtml(FURNITURE_LOCAL_FRAME)}。平面尖角＝前方（人坐／站／看的一侧）。</p>`
        : `<p class="layout-align-hint">方位：${escapeHtml(furnitureOrientationHint(item.kind))}（无固定前后）。</p>`;
      return `${head(`${sel.annex ? "辅楼家具" : "家具"} · ${escapeHtml(kindLabel)}`)}
        ${field("名称", `<input type="text" id="edit-model-name" value="${escapeHtml(displayName)}"/>`)}
        ${num("x", "X", item.x)}${num("z", "Z", item.z)}${num("w", "宽", item.w)}${num("d", "深", item.d)}
        ${num("rotationDeg", "旋转°", rotationToDeg(item.rotation ?? 0), 15, true)}
        ${sizeHint}
        ${facingHint}
        <div class="layout-rotate-row">
          <button type="button" class="secondary-button" data-furn-rotate="-90">左转 90°</button>
          <button type="button" class="secondary-button" data-furn-rotate="90">右转 90°</button>
        </div>
        ${align}`;
    }
    if (sel.kind === "door") {
      const opening = this.getOpeningRef(sel.index, !!sel.annex, !!sel.exterior);
      if (!opening) return "";
      const o = normalizeOpening(opening);
      const kindOpts = (["door", "doubleDoor", "slidingDoor", "window"] as OpeningKind[])
        .map((k) => `<option value="${k}" ${o.kind === k ? "selected" : ""}>${openingLabels[k]}</option>`)
        .join("");
      const hingeDisabled = o.kind !== "door" ? "disabled" : "";
      const bay = this.getSelectedOpeningBay();
      const align = bay
        ? `<p class="layout-align-hint">开间 ${formatMm(bay.bayWidth)}（按房间／隔墙）· 左 ${formatMm(bay.leftClear)} · 右 ${formatMm(bay.rightClear)} · 居中偏差 ${formatMm(bay.centerDelta)}</p>
          <div class="layout-align-actions"><button type="button" class="layout-align-link" data-align-center="opening">开间居中</button></div>`
        : "";
      return `${head(`${sel.exterior ? "外墙" : "隔墙"} · ${escapeHtml(openingLabels[o.kind!])}`)}
        ${field("类型", `<select data-opening-field="kind">${kindOpts}</select>`)}
        ${num("offset", "沿墙偏移", o.offset)}${num("length", "长度", o.width)}
        ${field(
          "铰链侧",
          `<select data-opening-field="hinge" ${hingeDisabled}>
          <option value="start" ${o.hinge === "start" ? "selected" : ""}>靠墙段起点</option>
          <option value="end" ${o.hinge === "end" ? "selected" : ""}>靠墙段终点</option>
        </select>`,
        )}
        ${field(
          "扇叶开向",
          `<select data-opening-field="side" ${o.kind === "window" || o.kind === "slidingDoor" ? "disabled" : ""}>
          <option value="out" ${o.side === "out" ? "selected" : ""}>沿墙前进方向左侧</option>
          <option value="in" ${o.side === "in" ? "selected" : ""}>沿墙前进方向右侧</option>
        </select>`,
        )}
        <p class="layout-align-hint">竖墙由北向南：左侧＝西、右侧＝东。横墙由西向东：左侧＝南、右侧＝北。日常「内开入房间」看扇叶落在哪一侧房间。</p>
        ${align}`;
    }
    if (sel.kind === "wall") {
      const walls = sel.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
      const wall = walls[sel.index];
      if (!wall) return "";
      const role = wallRoleOf(wall);
      const axis = wallAxis(wall);
      const alignBtns =
        axis === "h"
          ? `<button type="button" class="layout-align-link" data-align-wall="left">靠西对齐</button>
             <button type="button" class="layout-align-link" data-align-wall="right">靠东对齐</button>`
          : `<button type="button" class="layout-align-link" data-align-wall="up">靠北对齐</button>
             <button type="button" class="layout-align-link" data-align-wall="down">靠南对齐</button>`;
      return `${head(role === "virtual" ? "虚拟墙 · 区域分界" : role === "bearing" ? "内承重墙 · 示意" : "隔墙 · 示意")}
        ${field(
          "角色",
          `<select data-wall-field="role">
            <option value="bearing" ${role === "bearing" ? "selected" : ""}>承重（绿系实线）</option>
            <option value="partition" ${role === "partition" ? "selected" : ""}>隔墙（灰色）</option>
            <option value="virtual" ${role === "virtual" ? "selected" : ""}>虚拟墙（细灰虚线）</option>
          </select>`,
        )}
        ${num("length", "长度", wallLength(wall))}
        <p class="layout-align-hint">${
          axis === "h"
            ? "横墙：靠西／靠东＝西／东端贴最近竖墙"
            : "竖墙：靠北／靠南＝北／南端贴最近横墙"
        }（按方位，不按图面上下；平移、长度不变）。</p>
        <div class="layout-align-actions">${alignBtns}</div>
        <p class="layout-align-hint">${role === "virtual"
          ? "仅划分开放区域，参与外圈标线；与其它分界围合后显示分区尺寸。不占墙厚、不生成立体墙，也不能开门窗。拖动端点可改方向与长度。"
          : "方案示意，非结构施工认定；外墙另绘，一律按承重。"}</p>`;
    }
    if (sel.kind === "portico") {
      const p = this.draft.portico;
      const align = this.getSelectedPorticoAlign();
      const alignHtml = align
        ? `<p class="layout-align-hint">${escapeHtml(align.bayLabel)}开间 ${formatMm(align.bayWidth)} · 西侧${align.westOverhang >= 0 ? "探出" : "退进"} ${formatMm(Math.abs(align.westOverhang))} · 东侧${align.eastOverhang >= 0 ? "探出" : "退进"} ${formatMm(Math.abs(align.eastOverhang))} · 居中偏差 ${formatMm(align.centerDelta)}</p>
          <div class="layout-align-actions"><button type="button" class="layout-align-link" data-align-center="portico">开间居中</button></div>`
        : "";
      return `${head("门厅", false)}
        ${num("x", "西端 X", p.x)}${num("w", "宽度", p.w)}${num("projection", "外伸", p.projection)}
        ${alignHtml}`;
    }
    if (sel.kind === "stair") {
      const s = fitStairToRoom(this.draft.stairLayout, this.draft.floors);
      const shape = stairShape(s);
      const well = stairWellBounds(s);
      const outside = well.x < site.main.x - 1 || well.x + well.w > site.main.x + site.main.w + 1 ||
        well.z < this.floorData(this.host.getFloor()).front - 1 || well.z + well.d > site.main.z + site.main.d + 1;
      return `${head("楼梯", true)}
        ${field(
          "走向",
          `<select data-stair-field="axis">
            <option value="x" ${s.axis === "x" ? "selected" : ""}>东西向 · 左右折返（下跑向东）</option>
            <option value="z" ${s.axis === "z" ? "selected" : ""}>南北向 · 竖向折返（下跑向南）</option>
          </select>`,
        )}
        ${field("起步侧", `<select data-stair-field="lowerSide">
          <option value="max" ${shape.lowerSide === "max" ? "selected" : ""}>${s.axis === "z" ? "图左 · 东侧上踏步" : "南侧上踏步"}</option>
          <option value="min" ${shape.lowerSide === "min" ? "selected" : ""}>${s.axis === "z" ? "图右 · 西侧上踏步" : "北侧上踏步"}</option>
        </select>`)}
        <p class="layout-align-hint">一层虚线表示上方返跑，梯下可布置家具，须核对连续净高。楼梯模型不含墙体，侧墙请用「隔墙」工具自画；踏步按已有墙内侧取净空。</p>
        <p class="layout-align-hint">踏步与平台贴梯间框／墙内侧排布；梯段宽与踏步深随梯间尺寸重排。删除会同时去掉三层楼梯。</p>
        ${outside ? '<p class="layout-align-hint">当前梯间范围跨出主体外皮，请核对位置或梯间预留；尺寸仍按实际范围显示。</p>' : ""}
        ${num("x", "踏步包络 X", s.x)}${num("z", "踏步包络 Z", s.z)}
        ${num("flight", "梯段宽", s.flight)}${num("gap", "梯间缝", s.gap)}
        ${num("tread", "踏步深", s.tread)}${num("landing", "休息平台深", s.landing)}
        ${num("roomW", "楼梯间宽", s.room.w)}${num("roomD", "楼梯间进深", s.room.d)}`;
    }
    return "";
  }
}
