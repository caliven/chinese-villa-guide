import { construction, isPhysicalWall, wallRoleOf, type Point, type Wall } from "./data";

export type WallConstraintResult = { ok: boolean; reason?: string };
/** 显式同线吸附：纠正相接墙端的毫米级错位，其余编辑仍保留原接点偏移。 */
export type WallLineAlignment = { wallIndex: number; target: number; tolerance?: number };
type Coordinate = 0 | 1;
type End = "a" | "b";
type Axis = Coordinate;
type Contact = { wall: number; end: End; host: number };

/** 建模拓扑容差，不是交互吸附距离；毫米整数数据只容许 1 mm 舍入误差。 */
const JOINT_TOL = 1;

function axisOf(wall: Wall): Axis | null {
  const dx = Math.abs(wall.b[0] - wall.a[0]);
  const dz = Math.abs(wall.b[1] - wall.a[1]);
  if (![...wall.a, ...wall.b].every(Number.isFinite)) return null;
  if (dx <= JOINT_TOL && dz > JOINT_TOL) return 1;
  if (dz <= JOINT_TOL && dx > JOINT_TOL) return 0;
  return null;
}

function halfThickness(wall: Wall): number {
  if (!isPhysicalWall(wall)) return 0;
  return (wallRoleOf(wall) === "bearing" ? construction.outsideWall : construction.partition) / 2;
}

function cloneWall(wall: Wall): Wall {
  return { ...wall, a: [...wall.a], b: [...wall.b], ...(wall.door ? { door: { ...wall.door } } : {}) };
}

function endpointOnWall(point: Point, wall: Wall, endpointWall: Wall): boolean {
  const axis = axisOf(wall);
  if (axis === null) return false;
  const cross = (1 - axis) as Coordinate;
  const at = (wall.a[cross] + wall.b[cross]) / 2;
  const lo = Math.min(wall.a[axis], wall.b[axis]);
  const hi = Math.max(wall.a[axis], wall.b[axis]);
  // 墙端在主墙厚度内才属于实体接触；不能把吸附范围里的空隙视为连接。
  return Math.abs(point[cross] - at) <= halfThickness(wall) + JOINT_TOL &&
    point[axis] >= lo - halfThickness(endpointWall) - JOINT_TOL &&
    point[axis] <= hi + halfThickness(endpointWall) + JOINT_TOL;
}

/**
 * 墙几何变化后维护原洞口。洞宽不随墙缩小；放不下则拒绝，放得下才平移到合法区间。
 * a/b 反向时 offset、hinge、side 一起转换，保留门在世界中的铰链及开启方向。
 * original 是整次编辑起始快照，因此拖短后再拖回不会累计移动洞口。
 * 此函数只在成功时写入 wall.door；洞口自身的尺寸编辑由调用方单独处理。
 */
export function reconcileWallOpening(wall: Wall, original: Wall): WallConstraintResult {
  const opening = original.door ?? wall.door;
  if (!opening) return { ok: true };
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  if (!Number.isFinite(length) || !Number.isFinite(opening.width) || opening.width <= 0 ||
      !Number.isFinite(opening.offset)) return { ok: false, reason: "墙段或门窗洞口尺寸无效" };
  if (length < opening.width) return { ok: false, reason: "墙长小于原门窗洞口宽度，请先调整洞口或墙长" };
  const reverse = (wall.b[0] - wall.a[0]) * (original.b[0] - original.a[0]) +
    (wall.b[1] - wall.a[1]) * (original.b[1] - original.a[1]) < 0;
  const next = { ...opening };
  next.offset = Math.max(0, Math.min(length - opening.width,
    reverse ? length - opening.offset - opening.width : opening.offset));
  if (reverse) {
    next.hinge = opening.hinge === "end" ? "start" : "end";
    next.side = opening.side === "in" ? "out" : "in";
  }
  wall.door = next;
  return { ok: true };
}

/**
 * 从操作起始快照重建墙拓扑，并统一传播直接编辑墙的位移。
 * 每端的 X/Z 位移是约束变量：墙本身约束正交，L 角约束两轴，T 接点只约束法向。
 * 原实体相交/贴面偏移被保留；共线分段的真实公共端点也保持相连。
 * editedIndices 必须列出所有主动修改的墙；originals 必须是拖动起始完整快照。
 * 矛盾约束、墙塌缩、接点越出墙段或洞口放不下时，返回失败，传入数组保持调用时内容。
 */
