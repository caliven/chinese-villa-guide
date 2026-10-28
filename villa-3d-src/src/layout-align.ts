import type { Furniture, Point, Room, Wall } from "./data";
import { annexFurniture, annexRooms, construction, floors, isPhysicalWall, site, wallRoleOf } from "./data";
import { roomFillBounds } from "./design-data";
import { furnitureLocalBounds, furnitureLocalToWorld } from "./furniture-catalog";
import { getFloorplanFurniture } from "./floorplan-catalog";
import { normalizeOpening, type WallOpening } from "./openings";
import {
  forceOrthoWall,
  snapMeter,
  wallAxis,
  WALL_EDGE_SNAP_GAP,
} from "./layout-draft";
import { constrainWallEdits, type WallConstraintResult } from "./wall-constraints";
import { polygonAreaMm2, roomContainsPoint, roomIsRectangular, roomOutline } from "./room-geometry";
import { polygonIntersectionAreaMm2 } from "./plan-regions";
import { FURNITURE_WALL_FINISH, furnitureWallFinish, physicalFurnitureAnchors, resolveFurnitureCollisions } from "./furniture-placement";
import type { WallContactTarget } from "./wall-contact-snap";

/** 家具贴墙内皮后再留的示意缝（mm），避免色块压进墙线。 */
export { FURNITURE_WALL_FINISH } from "./furniture-placement";

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

/** 按真正接触所在墙的垂直墙面确定净开间；虚拟墙仅作为零厚度分界。 */
export function bayBetweenWalls(a: Point, b: Point, opening: WallOpening, walls: Wall[], rooms: Room[] = [], hostThickness = construction.outsideWall): OpeningBay {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
  const dividers: { center: number; half: number }[] = [];
  for (const wall of walls) {
    const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1];
    const wallLength = Math.hypot(dx, dz);
    if (wallLength < 1 || Math.abs((dx * ux + dz * uz) / wallLength) > 0.01) continue;
    const cross = (p: Point) => (p[0] - a[0]) * -uz + (p[1] - a[1]) * ux;
    const c0 = cross(wall.a), c1 = cross(wall.b), reach = hostThickness / 2 + 1;
    if (Math.min(c0, c1) > reach || Math.max(c0, c1) < -reach) continue;
    const center = stationAlongWall(a, b, wall.a[0], wall.a[1]);
    if (center < -1 || center > length + 1) continue;
    const half = !isPhysicalWall(wall) ? 0 : (wallRoleOf(wall) === "bearing" ? construction.outsideWall : construction.partition) / 2;
    dividers.push({ center, half });
  }
  if (!dividers.length) return bayAlongWall(a, b, opening, collectBayStations(a, b, [], rooms));

  const center = opening.offset + opening.width / 2;
  let start = 0, end = length;
  for (const divider of dividers) {
    if (divider.center <= center) start = Math.max(start, divider.center + divider.half);
    if (divider.center >= center) end = Math.min(end, divider.center - divider.half);
  }
  const bayWidth = Math.max(0, end - start);
  return { bayStart: start, bayEnd: end, bayWidth, leftClear: opening.offset - start,
    rightClear: end - opening.offset - opening.width, centerDelta: center - (start + end) / 2, wallLen: length };
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
  const hits = rooms.filter(r => roomContainsPoint(r, [f.x, f.z]));
  if (!hits.length) return null;
  hits.sort((a, b) => polygonAreaMm2(roomOutline(a)) - polygonAreaMm2(roomOutline(b)));
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
  if (!roomIsRectangular(room)) return f;
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
  const model = getFloorplanFurniture(kind);
  if (model) return !["table", "roundtable", "chair", "officechair", "coffeetable", "sidetable", "island", "barstool", "rug", "beanbag", "floorlamp", "plant"].includes(model.type);
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
  finish = furnitureWallFinish(f),
  partitions?: Wall[],
) {
  if (!roomIsRectangular(room)) return f;
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
  if (!roomIsRectangular(room)) return f;
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
  // 关闭磁吸时保留旧稿尚未量化的原点；数值编辑只改明确输入的尺寸轴。
  const quantize = (value: number) => tol === 0 ? value : snapMeter(value);
  out.x = quantize(x0);
  out.z = quantize(z0);
  out.w = quantize(x1 - x0);
  out.d = quantize(z1 - z0);
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
  tol = 120,
): Room {
  const size = Math.max(800, snapMeter(nextSize));
  // 先吸回外皮，再判锁边，避免用 20212 这种漂移边当「外墙」
  const base = clampRoomToEnvelope(room, body, tol);
  const out: Room = { ...base, label: base.label ? ([...base.label] as [number, number]) : undefined };
  if (field === "w") {
    const westLock = roomEdgeOnEnvelope(base, "west", body, tol);
    const eastLock = roomEdgeOnEnvelope(base, "east", body, tol);
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
      out.x = tol === 0 ? base.x : snapMeter(base.x);
      out.w = size;
    }
  } else {
    const northLock = roomEdgeOnEnvelope(base, "north", body, tol);
    const southLock = roomEdgeOnEnvelope(base, "south", body, tol);
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
      out.z = tol === 0 ? base.z : snapMeter(base.z);
      out.d = size;
    }
  }
  out.label = [out.x + out.w / 2, out.z + out.d / 2];
  return clampRoomToEnvelope(out, body, tol);
}

