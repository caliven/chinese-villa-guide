import type { Furniture, Point, Room, Wall } from "./data";
import { annexFurniture, annexRooms, construction, floors, isPhysicalWall, site, wallRoleOf } from "./data";
import { roomFillBounds } from "./design-data";
import { furnitureLocalBounds, furnitureLocalToWorld } from "./furniture-catalog";
import { normalizeOpening, type WallOpening } from "./openings";
import {
  collectWallSnapSegs,
  extendOrthoEndToFarFace,
  forceOrthoWall,
  snapMeter,
  wallAxis,
  WALL_EDGE_SNAP_GAP,
  type WallSnapSeg,
} from "./layout-draft";

/** 家具贴墙内皮后再留的示意缝（mm），避免色块压进墙线。 */
export const FURNITURE_WALL_FINISH = 20;

export type OpeningBay = {
  bayStart: number;
  bayEnd: number;
  bayWidth: number;
  leftClear: number;
  rightClear: number;
  /** 洞口中心相对开间中心：沿墙正向为正。 */
  centerDelta: number;
  wallLen: number;
};

export type RoomMargins = {
  left: number;
  right: number;
  front: number;
  back: number;
  centerDeltaX: number;
  centerDeltaZ: number;
  room: Room;
};

/** 外伸门厅相对中开间（堂屋／主楼中跨）的对齐信息。 */
export type PorticoBayAlign = {
  bayStart: number;
  bayEnd: number;
  bayWidth: number;
  bayMid: number;
  porticoMid: number;
  /** 门厅西端相对开间西端：正为探出，负为退进。 */
  westOverhang: number;
  /** 门厅东端相对开间东端：正为探出，负为退进。 */
  eastOverhang: number;
  centerDelta: number;
  bayLabel: string;
};

/** 点到墙段 a→b 的沿墙距离（可超出 [0,L]）。 */
export function stationAlongWall(a: Point, b: Point, x: number, z: number) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len;
  const uz = (b[1] - a[1]) / len;
  return (x - a[0]) * ux + (z - a[1]) * uz;
}

function distToWallLine(a: Point, b: Point, x: number, z: number) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len;
  const uz = (b[1] - a[1]) / len;
  const along = (x - a[0]) * ux + (z - a[1]) * uz;
  const px = a[0] + ux * along;
  const pz = a[1] + uz * along;
  return Math.hypot(x - px, z - pz);
}

function pushStation(out: number[], value: number, wallLen: number, pad = 20) {
  if (!Number.isFinite(value)) return;
  if (value < -pad || value > wallLen + pad) return;
  out.push(Math.min(wallLen, Math.max(0, value)));
}

function uniqueSorted(values: number[], eps = 80) {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || Math.abs(v - out[out.length - 1]!) > eps) out.push(v);
  }
  return out;
}

/**
 * 开间分段点：墙端 + 贴边隔墙 + 贴边房间边线。
 * 不用门厅柱内外皮切段——柱跨中线与堂屋中线不一致时，按柱居中会看起来左右墙距不对称。
 */
export function collectBayStations(
  a: Point,
  b: Point,
  partitions: Wall[],
  rooms: Room[] = [],
): number[] {
  const wallLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const stations: number[] = [0, wallLen];
  const near = 450;

  for (const wall of partitions) {
    for (const p of [wall.a, wall.b] as Point[]) {
      if (distToWallLine(a, b, p[0], p[1]) <= near) {
        pushStation(stations, stationAlongWall(a, b, p[0], p[1]), wallLen);
      }
    }
  }

  // 房间外轮廓投影到墙上：大门应对齐堂屋开间，而不是门厅柱净空。
  for (const room of rooms) {
    const corners: Point[] = [
      [room.x, room.z],
      [room.x + room.w, room.z],
      [room.x, room.z + room.d],
      [room.x + room.w, room.z + room.d],
    ];
    let touches = false;
    for (const [x, z] of corners) {
      if (distToWallLine(a, b, x, z) <= near) {
        touches = true;
        break;
      }
    }
    // 房间边贴着墙中线（常见：房间 z 与前墙几乎重合）
    if (!touches) {
      const midZ = (a[1] + b[1]) / 2;
      const midX = (a[0] + b[0]) / 2;
      const alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
      if (alongX) {
        if (Math.abs(room.z - midZ) <= near || Math.abs(room.z + room.d - midZ) <= near) touches = true;
      } else if (Math.abs(room.x - midX) <= near || Math.abs(room.x + room.w - midX) <= near) {
        touches = true;
      }
    }
    if (!touches) continue;
    const alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    if (alongX) {
      pushStation(stations, stationAlongWall(a, b, room.x, (a[1] + b[1]) / 2), wallLen);
      pushStation(stations, stationAlongWall(a, b, room.x + room.w, (a[1] + b[1]) / 2), wallLen);
    } else {
      pushStation(stations, stationAlongWall(a, b, (a[0] + b[0]) / 2, room.z), wallLen);
      pushStation(stations, stationAlongWall(a, b, (a[0] + b[0]) / 2, room.z + room.d), wallLen);
    }
  }

  return uniqueSorted(stations);
}

/** 洞口所在开间及相对居中信息。 */
export function bayAlongWall(a: Point, b: Point, opening: WallOpening, stations: number[]): OpeningBay {
  const o = normalizeOpening(opening);
  const wallLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const pts = uniqueSorted([0, wallLen, ...stations.filter((s) => s >= 0 && s <= wallLen)]);
  const center = o.offset + o.width / 2;
  let bayStart = 0;
  let bayEnd = wallLen;
  for (let i = 0; i < pts.length - 1; i++) {
    const s0 = pts[i]!;
    const s1 = pts[i + 1]!;
    if (center >= s0 - 1e-6 && center <= s1 + 1e-6) {
      bayStart = s0;
      bayEnd = s1;
      break;
    }
  }
  const bayWidth = Math.max(0, bayEnd - bayStart);
  const leftClear = o.offset - bayStart;
  const rightClear = bayEnd - (o.offset + o.width);
  const bayMid = (bayStart + bayEnd) / 2;
  return {
    bayStart,
    bayEnd,
    bayWidth,
    leftClear,
    rightClear,
    centerDelta: center - bayMid,
    wallLen,
  };
}

/** 使洞口中心对齐开间中心，宽度不变，夹在开间内。 */
export function centerOpeningInBay(bay: OpeningBay, width: number) {
  const w = Math.max(300, width);
  const maxOffset = Math.max(bay.bayStart, bay.bayEnd - w);
  const ideal = (bay.bayStart + bay.bayEnd) / 2 - w / 2;
  return snapMeter(Math.min(maxOffset, Math.max(bay.bayStart, ideal)));
}

export function furnitureWorldBounds(f: Furniture) {
  const b = furnitureLocalBounds(f);
  const corners: Point[] = [
    [b.x0, b.z0],
    [b.x1, b.z0],
    [b.x0, b.z1],
    [b.x1, b.z1],
  ];
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [lx, lz] of corners) {
    const w = furnitureLocalToWorld(lx, lz, f);
    x0 = Math.min(x0, w.x);
    z0 = Math.min(z0, w.z);
    x1 = Math.max(x1, w.x);
    z1 = Math.max(z1, w.z);
  }
  return { x0, z0, x1, z1 };
}

/** 家具中心落在哪个房间内（优先面积较小者）。 */
export function findRoomContaining(f: Furniture, rooms: Room[]): Room | null {
  const hits = rooms.filter(
    (r) => f.x >= r.x && f.x <= r.x + r.w && f.z >= r.z && f.z <= r.z + r.d,
  );
  if (!hits.length) return null;
  hits.sort((a, b) => a.w * a.d - b.w * b.d);
  return hits[0]!;
}

