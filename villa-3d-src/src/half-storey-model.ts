import * as THREE from "three";
import { construction, isPhysicalWall, site, wallRoleOf, type Floor, type Point } from "./data";
import { joinedWallSpan, partitionProfile, wallJunctionPeers } from "./partition-geometry";
import { furnish, slab, tag, wallWithOpenings, type Mats, type Opening } from "./primitives";
import { clipHalfStorey } from "./half-storey";
import { buildHalfStoreyBalcony, halfStoreyFloorOutline } from "./half-storey-portico.ts";

/** 半层独立构造：楼面、坡下围护与室内，不复用原三层的高柱和露台装饰。 */
export function buildHalfStoreyLevel(
  parent: THREE.Group, floor: Floor, mat: Mats,
  facades: { a: Point; b: Point; openings: Opening[] }[],
  holes: Point[][], withLabels: boolean,
) {
  // 与主楼一致：轮廓点即外墙外皮，楼板与之齐平。
  slab(parent, halfStoreyFloorOutline(floor.front),
    floor.y, construction.floorSlab, mat.concrete, holes).name = "半层楼面";
  const envelope = new THREE.Group(); envelope.name = "半层坡下围护"; parent.add(envelope);
  const peers = wallJunctionPeers(floor.partitions, facades);
  for (const wall of facades)
    wallWithOpenings(envelope, wall.a, wall.b, floor.y, floor.height, wall.openings, mat, construction.outsideWall, false, mat.sand);
  for (const wall of floor.partitions) {
    if (!isPhysicalWall(wall)) continue;
    const span = joinedWallSpan(wall, peers);
    const m = site.main;
    const bury = ([px, pz]: Point): Point => {
      let x = px, z = pz;
      if (Math.abs(x - m.x) <= 20) x = m.x + 220;
      else if (Math.abs(x - m.x - m.w) <= 20) x = m.x + m.w - 220;
      if (Math.abs(z - floor.front) <= 20) z = floor.front + 220;
      else if (Math.abs(z - m.z - m.d) <= 20) z = m.z + m.d - 220;
      return [x, z];
    };
    const a = bury(span.a), b = bury(span.b);
    const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const pulled = length ? ((a[0] - wall.a[0]) * (wall.b[0] - wall.a[0]) + (a[1] - wall.a[1]) * (wall.b[1] - wall.a[1])) / length : 0;
    const profile = partitionProfile(wall, floor.height), opening = profile.opening;
    wallWithOpenings(envelope, a, b, floor.y, profile.height, opening ? [{
      at: opening.offset - pulled + opening.width / 2, w: opening.width, sill: opening.sill, h: opening.height,
      door: opening.door, hinge: opening.hinge, side: opening.side, kind: opening.kind,
    }] : [], mat, wallRoleOf(wall) === "bearing" ? construction.outsideWall : construction.partition, true);
  }
  floor.furniture.forEach((item, index) => {
    const model = furnish(envelope, item, floor.y, mat);
    model.userData.layoutSelection = { kind: "furniture", floor: 2, index };
  });
  clipHalfStorey(envelope);
  buildHalfStoreyBalcony(parent, floor, 2, mat);
  const labels = new THREE.Group(); labels.visible = false; parent.add(labels);
  for (const room of withLabels ? floor.rooms : []) {
    const [x, z] = room.label ?? [room.x + room.w / 2, room.z + room.d / 2];
    tag(labels, room.name, x, floor.y + 700, z, "#284b3b", .58);
  }
  return labels;
}
