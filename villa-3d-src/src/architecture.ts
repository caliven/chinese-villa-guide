import { porticoElevation, recessedPortico, mirroredBuildings, recessedFloor, recessedFootprint, porticoFrontZ, porticoWallZ, mainLocalX, annexLocalX, hasThirdFloorSideTerraces, frontTerracePosts } from "./building-variants";
import * as THREE from "three";
import { orthogonalFloorGeometry } from "./floor-geometry";
import {
  site,
  floors,
  frontElevation,
  stairLayout,
  construction,
  circulation,
  annexPartitions,
  annexFurniture,
  wallRoleOf,
  isPhysicalWall,
  type Floor,
  type Furniture,
  type Point,
  type Wall,
} from "./data";
import { ensureFurnitureWallClearance } from "./layout-align";
import type { ExteriorOpeningDraft, LayoutDraft, PorticoDraft, StairDraft, VoidDraft } from "./layout-draft";
import { facadeOpeningToWallOpening, floorsHaveStair } from "./layout-draft";
import { stairOpeningBounds, fitStairToRoom } from "./stair-geometry";
import { interiorRailingLayout } from "./interior-railing";
import { interiorRailing } from "./railing-options";
import { continuousGlazing } from "./continuous-glazing";
import { integratedEntry } from "./entry-assembly";
import { frontOpeningsChanged, resolveLayoutFacades } from "./facade-layout";
import { FRONT_OPENING } from "./openings";
import { joinedWallSpan, partitionProfile, wallJunctionPeers } from "./partition-geometry";
import {
  eastTransomBand,
  facades,
  mainEaveY,
  mainFrontOpeningX,
  secondFloorGlassHeadY,
  secondFloorSideGlassHeadY,
  thirdFloorMaxOpeningHead,
} from "./facades";
import { cornerPilaster, balconyCornerPost, recessedHatPier, glassBalustrade, frontTerraceRailRuns, gutteredRoof, roofEaves, integratedHatEaves, hipRise, meander, tiledApron, openingFrame, apronFasciaBottom, hatSupportInset } from "./facade-details";
import { referencePorticoColumn, referenceCornerPilaster, referencePorticoBeam, referenceUpperCornerPilaster, columnProfileMeshes } from "./entrance-carvings";
import { porticoShoulderProfile } from "./column-profiles";
import { PORTICO_BEAM_DEPTH, porticoColumnCenters, porticoColumnOuterWidth } from "./frontage-geometry";
import {
  cornerPilasterTopY,
  frontApronSection,
  apronEaveDesign,
  eyelidFixed,
  eyelidStackHeight,
  fasciaBottomY,
  floatingHatDesign,
  floatingHatLevels,
  joinedHatDesign,
  DEFAULT_ROOF_STYLE,
  roofTileEaveLift,
  annexRoofProfile,
  roofGutterDesign,
  eaveTrimDesign,
  annexRoofGutterDesign,
  annexEaveTrimDesign,
  withAnnexRoofDesign,
  roofTileInset,
  type RoofStyle,
} from "./roof-options";
import { addTiledRoof, hipRoofSurfaces, hatRoofSurfaces, joinRoofFaces } from "./roof-surfaces";
import {
  box,
  slab,
  rect,
  wallWithOpenings,
  railing,
  furnish,
  stairs,
  tag,
  type Mats,
  type Opening,
} from "./primitives";

// 两根门厅柱前面是整块垫高，三步只嵌在柱与柱中间。
// 面对房子时左侧为东。坡道外侧边贴着柱北缘，分别向东、向西延伸，不伸向院坪栏杆。
function entranceApproach(parent: THREE.Object3D, mat: Mats) {
  const g = new THREE.Group();
  g.name = recessedPortico() ? "凹入门厅柱间三步" : "门厅柱间三步与两侧坡道";
  parent.add(g);
  const rise = site.entranceRise;
  const tread = construction.entranceTread;
  const [west, east] = frontElevation.balustradePosts.slice(1, 3);
  const westOuter = west.x - west.w / 2;
  const westInner = west.x + west.w / 2;
  const eastInner = east.x - east.w / 2;
  const eastOuter = east.x + east.w / 2;
  const columnNorth = frontElevation.porticoColumnZ - frontElevation.porticoColumnDepth / 2;
  const doorZ = porticoWallZ();
  const landingFront = columnNorth - construction.entranceLandingOffset;
  const stepFront = landingFront - tread * 2;
  const stone = mat.darkStone;
  box(
    g, (westOuter + eastOuter) / 2, rise / 2, (landingFront + doorZ) / 2,
    eastOuter - westOuter, rise, doorZ - landingFront, stone,
  );
  const cheeks = new THREE.Group();
  cheeks.name = "柱前垫高";
  g.add(cheeks);
  for (const [x0, x1] of [[westOuter, westInner], [eastInner, eastOuter]] as [number, number][]) {
    box(
      cheeks, (x0 + x1) / 2, rise / 2, (stepFront + landingFront) / 2,
      x1 - x0, rise, landingFront - stepFront + 10, stone,
    );
  }
  const steps = new THREE.Group();
  steps.name = "柱间三步";
  g.add(steps);
  for (const [top, z0] of [
    [rise / 3, stepFront],
    [(rise * 2) / 3, stepFront + tread],
  ] as [number, number][]) {
    const z1 = z0 + tread + 10;
    box(steps, (westInner + eastInner) / 2, top / 2, (z0 + z1) / 2, eastInner - westInner, top, z1 - z0, stone);
    treadLines(steps, westInner, eastInner, top, z0, mat.darkStoneGroove);
  }
  treadLines(g, westInner, eastInner, rise, landingFront, mat.darkStoneGroove);
  // 凹入门厅两翼已是室内实体，不再向两侧延伸坡道。
  if (recessedPortico()) return;
  // 原先拉到墙角柱，大约 3.7 米。改短到 2 米，坡大约 1:5，是缩短后的设计坡度。
  const rampRun = construction.entranceRampRun;
  const south = doorZ + 20;
  const eastRamp = wedgeAlongX(g, south, columnNorth, eastOuter - 20, eastOuter + rampRun, rise, 20, stone);
  eastRamp.name = "东侧坡道";
  const westRamp = wedgeAlongX(g, south, columnNorth, westOuter + 20, westOuter - rampRun, rise, 20, stone);
  westRamp.name = "西侧坡道";
  rampGrooves(g, south, columnNorth, eastOuter, eastOuter + rampRun, rise, 20, mat.darkStoneRampMark);
  rampGrooves(g, south, columnNorth, westOuter, westOuter - rampRun, rise, 20, mat.darkStoneRampMark);
}

// 踏步前沿两道防滑线，收细，颜色接近石面，避免白线打眼。
function treadLines(
  parent: THREE.Object3D,
  x0: number, x1: number, y: number, zFront: number,
  material: THREE.Material,
) {
  const lines = new THREE.Group();
  lines.name = "台阶防滑线";
  parent.add(lines);
  const cx = (x0 + x1) / 2;
  const w = x1 - x0 - 60;
  for (const back of [40, 70])
    box(lines, cx, y + 3, zFront + back, w, 6, 8, material, false);
}

