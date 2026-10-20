import { construction, isPhysicalWall, wallRoleOf, type Point, type Room, type Wall } from "./data";
import { areaM2 } from "./units";
import { constrainWallEdits } from "./wall-constraints";
import { polygonAreaMm2, polygonContainsPoint as containsPolygonPoint, roomLabelPoint, roomOutline } from "./room-geometry";
export { polygonAreaMm2 } from "./room-geometry";

type Envelope = { x: number; z: number; w: number; d: number };
type Boundary = { axis: "h" | "v"; at: number; lo: number; hi: number; half: number; virtual: boolean };

type FloodRegion = {
  cells: number[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  area: number;
};

type FloodResult = {
  xs: number[];
  zs: number[];
  nx: number;
  nz: number;
  vertical: Uint8Array;
  horizontal: Uint8Array;
  owner: Int32Array;
  regions: FloodRegion[];
};

/** 虚拟分区分注：中心与宽深均为 mm（图面「虚线分间 W×D」）；仅矩形分区。 */
export type VirtualRegionLabel = {
  x: number;
  z: number;
  wMm: number;
  dMm: number;
};

/**
 * 实际闭合正交多边形，或供手动放置参考的三面 U 形开敞候选。
 * 坐标为开间外轮廓（外墙外皮／内墙中线／虚拟线），与 Room.x/z/w/d 同口径；
 * 图面色块另扣墙内皮表示模型净空。门窗洞口仍属墙段。
 */
export type EnclosedRoomRegion = {
  x: number;
  z: number;
  w: number;
  d: number;
  /** 轮廓参考面积（㎡），不是法定建筑面积或套内建筑面积。 */
  buildingArea: number;
  rectangular: boolean;
  /** 至少一边贴着内墙／虚拟墙（非整栋空壳）。 */
  hasInternalWall: boolean;
  /** 正交轮廓；x/z/w/d 仅为外包络，不代表凹多边形实际面积。 */
  polygon?: Point[];
  /** 实际轮廓面积（㎡），不含墙内皮扣减。 */
  geometryArea?: number;
  /** 墙体身份和墙侧组成的边界关联，不随同一墙平移改变。 */
  boundaryKey?: string;
  /** 三面开敞分区，不将缺失的一边当作实体墙。 */
  openSide?: boolean;
};

type Seg = { axis: "h" | "v"; at: number; lo: number; hi: number; half: number; index: number };

const MIN_ROOM_MM = 800;
const REGION_MATCH_TOL = 120;
const CONNECT_TOL = 1;

/** 墙墙正交交叉角（平面 mm）。 */
export type WallCorner = { x: number; z: number; hIndex: number; vIndex: number };

function wallHalfMm(wall: Wall): number {
  if (!isPhysicalWall(wall)) return 0;
  return (wallRoleOf(wall) === "bearing" ? construction.outsideWall : construction.partition) / 2;
}

function toSegs(walls: Wall[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i]!;
    const ax = Math.round(wall.a[0]), az = Math.round(wall.a[1]);
    const bx = Math.round(wall.b[0]), bz = Math.round(wall.b[1]);
    if (![ax, az, bx, bz].every(Number.isFinite)) continue;
    const axis = ax === bx ? "v" : az === bz ? "h" : null;
    if (!axis) continue;
    const at = axis === "v" ? ax : az;
    const lo = Math.min(axis === "v" ? az : ax, axis === "v" ? bz : bx);
    const hi = Math.max(axis === "v" ? az : ax, axis === "v" ? bz : bx);
    if (hi - lo < 50) continue;
    out.push({ axis, at, lo, hi, half: wallHalfMm(wall), index: i });
  }
  return out;
}

/**
 * 房间边界统一使用外墙外皮／内墙中线：先验证原墙体实际接触，再把接点延至参考线。
 * 只补实际墙厚内的端点及同轴分段的 1 mm 舍入误差，不沿归一后的墙继续跨接空隙。
 * 保留墙段身份与角色；门窗洞口不打断墙边界。
 */
function normalizeWallContacts<T extends Pick<Seg, "axis" | "at" | "lo" | "hi" | "half">>(body: Envelope, lines: T[]): T[] {
  const x0 = Math.round(body.x), x1 = Math.round(body.x + body.w);
  const z0 = Math.round(body.z), z1 = Math.round(body.z + body.d);
  const outer = Math.round(construction.outsideWall);
  return lines.map(line => {
    const min = line.axis === "v" ? z0 : x0, max = line.axis === "v" ? z1 : x1;
    let lo = line.lo <= min + outer + CONNECT_TOL ? min : line.lo;
    let hi = line.hi >= max - outer - CONNECT_TOL ? max : line.hi;
    for (const other of lines) {
      if (other.axis === line.axis) {
        if (other.at !== line.at) continue;
        if (line.lo > other.hi && line.lo - other.hi <= CONNECT_TOL) lo = Math.min(lo, other.hi);
        if (line.hi < other.lo && other.lo - line.hi <= CONNECT_TOL) hi = Math.max(hi, other.lo);
        continue;
      }
      if (line.at < other.lo - line.half - CONNECT_TOL || line.at > other.hi + line.half + CONNECT_TOL) continue;
      if (Math.abs(line.lo - other.at) <= other.half + CONNECT_TOL) lo = Math.min(lo, other.at);
      if (Math.abs(line.hi - other.at) <= other.half + CONNECT_TOL) hi = Math.max(hi, other.at);
    }
    return { ...line, lo, hi };
  });
}