const ROOM_EDGES: RoomEdgeSide[] = ["west", "east", "north", "south"];

function wallHalfForRoom(wall: Wall): number {
  return !isPhysicalWall(wall) ? 0 :
    (wallRoleOf(wall) === "bearing" ? construction.outsideWall : construction.partition) / 2;
}

/** 中线或房间一侧实际内皮才算邻接；此处不使用鼠标吸附距离。 */
function roomEdgeMeetsWall(room: Room, edge: RoomEdgeSide, wall: Wall): boolean {
  const g = roomEdgeGeom(room, edge);
  const axis = wallAxis(wall);
  if (axis !== g.axis) return false;
  const normal = axis === "v" ? 0 : 1;
  const along = axis === "v" ? 1 : 0;
  if (Math.abs(wall.a[normal] - wall.b[normal]) > 1) return false;
  const at = (wall.a[normal] + wall.b[normal]) / 2;
  const inwardOffset = (edge === "west" || edge === "north") ? g.c - at : at - g.c;
  return inwardOffset >= -1 && inwardOffset <= wallHalfForRoom(wall) + 1 &&
    spanOverlap(wall.a[along], wall.b[along], g.lo, g.hi) > 1;
}

function validRoomRect(room: Room, body: EnvelopeRect): boolean {
  return [room.x, room.z, room.w, room.d].every(Number.isFinite) &&
    room.w >= 800 && room.d >= 800 && room.x >= body.x - 1 && room.z >= body.z - 1 &&
    room.x + room.w <= body.x + body.w + 1 && room.z + room.d <= body.z + body.d + 1;
}

function updateRectOutline(room: Room): void {
  if (room.outline) room.outline = [
    [room.x, room.z], [room.x + room.w, room.z],
    [room.x + room.w, room.z + room.d], [room.x, room.z + room.d],
  ];
  room.label = [room.x + room.w / 2, room.z + room.d / 2];
}

/**
 * 普通房不能在修改轮廓后新增覆盖楼梯／挑空。历史套叠只允许维持或减少交集。
 * 使用同 id 的保护区前后轮廓比较，面积舍入容差为其 1 mm 周界带面积。
 * 普通房自身真实几何未变化时跳过，以允许专用楼梯／挑空操作主动调整位置。
 */
