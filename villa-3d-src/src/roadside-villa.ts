import * as THREE from "three";
import { MM_PER_M } from "./units";
import { roadsideVilla as h, type Point } from "./data";
import { box, cylinder, rect, slab, wallWithOpenings, type Mats } from "./primitives";

const balusterGeometry = new THREE.LatheGeometry([
  [60, 0], [60, 60], [34, 130], [44, 210],
  [75, 350], [48, 500], [32, 620], [48, 730],
  [60, 790], [60, 830],
].map(([r, y]) => new THREE.Vector2(r, y)), 10);

function tileMaterial(kind: "roof" | "yard") {
  // Node 测试无 document 时退回纯色，避免整栋邻房构建失败。
  if (typeof document === "undefined") {
    return new THREE.MeshStandardMaterial({
      color: kind === "roof" ? 0x42669c : 0xc5c2b8,
      roughness: kind === "roof" ? 0.57 : 0.87,
    });
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  if (kind === "roof") {
    ctx.fillStyle = "#42669c";
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) {
      ctx.fillStyle = "#34527f";
      ctx.fillRect(0, y, 256, 2);
      ctx.fillStyle = "#7791b8";
      ctx.fillRect(0, y + 3, 256, 1);
    }
    for (let x = 0; x < 256; x += 32) {
      ctx.fillStyle = "#2e4f7b";
      ctx.fillRect(x, 0, 2, 256);
      ctx.fillStyle = "#5978a5";
      ctx.fillRect(x + 3, 0, 2, 256);
    }
  } else {
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 4; col++) {
        ctx.fillStyle = (row + col) % 2 ? "#71858b" : "#e1ded6";
        ctx.fillRect(col * 64, row * 64, 64, 64);
        ctx.strokeStyle = "#aaa8a2";
        ctx.lineWidth = 0.8;
        ctx.strokeRect(col * 64, row * 64, 64, 64);
      }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  // 世界 UV 为毫米：每米一个贴图周期＝重复数 1/1000。
  if (kind === "roof") map.repeat.set(1 / MM_PER_M, 1 / MM_PER_M);
  if (kind === "yard") {
    map.center.set(0.5, 0.5);
    map.rotation = Math.PI / 4;
    map.repeat.set(0.55 / MM_PER_M, 0.55 / MM_PER_M);
  }
  return new THREE.MeshStandardMaterial({ map, roughness: kind === "roof" ? 0.57 : 0.87 });
}

function stoneRail(parent: THREE.Object3D, a: Point, b: Point, y: number, mat: Mats) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.Group();
  g.name = "粉白瓶柱栏杆";
  g.position.set(a[0], y, a[1]);
  g.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  parent.add(g);
  box(g, length / 2, 75, 0, length, 150, 190, mat.trim);
  box(g, length / 2, 1010, 0, length + 30, 150, 220, mat.trim);
  const count = Math.ceil(length / 240);
  for (let i = 1; i < count; i++) {
    const baluster = new THREE.Mesh(balusterGeometry, mat.inside);
    baluster.position.set(i * length / count, 140, 0);
    baluster.castShadow = baluster.receiveShadow = true;
    g.add(baluster);
  }
  for (const x of [0, length]) {
    box(g, x, 560, 0, 220, 1120, 220, mat.trim);
    box(g, x, 1160, 0, 280, 100, 280, mat.inside);
  }
  return g;
}

function romanColumn(parent: THREE.Object3D, x: number, z: number, y: number, height: number, mat: Mats) {
  const g = new THREE.Group();
  g.name = "罗马柱门厅";
  g.position.set(x, y, z);
  parent.add(g);
  box(g, 0, 140, 0, 580, 280, 580, mat.trim);
  box(g, 0, 320, 0, 440, 90, 440, mat.inside);
  const shaftHeight = height - 650;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(175, 200, shaftHeight, 16), mat.trim);
  shaft.position.y = 370 + shaftHeight / 2;
  shaft.castShadow = shaft.receiveShadow = true;
  g.add(shaft);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    cylinder(g,
      new THREE.Vector3(Math.cos(angle) * 180, 480, Math.sin(angle) * 180),
      new THREE.Vector3(Math.cos(angle) * 160, height - 420, Math.sin(angle) * 160),
      16, mat.inside, 5);
  }
  box(g, 0, height - 200, 0, 440, 130, 440, mat.inside);
  box(g, 0, height - 75, 0, 570, 120, 570, mat.trim);
}