export function constrainWallEdits(
  walls: Wall[],
  originals: Wall[],
  editedIndices: readonly number[],
  alignment?: WallLineAlignment,
): WallConstraintResult {
  if (walls.length !== originals.length) return { ok: false, reason: "墙体列表与操作快照不一致" };
  const edited = new Set(editedIndices);
  if ([...edited].some((i) => !Number.isInteger(i) || i < 0 || i >= walls.length)) {
    return { ok: false, reason: "墙体索引无效" };
  }
  if (edited.size === 0) return { ok: true };
  const candidate = originals.map((wall, i) => cloneWall(edited.has(i) ? walls[i]! : wall));
  const axes = originals.map(axisOf);
  const reversed = new Set<number>();
  for (const i of edited) {
    const axis = axisOf(candidate[i]!);
    if (axis === null || (axes[i] !== null && axes[i] !== axis)) {
      return { ok: false, reason: "墙体编辑须保持原水平或竖直方向" };
    }
    axes[i] = axis;
    const cross = (1 - axis) as Coordinate;
    const at = Math.round((candidate[i]!.a[cross] + candidate[i]!.b[cross]) / 2);
    candidate[i]!.a[cross] = at;
    candidate[i]!.b[cross] = at;
    if ((candidate[i]!.b[axis] - candidate[i]!.a[axis]) *
        (originals[i]!.b[axis] - originals[i]!.a[axis]) < 0) {
      reversed.add(i);
      [candidate[i]!.a, candidate[i]!.b] = [candidate[i]!.b, candidate[i]!.a];
    }
  }

  const contacts: Contact[] = [];
  // 每端有 X/Z 两个节点。连通节点使用相同位移，天然保留原有墙面偏移。
  const node = (i: number, end: End, coordinate: Coordinate) => i * 4 + (end === "b" ? 2 : 0) + coordinate;
  const edges: { node: number; offset: number }[][] = Array.from({ length: walls.length * 4 }, () => []);
  const alignedWall = alignment && edited.has(alignment.wallIndex) ? originals[alignment.wallIndex] : undefined;
  const alignedAxis = alignedWall ? axisOf(alignedWall) : null;
  const alignedCoordinate = alignedAxis === null ? null : (1 - alignedAxis) as Coordinate;
  const alignedAt = alignedWall && alignedCoordinate !== null ? alignedWall.a[alignedCoordinate] : NaN;
  if (alignment && (!alignedWall || alignedCoordinate === null || !Number.isFinite(alignment.target) ||
      Math.abs(candidate[alignment.wallIndex]!.a[alignedCoordinate] - alignment.target) > JOINT_TOL)) {
    return { ok: false, reason: "同线对齐目标与所选墙位置不一致" };
  }
  const valueAtNode = (n: number) => originals[Math.floor(n / 4)]![n % 4 < 2 ? "a" : "b"][n % 2 as Coordinate];
  const link = (a: number, b: number) => {
    // 同线操作约束最终坐标相同，而非保留原来 7／13 mm 等接点误差。
    // 只校正本行及真实相接端点，不将另一侧平行墙或无关房间一起拉走。
    const normalize = alignedCoordinate !== null && a % 2 === alignedCoordinate && b % 2 === alignedCoordinate &&
      Math.abs(valueAtNode(a) - alignedAt) <= (alignment?.tolerance ?? 120) &&
      Math.abs(valueAtNode(b) - alignedAt) <= (alignment?.tolerance ?? 120);
    const offset = normalize ? valueAtNode(a) - valueAtNode(b) : 0;
    edges[a]!.push({ node: b, offset });
    edges[b]!.push({ node: a, offset: -offset });
  };
  for (let i = 0; i < walls.length; i += 1) {
    const axis = axes[i];
    if (axis === null) continue;
    const cross = (1 - axis) as Coordinate;
    link(node(i, "a", cross), node(i, "b", cross));
    for (let j = i + 1; j < walls.length; j += 1) {
      const otherAxis = axes[j];
      if (otherAxis === null) continue;
      if (axis === otherAxis) {
        // 只合并同轴分段的公共端点，不把平行贴面墙或重叠段当成同一根墙。
        for (const a of ["a", "b"] as const) for (const b of ["a", "b"] as const) {
          if (Math.abs(originals[i]![a][0] - originals[j]![b][0]) <= JOINT_TOL &&
              Math.abs(originals[i]![a][1] - originals[j]![b][1]) <= JOINT_TOL) {
            link(node(i, a, 0), node(j, b, 0));
            link(node(i, a, 1), node(j, b, 1));
          }
        }
        continue;
      }
      for (const [endpointIndex, hostIndex] of [[i, j], [j, i]] as const) {
        const endpointWall = originals[endpointIndex]!;
        const host = originals[hostIndex]!;
        const hostAxis = axes[hostIndex]!;
        const hostCross = (1 - hostAxis) as Coordinate;
        for (const end of ["a", "b"] as const) {
          const point = endpointWall[end];
          if (!endpointOnWall(point, host, endpointWall)) continue;
          contacts.push({ wall: endpointIndex, end, host: hostIndex });
          link(node(endpointIndex, end, hostCross), node(hostIndex, "a", hostCross));
          // L 角：端点贴主墙端部时，另一轴也相连；T 角保留沿主墙的自由滑移。
          for (const tip of ["a", "b"] as const) {
            if (Math.abs(point[hostAxis] - host[tip][hostAxis]) <= halfThickness(endpointWall) + JOINT_TOL) {
              link(node(endpointIndex, end, hostAxis), node(hostIndex, tip, hostAxis));
            }
          }
        }
      }
    }
  }

  const prescribed = new Map<number, number>();
  for (const i of edited) for (const end of ["a", "b"] as const) for (const coordinate of [0, 1] as const) {
    prescribed.set(node(i, end, coordinate), candidate[i]![end][coordinate] - originals[i]![end][coordinate]);
  }
  const displacement = new Float64Array(edges.length);
  const relative = new Float64Array(edges.length);
  const visited = new Uint8Array(edges.length);
  for (let start = 0; start < edges.length; start += 1) {
    if (visited[start]) continue;
    const component = [start];
    visited[start] = 1;
    let delta: number | undefined;
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      const current = component[cursor]!;
      const prescribedDelta = prescribed.get(current);
      const required = prescribedDelta === undefined ? undefined : prescribedDelta - relative[current]!;
      if (required !== undefined) {
        if (delta !== undefined && Math.abs(delta - required) > JOINT_TOL) {
          return { ok: false, reason: "相连墙体的编辑约束相互矛盾，请分步调整" };
        }
        delta ??= required;
      }
      for (const edge of edges[current]!) {
        const next = edge.node, offset = relative[current]! + edge.offset;
        if (!visited[next]) {
          visited[next] = 1;
          relative[next] = offset;
          component.push(next);
        } else if (Math.abs(relative[next]! - offset) > JOINT_TOL) {
          return { ok: false, reason: "相接墙线无法同时对齐，请先检查墙体连接" };
        }
      }
    }
    for (const current of component) displacement[current] = delta === undefined ? 0 : relative[current]! + delta;
  }
  for (let i = 0; i < walls.length; i += 1) {
    const wall = candidate[i]!;
    const original = originals[i]!;
    for (const end of ["a", "b"] as const) for (const coordinate of [0, 1] as const) {
      wall[end][coordinate] = Math.round(original[end][coordinate] + displacement[node(i, end, coordinate)]!);
    }
    const changed = wall.a.some((value, k) => value !== original.a[k]) ||
      wall.b.some((value, k) => value !== original.b[k]);
    if (!changed) continue;
    if (axisOf(wall) === null) return { ok: false, reason: "墙体调整后长度为零或无法保持正交" };
    const axis = axes[i];
    if (axis !== null && (wall.b[axis] - wall.a[axis]) * (original.b[axis] - original.a[axis]) <= 0) {
      return { ok: false, reason: "调整会将相邻墙拉过另一端，请先重新布置接点" };
    }
  }
  for (const contact of contacts) {
    if (!endpointOnWall(candidate[contact.wall]![contact.end], candidate[contact.host]!, candidate[contact.wall]!)) {
      return { ok: false, reason: "调整后原有接点会脱离墙段，请先处理相接墙体" };
    }
  }
  for (let i = 0; i < walls.length; i += 1) {
    const wall = candidate[i]!;
    const original = originals[i]!;
    if (reversed.has(i)) [wall.a, wall.b] = [wall.b, wall.a];
    const changed = wall.a.some((value, k) => value !== original.a[k]) ||
      wall.b.some((value, k) => value !== original.b[k]);
    if (changed || edited.has(i)) {
      const opening = reconcileWallOpening(wall, original);
      if (!opening.ok) return opening;
    }
  }
  for (let i = 0; i < walls.length; i += 1) {
    walls[i]!.a = candidate[i]!.a;
    walls[i]!.b = candidate[i]!.b;
    if (candidate[i]!.door) walls[i]!.door = candidate[i]!.door;
    else delete walls[i]!.door;
  }
  return { ok: true };
}
