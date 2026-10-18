import * as THREE from "three";
import { box, slab, rect, type Mats } from "./primitives";
import { addTiledRoof, hipRoofSurfaces, hatRoofSurfaces, joinRoofFaces, cutRoofOpenings, type RoofFace } from "./roof-surfaces";
import { frontElevation, type Point } from "./data";
import {
  apronFasciaBottom,
  eaveTrimDesign,
  eyelidFixed,
  eyelidInset,
  eyelidStackHeight,
  gutterBedTop,
  gutterInnerWallTop,
  roofGutterDesign,
  roofTileEaveLift,
  roofTileInset,
} from "./roof-options";

/** 槽底／内挡用同一水泥灰，略做 polygonOffset，减轻与压顶、瓦边共面闪线。 */
function gutterCement(mat: Mats) {
  const m = mat.roofGutter.clone();
  m.polygonOffset = true;
  m.polygonOffsetFactor = 1;
  m.polygonOffsetUnits = 1;
  return m;
}

export { apronFasciaBottom } from "./roof-options";

export type WallFootprint = { x: number; z: number; w: number; d: number };

export function meander(
  parent: THREE.Object3D,
  x: number, y: number, z: number, width: number, mat: Mats,
) {
  const count = Math.max(1, Math.floor(width / 280));
  const pitch = width / count;
  for (let i = 0; i < count; i++) {
    const xx = x + (i + 0.5) * pitch;
    const scale = Math.min(1, pitch / 280);
    // 两端留同宽收边，每个回字关于自身中线对称，不再用余数留一截空白。
    const w = 215 * scale, h = 160, t = 18;
    reliefFrame(parent, xx, y, z - 6, w, h, t, mat);
    for (const side of [-1, 1]) {
      box(parent, xx + side * w * 0.17, y, z - 4, t, h * 0.52, 12, mat.relief, false);
      box(parent, xx, y + side * h * 0.2, z - 4, w * 0.34, t, 12, mat.relief, false);
    }
  }
}

function reliefFrame(parent: THREE.Object3D, x: number, y: number, front: number, w: number, h: number, t: number, mat: Mats) {
  const shape = new THREE.Shape([
    new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2),
    new THREE.Vector2(w / 2, h / 2), new THREE.Vector2(-w / 2, h / 2),
  ]);
  shape.holes.push(new THREE.Path([
    new THREE.Vector2(-w / 2 + t, -h / 2 + t), new THREE.Vector2(-w / 2 + t, h / 2 - t),
    new THREE.Vector2(w / 2 - t, h / 2 - t), new THREE.Vector2(w / 2 - t, -h / 2 + t),
  ]));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 10, bevelEnabled: true, bevelSize: 1, bevelThickness: 1, bevelSegments: 2, steps: 1 });
  const mesh = new THREE.Mesh(geometry, mat.relief);
  mesh.position.set(x, y, front);
  parent.add(mesh);
}

function framedRelief(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, mat: Mats) {
  box(parent, x, y, z, w, h, 25, mat.trim);
  reliefFrame(parent, x, y, z - 24, w - 40, h - 40, 18, mat);
  for (const sign of [-1, 1]) {
    for (const side of [-1, 1]) {
      const xx = x + side * (w / 2 - 80), yy = y + sign * (h / 2 - 95);
      box(parent, xx, yy, z - 20, 75, 18, 16, mat.relief, false);
      box(parent, xx + side * 30, yy - sign * 27, z - 20, 18, 70, 16, mat.relief, false);
    }
  }
}

// 包角柱和门厅柱共用的柱头：花板、齿饰、层叠线脚。局部 -Z 朝外。
function columnCapitalFace(parent: THREE.Object3D, top: number, width: number, mat: Mats) {
  const panelW = Math.min(500, Math.max(260, width - 60));
  const panelH = Math.min(400, panelW * 0.86);
  const crown = 360;
  const panelCenter = top - crown - panelH / 2 - 20;
  framedRelief(parent, 0, panelCenter, -12, panelW, panelH, mat);
  const teeth = Math.max(4, Math.round(panelW / 72));
  const span = panelW * 0.84;
  for (let i = 0; i < teeth; i++) {
    const xx = -span / 2 + (i + 0.5) * (span / teeth);
    box(parent, xx, top - crown + 30, -26, Math.min(30, span / teeth * 0.42), 90, 16, mat.relief, false);
  }
  box(parent, 0, top - 200, -20, Math.min(width * 0.94, panelW + 60), 40, 20, mat.trim);
  box(parent, 0, top - 120, -26, Math.min(width * 0.98, panelW + 100), 55, 24, mat.trim);
  box(parent, 0, top - 45, -32, width * 0.98, 70, 26, mat.dressedStone);
  return panelCenter - panelH / 2 - 40;
}

// 包角柱柱脚是方花板，和门厅柱的圆纹柱脚分开。
// 方板这一截比上面柱身再凸出约 4 厘米，花板贴在凸出的面上。4 厘米是造型尺寸。
const basePanelProject = 40;
function cornerBaseFace(parent: THREE.Object3D, span: number, mat: Mats) {
  const panelW = Math.min(440, Math.max(240, span));
  const panelH = Math.min(480, panelW * 1.08);
  const y = 180 + panelH / 2;
  const face = new THREE.Group();
  face.position.z = -basePanelProject;
  parent.add(face);
  framedRelief(face, 0, y, -12, panelW, panelH, mat);
  return y + panelH / 2 + 40;
}

// 效果图1：竖纹只在正面，壁灯以上、柱头以下的一小段，四道细线，不铺满柱身。
function frontFlutes(parent: THREE.Object3D, y0: number, y1: number, width: number, mat: Mats) {
  if (y1 - y0 < 300 || width < 200) return;
  const count = 4;
  const span = Math.min(width * 0.42, 320);
  const pitch = span / (count - 1);
  const y = (y0 + y1) / 2;
  const h = y1 - y0;
  for (let i = 0; i < count; i++) {
    const xx = -span / 2 + i * pitch;
    box(parent, xx, y, -16, 12, h, 12, mat.dark);
  }
}