function blueRoof(parent: THREE.Object3D, mat: Mats, eaveY: number) {
  const g = new THREE.Group();
  g.name = "蓝瓦四坡五脊与前伸官帽";
  parent.add(g);
  const X = h.w / 2 + h.eave, Z = h.d / 2 + h.eave;
  const ridgeHalf = X - Z;
  const hatHalf = h.portico.w / 2 + 350;
  const hatFront = -h.d / 2 - h.portico.d - h.eave;
  const peak = eaveY + h.roofRise;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const a = v(-X, eaveY, -Z), b = v(X, eaveY, -Z);
  const c = v(X, eaveY, Z), d = v(-X, eaveY, Z);
  const leftRidge = v(-ridgeHalf, peak, 0), rightRidge = v(ridgeHalf, peak, 0);
  const join = v(0, peak, 0);
  const leftValley = v(-hatHalf, eaveY, -Z), rightValley = v(hatHalf, eaveY, -Z);
  const hatLeft = v(-hatHalf, eaveY, hatFront), hatRight = v(hatHalf, eaveY, hatFront);
  const hatRidge = v(0, peak, hatFront);
  // 正屋前坡留出官帽占用的三角区域，屋面沿谷线相接，不在原瓦面上叠一块独立小顶。
  const panels = [
    [a, leftValley, join, leftRidge], [rightValley, b, rightRidge, join],
    [b, c, rightRidge], [d, a, leftRidge], [c, d, leftRidge, rightRidge],
    [hatLeft, leftValley, join, hatRidge], [rightValley, hatRight, hatRidge, join],
  ];
  const positions: number[] = [], uvs: number[] = [];
  for (const panel of panels) {
    const across = panel[1].clone().sub(panel[0]).normalize();
    const normal = panel[1].clone().sub(panel[0]).cross(panel[2].clone().sub(panel[0])).normalize();
    const down = normal.clone().cross(across).normalize();
    for (let i = 1; i < panel.length - 1; i++) {
      const tri = [panel[0], panel[i], panel[i + 1]];
      if (tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0])).y < 0)
        [tri[1], tri[2]] = [tri[2], tri[1]];
      for (const p of tri) {
        positions.push(p.x, p.y, p.z);
        uvs.push(p.dot(across) / 1.2, p.dot(down) / 1.2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const roofMaterial = tileMaterial("roof");
  roofMaterial.side = THREE.DoubleSide;
  const roof = new THREE.Mesh(geometry, roofMaterial);
  roof.castShadow = roof.receiveShadow = true;
  g.add(roof);
  const outline: Point[] = [
    [-X, -Z], [-hatHalf, -Z], [-hatHalf, hatFront], [hatHalf, hatFront],
    [hatHalf, -Z], [X, -Z], [X, Z], [-X, Z],
  ];
  slab(g, outline, eaveY - 35, 160, mat.trim);
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x345485, roughness: 0.62 });
  for (const [p, q] of [[a, leftRidge], [b, rightRidge], [c, rightRidge], [d, leftRidge], [leftRidge, rightRidge], [hatRidge, join]])
    cylinder(g, p.clone().add(v(0, 55, 0)), q.clone().add(v(0, 55, 0)), 75, ridgeMat, 10);
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i], q = outline[(i + 1) % outline.length];
    cylinder(g, v(p[0], eaveY + 18, p[1]), v(q[0], eaveY + 18, q[1]), 55, mat.dark, 6);
  }
  for (const p of [hatLeft, hatRight])
    cylinder(g, p.clone().add(v(0, 35, -15)), hatRidge.clone().add(v(0, 35, -15)), 50, ridgeMat, 8);

  const tympanum = new THREE.Shape();
  tympanum.moveTo(-hatHalf + 120, eaveY - 40);
  tympanum.lineTo(hatHalf - 120, eaveY - 40);
  tympanum.lineTo(0, peak - 120);
  tympanum.closePath();
  const arch = new THREE.Path();
  arch.moveTo(-270, eaveY + 180);
  arch.lineTo(-270, eaveY + 820);
  arch.absarc(0, eaveY + 820, 270, Math.PI, 0, true);
  arch.lineTo(270, eaveY + 180);
  arch.closePath();
  tympanum.holes.push(arch);
  const triangle = new THREE.Mesh(new THREE.ExtrudeGeometry(tympanum, { depth: 140, bevelEnabled: false }), mat.inside);
  triangle.position.z = hatFront + 80;
  triangle.castShadow = triangle.receiveShadow = true;
  g.add(triangle);
  box(g, 0, eaveY + 660, hatFront + 200, 560, 1050, 25, mat.glass, false);
}