/** 房间墙内皮矩形（扣外墙厚／隔墙半厚＝套内）再加 finish 留缝。 */
export function roomFurnitureClearRect(
  room: Room,
  floorIndex: number,
  finish = FURNITURE_WALL_FINISH,
  partitions?: Wall[],
) {
  const inner = roomFillBounds(room, floorIndex, partitions);
  return {
    x0: inner.x + finish,
    z0: inner.z + finish,
    x1: inner.x + inner.w - finish,
    z1: inner.z + inner.d - finish,
  };
}

export function roomMargins(f: Furniture, room: Room, floorIndex = 0, partitions?: Wall[]): RoomMargins {
  const box = furnitureWorldBounds(f);
  const clear = roomFurnitureClearRect(room, floorIndex, FURNITURE_WALL_FINISH, partitions);
  // 相对套内净空中心（扣墙后），不是开间外轮廓中心
  const innerCx = (clear.x0 + clear.x1) / 2;
  const innerCz = (clear.z0 + clear.z1) / 2;
  return {
    left: box.x0 - clear.x0,
    right: clear.x1 - box.x1,
    front: box.z0 - clear.z0,
    back: clear.z1 - box.z1,
    centerDeltaX: f.x - innerCx,
    centerDeltaZ: f.z - innerCz,
    room,
  };
}

/** 房间几何中心（旧行为，桌椅等自由件不再用）。 */
export function centerFurnitureInRoom(f: Furniture, room: Room) {
  f.x = snapMeter(room.x + room.w / 2);
  f.z = snapMeter(room.z + room.d / 2);
  return f;
}

/** 靠墙摆放的家具：居中时贴最近墙，并沿该墙方向在房间内居中。桌／椅／茶几除外。 */
const FREE_PLACE_FURNITURE = new Set([
  "table",
  "roundTable",
  "chair",
  "coffeeTable",
  "railing",
]);

export function furnitureUsesWallCenter(kind: string) {
  return !FREE_PLACE_FURNITURE.has(kind);
}

export type RoomWallSide = "west" | "east" | "north" | "south";

export const roomWallLabels: Record<RoomWallSide, string> = {
  west: "西墙",
  east: "东墙",
  north: "北墙",
  south: "南墙",
};

/** 家具世界外包相对房间墙内皮（含 finish）四边的最近墙。 */
export function nearestRoomWall(f: Furniture, room: Room, floorIndex = 0, partitions?: Wall[]): {
  side: RoomWallSide;
  gap: number;
  alongDelta: number;
} {
  const box = furnitureWorldBounds(f);
  const fw = box.x1 - box.x0;
  const fd = box.z1 - box.z0;
  const clear = roomFurnitureClearRect(room, floorIndex, FURNITURE_WALL_FINISH, partitions);
  const left = box.x0 - clear.x0;
  const right = clear.x1 - box.x1;
  const north = box.z0 - clear.z0;
  const south = clear.z1 - box.z1;
  const ranked: { side: RoomWallSide; gap: number }[] = [
    { side: "west", gap: left },
    { side: "east", gap: right },
    { side: "north", gap: north },
    { side: "south", gap: south },
  ];
  ranked.sort((a, b) => a.gap - b.gap);
  const best = ranked[0]!;
  let alongDelta = 0;
  if (best.side === "west" || best.side === "east") {
    alongDelta = box.z0 + fd / 2 - (clear.z0 + clear.z1) / 2;
  } else {
    alongDelta = box.x0 + fw / 2 - (clear.x0 + clear.x1) / 2;
  }
  return { side: best.side, gap: best.gap, alongDelta };
}

/**
 * 把家具外包钳进房间墙内皮＋finish，避免压进墙线。
 * 过大件无法完全放入时尽量居中夹入。
 */
export function pullFurnitureClearOfWalls(
  f: Furniture,
  room: Room,
  floorIndex: number,
  finish = FURNITURE_WALL_FINISH,
  partitions?: Wall[],
) {
  const clear = roomFurnitureClearRect(room, floorIndex, finish, partitions);
  const box = furnitureWorldBounds(f);
  const fw = box.x1 - box.x0;
  const fd = box.z1 - box.z0;
  const clearW = clear.x1 - clear.x0;
  const clearD = clear.z1 - clear.z0;
  let dx = 0;
  let dz = 0;
  if (fw >= clearW - 1e-6) {
    dx = (clear.x0 + clear.x1) / 2 - (box.x0 + box.x1) / 2;
  } else {
    if (box.x0 < clear.x0) dx = clear.x0 - box.x0;
    else if (box.x1 > clear.x1) dx = clear.x1 - box.x1;
  }
  if (fd >= clearD - 1e-6) {
    dz = (clear.z0 + clear.z1) / 2 - (box.z0 + box.z1) / 2;
  } else {
    if (box.z0 < clear.z0) dz = clear.z0 - box.z0;
    else if (box.z1 > clear.z1) dz = clear.z1 - box.z1;
  }
  if (Math.abs(dx) > 1e-9 || Math.abs(dz) > 1e-9) {
    f.x = snapMeter(f.x + dx);
    f.z = snapMeter(f.z + dz);
  }
  return f;
}

/** 本层／辅楼全部家具退出墙厚。 */
export function normalizeFurnitureWallClearance(
  furniture: Furniture[],
  rooms: Room[],
  floorIndex: number,
  finish = FURNITURE_WALL_FINISH,
) {
  for (const f of furniture) {
    const room = findRoomContaining(f, rooms);
    if (room) pullFurnitureClearOfWalls(f, room, floorIndex, finish);
  }
}

/** 把源码默认／当前方案里所有室内家具钳出墙线（可重复调用）。 */
export function ensureFurnitureWallClearance(finish = FURNITURE_WALL_FINISH) {
  for (let i = 0; i < floors.length; i++) {
    normalizeFurnitureWallClearance(floors[i]!.furniture, floors[i]!.rooms, i, finish);
  }
  normalizeFurnitureWallClearance(annexFurniture, annexRooms, 0, finish);
}

/**
 * 靠最近一面墙贴齐（贴墙内皮＋finish），并沿该墙在净空内居中。
 */
export function centerFurnitureAgainstNearestWall(
  f: Furniture,
  room: Room,
  floorIndex = 0,
  finish = FURNITURE_WALL_FINISH,
  partitions?: Wall[],
) {
  const box = furnitureWorldBounds(f);
  const fw = box.x1 - box.x0;
  const fd = box.z1 - box.z0;
  const clear = roomFurnitureClearRect(room, floorIndex, finish, partitions);
  const { side } = nearestRoomWall(f, room, floorIndex, partitions);
  let dx = 0;
  let dz = 0;
  if (side === "west") {
    dx = clear.x0 - box.x0;
    dz = (clear.z0 + clear.z1 - fd) / 2 - box.z0;
  } else if (side === "east") {
    dx = clear.x1 - box.x1;
    dz = (clear.z0 + clear.z1 - fd) / 2 - box.z0;
  } else if (side === "north") {
    dz = clear.z0 - box.z0;
    dx = (clear.x0 + clear.x1 - fw) / 2 - box.x0;
  } else {
    dz = clear.z1 - box.z1;
    dx = (clear.x0 + clear.x1 - fw) / 2 - box.x0;
  }
  f.x = snapMeter(f.x + dx);
  f.z = snapMeter(f.z + dz);
  return f;
}