function roundMedallion(parent: THREE.Object3D, y: number, radius: number, mat: Mats) {
  const plaque = radius * 2.15;
  const z = -8;
  const face = new THREE.Group();
  face.position.z = -basePanelProject;
  parent.add(face);
  box(face, 0, y, z, plaque, plaque, 16, mat.trim);
  box(face, 0, y + plaque / 2 - 15, z - 12, plaque, 20, 10, mat.dressedStone);
  box(face, 0, y - plaque / 2 + 15, z - 12, plaque, 20, 10, mat.dressedStone);
  box(face, plaque / 2 - 15, y, z - 12, 20, plaque, 10, mat.dressedStone);
  box(face, -plaque / 2 + 15, y, z - 12, 20, plaque, 10, mat.dressedStone);
  for (const r of [radius * 0.9, radius * 0.58]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 11, 12, 80), mat.relief);
    ring.position.set(0, y, z - 8);
    face.add(ring);
  }
  box(face, 0, y, z - 10, radius * 0.62, 14, 8, mat.dark);
  box(face, 0, y, z - 10, 14, radius * 0.62, 8, mat.dark);
}

export function carvedPilaster(
  parent: THREE.Object3D, x: number, z: number, base: number,
  height: number, width: number, mat: Mats, depth = 560, medallion = false,
) {
  const g = new THREE.Group();
  g.position.set(x, base, z);
  g.name = "新中式效果图1通高装饰柱";
  parent.add(g);
  box(g, 0, height / 2, 0, width, height, depth, mat.trim);
  box(g, 0, 70, 0, width + 100, 140, depth + 100, mat.dressedStone);
  box(g, 0, 200, 0, width + 40, 120, depth + 40, mat.trim);
  // 柱脚方饰这一截四面都比上面柱身凸出约 4 厘米。
  const baseRadius = Math.min(170, Math.max(width, depth) * 0.92 * 0.24);
  const basePlaque = baseRadius * 2.15;
  box(g, 0, 640, 0, width + basePanelProject * 2, basePlaque + 40, depth + basePanelProject * 2, mat.trim);
  const dress = (face: THREE.Object3D, span: number, withMedallion: boolean, flutes: boolean) => {
    const shaftTop = columnCapitalFace(face, height, span, mat);
    if (withMedallion) roundMedallion(face, 640, Math.min(170, span * 0.24), mat);
    if (flutes) {
      const fluteTop = shaftTop - 900;
      frontFlutes(face, fluteTop - 1250, fluteTop, span, mat);
    }
  };
  const front = new THREE.Group();
  front.position.set(0, 0, -depth / 2);
  g.add(front);
  dress(front, width * 0.92, medallion, medallion);
  for (const dir of [-1, 1]) {
    const side = new THREE.Group();
    side.position.set(dir * (width / 2), 0, 0);
    side.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(side);
    dress(side, depth * 0.92, medallion, false);
  }
  return g;
}

export function cornerPilaster(
  parent: THREE.Object3D,
  cornerX: number,
  cornerZ: number,
  base: number,
  height: number,
  mat: Mats,
  outward: number,
  outwardZ = -1,
) {
  const g = new THREE.Group();
  g.position.set(cornerX, base, cornerZ);
  g.name = "包角柱";
  parent.add(g);
  // 突出量随方案尺寸「包角柱突出墙面」；侧面贴墙段长度仍为造型 0.5 m。
  const project = frontElevation.cornerProject;
  const leg = frontElevation.cornerLeg;
  const xOuter = outward * project;
  const xInner = -outward * leg;
  const frontW = leg + project;
  const frontX = (xOuter + xInner) / 2;
  const placeL = (y: number, h: number, lip: number, material: THREE.Material) => {
    const embed = 20;
    const outer = xOuter + outward * lip;
    const inner = xInner - outward * lip;
    const zFar = outwardZ * (project + lip);
    const zNear = -outwardZ * embed;
    box(g, (outer + inner) / 2, y, (zFar + zNear) / 2, frontW + lip * 2, h, Math.abs(zFar - zNear), material);
    const sideInner = -outward * embed;
    box(g, (outer + sideInner) / 2, y, -outwardZ * (leg + lip) / 2, project + lip + embed, h, leg + lip, material);
  };
  placeL(height / 2, height, 0, mat.sand);
  placeL(80, 160, 30, mat.dressedStone);
  // 方花板所在的这一截，两面都比上面柱身再凸出约 4 厘米。
  placeL(420, 500, basePanelProject, mat.sand);
  // 柱顶这一截顶住上面的三眼皮，用英国棕。
  placeL(height - 50, 100, 30, mat.british);
  const dress = (face: THREE.Object3D, span: number) => {
    const shaftTop = columnCapitalFace(face, height, span, mat);
    const shaftBottom = cornerBaseFace(face, span * 0.92, mat);
    if (shaftTop - shaftBottom > 250)
      box(face, 0, (shaftBottom + shaftTop) / 2, -20, 34, shaftTop - shaftBottom, 20, mat.dark);
  };
  const frontFace = new THREE.Group();
  frontFace.position.set(frontX, 0, outwardZ * project);
  frontFace.rotation.y = outwardZ > 0 ? Math.PI : 0;
  g.add(frontFace);
  dress(frontFace, Math.min(480, frontW - 60));
  const sideFace = new THREE.Group();
  sideFace.position.set(xOuter, 0, -outwardZ * leg / 2);
  sideFace.rotation.y = outward > 0 ? -Math.PI / 2 : Math.PI / 2;
  g.add(sideFace);
  dress(sideFace, Math.min(400, leg - 40));
  return g;
}

export function solidLattice(
  parent: THREE.Object3D,
  x: number, y: number, z: number, w: number, h: number, mat: Mats,
) {
  const g = new THREE.Group();
  g.name = "门厅铸铝花格";
  g.position.set(x, y, z);
  parent.add(g);
  box(g, 0, 0, 0, w, h, 40, mat.dark);
  const cols = Math.max(3, Math.round(w / 270));
  const rows = Math.max(2, Math.round(h / 300));
  const cw = w / cols;
  const ch = h / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const xx = -w / 2 + (c + 0.5) * cw;
      const yy = -h / 2 + (r + 0.5) * ch;
      const flip = (r + c) % 2 ? 1 : -1;
      box(g, xx, yy, -28, cw * 0.88, 20, 12, mat.trim);
      box(g, xx + flip * cw * 0.2, yy, -28, 20, ch * 0.88, 12, mat.trim);
    }
  }
  box(g, 0, h / 2, -20, w + 70, 45, 30, mat.trim);
  box(g, 0, -h / 2, -20, w + 70, 45, 30, mat.trim);
  box(g, -w / 2, 0, -20, 45, h, 30, mat.trim);
  box(g, w / 2, 0, -20, 45, h, 30, mat.trim);
  return g;
}