export function validateProtectedRoomOverlaps(originalRooms: Room[], rooms: Room[]): WallConstraintResult {
  const originals = new Map(originalRooms.map(room => [room.id, room]));
  const protectedRooms = rooms.filter(room => room.kind === "stair" || room.kind === "void");
  for (const room of rooms) {
    if (room.kind === "stair" || room.kind === "void") continue;
    const original = originals.get(room.id);
    const outline = roomOutline(room);
    const originalOutline = original ? roomOutline(original) : null;
    if (originalOutline && JSON.stringify(originalOutline) === JSON.stringify(outline)) continue;
    for (const protectedRoom of protectedRooms) {
      const protectedOutline = roomOutline(protectedRoom);
      const originalProtected = originals.get(protectedRoom.id);
      const before = originalOutline && originalProtected ?
        polygonIntersectionAreaMm2(originalOutline, roomOutline(originalProtected)) : 0;
      const after = polygonIntersectionAreaMm2(outline, protectedOutline);
      const oneMillimeterBandArea = protectedOutline.reduce((length, point, i) => {
        const next = protectedOutline[(i + 1) % protectedOutline.length]!;
        return length + Math.hypot(next[0] - point[0], next[1] - point[1]);
      }, 0);
      if (after - before > Math.max(1, oneMillimeterBandArea)) {
        return { ok: false, reason: `${room.name}调整后新增覆盖${protectedRoom.name}，请先通过专用几何调整楼梯或挑空` };
      }
    }
  }
  return { ok: true };
}

/**
 * 所有墙编辑入口共用的手工房边界更新。用原墙、原房识别关系，同时更新贯通墙两侧及同侧房间。
 * 楼梯模型不参与墙边界联动；挑空和手工非矩形不得被隐式改写。
 * 已关联真实轮廓的普通房由 room-sync 重算。
 * 成功才提交 rooms；失败保留调用时内容，walls 由上层墙事务负责回滚。
 */
export function syncRoomsToMovedWalls(
  originalWalls: Wall[],
  walls: Wall[],
  originalRooms: Room[],
  rooms: Room[],
  body: EnvelopeRect,
): WallConstraintResult {
  if (originalWalls.length !== walls.length) return { ok: false, reason: "墙体快照与当前墙列表不一致" };
  const candidate = structuredClone(rooms);
  for (const originalRoom of originalRooms) {
    // 自画侧墙独立于楼梯模型；移动墙不能隐式改写三层梯段、梯间框或洞口。
    if (originalRoom.kind === "stair") continue;
    const target = candidate.find(room => room.id === originalRoom.id);
    if (!target) continue;
    const changes = new Map<RoomEdgeSide, number>();
    for (let i = 0; i < walls.length; i += 1) {
      const original = originalWalls[i]!;
      const next = walls[i]!;
      const normal = wallAxis(original) === "v" ? 0 : 1;
      const delta = (next.a[normal] + next.b[normal] - original.a[normal] - original.b[normal]) / 2;
      if (Math.abs(delta) < 0.5) continue;
      for (const edge of ROOM_EDGES) {
        if (!roomEdgeMeetsWall(originalRoom, edge, original)) continue;
        if (originalRoom.kind === "void") {
          // 虚拟线只划分楼板上的普通房间，不是洞口的实体共墙。
          // 尤其不能因 1 mm 邻接容差把 4199→4200 的对齐误判为修改挑空。
          if (!isPhysicalWall(original) && !isPhysicalWall(next)) continue;
          return { ok: false, reason: `${originalRoom.name}为挑空，须通过专用几何编辑后再调整共墙` };
        }
        if (originalRoom.boundary && !roomIsRectangular(originalRoom)) continue;
        if (originalRoom.outline && originalRoom.outline.length > 4) {
          return { ok: false, reason: `${originalRoom.name}为非矩形房间，请编辑轮廓或墙边界` };
        }
        const existing = changes.get(edge);
        if (existing !== undefined && Math.abs(existing - delta) > 1) {
          return { ok: false, reason: `${originalRoom.name}的同一房边对应墙段位移不一致` };
        }
        changes.set(edge, delta);
      }
    }
    if (changes.size === 0) continue;
    const west = originalRoom.x + (changes.get("west") ?? 0);
    const east = originalRoom.x + originalRoom.w + (changes.get("east") ?? 0);
    const north = originalRoom.z + (changes.get("north") ?? 0);
    const south = originalRoom.z + originalRoom.d + (changes.get("south") ?? 0);
    target.x = snapMeter(west);
    target.z = snapMeter(north);
    target.w = snapMeter(east - west);
    target.d = snapMeter(south - north);
    if (!validRoomRect(target, body)) {
      return { ok: false, reason: `${target.name}调整后小于800或超出楼体，已取消本次编辑` };
    }
    updateRectOutline(target);
  }
  for (let i = 0; i < rooms.length; i += 1) Object.assign(rooms[i]!, candidate[i]!);
  return { ok: true };
}