function wallHalfForSnap(wall: Wall): number {
  if (!isPhysicalWall(wall)) return 0;
  return (wallRoleOf(wall) === "bearing" ? construction.outsideWall : construction.partition) / 2;
}

/**
 * 房间吸附轴：只取墙体内侧（外墙内皮／隔墙中线内侧），不吸到墙中或外侧。
 * 按房间中心所在一侧选取内侧；不含其它房间边，避免吸到墙外。
 */
export function collectRoomSnapAxes(options: {
  partitions: Wall[];
  rooms: Room[];
  excludeRoomId?: string;
  bounds?: { x0: number; x1: number; z0: number; z1: number }[];
  /** 正在吸附的房间：用来判断墙的哪一侧是内侧。 */
  forRoom?: Pick<Room, "x" | "z" | "w" | "d">;
}): { xs: number[]; zs: number[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  const pushX = (v: number) => {
    if (Number.isFinite(v)) xs.push(v);
  };
  const pushZ = (v: number) => {
    if (Number.isFinite(v)) zs.push(v);
  };
  const cx = options.forRoom ? options.forRoom.x + options.forRoom.w / 2 : null;
  const cz = options.forRoom ? options.forRoom.z + options.forRoom.d / 2 : null;

  // 外墙内皮（外皮 ± 外墙厚）——房间外轮廓贴外墙中／内皮时仍用「外皮」作外轮廓轴；
  // 吸附目标改为内皮对应的外轮廓位置＝外皮（room 外轮廓在外皮，色块再缩）。
  // 用户要求不吸到外侧：外轮廓轴仍用外皮，但只允许房间整体落在包络内侧。
  for (const b of options.bounds ?? []) {
    pushX(b.x0);
    pushX(b.x1);
    pushZ(b.z0);
    pushZ(b.z1);
  }

  for (const wall of options.partitions) {
    const dx = Math.abs(wall.b[0] - wall.a[0]);
    const dz = Math.abs(wall.b[1] - wall.a[1]);
    const half = wallHalfForSnap(wall);
    if (dx <= dz * 0.35) {
      const at = (wall.a[0] + wall.b[0]) / 2;
      // 外轮廓贴中线＝色块贴内皮；按房间在墙西／东只提供该侧的中线目标
      if (cx == null || cx < at) pushX(at);
      if (cx == null || cx > at) pushX(at);
      // 禁止吸到墙「外侧」：不提供对侧外皮（中线±半厚的外侧）
      void half;
    }
    if (dz <= dx * 0.35) {
      const at = (wall.a[1] + wall.b[1]) / 2;
      if (cz == null || cz < at) pushZ(at);
      if (cz == null || cz > at) pushZ(at);
    }
  }

  const prioritized = (values: number[]) => {
    const kept: number[] = [];
    for (const v of values) {
      if (!kept.some((a) => Math.abs(a - v) < 40)) kept.push(v);
    }
    return kept.sort((a, b) => a - b);
  };
  return { xs: prioritized(xs), zs: prioritized(zs) };
}

/**
 * 固定宽／进深，把房间贴到最近的墙线内侧对应外轮廓轴。
 * 吸附后钳制：房间不得越过墙中线到另一侧（不会压到墙体上／外侧）。
 */
export function snapRoomToNearestWalls(
  room: Room,
  xs: number[],
  zs: number[],
  maxGap = 550,
  partitions?: Wall[],
) {
  const snapAxis = (edge0: number, size: number, anchors: number[]) => {
    const edge1 = edge0 + size;
    let best: { pos: number; dist: number } | null = null;
    for (const a of anchors) {
      const d0 = Math.abs(edge0 - a);
      if (d0 <= maxGap && (!best || d0 < best.dist)) best = { pos: a, dist: d0 };
      const d1 = Math.abs(edge1 - a);
      if (d1 <= maxGap && (!best || d1 < best.dist)) best = { pos: a - size, dist: d1 };
    }
    return best?.pos ?? null;
  };

  const nextX = snapAxis(room.x, room.w, xs);
  if (nextX != null) room.x = snapMeter(nextX);
  const nextZ = snapAxis(room.z, room.d, zs);
  if (nextZ != null) room.z = snapMeter(nextZ);

  // 钳制：房间整体须落在每道隔墙的同一侧，外轮廓不超过墙中线。
  if (partitions) {
    const cx = room.x + room.w / 2;
    const cz = room.z + room.d / 2;
    for (const wall of partitions) {
      const dx = Math.abs(wall.b[0] - wall.a[0]);
      const dz = Math.abs(wall.b[1] - wall.a[1]);
      if (dx <= dz * 0.35) {
        const at = (wall.a[0] + wall.b[0]) / 2;
        const lo = Math.min(wall.a[1], wall.b[1]);
        const hi = Math.max(wall.a[1], wall.b[1]);
        if (cz < lo - 50 || cz > hi + 50) continue;
        if (cx < at && room.x + room.w > at) room.x = snapMeter(at - room.w);
        if (cx > at && room.x < at) room.x = snapMeter(at);
      } else if (dz <= dx * 0.35) {
        const at = (wall.a[1] + wall.b[1]) / 2;
        const lo = Math.min(wall.a[0], wall.b[0]);
        const hi = Math.max(wall.a[0], wall.b[0]);
        if (cx < lo - 50 || cx > hi + 50) continue;
        if (cz < at && room.z + room.d > at) room.z = snapMeter(at - room.d);
        if (cz > at && room.z < at) room.z = snapMeter(at);
      }
    }
  }

  room.label = [room.x + room.w / 2, room.z + room.d / 2];
  return room;
}

/** 房间四边（北＝小 Z／前，南＝大 Z／后）。 */
export type RoomEdgeSide = "west" | "east" | "north" | "south";

export type OwnedWallRef = { index: number; edge: RoomEdgeSide };

const ROOM_WALL_EDGE_TOL = 80;
const ROOM_WALL_COVER = 0.85;

function roomEdgeGeom(room: Room, edge: RoomEdgeSide) {
  if (edge === "west") {
    return { axis: "v" as const, c: room.x, lo: room.z, hi: room.z + room.d };
  }
  if (edge === "east") {
    return { axis: "v" as const, c: room.x + room.w, lo: room.z, hi: room.z + room.d };
  }
  if (edge === "north") {
    return { axis: "h" as const, c: room.z, lo: room.x, hi: room.x + room.w };
  }
  return { axis: "h" as const, c: room.z + room.d, lo: room.x, hi: room.x + room.w };
}

function spanOverlap(a0: number, a1: number, b0: number, b1: number) {
  const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  return Math.max(0, hi - lo);
}

/**
 * 墙是否贴着房间某一边：共线、投影覆盖边长≥cover，且墙身大致落在该边内（不过长）。
 * softCover 用于邻房「是否共用」：只要有明显重叠即算共用。
 */
export function wallTouchesRoomEdge(
  wall: Wall,
  room: Room,
  opts: { tol?: number; cover?: number; softCover?: number } = {},
): RoomEdgeSide | null {
  const tol = opts.tol ?? ROOM_WALL_EDGE_TOL;
  const cover = opts.cover ?? ROOM_WALL_COVER;
  const soft = opts.softCover;
  // 本地拷贝扶正，避免改写拖始 wallOrigs 快照
  const w: Wall = { a: [...wall.a] as Point, b: [...wall.b] as Point };
  forceOrthoWall(w);
  const axis = wallAxis(w);
  const sides: RoomEdgeSide[] =
    axis === "v" ? ["west", "east"] : axis === "h" ? ["north", "south"] : [];
  let best: { edge: RoomEdgeSide; score: number } | null = null;
  for (const edge of sides) {
    const g = roomEdgeGeom(room, edge);
    if (g.axis !== axis) continue;
    const wallC = axis === "v" ? (w.a[0] + w.b[0]) / 2 : (w.a[1] + w.b[1]) / 2;
    if (Math.abs(wallC - g.c) > tol) continue;
    const w0 = axis === "v" ? w.a[1] : w.a[0];
    const w1 = axis === "v" ? w.b[1] : w.b[0];
    const edgeLen = g.hi - g.lo;
    const wallLen = Math.abs(w1 - w0);
    if (edgeLen < 50 || wallLen < 50) continue;
    const overlap = spanOverlap(w0, w1, g.lo, g.hi);
    if (soft != null) {
      if (overlap < soft) continue;
      const score = overlap;
      if (!best || score > best.score) best = { edge, score };
      continue;
    }
    if (overlap / edgeLen < cover) continue;
    // 墙明显长出房间边 → 当长墙／潜在共用，不独占
    if (overlap / wallLen < cover) continue;
    const score = overlap / edgeLen;
    if (!best || score > best.score) best = { edge, score };
  }
  return best?.edge ?? null;
}

/**
 * 本房间独占隔墙：贴边且同层其它房间不与之共线重叠。
 * 外墙 facade 不在 walls 列表内，故不会跟移。
 */
export function wallsOwnedByRoom(
  room: Room,
  walls: Wall[],
  rooms: Room[],
  opts?: { tol?: number; cover?: number },
): OwnedWallRef[] {
  const others = rooms.filter((r) => r.id !== room.id);
  const out: OwnedWallRef[] = [];
  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i]!;
    const edge = wallTouchesRoomEdge(wall, room, opts);
    if (!edge) continue;
    const shared = others.some(
      (o) => wallTouchesRoomEdge(wall, o, { tol: opts?.tol, softCover: 200 }) != null,
    );
    if (shared) continue;
    out.push({ index: i, edge });
  }
  return out;
}