/** 建筑外轮廓四边（外皮），index 为负，与隔墙一并参与交叉角／三面成房。 */
function envelopeSegs(body: Envelope): Seg[] {
  const half = construction.outsideWall / 2;
  const x0 = Math.round(body.x), z0 = Math.round(body.z);
  const x1 = Math.round(body.x + body.w), z1 = Math.round(body.z + body.d);
  return [
    { axis: "h", at: z0, lo: x0, hi: x1, half, index: -1 }, // 北
    { axis: "h", at: z1, lo: x0, hi: x1, half, index: -2 }, // 南
    { axis: "v", at: x0, lo: z0, hi: z1, half, index: -3 }, // 西
    { axis: "v", at: x1, lo: z0, hi: z1, half, index: -4 }, // 东
  ];
}

function cornersFromSegs(segs: Seg[], tol = CONNECT_TOL): WallCorner[] {
  const hs = segs.filter((s) => s.axis === "h");
  const vs = segs.filter((s) => s.axis === "v");
  const out: WallCorner[] = [];
  const seen = new Set<string>();
  for (const h of hs) {
    for (const v of vs) {
      const pad = tol + Math.max(h.half, v.half);
      const x = v.at, z = h.at;
      if (x < h.lo - pad || x > h.hi + pad) continue;
      if (z < v.lo - pad || z > v.hi + pad) continue;
      const key = `${x}:${z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, z, hIndex: h.index, vIndex: v.index });
    }
  }
  return out;
}

/**
 * 识别正交墙交叉角：横墙与竖墙轴线相交，且交点落在两段投影内（含端点贴接／T 接，门洞不断开墙段）。
 * 传入 body 时，隔墙与外墙外皮的交点也算交叉角（靠外墙的三面房必需）。
 */
export function findWallCorners(walls: Wall[], tol = CONNECT_TOL, body?: Envelope): WallCorner[] {
  const segs = body ? [...toSegs(walls), ...envelopeSegs(body)] : toSegs(walls);
  return cornersFromSegs(segs, tol);
}

/** 三点若恰为轴对齐矩形的三角，补出第四角并返回外轮廓。 */
export function rectFromThreeCorners(
  a: { x: number; z: number },
  b: { x: number; z: number },
  c: { x: number; z: number },
): { x: number; z: number; w: number; d: number } | null {
  const xs = [...new Set([a.x, b.x, c.x].map((v) => Math.round(v)))].sort((p, q) => p - q);
  const zs = [...new Set([a.z, b.z, c.z].map((v) => Math.round(v)))].sort((p, q) => p - q);
  if (xs.length !== 2 || zs.length !== 2) return null;
  const keys = new Set([a, b, c].map((p) => `${Math.round(p.x)}:${Math.round(p.z)}`));
  if (keys.size !== 3) return null;
  // 三个角必须正好落在矩形四角上
  let hit = 0;
  for (const x of xs) for (const z of zs) if (keys.has(`${x}:${z}`)) hit += 1;
  if (hit !== 3) return null;
  return { x: xs[0]!, z: zs[0]!, w: xs[1]! - xs[0]!, d: zs[1]! - zs[0]! };
}

/** 矩形某一边被墙段覆盖的长度占比（0～1）。 */
function edgeWallCoverage(
  axis: "h" | "v",
  at: number,
  lo: number,
  hi: number,
  segs: Seg[],
  tol = CONNECT_TOL,
): number {
  const len = hi - lo;
  if (len < 50) return 0;
  const intervals: Array<[number, number]> = [];
  for (const s of segs) {
    if (s.axis !== axis || Math.abs(s.at - at) > tol + s.half) continue;
    const o0 = Math.max(lo, s.lo), o1 = Math.min(hi, s.hi);
    if (o1 > o0) intervals.push([o0, o1]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let covered = 0, end = lo;
  for (const [start, stop] of intervals) {
    covered += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return Math.min(1, covered / len);
}

/** 矩形四边中有几条边被墙充分覆盖（≥ cover）；并标记是否至少一边靠隔墙（非纯外墙空壳）。 */
function countWalledSides(
  rect: { x: number; z: number; w: number; d: number },
  segs: Seg[],
  cover = 0.85,
): { n: number; hasPartition: boolean } {
  const { x, z, w, d } = rect;
  const parts = segs.filter((s) => s.index >= 0);
  const edges: Array<{ axis: "h" | "v"; at: number; lo: number; hi: number }> = [
    { axis: "v", at: x, lo: z, hi: z + d },
    { axis: "v", at: x + w, lo: z, hi: z + d },
    { axis: "h", at: z, lo: x, hi: x + w },
    { axis: "h", at: z + d, lo: x, hi: x + w },
  ];
  let n = 0;
  let hasPartition = false;
  for (const e of edges) {
    if (edgeWallCoverage(e.axis, e.at, e.lo, e.hi, segs) < cover) continue;
    n += 1;
    if (edgeWallCoverage(e.axis, e.at, e.lo, e.hi, parts) >= cover * 0.5) hasPartition = true;
  }
  return { n, hasPartition };
}

function floodWallRegions(body: Envelope, walls: Wall[]): FloodResult | null {
  const mm = (v: number) => Math.round(v);
  const x0 = mm(body.x), x1 = mm(body.x + body.w);
  const z0 = mm(body.z), z1 = mm(body.z + body.d);
  if (x1 <= x0 || z1 <= z0) return null;
  const outer = mm(construction.outsideWall);
  const lines: Boundary[] = [];
  for (const wall of walls) {
    const [ax, az, bx, bz] = [...wall.a, ...wall.b].map(mm);
    if (![ax, az, bx, bz].every(Number.isFinite)) continue;
    const axis = ax === bx ? "v" : az === bz ? "h" : null;
    if (!axis) continue;
    const at = axis === "v" ? ax : az;
    const min = axis === "v" ? x0 : z0, max = axis === "v" ? x1 : z1;
    // 与外墙重合的内墙不是另一条区域边界。
    if (at <= min || at >= max || (isPhysicalWall(wall) && (at <= min + outer || at >= max - outer))) continue;
    const lo = Math.max(axis === "v" ? z0 : x0, Math.min(axis === "v" ? az : ax, axis === "v" ? bz : bx));
    const hi = Math.min(axis === "v" ? z1 : x1, Math.max(axis === "v" ? az : ax, axis === "v" ? bz : bx));
    if (hi <= lo) continue;
    lines.push({
      axis, at, lo, hi, virtual: !isPhysicalWall(wall),
      half: wallHalfMm(wall),
    });
  }
  const connected = normalizeWallContacts(body, lines);
  const xs = [...new Set([x0, x1, ...connected.flatMap(l => l.axis === "v" ? [l.at] : [l.lo, l.hi])])].sort((a, b) => a - b);
  const zs = [...new Set([z0, z1, ...connected.flatMap(l => l.axis === "h" ? [l.at] : [l.lo, l.hi])])].sort((a, b) => a - b);
  const nx = xs.length - 1, nz = zs.length - 1;
  if (nx < 1 || nz < 1) return null;
  const xIndex = new Map(xs.map((v, i) => [v, i]));
  const zIndex = new Map(zs.map((v, i) => [v, i]));
  // bit 1＝实体，bit 2＝虚拟。所有边只按有限线段覆盖。
  const vertical = new Uint8Array((nx + 1) * nz);
  const horizontal = new Uint8Array(nx * (nz + 1));
  for (const line of connected) {
    const flag = line.virtual ? 2 : 1;
    if (line.axis === "v") {
      const col = xIndex.get(line.at)!;
      for (let row = zIndex.get(line.lo)!; row < zIndex.get(line.hi)!; row++) vertical[row * (nx + 1) + col] |= flag;
    } else {
      const row = zIndex.get(line.at)!;
      for (let col = xIndex.get(line.lo)!; col < xIndex.get(line.hi)!; col++) horizontal[row * nx + col] |= flag;
    }
  }
  const owner = new Int32Array(nx * nz).fill(-1);
  const regions: FloodRegion[] = [];
  for (let start = 0; start < owner.length; start++) {
    if (owner[start] !== -1) continue;
    const id = regions.length;
    const region: FloodRegion = { cells: [start], minX: x1, maxX: x0, minZ: z1, maxZ: z0, area: 0 };
    owner[start] = id;
    const visit = (cell: number) => {
      if (owner[cell] !== -1) return;
      owner[cell] = id;
      region.cells.push(cell);
    };
    for (let head = 0; head < region.cells.length; head++) {
      const cell = region.cells[head]!, row = Math.floor(cell / nx), col = cell % nx;
      region.minX = Math.min(region.minX, xs[col]!);
      region.maxX = Math.max(region.maxX, xs[col + 1]!);
      region.minZ = Math.min(region.minZ, zs[row]!);
      region.maxZ = Math.max(region.maxZ, zs[row + 1]!);
      region.area += (xs[col + 1]! - xs[col]!) * (zs[row + 1]! - zs[row]!);
      if (col > 0 && !vertical[row * (nx + 1) + col]) visit(cell - 1);
      if (col + 1 < nx && !vertical[row * (nx + 1) + col + 1]) visit(cell + 1);
      if (row > 0 && !horizontal[row * nx + col]) visit(cell - nx);
      if (row + 1 < nz && !horizontal[(row + 1) * nx + col]) visit(cell + nx);
    }
    regions.push(region);
  }
  return { xs, zs, nx, nz, vertical, horizontal, owner, regions };
}

/**
 * 仅用实际线段围合分区，不把短线无限延伸。门洞仍属于房间边界。
 * 分区尺寸口径：外墙外皮、实体内墙中线、虚拟线本身；不冒充装修净尺寸。外圈墙距不含虚线。
 * 全部运算用毫米；虚拟墙与实体重合时以实体为准，不重复划区。
 * 端点落在外墙厚度带内时接到外皮（与实体墙同一吸附口径）。
 */
export function virtualWallRegions(body: Envelope, walls: Wall[]): VirtualRegionLabel[] {
  if (!walls.some(w => !isPhysicalWall(w))) return [];
  const flood = floodWallRegions(body, walls);
  if (!flood) return [];
  const { nx, nz, vertical, horizontal, owner, regions } = flood;
  const divided = new Set<number>();
  const mark = (edge: number, a: number, b: number) => {
    if (edge !== 2 || owner[a] === owner[b]) return;
    divided.add(owner[a]!);
    divided.add(owner[b]!);
  };
  for (let row = 0; row < nz; row++) for (let col = 1; col < nx; col++) {
    mark(vertical[row * (nx + 1) + col]!, row * nx + col - 1, row * nx + col);
  }
  for (let row = 1; row < nz; row++) for (let col = 0; col < nx; col++) {
    mark(horizontal[row * nx + col]!, (row - 1) * nx + col, row * nx + col);
  }
  // 未围合的短虚线两侧仍属同一分区，不额外制造区域尺寸。
  // 非矩形外包络 W×D 不能代表可用开间，不标「虚线外包络」。
  const out: VirtualRegionLabel[] = [];
  for (const id of divided) {
    const r = regions[id]!, w = r.maxX - r.minX, d = r.maxZ - r.minZ;
    if (r.area !== w * d) continue;
    out.push({
      x: (r.minX + r.maxX) / 2,
      z: r.minZ + Math.min(550, d / 2),
      wMm: w,
      dMm: d,
    });
  }
  return out;
}

/** 区域是否被内墙／虚拟墙与其它区分隔（非整栋空壳）。 */
function regionHasInternalEdge(flood: FloodResult, regionId: number): boolean {
  const { nx, nz, vertical, horizontal, owner } = flood;
  for (const cell of flood.regions[regionId]!.cells) {
    const row = Math.floor(cell / nx), col = cell % nx;
    if (col > 0 && vertical[row * (nx + 1) + col] && owner[cell - 1] !== regionId) return true;
    if (col + 1 < nx && vertical[row * (nx + 1) + col + 1] && owner[cell + 1] !== regionId) return true;
    if (row > 0 && horizontal[row * nx + col] && owner[cell - nx] !== regionId) return true;
    if (row + 1 < nz && horizontal[(row + 1) * nx + col] && owner[cell + nx] !== regionId) return true;
  }
  return false;
}

function pushRegion(
  out: EnclosedRoomRegion[],
  x: number,
  z: number,
  w: number,
  d: number,
  extra: Partial<EnclosedRoomRegion> = {},
) {
  if (w < MIN_ROOM_MM || d < MIN_ROOM_MM) return;
  out.push({
    x: Math.round(x),
    z: Math.round(z),
    w: Math.round(w),
    d: Math.round(d),
    buildingArea: areaM2(w, d),
    rectangular: true,
    hasInternalWall: true,
    ...extra,
  });
}

/** 基础命中与绘制／家具共用 room-geometry；此处只保留墙线的毫米容差包装。 */
export function polygonContainsPoint(polygon: readonly Point[], x: number, z: number, tol = 1): boolean {
  const inside = containsPolygonPoint(polygon, [x, z]);
  if (tol === 0) return inside;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    const near = (a[0] === b[0] && Math.abs(x - a[0]) <= Math.abs(tol) && z >= Math.min(a[1], b[1]) - Math.abs(tol) && z <= Math.max(a[1], b[1]) + Math.abs(tol)) ||
      (a[1] === b[1] && Math.abs(z - a[1]) <= Math.abs(tol) && x >= Math.min(a[0], b[0]) - Math.abs(tol) && x <= Math.max(a[0], b[0]) + Math.abs(tol));
    if (near) return tol > 0;
  }
  return inside;
}

/** 从网格分区提取真实边界，合并共线点；有孔区域不能用单一 outline 表达，暂不自动生成。 */
function regionPolygon(flood: FloodResult, id: number): Point[] | null {
  const { xs, zs, nx, nz, owner } = flood;
  type Edge = { a: Point; b: Point; dir: number; used?: boolean };
  const edges: Edge[] = [];
  const add = (a: Point, b: Point, dir: number) => edges.push({ a, b, dir });
  for (const cell of flood.regions[id]!.cells) {
    const row = Math.floor(cell / nx), col = cell % nx;
    const x0 = xs[col]!, x1 = xs[col + 1]!, z0 = zs[row]!, z1 = zs[row + 1]!;
    if (row === 0 || owner[cell - nx] !== id) add([x0, z0], [x1, z0], 0);
    if (col + 1 === nx || owner[cell + 1] !== id) add([x1, z0], [x1, z1], 1);
    if (row + 1 === nz || owner[cell + nx] !== id) add([x1, z1], [x0, z1], 2);
    if (col === 0 || owner[cell - 1] !== id) add([x0, z1], [x0, z0], 3);
  }
  const key = (p: Point) => `${p[0]}:${p[1]}`;
  const from = new Map<string, Edge[]>();
  for (const e of edges) from.set(key(e.a), [...(from.get(key(e.a)) ?? []), e]);
  const first = edges[0];
  if (!first) return null;
  const points: Point[] = [];
  let edge = first;
  while (!edge.used) {
    edge.used = true;
    points.push(edge.a);
    if (key(edge.b) === key(first.a)) break;
    const next = (from.get(key(edge.b)) ?? []).filter(e => !e.used).sort((a, b) => {
      const priority = (dir: number) => [1, 0, 3, 2].indexOf((dir - edge.dir + 4) % 4);
      return priority(a.dir) - priority(b.dir);
    })[0];
    if (!next) return null;
    edge = next;
  }
  if (key(edge.b) !== key(first.a) || edges.some(e => !e.used)) return null;
  const simple = points.filter((p, i) => {
    const prev = points[(i + points.length - 1) % points.length]!, next = points[(i + 1) % points.length]!;
    return !((prev[0] === p[0] && p[0] === next[0]) || (prev[1] === p[1] && p[1] === next[1]));
  });
  // 自接触的轮廓不能作为一个有效房间环。
  if (new Set(simple.map(key)).size !== simple.length || simple.length < 4) return null;
  if (Math.abs(polygonAreaMm2(simple) - flood.regions[id]!.area) > 1) return null;
  // 从最小坐标开始，保证无关墙拆段后输出和序列化仍稳定。
  const start = simple.reduce((best, p, i) => p[0] < simple[best]![0] || (p[0] === simple[best]![0] && p[1] < simple[best]![1]) ? i : best, 0);
  return [...simple.slice(start), ...simple.slice(0, start)];
}

function boundaryKeyFor(polygon: Point[], body: Envelope, walls: Wall[]): string {
  const keys = new Set<string>();
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    const vertical = a[0] === b[0], at = vertical ? a[0] : a[1];
    const lo = Math.min(vertical ? a[1] : a[0], vertical ? b[1] : b[0]);
    const hi = Math.max(vertical ? a[1] : a[0], vertical ? b[1] : b[0]);
    const side = vertical ? b[1] > a[1] ? "west" : "east" : b[0] > a[0] ? "south" : "north";
    const min = vertical ? body.x : body.z, max = min + (vertical ? body.w : body.d);
    if (at === Math.round(min) || at === Math.round(max)) {
      keys.add(`exterior:${vertical ? at === Math.round(min) ? "west" : "east" : at === Math.round(min) ? "north" : "south"}`);
      continue;
    }
    for (const wall of walls) {
      const wallVertical = wall.a[0] === wall.b[0], wallHorizontal = wall.a[1] === wall.b[1];
      if ((vertical && !wallVertical) || (!vertical && !wallHorizontal)) continue;
      if (Math.round(vertical ? wall.a[0] : wall.a[1]) !== at) continue;
      const wlo = Math.min(vertical ? wall.a[1] : wall.a[0], vertical ? wall.b[1] : wall.b[0]);
      const whi = Math.max(vertical ? wall.a[1] : wall.a[0], vertical ? wall.b[1] : wall.b[0]);
      if (Math.min(hi, whi) - Math.max(lo, wlo) <= 0) continue;
      // 没有持久 id 的旧稿用几何键，不使用易因删除而错位的数组索引。
      const identity = wall.id ?? `${vertical ? "v" : "h"}:${at}:${Math.round(wlo)}:${Math.round(whi)}`;
      keys.add(`${identity}:${side}`);
    }
  }
  return [...keys].sort().join("|");
}

/**
 * 按真实闭合边界生成正交多边形。短墙不无限延伸，门洞不打断墙的房间边界。
 * 三面 U 形仅为手动开敞分区候选，不属于此处的闭合房间。
 * 外墙外皮／内墙中线是模型分区参考，geometryArea 不是法定建筑面积。
 */
export function enclosedRoomRegions(body: Envelope, walls: Wall[]): EnclosedRoomRegion[] {
  if (!walls.length) return [];
  const flood = floodWallRegions(body, walls);
  if (!flood) return [];
  const out: EnclosedRoomRegion[] = [];
  for (let id = 0; id < flood.regions.length; id++) {
    const r = flood.regions[id]!, w = r.maxX - r.minX, d = r.maxZ - r.minZ;
    if (w < MIN_ROOM_MM || d < MIN_ROOM_MM || !regionHasInternalEdge(flood, id)) continue;
    const polygon = regionPolygon(flood, id);
    if (!polygon) continue;
    pushRegion(out, r.minX, r.minZ, w, d, {
      rectangular: r.area === w * d,
      polygon,
      geometryArea: r.area / 1_000_000,
      buildingArea: r.area / 1_000_000,
      boundaryKey: boundaryKeyFor(polygon, body, walls),
    });
  }
  return out;
}

/**
 * 正交臂从基墙沿 dir 伸出的长度；未贴到基墙或反向无伸出则 0。
 * dir=-1：朝坐标减小侧；dir=+1：朝增大侧。
 * 外墙臂同样计长，但收到该外墙上沿伸出方向最近的交叉角为止（无中间交叉则到外墙端／转角）。
 */
function armExtentFromBase(
  ortho: Seg,
  baseAt: number,
  dir: -1 | 1,
  junctions: WallCorner[] = [],
  tol = CONNECT_TOL,
): number {
  const pad = tol + ortho.half;
  const touches =
    Math.abs(ortho.lo - baseAt) <= pad ||
    Math.abs(ortho.hi - baseAt) <= pad ||
    (ortho.lo <= baseAt + pad && ortho.hi >= baseAt - pad);
  if (!touches) return 0;
  let extent = 0;
  if (dir < 0) {
    if (ortho.lo >= baseAt - pad) return 0;
    extent = baseAt - ortho.lo;
  } else {
    if (ortho.hi <= baseAt + pad) return 0;
    extent = ortho.hi - baseAt;
  }
  if (ortho.index >= 0) return extent;

  for (const j of junctions) {
    if (ortho.axis === "h") {
      if (Math.abs(j.z - ortho.at) > pad) continue;
      if (j.x < ortho.lo - pad || j.x > ortho.hi + pad) continue;
      const dist = dir < 0 ? baseAt - j.x : j.x - baseAt;
      if (dist > pad && dist < extent) extent = dist;
    } else {
      if (Math.abs(j.x - ortho.at) > pad) continue;
      if (j.z < ortho.lo - pad || j.z > ortho.hi + pad) continue;
      const dist = dir < 0 ? baseAt - j.z : j.z - baseAt;
      if (dist > pad && dist < extent) extent = dist;
    }
  }
  return extent;
}

/**
 * 矩形内部是否被墙「隔断」而不能当成一整间：
 * 1) 横／竖墙几乎横贯对边；
 * 2) 宽房间里，从南／北伸入的竖向隔墙（左右两侧都够一间）——即使未接到对边也拆开；
 * 3) 高房间里，从东／西伸入的横向隔墙（上下两侧都够一间）。
 * 短臂顶端、平行于长边的 stub（如左短右长时的顶横墙）不挡最长臂外接矩形。
 */
function wallCrossesInterior(
  rect: { x: number; z: number; w: number; d: number },
  segs: Seg[],
  tol = CONNECT_TOL,
): boolean {
  const x0 = rect.x + tol, x1 = rect.x + rect.w - tol;
  const z0 = rect.z + tol, z1 = rect.z + rect.d - tol;
  if (x1 <= x0 || z1 <= z0) return false;
  const rw = x1 - x0, rd = z1 - z0;
  const wider = rw >= rd;
  for (const s of segs) {
    if (s.axis === "h") {
      if (s.at <= z0 || s.at >= z1) continue;
      const o0 = Math.max(s.lo, x0), o1 = Math.min(s.hi, x1);
      const overlap = o1 - o0;
      if (overlap <= tol) continue;
      if (overlap >= rw * 0.85 || (s.lo <= x0 + tol && s.hi >= x1 - tol)) return true;
      // 高房间：横墙从左右伸入且上下都够一间 → 上下拆开
      if (!wider) {
        const above = s.at - z0, below = z1 - s.at;
        if (above >= MIN_ROOM_MM && below >= MIN_ROOM_MM && overlap >= MIN_ROOM_MM) {
          const fromWest = s.lo <= x0 + tol;
          const fromEast = s.hi >= x1 - tol;
          if (fromWest || fromEast) return true;
        }
      }
    } else {
      if (s.at <= x0 || s.at >= x1) continue;
      const o0 = Math.max(s.lo, z0), o1 = Math.min(s.hi, z1);
      const overlap = o1 - o0;
      if (overlap <= tol) continue;
      if (overlap >= rd * 0.85 || (s.lo <= z0 + tol && s.hi >= z1 - tol)) return true;
      // 宽房间：竖墙从南北伸入且左右都够一间 → 左右拆开（南侧中间隔墙未贯通也算）
      if (wider) {
        const left = s.at - x0, right = x1 - s.at;
        if (left >= MIN_ROOM_MM && right >= MIN_ROOM_MM && overlap >= MIN_ROOM_MM) {
          const fromNorth = s.lo <= z0 + tol;
          const fromSouth = s.hi >= z1 - tol;
          if (fromNorth || fromSouth) return true;
        }
      }
    }
  }
  return false;
}

/**
 * 三面墙成房：只沿同一面墙上的相邻交叉角成对组成房间（点互斥，不跳过中间交叉）。
 * 开敞方向仅取两臂共同覆盖的较短长度，不把不存在的墙臂推定为闭合。
 * 外墙臂按其上最近交叉角截断；空区可自动生成开敞分区，不覆盖已有房间。
 * 矩形内部若被其它墙穿过则丢弃。
 */
export function threeWallRoomRegions(body: Envelope, walls: Wall[]): EnclosedRoomRegion[] {
  // 合并共线邻段，避免同一面墙拆成两段后失去 U 形基边。
  const partSegs: Seg[] = [];
  for (const seg of normalizeWallContacts(body, toSegs(walls)).sort((a, b) => a.axis.localeCompare(b.axis) || a.at - b.at || a.lo - b.lo)) {
    const previous = partSegs[partSegs.length - 1];
    if (previous && previous.axis === seg.axis && previous.at === seg.at && seg.lo <= previous.hi + CONNECT_TOL) {
      previous.hi = Math.max(previous.hi, seg.hi);
      previous.half = Math.max(previous.half, seg.half);
    } else partSegs.push({ ...seg });
  }
  if (!partSegs.length) return [];
  const segs = [...partSegs, ...envelopeSegs(body)];
  const junctions = cornersFromSegs(segs);
  if (!junctions.some((c) => c.hIndex >= 0 || c.vIndex >= 0)) return [];

  const segByIndex = new Map(segs.map((s) => [s.index, s]));
  const byWall = new Map<number, WallCorner[]>();
  for (const c of junctions) {
    for (const idx of [c.hIndex, c.vIndex]) {
      let list = byWall.get(idx);
      if (!list) {
        list = [];
        byWall.set(idx, list);
      }
      list.push(c);
    }
  }

  const out: EnclosedRoomRegion[] = [];
  const seen = new Set<string>();
  // 开敞候选至少三面确有连续完整边界，不把半截墙当完整房边。
  const consider = (rect: { x: number; z: number; w: number; d: number }): boolean => {
    const x0 = Math.max(rect.x, body.x);
    const z0 = Math.max(rect.z, body.z);
    const x1 = Math.min(rect.x + rect.w, body.x + body.w);
    const z1 = Math.min(rect.z + rect.d, body.z + body.d);
    const w = x1 - x0, d = z1 - z0;
    if (w < MIN_ROOM_MM || d < MIN_ROOM_MM) return false;
    if (w * d > body.w * body.d * 0.85) return false;
    if (wallCrossesInterior({ x: x0, z: z0, w, d }, segs)) return false;
    const sides = countWalledSides({ x: x0, z: z0, w, d }, segs, 0.999999);
    if (sides.n < 3 || !sides.hasPartition) return false;
    const key = `${Math.round(x0)}:${Math.round(z0)}:${Math.round(w)}:${Math.round(d)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const polygon: Point[] = [[x0, z0], [x0 + w, z0], [x0 + w, z0 + d], [x0, z0 + d]];
    pushRegion(out, x0, z0, w, d, {
      openSide: true, polygon, geometryArea: areaM2(w, d),
      boundaryKey: `open-walls:${boundaryKeyFor(polygon, body, walls)}`,
    });
    return true;
  };

  /** 只用两臂共同覆盖的深度；长臂超出段不构造虚假的完整边界。 */
  const considerExtents = (
    eA: number,
    eB: number,
    place: (extent: number) => { x: number; z: number; w: number; d: number },
  ) => {
    const extent = Math.min(eA, eB);
    if (extent >= MIN_ROOM_MM) consider(place(extent));
  };

  for (const [wallIdx, corners] of byWall) {
    const base = segByIndex.get(wallIdx);
    if (!base) continue;
    // 同一位置只留一个角，再沿基墙排序——只与相邻角配对（互斥，不跨中间点）
    const uniq = new Map<string, WallCorner>();
    for (const c of corners) {
      const k = `${Math.round(c.x)}:${Math.round(c.z)}`;
      if (!uniq.has(k)) uniq.set(k, c);
    }
    const sorted = [...uniq.values()].sort((a, b) =>
      base.axis === "v" ? a.z - b.z || a.x - b.x : a.x - b.x || a.z - b.z,
    );
    if (sorted.length < 2) continue;

    for (let i = 0; i < sorted.length - 1; i++) {
      const ca = sorted[i]!, cb = sorted[i + 1]!;
      const orthoA = segByIndex.get(base.axis === "v" ? ca.hIndex : ca.vIndex);
      const orthoB = segByIndex.get(base.axis === "v" ? cb.hIndex : cb.vIndex);
      if (!orthoA || !orthoB) continue;
      // 两臂须与基墙垂直
      if (orthoA.axis === base.axis || orthoB.axis === base.axis) continue;

      if (base.axis === "v") {
        const z0 = Math.min(ca.z, cb.z), z1 = Math.max(ca.z, cb.z);
        const span = z1 - z0;
        if (span < MIN_ROOM_MM) continue;
        for (const dir of [-1, 1] as const) {
          const eA = armExtentFromBase(orthoA, base.at, dir, junctions);
          const eB = armExtentFromBase(orthoB, base.at, dir, junctions);
          considerExtents(eA, eB, (extent) => ({
            x: dir < 0 ? base.at - extent : base.at,
            z: z0,
            w: extent,
            d: span,
          }));
        }
      } else {
        const x0 = Math.min(ca.x, cb.x), x1 = Math.max(ca.x, cb.x);
        const span = x1 - x0;
        if (span < MIN_ROOM_MM) continue;
        for (const dir of [-1, 1] as const) {
          const eA = armExtentFromBase(orthoA, base.at, dir, junctions);
          const eB = armExtentFromBase(orthoB, base.at, dir, junctions);
          considerExtents(eA, eB, (extent) => ({
            x: x0,
            z: dir < 0 ? base.at - extent : base.at,
            w: span,
            d: extent,
          }));
        }
      }
    }
  }
  return out;
}

function regionsRoughlySame(a: EnclosedRoomRegion, b: EnclosedRoomRegion, tol = REGION_MATCH_TOL): boolean {
  return (
    Math.abs(a.x - b.x) <= tol &&
    Math.abs(a.z - b.z) <= tol &&
    Math.abs(a.w - b.w) <= tol * 2 &&
    Math.abs(a.d - b.d) <= tol * 2
  );
}

function regionContainsPoint(r: EnclosedRoomRegion, x: number, z: number, tol = 1): boolean {
  if (r.polygon) return polygonContainsPoint(r.polygon, x, z, tol);
  return x >= r.x - tol && x <= r.x + r.w + tol && z >= r.z - tol && z <= r.z + r.d + tol;
}

/** 真实闭合区优先，三面 U 形另列为开敞分区。 */
export function allRoomRegions(body: Envelope, walls: Wall[]): EnclosedRoomRegion[] {
  const closed = enclosedRoomRegions(body, walls);
  const open = threeWallRoomRegions(body, walls);
  const out = [...closed];
  for (const r of open) {
    if (closed.some((c) => regionsRoughlySame(c, r) || (
      regionContainsPoint(c, r.x + r.w / 2, r.z + r.d / 2) && c.w * c.d <= r.w * r.d * 1.05
    ))) continue;
    out.push(r);
  }
  // 小面积优先，便于点选／匹配时取最贴合的一间
  out.sort((a, b) => Number(!!a.openSide) - Number(!!b.openSide) || (a.geometryArea ?? a.buildingArea) - (b.geometryArea ?? b.buildingArea));
  return out;
}

/** 点选优先真实闭合轮廓，其次才是用户可采纳的开敞候选。 */
export function findEnclosedRegionAt(
  x: number,
  z: number,
  body: Envelope,
  walls: Wall[],
): EnclosedRoomRegion | null {
  const hits = allRoomRegions(body, walls).filter((r) => regionContainsPoint(r, x, z));
  if (!hits.length) return null;
  hits.sort((a, b) => Number(!!a.openSide) - Number(!!b.openSide) || (a.geometryArea ?? a.buildingArea) - (b.geometryArea ?? b.buildingArea));
  return hits[0]!;
}

export const roomPolygon = roomOutline;

/** 正交多边形精确交集面积，按两轮廓的坐标网格积分，不把凹口计为重叠。 */
export function polygonIntersectionAreaMm2(a: readonly Point[], b: readonly Point[]): number {
  const xs = [...new Set([...a, ...b].map(p => p[0]))].sort((x, y) => x - y);
  const zs = [...new Set([...a, ...b].map(p => p[1]))].sort((x, y) => x - y);
  let area = 0;
  for (let xi = 0; xi + 1 < xs.length; xi++) for (let zi = 0; zi + 1 < zs.length; zi++) {
    const x = (xs[xi]! + xs[xi + 1]!) / 2, z = (zs[zi]! + zs[zi + 1]!) / 2;
    if (polygonContainsPoint(a, x, z, 0) && polygonContainsPoint(b, x, z, 0)) area += (xs[xi + 1]! - xs[xi]!) * (zs[zi + 1]! - zs[zi]!);
  }
  return area;
}

export function roomRegionOverlap(room: Room, region: EnclosedRoomRegion): { room: number; region: number; iou: number } {
  const a = roomPolygon(room), b = region.polygon ?? [[region.x, region.z], [region.x + region.w, region.z], [region.x + region.w, region.z + region.d], [region.x, region.z + region.d]] as Point[];
  const aa = polygonAreaMm2(a), ba = polygonAreaMm2(b), overlap = polygonIntersectionAreaMm2(a, b);
  return { room: overlap / Math.max(1, aa), region: overlap / Math.max(1, ba), iou: overlap / Math.max(1, aa + ba - overlap) };
}

/**
 * 仅精确边界身份或双向几何高度重合才匹配，不能让小卫浴的中心抢占整个大房。
 * 一对一排他分配由调用方先从候选房间中移除已经匹配的房间。
 */
export function findRoomForRegion(rooms: Room[], region: EnclosedRoomRegion): Room | null {
  const candidates = rooms.filter(r => r.kind !== "void" && r.kind !== "stair");
  if (region.boundaryKey) {
    const linked = candidates.filter(r => r.boundary?.key === region.boundaryKey);
    if (linked.length === 1) return linked[0]!;
    if (linked.length > 1) return null;
  }
  const matches = candidates.map(room => ({ room, overlap: roomRegionOverlap(room, region) }))
    .filter(r => r.overlap.room >= 0.8 && r.overlap.region >= 0.8)
    .sort((a, b) => b.overlap.iou - a.overlap.iou);
  // 同几何的重叠手工房不擅自选择身份，留给用户消除重复。
  if (matches.length > 1 && Math.abs(matches[0]!.overlap.iou - matches[1]!.overlap.iou) < 0.01) return null;
  return matches[0]?.room ?? null;
}

/** 同一实际区域：边界身份一致或各边近似一致且多边形双向覆盖。 */
export function roomMatchesEnclosedRegion(room: Room, region: EnclosedRoomRegion, tol = REGION_MATCH_TOL): boolean {
  if (region.boundaryKey && room.boundary?.key === region.boundaryKey) return true;
  if (Math.abs(room.x - region.x) > tol || Math.abs(room.z - region.z) > tol || Math.abs(room.w - region.w) > tol * 2 || Math.abs(room.d - region.d) > tol * 2) return false;
  const overlap = roomRegionOverlap(room, region);
  return overlap.room >= 0.8 && overlap.region >= 0.8;
}

/** 围合区是否贴着指定墙段（用于「刚改的墙」只触发相邻成房）。 */
export function regionTouchesWall(
  region: EnclosedRoomRegion,
  wall: Wall,
  tol = REGION_MATCH_TOL,
): boolean {
  const ax = wall.a[0], az = wall.a[1], bx = wall.b[0], bz = wall.b[1];
  if (ax !== bx && az !== bz) return false;
  const vertical = ax === bx, at = vertical ? ax : az;
  const lo = Math.min(vertical ? az : ax, vertical ? bz : bx), hi = Math.max(vertical ? az : ax, vertical ? bz : bx);
  const polygon = region.polygon ?? [[region.x, region.z], [region.x + region.w, region.z], [region.x + region.w, region.z + region.d], [region.x, region.z + region.d]] as Point[];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    if (vertical !== (a[0] === b[0]) || Math.abs(at - (vertical ? a[0] : a[1])) > tol) continue;
    if (Math.min(hi, Math.max(vertical ? a[1] : a[0], vertical ? b[1] : b[0])) - Math.max(lo, Math.min(vertical ? a[1] : a[0], vertical ? b[1] : b[0])) > 1) return true;
  }
  return false;
}

/** 将分区参考轮廓写入房间；净面积由墙内皮计算模块另行求得。 */
export function applyRoomToEnclosedRegion(room: Room, region: EnclosedRoomRegion): Room {
  room.x = Math.round(region.x);
  room.z = Math.round(region.z);
  room.w = Math.round(region.w);
  room.d = Math.round(region.d);
  room.outline = region.rectangular ? undefined : region.polygon?.map(p => [...p] as Point);
  room.boundary = { key: region.boundaryKey ?? `open:${room.x}:${room.z}:${room.w}:${room.d}`, status: region.openSide ? "open" : "enclosed" };
  room.label = roomLabelPoint(room, [room.x + room.w / 2, room.z + room.d / 2]);
  return room;
}

/**
 * 旧调用兼容层。完整拖前快照可保持连续拖动拓扑；编辑器统一使用 constrainWallEdits。
 * movedOrig-only 仅能提供单墙快照，新调用应传 originals。
 */
export function stretchOrthogonalWallsToMoved(
  movedIndex: number,
  walls: Wall[],
  movedOrig?: Wall,
  _tol = CONNECT_TOL,
  originals?: Wall[],
): void {
  const moved = walls[movedIndex];
  if (!moved) return;
  const snapshot = originals ?? structuredClone(walls);
  if (!originals && movedOrig) snapshot[movedIndex] = structuredClone(movedOrig);
  constrainWallEdits(walls, snapshot, [movedIndex]);
}