/**
 * 房间尺寸撑墙的完整事务：先生成候选墙，统一传播真实接点，再更新所有相邻房间。
 * 成功同时提交 walls 和 rooms 中同 id 的选中房；失败不修改任何输入。
 */
export function syncInteriorWallsToRoom(
  roomOrig: Room,
  roomNext: Room,
  walls: Wall[],
  rooms: Room[],
  body: EnvelopeRect,
): WallConstraintResult {
  if (roomOrig.kind === "stair" || roomOrig.kind === "void") {
    return { ok: false, reason: "楼梯与挑空须通过专用几何编辑" };
  }
  if ((roomOrig.outline?.length ?? 0) > 4 || (roomNext.outline?.length ?? 0) > 4) {
    return { ok: false, reason: "非矩形房间不能用包络宽深撑墙，请编辑轮廓或墙边界" };
  }
  if (!validRoomRect(roomNext, body)) return { ok: false, reason: "房间尺寸小于800或超出楼体" };
  const originalWalls = structuredClone(walls);
  const candidateWalls = structuredClone(walls);
  const candidateRooms = structuredClone(rooms);
  const originalRooms = rooms.map(room => structuredClone(room.id === roomOrig.id ? roomOrig : room));
  const edited = new Set<number>();
  for (const edge of ROOM_EDGES) {
    const before = roomEdgeGeom(roomOrig, edge);
    const after = roomEdgeGeom(roomNext, edge);
    const delta = after.c - before.c;
    const exterior = roomEdgeOnEnvelope(roomOrig, edge, body, 1);
    if (exterior && Math.abs(delta) > 1) return { ok: false, reason: "外墙外皮固定，不能通过房间尺寸移动外墙" };
    for (let i = 0; i < originalWalls.length; i += 1) {
      const original = originalWalls[i]!;
      if (!roomEdgeMeetsWall(roomOrig, edge, original)) continue;
      const next = candidateWalls[i]!;
      const along = before.axis === "v" ? 1 : 0;
      const normal = before.axis === "v" ? 0 : 1;
      for (const end of ["a", "b"] as const) {
        next[end][normal] = snapMeter(original[end][normal] + (exterior ? 0 : delta));
        if (Math.abs(original[end][along] - before.lo) <= wallHalfForRoom(original) + 1) {
          next[end][along] = snapMeter(original[end][along] + after.lo - before.lo);
        } else if (Math.abs(original[end][along] - before.hi) <= wallHalfForRoom(original) + 1) {
          next[end][along] = snapMeter(original[end][along] + after.hi - before.hi);
        }
      }
      if (next.a.some((value, k) => value !== original.a[k]) || next.b.some((value, k) => value !== original.b[k])) edited.add(i);
    }
  }
  const constrained = constrainWallEdits(candidateWalls, originalWalls, [...edited]);
  if (!constrained.ok) return constrained;
  const synchronized = syncRoomsToMovedWalls(originalWalls, candidateWalls, originalRooms, candidateRooms, body);
  if (!synchronized.ok) return synchronized;
  const target = candidateRooms.find(room => room.id === roomOrig.id);
  if (target) {
    Object.assign(target, structuredClone(roomNext));
    updateRectOutline(target);
  }
  const protectedResult = validateProtectedRoomOverlaps(originalRooms, candidateRooms);
  if (!protectedResult.ok) return protectedResult;
  for (let i = 0; i < walls.length; i += 1) Object.assign(walls[i]!, candidateWalls[i]!);
  for (let i = 0; i < rooms.length; i += 1) Object.assign(rooms[i]!, candidateRooms[i]!);
  return { ok: true };
}