// 门上那一截：棕色板，面上几道斜纹。斜纹是造型。
export function brownSlashPanel(
  parent: THREE.Object3D,
  x: number, y: number, z: number, w: number, h: number, mat: Mats,
) {
  const g = new THREE.Group();
  g.name = "门厅中段棕色斜纹";
  g.position.set(x, y, z);
  parent.add(g);
  box(g, 0, 0, 0, w, h, 40, mat.bronze);
  box(g, 0, h / 2 - 18, -18, w, 26, 14, mat.bronzeDark);
  box(g, 0, -h / 2 + 18, -18, w, 26, 14, mat.bronzeDark);
  box(g, -w / 2 + 18, 0, -18, 26, h, 14, mat.bronzeDark);
  box(g, w / 2 - 18, 0, -18, 26, h, 14, mat.bronzeDark);
  const x0 = -w / 2 + 80, x1 = w / 2 - 80, y0 = -h / 2 + 70, y1 = h / 2 - 70;
  for (let b = -w - h; b <= w + h; b += 260) {
    const hits: [number, number][] = [];
    for (const [px, py] of [
      [x0, x0 + b],
      [x1, x1 + b],
      [y0 - b, y0],
      [y1 - b, y1],
    ] as [number, number][]) {
      if (px >= x0 - 20 && px <= x1 + 20 && py >= y0 - 20 && py <= y1 + 20)
        hits.push([Math.min(x1, Math.max(x0, px)), Math.min(y1, Math.max(y0, py))]);
    }
    if (hits.length < 2) continue;
    const a = hits[0], c = hits[hits.length - 1];
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 160) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 20, 10), mat.bronzeDark);
    mesh.position.set((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, -28);
    mesh.rotation.z = Math.atan2(dy, dx);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    g.add(mesh);
  }
  return g;
}

export function balconyCornerPost(
  parent: THREE.Object3D, x: number, z: number, base: number, height: number, width: number, mat: Mats,
) {
  const g = new THREE.Group();
  g.position.set(x, base, z);
  g.name = "三楼露台短柱";
  parent.add(g);
  // 柱脚收边下挂10厘米，挡住坡瓦在柱脚处的薄边；上部柱高和盖板标高不变。
  box(g, 0, 15, 0, width + 80, 230, width + 80, mat.dressedStone);
  box(g, 0, height / 2, 0, width, height - 160, width, mat.trim);
  // 盖板厚 10 厘米，顶面齐在柱高。每边比柱身多出 10 厘米。下面一条线脚收在盖板下。
  const capThick = 100;
  box(g, 0, height - capThick - 30, 0, width + 60, 60, width + 60, mat.trim);
  box(g, 0, height - capThick / 2, 0, width + 200, capThick, width + 200, mat.dressedStone);
  for (const angle of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const face = new THREE.Group();
    face.rotation.y = angle;
    g.add(face);
    framedRelief(face, 0, height * 0.51, -width / 2 - 12.5, width - 100, height * 0.62, mat);
  }
  return g;
}

/**
 * 官帽柱正面装饰（原有／悬浮共用）：约 1 m 高，上沿在下沿线底以下 10 cm（由 decorTopY 传入）。
 * `columnCenterZ` 为柱心世界 Z；装饰贴北皮。
 */
export function hatColumnFrontDecor(
  parent: THREE.Object3D,
  x: number,
  columnCenterZ: number,
  decorTopY: number,
  columnWidth: number,
  mat: Mats,
  decorHeight = 1,
) {
  const g = new THREE.Group();
  g.name = "官帽柱正面装饰";
  g.position.set(x, 0, columnCenterZ);
  parent.add(g);
  const decorMid = decorTopY - decorHeight / 2;
  const faceZ = -270;
  box(g, 0, decorMid, faceZ, columnWidth + 80, decorHeight, 50, mat.trim);
  box(g, 0, decorMid, faceZ - 18, columnWidth - 60, decorHeight - 120, 20, mat.sand);
  const bandH = 200;
  const bands = Math.max(1, Math.round((decorHeight - 160) / 280));
  for (let i = 0; i < bands; i++) {
    const yy = decorTopY - 100 - bandH / 2 - i * ((decorHeight - 160) / bands);
    meander(g, -columnWidth / 2 + 60, yy, faceZ - 28, columnWidth - 120, mat);
  }
  return g;
}

/**
 * 三楼官帽柱。正面装饰与悬浮官帽共用 `hatColumnFrontDecor`。
 */
export function recessedHatPier(
  parent: THREE.Object3D,
  x: number,
  z: number,
  base: number,
  height: number,
  width: number,
  mat: Mats,
  opts?: { decorTopY?: number; decorHeight?: number },
) {
  const g = new THREE.Group();
  g.name = "官帽柱";
  g.position.set(x, base, z);
  parent.add(g);
  box(g, 0, height / 2, 0, width, height, 500, mat.trim);
  for (const sign of [-1, 1])
    box(g, sign * (width / 2 - 35), height / 2, -270, 35, height - 300, 30, mat.wall);
  // 柱顶只留薄盖，正面大装饰下移到下沿线以下。
  box(g, 0, height - 60, 0, width + 60, 120, 520, mat.trim);
  if (opts?.decorTopY != null || opts?.decorHeight !== 0) {
    const decorH = opts?.decorHeight ?? 1;
    const decorTop = opts?.decorTopY ?? base + height - 120;
    hatColumnFrontDecor(g, 0, 0, decorTop - base, width, mat, decorH);
  }
  return g;
}

