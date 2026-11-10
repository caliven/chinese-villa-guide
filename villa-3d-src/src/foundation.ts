import * as THREE from "three";
import { recessedPortico, porticoFrontZ } from "./building-variants";
import { construction, site, wallRoleOf, type Point, type Wall } from "./data";
import { CORNER_PEDESTAL_SCALE, cornerPedestalTop } from "./frontage-geometry";
import { box, slab, finishLayer, type Mats, type Opening } from "./primitives";

/** 一层外墙英国棕勒脚顶：与包角柱脚方座顶同值（已含室内抬高下限）。 */
export function firstFloorPlinthTop(rise = site.entranceRise) {
  return cornerPedestalTop(CORNER_PEDESTAL_SCALE, rise);
}

/**
 * 洞口先落到室内完成面，再改成相对勒脚顶（可负 sill），供横槽避让用。
 * 勿直接 raiseOpeningsToFinish(..., plinthTop)，否则门洞 sill 会被夹成 0。
 */
export function openingsRelativeToPlinth(
  openings: Opening[],
  rise: number,
  plinthTop: number,
): Opening[] {
  const delta = plinthTop - rise;
  return raiseOpeningsToFinish(openings, rise).map(o => ({
    ...o,
    sill: o.sill - delta,
  }));
}

/** 条形基础示意：墙下地梁＋埋深垫层；外皮与墙外皮齐平，不向外挑。非施工图。 */
export type FoundationMode = "strip";

export type FoundationSegment = {
  a: Point;
  b: Point;
  thickness: number;
};

/** 埋深垫层厚度；宽度与地梁同宽，不向两侧外挑。 */
export const FOUNDATION_FOOTING_DEPTH = 300;

/** 外墙洞口随墙底抬到一层完成面后，洞口坐标改相对新墙底。 */
export function raiseOpeningsToFinish(openings: Opening[], rise: number): Opening[] {
  if (rise <= 0) return openings.map(o => ({ ...o }));
  return openings.map(o => {
    const top = o.sill + o.h;
    const sill = Math.max(0, o.sill - rise);
    return { ...o, sill, h: Math.max(0, top - rise - sill) };
  });
}

/** 按一层外墙与承重墙收集条基轴线；虚拟墙不入模。 */
export function foundationSegments(input: {
  exterior: { a: Point; b: Point }[];
  partitions: Wall[];
  exteriorThickness?: number;
  bearingThickness?: number;
}): FoundationSegment[] {
  const exteriorThickness = input.exteriorThickness ?? construction.outsideWall;
  const bearingThickness = input.bearingThickness ?? construction.outsideWall;
  const segments: FoundationSegment[] = [];
  for (const wall of input.exterior) {
    if (Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) < 50) continue;
    segments.push({ a: wall.a, b: wall.b, thickness: exteriorThickness });
  }
  for (const wall of input.partitions) {
    if (wallRoleOf(wall) !== "bearing") continue;
    if (Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) < 50) continue;
    segments.push({ a: wall.a, b: wall.b, thickness: bearingThickness });
  }
  return segments;
}

/** 凸出门厅外伸段地梁：前沿＋两侧接到主楼前墙，与户型条基连成一体。 */
export function porticoFoundationSegments(
  porch = site.portico,
  thickness = construction.outsideWall,
): FoundationSegment[] {
  if (recessedPortico() || porch.projection < 50) return [];
  const x0 = porch.x;
  const x1 = porch.x + porch.w;
  const zFront = porticoFrontZ();
  const zWall = site.main.z;
  if (zWall - zFront < 50) return [];
  return [
    { a: [x0, zFront], b: [x1, zFront], thickness },
    { a: [x0, zFront], b: [x0, zWall], thickness },
    { a: [x1, zFront], b: [x1, zWall], thickness },
  ];
}

function stripAlong(
  parent: THREE.Object3D,
  a: Point,
  b: Point,
  thickness: number,
  rise: number,
  padMat: THREE.Material,
  plinthMat: THREE.Material,
) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 50 || rise < 20) return;
  const midX = (a[0] + b[0]) / 2;
  const midZ = (a[1] + b[1]) / 2;
  const angle = -Math.atan2(dz, dx);
  // 地梁与垫层同宽、端点止于轴线交点，外皮不超出墙外皮；转角缺口由转角块填实。
  const footing = box(
    parent,
    midX,
    -FOUNDATION_FOOTING_DEPTH / 2,
    midZ,
    len,
    FOUNDATION_FOOTING_DEPTH,
    thickness,
    padMat,
  );
  footing.rotation.y = angle;
  footing.name = "条基垫层";
  // 抬高层用深咖勒脚色，与白麻外墙「上浅下深」，不用主体墙色。
  const stem = box(parent, midX, rise / 2, midZ, len, rise, thickness, plinthMat);
  stem.rotation.y = angle;
  stem.name = "条基地梁";
}

/** 至少两段梁相交的轴线点才补转角；单段端头不外挑。 */
export function foundationCornerJoints(segments: FoundationSegment[]) {
  const joints = new Map<string, { point: Point; thickness: number; count: number }>();
  for (const segment of segments) {
    for (const point of [segment.a, segment.b] as Point[]) {
      const key = `${Math.round(point[0])},${Math.round(point[1])}`;
      const prev = joints.get(key);
      joints.set(key, {
        point: prev?.point ?? [Math.round(point[0]), Math.round(point[1])],
        thickness: Math.max(prev?.thickness ?? 0, segment.thickness),
        count: (prev?.count ?? 0) + 1,
      });
    }
  }
  return [...joints.values()].filter(joint => joint.count >= 2);
}