/** 门厅居中以主楼中央控制区为准，室内堂屋宽度和偏移不改变立面中轴。 */
export function findMiddleBay(_rooms: Room[]): { start: number; end: number; label: string } {
  const center = site.main.x + site.main.w / 2;
  return {
    start: center - site.portico.w / 2,
    end: center + site.portico.w / 2,
    label: "主楼中央控制区",
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
  candidates: WallContactTarget[],
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
      const cx = (c.a[0] + c.b[0]) / 2 +
        (c.exterior && isPhysicalWall(wall) ? (side === "left" ? -1 : 1) * construction.outsideWall / 2 : 0);
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
    const cz = (c.a[1] + c.b[1]) / 2 +
      (c.exterior && isPhysicalWall(wall) ? (side === "up" ? -1 : 1) * construction.outsideWall / 2 : 0);
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

/** 墙线定位按准确毫米去重，不能将相邻分段的 7／13 mm 误差吞成同一轴。 */
function exactWallAxes(values: number[]) {
  return [...new Set(values.filter(Number.isFinite).map(Math.round))].sort((a, b) => a - b);
}

export function wallLinePosition(wall: Pick<Wall, "a" | "b">) {
  const normal = wallAxis(wall) === "h" ? 1 : 0;
  return Math.round((wall.a[normal] + wall.b[normal]) / 2);
}

/** 就近参考平行墙。近乎共线的分段不当作另一侧墙距；尺寸为墙线距，不是净宽。 */
export function parallelWallDistances(wall: Wall, candidates: Pick<Wall, "a" | "b">[]) {
  const axis = wallAxis(wall), along = axis === "h" ? 0 : 1;
  const at = wallLinePosition(wall);
  const lo = Math.min(wall.a[along], wall.b[along]), hi = Math.max(wall.a[along], wall.b[along]);
  const result: { low?: { at: number; distance: number }; high?: { at: number; distance: number } } = {};
  for (const candidate of candidates) {
    if (wallAxis(candidate) !== axis) continue;
    const overlap = Math.min(hi, Math.max(candidate.a[along], candidate.b[along])) -
      Math.max(lo, Math.min(candidate.a[along], candidate.b[along]));
    if (overlap <= 1) continue;
    const target = wallLinePosition(candidate), distance = Math.abs(target - at);
    if (distance <= MAGNET_SNAP_GAP) continue;
    const side = target < at ? "low" : "high";
    if (!result[side] || distance < result[side]!.distance) result[side] = { at: target, distance };
  }
  return result;
}

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
  if (!roomIsRectangular(room)) return {
    edgeXs: [], edgeZs: [], centerXs: [], centerZs: [], corners: [], clear,
  };
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
  return { xs: exactWallAxes(xs), zs: exactWallAxes(zs) };
}

/**
 * 拖隔墙过程中吸附：平移贴平行墙持平；拉端点只能沿固定端原轴线吸向真实墙段交点。
 * 就地改 wall，返回引导线。
 */
export function snapWallDuringDrag(
  wall: Wall,
  mode: "move" | "a" | "b",
  candidates: WallContactTarget[],
  axisAnchors: { xs: number[]; zs: number[] },
  maxGap = MAGNET_SNAP_GAP,
): { guideXs: number[]; guideZs: number[] } {
  const fixedEnd = mode === "a" ? "b" : "a";
  forceOrthoWall(wall, mode === "move" ? "center" : fixedEnd);
  const axis = wallAxis(wall);
  const { xs, zs } = collectWallMagnetAnchors(wall, candidates, axisAnchors);
  const guideXs: number[] = [];
  const guideZs: number[] = [];

  if (mode === "move") {
    // 真实平行墙先于辅助轴；辅助轴不能把准确墙线拉回自己的旧位置。
    const parallel = candidates.filter(candidate => wallAxis(candidate) === axis).map(wallLinePosition);
    if (axis === "h") {
      const z = (wall.a[1] + wall.b[1]) / 2;
      const target = nearestAnchor(z, parallel, maxGap) ?? nearestAnchor(z, zs, maxGap);
      if (target != null) {
        const dz = target - z;
        wall.a = [snapMeter(wall.a[0]), snapMeter(wall.a[1] + dz)];
        wall.b = [snapMeter(wall.b[0]), snapMeter(wall.b[1] + dz)];
        guideZs.push(target);
      }
    } else {
      const x = (wall.a[0] + wall.b[0]) / 2;
      const target = nearestAnchor(x, parallel, maxGap) ?? nearestAnchor(x, xs, maxGap);
      if (target != null) {
        const dx = target - x;
        wall.a = [snapMeter(wall.a[0] + dx), snapMeter(wall.a[1])];
        wall.b = [snapMeter(wall.b[0] + dx), snapMeter(wall.b[1])];
        guideXs.push(target);
      }
    }
  } else {
    const edgeGap = Math.max(maxGap, WALL_EDGE_SNAP_GAP);
    const fixed = mode === "a" ? wall.b : wall.a;
    const moving = mode === "a" ? wall.a : wall.b;
    const along = axis === "h" ? 0 : 1;
    const normal = axis === "h" ? 1 : 0;
    const targets: number[] = [];
    for (const candidate of candidates) {
      const candidateAxis = wallAxis(candidate);
      if (candidateAxis === axis) {
        if (Math.abs(candidate.a[normal] - fixed[normal]) > 1 ||
            Math.abs(candidate.b[normal] - fixed[normal]) > 1) continue;
        targets.push(candidate.a[along], candidate.b[along]);
      } else {
        const lo = Math.min(candidate.a[normal], candidate.b[normal]);
        const hi = Math.max(candidate.a[normal], candidate.b[normal]);
        if (fixed[normal] < lo - 1 || fixed[normal] > hi + 1) continue;
        const center = (candidate.a[along] + candidate.b[along]) / 2;
        const farSide = candidate.exterior && isPhysicalWall(wall)
          ? Math.sign(moving[along] - fixed[along]) * construction.outsideWall / 2 : 0;
        targets.push(center + farSide);
      }
    }
    const wallTarget = nearestAnchor(moving[along], targets, edgeGap);
    const target = wallTarget ?? nearestAnchor(moving[along], axis === "h" ? axisAnchors.xs : axisAnchors.zs, maxGap);
    if (target !== null) {
      wall[mode] = axis === "h" ? [snapMeter(target), fixed[1]] : [fixed[0], snapMeter(target)];
      if (axis === "h") guideXs.push(target);
      else guideZs.push(target);
      if (wallTarget !== null) {
        if (axis === "h") guideZs.push(fixed[1]);
        else guideXs.push(fixed[0]);
      }
    }
  }
  forceOrthoWall(wall, mode === "move" ? "center" : fixedEnd);
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
    /** 含外墙的实体碰撞列表；房间净空计算仍沿用 partitions。 */
    collisionWalls?: Wall[];
    previous?: { x: number; z: number };
  },
): { guideXs: number[]; guideZs: number[] } {
  const maxGap = options?.maxGap ?? MAGNET_SNAP_GAP;
  const centerGap = options?.centerGap ?? MAGNET_CENTER_GAP;
  const previewGap = options?.previewGap ?? MAGNET_GUIDE_PREVIEW_GAP;
  const floorIndex = options?.floorIndex ?? 0;
  const finish = furnitureWallFinish(f);
  const partitions = options?.partitions;
  const physicalWalls = options?.collisionWalls ?? partitions ?? [];
  // 先退出实际墙带，再判断房间归属，避免指针刚越过墙中线便被邻房净空拉到墙另一侧。
  resolveFurnitureCollisions(f, { walls: physicalWalls, furniture: [], previous: options?.previous });
  const suggestedRoom = options?.room;
  const room = suggestedRoom && roomContainsPoint(suggestedRoom, [f.x, f.z]) ? suggestedRoom : null;
  // 凹形净空不能以包络矩形吸附／钳位，待真实轮廓家具约束实现后再启用。
  if (room && !roomIsRectangular(room) && !options?.collisionWalls?.length && !options?.furniture?.length) return { guideXs: [], guideZs: [] };
  const allowCenter = options?.allowCenter !== false;

  let edgeXs = xs;
  let edgeZs = zs;
  let centerXs: number[] = [];
  let centerZs: number[] = [];
  let corners = options?.corners ?? [];

  if (room && roomIsRectangular(room)) {
    const anchors = collectFurnitureRoomAnchors(room, floorIndex, {
      partitions,
      finish,
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
  const physical = physicalFurnitureAnchors(f, physicalWalls, options?.furniture ?? [], options?.excludeFurnitureIndex, previewGap);
  if (!room || !roomIsRectangular(room)) {
    // 无房间也不能退回墙中线、房间虚框或墙尖吸附。
    edgeXs = physical.xs;
    edgeZs = physical.zs;
    corners = [];
  } else {
    edgeXs = [...edgeXs, ...physical.xs];
    edgeZs = [...edgeZs, ...physical.zs];
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
      room != null && roomIsRectangular(room) && nearestRoomWall(f, room, floorIndex, partitions).gap <= maxGap + 60;
    if (room && roomIsRectangular(room) && furnitureUsesWallCenter(f.kind) && nearWall) {
      const wall = nearestRoomWall(f, room, floorIndex, partitions);
      if (Math.abs(wall.alongDelta) <= centerGap) {
        const before = { x: f.x, z: f.z };
        centerFurnitureAgainstNearestWall(f, room, floorIndex, finish, partitions);
        if (Math.abs(f.x - before.x) > 1e-6 || Math.abs(f.z - before.z) > 1e-6) {
          const clear = roomFurnitureClearRect(room, floorIndex, finish, partitions);
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
  if (room) pullFurnitureClearOfWalls(f, room, floorIndex, finish, partitions);

  resolveFurnitureCollisions(f, {
    walls: physicalWalls, furniture: options?.furniture ?? [], exclude: options?.excludeFurnitureIndex,
    clear: room && roomIsRectangular(room) ? roomFurnitureClearRect(room, floorIndex, finish, partitions) : undefined,
    previous: options?.previous,
  });
  // 碰撞避让可能取消一次贴边吸附，只保留最终位置实际命中的引导线。
  const final = furnitureWorldBounds(f);
  const matches = (v: number, lo: number, hi: number) => Math.min(Math.abs(v - lo), Math.abs(v - hi), Math.abs(v - (lo + hi) / 2)) <= 2;
  if (physicalWalls.length || options?.furniture?.length) {
    return { guideXs: uniqueSorted(guideXs.filter(v => matches(v, final.x0, final.x1)), 20),
      guideZs: uniqueSorted(guideZs.filter(v => matches(v, final.z0, final.z1)), 20) };
  }

  return { guideXs: uniqueSorted(guideXs, 20), guideZs: uniqueSorted(guideZs, 20) };
}
