import * as THREE from "three";
import { construction, frontElevation, site, type Floor, type Point } from "./data.ts";
import { recessedPortico } from "./building-variants.ts";
import type { PorticoDraft } from "./layout-draft.ts";
import { orthogonalFloorGeometry } from "./floor-geometry.ts";
import { box, rect, type Mats } from "./primitives.ts";
import { compactPorticoColumnCarvings, referencePorticoColumn } from "./entrance-carvings.ts";

/** 两层半门厅采用一二楼通柱及双层石栏杆阳台，模型与图纸共用尺寸。 */
export const halfStoreyPorticoDesign = { beamDepth: 260, railHeight: 1100, balusterSpacing: 280 };
type Piece = { x: number; z: number; w: number; d: number; y: number; h: number;
  material: "trim" | "marble"; name: string; shape?: "baluster" };

/** 石栏杆瓶形截面，横坐标为直径比例的一半，纵坐标为高度比例。 */
export const halfStoreyBalusterProfile: Point[] = [
  [0, 0], [.5, 0], [.5, .05], [.35, .12], [.28, .22], [.4, .34], [.48, .47],
  [.44, .6], [.3, .74], [.28, .85], [.5, .93], [.5, 1], [0, 1],
];

export function halfStoreyBalcony(porch: PorticoDraft = site.portico, index = 2) {
  const columnSize = frontElevation.porticoColumnDepth;
  // 二楼板边收在通柱轮廓以内，柱子正面和外侧从一楼连续延伸到顶。
  const edge = index === 1 ? Math.min(120, columnSize * .3) : columnSize / 2 + 80;
  return { x: porch.x - edge, z: site.main.z - porch.projection - edge,
    w: porch.w + edge * 2, d: porch.projection + edge,
    columnZ: site.main.z - porch.projection, columnSize };
}

/** 室内与阳台形成同一块凹多边形楼板，北墙处不叠加接缝薄片。 */
export function halfStoreyFloorOutline(front: number, porch: PorticoDraft = site.portico, index = 2): Point[] {
  const m = site.main, back = m.z + m.d;
  if (recessedPortico()) return rect(m.x, front, m.w, back - front);
  const balcony = halfStoreyBalcony(porch, index);
  return [[m.x, front], [balcony.x, front], [balcony.x, balcony.z],
    [balcony.x + balcony.w, balcony.z], [balcony.x + balcony.w, front],
    [m.x + m.w, front], [m.x + m.w, back], [m.x, back]];
}

export function halfStoreyBalconyBeams(porch: PorticoDraft = site.portico) {
  const balcony = halfStoreyBalcony(porch);
  // 梁端深入通柱，梁的外皮退入柱身，二楼位置形成侧向连接。
  const sideStart = balcony.columnZ + 130;
  return [
    { x: porch.x, z: balcony.columnZ - 130, w: porch.w, d: 260 },
    ...[porch.x, porch.x + porch.w].map(x => ({ x: x - 120, z: sideStart,
      w: 240, d: site.main.z + 120 - sideStart })),
  ];
}

export function halfStoreyBalconyRails(porch: PorticoDraft = site.portico): [Point, Point][] {
  const balcony = halfStoreyBalcony(porch);
  const west = porch.x, east = porch.x + porch.w, z = balcony.columnZ;
  return [
    [[west, z], [east, z]],
    [[west, z], [west, site.main.z + 20]],
    [[east, z], [east, site.main.z + 20]],
  ];
}

