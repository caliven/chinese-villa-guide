import * as THREE from "three";
import { construction, isPhysicalWall, site, wallRoleOf, type Floor, type Point } from "./data";
import { partitionProfile } from "./partition-geometry";
import { furnish, rect, slab, tag, wallWithOpenings, type Mats, type Opening } from "./primitives";
import { clipHalfStorey } from "./half-storey";

/** 半层独立构造：楼面、坡下围护与室内，不复用原三层的高柱和露台装饰。 */
export function buildHalfStoreyLevel(
  parent: THREE.Group, floor: Floor, mat: Mats,
  facades: { a: Point; b: Point; openings: Opening[] }[],
  holes: Point[][], withLabels: boolean,
) {
  const m = site.main;
  slab(parent, rect(m.x + 160, floor.front + 60, m.w - 320, m.z + m.d - floor.front - 110),
    floor.y, construction.floorSlab, mat.floor, holes).name = "半层楼面";
  const envelope = new THREE.Group(); envelope.name = "半层坡下围护"; parent.add(envelope);
  for (const wall of facades)
    wallWithOpenings(envelope, wall.a, wall.b, floor.y, floor.height, wall.openings, mat, construction.outsideWall, false, mat.sand);
  for (const wall of floor.partitions) {
    if (!isPhysicalWall(wall)) continue;
    const profile = partitionProfile(wall, floor.height), opening = profile.opening;
    wallWithOpenings(envelope, wall.a, wall.b, floor.y, profile.height, opening ? [{
      at: opening.offset + opening.width / 2, w: opening.width, sill: opening.sill, h: opening.height,
      door: opening.door, hinge: opening.hinge, side: opening.side, kind: opening.kind,
    }] : [], mat, wallRoleOf(wall) === "bearing" ? construction.outsideWall : construction.partition, true);
  }
  floor.furniture.forEach((item, index) => {
    const model = furnish(envelope, item, floor.y, mat);
    model.userData.layoutSelection = { kind: "furniture", floor: 2, index };
  });
  clipHalfStorey(envelope);
  const labels = new THREE.Group(); labels.visible = false; parent.add(labels);
  for (const room of withLabels ? floor.rooms : []) {
    const [x, z] = room.label ?? [room.x + room.w / 2, room.z + room.d / 2];
    tag(labels, room.name, x, floor.y + 700, z, "#284b3b", .58);
  }
  return labels;
}
