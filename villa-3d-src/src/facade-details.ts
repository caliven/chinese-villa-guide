import * as THREE from "three";
import { box, slab, rect, hipRoof, cylinder, type Mats } from "./primitives";
import type { Point } from "./data";

export function meander(
  parent: THREE.Object3D,
  x: number, y: number, z: number, width: number, mat: Mats,
) {
  const pitch = 0.28;
  for (let i = 0; i < Math.floor(width / pitch); i++) {
    const xx = x + i * pitch;
    box(parent, xx + 0.12, y + 0.09, z, 0.24, 0.025, 0.028, mat.stone);
    box(parent, xx + 0.23, y, z, 0.025, 0.18, 0.028, mat.stone);
    box(parent, xx + 0.14, y - 0.075, z, 0.18, 0.025, 0.028, mat.stone);
    box(parent, xx + 0.065, y - 0.01, z, 0.025, 0.14, 0.028, mat.stone);
    box(parent, xx + 0.12, y + 0.045, z, 0.11, 0.025, 0.028, mat.stone);
  }
}

function framedRelief(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, mat: Mats) {
  box(parent, x, y, z, w, h, 0.025, mat.trim);
  for (const sign of [-1, 1]) {
    box(parent, x + sign * (w / 2 - 0.025), y, z - 0.02, 0.018, h - 0.04, 0.015, mat.stone);
    box(parent, x, y + sign * (h / 2 - 0.025), z - 0.02, w - 0.04, 0.018, 0.015, mat.stone);
    for (const side of [-1, 1]) {
      const xx = x + side * (w / 2 - 0.08), yy = y + sign * (h / 2 - 0.095);
      box(parent, xx, yy, z - 0.025, 0.075, 0.016, 0.016, mat.stone);
      box(parent, xx + side * 0.03, yy - sign * 0.027, z - 0.025, 0.016, 0.07, 0.016, mat.stone);
    }
  }
}

// 包角柱和门厅柱共用的柱头：花板、齿饰、层叠线脚。局部 -Z 朝外。
function columnCapitalFace(parent: THREE.Object3D, top: number, width: number, mat: Mats) {
  const panelW = Math.min(0.5, Math.max(0.26, width - 0.06));
  const panelH = Math.min(0.4, panelW * 0.86);
  const crown = 0.36;
  const panelCenter = top - crown - panelH / 2 - 0.02;
  framedRelief(parent, 0, panelCenter, -0.012, panelW, panelH, mat);
  const teeth = Math.max(4, Math.round(panelW / 0.072));
  const span = panelW * 0.84;
  for (let i = 0; i < teeth; i++) {
    const xx = -span / 2 + (i + 0.5) * (span / teeth);
    box(parent, xx, top - crown + 0.03, -0.026, Math.min(0.03, span / teeth * 0.42), 0.09, 0.016, mat.stone);
  }
  box(parent, 0, top - 0.2, -0.02, Math.min(width * 0.94, panelW + 0.06), 0.04, 0.02, mat.trim);
  box(parent, 0, top - 0.12, -0.026, Math.min(width * 0.98, panelW + 0.1), 0.055, 0.024, mat.trim);
  box(parent, 0, top - 0.045, -0.032, width * 0.98, 0.07, 0.026, mat.stone);
  return panelCenter - panelH / 2 - 0.04;
}

// 包角柱柱脚是方花板，和门厅柱的圆纹柱脚分开。
// 方板这一截比上面柱身再凸出约 4 厘米，花板贴在凸出的面上。4 厘米是造型尺寸。
const basePanelProject = 0.04;
function cornerBaseFace(parent: THREE.Object3D, span: number, mat: Mats) {
  const panelW = Math.min(0.44, Math.max(0.24, span));
  const panelH = Math.min(0.48, panelW * 1.08);
  const y = 0.18 + panelH / 2;
  const face = new THREE.Group();
  face.position.z = -0.018;
  parent.add(face);
  framedRelief(face, 0, y, -0.012, panelW, panelH, mat);
  return y + panelH / 2 + 0.04;
}

