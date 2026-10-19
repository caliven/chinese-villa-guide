import { isPhysicalWall, wallRoleOf, type Point, type Room, type Wall } from "./data";

export interface RoomRect { x: number; z: number; w: number; d: number }

/** 房间轮廓沿外墙外皮／内墙中线；x/z/w/d 只作包络。 */
export function roomOutline(room: Room): Point[] {
  return room.outline && room.outline.length >= 4
    ? room.outline.map(([x, z]) => [x, z])
    : [[room.x, room.z], [room.x + room.w, room.z], [room.x + room.w, room.z + room.d], [room.x, room.z + room.d]];
}

export function polygonAreaMm2(points: readonly Point[]): number {
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
}

/** 包括边界；用于真实轮廓命中，凹形的缺角永远不算房内。 */
export function polygonContainsPoint(points: readonly Point[], [x, z]: Point): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    const cross = (x - a[0]) * (b[1] - a[1]) - (z - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) < 1e-7 && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0]) && z >= Math.min(a[1], b[1]) && z <= Math.max(a[1], b[1])) return true;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export const roomContainsPoint = (room: Room, point: Point) => polygonContainsPoint(roomOutline(room), point);

export function roomIsRectangular(room: Room): boolean {
  return !room.outline?.length || Math.abs(polygonAreaMm2(room.outline) - room.w * room.d) < 1e-6;
}

export function outlinePath(points: readonly Point[]): string {
  return points.length ? `${points.map(([x, z], i) => `${i ? "L" : "M"}${x} ${z}`).join(" ")} Z` : "";
}