export function halfStoreyBalconyPieces(floor: Pick<Floor, "y">, index: number, porch: PorticoDraft = site.portico): Piece[] {
  const pieces: Piece[] = [];
  const { railHeight, balusterSpacing } = halfStoreyPorticoDesign;
  const { columnSize, columnZ } = halfStoreyBalcony(porch);
  if (index === 2) for (const x of [porch.x, porch.x + porch.w]) {
    pieces.push({ x: x - columnSize / 2, z: columnZ - columnSize / 2,
      w: columnSize, d: columnSize, y: floor.y, h: railHeight, material: "trim", name: "半层门厅同宽方柱" });
    let top = floor.y + railHeight;
    for (const [lip, height] of [[20, 25], [35, 35], [50, 25]]) {
      pieces.push({ x: x - columnSize / 2 - lip, z: columnZ - columnSize / 2 - lip,
        w: columnSize + lip * 2, d: columnSize + lip * 2,
        y: top, h: height, material: "trim", name: "阳台方柱层叠压顶" });
      top += height;
    }
  }
  for (const [a, b] of halfStoreyBalconyRails(porch)) {
    const alongX = a[1] === b[1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const member = (at: number, span: number, y: number, h: number, thickness: number, name: string) => {
      pieces.push({ x: a[0] + (alongX ? at - span / 2 : -thickness / 2),
        z: a[1] + (alongX ? -thickness / 2 : at - span / 2),
        w: alongX ? span : thickness, d: alongX ? thickness : span,
        y: floor.y + y, h, material: "marble", name });
    };
    member(length / 2, length, 0, 100, 240, "大理石栏杆通长底座");
    member(length / 2, length, 100, 40, 200, "大理石栏杆下收边");
    member(length / 2, length, railHeight - 100, 70, 200, "大理石栏杆扶手承托");
    member(length / 2, length, railHeight - 30, 30, 240, "大理石栏杆扶手盖面");
    const start = columnSize / 2 + 80;
    const end = length - (alongX ? columnSize / 2 + 80 : 100);
    const count = Math.max(1, Math.ceil((end - start) / balusterSpacing) + 1);
    for (let i = 0; i < count && end >= start; i++) {
      const at = start + i * (end - start) / Math.max(1, count - 1);
      pieces.push({ x: a[0] + (alongX ? at : 0) - 80,
        z: a[1] + (alongX ? 0 : at) - 80, w: 160, d: 160,
        y: floor.y + 140, h: railHeight - 240, material: "marble",
        name: "大理石瓶形栏杆柱", shape: "baluster" });
    }
  }
  return pieces;
}

export function halfStoreyPorticoColumns(floorList: Pick<Floor, "y">[], porch: PorticoDraft = site.portico): Piece[] {
  const balcony = halfStoreyBalcony(porch), pieces: Piece[] = [];
  const base = site.entranceRise - 20;
  const top = floorList[2].y - construction.floorSlab;
  for (const x of [porch.x, porch.x + porch.w]) {
    pieces.push({ x: x - balcony.columnSize / 2, z: balcony.columnZ - balcony.columnSize / 2,
      w: balcony.columnSize, d: balcony.columnSize, y: base, h: Math.max(0, top - base),
      material: "trim", name: "一二楼一体门厅通柱" });
  }
  return pieces;
}

function addPieces(parent: THREE.Group, pieces: Piece[], mat: Mats) {
  for (const piece of pieces) {
    if (piece.shape === "baluster") {
      const profile = halfStoreyBalusterProfile.map(([r, y]) => new THREE.Vector2(r * piece.w, y * piece.h));
      const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), mat.marble);
      mesh.name = piece.name;
      mesh.position.set(piece.x + piece.w / 2, piece.y, piece.z + piece.d / 2);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
    } else {
      box(parent, piece.x + piece.w / 2, piece.y + piece.h / 2, piece.z + piece.d / 2,
        piece.w, piece.h, piece.d, mat[piece.material]).name = piece.name;
    }
  }
}

export function buildHalfStoreyPortico(parent: THREE.Group, floorList: Pick<Floor, "y">[], mat: Mats) {
  if (recessedPortico()) return;
  for (const column of halfStoreyPorticoColumns(floorList)) {
    referencePorticoColumn(parent, column.x + column.w / 2, column.z + column.d / 2,
      column.y, column.h, column.w, column.d, mat);
  }
}

export function buildHalfStoreyBalcony(parent: THREE.Group, floor: Pick<Floor, "y">, index: number, mat: Mats,
  porch: PorticoDraft = site.portico) {
  if (recessedPortico()) return;
  const group = new THREE.Group(); group.name = `${index + 1}楼门厅阳台`; parent.add(group);
  const beams = halfStoreyBalconyBeams(porch).map(piece => rect(piece.x, piece.z, piece.w, piece.d));
  const mesh = new THREE.Mesh(orthogonalFloorGeometry(beams, [], floor.y - construction.floorSlab,
    halfStoreyPorticoDesign.beamDepth, true, "union"), mat.trim);
  mesh.name = "阳台连续承托梁"; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  addPieces(group, halfStoreyBalconyPieces(floor, index, porch), mat);
  if (index === 2) {
    const { columnSize, columnZ } = halfStoreyBalcony(porch);
    for (const x of [porch.x, porch.x + porch.w])
      compactPorticoColumnCarvings(group, x, columnZ, floor.y,
        halfStoreyPorticoDesign.railHeight, columnSize, columnSize, mat);
  }
  return group;
}