// 效果图1：竖纹只在正面，壁灯以上、柱头以下的一小段，四道细线，不铺满柱身。
function frontFlutes(parent: THREE.Object3D, y0: number, y1: number, width: number, mat: Mats) {
  if (y1 - y0 < 0.3 || width < 0.2) return;
  const count = 4;
  const span = Math.min(width * 0.42, 0.32);
  const pitch = span / (count - 1);
  const y = (y0 + y1) / 2;
  const h = y1 - y0;
  for (let i = 0; i < count; i++) {
    const xx = -span / 2 + i * pitch;
    box(parent, xx, y, -0.016, 0.012, h, 0.012, mat.dark);
  }
}

function roundMedallion(parent: THREE.Object3D, y: number, radius: number, mat: Mats) {
  const plaque = radius * 2.15;
  const z = -0.012;
  const face = new THREE.Group();
  face.position.z = -0.02;
  parent.add(face);
  box(face, 0, y, z, plaque, plaque, 0.016, mat.trim);
  box(face, 0, y + plaque / 2 - 0.015, z - 0.012, plaque, 0.02, 0.01, mat.stone);
  box(face, 0, y - plaque / 2 + 0.015, z - 0.012, plaque, 0.02, 0.01, mat.stone);
  box(face, plaque / 2 - 0.015, y, z - 0.012, 0.02, plaque, 0.01, mat.stone);
  box(face, -plaque / 2 + 0.015, y, z - 0.012, 0.02, plaque, 0.01, mat.stone);
  for (const r of [radius * 0.9, radius * 0.58]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.011, 6, 28), mat.stone);
    ring.position.set(0, y, z - 0.008);
    face.add(ring);
  }
  box(face, 0, y, z - 0.01, radius * 0.62, 0.014, 0.008, mat.dark);
  box(face, 0, y, z - 0.01, 0.014, radius * 0.62, 0.008, mat.dark);
}