/**
 * 拖移房间：按拖始几何把独占墙端点平移到 origWall + (dx,dz)。
 * wallOrigs 与 walls 等长，为按下瞬间的隔墙快照。
 */
export function translateOwnedWallsWithRoom(
  roomOrig: Room,
  dx: number,
  dz: number,
  walls: Wall[],
  wallOrigs: Wall[],
  rooms: Room[],
) {
  const owned = wallsOwnedByRoom(roomOrig, wallOrigs, rooms);
  for (const { index } of owned) {
    const o = wallOrigs[index];
    const w = walls[index];
    if (!o || !w) continue;
    w.a = [snapMeter(o.a[0] + dx), snapMeter(o.a[1] + dz)];
    w.b = [snapMeter(o.b[0] + dx), snapMeter(o.b[1] + dz)];
    forceOrthoWall(w);
  }
}

/**
 * 拖移房间：拖始时中心落在该房间内（含套间优先小房间）的家具同幅平移，相对摆位不变。
 * skipIndices：已在选区里单独拖的家具，避免加两次位移。
 */
export function translateFurnitureInsideRoom(
  roomOrig: Room,
  dx: number,
  dz: number,
  furniture: Furniture[],
  furnitureOrigs: Furniture[],
  roomsOrig: Room[],
  skipIndices?: ReadonlySet<number>,
) {
  for (let i = 0; i < furniture.length; i++) {
    if (skipIndices?.has(i)) continue;
    const o = furnitureOrigs[i];
    const f = furniture[i];
    if (!o || !f) continue;
    const host = findRoomContaining(o, roomsOrig);
    if (!host || host.id !== roomOrig.id) continue;
    f.x = snapMeter(o.x + dx);
    f.z = snapMeter(o.z + dz);
  }
}

/**
 * 拉角改房间：拖始判定的独占边墙整体对齐到新房间对应边（含只改开间时横墙伸长）。
 * wallOrigs／roomOrig 为按下瞬间快照。
 */
export function resizeOwnedWallsWithRoom(
  roomOrig: Room,
  roomNext: Room,
  walls: Wall[],
  wallOrigs: Wall[],
  rooms: Room[],
) {
  const owned = wallsOwnedByRoom(roomOrig, wallOrigs, rooms);
  for (const { index, edge } of owned) {
    const w = walls[index];
    if (!w) continue;
    const g = roomEdgeGeom(roomNext, edge);
    if (g.axis === "v") {
      w.a = [snapMeter(g.c), snapMeter(g.lo)];
      w.b = [snapMeter(g.c), snapMeter(g.hi)];
    } else {
      w.a = [snapMeter(g.lo), snapMeter(g.c)];
      w.b = [snapMeter(g.hi), snapMeter(g.c)];
    }
    forceOrthoWall(w);
  }
}

export type EnvelopeRect = { x: number; z: number; w: number; d: number };

/** 房间边是否贴楼体外皮（外墙不可随房间改尺寸挪动）。 */
export function roomEdgeOnEnvelope(
  room: Pick<Room, "x" | "z" | "w" | "d">,
  edge: RoomEdgeSide,
  body: EnvelopeRect,
  tol = 120,
): boolean {
  if (edge === "west") return Math.abs(room.x - body.x) <= tol;
  if (edge === "east") return Math.abs(room.x + room.w - (body.x + body.w)) <= tol;
  if (edge === "north") return Math.abs(room.z - body.z) <= tol;
  return Math.abs(room.z + room.d - (body.z + body.d)) <= tol;
}

/**
 * 把已靠近外皮的房间边吸到楼体外皮精确坐标（消除 12mm 级漂移）。
 * 例如东缘应贴 20200 却停在 20212 → 拉回外皮，并修正 w／x。
 */
export function clampRoomToEnvelope(room: Room, body: EnvelopeRect, tol = 120): Room {
  const out: Room = { ...room, label: room.label ? ([...room.label] as [number, number]) : undefined };
  const east = body.x + body.w;
  const south = body.z + body.d;
  let x0 = out.x;
  let x1 = out.x + out.w;
  let z0 = out.z;
  let z1 = out.z + out.d;
  if (Math.abs(x0 - body.x) <= tol) x0 = body.x;
  if (Math.abs(x1 - east) <= tol) x1 = east;
  if (Math.abs(z0 - body.z) <= tol) z0 = body.z;
  if (Math.abs(z1 - south) <= tol) z1 = south;
  // 越过外皮时也钳回（比 tol 漂移更大时仍不穿出楼体）
  x0 = Math.max(body.x, Math.min(x0, east - 800));
  x1 = Math.min(east, Math.max(x1, body.x + 800));
  z0 = Math.max(body.z, Math.min(z0, south - 800));
  z1 = Math.min(south, Math.max(z1, body.z + 800));
  if (x1 - x0 < 800) {
    if (Math.abs(x1 - east) <= Math.abs(x0 - body.x)) x0 = x1 - 800;
    else x1 = x0 + 800;
  }
  if (z1 - z0 < 800) {
    if (Math.abs(z1 - south) <= Math.abs(z0 - body.z)) z0 = z1 - 800;
    else z1 = z0 + 800;
  }
  out.x = snapMeter(x0);
  out.z = snapMeter(z0);
  out.w = snapMeter(x1 - x0);
  out.d = snapMeter(z1 - z0);
  out.label = [out.x + out.w / 2, out.z + out.d / 2];
  return out;
}