export function glassBalustrade(
  parent: THREE.Object3D, a: Point, b: Point, y: number, mat: Mats,
  omitStart = false,
) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.Group();
  g.position.set(a[0], y, a[1]);
  g.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  g.name = "三楼通透玻璃栏板与细金属框";
  parent.add(g);
  const count = Math.max(1, Math.ceil(length / 2300));
  // 这组栏杆的 y 是 50 厘米挡墙顶。横条顶离露台地面约 1.18 米，停在柱盖板下面。
  const railTop = 680;
  const railH = 50;
  const railY = railTop - railH / 2;
  const glassBottom = 20;
  const glassTop = railY - railH / 2;
  for (let i = 0; i < count; i++) {
    const span = length / count;
    // 玻璃和横条都收到柱中心，柱身挡住之后，外面看是嵌进柱子里。
    box(g, (i + 0.5) * span, (glassBottom + glassTop) / 2, 0, Math.max(50, span - 20), glassTop - glassBottom, 12, mat.glass, false);
    box(g, (i + 0.5) * span, railY, 0, span, railH, 75, mat.dark, false);
  }
  for (let i = omitStart ? 1 : 0; i <= count; i++) {
    const xx = i * length / count;
    const postBottom = 20;
    box(g, xx, (postBottom + railTop) / 2, 0, 35, railTop - postBottom, 45, mat.dark, false);
  }
}

function eyelidGroup(parent: THREE.Object3D) {
  const g = new THREE.Group();
  g.name = "三眼皮檐口";
  parent.add(g);
  return g;
}

/** 自下而上三层板顶标高；最上层顶面贴在 `stackTop`。 */
function eyelidLayerTops(stackTop: number) {
  const [bottomH, midH, topH] = eyelidFixed.rises;
  const topTop = stackTop;
  const midTop = topTop - topH;
  const bottomTop = midTop - midH;
  return [
    { top: topTop, thick: topH, inset: eyelidInset(0) },
    { top: midTop, thick: midH, inset: eyelidInset(1) },
    { top: bottomTop, thick: bottomH, inset: eyelidInset(2) },
  ];
}

function wallHole(wall: WallFootprint | undefined, outerX: number, outerZ: number, outerW: number, outerD: number): Point[] {
  if (wall) return rect(wall.x, wall.z, wall.w, wall.d);
  // 无墙皮时按平均出檐内收，避免封成整板天花板。
  const inset = Math.min(950, Math.min(outerW, outerD) * 0.2);
  return rect(outerX + inset, outerZ + inset, outerW - 2 * inset, outerD - 2 * inset);
}

// 天沟下三眼皮：最上层探出最多，往下逐层收进；背面收到墙皮。
function tripleEyelid(
  parent: THREE.Object3D,
  x: number, z: number, w: number, d: number, stackTop: number, mat: Mats,
  wall?: WallFootprint,
) {
  const g = eyelidGroup(parent);
  const hole = wallHole(wall, x, z, w, d);
  for (const layer of eyelidLayerTops(stackTop)) {
    slab(
      g,
      rect(x + layer.inset, z + layer.inset, w - 2 * layer.inset, d - 2 * layer.inset),
      layer.top,
      layer.thick,
      mat.british,
      [hole],
    );
  }
  return g;
}

// 朝墙内收一圈。拐角按统一垂直距离收，避免斜向点收得过多。
function insetToward(outer: Point[], inner: Point[], dist: number): Point[] {
  let projection = Infinity;
  for (let i = 0; i < outer.length; i++) {
    const dx = Math.abs(outer[i][0] - inner[i][0]);
    const dz = Math.abs(outer[i][1] - inner[i][1]);
    if (dx > 10 && dz <= 10) projection = Math.min(projection, dx);
    if (dz > 10 && dx <= 10) projection = Math.min(projection, dz);
  }
  const span = Number.isFinite(projection) ? projection : 700;
  const t = Math.min(1, dist / Math.max(span, 1e-3));
  return outer.map((p, i) => {
    const q = inner[i];
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  });
}

// 沿一条外挑折线做三眼皮。外沿与最上层齐平，背面收到墙边。
function polylineEyelid(
  parent: THREE.Object3D, outer: Point[], inner: Point[], stackTop: number, mat: Mats,
) {
  const g = eyelidGroup(parent);
  for (const layer of eyelidLayerTops(stackTop)) {
    const rim = insetToward(outer, inner, layer.inset);
    slab(g, [...rim, ...inner.slice().reverse()], layer.top, layer.thick, mat.british);
  }
  return g;
}

/** 同墙面梁托中心：两端按拐角中心距的一半内收，中间按间距均分。 */
export function corbelCentersOnEdge(length: number) {
  const endInset = eaveTrimDesign.corbelCornerSpacing / 2;
  if (length <= 50) return [] as number[];
  if (length <= endInset * 2 + 20) return [length / 2];
  const usable = length - 2 * endInset;
  const gaps = Math.max(1, Math.round(usable / eaveTrimDesign.corbelSpacing));
  const step = usable / gaps;
  return Array.from({ length: gaps + 1 }, (_, i) => endInset + i * step);
}

/**
 * 款式07侧视，按用户落款 1:1（设计包络 500×200，沿墙挤出 160）。
 * 参考：references/corbel-style07-profile-2026-10-16.png
 * 局部：X＝出挑（0贴墙），Y＝竖向（0贴墙底）。
 *
 * 按参考图黑线中心描形；图像包络 (39,16)–(374,164) 映射到用户尺寸。
 * 轮廓：平顶＋贴墙背 → 端头双台阶 → 连续 S 弧 → 靠墙小弧 → 竖脚＋底脚平边。
 * length／height 变时按比例缩放同一落款。
 */
export function corbelProfileShape(length: number, height: number) {
  const point = (x: number, y: number): [number, number] => [
    (x - 39) / 335 * length,
    (164 - y) / 148 * height,
  ];
  const shape = new THREE.Shape();
  shape.moveTo(...point(39, 164));
  shape.lineTo(...point(39, 16));
  shape.lineTo(...point(374, 16));
  shape.lineTo(...point(374, 42));
  shape.lineTo(...point(354, 42));
  shape.lineTo(...point(349, 51));
  shape.lineTo(...point(321, 51));
  shape.lineTo(...point(317, 43));
  // S 弧分两段描绘，中间切向连续；保留右端平缓、腰部陡收、左段回落。
  shape.bezierCurveTo(
    ...point(260, 36.2),
    ...point(239.4, 75.1),
    ...point(234, 83),
  );
  shape.bezierCurveTo(
    ...point(200.2, 132.8),
    ...point(161.9, 120),
    ...point(138, 111),
  );
  // 靠墙小弧先下兜，再接独立竖脚；不把竖脚磨成斜弧。
  shape.bezierCurveTo(
    ...point(133.4, 123.4),
    ...point(125, 148.9),
    ...point(86, 133),
  );
  shape.lineTo(...point(86, 164));
  shape.lineTo(...point(39, 164));
  shape.closePath();
  return shape;
}