// 防滑条横着拦住坡向，沿坡面略高出石面。
function rampGrooves(
  parent: THREE.Object3D,
  z0: number, z1: number, xHigh: number, xLow: number, yHigh: number, yLow: number,
  material: THREE.Material,
) {
  const g = new THREE.Group();
  g.name = "坡道防滑条";
  parent.add(g);
  const run = xLow - xHigh;
  const spacing = 300;
  const bar = 20;
  const lift = 5;
  const zA = Math.min(z0, z1) + 80;
  const zB = Math.max(z0, z1) - 80;
  const yAt = (x: number) => yHigh + ((x - xHigh) / run) * (yLow - yHigh);
  const dir = Math.sign(run);
  for (let traveled = 280; traveled < Math.abs(run) - 180; traveled += spacing) {
    const xA = xHigh + dir * traveled;
    const xB = xA + dir * bar;
    const topA = yAt(xA) + lift;
    const topB = yAt(xB) + lift;
    const positions: number[] = [];
    const uvs: number[] = [];
    const along = xB - xA;
    pushQuad(positions, uvs, [xA, topA, zA], [xB, topB, zA], [xB, topB, zB], [xA, topA, zB], [0, 1, 0]);
    pushQuad(positions, uvs, [xA, topA - lift, zA], [xA, topA - lift, zB], [xB, topB - lift, zB], [xB, topB - lift, zA], [0, -1, 0]);
    pushQuad(positions, uvs, [xA, topA, zA], [xA, topA, zB], [xA, topA - lift, zB], [xA, topA - lift, zA], [-along, 0, 0]);
    pushQuad(positions, uvs, [xB, topB, zA], [xB, topB - lift, zA], [xB, topB - lift, zB], [xB, topB, zB], [along, 0, 0]);
    pushQuad(positions, uvs, [xA, topA, zA], [xA, topA - lift, zA], [xB, topB - lift, zA], [xB, topB, zA], [0, 0, -1]);
    pushQuad(positions, uvs, [xA, topA, zB], [xB, topB, zB], [xB, topB - lift, zB], [xA, topA - lift, zB], [0, 0, 1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
}

function faceUv(p: number[], outward: number[]) {
  if (Math.abs(outward[0]) >= Math.abs(outward[1]) && Math.abs(outward[0]) >= Math.abs(outward[2]))
    return [p[2], p[1]];
  if (Math.abs(outward[1]) >= Math.abs(outward[2])) return [p[0], p[2]];
  return [p[0], p[1]];
}
function pushQuad(
  positions: number[], uvs: number[],
  a: number[], b: number[], c: number[], d: number[], outward: number[],
) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const facing = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] >= 0;
  const pts = facing ? [a, b, c, a, c, d] : [a, d, c, a, c, b];
  for (const p of pts) {
    positions.push(...p);
    uvs.push(...faceUv(p, outward));
  }
}

function wedgeAlongX(
  parent: THREE.Object3D,
  z0: number, z1: number, xHigh: number, xLow: number, yHigh: number, yLow: number,
  material: THREE.Material,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const xOut = xHigh - xLow;
  pushQuad(positions, uvs, [xHigh, yHigh, z0], [xHigh, yHigh, z1], [xLow, yLow, z1], [xLow, yLow, z0], [0, 1, 0]);
  pushQuad(positions, uvs, [xHigh, 0, z0], [xLow, 0, z0], [xLow, 0, z1], [xHigh, 0, z1], [0, -1, 0]);
  pushQuad(positions, uvs, [xHigh, yHigh, z0], [xHigh, 0, z0], [xHigh, 0, z1], [xHigh, yHigh, z1], [xOut, 0, 0]);
  pushQuad(positions, uvs, [xLow, yLow, z0], [xLow, yLow, z1], [xLow, 0, z1], [xLow, 0, z0], [-xOut, 0, 0]);
  pushQuad(positions, uvs, [xHigh, yHigh, z0], [xLow, yLow, z0], [xLow, 0, z0], [xHigh, 0, z0], [0, 0, z0 - z1]);
  pushQuad(positions, uvs, [xHigh, yHigh, z1], [xHigh, 0, z1], [xLow, 0, z1], [xLow, yLow, z1], [0, 0, z1 - z0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// 水包砂横槽：上下每隔 0.45 米一道，颜色贴近白麻墙，只做出凹陷。窗门和角柱处断开。
const groovePitch = 450;

/** 角柱避让盒：随主楼外包络平移。三楼前角装饰柱已删，不再避让退台前角，横槽绕到直角。 */
function columnKeepOutBoxes(): [number, number, number, number][] {
  const mx = site.main.x;
  const mz = site.main.z;
  const mw = site.main.w;
  const rear = mz + site.main.d;
  return [
    [mx - 200, mx + 680, mz - 340, mz + 450],
    [mx + mw - 440, mx + mw + 340, mz - 340, mz + 450],
    [mx - 220, mx + 580, rear - 580, rear + 220],
    [mx + mw - 580, mx + mw + 220, rear - 580, rear + 220],
  ];
}

/** 立面装饰相对默认前墙 Z=-1 的世界坐标：`site.main.z + (旧绝对值 + 1)`。 */
function frontDecorZ(legacyZ: number) {
  return site.main.z + (legacyZ + 1000);
}

function grooveYs(y0: number, y1: number, includeTop: boolean, hardMax = Infinity) {
  // hardMax：下沿线以上不再画水包砂横槽（檐下空档只留梁托，不要多一道线）。
  const limit = Math.min(includeTop ? y1 + 1 : y1 - 120, hardMax);
  const ys: number[] = [];
  for (let i = 1; i < 48; i++) {
    const y = Math.round(i * groovePitch * 1000) / 1000;
    if (y <= y0 + 60) continue;
    if (y > limit) break;
    ys.push(y);
  }
  return ys;
}

function subtractIntervals(span: [number, number], cuts: [number, number][]) {
  let parts: [number, number][] = [span];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [a0, a1] of parts) {
      if (c1 <= a0 + 0.1 || c0 >= a1 - 0.1) {
        next.push([a0, a1]);
        continue;
      }
      if (c0 > a0 + 20) next.push([a0, Math.min(c0, a1)]);
      if (c1 < a1 - 20) next.push([Math.max(c1, a0), a1]);
    }
    parts = next;
  }
  return parts.filter(([a, b]) => b - a >= 160);
}

function keepOutOnWall(ax: number, az: number, bx: number, bz: number, box: [number, number, number, number]) {
  const [x0, x1, z0, z1] = box;
  const len = Math.hypot(bx - ax, bz - az);
  if (Math.abs(bz - az) < 0.1) {
    const z = az;
    if (z < z0 || z > z1) return null;
    const forward = ax <= bx;
    const lo = Math.max(Math.min(ax, bx), x0);
    const hi = Math.min(Math.max(ax, bx), x1);
    if (hi - lo < 20) return null;
    const s0 = forward ? lo - ax : ax - hi;
    const s1 = forward ? hi - ax : ax - lo;
    return [Math.max(0, s0), Math.min(len, s1)] as [number, number];
  }
  if (Math.abs(bx - ax) < 0.1) {
    const x = ax;
    if (x < x0 || x > x1) return null;
    const forward = az <= bz;
    const lo = Math.max(Math.min(az, bz), z0);
    const hi = Math.min(Math.max(az, bz), z1);
    if (hi - lo < 20) return null;
    const s0 = forward ? lo - az : az - hi;
    const s1 = forward ? hi - az : az - lo;
    return [Math.max(0, s0), Math.min(len, s1)] as [number, number];
  }
  return null;
}

function sandGrooves(
  parent: THREE.Object3D,
  walls: { a: Point; b: Point; base: number; height: number; openings: Opening[]; includeTop: boolean }[],
  interior: Point,
  mat: Mats,
  avoidColumns: boolean,
  /** 绝对标高上限：超过则不画横槽（用于压在下沿线以下）。 */
  hardMaxY = Infinity,
) {
  const g = new THREE.Group();
  g.name = "水包砂凹槽";
  parent.add(g);
  const groove = mat.sand.clone();
  groove.color.set(0xd0cbc0);
  groove.roughness = 1;
  for (const wall of walls) {
    const [ax, az] = wall.a;
    const [bx, bz] = wall.b;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 300) continue;
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
    const face = 125;
    const alongX = Math.abs(dx) >= Math.abs(dz);
    for (const y of grooveYs(wall.base, wall.base + wall.height, wall.includeTop, hardMaxY)) {
      const localY = y - wall.base;
      const cuts: [number, number][] = [];
      for (const opening of wall.openings) {
        const y0 = opening.sill;
        const y1 = opening.span === "lower" ? wall.height : opening.sill + opening.h;
        if (localY + 12 < y0 || localY - 12 > y1) continue;
        cuts.push([opening.at - opening.w / 2 - 100, opening.at + opening.w / 2 + 100]);
      }
      {
        const band = eastTransomBand();
        if (az < site.main.z + 500 && bz < site.main.z + 500 && y > band.bottom && y < band.top)
          for (const opening of wall.openings)
            if (opening.pattern === "villa")
              cuts.push([opening.at - band.width / 2 - 120, opening.at + band.width / 2 + 120]);
      }
      if (avoidColumns)
        for (const keep of columnKeepOutBoxes()) {
          const hit = keepOutOnWall(ax, az, bx, bz, keep);
          if (hit) cuts.push(hit);
        }
      for (const [s0, s1] of subtractIntervals([50, len - 50], cuts)) {
        const t = (s0 + s1) / 2;
        box(
          g,
          ax + ux * t + nx * face,
          y,
          az + uz * t + nz * face,
          alongX ? s1 - s0 : 8,
          13,
          alongX ? 8 : s1 - s0,
          groove,
          false,
        );
      }
    }
  }
}

// 烤火房一二层之间：白底横披，中间一道回纹，上下各一条线脚。
function eastMeanderBand(parent: THREE.Object3D, mat: Mats) {
  const g = new THREE.Group();
  g.name = "烤火房回纹横披";
  parent.add(g);
  const x = mainFrontOpeningX(11150);
  const { bottom, top, width } = eastTransomBand();
  const y = (bottom + top) / 2;
  const h = top - bottom;
  box(g, x, y, frontDecorZ(-1030), width - 100, h, 70, mat.trim);
  // 上下两条离开白板，用没有贴图的细线。贴着石材贴图时会发毛。
  box(g, x, bottom + 50, frontDecorZ(-1090), width - 160, 14, 14, mat.dark);
  box(g, x, top - 50, frontDecorZ(-1090), width - 160, 14, 14, mat.dark);
  meander(g, x - (width - 400) / 2, y + 20, frontDecorZ(-1067), width - 400, mat);
  for (const sign of [-1, 1])
    box(g, x + sign * (width / 2 + 35), y, frontDecorZ(-1060), 70, h, 40, mat.trim);
}

function pavedTerrace(parent: THREE.Object3D, outline: Point[], y: number, thickness: number, mat: Mats) {
  const group = new THREE.Group();
  parent.add(group);
  const finish = 18;
  slab(group, outline, y - finish, thickness - finish, mat.trim);
  const paving = slab(group, outline, y, finish, mat.terrace);
  const positions = paving.geometry.getAttribute("position"), normals = paving.geometry.getAttribute("normal");
  const uv = paving.geometry.getAttribute("uv");
  const uvOriginX = site.main.x + site.main.w / 2 - 300;
  for (let i = 0; i < positions.count; i++) if (normals.getY(i) > 0.5)
    uv.setXY(i, positions.getX(i) - uvOriginX, positions.getZ(i) - frontElevation.terraceFront);
  uv.needsUpdate = true;
  paving.castShadow = false;
  return group;
}

/** 平面草稿驱动立体时的布局覆盖（隔墙／家具／挑空／楼梯）。 */
export type VillaLayoutLive = {
  floors: Floor[];
  annexPartitions: Wall[];
  annexFurniture: Furniture[];
  stairLayout: StairDraft;
  livingVoid: VoidDraft;
  portico?: PorticoDraft;
  exteriorOpenings?: ExteriorOpeningDraft[];
  exteriorManaged?: boolean;
  sideDoorZ?: number;
  sideDoorWidth?: number;
};

export type VillaModel = {
  group: THREE.Group;
  levels: THREE.Group[];
  roof: THREE.Group;
  balcony: THREE.Group;
  annex: THREE.Group;
  annexRoof: THREE.Group;
  /** 顶板与瓦屋面独立，关闭屋顶时仍保留建筑封顶。 */
  topSlabs: { main: THREE.Group; annex: THREE.Group };
  portico: THREE.Group;
  labels: THREE.Group[];
  /** 字符串是构建当时的快照，不受后续原地编辑草稿影响。 */
  signatures: { structure: string; levels: string[]; annex: string; front: string };
};

export function villaLayoutFromDraft(draft: LayoutDraft): VillaLayoutLive {
  // 层高／三楼前缘以当前已应用的 floors 为准，防止旧草稿盖掉尺寸设置。
  return {
    floors: draft.floors.map((floor, i) => {
      const live = floors[i];
      if (!live) return floor;
      return { ...floor, y: live.y, height: live.height, front: live.front };
    }),
    annexPartitions: draft.annexPartitions,
    annexFurniture: draft.annexFurniture,
    stairLayout: draft.stairLayout,
    livingVoid: draft.livingVoid,
    portico: draft.portico,
    exteriorOpenings: draft.exteriorOpenings,
    exteriorManaged: draft.exteriorManaged,
    sideDoorZ: draft.sideDoorZ,
    sideDoorWidth: draft.sideDoorWidth,
  };
}

/** 现有立面细部依赖共享尺寸；只在同步构建期间覆盖，返回前恢复参数事实源。 */
function withLayoutContext<T>(layout: VillaLayoutLive | null | undefined, build: () => T): T {
  const porch = { ...site.portico }, elevation = { ...frontElevation };
  const sideDoor = { z: circulation.sideDoorZ, width: circulation.sideDoorWidth };
  try {
    if (layout?.portico) {
      const p = layout.portico;
      const resolved = porticoElevation(p);
      Object.assign(site.portico, p);
      Object.assign(frontElevation, resolved);
    }
    if (layout?.sideDoorZ != null) circulation.sideDoorZ = layout.sideDoorZ;
    if (layout?.sideDoorWidth != null) circulation.sideDoorWidth = layout.sideDoorWidth;
    return build();
  } finally {
    Object.assign(site.portico, porch);
    Object.assign(frontElevation, elevation);
    circulation.sideDoorZ = sideDoor.z;
    circulation.sideDoorWidth = sideDoor.width;
  }
}

export { frontOpeningsChanged } from "./facade-layout";
export function villaLayoutFacades(index: number, layout?: VillaLayoutLive | null) {
  return resolveLayoutFacades(layout).facades[index];
}

export function buildVilla(
  mat: Mats,
  withLabels = true,
  fenShui = site.roofFenShui,
  roofStyle: RoofStyle = DEFAULT_ROOF_STYLE,
  layout?: VillaLayoutLive | null,
  reuse?: VillaModel,
): VillaModel {
  return withLayoutContext(layout, () => buildVillaInContext(mat, withLabels, fenShui, roofStyle, layout, reuse));
}

function buildVillaInContext(
  mat: Mats, withLabels: boolean, fenShui: number, roofStyle: RoofStyle,
  layout?: VillaLayoutLive | null, reuse?: VillaModel,
): VillaModel {
  ensureFurnitureWallClearance();
  const floorList = (layout?.floors ?? floors).map(recessedFloor);
  const stairGeom = fitStairToRoom(layout?.stairLayout ?? stairLayout, floorList);
  const stairPresent = floorsHaveStair(floorList);
  const livingVoid = layout?.livingVoid ?? circulation.livingVoid;
  const annexParts = (layout?.annexPartitions ?? annexPartitions).filter(isPhysicalWall);
  const annexFurn = layout?.annexFurniture ?? annexFurniture;
  const resolved = resolveLayoutFacades(layout);
  const layoutFacades = resolved.facades;
  const railings = interiorRailingLayout(floorList, stairGeom, livingVoid, layoutFacades, stairPresent);
  const customFront = frontOpeningsChanged(layout);
  const topSlabLayout = roofSlabLayout(layout);
  const signatures: VillaModel["signatures"] = {
    structure: JSON.stringify([site, roofGutterDesign, eaveTrimDesign, annexRoofGutterDesign, annexEaveTrimDesign, floatingHatDesign, frontElevation, construction, circulation, floors.map(f => [f.y, f.height, f.front]), topSlabLayout, fenShui, roofStyle]),
    levels: floorList.map((floor, index) => JSON.stringify([
      floor, withLabels, stairPresent, stairGeom, index === 1 ? livingVoid : null, layoutFacades[index], index < 2 && customFront, interiorRailing, railings.floorSignature(index),
    ])),
    annex: JSON.stringify([annexParts, annexFurn, layoutFacades[3]]),
    front: JSON.stringify([customFront, layoutFacades[0][0].openings, layoutFacades[1][0].openings, resolved.glazing, resolved.entries]),
  };
  const reuseStatic = reuse?.signatures.structure === signatures.structure;
  if (reuseStatic && JSON.stringify(reuse!.signatures) === JSON.stringify(signatures)) return reuse!;
  const group = new THREE.Group(),
    roof = reuseStatic ? reuse!.roof : new THREE.Group(),
    balcony = reuseStatic ? reuse!.balcony : new THREE.Group(),
    annex = reuseStatic && reuse!.signatures.annex === signatures.annex ? reuse!.annex : new THREE.Group(),
    annexRoof = reuseStatic ? reuse!.annexRoof : new THREE.Group();
  const topSlabs = reuseStatic ? reuse!.topSlabs : { main: new THREE.Group(), annex: new THREE.Group() };
  if (!reuseStatic) {
    for (const key of ["main", "annex"] as const) {
      const spec = topSlabLayout[key], root = topSlabs[key];
      root.name = key === "main" ? "主楼三层顶板" : "辅楼一层顶板";
      slab(root, spec.outline, spec.top, spec.thickness, mat.trim).name = `${root.name}实体`;
    }
  }
  const levels: THREE.Group[] = [];
  const labels: THREE.Group[] = [];
  const m = site.main;
  const elevation = frontElevation;
  floorList.forEach((floor, index) => {
    if (reuseStatic && reuse!.signatures.levels[index] === signatures.levels[index]) {
      levels.push(reuse!.levels[index]);
      labels.push(reuse!.labels[index]);
      return;
    }
    const g = new THREE.Group();
    g.name = `floor-${index + 1}`;
    levels.push(g);
    group.add(g);
    const front = floor.front,
      back = m.z + m.d,
      base = floor.y,
      h = floor.height;
    const opening = stairOpeningBounds(stairGeom);
    const holes =
      stairPresent && index > 0 ? [rect(opening.x, opening.z, opening.w, opening.d)] : [];
    const hasLivingVoid = livingVoid.w > 0 && livingVoid.d > 0;
    // 楼板外缘收进墙身。三楼北缘若停在 Z=-1，会和二楼北墙外皮共面，缩放时闪成黄带。
    const inset = 50;
    // 侧面再收一些，楼板边不要贴到角柱侧面。
    const sideInset = 160;
    // 正中门洞里能看到二楼楼板北缘，正面是一条黄带。这里把楼板收到斜纹板后面。
    const doorAt = site.portico.x + site.portico.w / 2 - m.x;
    const doorW = 2300 * (m.w / 13500);
    const doorNotchWest = m.x + doorAt - doorW / 2;
    const doorNotchEast = m.x + doorAt + doorW / 2;
    const doorNotchZ = frontDecorZ(-720);
    const outline =
      index === 1
        ? ([
            [m.x + sideInset, front + inset],
            [doorNotchWest, front + inset],
            [doorNotchWest, doorNotchZ],
            [doorNotchEast, doorNotchZ],
            [doorNotchEast, front + inset],
            [m.x + m.w - sideInset, front + inset],
            [m.x + m.w - sideInset, back - inset],
            [m.x + sideInset, back - inset],
          ] as [number, number][])
        : index === 2
          ? rect(m.x + sideInset, front + 60, m.w - 2 * sideInset, back - 50 - (front + 60))
          : rect(
              m.x + sideInset,
              front + inset,
              m.w - 2 * sideInset,
              back - front - 2 * inset,
            );
    // 一层完成面比院坪高三步。关掉房子后铺装仍在 ±0，不会和楼板叠在同一高度上闪。
    const floorOutline = recessedPortico() ? recessedFootprint(front, sideInset) : (mirroredBuildings() && index === 1 ? outline.map(([x, z]) => [m.x * 2 + m.w - x, z] as Point).reverse() : outline);
    if (index === 1 && hasLivingVoid) {
      // 任意位置、跨开间及贴外墙的洞口统一扣除，楼梯洞相交也不重复铺板。
      const cuts = [...holes, rect(livingVoid.x - inset, livingVoid.z - inset, livingVoid.w + inset * 2, livingVoid.d + inset * 2)];
      const floorSlab = new THREE.Mesh(orthogonalFloorGeometry([floorOutline], cuts, base, construction.floorSlab, true), mat.floor);
      floorSlab.name = "二楼楼板";
      floorSlab.castShadow = floorSlab.receiveShadow = true;
      g.add(floorSlab);
    } else slab(g, floorOutline, base + (index === 0 ? site.entranceRise : 0), construction.floorSlab, mat.floor, holes)
      .name = index === 0 ? "一楼楼板" : "三楼楼板";
    const floorWalls = layoutFacades[index];
    const wallPeers = wallJunctionPeers(floor.partitions, floorWalls);
    for (const facade of floorWalls)
      wallWithOpenings(g, facade.a, facade.b, base, h, facade.openings, mat, construction.outsideWall, false, mat.sand, joinedWallSpan(facade, wallPeers).join);
    // 三楼下沿线以上（梁托空档）不再画水包砂横槽，避免檐下多一道细线。
    const grooveCap = index === 2
      ? fasciaBottomY(mainRoofFootprint().eave, 0) - 20
      : Infinity;
    sandGrooves(
      g,
      // 三楼正面已取消包角柱，窗侧也不保留零碎横槽；两侧房间统一为素墙。
      floorWalls.filter((_, facadeIndex) => index !== 2 || facadeIndex !== 0).map((facade) => ({
        a: facade.a,
        b: facade.b,
        base,
        height: h,
        openings: facade.openings,
        includeTop: index < 2,
      })),
      [m.x + m.w / 2, m.z + m.d / 2],
      mat,
      true,
      grooveCap,
    );
    if (index === 2) {
      const sideTerraces = hasThirdFloorSideTerraces();
      const terracePosts = frontTerracePosts();
      // 两侧楼板仍接到门厅楼板边，不往前加长。中间仍由墙隔开。
      if (sideTerraces) elevation.sideTerraces.forEach((terrace, i) => {
        pavedTerrace(g, rect(terrace.x, elevation.terraceFront, terrace.w, (floor.front + 40) - elevation.terraceFront), base, 180, mat)
          .name = i === 0 ? "三楼左侧露台" : "三楼右侧露台";
      });
      // 平台北缘让进檐口。南缘收到三楼前墙外，不并入两侧露台。
      pavedTerrace(
        g,
        rect(site.portico.x, elevation.centerFront, site.portico.w, elevation.terraceBack - elevation.centerFront),
        base,
        220,
        mat,
      ).name = "外伸门厅三楼平台";
      const shortPosts = new THREE.Group();
      shortPosts.name = sideTerraces ? "四根露台短柱" : "中央露台两根短柱";
      g.add(shortPosts);
      // 四根短柱立在 50 厘米挡墙顶上：中间两根与门厅柱同轴，两侧外皮对齐包角柱。
      const parapet = elevation.eaveParapet;
      const postBase = base + parapet;
      for (const post of terracePosts) {
        const central = post.x >= site.portico.x && post.x <= site.portico.x + site.portico.w;
        balconyCornerPost(shortPosts, post.x, post.z, postBase, elevation.balustradePostHeight, post.w, mat, base,
          central ? porticoColumnOuterWidth(post.w) : Infinity);
      }
      for (const run of frontTerraceRailRuns(floor.front))
        glassBalustrade(g, run.a, run.b, postBase, mat, false, run);
      const west = elevation.sideTerraces[0].x;
      const east = elevation.sideTerraces[1].x + elevation.sideTerraces[1].w;
      const centerWest = site.portico.x, centerEast = site.portico.x + site.portico.w;
      const front = elevation.terraceFront, centerFront = elevation.centerFront;
      const back = sideTerraces ? elevation.terraceBack : floor.front + 40;
      const eave = site.secondFrontEave;
      const inner: Point[] = [
        [west, back], [west, front], [centerWest, front], [centerWest, centerFront],
        [centerEast, centerFront], [centerEast, front], [east, front], [east, back],
      ];
      const outer: Point[] = [
        [west - eave, back], [west - eave, front - eave], [centerWest - eave, front - eave], [centerWest - eave, centerFront - eave],
        [centerEast + eave, centerFront - eave], [centerEast + eave, front - eave], [east + eave, front - eave], [east + eave, back],
      ];
      // 屋檐里有一道比露台地面高 50 厘米的墙。瓦从墙顶往外坡下，把这道墙挡住。
      const parapetWall = new THREE.Group();
      parapetWall.name = "三楼屋檐内50厘米挡墙";
      g.add(parapetWall);
      const parapetThick = apronEaveDesign.parapetThickness;
      const parapetInside: Point[] = inner.map((p, i) => [
        p[0] - (outer[i][0] - p[0]) * parapetThick / eave,
        p[1] - (outer[i][1] - p[1]) * parapetThick / eave,
      ]);
      // 用一条完整折线墙替代相互搭叠的盒子，阴阳角均不向瓦面伸出。
      if (sideTerraces) slab(parapetWall, [...inner, ...parapetInside.reverse()], base + parapet, parapet, mat.sand);
      else slab(parapetWall, rect(centerWest, centerFront, site.portico.w, parapetThick), base + parapet, parapet, mat.sand);
      // 中间露台的侧挡墙连续接到后方官帽柱，返段栏杆下面不能只剩空气。
      for (const x of [centerWest, centerEast - parapetThick])
        slab(parapetWall, rect(x, sideTerraces ? front : centerFront, parapetThick, elevation.postZ - 250 - (sideTerraces ? front : centerFront)),
          base + parapet, parapet, mat.sand).name = "门厅露台侧挡墙接官帽柱";
      // 外沿平面位置不动。落差只用原来的檐坡，外沿跟着抬高，不再为了盖住挡墙把坡拉陡。
      tiledApron(g, inner, outer, base + parapet, elevation.tiledEaveDrop, mat,
        terracePosts.map(post => {
          const footWidth = post.w + 80;
          return rect(post.x - footWidth / 2, post.z - footWidth / 2, footWidth, footWidth);
        }), base, [m.x - construction.outsideWall / 2, m.x + m.w + construction.outsideWall / 2]);
      // 门边踢脚与墙相接，三块露台共用砖缝尺度和同一铺贴坐标。
      const doorCuts: [number, number][] = floorWalls[0].openings.map(o => [m.x + o.at - o.w / 2 - 60, m.x + o.at + o.w / 2 + 60]);
      for (const terrace of [...(sideTerraces ? elevation.sideTerraces : []), { x: site.portico.x, w: site.portico.w }])
        for (const [x0, x1] of subtractIntervals([terrace.x, terrace.x + terrace.w], doorCuts))
          box(g, (x0 + x1) / 2, base + 55, floor.front + 3,
            x1 - x0, 110, 18, mat.terraceEdge, false);
    }
    // 隔墙画到外皮时，端头和外围墙面共面，外面会看到一条白竖线。端头埋进墙身 2cm。
    const embed = 220;
    const bury = (p: [number, number]): [number, number] => {
      let [x, z] = p;
      if (Math.abs(x - m.x) <= 20) x = m.x + embed;
      else if (Math.abs(x - (m.x + m.w)) <= 20) x = m.x + m.w - embed;
      if (Math.abs(z - front) <= 20) z = front + embed;
      else if (Math.abs(z - back) <= 20) z = back - embed;
      return [x, z];
    };
    const stairStoryH = h - (index === 0 ? site.entranceRise : 0);
    const stairSoffit = {
      model: stairGeom.model,
      middleTread: stairGeom.middleTread,
      x: stairGeom.x,
      z: stairGeom.z,
      flight: stairGeom.flight,
      gap: stairGeom.gap,
      tread: stairGeom.tread,
      risers: stairGeom.risers,
      landing: stairGeom.landing,
      axis: stairGeom.axis,
      lowerSide: stairGeom.lowerSide,
      direction: stairGeom.direction,
      room: stairGeom.room,
    };
    for (const part of floor.partitions) {
      if (!isPhysicalWall(part)) continue;
      const span = joinedWallSpan(part, wallPeers);
      const a = bury(span.a), b = bury(span.b);
      const length = Math.hypot(part.b[0] - part.a[0], part.b[1] - part.a[1]);
      const pulled = length ? ((a[0] - part.a[0]) * (part.b[0] - part.a[0]) + (a[1] - part.a[1]) * (part.b[1] - part.a[1])) / length : 0;
      const profile = partitionProfile(part, stairStoryH, stairPresent && index < floorList.length - 1 ? stairSoffit : undefined);
      const opening = profile.opening;
      const op: Opening[] = opening
        ? [
            {
              at: opening.offset - pulled + opening.width / 2,
              w: opening.width,
              sill: opening.sill,
              h: opening.height,
              door: opening.door,
              hinge: opening.hinge,
              side: opening.side,
              kind: opening.kind,
            },
          ]
        : [];
      const wallThick =
        wallRoleOf(part) === "bearing" ? construction.outsideWall : construction.partition;
      wallWithOpenings(g, a, b, base + (index === 0 ? site.entranceRise : 0), profile.height, op, mat, wallThick, true);
    }
    floor.furniture.forEach((f, furnitureIndex) => {
      const model = furnish(g, f, base + (index === 0 ? site.entranceRise : 0), mat);
      model.userData.layoutSelection = { kind: "furniture", floor: index, index: furnitureIndex };
    });
    const labelGroup = new THREE.Group();
    labelGroup.visible = false;
    g.add(labelGroup);
    labels.push(labelGroup);
    for (const room of withLabels ? floor.rooms : []) {
      const [x, z] = room.label ?? [room.x + room.w / 2, room.z + room.d / 2];
      tag(
        labelGroup,
        room.name,
        x,
        base + 700,
        z,
        "#284b3b",
        room.kind === "bath" ? 0.36 : 0.58,
      );
    }
    if (stairPresent && index < 2)
      stairs(
        g, stairGeom.x, stairGeom.z,
        base + (index === 0 ? site.entranceRise : 0),
        h - (index === 0 ? site.entranceRise : 0),
        mat,
        stairGeom.axis,
        stairGeom,
        false,
      );
    railings.render(g, railings.stories[index]);
    if (stairPresent && index > 0) {
      // 单层剖看仍显示下层通来的实体梯段；全楼与分离视图关闭，避免重叠。
      const incoming = new THREE.Group();
      incoming.userData.incomingStair = true;
      incoming.visible = false;
      const prev = floorList[index - 1];
      const riseBase = index === 1 ? site.entranceRise : 0;
      stairs(incoming, stairGeom.x, stairGeom.z, prev.y + riseBase,
        prev.height - riseBase, mat, stairGeom.axis, stairGeom, false);
      railings.render(incoming, railings.stories[index - 1]);
      g.add(incoming);
    }
    if (index === 1) {
      const guard = new THREE.Group(); guard.name = "挑空自动栏杆"; g.add(guard);
      railings.render(guard, railings.livingGuards[index]);
    }
    if (stairPresent && index > 0) {
      railings.render(g, railings.stairGuards[index]);
    }
    if (index === 0 && !customFront) {
      const sw = site.main.w / 13500;
      const transom = eastTransomBand();
      for (const [at0, w0] of [
        [FRONT_OPENING.livingVoid.at, 4200],
        [FRONT_OPENING.tea.at, 3000],
      ] as const)
        box(g, mainFrontOpeningX(at0), 220, frontDecorZ(-1080), w0 * sw, 440, 140, mat.stone);
      openingFrame(
        g,
        mainFrontOpeningX(FRONT_OPENING.tea.at),
        FRONT_OPENING.tea.sill,
        frontDecorZ(-1060),
        transom.width,
        FRONT_OPENING.tea.h,
        mat,
        { top: false },
      );
    }
    if (index === 1 && !customFront) {
      const transom = eastTransomBand();
      const sideHead = secondFloorSideGlassHeadY();
      openingFrame(
        g,
        mainFrontOpeningX(FRONT_OPENING.tea.at),
        transom.top,
        frontDecorZ(-1060),
        transom.width,
        sideHead - transom.top + 40,
        mat,
        { bottom: false },
      );
    }
    if (index === 2) {
      // 三楼采用下层同系列的轻量包角；柱冠停在连续下沿线底。
      const eaveY = mainRoofFootprint().eave;
      const upperCornerTop = fasciaBottomY(eaveY, 0);
      for (const [x, outward] of [[elevation.cornerWestX, -1], [elevation.cornerEastX, 1]])
        referenceUpperCornerPilaster(g, x, floor.front, base, upperCornerTop - base, outward, mat);
      // 悬浮官帽檐口更高，柱身与正面装饰随其上抬；原有官帽仍贴正屋檐口。
      const hatLayout = roofStyle === "floating" ? floatingHatLayout(fenShui) : joinedHatLayout(fenShui);
      const hatEaveY = hatLayout.eave;
      const fasciaBot = fasciaBottomY(hatEaveY, 0);
      // 柱盖收至下沿线底，避免遮挡连续线脚及其上方灯带。
      const pierTop = fasciaBot;
      const hatPosts = new THREE.Group();
      hatPosts.name = "三楼官帽柱";
      g.add(hatPosts);
      // 贴前墙官帽柱与门厅柱共用堂屋开间两端的X轴线。
      // 四面雕花采用包角柱同系列，原有／悬浮共用造型。
      for (const x of elevation.postXs)
        recessedHatPier(
          hatPosts,
          x,
          elevation.postZ,
          base,
          pierTop - base,
          elevation.dividerWidth,
          mat,
        );
      // 装饰框与洞口同高：玻璃上沿压在下沿线以下，不穿进梁托区。
      const thirdHead = thirdFloorMaxOpeningHead(eaveY);
      const sw = site.main.w / 13500;
      if (!frontOpeningsChanged(layout, [2])) {
        const wingSill = hasThirdFloorSideTerraces() ? 0 : 900;
        const wingHead = hasThirdFloorSideTerraces() ? thirdHead : Math.min(thirdHead, 2700) - wingSill;
        openingFrame(g, mainFrontOpeningX(2350), base + wingSill, front - 70, 3200 * sw, wingHead, mat, { bottom: !hasThirdFloorSideTerraces() });
        openingFrame(g, mainFrontOpeningX(11150), base + wingSill, front - 70, 2750 * sw, wingHead, mat, { bottom: !hasThirdFloorSideTerraces() });
        openingFrame(g, site.portico.x + site.portico.w / 2, base, porticoWallZ(front) - 70, 3100 * sw, Math.min(2550, thirdHead), mat, { bottom: false });
      }
      // 回纹贴在官帽实际承托梁的下沿线，纹高收进线脚；不再浮在后方门窗上方。
      const fasciaMid = fasciaBot + eyelidFixed.fasciaHeight / 2;
      const hatWest = hatLayout.x;
      const supportInset = hatSupportInset();
      meander(g, hatWest + supportInset + 120, fasciaMid,
        frontElevation.hatFront + supportInset - eyelidFixed.fasciaProtrusion,
        hatLayout.w - 2 * supportInset - 240, mat, 70);
    }
    // 屋后一二层、二三层交界的白条已去掉。三楼檐口下这一道留在瓦下。
    if (index === 2)
      box(g, m.x + m.w / 2, base + h - 160, back + 20, m.w + 60, 170, 160, mat.trim);
  });
  const portico = reuseStatic ? reuse!.portico : new THREE.Group();
  portico.name = recessedPortico() ? "凹入式通高门厅" : "凸出式通高门厅";
  const porchFront = porticoFrontZ();
  if (!reuseStatic) {
    const columnZ = elevation.porticoColumnZ;
    const columnNorth = columnZ - elevation.porticoColumnDepth / 2;
    const apron = frontApronSection(floorList[2]!.y + elevation.eaveParapet, elevation.tiledEaveDrop);
    // 保留原雕花柱帽；上加外展斜肩止于下沿线底，不进入梁托空档。
    const capitalTop = apron.columnTopY;
    const fasciaBot = apron.fasciaBottomY;
    for (const post of elevation.balustradePosts.slice(1, 3)) {
      const x = post.x;
      const columnBase = site.entranceRise - 20;
      referencePorticoColumn(portico, x, columnZ, columnBase, capitalTop - columnBase, post.w, elevation.porticoColumnDepth, mat);
      const shoulder = new THREE.Group();
      shoulder.name = "门厅柱外展斜肩";
      shoulder.position.set(x, 0, columnZ);
      portico.add(shoulder);
      columnProfileMeshes(shoulder, porticoShoulderProfile(post.w, elevation.porticoColumnDepth, capitalTop, fasciaBot), mat);
      box(portico, x, 2850, columnNorth - 50, 220, 900, 170, mat.dark);
      box(portico, x, 2850, columnNorth - 145, 150, 730, 25, mat.gold);
      for (const dx of [-50, 50])
        box(portico, x + dx, 2850, columnNorth - 166, 12, 720, 16, mat.dark);
    }
    // 左右包角柱包住正面与侧面的直角；外凸量＝方案尺寸「包角柱突出墙面」。
    // 两侧包角柱用同系列外展斜肩；下沿线及梁托连续绕过，侧线南端与瓦檐齐平。
    const frontCornerTop = apron.columnTopY;
    referenceCornerPilaster(portico, elevation.cornerWestX, m.z - 120, 0, frontCornerTop, -1, mat, apron.fasciaBottomY);
    referenceCornerPilaster(portico, elevation.cornerEastX, m.z - 120, 0, frontCornerTop, 1, mat, apron.fasciaBottomY);
    // 屋后两根贴墙外角；柱顶对正屋环形天沟下沿线，同样留约10厘米。
    const rearZ = m.z + m.d;
    const rearCornerTop = cornerPilasterTopY(mainRoofFootprint().eave);
    cornerPilaster(portico, m.x, rearZ, 0, rearCornerTop, mat, -1, 1);
    cornerPilaster(portico, m.x + m.w, rearZ, 0, rearCornerTop, mat, 1, 1);
    referencePorticoBeam(portico, site.portico.x + site.portico.w / 2,
      columnZ - PORTICO_BEAM_DEPTH / 2, fasciaBot,
      elevation.balustradePosts[2].x - elevation.balustradePosts[1].x, elevation.balustradePosts[1].w, mat);
    entranceApproach(portico, mat);
  }
  if (levels[0] !== reuse?.levels[0]) {
    slab(levels[0], rect(site.portico.x, porchFront, site.portico.w, site.portico.projection), 15, 180, mat.paving).name = "门厅地坪投影计入首层合计";
    slab(levels[0], rect(Math.min(m.x + m.w, site.annex.x + site.annex.w), circulation.sideDoorZ - circulation.sideDoorWidth / 2,
      site.lane, circulation.sideDoorWidth), construction.connectionY, 80, mat.paving)
      .name = "横向过道至辅楼的地面连接";
  }
  if (!reuseStatic) {
    // 浅阳台位于三层公共过厅外，避免直接放在老人房上方。
    const rearBalconyZ = m.z + m.d;
    const rearBalconyY = floorList[2]!.y;
    const rearBalconyX = mainLocalX(m.w * (12650 - 6800) / 13500 + (mirroredBuildings() ? 2500 * m.w / 13500 : 0));
    const rearBalconyW = 2500 * (m.w / 13500);
    pavedTerrace(balcony, rect(rearBalconyX, rearBalconyZ, rearBalconyW, 1200), rearBalconyY, 180, mat);
    railing(balcony, [rearBalconyX + 50, rearBalconyZ + 1150], [rearBalconyX + rearBalconyW - 50, rearBalconyZ + 1150], rearBalconyY, mat);
    railing(balcony, [rearBalconyX + 50, rearBalconyZ], [rearBalconyX + 50, rearBalconyZ + 1150], rearBalconyY, mat);
    railing(balcony, [rearBalconyX + rearBalconyW - 50, rearBalconyZ], [rearBalconyX + rearBalconyW - 50, rearBalconyZ + 1150], rearBalconyY, mat);
    balcony.visible = false;
  }

  if (annex !== reuse?.annex) {
    const a = site.annex;
    const annexH = a.height;
    slab(annex, rect(a.x, a.z, a.w, a.d), site.entranceRise, 180, mat.floor);
    const annexWalls = layoutFacades[3];
    const wallPeers = wallJunctionPeers(annexParts, annexWalls);
    for (const facade of annexWalls)
      wallWithOpenings(annex, facade.a, facade.b, 0, annexH, facade.openings, mat, construction.outsideWall, false, mat.sand, joinedWallSpan(facade, wallPeers).join);
    sandGrooves(
      annex,
      annexWalls.map((facade) => ({
        a: facade.a,
        b: facade.b,
        base: 0,
        height: annexH,
        openings: facade.openings,
        includeTop: false,
      })),
      [a.x + a.w / 2, a.z + a.d / 2],
      mat,
      false,
      withAnnexRoofDesign(() => fasciaBottomY(annexRoofFootprint().eave, 0)) - 20,
    );
    // 隔墙画到外皮时，端头和外围墙面共面，外面会看到一条白竖线（易被当成落水管）。
    // 端头埋进墙身，与主楼隔墙同一处理。
    const annexEmbed = 220;
    const buryAnnex = (p: Point): Point => {
      let [x, z] = p;
      if (Math.abs(x - a.x) <= 20) x = a.x + annexEmbed;
      else if (Math.abs(x - (a.x + a.w)) <= 20) x = a.x + a.w - annexEmbed;
      if (Math.abs(z - a.z) <= 20) z = a.z + annexEmbed;
      else if (Math.abs(z - (a.z + a.d)) <= 20) z = a.z + a.d - annexEmbed;
      return [x, z];
    };
    for (const p of annexParts) {
      const span = joinedWallSpan(p, wallPeers);
      const aa = buryAnnex(span.a), bb = buryAnnex(span.b);
      const length = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
      const pulled = length ? ((aa[0] - p.a[0]) * (p.b[0] - p.a[0]) + (aa[1] - p.a[1]) * (p.b[1] - p.a[1])) / length : 0;
      const profile = partitionProfile(p, annexH - site.entranceRise, undefined, 200), opening = profile.opening;
      wallWithOpenings(annex, aa, bb, site.entranceRise, profile.height,
        opening ? [{ at: opening.offset - pulled + opening.width / 2, w: opening.width, sill: opening.sill, h: opening.height,
          door: opening.door, hinge: opening.hinge, side: opening.side, kind: opening.kind }] : [],
        mat, wallRoleOf(p) === "bearing" ? construction.outsideWall : construction.partition, true);
    }
    annexFurn.forEach((f, index) => {
      const model = furnish(annex, f, site.entranceRise, mat);
      model.userData.layoutSelection = { kind: "furniture", floor: 0, index, annex: true };
    });
  }
  if (!reuseStatic) attachRoofs(roof, annexRoof, mat, fenShui, roofStyle);
  const frontNames = ["挑空客厅一二层通高玻璃", "门厅一二层通高门", "烤火房回纹横披"];
  const reuseFront = reuseStatic && reuse!.signatures.front === signatures.front;
  if (!reuseFront) {
    const curtain = new THREE.Group();
    curtain.name = frontNames[0]; group.add(curtain);
    for (const panel of resolved.glazing) continuousGlazing(curtain, panel, mat.glass, mat.dark);
    const entry = resolved.entries[0];
    if (entry) integratedEntry(group, entry, mat);
    else { const placeholder = new THREE.Group(); placeholder.name = frontNames[1]; group.add(placeholder); }
    if (!customFront) eastMeanderBand(group, mat);
    else { const placeholder = new THREE.Group(); placeholder.name = frontNames[2]; group.add(placeholder); }
  }
  // 所有可能抛错的构造完成后才迁移复用对象，避免构造失败拆掉当前可见场景。
  group.add(roof, balcony, annex, annexRoof, topSlabs.main, topSlabs.annex, portico, ...levels);
  if (reuseFront)
    for (const name of frontNames) { const detail = reuse!.group.getObjectByName(name); if (detail) group.add(detail); }
  return { group, levels, roof, balcony, annex, annexRoof, topSlabs, portico, labels, signatures };
}

/** 屋顶层平面与三维封顶共用范围；楼梯止于三层，顶板不延续下层楼梯／客厅挑空洞。 */
export function roofSlabLayout(layout?: VillaLayoutLive | null) {
  return withLayoutContext(layout, () => {
    const topFloor = recessedFloor((layout?.floors ?? floors)[2]);
    const a = site.annex;
    return {
      main: { outline: recessedFootprint(topFloor.front), top: topFloor.y + topFloor.height, thickness: construction.floorSlab },
      annex: { outline: rect(a.x, a.z, a.w, a.d), top: a.height, thickness: construction.floorSlab },
    };
  });
}

export function attachLayoutRoofs(
  roof: THREE.Object3D, annexRoof: THREE.Object3D, mat: Mats,
  fenShui: number, roofStyle: RoofStyle, layout?: VillaLayoutLive | null,
) {
  return withLayoutContext(layout, () => attachRoofs(roof, annexRoof, mat, fenShui, roofStyle));
}

/**
 * 正屋四坡外包络：四面均出 thirdEave（默认 0.8）。
 * 天沟外缘即尺寸控制线；三眼皮／梁托／下沿线按同一出挑生成，不再分面另定。
 * 注意：site.eave 是辅楼挑出参数，不得再拿来当主楼后檐。
 */
export function mainRoofFootprint() {
  const m = site.main;
  const e = site.thirdEave;
  const z = floors[2].front - e;
  return {
    x: m.x - e,
    z,
    w: m.w + 2 * e,
    d: m.z + m.d + e - z,
    eave: mainEaveY(),
  };
}

/**
 * 辅楼四坡：四面出檐由 site.eave 独立控制；天沟和檐下构件使用辅楼参数。
 */
export function annexRoofFootprint() {
  const a = site.annex;
  const e = site.eave;
  return {
    x: a.x - e,
    z: a.z - e,
    w: a.w + 2 * e,
    d: a.d + 2 * e,
    eave: a.height,
  };
}

export function roofPitch(fenShui: number) {
  const main = mainRoofFootprint();
  const annex = annexRoofFootprint(), profile = annexRoofProfile();
  const annexRun = (Math.min(annex.w, annex.d) - 2 * profile.tileInset) / 2;
  return {
    fenShui, annexFenShui: site.annexRoofFenShui,
    mainRun: (Math.min(main.w, main.d) - 2 * roofTileInset) / 2,
    annexRun,
    mainRise: hipRise(main.w, main.d, fenShui),
    annexRise: annexRun * site.annexRoofFenShui / 10,
  };
}

/** 普通官帽与正屋同檐同脊；前／侧等坡，宽度不受天沟内收挤压。 */
export function joinedHatLayout(fenShui = site.roofFenShui) {
  const main = mainRoofFootprint(), center = site.portico.x + site.portico.w / 2;
  const z = frontElevation.hatFront, joinZ = main.z + main.d / 2;
  // 保留两翼及接脊长度；草稿偏移、窄主楼或深凹入门厅也不能穿出正屋。
  const maxWidth = Math.min(
    2 * Math.min(center - main.x, main.x + main.w - center) - 2 * joinedHatDesign.minWingWidth,
    2 * (joinZ - z - 50),
  );
  const w = Math.min(site.portico.w + joinedHatDesign.tileWidthExtra + 2 * roofTileInset, maxWidth);
  const run = (w - 2 * roofTileInset) / 2;
  return {
    x: center - w / 2, z, w, d: joinZ - z, eave: main.eave,
    peak: main.eave + roofTileEaveLift() + roofPitch(fenShui).mainRise,
    joinZ, ridgeFront: z + roofTileInset + run,
  };
}

export function floatingHatLayout(fenShui = site.roofFenShui) {
  const main = mainRoofFootprint(), pitch = roofPitch(fenShui), slope = fenShui / 10;
  const w = frontElevation.hatWidth, run = (w - 2 * roofTileInset) / 2;
  const tileLift = roofTileEaveLift();
  const levels = floatingHatLevels(pitch.mainRise, run, slope, frontElevation.hatFront - main.z + run,
    floatingHatDesign.heightOffset);
  const peak = main.eave + tileLift + levels.peakLift;
  const eave = main.eave + levels.eaveLift;
  const joinZ = main.z + roofTileInset + (peak - main.eave - tileLift) / slope;
  return {
    x: site.portico.x + site.portico.w / 2 - w / 2,
    z: frontElevation.hatFront, w, d: joinZ - frontElevation.hatFront,
    eave, rise: peak - eave - tileLift, peak, joinZ, heightOffset: levels.offset,
    // 前斜脊的水平 X/Z 增量相等，与正屋两端斜脊平行；纵脊在等高处接入前坡。
    ridgeFront: frontElevation.hatFront + roofTileInset + run,
  };
}

/** 正屋旧檐切到转接梁的外皮，立体与图纸共用。 */
export function floatingHatTrimGap(): [number, number] {
  return [frontElevation.postXs[0] - frontElevation.dividerWidth / 2,
    frontElevation.postXs[1] + frontElevation.dividerWidth / 2];
}

/** 屋面图使用与立体相同的坡面及求交；门厅草稿仅在本次计算中覆盖。 */
export function roofPlanModel(style: RoofStyle, layout?: VillaLayoutLive | null, fenShui = site.roofFenShui) {
  return withLayoutContext(layout, () => {
    const main = mainRoofFootprint(), annex = annexRoofFootprint(), pitch = roofPitch(fenShui);
    const lift = roofTileEaveLift(), inset = roofTileInset;
    const annexProfile = annexRoofProfile();
    const hip = (r: typeof main, rise: number, i = inset, l = lift) => hipRoofSurfaces(r.x + i, r.z + i, r.w - 2 * i, r.d - 2 * i, r.eave + l, rise);
    const mainHip = hip(main, pitch.mainRise), annexHip = hip(annex, pitch.annexRise, annexProfile.tileInset, annexProfile.tileLift);
    const hat = style === "floating" ? floatingHatLayout(fenShui) : joinedHatLayout(fenShui);
    const hatFaces = hatRoofSurfaces(hat.x + hat.w / 2, hat.z, hat.w, hat.joinZ, hat.eave + lift, hat.peak, 1, hat.ridgeFront);
    return {
      main, annex, hat: { ...hat }, pitch, annexProfile, slabs: roofSlabLayout(layout),
      frontTrimGap: style === "floating" ? floatingHatTrimGap() : undefined,
      mainFaces: joinRoofFaces([...mainHip.faces, ...hatFaces.faces]),
      annexFaces: annexHip.faces,
      mainPeak: main.eave + lift + pitch.mainRise,
      annexPeak: annex.eave + annexProfile.tileLift + pitch.annexRise,
      portico: { ...site.portico },
    };
  });
}

/** 立面图只读取当前外壳；沿用立体的洞口、门厅上下文、屋面与烟囱定位。 */
export function elevationModel(style: RoofStyle, layout?: VillaLayoutLive | null) {
  return withLayoutContext(layout, () => ({
    main: { ...site.main }, annex: { ...site.annex },
    glazing: resolveLayoutFacades(layout).glazing,
    entries: resolveLayoutFacades(layout).entries,
    floors: floors.map((floor, index) => ({
      y: floor.y, height: floor.height, front: floor.front,
      facades: villaLayoutFacades(index, layout),
    })),
    annexFacades: villaLayoutFacades(3, layout),
    front: structuredClone(frontElevation),
    roof: roofPlanModel(style),
    chimney: annexChimneyModel(),
  }));
}

/** 烟囱外壳与盖板共用模型定位，避免图纸自行估算屋面出口高度。 */
export function annexChimneyModel() {
  const annex = annexRoofFootprint(), pitch = roofPitch(site.roofFenShui);
  const { tileInset: roofTileInset, tileLift } = annexRoofProfile();
  // 向前离开后侧斜脊，烟囱及盖板完整落在侧坡内。
  const x = annexLocalX(850), z = site.annex.z + site.annex.d - 2050;
  const localX = x - (annex.x + roofTileInset), localZ = z - (annex.z + roofTileInset);
  const tileW = annex.w - 2 * roofTileInset, tileD = annex.d - 2 * roofTileInset;
  const run = Math.min(tileW, tileD) / 2;
  const dx = Math.min(localX, tileW - localX), dz = Math.min(localZ, tileD - localZ);
  const base = annex.eave + tileLift + pitch.annexRise * Math.min(1, Math.min(dx, dz) / Math.max(50, run));
  return { x, z, base, capY: base + 1600 };
}

function floatingHat(parent: THREE.Object3D, mainRoof: THREE.Object3D, mat: Mats, fenShui: number) {
  const h = floatingHatLayout(fenShui), center = h.x + h.w / 2;
  const m = mainRoofFootprint();
  const tileLift = roofTileEaveLift();
  const main = hipRoofSurfaces(m.x + roofTileInset, m.z + roofTileInset, m.w - 2 * roofTileInset, m.d - 2 * roofTileInset, m.eave + tileLift, roofPitch(fenShui).mainRise);
  const hat = hatRoofSurfaces(center, h.z, h.w, h.joinZ, h.eave + tileLift, h.peak, 1, h.ridgeFront);
  const original = [...main.faces, ...hat.faces], visible = joinRoofFaces(original);
  addTiledRoof(mainRoof, visible.filter(face => face.owner === 0), mat.villaRoof, mat.villaRoofJoint, main.ridges, original);
  const group = new THREE.Group();
  group.name = "悬浮官帽";
  parent.add(group);
  const cap = new THREE.Group();
  cap.name = "悬浮官帽接入正屋";
  group.add(cap);
  addTiledRoof(cap, visible.filter(face => face.owner === 1), mat.villaRoof, mat.villaRoofJoint, hat.ridges, original);
  // 三眼皮／梁托／下沿线由 integratedHatEaves 生成；柱身与正面装饰在三楼立面按悬浮檐高加高，与原有官帽共用造型。
  integratedHatEaves(cap, h.x, h.z, h.w, h.eave, mat, m.z + roofTileInset, m.eave + tileLift, fenShui / 10, floors[2].front);
}

export function attachRoofs(
  roof: THREE.Object3D,
  annexRoof: THREE.Object3D,
  mat: Mats,
  fenShui = site.roofFenShui,
  roofStyle: RoofStyle = DEFAULT_ROOF_STYLE,
) {
  const main = mainRoofFootprint();
  const pitch = roofPitch(fenShui);
  const bay = joinedHatLayout(fenShui);
  // 梁托／下沿线贴三楼外墙皮：北墙在退台后的 floors[2].front，不是一层前墙。
  const mainWall = {
    x: site.main.x,
    z: floors[2].front,
    w: site.main.w,
    d: site.main.z + site.main.d - floors[2].front,
  };
  const mainRoof = roofStyle === "floating"
    ? roofEaves(roof, main.x, main.z, main.w, main.d, main.eave, mat, undefined, mainWall,
      floatingHatTrimGap())
    : gutteredRoof(roof, main.x, main.z, main.w, main.d, main.eave, pitch.mainRise, mat, bay, mainWall);
  mainRoof.name = "正屋四坡";
  if (roofStyle === "floating") floatingHat(roof, mainRoof, mat, fenShui);
  else {
    // 官帽前檐梁托／下沿线已由 roofEaves 的 bay 前／左／右生成；柱间回纹在三楼立面下沿线高度。
    const hat = new THREE.Group();
    hat.name = "中央官帽横梁";
    roof.add(hat);
  }
  const annex = annexRoofFootprint();
  const annexWall = { x: site.annex.x, z: site.annex.z, w: site.annex.w, d: site.annex.d };
  withAnnexRoofDesign(() => gutteredRoof(annexRoof, annex.x, annex.z, annex.w, annex.d, annex.eave, pitch.annexRise, mat, undefined, annexWall));
  // 烟囱相对辅楼檐口＋坡起定位，避免墙高变化后出口低于瓦面。
  const { x: chimneyX, z: chimneyZ, base: roofYAtChimney, capY } = annexChimneyModel();
  const stackH = 1600;
  const stackMid = roofYAtChimney + stackH / 2 - 200;
  box(annexRoof, chimneyX, stackMid, chimneyZ, 460, stackH + 400, 460, mat.stone);
  box(annexRoof, chimneyX, capY + 60, chimneyZ, 720, 120, 720, mat.dark);
  for (const x of [chimneyX - 200, chimneyX + 200])
    box(annexRoof, x, capY - 140, chimneyZ, 45, 320, 45, mat.metal);
}