/**
 * 改建筑宽／进深时锁定贴外皮的边：外墙不动，只推内侧边。
 * 贴外皮时锁的是楼体外皮坐标（body），不是房间当前可能已漂移的边。
 * 宽：东贴外皮则动西缘；西贴外皮则动东缘；双侧都贴则钳制为外包络宽。
 * 进深：南／北同理。
 */
export function anchorRoomSizeAgainstEnvelope(
  room: Room,
  field: "w" | "d",
  nextSize: number,
  body: EnvelopeRect,
): Room {
  const size = Math.max(800, snapMeter(nextSize));
  // 先吸回外皮，再判锁边，避免用 20212 这种漂移边当「外墙」
  const base = clampRoomToEnvelope(room, body);
  const out: Room = { ...base, label: base.label ? ([...base.label] as [number, number]) : undefined };
  if (field === "w") {
    const westLock = roomEdgeOnEnvelope(base, "west", body);
    const eastLock = roomEdgeOnEnvelope(base, "east", body);
    if (westLock && eastLock) {
      out.x = snapMeter(body.x);
      out.w = snapMeter(body.w);
    } else if (eastLock && !westLock) {
      const east = body.x + body.w;
      out.w = Math.min(size, snapMeter(east - body.x - 800));
      out.x = snapMeter(east - out.w);
    } else if (westLock && !eastLock) {
      out.x = snapMeter(body.x);
      out.w = Math.min(size, snapMeter(body.x + body.w - out.x));
    } else {
      out.x = snapMeter(base.x);
      out.w = size;
    }
  } else {
    const northLock = roomEdgeOnEnvelope(base, "north", body);
    const southLock = roomEdgeOnEnvelope(base, "south", body);
    if (northLock && southLock) {
      out.z = snapMeter(body.z);
      out.d = snapMeter(body.d);
    } else if (southLock && !northLock) {
      const south = body.z + body.d;
      out.d = Math.min(size, snapMeter(south - body.z - 800));
      out.z = snapMeter(south - out.d);
    } else if (northLock && !southLock) {
      out.z = snapMeter(body.z);
      out.d = Math.min(size, snapMeter(body.z + body.d - out.z));
    } else {
      out.z = snapMeter(base.z);
      out.d = size;
    }
  }
  out.label = [out.x + out.w / 2, out.z + out.d / 2];
  return clampRoomToEnvelope(out, body);
}

/**
 * 房间宽深变更后：把贴在「非外皮边」上的内墙推到新边中线（含与邻房共用的内墙）。
 * 外皮边不改墙。共用内墙挪动后，邻房对应边跟着对齐，避免一边 3900、标注 3945。
 * 邻房只传播一层（A→B）；更长的房间链暂不递归。
 */
export function syncInteriorWallsToRoom(
  roomOrig: Room,
  roomNext: Room,
  walls: Wall[],
  rooms: Room[],
  body: EnvelopeRect,
): void {
  const edges: RoomEdgeSide[] = ["west", "east", "north", "south"];
  for (const edge of edges) {
    const g0 = roomEdgeGeom(roomOrig, edge);
    const g1 = roomEdgeGeom(roomNext, edge);
    const cMoved = Math.abs(g0.c - g1.c) >= 0.5;
    const spanMoved =
      Math.abs(g0.lo - g1.lo) >= 0.5 || Math.abs(g0.hi - g1.hi) >= 0.5;
    if (!cMoved && !spanMoved) continue;
    // 外皮边：中线不动；若仅开间变化仍可伸长贴外皮的横／竖墙沿向
    const exterior = roomEdgeOnEnvelope(roomOrig, edge, body);
    if (exterior && cMoved) continue;

    for (const wall of walls) {
      const touch = wallTouchesRoomEdge(wall, roomOrig, { softCover: 200, tol: 120 });
      if (touch !== edge) continue;
      forceOrthoWall(wall);
      const axis = wallAxis(wall);
      if (axis === "v" && (edge === "west" || edge === "east")) {
        if (exterior && cMoved) continue; // 外皮竖墙中线不挪
        const z0 = Math.min(wall.a[1], wall.b[1]);
        const z1 = Math.max(wall.a[1], wall.b[1]);
        let lo = z0;
        let hi = z1;
        if (Math.abs(z0 - g0.lo) <= 120) lo = g1.lo;
        else lo = Math.min(z0, g1.lo);
        if (Math.abs(z1 - g0.hi) <= 120) hi = g1.hi;
        else hi = Math.max(z1, g1.hi);
        const at = exterior ? (wall.a[0] + wall.b[0]) / 2 : g1.c;
        wall.a = [snapMeter(at), snapMeter(Math.min(lo, hi))];
        wall.b = [snapMeter(at), snapMeter(Math.max(lo, hi))];
      } else if (axis === "h" && (edge === "north" || edge === "south")) {
        if (exterior && cMoved) continue;
        const x0 = Math.min(wall.a[0], wall.b[0]);
        const x1 = Math.max(wall.a[0], wall.b[0]);
        // 沿向跟新开间：端点若贴旧房角则跟到新角，否则保留更长贯通
        let lo = x0;
        let hi = x1;
        if (Math.abs(x0 - g0.lo) <= 120) lo = g1.lo;
        else lo = Math.min(x0, g1.lo);
        if (Math.abs(x1 - g0.hi) <= 120) hi = g1.hi;
        else hi = Math.max(x1, g1.hi);
        const at = exterior ? (wall.a[1] + wall.b[1]) / 2 : g1.c;
        wall.a = [snapMeter(Math.min(lo, hi)), snapMeter(at)];
        wall.b = [snapMeter(Math.max(lo, hi)), snapMeter(at)];
      } else {
        continue;
      }
      forceOrthoWall(wall);
    }

    if (!cMoved) continue;
    if (exterior) continue;

    // 邻房旧时贴在本房对边上的边，跟着新中线
    const opp =
      edge === "west" ? "east" : edge === "east" ? "west" : edge === "north" ? "south" : "north";
    for (const other of rooms) {
      if (other.id === roomOrig.id) continue;
      const og = roomEdgeGeom(other, opp);
      if (Math.abs(og.c - g0.c) > 120) continue;
      if (spanOverlap(og.lo, og.hi, g0.lo, g0.hi) < 200) continue;
      if (opp === "east") {
        other.w = snapMeter(Math.max(800, g1.c - other.x));
      } else if (opp === "west") {
        const x1 = other.x + other.w;
        other.x = snapMeter(g1.c);
        other.w = snapMeter(Math.max(800, x1 - g1.c));
      } else if (opp === "south") {
        other.d = snapMeter(Math.max(800, g1.c - other.z));
      } else {
        const z1 = other.z + other.d;
        other.z = snapMeter(g1.c);
        other.d = snapMeter(Math.max(800, z1 - g1.c));
      }
      other.label = [other.x + other.w / 2, other.z + other.d / 2];
    }
  }
}

/** 取一层中开间：优先堂屋，否则主楼面宽三等分的中跨。 */
export function findMiddleBay(rooms: Room[]): { start: number; end: number; label: string } {
  const hall =
    rooms.find((r) => r.kind === "hall") ??
    rooms.find((r) => r.name.includes("堂屋") || r.name.includes("堂"));
  if (hall) {
    return { start: hall.x, end: hall.x + hall.w, label: hall.name || "堂屋" };
  }
  const third = site.main.w / 3;
  return {
    start: site.main.x + third,
    end: site.main.x + third * 2,
    label: "主楼中开间",
  };
}