function fillCorners(
  parent: THREE.Object3D,
  segments: FoundationSegment[],
  rise: number,
  padMat: THREE.Material,
  plinthMat: THREE.Material,
) {
  for (const { point, thickness } of foundationCornerJoints(segments)) {
    // 转角块与地梁同宽，正好补外角缺口，不向外多挑。
    box(
      parent,
      point[0],
      -FOUNDATION_FOOTING_DEPTH / 2,
      point[1],
      thickness,
      FOUNDATION_FOOTING_DEPTH,
      thickness,
      padMat,
    ).name = "条基转角垫层";
    box(parent, point[0], rise / 2, point[1], thickness, rise, thickness, plinthMat).name = "条基转角";
  }
}

/** 按墙线生成一层抬高范围内的条形基础框架；抬高层深咖勒脚，垫层水泥灰。 */
export function buildFoundation(
  mat: Mats,
  segments: FoundationSegment[],
  rise = site.entranceRise,
  name = "地基",
  mode: FoundationMode = "strip",
) {
  const root = new THREE.Group();
  root.name = name;
  root.userData.foundationMode = mode;
  if (rise < 20 || mode !== "strip") return root;
  const pad = mat.concrete;
  const plinth = mat.british;
  for (const segment of segments) stripAlong(root, segment.a, segment.b, segment.thickness, rise, pad, plinth);
  fillCorners(root, segments, rise, pad, plinth);
  return root;
}

/** 勒脚贴面相对墙外皮的净空；须大于 0，否则与白麻墙共面闪烁。 */
export const PLINTH_WALL_CLEARANCE = 10;
/** 勒脚贴面厚度。 */
export const PLINTH_VENEER = 18;
/**
 * 独立端头仅内收贴面半厚，相接墙转角改用内外皮斜接，禁止用墙厚级内收。
 * 共面闪动靠净空 + finishLayer 解决，不靠大段留空。
 */
export const PLINTH_CORNER_INSET = PLINTH_VENEER / 2;

/**
 * 一层外墙外皮上的英国棕勒脚带：从室内抬高接到包角柱脚方座顶，
 * 与地基地梁同色，门洞处断开。
 * 贴面内表相对墙外皮留净空，转角内外皮斜接，用更高 finishLayer 防闪。
 */
export function exteriorPlinthBand(
  parent: THREE.Object3D,
  walls: { a: Point; b: Point; openings?: Opening[] }[],
  y0: number,
  y1: number,
  interior: Point,
  material: THREE.Material,
  wallThickness = construction.outsideWall,
) {
  const h = y1 - y0;
  if (h < 10) return;
  const g = new THREE.Group();
  g.name = "外墙英国棕勒脚";
  parent.add(g);
  const veneer = PLINTH_VENEER;
  const clearance = PLINTH_WALL_CLEARANCE;
  const face = wallThickness / 2 + clearance + veneer / 2;
  const endInset = PLINTH_CORNER_INSET;
  const skin = material instanceof THREE.MeshStandardMaterial
    ? finishLayer(material.clone(), 6)
    : material;
  const frames = walls.map(wall => {
    const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1];
    const length = Math.hypot(dx, dz);
    let nx = -dz / length, nz = dx / length;
    if (((wall.a[0] + wall.b[0]) / 2 - interior[0]) * nx
      + ((wall.a[1] + wall.b[1]) / 2 - interior[1]) * nz < 0) { nx = -nx; nz = -nz; }
    return { wall, nx, nz };
  });
  for (const wall of walls) {
    const [ax, az] = wall.a;
    const [bx, bz] = wall.b;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < endInset * 2 + 50) continue;
    const ux = dx / len;
    const uz = dz / len;
    let nx = -uz;
    let nz = ux;
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;
    if ((midX - interior[0]) * nx + (midZ - interior[1]) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    // 相接墙的饰面在同一斜接线上收口，内外皮分别求交；不在角上留半块贴面宽的孔。
    const corner = (point: Point) => frames.find(frame => frame.wall !== wall
      && [frame.wall.a, frame.wall.b].some(end => Math.hypot(end[0] - point[0], end[1] - point[1]) < 1)
      && 1 + nx * frame.nx + nz * frame.nz > 1e-4);
    const startCorner = corner(wall.a), endCorner = corner(wall.b);
    const cuts: [number, number][] = [];
    for (const opening of wall.openings ?? []) {
      if (opening.sill > h + 1) continue;
      cuts.push([opening.at - opening.w / 2 - 40, opening.at + opening.w / 2 + 40]);
    }
    cuts.sort((p, q) => p[0] - q[0]);
    let cursor = startCorner ? 0 : endInset;
    const spans: [number, number][] = [];
    const limit = endCorner ? len : len - endInset;
    for (const [c0, c1] of cuts) {
      const left = Math.max(cursor, Math.min(limit, c0));
      if (left - cursor > 40) spans.push([cursor, left]);
      cursor = Math.max(cursor, Math.min(limit, c1));
    }
    if (limit - cursor > 40) spans.push([cursor, limit]);
    const edgePoint = (s: number, distance: number): Point => {
      const joint = s === 0 ? startCorner : s === len ? endCorner : undefined;
      const denominator = joint ? 1 + nx * joint.nx + nz * joint.nz : 1;
      return [ax + ux * s + (nx + (joint?.nx ?? 0)) * distance / denominator,
        az + uz * s + (nz + (joint?.nz ?? 0)) * distance / denominator];
    };
    for (const [s0, s1] of spans) {
      const inner = face - veneer / 2, outer = face + veneer / 2;
      const mesh = slab(g, [edgePoint(s0, inner), edgePoint(s1, inner),
        edgePoint(s1, outer), edgePoint(s0, outer)], y1, h, skin);
      mesh.castShadow = false;
    }
  }
}