/** 梁托：背面贴墙外皮（略嵌入防漏缝），平顶承三眼皮，出挑方向朝外。 */
function addStyle07Corbel(
  parent: THREE.Object3D,
  along: "x" | "z",
  wallFace: number,
  outSign: number,
  centerAlong: number,
  topY: number,
  length: number,
  mat: THREE.Material,
) {
  const { corbelWidth: W, corbelHeight: H } = eaveTrimDesign;
  const L = length;
  const embed = 8;
  const geo = new THREE.ExtrudeGeometry(corbelProfileShape(L, H), {
    depth: W,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 32,
  });
  // 轮廓在 XY，挤出沿 +Z；再把厚度居中，并让 X=0 落在墙皮。
  geo.translate(0, 0, -W / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "梁托";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // 顶面贴齐三眼皮底；轮廓 X=0 为贴墙背（再嵌入少许，杜绝飘缝）。
  mesh.position.y = topY - H;
  if (along === "x") {
    // 南北墙：出挑 ±Z。Ry(π/2)：本地 +X → 世界 −Z。
    mesh.rotation.y = outSign < 0 ? Math.PI / 2 : -Math.PI / 2;
    mesh.position.x = centerAlong;
    mesh.position.z = wallFace - outSign * embed;
  } else {
    // 东西墙：出挑 ±X。
    mesh.rotation.y = outSign < 0 ? Math.PI : 0;
    mesh.position.x = wallFace - outSign * embed;
    mesh.position.z = centerAlong;
  }
  parent.add(mesh);
  return mesh;
}

type CorbelEdge = { along: "x" | "z"; face: number; from: number; to: number; sign: number };

function placeCorbelEdges(
  parent: THREE.Object3D,
  edges: CorbelEdge[],
  stackTop: number,
  mat: Mats,
) {
  const trim = new THREE.Group();
  trim.name = "檐下梁托与下沿线";
  parent.add(trim);
  const eyelidBottom = stackTop - eyelidStackHeight();
  const fasciaTop = eyelidBottom - eaveTrimDesign.eyelidToFascia;
  const fasciaY = fasciaTop - eyelidFixed.fasciaHeight / 2;
  const sand = mat.sand;
  const corbelTop = eyelidBottom;
  const p = eyelidFixed.fasciaProtrusion;
  const fh = eyelidFixed.fasciaHeight;

  for (const edge of edges) {
    const len = edge.to - edge.from;
    if (len < 50) continue;
    for (const t of corbelCentersOnEdge(len)) {
      addStyle07Corbel(trim, edge.along, edge.face, edge.sign, edge.from + t, corbelTop, eaveTrimDesign.corbelLength, sand);
    }
    // 下沿线两端各伸出凸出量，与邻边在拐角外方咬合，不留缺口。
    const span = len + 2 * p;
    if (edge.along === "x") {
      const zMid = edge.face + edge.sign * p / 2;
      box(trim, (edge.from + edge.to) / 2, fasciaY, zMid, span, fh, p, sand);
    } else {
      const xMid = edge.face + edge.sign * p / 2;
      box(trim, xMid, fasciaY, (edge.from + edge.to) / 2, p, fh, span, sand);
    }
  }
}

function addCorbelsAndFascia(
  parent: THREE.Object3D,
  wall: WallFootprint,
  stackTop: number,
  mat: Mats,
) {
  // 四面均以墙外皮为背面；outSign 指向室外（出挑方向）。与折线飘檐共用 eaveTrimDesign。
  placeCorbelEdges(parent, [
    { along: "x", face: wall.z, from: wall.x, to: wall.x + wall.w, sign: -1 },
    { along: "x", face: wall.z + wall.d, from: wall.x, to: wall.x + wall.w, sign: 1 },
    { along: "z", face: wall.x, from: wall.z, to: wall.z + wall.d, sign: -1 },
    { along: "z", face: wall.x + wall.w, from: wall.z, to: wall.z + wall.d, sign: 1 },
  ], stackTop, mat);
}

/** 沿墙皮折线布置梁托／下沿线；出挑方向由对应外沿折线推断。与正屋共用参数。 */
function addPolylineCorbelsAndFascia(
  parent: THREE.Object3D,
  wallPts: Point[],
  outerPts: Point[],
  stackTop: number,
  mat: Mats,
) {
  const edges: CorbelEdge[] = [];
  for (let i = 0; i < wallPts.length - 1; i++) {
    const a = wallPts[i], b = wallPts[i + 1];
    const oa = outerPts[i], ob = outerPts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 50) continue;
    const outX = (oa[0] + ob[0]) / 2 - (a[0] + b[0]) / 2;
    const outZ = (oa[1] + ob[1]) / 2 - (a[1] + b[1]) / 2;
    if (Math.hypot(outX, outZ) < 20) continue;
    if (Math.abs(dx) >= Math.abs(dz)) {
      edges.push({
        along: "x",
        face: (a[1] + b[1]) / 2,
        from: Math.min(a[0], b[0]),
        to: Math.max(a[0], b[0]),
        sign: outZ >= 0 ? 1 : -1,
      });
    } else {
      edges.push({
        along: "z",
        face: (a[0] + b[0]) / 2,
        from: Math.min(a[1], b[1]),
        to: Math.max(a[1], b[1]),
        sign: outX >= 0 ? 1 : -1,
      });
    }
  }
  placeCorbelEdges(parent, edges, stackTop, mat);
}

// 前檐中段向前凸出一截，左右仍与原檐口齐平。inset 沿外沿向内收。
function bayOutline(
  x: number, z: number, w: number, d: number,
  bayX: number, bayW: number, bayZ: number, inset: number,
): Point[] {
  const x0 = x + inset, z0 = z + inset, x1 = x + w - inset, z1 = z + d - inset;
  const b0 = bayX + inset, b1 = bayX + bayW - inset, bz = bayZ + inset;
  return [
    [x0, z0], [b0, z0], [b0, bz], [b1, bz], [b1, z0], [x1, z0],
    [x1, z1], [x0, z1],
  ];
}