export function carvedPilaster(
  parent: THREE.Object3D, x: number, z: number, base: number,
  height: number, width: number, mat: Mats, depth = 0.56, medallion = false,
) {
  const g = new THREE.Group();
  g.position.set(x, base, z);
  g.name = "新中式效果图1通高装饰柱";
  parent.add(g);
  box(g, 0, height / 2, 0, width, height, depth, mat.trim);
  box(g, 0, 0.07, 0, width + 0.1, 0.14, depth + 0.1, mat.stone);
  box(g, 0, 0.2, 0, width + 0.04, 0.12, depth + 0.04, mat.trim);
  // 柱脚方饰这一截四面都比上面柱身凸出约 4 厘米。
  const baseRadius = Math.min(0.17, Math.max(width, depth) * 0.92 * 0.24);
  const basePlaque = baseRadius * 2.15;
  box(g, 0, 0.64, 0, width + basePanelProject * 2, basePlaque + 0.04, depth + basePanelProject * 2, mat.trim);
  const dress = (face: THREE.Object3D, span: number, withMedallion: boolean, flutes: boolean) => {
    const shaftTop = columnCapitalFace(face, height, span, mat);
    if (withMedallion) roundMedallion(face, 0.64, Math.min(0.17, span * 0.24), mat);
    if (flutes) {
      const fluteTop = shaftTop - 0.9;
      frontFlutes(face, fluteTop - 1.25, fluteTop, span, mat);
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
  const project = 0.15;
  const leg = 0.5;
  const xOuter = outward * project;
  const xInner = -outward * leg;
  const frontW = leg + project;
  const frontX = (xOuter + xInner) / 2;
  const placeL = (y: number, h: number, lip: number, material: THREE.Material) => {
    const embed = 0.02;
    const outer = xOuter + outward * lip;
    const inner = xInner - outward * lip;
    const zFar = outwardZ * (project + lip);
    const zNear = -outwardZ * embed;
    box(g, (outer + inner) / 2, y, (zFar + zNear) / 2, frontW + lip * 2, h, Math.abs(zFar - zNear), material);
    const sideInner = -outward * embed;
    box(g, (outer + sideInner) / 2, y, -outwardZ * (leg + lip) / 2, project + lip + embed, h, leg + lip, material);
  };
  placeL(height / 2, height, 0, mat.sand);
  placeL(0.08, 0.16, 0.03, mat.stone);
  // 方花板所在的这一截，两面都比上面柱身再凸出约 4 厘米。
  placeL(0.42, 0.5, basePanelProject, mat.sand);
  // 柱顶这一截顶住上面的三眼皮，用英国棕。
  placeL(height - 0.05, 0.1, 0.03, mat.british);
  const dress = (face: THREE.Object3D, span: number) => {
    const shaftTop = columnCapitalFace(face, height, span, mat);
    const shaftBottom = cornerBaseFace(face, span * 0.92, mat);
    if (shaftTop - shaftBottom > 0.25)
      box(face, 0, (shaftBottom + shaftTop) / 2, -0.02, 0.034, shaftTop - shaftBottom, 0.02, mat.dark);
  };
  const frontFace = new THREE.Group();
  frontFace.position.set(frontX, 0, outwardZ * project);
  frontFace.rotation.y = outwardZ > 0 ? Math.PI : 0;
  g.add(frontFace);
  dress(frontFace, Math.min(0.48, frontW - 0.06));
  const sideFace = new THREE.Group();
  sideFace.position.set(xOuter, 0, -outwardZ * leg / 2);
  sideFace.rotation.y = outward > 0 ? -Math.PI / 2 : Math.PI / 2;
  g.add(sideFace);
  dress(sideFace, Math.min(0.4, leg - 0.04));
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
  box(g, 0, 0, 0, w, h, 0.04, mat.dark);
  const cols = Math.max(3, Math.round(w / 0.27));
  const rows = Math.max(2, Math.round(h / 0.3));
  const cw = w / cols;
  const ch = h / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const xx = -w / 2 + (c + 0.5) * cw;
      const yy = -h / 2 + (r + 0.5) * ch;
      const flip = (r + c) % 2 ? 1 : -1;
      box(g, xx, yy, -0.028, cw * 0.88, 0.02, 0.012, mat.trim);
      box(g, xx + flip * cw * 0.2, yy, -0.028, 0.02, ch * 0.88, 0.012, mat.trim);
    }
  }
  box(g, 0, h / 2, -0.02, w + 0.07, 0.045, 0.03, mat.trim);
  box(g, 0, -h / 2, -0.02, w + 0.07, 0.045, 0.03, mat.trim);
  box(g, -w / 2, 0, -0.02, 0.045, h, 0.03, mat.trim);
  box(g, w / 2, 0, -0.02, 0.045, h, 0.03, mat.trim);
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
  box(g, 0, 0, 0, w, h, 0.04, mat.bronze);
  box(g, 0, h / 2 - 0.018, -0.018, w, 0.026, 0.014, mat.bronzeDark);
  box(g, 0, -h / 2 + 0.018, -0.018, w, 0.026, 0.014, mat.bronzeDark);
  box(g, -w / 2 + 0.018, 0, -0.018, 0.026, h, 0.014, mat.bronzeDark);
  box(g, w / 2 - 0.018, 0, -0.018, 0.026, h, 0.014, mat.bronzeDark);
  const x0 = -w / 2 + 0.08, x1 = w / 2 - 0.08, y0 = -h / 2 + 0.07, y1 = h / 2 - 0.07;
  for (let b = -w - h; b <= w + h; b += 0.26) {
    const hits: [number, number][] = [];
    for (const [px, py] of [
      [x0, x0 + b],
      [x1, x1 + b],
      [y0 - b, y0],
      [y1 - b, y1],
    ] as [number, number][]) {
      if (px >= x0 - 0.02 && px <= x1 + 0.02 && py >= y0 - 0.02 && py <= y1 + 0.02)
        hits.push([Math.min(x1, Math.max(x0, px)), Math.min(y1, Math.max(y0, py))]);
    }
    if (hits.length < 2) continue;
    const a = hits[0], c = hits[hits.length - 1];
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.16) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, 0.01), mat.bronzeDark);
    mesh.position.set((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, -0.028);
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
  box(g, 0, 0.065, 0, width + 0.08, 0.13, width + 0.08, mat.stone);
  box(g, 0, height / 2, 0, width, height - 0.16, width, mat.trim);
  // 盖板厚 10 厘米，顶面齐在柱高。每边比柱身多出 10 厘米。下面一条线脚收在盖板下。
  const capThick = 0.1;
  box(g, 0, height - capThick - 0.03, 0, width + 0.06, 0.06, width + 0.06, mat.trim);
  box(g, 0, height - capThick / 2, 0, width + 0.2, capThick, width + 0.2, mat.stone);
  for (const angle of [0, Math.PI / 2, -Math.PI / 2]) {
    const face = new THREE.Group();
    face.rotation.y = angle;
    g.add(face);
    framedRelief(face, 0, height * 0.51, -width / 2 - 0.02, width - 0.1, height * 0.62, mat);
  }
  return g;
}

