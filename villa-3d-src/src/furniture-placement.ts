import { construction, isPhysicalWall, wallRoleOf, type Furniture, type Wall } from "./data";
import { furnitureLocalBounds, furnitureLocalToWorld } from "./furniture-catalog";

type Point = { x: number; z: number };
type Bounds = { x0: number; x1: number; z0: number; z1: number };
type Obstacle = { polygon: Point[]; bounds: Bounds; wall: boolean };
export const FURNITURE_WALL_FINISH = 20;
export const furnitureWallFinish = (f: Furniture) => f.kind === "shower" || f.kind === "fp-shower" ? 0 : FURNITURE_WALL_FINISH;

function footprint(f: Furniture): Point[] {
  const b = furnitureLocalBounds(f);
  return [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]
    .map(([x, z]) => furnitureLocalToWorld(x!, z!, f));
}

function bounds(p: Point[]): Bounds {
  return { x0: Math.min(...p.map(v => v.x)), x1: Math.max(...p.map(v => v.x)),
    z0: Math.min(...p.map(v => v.z)), z1: Math.max(...p.map(v => v.z)) };
}

function obstacles(f: Furniture, walls: Wall[], peers: Furniture[], exclude?: number): Obstacle[] {
  const out: Obstacle[] = [];
  for (const wall of walls) {
    if (!isPhysicalWall(wall)) continue;
    const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1], len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const ux = dx / len, uz = dz / len;
    const finish = furnitureWallFinish(f);
    const half = (wallRoleOf(wall) === "bearing" ? construction.outsideWall : construction.partition) / 2 + finish;
    const polygon = [[-finish, -half], [len + finish, -half], [len + finish, half], [-finish, half]]
      .map(([along, across]) => ({ x: wall.a[0] + along! * ux - across! * uz, z: wall.a[1] + along! * uz + across! * ux }));
    out.push({ polygon, bounds: bounds(polygon), wall: true });
  }
  peers.forEach((peer, i) => {
    if (peer === f || i === exclude) return;
    const polygon = footprint(peer);
    out.push({ polygon, bounds: bounds(polygon), wall: false });
  });
  return out;
}

/** 未成房区域也只提供墙面和家具边缘，不将实体墙中线当成家具贴边目标。 */
export function physicalFurnitureAnchors(f: Furniture, walls: Wall[], peers: Furniture[], exclude: number | undefined, gap: number) {
  const box = bounds(footprint(f)), xs: number[] = [], zs: number[] = [];
  for (const o of obstacles(f, walls, peers, exclude)) {
    const b = o.bounds;
    if (box.z1 >= b.z0 - gap && box.z0 <= b.z1 + gap) {
      if (!o.wall) xs.push(b.x0, b.x1);
      else if (b.x1 - b.x0 < b.z1 - b.z0) xs.push(f.x < (b.x0 + b.x1) / 2 ? b.x0 : b.x1);
    }
    if (box.x1 >= b.x0 - gap && box.x0 <= b.x1 + gap) {
      if (!o.wall) zs.push(b.z0, b.z1);
      else if (b.z1 - b.z0 < b.x1 - b.x0) zs.push(f.z < (b.z0 + b.z1) / 2 ? b.z0 : b.z1);
    }
  }
  return { xs, zs };
}

function project(p: Point[], axis: Point) {
  const values = p.map(v => v.x * axis.x + v.z * axis.z);
  return { lo: Math.min(...values), hi: Math.max(...values) };
}

/** 分离轴检测真实旋转矩形；包络相交但实体分开的家具不误判。 */
function separatingMoves(a: Point[], b: Point[]): Point[] | null {
  const axes: Point[] = [{ x: 1, z: 0 }, { x: 0, z: 1 }];
  for (const p of [a, b]) for (let i = 0; i < 2; i++) {
    const u = p[i]!, v = p[i + 1]!, len = Math.hypot(v.x - u.x, v.z - u.z);
    if (len > 0) axes.push({ x: (v.z - u.z) / len, z: (u.x - v.x) / len });
  }
  const moves: Point[] = [];
  for (const axis of axes) {
    const pa = project(a, axis), pb = project(b, axis);
    if (pa.hi <= pb.lo + 0.01 || pb.hi <= pa.lo + 0.01) return null;
    for (const d of [pb.lo - pa.hi, pb.hi - pa.lo]) {
      // 任意角度沿分离轴多退1mm，避免整数坐标舍入后重新相交。
      const offset = d + Math.sign(d);
      moves.push({ x: axis.x * offset, z: axis.z * offset });
    }
  }
  return moves;
}

export function furniturePositionIsClear(f: Furniture, walls: Wall[], peers: Furniture[]) {
  const polygon = footprint(f);
  return obstacles(f, walls, peers).every(o => !separatingMoves(polygon, o.polygon));
}

/** 就近解开墙和家具碰撞；逐一校验全部障碍，避免从一件家具推入另一件或墙内。 */
export function resolveFurnitureCollisions(f: Furniture, options: {
  walls: Wall[]; furniture: Furniture[]; exclude?: number;
  clear?: Bounds; previous?: Point;
}): boolean {
  const all = obstacles(f, options.walls, options.furniture, options.exclude);
  const target = { x: f.x, z: f.z }, local = footprint({ ...f, x: 0, z: 0 }), size = bounds(local);
  const clamp = (p: Point) => {
    const c = options.clear;
    if (!c) return { x: Math.round(p.x), z: Math.round(p.z) };
    return { x: Math.round(Math.max(c.x0 - size.x0, Math.min(c.x1 - size.x1, p.x))),
      z: Math.round(Math.max(c.z0 - size.z0, Math.min(c.z1 - size.z1, p.z))) };
  };
  const inside = (p: Point) => !options.clear || (p.x + size.x0 >= options.clear.x0 - 0.01 && p.x + size.x1 <= options.clear.x1 + 0.01 &&
    p.z + size.z0 >= options.clear.z0 - 0.01 && p.z + size.z1 <= options.clear.z1 + 0.01);
  const queue = [clamp(target)], seen = new Set<string>();
  for (let count = 0; queue.length && count < 96; count++) {
    queue.sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z));
    const p = queue.shift()!, key = `${p.x},${p.z}`;
    if (seen.has(key)) { count--; continue; }
    seen.add(key);
    if (!inside(p)) continue;
    const polygon = local.map(v => ({ x: v.x + p.x, z: v.z + p.z }));
    const collision = all.map(o => ({ o, moves: separatingMoves(polygon, o.polygon) })).find(v => v.moves);
    if (!collision) { f.x = p.x; f.z = p.z; return true; }
    for (const move of collision.moves!) {
      const next = clamp({ x: p.x + move.x, z: p.z + move.z });
      const previous = options.previous;
      if (collision.o.wall && previous) {
        const wall = collision.o.polygon, a = wall[0]!, b = wall[1]!;
        const normal = { x: -(b.z - a.z), z: b.x - a.x };
        const center = { x: (wall[0]!.x + wall[2]!.x) / 2, z: (wall[0]!.z + wall[2]!.z) / 2 };
        const side = (v: Point) => (v.x - center.x) * normal.x + (v.z - center.z) * normal.z;
        // 从室内拖到墙带上时仍留在原侧，不因较短的推出距离弹到室外。
        if (side(previous) * side(next) < 0) continue;
      }
      if (!seen.has(`${next.x},${next.z}`)) queue.push(next);
    }
  }
  if (options.previous) { f.x = options.previous.x; f.z = options.previous.z; }
  return false;
}
