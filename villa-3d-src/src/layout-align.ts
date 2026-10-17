import type { Furniture, Point, Room, Wall } from "./data";
import { annexFurniture, annexRooms, floors, site } from "./data";
import { roomFillBounds } from "./design-data";
import { furnitureLocalBounds, furnitureLocalToWorld } from "./furniture-catalog";
import { normalizeOpening, type WallOpening } from "./openings";
import { forceOrthoWall, snapMeter, wallAxis } from "./layout-draft";

/** 家具贴墙内皮后再留的示意缝（米），避免色块压进墙线。 */
export const FURNITURE_WALL_FINISH = 0.02;

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

function pushStation(out: number[], value: number, wallLen: number, pad = 0.02) {
  if (!Number.isFinite(value)) return;
  if (value < -pad || value > wallLen + pad) return;
  out.push(Math.min(wallLen, Math.max(0, value)));
}

function uniqueSorted(values: number[], eps = 0.08) {
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
  const near = 0.45;

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
  const w = Math.max(0.3, width);
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

/** 从隔墙／房间边／外轮廓收集可吸附的竖线 X 与横线 Z。 */
export function collectRoomSnapAxes(options: {
  partitions: Wall[];
  rooms: Room[];
  excludeRoomId?: string;
  bounds?: { x0: number; x1: number; z0: number; z1: number }[];
}): { xs: number[]; zs: number[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  const pushX = (v: number) => {
    if (Number.isFinite(v)) xs.push(v);
  };
  const pushZ = (v: number) => {
    if (Number.isFinite(v)) zs.push(v);
  };

  for (const wall of options.partitions) {
    const dx = Math.abs(wall.b[0] - wall.a[0]);
    const dz = Math.abs(wall.b[1] - wall.a[1]);
    if (dx <= dz * 0.35) pushX((wall.a[0] + wall.b[0]) / 2);
    if (dz <= dx * 0.35) pushZ((wall.a[1] + wall.b[1]) / 2);
  }

  for (const room of options.rooms) {
    if (room.id === options.excludeRoomId) continue;
    pushX(room.x);
    pushX(room.x + room.w);
    pushZ(room.z);
    pushZ(room.z + room.d);
  }

  for (const b of options.bounds ?? []) {
    pushX(b.x0);
    pushX(b.x1);
    pushZ(b.z0);
    pushZ(b.z1);
  }

  return { xs: uniqueSorted(xs, 0.04), zs: uniqueSorted(zs, 0.04) };
}

/**
 * 固定宽／进深，把房间贴到最近的竖墙（改 X）与最近的横墙（改 Z）——共两面。
 * maxGap 内才吸附；改尺寸时可用较大阈值，确保贴上最近两面墙。
 */
export function snapRoomToNearestWalls(
  room: Room,
  xs: number[],
  zs: number[],
  maxGap = 0.55,
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
  room.label = [room.x + room.w / 2, room.z + room.d / 2];
  return room;
}

/** 房间四边（北＝小 Z／前，南＝大 Z／后）。 */
export type RoomEdgeSide = "west" | "east" | "north" | "south";

export type OwnedWallRef = { index: number; edge: RoomEdgeSide };

const ROOM_WALL_EDGE_TOL = 0.08;
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
    if (edgeLen < 0.05 || wallLen < 0.05) continue;
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
      (o) => wallTouchesRoomEdge(wall, o, { tol: opts?.tol, softCover: 0.2 }) != null,
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
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return;
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
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return;
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
  return alongX && Math.abs(midZ - frontZ) < 0.35;
}

export function formatMeters(value: number) {
  const n = Math.round(value * 100) / 100;
  return (Object.is(n, -0) ? 0 : n).toFixed(2);
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
  minSize = 0.8,
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
function nearAlong(value: number, a0: number, a1: number, pad = 0.35) {
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
  eps = 0.04,
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

/** 拖拽吸附默认阈值（米）：手抖对不齐时吸上，故意偏离时仍可躲开。 */
export const MAGNET_SNAP_GAP = 0.12;
/** 靠墙家具沿墙居中：仅当已接近居中线时才吸（可故意偏一侧摆）。 */
export const MAGNET_CENTER_GAP = 0.18;

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
  return { xs: uniqueSorted(xs, 0.03), zs: uniqueSorted(zs, 0.03) };
}

/**
 * 拖隔墙过程中吸附：平移贴平行墙持平；拉端点贴正交墙／轴线。
 * 就地改 wall，返回引导线。
 */
export function snapWallDuringDrag(
  wall: Wall,
  mode: "move" | "a" | "b",
  candidates: Pick<Wall, "a" | "b">[],
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
    const moving = mode === "a" ? wall.a : wall.b;
    if (axis === "h") {
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
    if (out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.04)) continue;
    out.push(p);
  }
  return out;
}

/**
 * 拖家具时吸附：外包边贴墙线、角贴墙尖／墙角；靠墙件接近居中线时再吸居中。
 * allowCenter=false 时只贴边／角，不居中。
 */
export function snapFurnitureDuringDrag(
  f: Furniture,
  xs: number[],
  zs: number[],
  options?: {
    maxGap?: number;
    centerGap?: number;
    corners?: { x: number; z: number }[];
    room?: Room | null;
    floorIndex?: number;
    allowCenter?: boolean;
  },
): { guideXs: number[]; guideZs: number[] } {
  const maxGap = options?.maxGap ?? MAGNET_SNAP_GAP;
  const centerGap = options?.centerGap ?? MAGNET_CENTER_GAP;
  const guideXs: number[] = [];
  const guideZs: number[] = [];
  const box = furnitureWorldBounds(f);
  const fw = box.x1 - box.x0;
  const fd = box.z1 - box.z0;

  // 1) 外包四边贴最近竖／横轴线
  let dx = 0;
  let dz = 0;
  let bestX: { d: number; delta: number; guide: number } | null = null;
  let bestZ: { d: number; delta: number; guide: number } | null = null;
  for (const a of xs) {
    for (const [edge, delta] of [
      [box.x0, a - box.x0],
      [box.x1, a - box.x1],
    ] as const) {
      const d = Math.abs(edge - a);
      if (d <= maxGap && (!bestX || d < bestX.d)) bestX = { d, delta, guide: a };
    }
  }
  for (const a of zs) {
    for (const [edge, delta] of [
      [box.z0, a - box.z0],
      [box.z1, a - box.z1],
    ] as const) {
      const d = Math.abs(edge - a);
      if (d <= maxGap && (!bestZ || d < bestZ.d)) bestZ = { d, delta, guide: a };
    }
  }
  if (bestX) {
    dx = bestX.delta;
    guideXs.push(bestX.guide);
  }
  if (bestZ) {
    dz = bestZ.delta;
    guideZs.push(bestZ.guide);
  }

  // 2) 外包角吸到墙尖／房间角（比边吸更近时优先）
  const corners = options?.corners ?? [];
  if (corners.length) {
    const cornerLocal = [
      { cx: box.x0, cz: box.z0 },
      { cx: box.x1, cz: box.z0 },
      { cx: box.x0, cz: box.z1 },
      { cx: box.x1, cz: box.z1 },
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
    if (bestCorner && (!bestX || bestCorner.dist < bestX.d) && (!bestZ || bestCorner.dist < bestZ.d)) {
      dx = bestCorner.dx;
      dz = bestCorner.dz;
      guideXs.length = 0;
      guideZs.length = 0;
      guideXs.push(bestCorner.x);
      guideZs.push(bestCorner.z);
    } else if (bestCorner && bestCorner.dist < maxGap * 0.85) {
      // 边已吸上时，若角也很近则微调到墙尖
      dx = bestCorner.dx;
      dz = bestCorner.dz;
      if (!guideXs.includes(bestCorner.x)) guideXs.push(bestCorner.x);
      if (!guideZs.includes(bestCorner.z)) guideZs.push(bestCorner.z);
    }
  }

  if (Math.abs(dx) > 1e-9 || Math.abs(dz) > 1e-9) {
    f.x = snapMeter(f.x + dx);
    f.z = snapMeter(f.z + dz);
  }

  // 3) 靠墙件：已贴墙且接近居中线时吸居中（桌椅等自由件跳过）
  const room = options?.room ?? null;
  const floorIndex = options?.floorIndex ?? 0;
  if (
    options?.allowCenter !== false &&
    room &&
    furnitureUsesWallCenter(f.kind)
  ) {
    const wall = nearestRoomWall(f, room, floorIndex);
    if (wall.gap <= maxGap + 0.04 && Math.abs(wall.alongDelta) <= centerGap) {
      const before = { x: f.x, z: f.z };
      centerFurnitureAgainstNearestWall(f, room, floorIndex);
      if (Math.abs(f.x - before.x) > 1e-6 || Math.abs(f.z - before.z) > 1e-6) {
        const clear = roomFurnitureClearRect(room, floorIndex);
        if (wall.side === "west" || wall.side === "east") guideXs.push(wall.side === "west" ? clear.x0 : clear.x1);
        else guideZs.push(wall.side === "north" ? clear.z0 : clear.z1);
      }
    }
  }

  return { guideXs: uniqueSorted(guideXs, 0.02), guideZs: uniqueSorted(guideZs, 0.02) };
}
