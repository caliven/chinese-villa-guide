import type { Furniture, Room, Wall, Point, WallRole } from "./data";
import { site, wallRoleOf } from "./data";
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
  snapToAnchors,
  refineWallEnd,
} from "./layout-draft";
import { downloadFile, escapeHtml } from "./project-meta";
import { renderDrawGuide, type DrawGuide } from "./plan";
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
import {
  alignWallToNearestSide,
  bayAlongWall,
  centerFurnitureAgainstNearestWall,
  centerOpeningInBay,
  collectBayStations,
  collectCornerSnapPoints,
  collectRoomSnapAxes,
  findRoomContaining,
  formatMeters,
  furnitureUsesWallCenter,
  nearestRoomWall,
  pullFurnitureClearOfWalls,
  resizeRoomFromCorner,
  roomMargins,
  roomWallLabels,
  porticoBayAlign,
  centerPorticoInBay,
  resizeOwnedWallsWithRoom,
  snapFurnitureDuringDrag,
  snapRoomToNearestWalls,
  snapWallDuringDrag,
  translateFurnitureInsideRoom,
  translateOwnedWallsWithRoom,
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
  | { type: "wall"; index: number; annex: boolean; end: "a" | "b" | "move"; startX: number; startZ: number; orig: Wall }
  | { type: "door"; index: number; annex: boolean; exterior: boolean; startOffset: number; startX: number; startZ: number; origOpening: WallOpening; wallA: Point; wallB: Point }
  | { type: "door-handle"; index: number; annex: boolean; exterior: boolean; end: "start" | "end"; origOpening: WallOpening; wallA: Point; wallB: Point }
  | { type: "portico"; startX: number; origX: number; origW: number; mode: "move" | "resize-e" | "resize-w" }
  | { type: "stair"; startX: number; startZ: number; origRoom: LayoutDraft["stairLayout"]["room"]; origX: number; origZ: number; origHole: LayoutDraft["stairLayout"]["hole"] }
  | { type: "stair-handle"; corner: string; origRoom: LayoutDraft["stairLayout"]["room"]; origX: number; origZ: number; origHole: LayoutDraft["stairLayout"]["hole"]; origFlight: number; origTread: number }
  | { type: "draw-wall"; ax: number; az: number }
  | null;

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
/** 每次粘贴相对剪贴板原位的步进（米）。 */
const PASTE_STEP = 0.5;

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

  /** 方向键微调：Arrow 0.1m，Shift+Arrow 1m。X 东增大，Z 南增大。 */
  nudgeSelection(dx: number, dz: number) {
    if (!this.selections.length) return;
    const floor = this.selectionFloor();
    let moved = 0;
    for (const s of this.selections) {
      if (s.kind === "furniture" && s.floor === floor) {
        const item = this.furnitureList(floor, !!s.annex)[s.index];
        if (!item) continue;
        item.x = snapMeter(item.x + dx);
        item.z = snapMeter(item.z + dz);
        moved += 1;
      } else if (s.kind === "room" && s.floor === floor) {
        const found = this.findRoomRef(s.id, floor, !!s.annex);
        if (!found) continue;
        const room = found.room;
        room.x = snapMeter(room.x + dx);
        room.z = snapMeter(room.z + dz);
        if (room.label) {
          room.label = [snapMeter(room.label[0] + dx), snapMeter(room.label[1] + dz)];
        } else {
          room.label = [room.x + room.w / 2, room.z + room.d / 2];
        }
        moved += 1;
      } else if (s.kind === "wall" && s.floor === floor) {
        const walls = s.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
        const wall = walls[s.index];
        if (!wall) continue;
        forceOrthoWall(wall);
        // 方向键：水平墙只南北移，竖直墙只东西移，避免被斜推歪。
        const axis = wallAxis(wall);
        const mx = axis === "v" ? dx : 0;
        const mz = axis === "h" ? dz : 0;
        wall.a = [snapMeter(wall.a[0] + mx), snapMeter(wall.a[1] + mz)];
        wall.b = [snapMeter(wall.b[0] + mx), snapMeter(wall.b[1] + mz)];
        forceOrthoWall(wall);
        moved += 1;
      } else if (s.kind === "portico") {
        this.draft.portico.x = snapMeter(this.draft.portico.x + dx);
        moved += 1;
      } else if (s.kind === "stair") {
        const stair = this.draft.stairLayout;
        stair.x = snapMeter(stair.x + dx);
        stair.z = snapMeter(stair.z + dz);
        stair.room.x = snapMeter(stair.room.x + dx);
        stair.room.z = snapMeter(stair.room.z + dz);
        stair.hole.x = snapMeter(stair.hole.x + dx);
        stair.hole.z = snapMeter(stair.hole.z + dz);
        moved += 1;
      }
    }
    if (!moved) {
      this.host.toast("门窗请拖动调整；其他选中项可用方向键移动");
      return;
    }
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
  private onWallPreviewMove = (event: PointerEvent) => {
    if (!this.wallDraft || this.tool !== "wall") {
      this.detachWallPreview();
      return;
    }
    const liveSvg = this.currentSvg();
    if (!liveSvg) return;
    const raw = this.clientToMeter(liveSvg, event.clientX, event.clientY);
    const end = refineWallEnd(
      this.wallDraft.ax,
      this.wallDraft.az,
      raw.x,
      raw.z,
      this.floorAnchors(),
      false,
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

  constructor(host: LayoutEditorHost, draft?: LayoutDraft | null) {
    this.host = host;
    const stored = draft == null ? loadLayoutDraft() : null;
    this.draft = ensureExteriorManaged(draft ?? stored ?? clonePublishedLayout());
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
  dropPlace(svg: SVGSVGElement, clientX: number, clientY: number, category: "room" | "door" | "furniture", kind: string) {
    const raw = this.clientToMeter(svg, clientX, clientY);
    const x = snapMeter(raw.x);
    const z = snapMeter(raw.z);
    if (category === "room") {
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

  placeRoomAt(x: number, z: number) {
    const floor = this.host.getFloor();
    const annex = this.inAnnexFootprint(x, z, floor);
    const list = this.roomList(floor, annex);
    const room: Room = {
      id: newRoomId("room", list),
      name: annex ? "辅楼房间" : "新房间",
      x: snapMeter(x - 1.5),
      z: snapMeter(z - 1.5),
      w: 3,
      d: 3,
      kind: this.roomKind,
      note: "编辑器新增，设计建议。",
    };
    list.push(room);
    this.snapRoomEdges(room, floor);
    this.selection = { kind: "room", id: room.id, floor, annex: annex || undefined };
    this.tool = "select";
    this.commit();
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
      if (dist <= 0.55) cands.push({ dist, along: t, len, a, b, mode, index, ...extra });
    };
    this.floorData(floor).partitions.forEach((w, i) => consider(w.a, w.b, "partition", i));
    if (floor === 0) {
      this.draft.annexPartitions.forEach((w, i) => consider(w.a, w.b, "partition", i, { annex: true }));
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
      ensureExteriorManaged(this.draft);
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

  private clientToMeter(svg: SVGSVGElement, clientX: number, clientY: number) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    // 户型图内容在 .plan-world（可整体旋转 180°）；用该组 CTM 才能得到世界米制坐标。
    const world = svg.querySelector(".plan-world") as SVGGElement | null;
    const ctm = world?.getScreenCTM() ?? svg.getScreenCTM();
    if (!ctm) return { x: 0, z: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, z: local.y };
  }

  private currentSvg(fallback?: SVGSVGElement | null) {
    return (document.querySelector("svg.floor-svg") as SVGSVGElement | null) ?? fallback ?? null;
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
        const anchors = this.floorAnchors(floor);
        if (!this.wallDraft) {
          const start = snapToAnchors(raw.x, raw.z, anchors);
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
        const end = refineWallEnd(this.wallDraft.ax, this.wallDraft.az, raw.x, raw.z, anchors, false);
        if (Math.hypot(end.x - this.wallDraft.ax, end.z - this.wallDraft.az) < 0.3) {
          this.host.toast("隔墙太短，请再移远一点");
          return;
        }
        const wall: Wall = {
          a: [this.wallDraft.ax, this.wallDraft.az],
          b: [end.x, end.z],
          role: "partition",
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
        this.commit();
        return;
      }

      if (this.tool === "room") {
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
        this.drag = { type: "wall", index: wallIndex, annex, end, startX: x, startZ: z, orig: structuredClone(wall) };
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
        const edge = Math.abs(x - (this.draft.portico.x + this.draft.portico.w)) < 0.35
          ? "resize-e"
          : Math.abs(x - this.draft.portico.x) < 0.35
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
            room.x = snapMeter(item.orig.x + dx);
            room.z = snapMeter(item.orig.z + dz);
            if (item.orig.label) {
              room.label = [
                snapMeter(item.orig.label[0] + dx),
                snapMeter(item.orig.label[1] + dz),
              ];
            } else {
              room.label = [room.x + room.w / 2, room.z + room.d / 2];
            }
          }
        }
        // 单件家具：边贴墙／角贴墙尖；接近居中线时吸居中。Shift 暂关。
        if (this.magnetActive(event) && drag.items.length === 1 && drag.items[0]!.kind === "furniture") {
          const only = drag.items[0]!;
          const furn = this.furnitureList(floor, only.annex)[only.index];
          if (furn) {
            const ctx = this.furnitureMagnetContext(floor);
            const room = findRoomContaining(furn, ctx.rooms);
            const guides = snapFurnitureDuringDrag(furn, ctx.xs, ctx.zs, {
              corners: ctx.corners,
              room,
              floorIndex: floor,
              allowCenter: true,
            });
            this.setDragGuides(furn.x, furn.z, guides.guideXs, guides.guideZs);
          }
        } else if (this.magnetActive(event) && drag.items.length === 1 && drag.items[0]!.kind === "room") {
          const only = drag.items[0]!;
          const found = this.findRoomRef(only.id, floor, only.annex);
          if (found) {
            const before = { x: found.room.x, z: found.room.z };
            this.snapRoomEdges(found.room, floor, 0.15);
            if (found.room.x !== before.x || found.room.z !== before.z) {
              this.setDragGuides(found.room.x + found.room.w / 2, found.room.z + found.room.d / 2, [found.room.x, found.room.x + found.room.w], [found.room.z, found.room.z + found.room.d]);
            }
          }
        }
        // 独占隔墙、房内家具按房间最终位移（含磁吸）从拖始快照对齐。
        for (const item of drag.items) {
          if (item.kind !== "room") continue;
          const found = this.findRoomRef(item.id, floor, item.annex);
          if (!found) continue;
          const rdx = found.room.x - item.orig.x;
          const rdz = found.room.z - item.orig.z;
          const walls = item.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
          const wallOrigs = item.annex ? drag.annexPartitionsOrig : drag.partitionsOrig;
          const rooms = item.annex ? drag.annexRoomsOrig : drag.roomsOrig;
          translateOwnedWallsWithRoom(item.orig, rdx, rdz, walls, wallOrigs, rooms);
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
        this.host.redraw();
      } else if (this.drag.type === "room-handle") {
        const drag = this.drag;
        const found = this.findRoomRef(drag.id, floor, drag.annex);
        if (!found) return;
        const room = found.room;
        const next = resizeRoomFromCorner(drag.orig, drag.corner, x, z);
        room.x = next.x;
        room.z = next.z;
        room.w = next.w;
        room.d = next.d;
        room.label = [room.x + room.w / 2, room.z + room.d / 2];
        const walls = drag.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
        resizeOwnedWallsWithRoom(drag.orig, room, walls, drag.partitionsOrig, drag.roomsOrig);
        this.host.redraw();
      } else if (this.drag.type === "furniture-handle") {
        const drag = this.drag;
        const item = this.furnitureList(floor, drag.annex)[drag.index];
        if (!item) return;
        const o = drag.orig;
        const next = resizeFurnitureFromCorner(o, drag.corner, x, z, 0.3, {
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
          if (Math.hypot(other[0] - fixed[0], other[1] - fixed[1]) < 0.3) {
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
          const next = snapMeter(Math.max(0, Math.min(end - 0.3, along)));
          opening.offset = next;
          opening.width = snapMeter(end - next);
        } else {
          const next = snapMeter(Math.max(o.offset + 0.3, Math.min(len, along)));
          opening.offset = o.offset;
          opening.width = snapMeter(next - o.offset);
        }
        this.host.redraw();
      } else if (this.drag.type === "portico") {
        const dx = x - this.drag.startX;
        if (this.drag.mode === "move") {
          this.draft.portico.x = snapMeter(this.drag.origX + dx);
        } else if (this.drag.mode === "resize-e") {
          this.draft.portico.w = Math.max(2.4, snapMeter(this.drag.origW + dx));
        } else {
          const nextX = snapMeter(this.drag.origX + dx);
          const nextW = Math.max(2.4, snapMeter(this.drag.origW - dx));
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
        this.host.redraw();
      } else if (this.drag.type === "stair-handle") {
        const drag = this.drag;
        const o = drag.origRoom;
        const room = this.draft.stairLayout.room;
        const next = resizeRoomFromCorner(o, drag.corner, x, z, 2.4);
        room.x = next.x;
        room.z = next.z;
        room.w = next.w;
        room.d = next.d;
        const sx = room.w / o.w;
        const sz = room.d / o.d;
        this.draft.stairLayout.x = snapMeter(room.x + (drag.origX - o.x) * sx);
        this.draft.stairLayout.z = snapMeter(room.z + (drag.origZ - o.z) * sz);
        this.draft.stairLayout.hole.x = snapMeter(room.x + (drag.origHole.x - o.x) * sx);
        this.draft.stairLayout.hole.z = snapMeter(room.z + (drag.origHole.z - o.z) * sz);
        this.draft.stairLayout.hole.w = Math.max(1.5, snapMeter(drag.origHole.w * sx));
        this.draft.stairLayout.hole.d = Math.max(1.5, snapMeter(drag.origHole.d * sz));
        this.draft.stairLayout.flight = Math.max(0.8, snapMeter(drag.origFlight * (this.draft.stairLayout.axis === "x" ? sz : sx)));
        this.draft.stairLayout.tread = Math.max(0.2, snapMeter(drag.origTread * (this.draft.stairLayout.axis === "x" ? sx : sz)));
        this.syncStairRooms();
        this.host.redraw();
      }
    };

    const onPointerUp = () => {
      if (!this.drag) {
        detachWindowDrag();
        return;
      }
      const ended = this.drag;
      const floorNow = this.selectionFloor();
      this.drag = null;
      this.dragGuides = null;
      detachWindowDrag();
      // 房间拖移／拉角后贴最近两面墙，并再对齐独占隔墙；家具拖完退出墙厚。
      if (ended.type === "room-handle") {
        const found = this.findRoomRef(ended.id, floorNow, ended.annex);
        if (found) {
          this.snapRoomEdges(found.room, floorNow);
          const walls = ended.annex ? this.draft.annexPartitions : this.floorData(floorNow).partitions;
          resizeOwnedWallsWithRoom(ended.orig, found.room, walls, ended.partitionsOrig, ended.roomsOrig);
        }
      } else if (ended.type === "group-move") {
        for (const item of ended.items) {
          if (item.kind === "room") {
            const found = this.findRoomRef(item.id, floorNow, item.annex);
            if (found) {
              this.snapRoomEdges(found.room, floorNow);
              const rdx = found.room.x - item.orig.x;
              const rdz = found.room.z - item.orig.z;
              const walls = item.annex ? this.draft.annexPartitions : this.floorData(floorNow).partitions;
              const wallOrigs = item.annex ? ended.annexPartitionsOrig : ended.partitionsOrig;
              const rooms = item.annex ? ended.annexRoomsOrig : ended.roomsOrig;
              translateOwnedWallsWithRoom(item.orig, rdx, rdz, walls, wallOrigs, rooms);
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
      } else if (ended.type === "furniture-handle" || ended.type === "furniture-rotate") {
        this.clearFurnitureFromWalls(floorNow, ended.annex, ended.index);
      }
      // 仅点选、未真正改几何时不入撤销栈（否则点一次撤销像没反应）。
      if (this.contentKey() !== this.dragStartKey) this.commit();
      else this.host.redraw();
    };

    svg.addEventListener("pointerdown", onPointerDown);
    if (this.wallDraft) {
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

  private furnitureMagnetContext(floor: number) {
    const { xs, zs } = this.roomSnapAxes(floor);
    const partitions = [
      ...this.floorData(floor).partitions,
      ...(floor === 0 ? this.draft.annexPartitions : []),
    ];
    for (const facade of facades(floor)) {
      partitions.push({ a: [...facade.a] as Point, b: [...facade.b] as Point });
    }
    const rooms =
      floor === 0
        ? [...this.floorData(0).rooms, ...this.draft.annexRooms]
        : this.floorData(floor).rooms;
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
    return { xs, zs, corners, rooms };
  }

  private setDragGuides(ax: number, az: number, xs: number[], zs: number[]) {
    if (!xs.length && !zs.length) {
      this.dragGuides = null;
      return;
    }
    this.dragGuides = { ax, az, xs, zs };
  }

  /** 当前层可吸附轴线：隔墙、其他房间边、主／辅楼外轮廓、外墙。 */
  private roomSnapAxes(floor: number, excludeRoomId?: string) {
    const partitions = [
      ...this.floorData(floor).partitions,
      ...(floor === 0 ? this.draft.annexPartitions : []),
    ];
    for (const facade of facades(floor)) {
      partitions.push({ a: [...facade.a] as Point, b: [...facade.b] as Point });
    }
    if (floor === 0) {
      for (const facade of facades(3)) {
        partitions.push({ a: [...facade.a] as Point, b: [...facade.b] as Point });
      }
    }
    const rooms =
      floor === 0
        ? [...this.floorData(0).rooms, ...this.draft.annexRooms]
        : this.floorData(floor).rooms;
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
    return collectRoomSnapAxes({ partitions, rooms, excludeRoomId, bounds });
  }

  /** 贴最近竖墙 + 最近横墙（两面）。改宽／进深、拖移松手、新放房间时调用。 */
  private snapRoomEdges(room: Room, floor: number, maxGap = 2.5) {
    const before = { x: room.x, z: room.z };
    const { xs, zs } = this.roomSnapAxes(floor, room.id);
    snapRoomToNearestWalls(room, xs, zs, maxGap);
    return room.x !== before.x || room.z !== before.z;
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
        const next = field === "w" || field === "d" ? Math.max(0.8, value) : value;
        room[field] = snapMeter(next);
        room.label = [room.x + room.w / 2, room.z + room.d / 2];
        if (field === "w" || field === "d") {
          if (this.snapRoomEdges(room, floor)) this.host.toast("已贴最近两面墙");
        }
      }
    } else if (sel.kind === "furniture") {
      const item = this.furnitureList(floor, !!sel.annex)[sel.index];
      if (!item) return;
      if (field === "x" || field === "z") item[field] = snapMeter(value);
      if (field === "w" || field === "d") {
        const next = Math.max(0.3, snapMeter(value));
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
      if (field === "offset") opening.offset = snapMeter(value);
      if (field === "width" || field === "length") {
        opening.width = snapMeter(Math.max(0.3, value));
      }
    } else if (sel.kind === "wall") {
      const walls = sel.annex ? this.draft.annexPartitions : this.floorData(floor).partitions;
      const wall = walls[sel.index];
      if (!wall) return;
      if (field === "length") setWallLength(wall, value, "center");
    } else if (sel.kind === "portico") {
      if (field === "x" || field === "w" || field === "projection") this.draft.portico[field] = snapMeter(value);
    } else if (sel.kind === "stair") {
      const s = this.draft.stairLayout;
      if (field === "x") s.x = snapMeter(value);
      if (field === "z") s.z = snapMeter(value);
      if (field === "flight") s.flight = snapMeter(value);
      if (field === "tread") s.tread = snapMeter(value);
      if (field === "roomW") s.room.w = Math.max(2.4, snapMeter(value));
      if (field === "roomD") s.room.d = Math.max(2.4, snapMeter(value));
      this.syncStairRooms();
    }
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
        z: frontZ - this.draft.portico.projection - 0.15,
        w: align.bayWidth,
        d: this.draft.portico.projection + 0.3,
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
    const result = alignWallToNearestSide(
      wall,
      side,
      this.wallAlignCandidates(floor, sel.index, !!sel.annex),
    );
    if (!result.ok) {
      this.host.toast(result.reason);
      return;
    }
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
    const room = this.draft.stairLayout.room;
    for (const floorItem of this.draft.floors) {
      for (const r of floorItem.rooms) {
        if (r.kind === "stair") {
          r.x = room.x;
          r.z = room.z;
          r.w = room.w;
          r.d = room.d;
        }
      }
    }
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
    if (field === "role" && (value === "bearing" || value === "partition")) {
      wall.role = value as WallRole;
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
    if (sel.kind === "room") {
      const rooms = this.roomList(floor, !!sel.annex);
      const i = rooms.findIndex((r) => r.id === sel.id);
      if (i >= 0) rooms.splice(i, 1);
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
        } else walls.splice(sel.index, 1);
      }
    } else {
      this.host.toast("门厅和楼梯不能删除，只能移动或改参数");
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
    const num = (id: string, label: string, value: number, step = 0.01) =>
      field(
        label,
        `<input type="text" inputmode="decimal" data-edit-field="${id}" data-edit-step="${step}" value="${value.toFixed(2)}" autocomplete="off" spellcheck="false"/>`,
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
      return `${head(found.annex ? "辅楼房间" : "房间")}
        ${field("名称", `<input type="text" id="edit-model-name" value="${escapeHtml(room.name)}"/>`)}
        ${num("x", "X 东", room.x)}${num("z", "Z 南", room.z)}${num("w", "宽", room.w)}${num("d", "进深", room.d)}`;
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
          align = `<p class="layout-align-hint">最近${roomWallLabels[wall.side]} · 距墙 ${formatMeters(wall.gap)} · 沿墙居中偏差 ${formatMeters(wall.alongDelta)} · 距左 ${formatMeters(margins.left)} · 距右 ${formatMeters(margins.right)} · 距北 ${formatMeters(margins.front)} · 距南 ${formatMeters(margins.back)}</p>
            <div class="layout-align-actions"><button type="button" class="layout-align-link" data-align-center="furniture">靠墙居中</button></div>`;
        } else {
          align = `<p class="layout-align-hint">桌椅灵活摆放 · 距左 ${formatMeters(margins.left)} · 距右 ${formatMeters(margins.right)} · 距北 ${formatMeters(margins.front)} · 距南 ${formatMeters(margins.back)}（不提供房间居中）</p>`;
        }
      }
      const sizeHint =
        item.kind === "bed"
          ? `<p class="layout-align-hint">宽／深为占地外轮廓（米），含两侧床头柜，与房间墙同比例 1:1</p>`
          : `<p class="layout-align-hint">宽／深为占地外轮廓（米），与房间墙同比例 1:1</p>`;
      const facingHint = furnitureHasFacing(item.kind)
        ? `<p class="layout-align-hint">方位：${escapeHtml(furnitureOrientationHint(item.kind))}。${escapeHtml(FURNITURE_LOCAL_FRAME)}。平面尖角＝前方（人坐／站／看的一侧）。</p>`
        : `<p class="layout-align-hint">方位：${escapeHtml(furnitureOrientationHint(item.kind))}（无固定前后）。</p>`;
      return `${head(`${sel.annex ? "辅楼家具" : "家具"} · ${escapeHtml(kindLabel)}`)}
        ${field("名称", `<input type="text" id="edit-model-name" value="${escapeHtml(displayName)}"/>`)}
        ${num("x", "X", item.x)}${num("z", "Z", item.z)}${num("w", "宽", item.w)}${num("d", "深", item.d)}
        ${num("rotationDeg", "旋转°", rotationToDeg(item.rotation ?? 0), 15)}
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
        ? `<p class="layout-align-hint">开间 ${formatMeters(bay.bayWidth)} m（按房间／隔墙）· 左 ${formatMeters(bay.leftClear)} · 右 ${formatMeters(bay.rightClear)} · 居中偏差 ${formatMeters(bay.centerDelta)}</p>
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
      return `${head(role === "bearing" ? "内承重墙 · 示意" : "隔墙 · 示意")}
        ${field(
          "角色",
          `<select data-wall-field="role">
            <option value="bearing" ${role === "bearing" ? "selected" : ""}>承重（绿系实线）</option>
            <option value="partition" ${role === "partition" ? "selected" : ""}>隔墙（灰色）</option>
          </select>`,
        )}
        ${num("length", "长度", wallLength(wall))}
        <p class="layout-align-hint">${
          axis === "h"
            ? "横墙：靠西／靠东＝西／东端贴最近竖墙"
            : "竖墙：靠北／靠南＝北／南端贴最近横墙"
        }（按方位，不按图面上下；平移、长度不变）。</p>
        <div class="layout-align-actions">${alignBtns}</div>
        <p class="layout-align-hint">方案示意，非结构施工认定；外墙另绘，一律按承重。</p>`;
    }
    if (sel.kind === "portico") {
      const p = this.draft.portico;
      const align = this.getSelectedPorticoAlign();
      const alignHtml = align
        ? `<p class="layout-align-hint">${escapeHtml(align.bayLabel)}开间 ${formatMeters(align.bayWidth)} m · 西侧${align.westOverhang >= 0 ? "探出" : "退进"} ${formatMeters(Math.abs(align.westOverhang))} · 东侧${align.eastOverhang >= 0 ? "探出" : "退进"} ${formatMeters(Math.abs(align.eastOverhang))} · 居中偏差 ${formatMeters(align.centerDelta)}</p>
          <div class="layout-align-actions"><button type="button" class="layout-align-link" data-align-center="portico">开间居中</button></div>`
        : "";
      return `${head("门厅", false)}
        ${num("x", "西端 X", p.x)}${num("w", "宽度", p.w)}${num("projection", "外伸", p.projection)}
        ${alignHtml}`;
    }
    if (sel.kind === "stair") {
      const s = this.draft.stairLayout;
      return `${head("楼梯", false)}
        ${num("x", "第一踏步 X", s.x)}${num("z", "第一踏步 Z", s.z)}
        ${num("flight", "梯段宽", s.flight)}${num("tread", "踏步深", s.tread)}
        ${num("roomW", "楼梯间宽", s.room.w)}${num("roomD", "楼梯间进深", s.room.d)}`;
    }
    return "";
  }
}
