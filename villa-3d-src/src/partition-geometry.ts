import { construction, isPhysicalWall, wallRoleOf, type Wall } from "./data";
import { physicalWallJoinExtensions, type PhysicalWallStroke } from "./room-geometry";
import { interiorOpeningProfile } from "./openings";
import { stairSoffitClearHeight, type StairSoffitGeom } from "./primitives";

/** 与二维墙线、净空求解共用真实接触规则，虚拟分界不能补出实体墙角。 */
export function wallJunctionPeers(parts: readonly Wall[], facades: readonly Pick<Wall, "a" | "b">[]): PhysicalWallStroke[] {
  return [
    ...parts.filter(isPhysicalWall).map(part => ({ a: part.a, b: part.b,
      thick: wallRoleOf(part) === "bearing" ? construction.outsideWall : construction.partition })),
    ...facades.map(face => ({ a: face.a, b: face.b, thick: construction.outsideWall })),
  ];
}

/** 只派生三维端面，门窗仍以原墙起点定位，不改写户型墙线。 */
export function joinedWallSpan(wall: Pick<Wall, "a" | "b">, peers: readonly PhysicalWallStroke[]) {
  const join = physicalWallJoinExtensions(wall, peers);
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const ux = length ? (wall.b[0] - wall.a[0]) / length : 0;
  const uz = length ? (wall.b[1] - wall.a[1]) / length : 0;
  return { join, a: [wall.a[0] - ux * join.start, wall.a[1] - uz * join.start] as [number, number],
    b: [wall.b[0] + ux * join.end, wall.b[1] + uz * join.end] as [number, number] };
}

/** 户型三维和完整房屋共用的隔墙净高，标高始终相对本层完成面。 */
export function partitionProfile(part: Wall, storyHeight: number, stair?: StairSoffitGeom, ceilingGap = 150) {
  let height = Math.max(0, storyHeight - ceilingGap);
  if (stair) {
    const clearances: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const clear = stairSoffitClearHeight(part.a[0] + (part.b[0] - part.a[0]) * i / 8,
        part.a[1] + (part.b[1] - part.a[1]) * i / 8, stair, storyHeight);
      if (clear != null) clearances.push(clear);
    }
    if (clearances.length >= 4) height = Math.min(height, Math.max(900, Math.min(...clearances) - 30));
  }
  return { height, opening: part.door ? interiorOpeningProfile(part.door, height) : undefined };
}