export function porticoBayAlign(
  portico: { x: number; w: number },
  rooms: Room[],
): PorticoBayAlign {
  const bay = findMiddleBay(rooms);
  const bayMid = (bay.start + bay.end) / 2;
  const porticoMid = portico.x + portico.w / 2;
  return {
    bayStart: bay.start,
    bayEnd: bay.end,
    bayWidth: bay.end - bay.start,
    bayMid,
    porticoMid,
    westOverhang: bay.start - portico.x,
    eastOverhang: portico.x + portico.w - bay.end,
    centerDelta: porticoMid - bayMid,
    bayLabel: bay.label,
  };
}

/** 把门厅中线对齐中开间中线，宽度不变。 */
export function centerPorticoInBay(portico: { x: number; w: number }, rooms: Room[]) {
  const bay = findMiddleBay(rooms);
  const bayMid = (bay.start + bay.end) / 2;
  portico.x = snapMeter(bayMid - portico.w / 2);
  return portico;
}

/** 是否主楼正立面（北墙）。 */
export function isMainFrontFacade(a: Point, b: Point) {
  const midZ = (a[1] + b[1]) / 2;
  const frontZ = site.main.z;
  const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
  return alongX && Math.abs(midZ - frontZ) < 350;
}

/**
 * 房间四角拉伸：对角固定，只改被拖角；宽深吸附后用对角反算原点，避免跳位。
 * corner：nw／ne／sw／se（平面 Z 南增大，n＝北＝Z 较小）。
 */
export function resizeRoomFromCorner(
  orig: Pick<Room, "x" | "z" | "w" | "d">,
  corner: string,
  worldX: number,
  worldZ: number,
  minSize = 800,
): Pick<Room, "x" | "z" | "w" | "d"> {
  const east = orig.x + orig.w;
  const south = orig.z + orig.d;
  let w: number;
  let d: number;
  let x: number;
  let z: number;
  if (corner.includes("w")) {
    w = Math.max(minSize, snapMeter(east - worldX));
    x = east - w;
  } else {
    w = Math.max(minSize, snapMeter(worldX - orig.x));
    x = orig.x;
  }
  if (corner.includes("n")) {
    d = Math.max(minSize, snapMeter(south - worldZ));
    z = south - d;
  } else {
    d = Math.max(minSize, snapMeter(worldZ - orig.z));
    z = orig.z;
  }
  return { x, z, w, d };
}

/** 横墙：靠西／靠东（left／right）；竖墙：靠北／靠南（up／down）。按世界方位，不按图面上下。 */
export type WallAlignSide = "left" | "right" | "up" | "down";

export type WallAlignResult = {
  ok: true;
  sideLabel: string;
  target: number;
} | {
  ok: false;
  reason: string;
};

/** 点是否落在线段投影附近（隔墙端对齐到正交墙时用）。 */
function nearAlong(value: number, a0: number, a1: number, pad = 350) {
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  return value >= lo - pad && value <= hi + pad;
}

/**
 * 隔墙端对齐到正交方向最近墙（整段平移，长度不变）。
 * - 横墙：left／right → 西／东端贴最近竖墙
 * - 竖墙：up／down → 北／南端贴最近横墙（北＝Z 更小）
 */
export function alignWallToNearestSide(
  wall: Wall,
  side: WallAlignSide,
  candidates: Pick<Wall, "a" | "b">[],
  eps = 40,
): WallAlignResult {
  forceOrthoWall(wall);
  const axis = wallAxis(wall);
  if (axis === "h") {
    if (side !== "left" && side !== "right") {
      return { ok: false, reason: "横墙请用靠西／靠东对齐" };
    }
    const z = (wall.a[1] + wall.b[1]) / 2;
    const xLo = Math.min(wall.a[0], wall.b[0]);
    const xHi = Math.max(wall.a[0], wall.b[0]);
    let best: number | null = null;
    for (const c of candidates) {
      if (wallAxis(c) !== "v") continue;
      const cx = (c.a[0] + c.b[0]) / 2;
      if (!nearAlong(z, c.a[1], c.b[1])) continue;
      if (side === "left") {
        if (cx < xLo - eps && (best == null || cx > best)) best = cx;
      } else if (cx > xHi + eps && (best == null || cx < best)) {
        best = cx;
      }
    }
    if (best == null) {
      return { ok: false, reason: side === "left" ? "西侧没有可对齐的墙" : "东侧没有可对齐的墙" };
    }
    const dx = side === "left" ? best - xLo : best - xHi;
    wall.a = [snapMeter(wall.a[0] + dx), snapMeter(wall.a[1])];
    wall.b = [snapMeter(wall.b[0] + dx), snapMeter(wall.b[1])];
    return { ok: true, sideLabel: side === "left" ? "西" : "东", target: best };
  }

  if (side !== "up" && side !== "down") {
    return { ok: false, reason: "竖墙请用靠北／靠南对齐" };
  }
  const x = (wall.a[0] + wall.b[0]) / 2;
  const zLo = Math.min(wall.a[1], wall.b[1]);
  const zHi = Math.max(wall.a[1], wall.b[1]);
  let best: number | null = null;
  for (const c of candidates) {
    if (wallAxis(c) !== "h") continue;
    const cz = (c.a[1] + c.b[1]) / 2;
    if (!nearAlong(x, c.a[0], c.b[0])) continue;
    if (side === "up") {
      // 北＝Z 更小
      if (cz < zLo - eps && (best == null || cz > best)) best = cz;
    } else if (cz > zHi + eps && (best == null || cz < best)) {
      best = cz;
    }
  }
  if (best == null) {
    return { ok: false, reason: side === "up" ? "北侧没有可对齐的墙" : "南侧没有可对齐的墙" };
  }
  const dz = side === "up" ? best - zLo : best - zHi;
  wall.a = [snapMeter(wall.a[0]), snapMeter(wall.a[1] + dz)];
  wall.b = [snapMeter(wall.b[0]), snapMeter(wall.b[1] + dz)];
  return { ok: true, sideLabel: side === "up" ? "北" : "南", target: best };
}

/** 拖拽吸附默认阈值（mm）：手抖对不齐时吸上，故意偏离时仍可躲开。 */
export const MAGNET_SNAP_GAP = 120;
/** 靠墙家具沿墙居中：仅当已接近居中线时才吸（可故意偏一侧摆）。 */
export const MAGNET_CENTER_GAP = 180;
/** 接近锚线时先画引导线（可大于吸附阈值，便于找墙内皮／居中）。 */
export const MAGNET_GUIDE_PREVIEW_GAP = 450;

/**
 * 房内家具吸附锚点：墙内皮（套内净空＋finish），不是墙中线／外轮廓。
 * 另含净空中线、同房其它家具边／中线，供对齐与居中。
 */
export function collectFurnitureRoomAnchors(
  room: Room,
  floorIndex: number,
  options?: {
    partitions?: Wall[];
    furniture?: Furniture[];
    excludeFurnitureIndex?: number;
    finish?: number;
  },
): {
  edgeXs: number[];
  edgeZs: number[];
  centerXs: number[];
  centerZs: number[];
  corners: { x: number; z: number }[];
  clear: { x0: number; z0: number; x1: number; z1: number };
} {
  const finish = options?.finish ?? FURNITURE_WALL_FINISH;
  const clear = roomFurnitureClearRect(room, floorIndex, finish, options?.partitions);
  const edgeXs = [clear.x0, clear.x1];
  const edgeZs = [clear.z0, clear.z1];
  const centerXs = [(clear.x0 + clear.x1) / 2];
  const centerZs = [(clear.z0 + clear.z1) / 2];
  const list = options?.furniture ?? [];
  for (let i = 0; i < list.length; i++) {
    if (i === options?.excludeFurnitureIndex) continue;
    const item = list[i]!;
    if (
      item.x < room.x - 500 ||
      item.x > room.x + room.w + 500 ||
      item.z < room.z - 500 ||
      item.z > room.z + room.d + 500
    ) {
      continue;
    }
    const box = furnitureWorldBounds(item);
    edgeXs.push(box.x0, box.x1);
    edgeZs.push(box.z0, box.z1);
    centerXs.push((box.x0 + box.x1) / 2);
    centerZs.push((box.z0 + box.z1) / 2);
  }
  return {
    edgeXs: uniqueSorted(edgeXs, 30),
    edgeZs: uniqueSorted(edgeZs, 30),
    centerXs: uniqueSorted(centerXs, 30),
    centerZs: uniqueSorted(centerZs, 30),
    corners: [
      { x: clear.x0, z: clear.z0 },
      { x: clear.x1, z: clear.z0 },
      { x: clear.x0, z: clear.z1 },
      { x: clear.x1, z: clear.z1 },
    ],
    clear,
  };
}