function boundsOf(points: readonly Point[]): RoomRect {
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const x = Math.min(...xs), z = Math.min(...zs);
  return { x, z, w: Math.max(...xs) - x, d: Math.max(...zs) - z };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = dx * dx + dz * dz;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

function bestLabel(paths: readonly Point[][], candidates: readonly Point[], preferred?: Point): Point {
  const within = (p: Point) => paths.reduce((inside, loop) => polygonContainsPoint(loop, p) ? !inside : inside, false);
  if (preferred && within(preferred)) return [...preferred];
  let best: Point = candidates[0] ?? paths[0]?.[0] ?? [0, 0], clearance = -1;
  for (const p of candidates) {
    if (!within(p)) continue;
    let nearest = Infinity;
    for (const loop of paths) for (let i = 0; i < loop.length; i++) nearest = Math.min(nearest, distanceToSegment(p, loop[i], loop[(i + 1) % loop.length]));
    if (nearest > clearance) { clearance = nearest; best = p; }
  }
  return [...best];
}

/** 标签以内部点为锚，不使用可能落在 L 形缺角的包络中心。 */
export function roomLabelPoint(room: Room, preferred = room.label): Point {
  const outline = roomOutline(room), box = boundsOf(outline);
  const xs = [...new Set(outline.map(p => p[0]))].sort((a, b) => a - b);
  const zs = [...new Set(outline.map(p => p[1]))].sort((a, b) => a - b);
  const candidates: Point[] = [[box.x + box.w / 2, box.z + box.d / 2]];
  for (let x = 0; x + 1 < xs.length; x++) for (let z = 0; z + 1 < zs.length; z++) candidates.push([(xs[x] + xs[x + 1]) / 2, (zs[z] + zs[z + 1]) / 2]);
  return bestLabel([outline], candidates, preferred);
}

export interface RoomNetGeometry {
  paths: Point[][];
  pathData: string;
  bounds: RoomRect;
  areaMm2: number;
  label: Point;
}

export interface PhysicalWallStroke { a: Point; b: Point; thick: number }

/** 实体墙角补齐；只在两道真实墙面已接触时连接，不使用磁吸距离。 */
export function physicalWallJoinExtensions(wall: Pick<Wall, "a" | "b">, peers: readonly PhysicalWallStroke[], options: { epsilon?: number; collinearDot?: number } = {}) {
  const epsilon = options.epsilon ?? 1, collinearDot = options.collinearDot ?? 0.2;
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  if (length < 1e-9) return { start: 0, end: 0 };
  const ux = (wall.b[0] - wall.a[0]) / length, uz = (wall.b[1] - wall.a[1]) / length;
  const same = (p: Pick<Wall, "a" | "b">) => p.a[0] === wall.a[0] && p.a[1] === wall.a[1] && p.b[0] === wall.b[0] && p.b[1] === wall.b[1];
  const ownHalf = (peers.find(same)?.thick ?? 0) / 2;
  const extendAt = (point: Point, outX: number, outZ: number) => {
    let reach = 0;
    for (const peer of peers) {
      if (same(peer)) continue;
      const plen = Math.hypot(peer.b[0] - peer.a[0], peer.b[1] - peer.a[1]);
      if (plen < 1e-9) continue;
      const px = (peer.b[0] - peer.a[0]) / plen, pz = (peer.b[1] - peer.a[1]) / plen;
      if (Math.abs(ux * px + uz * pz) > collinearDot) continue;
      const dx = point[0] - peer.a[0], dz = point[1] - peer.a[1];
      const along = dx * px + dz * pz, across = Math.abs(dx * -pz + dz * px);
      if (along < -ownHalf - epsilon || along > plen + ownHalf + epsilon || across > peer.thick / 2 + epsilon) continue;
      const cx = peer.a[0] + px * Math.max(0, Math.min(plen, along)), cz = peer.a[1] + pz * Math.max(0, Math.min(plen, along));
      const half = peer.thick / 2;
      reach = Math.max(reach,
        (cx - pz * half - point[0]) * outX + (cz + px * half - point[1]) * outZ,
        (cx + pz * half - point[0]) * outX + (cz - px * half - point[1]) * outZ);
    }
    return Math.max(0, reach);
  };
  return { start: extendAt(wall.a, -ux, -uz), end: extendAt(wall.b, ux, uz) };
}

/**
 * 正交分区的墙内皮几何。坐标网格对墙带做并集后扣除，交叉墙厚只扣一次。
 * 外墙边界在外皮，扣整厚；内墙边界在中线，扣落入房内的一半。
 * 门窗洞口仍属于房间边界，不把门槛面积补入任何一侧房间。
 */
export function roomNetGeometry(room: Room, body: RoomRect, walls: readonly Wall[], outsideThickness: number, partitionThickness: number): RoomNetGeometry {
  const outline = roomOutline(room), box = boundsOf(outline);
  const blocked: RoomRect[] = [
    { x: body.x, z: body.z, w: outsideThickness, d: body.d },
    { x: body.x + body.w - outsideThickness, z: body.z, w: outsideThickness, d: body.d },
    { x: body.x, z: body.z, w: body.w, d: outsideThickness },
    { x: body.x, z: body.z + body.d - outsideThickness, w: body.w, d: outsideThickness },
  ];
  const peers = walls.filter(isPhysicalWall).map(wall => ({ ...wall, thick: wallRoleOf(wall) === "bearing" ? outsideThickness : partitionThickness }));
  for (const wall of peers) {
    const thickness = wall.thick;
    const horizontal = Math.abs(wall.a[1] - wall.b[1]) < 1e-6;
    const vertical = Math.abs(wall.a[0] - wall.b[0]) < 1e-6;
    const join = physicalWallJoinExtensions(wall, peers);
    const low = (horizontal ? wall.a[0] < wall.b[0] : wall.a[1] < wall.b[1]) ? join.start : join.end;
    const high = (horizontal ? wall.a[0] < wall.b[0] : wall.a[1] < wall.b[1]) ? join.end : join.start;
    if (horizontal) blocked.push({ x: Math.min(wall.a[0], wall.b[0]) - low, z: wall.a[1] - thickness / 2, w: Math.abs(wall.b[0] - wall.a[0]) + low + high, d: thickness });
    else if (vertical) blocked.push({ x: wall.a[0] - thickness / 2, z: Math.min(wall.a[1], wall.b[1]) - low, w: thickness, d: Math.abs(wall.b[1] - wall.a[1]) + low + high });
  }
  const cuts = blocked.filter(r => r.w > 0 && r.d > 0 && r.x < box.x + box.w && r.x + r.w > box.x && r.z < box.z + box.d && r.z + r.d > box.z);
  const boundedX = (x: number) => Math.max(box.x, Math.min(box.x + box.w, x));
  const boundedZ = (z: number) => Math.max(box.z, Math.min(box.z + box.d, z));
  const xs = [...new Set([...outline.map(p => p[0]), ...cuts.flatMap(r => [boundedX(r.x), boundedX(r.x + r.w)])])].sort((a, b) => a - b);
  const zs = [...new Set([...outline.map(p => p[1]), ...cuts.flatMap(r => [boundedZ(r.z), boundedZ(r.z + r.d)])])].sort((a, b) => a - b);
  const edges = new Map<string, { a: Point; b: Point }>();
  const key = ([x, z]: Point) => `${x},${z}`;
  const addEdge = (a: Point, b: Point) => {
    const reverse = `${key(b)}:${key(a)}`;
    if (edges.has(reverse)) edges.delete(reverse);
    else edges.set(`${key(a)}:${key(b)}`, { a, b });
  };
  let areaMm2 = 0;
  const candidates: Point[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix++) for (let iz = 0; iz + 1 < zs.length; iz++) {
    const x = xs[ix], z = zs[iz], w = xs[ix + 1] - x, d = zs[iz + 1] - z;
    const p: Point = [x + w / 2, z + d / 2];
    if (!polygonContainsPoint(outline, p) || cuts.some(r => p[0] > r.x && p[0] < r.x + r.w && p[1] > r.z && p[1] < r.z + r.d)) continue;
    areaMm2 += w * d;
    candidates.push(p);
    const a: Point = [x, z], b: Point = [x + w, z], c: Point = [x + w, z + d], e: Point = [x, z + d];
    addEdge(a, b); addEdge(b, c); addEdge(c, e); addEdge(e, a);
  }
  const outgoing = new Map<string, string[]>();
  for (const [id, edge] of edges) outgoing.set(key(edge.a), [...(outgoing.get(key(edge.a)) ?? []), id]);
  const paths: Point[][] = [];
  while (edges.size) {
    const firstId = edges.keys().next().value!, first = edges.get(firstId)!;
    let currentId = firstId;
    const loop: Point[] = [];
    for (let count = 0; count <= (xs.length + zs.length) ** 2 * 4; count++) {
      const current = edges.get(currentId);
      if (!current) break;
      edges.delete(currentId); loop.push(current.a);
      if (key(current.b) === key(first.a)) break;
      const next = (outgoing.get(key(current.b)) ?? []).filter(id => edges.has(id));
      if (!next.length) break;
      // 在单点相接处优先右转，保持每个净空分量各自闭合。
      const incoming = Math.atan2(current.b[1] - current.a[1], current.b[0] - current.a[0]);
      const rank = (id: string) => {
        const e = edges.get(id)!, turn = (Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) - incoming + Math.PI * 2) % (Math.PI * 2);
        return turn === Math.PI / 2 ? 0 : turn === 0 ? 1 : turn === 3 * Math.PI / 2 ? 2 : 3;
      };
      currentId = next.sort((a, b) => rank(a) - rank(b))[0];
    }
    const simple = loop.filter((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
      return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
    });
    if (simple.length >= 4) paths.push(simple);
  }
  const points = paths.flat();
  return {
    paths,
    pathData: paths.map(outlinePath).join(" "),
    bounds: points.length ? boundsOf(points) : { x: box.x, z: box.z, w: 0, d: 0 },
    areaMm2,
    label: paths.length ? bestLabel(paths, candidates, room.label) : roomLabelPoint(room),
  };
}
