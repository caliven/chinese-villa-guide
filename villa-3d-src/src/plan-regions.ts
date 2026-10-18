import { construction, isPhysicalWall, wallRoleOf, type Room, type Wall } from "./data";
import { areaM2 } from "./units";

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
 * 墙围合出的矩形房间候选（4 面封闭或 3 面 U 形最大矩形）。
 * 坐标为开间外轮廓（外墙外皮／内墙中线／虚拟线），与 Room.x/z/w/d 同口径；
 * 图面色块再经 roomFillBounds 缩到墙内皮＝套内。门窗洞口仍属墙段。
 */
export type EnclosedRoomRegion = {
  x: number;
  z: number;
  w: number;
  d: number;
  /** 外轮廓面积（m²），示意建筑面积分摊前的开间面积。 */
  buildingArea: number;
  rectangular: boolean;
  /** 至少一边贴着内墙／虚拟墙（非整栋空壳）。 */
  hasInternalWall: boolean;
  /** 三面墙 U 形最大矩形（开敞边无墙）。 */
  openSide?: boolean;
};

type Seg = { axis: "h" | "v"; at: number; lo: number; hi: number; half: number; index: number };

const MIN_ROOM_MM = 800;
const REGION_MATCH_TOL = 120;
const CONNECT_TOL = 80;

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
      const pad = tol + h.half + v.half;
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
  let covered = 0;
  for (const s of segs) {
    if (s.axis !== axis) continue;
    if (Math.abs(s.at - at) > tol + s.half) continue;
    const o0 = Math.max(lo, s.lo);
    const o1 = Math.min(hi, s.hi);
    if (o1 > o0) covered += o1 - o0;
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
  // 端点贴到墙面就视为接墙，延伸至该墙中线；不跨过真实空隙。门洞仍属墙段。
  const connected = lines.map(line => {
    const min = line.axis === "v" ? z0 : x0, max = line.axis === "v" ? z1 : x1;
    let lo = line.lo <= min + outer + 1 ? min : line.lo;
    let hi = line.hi >= max - outer - 1 ? max : line.hi;
    for (const other of lines) {
      if (other.axis === line.axis || line.at < other.lo - line.half - 1 || line.at > other.hi + line.half + 1) continue;
      if (Math.abs(line.lo - other.at) <= other.half + 1) lo = Math.min(lo, other.at);
      if (Math.abs(line.hi - other.at) <= other.half + 1) hi = Math.max(hi, other.at);
    }
    return { ...line, lo, hi };
  });
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
  for (let row = 0; row < nz; row++) {
    for (let col = 0; col < nx; col++) {
      if (owner[row * nx + col] !== regionId) continue;
      if (col > 0 && vertical[row * (nx + 1) + col] && owner[row * nx + col - 1] !== regionId) return true;
      if (col + 1 < nx && vertical[row * (nx + 1) + col + 1] && owner[row * nx + col + 1] !== regionId) return true;
      if (row > 0 && horizontal[row * nx + col] && owner[(row - 1) * nx + col] !== regionId) return true;
      if (row + 1 < nz && horizontal[(row + 1) * nx + col] && owner[(row + 1) * nx + col] !== regionId) return true;
    }
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

/**
 * 四面墙（含外墙与虚拟墙）围合出的矩形区域。
 * 短虚线未接墙、非矩形凹区不返回；整栋无内墙时不返回（避免空壳自动造房）。
 */
export function enclosedRoomRegions(body: Envelope, walls: Wall[]): EnclosedRoomRegion[] {
  if (!walls.length) return [];
  const flood = floodWallRegions(body, walls);
  if (!flood) return [];
  const segs = [...toSegs(walls), ...envelopeSegs(body)];
  const out: EnclosedRoomRegion[] = [];
  for (let id = 0; id < flood.regions.length; id++) {
    const r = flood.regions[id]!;
    const w = r.maxX - r.minX, d = r.maxZ - r.minZ;
    if (w < MIN_ROOM_MM || d < MIN_ROOM_MM) continue;
    const rectangular = r.area === w * d;
    if (!rectangular) continue;
    const hasInternalWall = regionHasInternalEdge(flood, id);
    if (!hasInternalWall) continue;
    // 中间隔墙未贯通时洪水仍是一块矩形，但不得当成一整间
    if (wallCrossesInterior({ x: r.minX, z: r.minZ, w, d }, segs)) continue;
    pushRegion(out, r.minX, r.minZ, w, d);
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
 * 开敞方向取两臂较长者定最大尺寸——隔墙与房子最外侧墙一并参与比较；
 * 外墙臂按其上最近交叉角截断。较短臂一侧允许部分贴合。
 * 矩形内部若被其它墙穿过则丢弃。
 */
export function threeWallRoomRegions(body: Envelope, walls: Wall[]): EnclosedRoomRegion[] {
  const partSegs = toSegs(walls);
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
  // 较短臂一侧覆盖 ≥0.5 即可；顶边有横墙时可凑成第三／四面
  const consider = (rect: { x: number; z: number; w: number; d: number }): boolean => {
    const x0 = Math.max(rect.x, body.x);
    const z0 = Math.max(rect.z, body.z);
    const x1 = Math.min(rect.x + rect.w, body.x + body.w);
    const z1 = Math.min(rect.z + rect.d, body.z + body.d);
    const w = x1 - x0, d = z1 - z0;
    if (w < MIN_ROOM_MM || d < MIN_ROOM_MM) return false;
    if (w * d > body.w * body.d * 0.85) return false;
    if (wallCrossesInterior({ x: x0, z: z0, w, d }, segs)) return false;
    const sides = countWalledSides({ x: x0, z: z0, w, d }, segs, 0.5);
    if (sides.n < 3 || !sides.hasPartition) return false;
    const key = `${Math.round(x0)}:${Math.round(z0)}:${Math.round(w)}:${Math.round(d)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    pushRegion(out, x0, z0, w, d, { openSide: true });
    return true;
  };

  /** 优先按最长臂（含外墙）成房；若不成立再退回较短臂。 */
  const considerExtents = (
    eA: number,
    eB: number,
    place: (extent: number) => { x: number; z: number; w: number; d: number },
  ) => {
    const eMax = Math.max(eA, eB);
    const eMin = Math.min(eA, eB);
    if (eMax >= MIN_ROOM_MM && consider(place(eMax))) return;
    if (eMin >= MIN_ROOM_MM && eMin < eMax - 1) consider(place(eMin));
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
  return x >= r.x - tol && x <= r.x + r.w + tol && z >= r.z - tol && z <= r.z + r.d + tol;
}

/** 4 面封闭区 + 3 面 U 形最大矩形；封闭区优先，U 形不与已有封闭区重复。 */
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
  out.sort((a, b) => a.w * a.d - b.w * b.d);
  return out;
}

/** 点落在哪个围合矩形内（优先面积较小者）。 */
export function findEnclosedRegionAt(
  x: number,
  z: number,
  body: Envelope,
  walls: Wall[],
): EnclosedRoomRegion | null {
  const hits = allRoomRegions(body, walls).filter((r) => regionContainsPoint(r, x, z));
  if (!hits.length) return null;
  hits.sort((a, b) => a.w * a.d - b.w * b.d);
  return hits[0]!;
}

/** 找应与该围合区同步的已有房间（中心落入，或重叠过半）。 */
export function findRoomForRegion(rooms: Room[], region: EnclosedRoomRegion): Room | null {
  const containing = rooms.filter((r) =>
    regionContainsPoint(region, r.x + r.w / 2, r.z + r.d / 2, REGION_MATCH_TOL),
  );
  if (containing.length) {
    containing.sort((a, b) => a.w * a.d - b.w * b.d);
    return containing[0]!;
  }
  let best: { room: Room; score: number } | null = null;
  for (const r of rooms) {
    const ox = Math.max(0, Math.min(r.x + r.w, region.x + region.w) - Math.max(r.x, region.x));
    const oz = Math.max(0, Math.min(r.z + r.d, region.z + region.d) - Math.max(r.z, region.z));
    const overlap = ox * oz;
    const score = overlap / Math.max(1, Math.min(r.w * r.d, region.w * region.d));
    if (score >= 0.45 && (!best || score > best.score)) best = { room: r, score };
  }
  return best?.room ?? null;
}

function roomMatchesRegion(room: Room, region: EnclosedRoomRegion, tol = REGION_MATCH_TOL): boolean {
  if (!regionContainsPoint(region, room.x + room.w / 2, room.z + room.d / 2, tol)) return false;
  const sameSize =
    Math.abs(room.w - region.w) <= tol * 2 && Math.abs(room.d - region.d) <= tol * 2;
  const sameOrigin =
    Math.abs(room.x - region.x) <= tol && Math.abs(room.z - region.z) <= tol;
  return sameSize || sameOrigin;
}

/** 房间是否已覆盖该围合区（中心落入且尺寸接近）。 */
export function roomMatchesEnclosedRegion(
  room: Room,
  region: EnclosedRoomRegion,
  tol = REGION_MATCH_TOL,
): boolean {
  return roomMatchesRegion(room, region, tol);
}

/** 围合区是否贴着指定墙段（用于「刚改的墙」只触发相邻成房）。 */
export function regionTouchesWall(
  region: EnclosedRoomRegion,
  wall: Wall,
  tol = REGION_MATCH_TOL,
): boolean {
  const ax = wall.a[0], az = wall.a[1], bx = wall.b[0], bz = wall.b[1];
  const vertical = Math.abs(ax - bx) <= Math.abs(az - bz) * 0.35;
  if (vertical) {
    const at = (ax + bx) / 2;
    const lo = Math.min(az, bz), hi = Math.max(az, bz);
    const onWest = Math.abs(at - region.x) <= tol;
    const onEast = Math.abs(at - (region.x + region.w)) <= tol;
    if (!onWest && !onEast) return false;
    return Math.min(hi, region.z + region.d) - Math.max(lo, region.z) > 50;
  }
  const at = (az + bz) / 2;
  const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
  const onNorth = Math.abs(at - region.z) <= tol;
  const onSouth = Math.abs(at - (region.z + region.d)) <= tol;
  if (!onNorth && !onSouth) return false;
  return Math.min(hi, region.x + region.w) - Math.max(lo, region.x) > 50;
}

/** 把房间外轮廓贴到围合区四边（色块经 roomFillBounds 落在墙内皮＝套内）。 */
export function applyRoomToEnclosedRegion(room: Room, region: EnclosedRoomRegion): Room {
  const snap = (v: number) => Math.round(v);
  room.x = snap(region.x);
  room.z = snap(region.z);
  room.w = snap(Math.max(MIN_ROOM_MM, region.w));
  room.d = snap(Math.max(MIN_ROOM_MM, region.d));
  room.label = [room.x + room.w / 2, room.z + room.d / 2];
  return room;
}

/**
 * 拖动某段墙时，与其垂直相接的墙端点跟着贴住，从而变长／变短。
 * movedOrig：拖前快照，用来识别「原本接在这堵墙上」的端点（门窗不影响连接）。
 * 直角 L 角：若端点原本贴在墙尖，沿向也跟着新墙尖走，避免只改轴线留下 45mm 缝。
 */
export function stretchOrthogonalWallsToMoved(
  movedIndex: number,
  walls: Wall[],
  movedOrig?: Wall,
  tol = CONNECT_TOL,
): void {
  const moved = walls[movedIndex];
  if (!moved) return;
  const ref = movedOrig ?? moved;
  const rax = Math.round(ref.a[0]), raz = Math.round(ref.a[1]);
  const rbx = Math.round(ref.b[0]), rbz = Math.round(ref.b[1]);
  const axis = rax === rbx ? "v" : raz === rbz ? "h" : null;
  if (!axis) return;
  const oldAt = axis === "v" ? rax : raz;
  const oldLo = Math.min(axis === "v" ? raz : rax, axis === "v" ? rbz : rbx);
  const oldHi = Math.max(axis === "v" ? raz : rax, axis === "v" ? rbz : rbx);
  const half = wallHalfMm(ref);

  const nax = Math.round(moved.a[0]), naz = Math.round(moved.a[1]);
  const nbx = Math.round(moved.b[0]), nbz = Math.round(moved.b[1]);
  const newAt = axis === "v" ? nax : naz;
  const newLo = Math.min(axis === "v" ? naz : nax, axis === "v" ? nbz : nbx);
  const newHi = Math.max(axis === "v" ? naz : nax, axis === "v" ? nbz : nbx);
  const tipTol = tol + half;

  for (let i = 0; i < walls.length; i++) {
    if (i === movedIndex) continue;
    const w = walls[i]!;
    const wax = Math.round(w.a[0]), waz = Math.round(w.a[1]);
    const wbx = Math.round(w.b[0]), wbz = Math.round(w.b[1]);
    const wAxis = wax === wbx ? "v" : waz === wbz ? "h" : null;
    if (!wAxis || wAxis === axis) continue;

    for (const end of ["a", "b"] as const) {
      const pt = end === "a" ? w.a : w.b;
      const along = axis === "h" ? pt[0] : pt[1];
      const cross = axis === "h" ? pt[1] : pt[0];
      // 端点原本贴在拖前墙线上（含曾误吸到外皮的半厚偏差）
      if (Math.abs(cross - oldAt) > tol + half + wallHalfMm(w)) continue;
      if (along < oldLo - tipTol || along > oldHi + tipTol) continue;
      // 轴线贴新中线；若原本在墙尖，沿向也跟到新墙尖
      let nextAlong = Math.round(along);
      if (Math.abs(along - oldLo) <= tipTol) nextAlong = newLo;
      else if (Math.abs(along - oldHi) <= tipTol) nextAlong = newHi;
      if (axis === "h") {
        if (end === "a") w.a = [nextAlong, newAt];
        else w.b = [nextAlong, newAt];
      } else {
        if (end === "a") w.a = [newAt, nextAlong];
        else w.b = [newAt, nextAlong];
      }
    }
  }
}