/** 在 maxGap 内找最近锚线；没有则 null。 */
export function nearestAnchor(value: number, anchors: number[], maxGap: number): number | null {
  let best: number | null = null;
  let bestD = maxGap;
  for (const a of anchors) {
    const d = Math.abs(value - a);
    if (d <= bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/**
 * 拖隔墙时的吸附目标：
 * - 平移：平行墙／房间边的 X 或 Z（持平对齐）
 * - 拉端点：正交墙／房间边的交线（接到墙尖）
 */
export function collectWallMagnetAnchors(
  wall: Pick<Wall, "a" | "b">,
  candidates: Pick<Wall, "a" | "b">[],
  axisAnchors: { xs: number[]; zs: number[] },
): { xs: number[]; zs: number[] } {
  const axis = wallAxis(wall);
  const xs: number[] = [...axisAnchors.xs];
  const zs: number[] = [...axisAnchors.zs];
  for (const c of candidates) {
    const ca = wallAxis(c);
    if (axis === "h") {
      if (ca === "h") zs.push((c.a[1] + c.b[1]) / 2);
      if (ca === "v") xs.push((c.a[0] + c.b[0]) / 2);
    } else if (axis === "v") {
      if (ca === "v") xs.push((c.a[0] + c.b[0]) / 2);
      if (ca === "h") zs.push((c.a[1] + c.b[1]) / 2);
    }
  }
  return { xs: uniqueSorted(xs, 30), zs: uniqueSorted(zs, 30) };
}

/**
 * 拖隔墙过程中吸附：平移贴平行墙持平；拉端点优先贴正交墙对侧外皮／墙尖。
 * 就地改 wall，返回引导线。
 */
export function snapWallDuringDrag(
  wall: Wall,
  mode: "move" | "a" | "b",
  candidates: Pick<Wall, "a" | "b" | "role">[],
  axisAnchors: { xs: number[]; zs: number[] },
  maxGap = MAGNET_SNAP_GAP,
): { guideXs: number[]; guideZs: number[] } {
  forceOrthoWall(wall);
  const axis = wallAxis(wall);
  const { xs, zs } = collectWallMagnetAnchors(wall, candidates, axisAnchors);
  const guideXs: number[] = [];
  const guideZs: number[] = [];

  if (mode === "move") {
    if (axis === "h") {
      const z = (wall.a[1] + wall.b[1]) / 2;
      const target = nearestAnchor(z, zs, maxGap);
      if (target != null) {
        const dz = target - z;
        wall.a = [snapMeter(wall.a[0]), snapMeter(wall.a[1] + dz)];
        wall.b = [snapMeter(wall.b[0]), snapMeter(wall.b[1] + dz)];
        guideZs.push(target);
      }
    } else {
      const x = (wall.a[0] + wall.b[0]) / 2;
      const target = nearestAnchor(x, xs, maxGap);
      if (target != null) {
        const dx = target - x;
        wall.a = [snapMeter(wall.a[0] + dx), snapMeter(wall.a[1])];
        wall.b = [snapMeter(wall.b[0] + dx), snapMeter(wall.b[1])];
        guideXs.push(target);
      }
    }
  } else {
    const edgeGap = Math.max(maxGap, WALL_EDGE_SNAP_GAP);
    const segs: WallSnapSeg[] = collectWallSnapSegs(candidates);
    const fixed = mode === "a" ? wall.b : wall.a;
    const moving = mode === "a" ? wall.a : wall.b;
    const extended = extendOrthoEndToFarFace(
      fixed[0],
      fixed[1],
      moving[0],
      moving[1],
      segs,
      edgeGap,
    );
    if (extended.snapped) {
      if (mode === "a") wall.a = [extended.x, extended.z];
      else wall.b = [extended.x, extended.z];
      guideXs.push(...extended.guideXs);
      guideZs.push(...extended.guideZs);
    } else if (axis === "h") {
      const target = nearestAnchor(moving[0], xs, maxGap);
      if (target != null) {
        if (mode === "a") wall.a = [snapMeter(target), snapMeter(wall.a[1])];
        else wall.b = [snapMeter(target), snapMeter(wall.b[1])];
        guideXs.push(target);
      }
    } else {
      const target = nearestAnchor(moving[1], zs, maxGap);
      if (target != null) {
        if (mode === "a") wall.a = [snapMeter(wall.a[0]), snapMeter(target)];
        else wall.b = [snapMeter(wall.b[0]), snapMeter(target)];
        guideZs.push(target);
      }
    }
  }
  forceOrthoWall(wall);
  return { guideXs, guideZs };
}

/** 隔墙端点＋房间四角，供家具吸墙尖／墙角。 */
export function collectCornerSnapPoints(options: {
  partitions: Pick<Wall, "a" | "b">[];
  rooms: Pick<Room, "x" | "z" | "w" | "d">[];
  bounds?: { x0: number; x1: number; z0: number; z1: number }[];
}): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  const push = (x: number, z: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    pts.push({ x, z });
  };
  for (const wall of options.partitions) {
    push(wall.a[0], wall.a[1]);
    push(wall.b[0], wall.b[1]);
  }
  for (const room of options.rooms) {
    push(room.x, room.z);
    push(room.x + room.w, room.z);
    push(room.x, room.z + room.d);
    push(room.x + room.w, room.z + room.d);
  }
  for (const b of options.bounds ?? []) {
    push(b.x0, b.z0);
    push(b.x1, b.z0);
    push(b.x0, b.z1);
    push(b.x1, b.z1);
  }
  // 去重
  const out: { x: number; z: number }[] = [];
  for (const p of pts) {
    if (out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 40)) continue;
    out.push(p);
  }
  return out;
}

/**
 * 拖家具时吸附：
 * - 有房间时贴墙内皮（套内净空＋finish），不贴墙中线／外轮廓；
 * - 角贴净空角；接近中线时吸居中；靠墙件沿墙居中；
 * - 接近锚线（previewGap）即画引导线，便于找齐与居中。
 * allowCenter=false 时只贴边／角，不居中。
 */
export function snapFurnitureDuringDrag(
  f: Furniture,
  xs: number[],
  zs: number[],
  options?: {
    maxGap?: number;
    centerGap?: number;
    previewGap?: number;
    corners?: { x: number; z: number }[];
    room?: Room | null;
    floorIndex?: number;
    partitions?: Wall[];
    furniture?: Furniture[];
    excludeFurnitureIndex?: number;
    allowCenter?: boolean;
  },
): { guideXs: number[]; guideZs: number[] } {
  const maxGap = options?.maxGap ?? MAGNET_SNAP_GAP;
  const centerGap = options?.centerGap ?? MAGNET_CENTER_GAP;
  const previewGap = options?.previewGap ?? MAGNET_GUIDE_PREVIEW_GAP;
  const floorIndex = options?.floorIndex ?? 0;
  const partitions = options?.partitions;
  const room = options?.room ?? null;
  const allowCenter = options?.allowCenter !== false;

  let edgeXs = xs;
  let edgeZs = zs;
  let centerXs: number[] = [];
  let centerZs: number[] = [];
  let corners = options?.corners ?? [];

  if (room) {
    const anchors = collectFurnitureRoomAnchors(room, floorIndex, {
      partitions,
      furniture: options?.furniture,
      excludeFurnitureIndex: options?.excludeFurnitureIndex,
    });
    // 房内只用净空锚点，避免吸到墙中线把家具压进墙身。
    edgeXs = anchors.edgeXs;
    edgeZs = anchors.edgeZs;
    centerXs = anchors.centerXs;
    centerZs = anchors.centerZs;
    corners = anchors.corners;
  }

  const guideXs: number[] = [];
  const guideZs: number[] = [];
  const pushGuideX = (v: number) => {
    if (!guideXs.some((g) => Math.abs(g - v) < 20)) guideXs.push(v);
  };
  const pushGuideZ = (v: number) => {
    if (!guideZs.some((g) => Math.abs(g - v) < 20)) guideZs.push(v);
  };

  const box0 = furnitureWorldBounds(f);
  const midX0 = (box0.x0 + box0.x1) / 2;
  const midZ0 = (box0.z0 + box0.z1) / 2;

  // 接近即出引导线（未吸附也画）；房内始终标净空中线，方便找居中。
  for (const a of edgeXs) {
    if (Math.abs(box0.x0 - a) <= previewGap || Math.abs(box0.x1 - a) <= previewGap) pushGuideX(a);
  }
  for (const a of edgeZs) {
    if (Math.abs(box0.z0 - a) <= previewGap || Math.abs(box0.z1 - a) <= previewGap) pushGuideZ(a);
  }
  if (room && centerXs.length && centerZs.length) {
    pushGuideX(centerXs[0]!);
    pushGuideZ(centerZs[0]!);
  } else {
    for (const a of centerXs) {
      if (Math.abs(midX0 - a) <= previewGap) pushGuideX(a);
    }
    for (const a of centerZs) {
      if (Math.abs(midZ0 - a) <= previewGap) pushGuideZ(a);
    }
  }

  // 1) 外包四边贴最近竖／横锚线（房内＝墙内皮）
  let dx = 0;
  let dz = 0;
  let bestX: { d: number; delta: number; guide: number } | null = null;
  let bestZ: { d: number; delta: number; guide: number } | null = null;
  for (const a of edgeXs) {
    for (const [edge, delta] of [
      [box0.x0, a - box0.x0],
      [box0.x1, a - box0.x1],
    ] as const) {
      const d = Math.abs(edge - a);
      if (d <= maxGap && (!bestX || d < bestX.d)) bestX = { d, delta, guide: a };
    }
  }
  for (const a of edgeZs) {
    for (const [edge, delta] of [
      [box0.z0, a - box0.z0],
      [box0.z1, a - box0.z1],
    ] as const) {
      const d = Math.abs(edge - a);
      if (d <= maxGap && (!bestZ || d < bestZ.d)) bestZ = { d, delta, guide: a };
    }
  }
  if (bestX) {
    dx = bestX.delta;
    pushGuideX(bestX.guide);
  }
  if (bestZ) {
    dz = bestZ.delta;
    pushGuideZ(bestZ.guide);
  }

  // 2) 外包角吸到净空角／墙尖（比边吸更近时优先）
  if (corners.length) {
    const cornerLocal = [
      { cx: box0.x0, cz: box0.z0 },
      { cx: box0.x1, cz: box0.z0 },
      { cx: box0.x0, cz: box0.z1 },
      { cx: box0.x1, cz: box0.z1 },
    ];
    let bestCorner: { dist: number; dx: number; dz: number; x: number; z: number } | null = null;
    for (const c of corners) {
      for (const corner of cornerLocal) {
        const dist = Math.hypot(corner.cx + dx - c.x, corner.cz + dz - c.z);
        if (dist <= maxGap && (!bestCorner || dist < bestCorner.dist)) {
          bestCorner = {
            dist,
            dx: c.x - corner.cx,
            dz: c.z - corner.cz,
            x: c.x,
            z: c.z,
          };
        }
      }
    }
    if (bestCorner) {
      const preferCorner =
        (!bestX || bestCorner.dist < bestX.d) && (!bestZ || bestCorner.dist < bestZ.d);
      if (preferCorner || bestCorner.dist < maxGap * 0.85) {
        dx = bestCorner.dx;
        dz = bestCorner.dz;
        guideXs.length = 0;
        guideZs.length = 0;
        pushGuideX(bestCorner.x);
        pushGuideZ(bestCorner.z);
        if (room && centerXs.length && centerZs.length) {
          pushGuideX(centerXs[0]!);
          pushGuideZ(centerZs[0]!);
        }
      }
    }
  }

  if (Math.abs(dx) > 1e-9 || Math.abs(dz) > 1e-9) {
    f.x = snapMeter(f.x + dx);
    f.z = snapMeter(f.z + dz);
  }

  // 3) 居中：自由件可吸净空中线；靠墙件贴墙后沿墙居中，避免被拉到房间正中离墙。
  if (allowCenter) {
    const nearWall =
      room != null && nearestRoomWall(f, room, floorIndex, partitions).gap <= maxGap + 60;
    if (room && furnitureUsesWallCenter(f.kind) && nearWall) {
      const wall = nearestRoomWall(f, room, floorIndex, partitions);
      if (Math.abs(wall.alongDelta) <= centerGap) {
        const before = { x: f.x, z: f.z };
        centerFurnitureAgainstNearestWall(f, room, floorIndex, FURNITURE_WALL_FINISH, partitions);
        if (Math.abs(f.x - before.x) > 1e-6 || Math.abs(f.z - before.z) > 1e-6) {
          const clear = roomFurnitureClearRect(room, floorIndex, FURNITURE_WALL_FINISH, partitions);
          if (wall.side === "west" || wall.side === "east") {
            pushGuideX(wall.side === "west" ? clear.x0 : clear.x1);
            pushGuideZ((clear.z0 + clear.z1) / 2);
          } else {
            pushGuideZ(wall.side === "north" ? clear.z0 : clear.z1);
            pushGuideX((clear.x0 + clear.x1) / 2);
          }
        }
      }
    } else if (centerXs.length || centerZs.length) {
      const box = furnitureWorldBounds(f);
      const mx = (box.x0 + box.x1) / 2;
      const mz = (box.z0 + box.z1) / 2;
      const cx = nearestAnchor(mx, centerXs, centerGap);
      const cz = nearestAnchor(mz, centerZs, centerGap);
      if (cx != null) {
        f.x = snapMeter(f.x + (cx - mx));
        pushGuideX(cx);
      }
      if (cz != null) {
        f.z = snapMeter(f.z + (cz - mz));
        pushGuideZ(cz);
      }
    }
  }

  // 松手前再钳出墙厚，避免吸附抖动后仍压线。
  if (room) pullFurnitureClearOfWalls(f, room, floorIndex, FURNITURE_WALL_FINISH, partitions);

  return { guideXs: uniqueSorted(guideXs, 20), guideZs: uniqueSorted(guideZs, 20) };
}
