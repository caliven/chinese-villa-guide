import { construction, isPhysicalWall, wallRoleOf, type Point, type Wall } from "./data";
import { facades } from "./facades";
import { recessFrontFacades } from "./building-variants";
import type { LayoutDraft } from "./layout-draft";

/** 外墙用实际墙带的远侧，内部实体墙用中心线；虚拟分界不作为实体墙。 */
export type WallContactTarget = Pick<Wall, "a" | "b" | "role"> & { exterior?: boolean };

export function exteriorWallTargets(floor: number, front?: number): WallContactTarget[] {
  const faces = facades(floor);
  return (floor === 3 ? faces : recessFrontFacades(faces, front ?? 0)).map(face => ({
    a: face.a, b: face.b, role: "bearing", exterior: true,
  }));
}

function axis(wall: Pick<Wall, "a" | "b">): 0 | 1 | null {
  const dx = Math.abs(wall.b[0] - wall.a[0]), dz = Math.abs(wall.b[1] - wall.a[1]);
  return dx > 1 && dz <= 1 ? 0 : dz > 1 && dx <= 1 ? 1 : null;
}

function half(wall: WallContactTarget) {
  return (wallRoleOf(wall as Wall) === "bearing" ? construction.outsideWall : construction.partition) / 2;
}

/** 只处理真实接触的端点；不跨接空隙，不改虚拟墙、共线墙或穿过交点的整段墙。 */
export function normalizeConnectedWallEndpoints(walls: Wall[], exterior: readonly WallContactTarget[]) {
  const original = structuredClone(walls);
  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i]!, old = original[i]!, along = axis(old);
    if (along === null || !isPhysicalWall(old)) continue;
    const normal = (1 - along) as 0 | 1;
    const ownHalf = half(old);
    const targets: WallContactTarget[] = [...exterior, ...original.filter((_, j) => i !== j)];
    for (const end of ["a", "b"] as const) {
      const other = end === "a" ? "b" : "a";
      const point = old[end];
      let best: { target: number; exterior: boolean; distance: number } | undefined;
      for (const host of targets) {
        if (!isPhysicalWall(host as Wall) || axis(host) !== normal) continue;
        const at = (host.a[along] + host.b[along]) / 2;
        const lo = Math.min(host.a[normal], host.b[normal]);
        const hi = Math.max(host.a[normal], host.b[normal]);
        const distance = Math.abs(point[along] - at), hostHalf = half(host);
        if (distance > hostHalf + 1 || point[normal] < lo - ownHalf - 1 || point[normal] > hi + ownHalf + 1) continue;
        const direction = Math.sign(point[along] - old[other][along]);
        if (!direction) continue;
        const target = Math.round(at + (host.exterior ? direction * hostHalf : 0));
        if (!best || Number(!!host.exterior) > Number(best.exterior) ||
            (!!host.exterior === best.exterior && distance < best.distance)) {
          best = { target, exterior: !!host.exterior, distance };
        }
      }
      // 保留已对齐的旧稿小数，避免仅因毫米取整改变边界关联。
      if (!best || Math.abs(best.target - point[along]) <= 1) continue;
      const next = [...wall[end]] as Point;
      next[along] = best.target;
      const a = end === "a" ? next : wall.a, b = end === "b" ? next : wall.b;
      const direction = Math.sign(old.b[along] - old.a[along]);
      const length = (b[along] - a[along]) * direction;
      if (length < 50) continue;
      // 原有门窗保持世界坐标。若缩短会切到洞口，保留该端原位。
      const offset = old.door ? old.door.offset + (old.a[along] - a[along]) * direction : 0;
      if (old.door && (offset < -0.001 || offset + old.door.width > length + 0.001)) continue;
      wall[end] = next;
      if (old.door) wall.door = { ...old.door, offset };
    }
  }
}

/** 在当前方案尺寸应用后，接管已有户型；不写原始版本文件。 */
export function normalizeDraftWallContacts(draft: LayoutDraft): LayoutDraft {
  draft.floors.forEach((floor, i) => normalizeConnectedWallEndpoints(floor.partitions, exteriorWallTargets(i, floor.front)));
  normalizeConnectedWallEndpoints(draft.annexPartitions, exteriorWallTargets(3));
  return draft;
}