export function recessedHatPier(
  parent: THREE.Object3D, x: number, z: number, base: number, height: number, width: number, mat: Mats,
) {
  const g = new THREE.Group();
  g.position.set(x, base, z);
  parent.add(g);
  box(g, 0, height / 2, 0, width, height, 0.5, mat.trim);
  for (const sign of [-1, 1])
    box(g, sign * (width / 2 - 0.035), height / 2, -0.27, 0.035, height - 0.3, 0.03, mat.wall);
  box(g, 0, height - 0.14, -0.02, width + 0.1, 0.18, 0.57, mat.trim);
  box(g, 0, height - 0.51, -0.02, width + 0.04, 0.07, 0.55, mat.trim);
  meander(g, -width / 2 + 0.04, height - 0.37, -0.27, width - 0.08, mat);
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
  const count = Math.max(1, Math.ceil(length / 2.3));
  // 这组栏杆的 y 是 50 厘米挡墙顶。横条顶离露台地面约 1.18 米，停在柱盖板下面。
  const railTop = 0.68;
  const railH = 0.05;
  const railY = railTop - railH / 2;
  const glassBottom = 0.02;
  const glassTop = railY - railH / 2;
  for (let i = 0; i < count; i++) {
    const span = length / count;
    // 玻璃和横条都收到柱中心，柱身挡住之后，外面看是嵌进柱子里。
    box(g, (i + 0.5) * span, (glassBottom + glassTop) / 2, 0, Math.max(0.05, span - 0.02), glassTop - glassBottom, 0.012, mat.glass, false);
    box(g, (i + 0.5) * span, railY, 0, span, railH, 0.075, mat.dark, false);
  }
  for (let i = omitStart ? 1 : 0; i <= count; i++) {
    const xx = i * length / count;
    const postBottom = 0.02;
    box(g, xx, (postBottom + railTop) / 2, 0, 0.035, railTop - postBottom, 0.045, mat.dark, false);
  }
}

// 三眼皮：最上层探出最多，往下逐层收进。板厚和错台是造型。
const eyelidThick = 0.042;
const eyelidGap = 0.028;
const eyelidStep = 0.07;
const eyelidDepth = 0.4;

// 三眼皮最下一层的板底。瓦外沿在 tileTop - drop，三眼皮再低 5 厘米，三层逐级下落。
export function apronFasciaBottom(tileTop: number, drop: number) {
  const underside = tileTop - drop - 0.05;
  return underside - 2 * (eyelidThick + eyelidGap) - eyelidThick;
}

function eyelidGroup(parent: THREE.Object3D) {
  const g = new THREE.Group();
  g.name = "三眼皮檐口";
  parent.add(g);
  return g;
}

// 天沟下的出檐做成三层薄板。最上层探出最多，往下逐层收进，成阶梯。
function tripleEyelid(
  parent: THREE.Object3D,
  x: number, z: number, w: number, d: number, underside: number, mat: Mats,
) {
  const g = eyelidGroup(parent);
  for (let i = 0; i < 3; i++) {
    const inset = eyelidStep * i;
    slab(g, rect(x + inset, z + inset, w - 2 * inset, d - 2 * inset), underside - i * (eyelidThick + eyelidGap), eyelidThick, mat.british, [
      rect(x + eyelidDepth, z + eyelidDepth, w - 2 * eyelidDepth, d - 2 * eyelidDepth),
    ]);
  }
  return g;
}

