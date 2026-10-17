import type { Furniture, Point, Room, Wall } from "./data";
import { site } from "./data";
import { furnitureLocalBounds, furnitureLocalToWorld } from "./furniture-catalog";
import { normalizeOpening, type WallOpening } from "./openings";
import { snapMeter } from "./layout-draft";

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

export function roomMargins(f: Furniture, room: Room): RoomMargins {
  const box = furnitureWorldBounds(f);
  return {
    left: box.x0 - room.x,
    right: room.x + room.w - box.x1,
    front: box.z0 - room.z,
    back: room.z + room.d - box.z1,
    centerDeltaX: f.x - (room.x + room.w / 2),
    centerDeltaZ: f.z - (room.z + room.d / 2),
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

/** 家具世界外包相对房间四边的最近墙。 */
export function nearestRoomWall(f: Furniture, room: Room): {
  side: RoomWallSide;
  gap: number;
  alongDelta: number;
} {
  const box = furnitureWorldBounds(f);
  const fw = box.x1 - box.x0;
  const fd = box.z1 - box.z0;
  const left = box.x0 - room.x;
  const right = room.x + room.w - box.x1;
  const north = box.z0 - room.z;
  const south = room.z + room.d - box.z1;
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
    alongDelta = box.z0 + fd / 2 - (room.z + room.d / 2);
  } else {
    alongDelta = box.x0 + fw / 2 - (room.x + room.w / 2);
  }
  return { side: best.side, gap: best.gap, alongDelta };
}

/**
 * 靠最近一面墙贴齐，并沿该墙在房间净宽／净进深内居中。
 * clear 为墙内皮留缝（米），示意用。
 */
export function centerFurnitureAgainstNearestWall(f: Furniture, room: Room, clear = 0.05) {
  const box = furnitureWorldBounds(f);
  const fw = box.x1 - box.x0;
  const fd = box.z1 - box.z0;
  const { side } = nearestRoomWall(f, room);
  let dx = 0;
  let dz = 0;
  if (side === "west") {
    dx = room.x + clear - box.x0;
    dz = room.z + (room.d - fd) / 2 - box.z0;
  } else if (side === "east") {
    dx = room.x + room.w - clear - box.x1;
    dz = room.z + (room.d - fd) / 2 - box.z0;
  } else if (side === "north") {
    dz = room.z + clear - box.z0;
    dx = room.x + (room.w - fw) / 2 - box.x0;
  } else {
    dz = room.z + room.d - clear - box.z1;
    dx = room.x + (room.w - fw) / 2 - box.x0;
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