// 四坡五脊按分水计：水平 10，升高若干。瓦边避开挡墙及300毫米净宽天沟，
// 四坡共用较短一边的一半作为水平距离。
export function hipRise(width: number, depth: number, fenShui = 4.5) {
  const run = (Math.min(width, depth) - 2 * roofTileInset) / 2;
  return (fenShui / 10) * run;
}

// 只压低压顶顶面的内沿，底面保持水平。转角共用顶点高度。
function slopeGutterCoping(mesh: THREE.Mesh, outer: Point[], width: number, closed = true) {
  const positions = mesh.geometry.getAttribute("position");
  mesh.geometry.computeBoundingBox();
  const top = mesh.geometry.boundingBox!.max.y;
  const tangent = Math.tan(THREE.MathUtils.degToRad(roofGutterDesign.copingSlopeDegrees));
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(positions.getY(i) - top) > 1e-2) continue;
    const x = positions.getX(i), z = positions.getZ(i);
    let distance = Infinity;
    for (let j = 0; j < outer.length - (closed ? 0 : 1); j++) {
      const a = outer[j], b = outer[(j + 1) % outer.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-6) continue;
      const t = THREE.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / len2, 0, 1);
      distance = Math.min(distance, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
    }
    positions.setY(i, top - Math.min(distance, width) * tangent);
  }
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
}

/** 槽底找坡：各边中点为排水口；只改几何本地顶面 Y，排水口最低、远处按 bedSlope 抬高。 */
function slopeGutterBed(mesh: THREE.Mesh, outer: Point[]) {
  const slope = roofGutterDesign.bedSlope;
  if (slope <= 0) return;
  const drains: Point[] = [];
  for (let j = 0; j < outer.length; j++) {
    const a = outer[j], b = outer[(j + 1) % outer.length];
    drains.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  const positions = mesh.geometry.getAttribute("position");
  mesh.geometry.computeBoundingBox();
  // Extrude 后顶面在本地 Y≈thickness；绝不能写入世界标高，否则会撑成整层楼高的灰盒子。
  const top = mesh.geometry.boundingBox!.max.y;
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(positions.getY(i) - top) > 1e-2) continue;
    const x = positions.getX(i), z = positions.getZ(i);
    let dist = Infinity;
    for (const d of drains) dist = Math.min(dist, Math.hypot(x - d[0], z - d[1]));
    positions.setY(i, top + slope * dist);
  }
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
}

// 坡瓦收于有底、有外挡边的环形天沟内。瓦边缩进，避免穿出天沟及用地边界。
// bay 把前檐中段和官帽连成同一条天沟、同一圈三眼皮。
export function roofEaves(
  parent: THREE.Object3D,
  x: number, z: number, w: number, d: number,
  base: number, mat: Mats,
  bay?: { x: number; w: number; z: number },
  wall?: WallFootprint,
) {
  const g = new THREE.Group();
  g.name = "四坡五脊瓦顶与环形天沟";
  parent.add(g);
  const outerT = roofGutterDesign.outerTopWidth;
  const innerT = roofGutterDesign.innerWallThickness;
  const channel = outerT + roofGutterDesign.clearWidth;
  const innerFace = channel + innerT;
  const outline = (inset: number) =>
    bay ? bayOutline(x, z, w, d, bay.x, bay.w, bay.z, inset) : rect(x + inset, z + inset, w - 2 * inset, d - 2 * inset);
  const outer = outline(0);
  const outerInner = outline(outerT);
  const channelHole = outline(channel);
  const innerLipHole = outline(innerFace);
  const cement = gutterCement(mat);
  const bedY = base + gutterBedTop;
  // 槽底只铺在沟槽内，不要铺到外皮——否则水泥灰会在三眼皮立面露出一道白线。
  const bed = slab(g, outerInner, bedY, 80, cement, [innerLipHole.slice().reverse()]);
  bed.name = "天沟槽底";
  slopeGutterBed(bed, outerInner);

  // 外挡坐在三眼皮顶上；压顶与三眼皮同色（英国棕）并外飘。外挡顶略低于压顶底，避免共面闪线。
  const outerWallH = roofGutterDesign.clearDepth;
  const copeThick = 30;
  const wallTopGap = 3;
  const outerWall = slab(
    g,
    outer,
    base + outerWallH - wallTopGap,
    outerWallH - wallTopGap,
    mat.british,
    [outerInner.slice().reverse()],
  );
  outerWall.name = "天沟外挡边";

  const copeOh = eyelidFixed.copingOverhang;
  const copeOuter = outline(-copeOh);
  const copeInner = outline(outerT);
  const copeTop = base + outerWallH + copeThick;
  const coping = slab(g, copeOuter, copeTop, copeThick, mat.british, [copeInner.slice().reverse()]);
  coping.name = "天沟外边反坎压顶";
  slopeGutterCoping(coping, copeOuter, outerT + copeOh);

  // 内挡保留；底边埋进槽底约 1cm，避免与槽顶共面穿模闪灰线。
  const innerTop = gutterInnerWallTop();
  const innerEmbed = 10;
  const innerWall = slab(
    g,
    channelHole,
    base + innerTop,
    innerTop - gutterBedTop + innerEmbed,
    cement,
    [innerLipHole.slice().reverse()],
  );
  innerWall.name = "天沟内挡边";

  const stackTop = base;
  if (bay) {
    const lids = eyelidGroup(g);
    const hole = wall
      ? rect(wall.x, wall.z, wall.w, wall.d)
      : bayOutline(x, z, w, d, bay.x, bay.w, bay.z, 950);
    for (const layer of eyelidLayerTops(stackTop)) {
      slab(
        lids,
        bayOutline(x, z, w, d, bay.x, bay.w, bay.z, layer.inset),
        layer.top,
        layer.thick,
        mat.british,
        [hole],
      );
    }
  } else {
    tripleEyelid(g, x, z, w, d, stackTop, mat, wall);
  }
  if (wall) {
    if (bay) addWallAndHatBayCorbels(g, wall, bay, z, stackTop, mat);
    else addCorbelsAndFascia(g, wall, stackTop, mat);
  }
  return g;
}