// 朝墙内收一圈。拐角按统一垂直距离收，避免斜向点收得过多。
function insetToward(outer: Point[], inner: Point[], dist: number): Point[] {
  let projection = Infinity;
  for (let i = 0; i < outer.length; i++) {
    const dx = Math.abs(outer[i][0] - inner[i][0]);
    const dz = Math.abs(outer[i][1] - inner[i][1]);
    if (dx > 0.01 && dz <= 0.01) projection = Math.min(projection, dx);
    if (dz > 0.01 && dx <= 0.01) projection = Math.min(projection, dz);
  }
  const span = Number.isFinite(projection) ? projection : 0.7;
  const t = dist / span;
  return outer.map((p, i) => {
    const q = inner[i];
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  });
}

// 沿一条外挑折线做三眼皮。外沿与最上层齐平，背面收到墙边，不封成整圈天花板。
function polylineEyelid(
  parent: THREE.Object3D, outer: Point[], inner: Point[], underside: number, mat: Mats,
) {
  const g = eyelidGroup(parent);
  for (let i = 0; i < 3; i++) {
    const rim = insetToward(outer, inner, eyelidStep * i);
    const back = insetToward(outer, inner, eyelidDepth);
    slab(g, [...rim, ...back.slice().reverse()], underside - i * (eyelidThick + eyelidGap), eyelidThick, mat.british);
  }
  return g;
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

// 四坡五脊按分水计：水平 10，升高若干。瓦面四边比天沟外沿各内收 0.28 米，
// 四坡共用较短一边的一半作为水平距离。
export function hipRise(width: number, depth: number, fenShui = 4.5) {
  const run = (Math.min(width, depth) - 0.56) / 2;
  return (fenShui / 10) * run;
}

// 坡瓦收于有底、有外挡边的环形天沟内。瓦边缩进，避免穿出天沟及用地边界。
// bay 把前檐中段和官帽连成同一条天沟、同一圈三眼皮。
export function gutteredRoof(
  parent: THREE.Object3D,
  x: number, z: number, w: number, d: number,
  base: number, rise: number, mat: Mats,
  bay?: { x: number; w: number; z: number },
) {
  const g = new THREE.Group();
  g.name = "四坡五脊瓦顶与环形天沟";
  parent.add(g);
  const gutterWidth = 0.26;
  const fascia = 0.055;
  const outer = bay ? bayOutline(x, z, w, d, bay.x, bay.w, bay.z, 0) : rect(x, z, w, d);
  const panHole = bay
    ? bayOutline(x, z, w, d, bay.x, bay.w, bay.z, gutterWidth)
    : rect(x + gutterWidth, z + gutterWidth, w - 2 * gutterWidth, d - 2 * gutterWidth);
  const fasciaHole = bay
    ? bayOutline(x, z, w, d, bay.x, bay.w, bay.z, fascia)
    : rect(x + fascia, z + fascia, w - 2 * fascia, d - 2 * fascia);
  slab(g, outer, base + 0.025, 0.075, mat.dark, [panHole]).name = "天沟槽底";
  slab(g, outer, base + 0.145, 0.12, mat.trim, [fasciaHole]).name = "天沟外挡边";
  if (bay) {
    const lids = eyelidGroup(g);
    for (let i = 0; i < 3; i++)
      slab(
        lids,
        bayOutline(x, z, w, d, bay.x, bay.w, bay.z, eyelidStep * i),
        base - 0.058 - i * (eyelidThick + eyelidGap),
        eyelidThick,
        mat.british,
        [bayOutline(x, z, w, d, bay.x, bay.w, bay.z, eyelidDepth)],
      );
  } else
    tripleEyelid(g, x, z, w, d, base - 0.058, mat);
  hipRoof(g, x + w / 2, z + d / 2, w - 0.56, d - 0.56, base + 0.08, rise, mat);
  return g;
}

function commitTiled(
  parent: THREE.Object3D,
  point: (u: number, v: number) => THREE.Vector3,
  across: number, rows: number, mat: Mats, skipFirstRib = false,
) {
  const positions: number[] = [], joints: number[] = [];
  const segments: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < across; i++) {
    for (let j = 0; j < rows; j++) {
      const p = point(i / across, j / rows), q = point((i + 1) / across, j / rows);
      const r = point((i + 1) / across, (j + 1) / rows), s = point(i / across, (j + 1) / rows);
      for (const v of [p, q, r, p, r, s]) positions.push(v.x, v.y, v.z);
      if (j > 0) joints.push(p.x, p.y + 0.012, p.z, q.x, q.y + 0.012, q.z);
    }
  }
  for (let i = skipFirstRib ? 1 : 0; i <= across; i++)
    for (let j = 0; j < rows; j++) {
      const a = point(i / across, j / rows), b = point(i / across, (j + 1) / rows);
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      if (run < 1e-6) continue;
      const lift = 0.028 * Math.hypot(1, (b.y - a.y) / run) + 0.006;
      a.y += lift; b.y += lift;
      segments.push([a, b]);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = mat.roof.clone();
  material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  if (segments.length) {
    const tileRibs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.028, 0.028, 1, 6), mat.roof, segments.length);
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    segments.forEach(([a, b], i) => {
      const direction = b.clone().sub(a);
      rotation.setFromUnitVectors(up, direction.clone().normalize());
      matrix.compose(a.clone().add(b).multiplyScalar(0.5), rotation, new THREE.Vector3(1, direction.length(), 1));
      tileRibs.setMatrixAt(i, matrix);
    });
    tileRibs.castShadow = tileRibs.receiveShadow = true;
    parent.add(tileRibs);
  }
  const seams = new THREE.BufferGeometry();
  seams.setAttribute("position", new THREE.Float32BufferAttribute(joints, 3));
  parent.add(new THREE.LineSegments(seams, new THREE.LineBasicMaterial({ color: 0x222b2b })));
}