export function buildRoadsideVilla(baseMat: Mats) {
  const group = new THREE.Group();
  group.name = "主马路边蓝顶三层邻房";
  group.position.set(h.x, h.y, h.z);
  group.rotation.y = h.rotation;
  group.userData.evidence = "照片估算";
  const plain = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const mat: Mats = {
    ...baseMat,
    wall: plain(0xc6c4bf), inside: plain(0xe3ddd1), trim: plain(0xcda7a5),
    dark: plain(0x333c43), bronze: plain(0x55342e), bronzeDark: plain(0x382a27),
  };
  const front = -h.d / 2, back = h.d / 2, west = -h.w / 2, east = h.w / 2;
  const porticoFront = front - h.portico.d;
  const bayCenters = [-h.w / 3, 0, h.w / 3];
  let base = 0;
  for (let floor = 0; floor < h.floorHeights.length; floor++) {
    const height = h.floorHeights[floor];
    const level = new THREE.Group();
    level.name = `蓝顶邻房${floor + 1}楼`;
    group.add(level);
    wallWithOpenings(level, [west, front], [east, front], base, height,
      bayCenters.map((x, i) => ({
        at: x - west, w: i === 1 ? 2150 : 2050,
        sill: i === 1 ? 0 : 720, h: i === 1 ? 2660 : 2040,
        door: i === 1, glazed: i === 1 && floor > 0,
      })), mat);
    wallWithOpenings(level, [west, back], [east, back], base, height,
      bayCenters.map((x) => ({ at: x - west, w: 1450, sill: 1000, h: 1550 })), mat);
    wallWithOpenings(level, [west, front], [west, back], base, height,
      floor === 2
        ? [{ at: 2000, w: 1300, sill: 950, h: 1550 }, { at: h.d - 1900, w: 3300, sill: 0, h: height - 220, open: true }]
        : [{ at: 2200, w: 1250, sill: 1060, h: 1450 }], mat);
    wallWithOpenings(level, [east, front], [east, back], base, height,
      floor === 0 ? [] : [{ at: 2200, w: 1200, sill: 950, h: 1600 }, { at: 7000, w: 1450, sill: 950, h: 1600 }], mat);
    slab(level, rect(west, front, h.w, h.d), base + 25, 160, mat.inside);
    if (floor === 0) {
      // 照片中的下部粉色墙裙，只附在外侧，不盖住窗洞。
      const skirtWidth = h.w / 2 - 1180;
      for (const sign of [-1, 1])
        box(level, sign * (1180 + skirtWidth / 2), 280, front - 140, skirtWidth, 560, 25, mat.trim);
      box(level, west - 140, 280, 0, 25, 560, h.d, mat.trim);
    } else {
      slab(level, rect(-h.portico.w / 2, porticoFront, h.portico.w, h.portico.d), base + 25, 190, mat.inside);
      stoneRail(level, [-h.portico.w / 2, porticoFront], [h.portico.w / 2, porticoFront], base + 25, mat);
      for (const x of [-h.portico.w / 2, h.portico.w / 2])
        stoneRail(level, [x, porticoFront + 80], [x, front - 100], base + 25, mat);
    }
    for (const x of [-h.portico.w / 2 + 270, h.portico.w / 2 - 270])
      romanColumn(level, x, porticoFront + 270, base + 30, height - 120, mat);
    box(level, 0, base + height - 100, porticoFront + 50, h.portico.w + 60, 200, 240, mat.trim);
    if (floor === 2) {
      stoneRail(level, [west - 25, back - 3450], [west - 25, back - 200], base + 25, mat);
      box(level, west + 650, base + 480, back - 1700, 450, 100, 1700, baseMat.wood);
    }
    for (const x of [west + 110, east - 110])
      box(level, x, base + height / 2, front - 150, 260, height, 120, mat.trim);
    base += height;
  }
  blueRoof(group, mat, base);

  const wing = new THREE.Group();
  wing.name = "面对蓝顶邻房左侧单层平顶柴火房";
  group.add(wing);
  const wingFront = front + h.wing.setback, wingBack = wingFront + h.wing.d;
  wallWithOpenings(wing, [east, wingFront], [east + h.wing.w, wingFront], 0, h.wing.h,
    [{ at: h.wing.w * 0.3, w: 1250, sill: 0, h: 2450, door: true },
      { at: h.wing.w * 0.72, w: 1400, sill: 920, h: 1400 }], mat);
  wallWithOpenings(wing, [east + h.wing.w, wingFront], [east + h.wing.w, wingBack], 0, h.wing.h,
    [{ at: h.wing.d * 0.45, w: 1500, sill: 1000, h: 1350 }], mat);
  box(wing, east + h.wing.w / 2, h.wing.h / 2, wingBack, h.wing.w, h.wing.h, 240, mat.wall);
  slab(wing, rect(east, wingFront, h.wing.w, h.wing.d), 25, 160, mat.inside);
  slab(wing, rect(east - 20, wingFront - 120, h.wing.w + 180, h.wing.d + 240), h.wing.h + 90, 180, mat.wall);
  for (const [a, b] of [
    [[east + 100, wingFront], [east + h.wing.w, wingFront]],
    [[east + h.wing.w, wingFront], [east + h.wing.w, wingBack]],
    [[east + 100, wingBack], [east + h.wing.w, wingBack]],
  ] as [Point, Point][])
    stoneRail(wing, a, b, h.wing.h + 90, { ...mat, trim: mat.wall });

  // 台基沉入台地，减少墙脚穿模；前坪用略深铺装，避免大块发白空白感。
  const yardFront = porticoFront - 950;
  const yardEast = east + h.wing.w;
  const foundation = new THREE.Group();
  foundation.name = "蓝顶邻房台基";
  group.add(foundation);
  box(
    foundation,
    (west + yardEast) / 2,
    -220,
    (yardFront + back) / 2,
    yardEast - west + 550,
    440,
    back - yardFront + 350,
    mat.stone,
  );
  // 柴火房一侧补一截石裙，遮住田坎立面穿插。
  box(
    foundation,
    east + h.wing.w / 2,
    -180,
    (wingFront + wingBack) / 2,
    h.wing.w + 350,
    360,
    h.wing.d + 300,
    mat.stone,
  );

  const yard = new THREE.Group();
  yard.name = "蓝顶邻房前坪·首层同高";
  group.add(yard);
  const yardPad = baseMat.paving.clone();
  yardPad.color = new THREE.Color(0x9a978c);
  yardPad.roughness = 0.92;
  slab(yard, rect(west - 200, yardFront, yardEast - west + 400, front - yardFront), 20, 160, yardPad);
  // 只画首层前坪及矮基础；不生成地下室、地下车位或架空柱。
  stoneRail(yard, [west, yardFront + 80], [-1250, yardFront + 80], 20, mat);
  stoneRail(yard, [1250, yardFront + 80], [yardEast, yardFront + 80], 20, mat);
  stoneRail(yard, [west - 130, yardFront + 80], [west - 130, front], 20, mat);
  stoneRail(yard, [yardEast + 120, yardFront + 80], [yardEast + 120, wingFront], 20, mat);
  return group;
}