/**
 * 正屋墙身三面＋北墙在官帽以外的两翼，以及官帽前／左／右三边，共用梁托与下沿线。
 * 官帽侧边沿屋面外皮接到前檐，不挂到退台墙皮。
 */
function addWallAndHatBayCorbels(
  parent: THREE.Object3D,
  wall: WallFootprint,
  bay: { x: number; w: number; z: number },
  roofNorthZ: number,
  stackTop: number,
  mat: Mats,
) {
  const wallNorth = wall.z;
  const wallSouth = wall.z + wall.d;
  const bayWest = bay.x;
  const bayEast = bay.x + bay.w;
  const bayFront = bay.z;
  const edges: CorbelEdge[] = [
    { along: "x", face: wallSouth, from: wall.x, to: wall.x + wall.w, sign: 1 },
    { along: "z", face: wall.x, from: wall.z, to: wall.z + wall.d, sign: -1 },
    { along: "z", face: wall.x + wall.w, from: wall.z, to: wall.z + wall.d, sign: 1 },
  ];
  // 北墙两翼（官帽开间以外）。
  if (bayWest > wall.x + 50)
    edges.push({ along: "x", face: wallNorth, from: wall.x, to: Math.min(bayWest, wall.x + wall.w), sign: -1 });
  if (bayEast < wall.x + wall.w - 50)
    edges.push({ along: "x", face: wallNorth, from: Math.max(bayEast, wall.x), to: wall.x + wall.w, sign: -1 });
  // 官帽前／左／右：梁托背面落在外沿内侧（天沟净宽一带），向外挑，避免贴在最外皮外甩。
  const under = roofGutterDesign.outerTopWidth + roofGutterDesign.clearWidth * 0.35;
  const p = eyelidFixed.fasciaProtrusion;
  edges.push({ along: "x", face: bayFront + under, from: bayWest, to: bayEast, sign: -1 });
  const sideTo = Math.max(bayFront + 50, roofNorthZ);
  // 侧边北端内收一个下沿线凸出量，避免 +2p 咬合把下沿线甩出官帽前皮。
  if (sideTo - (bayFront + p) > 50) {
    edges.push({ along: "z", face: bayWest + under, from: bayFront + p, to: sideTo, sign: -1 });
    edges.push({ along: "z", face: bayEast - under, from: bayFront + p, to: sideTo, sign: 1 });
  }
  placeCorbelEdges(parent, edges, stackTop, mat);
}

// 抬高官帽只保留前檐及两侧外露段。各层后端沿正屋前坡斜切，
// 从板顶到板底均与正屋贴合，不用一条横向后檐穿过屋面。
export function integratedHatEaves(
  parent: THREE.Object3D,
  x: number, z: number, w: number, base: number, mat: Mats,
  mainTileFront: number, mainTileEave: number, slope: number,
) {
  const g = new THREE.Group();
  g.name = "前檐及两侧融入正屋的天沟";
  parent.add(g);
  const outerT = roofGutterDesign.outerTopWidth;
  const innerT = roofGutterDesign.innerWallThickness;
  const rim = (inset: number, width: number, end: number): Point[] => [
    [x + inset, z + inset], [x + w - inset, z + inset],
    [x + w - inset, end], [x + w - width, end],
    [x + w - width, z + width], [x + width, z + width],
    [x + width, end], [x + inset, end],
  ];
  const finish = (outline: (end: number) => Point[], top: number, thick: number, material: THREE.Material, coping = false) => {
    const end = mainTileFront + (top - mainTileEave) / slope;
    const mesh = slab(g, outline(end), top, thick, material);
    if (coping) slopeGutterCoping(mesh, [[x - eyelidFixed.copingOverhang, end], [x - eyelidFixed.copingOverhang, z - eyelidFixed.copingOverhang], [x + w + eyelidFixed.copingOverhang, z - eyelidFixed.copingOverhang], [x + w + eyelidFixed.copingOverhang, end]], outerT + eyelidFixed.copingOverhang, false);
    const positions = mesh.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(positions.getZ(i) - end) < 1e-2)
        positions.setZ(i, end + (positions.getY(i) + mesh.position.y - top) / slope);
    }
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    return mesh;
  };
  const channel = outerT + roofGutterDesign.clearWidth;
  const innerFace = channel + innerT;
  const cement = gutterCement(mat);
  const bedY = base + gutterBedTop;
  // 槽底只在沟内，避免外皮露出水泥灰白线。
  const bed = finish(end => rim(outerT, innerFace, end), bedY, 80, cement);
  bed.name = "天沟槽底";
  slopeGutterBed(bed, [[x + outerT, z + outerT], [x + w - outerT, z + outerT], [x + w - outerT, z + 1000], [x + outerT, z + 1000]]);
  const outerWallH = roofGutterDesign.clearDepth;
  const wallTopGap = 3;
  finish(
    end => rim(0, outerT, end),
    base + outerWallH - wallTopGap,
    outerWallH - wallTopGap,
    mat.british,
  ).name = "天沟外挡边";
  const copeOh = eyelidFixed.copingOverhang;
  finish(
    end => rim(-copeOh, outerT, end),
    base + outerWallH + 30,
    30,
    mat.british,
    true,
  ).name = "天沟外边反坎压顶";
  const innerTop = gutterInnerWallTop();
  const innerEmbed = 10;
  finish(
    end => rim(channel, channel + innerT, end),
    base + innerTop,
    innerTop - gutterBedTop + innerEmbed,
    cement,
  ).name = "天沟内挡边";
  const lids = eyelidGroup(g);
  for (const layer of eyelidLayerTops(base))
    lids.add(finish(end => rim(layer.inset, innerFace, end), layer.top, layer.thick, mat.british));
  const underside = apronFasciaBottom(base, 0);
  finish(end => rect(x + 200, z + 200, w - 400, end - z - 200), underside + 45, 45, mat.trim).name = "悬浮官帽封闭檐底";
  // 前／左／右梁托与下沿线；侧边预留下沿线／梁托外伸，避免未斜切穿进正屋坡面。
  const under = outerT + roofGutterDesign.clearWidth * 0.35;
  const p = eyelidFixed.fasciaProtrusion;
  const sidePad = p + eaveTrimDesign.corbelWidth / 2 + 20;
  const sideEnd = Math.min(
    mainTileFront - sidePad,
    mainTileFront + (base - mainTileEave) / slope - sidePad,
  );
  const edges: CorbelEdge[] = [
    { along: "x", face: z + under, from: x, to: x + w, sign: -1 },
  ];
  if (sideEnd - (z + p) > 80) {
    edges.push({ along: "z", face: x + under, from: z + p, to: sideEnd, sign: -1 });
    edges.push({ along: "z", face: x + w - under, from: z + p, to: sideEnd, sign: 1 });
  }
  placeCorbelEdges(g, edges, base, mat);
  return g;
}