// 一片从低檐到高边的坡瓦。高边可收为一点，供官帽正面的三角坡使用。
function tiledSlope(
  parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3,
  c: THREE.Vector3, d: THREE.Vector3, mat: Mats, curve = 1.12,
) {
  const across = Math.max(2, Math.ceil(Math.max(a.distanceTo(b), c.distanceTo(d)) / 0.18));
  const rows = Math.max(2, Math.ceil(Math.max(a.distanceTo(c), b.distanceTo(d)) / 0.22));
  const point = (u: number, v: number) => {
    const low = a.clone().lerp(b, u), high = c.clone().lerp(d, u);
    const p = low.clone().lerp(high, v);
    p.y = low.y + (high.y - low.y) * Math.pow(Math.min(1, Math.max(0, v)), curve);
    return p;
  };
  commitTiled(parent, point, across, rows, mat);
}

// 转角补一块三角坡。lowA 贴着直段外沿，lowB 是外角，high 是内角。瓦垄与相邻直段平行，在斜脊处收住。
function tiledWedge(
  parent: THREE.Object3D,
  lowA: THREE.Vector3, lowB: THREE.Vector3, high: THREE.Vector3, mat: Mats,
) {
  const span = lowA.distanceTo(lowB), rise = lowA.distanceTo(high);
  if (span < 0.04 || rise < 0.04) return;
  const across = Math.max(1, Math.ceil(span / 0.18));
  const rows = Math.max(2, Math.ceil(rise / 0.22));
  const point = (u: number, v: number) => {
    const low = lowA.clone().lerp(lowB, u);
    const end = high.clone().lerp(lowB, u);
    return low.lerp(end, v);
  };
  commitTiled(parent, point, across, rows, mat, true);
}