export function gutteredRoof(
  parent: THREE.Object3D,
  x: number, z: number, w: number, d: number,
  base: number, rise: number, mat: Mats,
  bay?: { x: number; w: number; z: number },
  wall?: WallFootprint,
) {
  const g = roofEaves(parent, x, z, w, d, base, mat, bay, wall);
  const eaveY = base + roofTileEaveLift();
  const main = hipRoofSurfaces(x + roofTileInset, z + roofTileInset, w - 2 * roofTileInset, d - 2 * roofTileInset, eaveY, rise);
  const hat = bay ? hatRoofSurfaces(bay.x + bay.w / 2, bay.z, bay.w, z + d / 2, eaveY, eaveY + rise) : null;
  const original = [...main.faces, ...(hat?.faces ?? [])];
  const visible = hat ? joinRoofFaces(original) : original;
  addTiledRoof(g, visible.filter(face => face.owner === 0), mat.villaRoof, mat.villaRoofJoint, main.ridges, original);
  if (hat)
    addTiledRoof(g, visible.filter(face => face.owner === 1), mat.villaRoof, mat.villaRoofJoint, hat.ridges, original).name = "中央官帽";
  return g;
}

/**
 * 三楼栏杆下前／侧飘檐：与正屋同一套天沟／三眼皮／梁托／下沿线（共用 roofGutterDesign、eaveTrimDesign）。
 * `top`＝挡墙顶（瓦内沿标高）；`drop`＝瓦外沿相对挡墙顶的落差，用于找坡；三眼皮顶＝外沿瓦高 − 瓦至内挡顶抬升。
 */
export function tiledApron(
  parent: THREE.Object3D, inner: Point[], outer: Point[], top: number, drop: number, mat: Mats,
  postCutouts: Point[][] = [],
) {
  const g = new THREE.Group();
  g.name = "三楼栏杆下飘檐";
  parent.add(g);

  const tileOuterY = top - drop;
  const apronBase = tileOuterY - roofTileEaveLift();
  const tileRim = insetToward(outer, inner, roofTileInset);
  const at = (p: Point, y: number) => new THREE.Vector3(p[0], y, p[1]);
  const faces: RoofFace[] = inner.slice(0, -1).map((a, i) => {
    const b = inner[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) return null;
    return {
      points: [at(tileRim[i], tileOuterY), at(tileRim[i + 1], tileOuterY), at(b, top), at(a, top)],
      across: [(b[0] - a[0]) / len, (b[1] - a[1]) / len],
      origin: [13700, inner[1][1]],
      owner: 0,
    };
  }).filter((f): f is RoofFace => !!f);
  addTiledRoof(g, cutRoofOpenings(faces, postCutouts), mat.villaRoof, mat.villaRoofJoint);

  // 天沟沿外沿折线，构造与正屋环形天沟同一套尺寸。
  const outerT = roofGutterDesign.outerTopWidth;
  const innerT = roofGutterDesign.innerWallThickness;
  const channel = outerT + roofGutterDesign.clearWidth;
  const innerFace = channel + innerT;
  const band = (a: Point[], b: Point[]) => [...a, ...b.slice().reverse()];
  const oWall = insetToward(outer, inner, outerT);
  const oChannel = insetToward(outer, inner, channel);
  const oLip = insetToward(outer, inner, innerFace);
  const cement = gutterCement(mat);
  const bedY = apronBase + gutterBedTop;
  const bed = slab(g, band(oWall, oLip), bedY, 80, cement);
  bed.name = "天沟槽底";
  slopeGutterBed(bed, oWall);
  const outerWallH = roofGutterDesign.clearDepth;
  const wallTopGap = 3;
  slab(g, band(outer, oWall), apronBase + outerWallH - wallTopGap, outerWallH - wallTopGap, mat.british).name = "天沟外挡边";
  const copeOh = eyelidFixed.copingOverhang;
  const copeOuter = insetToward(outer, inner, -copeOh);
  const cope = slab(g, band(copeOuter, oWall), apronBase + outerWallH + 30, 30, mat.british);
  cope.name = "天沟外边反坎压顶";
  slopeGutterCoping(cope, copeOuter, outerT + copeOh, false);
  const innerTop = gutterInnerWallTop();
  const innerEmbed = 10;
  slab(g, band(oChannel, oLip), apronBase + innerTop, innerTop - gutterBedTop + innerEmbed, cement).name = "天沟内挡边";

  polylineEyelid(g, outer, inner, apronBase, mat);
  addPolylineCorbelsAndFascia(g, inner, outer, apronBase, mat);
  return g;
}

/** 栏杆下飘檐三眼皮顶标高（＝瓦外沿 − 瓦至内挡顶抬升），供包角柱／下沿线对齐。 */
export function frontApronEaveBase(parapetTop: number, drop: number) {
  return parapetTop - drop - roofTileEaveLift();
}

// 窗套贴在墙外皮之外，只加正面线脚。
export function openingFrame(
  parent: THREE.Object3D,
  x: number, sill: number, z: number,
  w: number, h: number, mat: Mats,
  edges: { top?: boolean; bottom?: boolean } = {},
) {
  const t = 70, d = 40;
  if (edges.top !== false)
    box(parent, x, sill + h + t / 2, z, w + t * 2, t, d, mat.trim);
  if (edges.bottom !== false)
    box(parent, x, sill - t / 2, z, w + t * 2, t, d, mat.dressedStone);
  box(parent, x - w / 2 - t / 2, sill + h / 2, z, t, h, d, mat.trim);
  box(parent, x + w / 2 + t / 2, sill + h / 2, z, t, h, d, mat.trim);
}