// 直段外沿按法向平移，长度与内沿相同。转角的斜出留在 outer 折点上，交给三角坡。
function apronRun(innerA: Point, innerB: Point, outerA: Point) {
  const dx = innerB[0] - innerA[0], dz = innerB[1] - innerA[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return null;
  let nx = -dz / len, nz = dx / len;
  const ox = outerA[0] - innerA[0], oz = outerA[1] - innerA[1];
  if (nx * ox + nz * oz < 0) { nx = -nx; nz = -nz; }
  const eave = Math.abs(nx * ox + nz * oz);
  if (eave < 0.02) return null;
  return {
    aOut: [innerA[0] + nx * eave, innerA[1] + nz * eave] as Point,
    bOut: [innerB[0] + nx * eave, innerB[1] + nz * eave] as Point,
  };
}

// 沿前后错位的阳台边缘铺一圈单坡瓦，不把可行走楼板向外扩大。
// 直段是矩形坡，转角分成两块三角坡，在斜脊处相接，避免瓦面被拉斜。
export function tiledApron(
  parent: THREE.Object3D, inner: Point[], outer: Point[], top: number, drop: number, mat: Mats,
) {
  const g = new THREE.Group();
  g.name = "三楼栏杆下沿外挑70厘米连续瓦檐";
  parent.add(g);
  const at = (p: Point, y: number) => new THREE.Vector3(p[0], y, p[1]);
  const yLow = top - drop, yHigh = top;
  const runs = inner.slice(0, -1).map((a, i) => apronRun(a, inner[i + 1], outer[i]));
  runs.forEach((run, i) => {
    if (!run) return;
    tiledSlope(g, at(run.aOut, yLow), at(run.bOut, yLow), at(inner[i], yHigh), at(inner[i + 1], yHigh), mat, 1);
  });
  for (let k = 1; k < inner.length - 1; k++) {
    const prev = runs[k - 1], next = runs[k];
    if (!prev || !next) continue;
    tiledWedge(g, at(prev.bOut, yLow), at(outer[k], yLow), at(inner[k], yHigh), mat);
    tiledWedge(g, at(next.aOut, yLow), at(outer[k], yLow), at(inner[k], yHigh), mat);
  }
  // 瓦檐下面改成三眼皮，外沿仍是原来的出檐控制线。
  polylineEyelid(g, outer, inner, yLow - 0.05, mat);
  return g;
}

// 官帽是与正屋相接的前伸屋面：前面收坡，纵脊向后接正屋脊，接入处不设横向后檐。
export function projectingHatRoof(
  parent: THREE.Object3D, center: number, front: number, width: number,
  joinZ: number, eave: number, peak: number, mat: Mats,
) {
  const g = new THREE.Group();
  g.name = "中央官帽";
  parent.add(g);
  const left = center - width / 2, right = center + width / 2;
  const tileInset = 0.28;
  const a = new THREE.Vector3(left + tileInset, eave + 0.08, front + tileInset);
  const b = new THREE.Vector3(right - tileInset, eave + 0.08, front + tileInset);
  const ridge = new THREE.Vector3(center, peak, front + width * 0.42);
  const join = new THREE.Vector3(center, peak, joinZ);
  tiledSlope(g, a, b, ridge, ridge, mat);
  tiledSlope(g, new THREE.Vector3(left + tileInset, a.y, joinZ), a, join, ridge, mat);
  tiledSlope(g, b, new THREE.Vector3(right - tileInset, b.y, joinZ), ridge, join, mat);
  for (const [p, q] of [[a, ridge], [b, ridge], [ridge, join]])
    cylinder(g, p.clone().add(new THREE.Vector3(0, 0.045, 0)), q.clone().add(new THREE.Vector3(0, 0.045, 0)), 0.09, mat.roof, 10);
  return g;
}

// 窗套贴在墙外皮之外，只加正面线脚。
export function openingFrame(
  parent: THREE.Object3D,
  x: number, sill: number, z: number,
  w: number, h: number, mat: Mats,
  edges: { top?: boolean; bottom?: boolean } = {},
) {
  const t = 0.07, d = 0.04;
  if (edges.top !== false)
    box(parent, x, sill + h + t / 2, z, w + t * 2, t, d, mat.trim);
  if (edges.bottom !== false)
    box(parent, x, sill - t / 2, z, w + t * 2, t, d, mat.stone);
  box(parent, x - w / 2 - t / 2, sill + h / 2, z, t, h, d, mat.trim);
  box(parent, x + w / 2 + t / 2, sill + h / 2, z, t, h, d, mat.trim);
}
