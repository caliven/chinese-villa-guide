import * as THREE from "three";
import { roadsideVilla as h, type Point } from "./data";
import { box, cylinder, rect, slab, wallWithOpenings, type Mats } from "./primitives";

const balusterGeometry = new THREE.LatheGeometry([
  [0.06, 0], [0.06, 0.06], [0.034, 0.13], [0.044, 0.21],
  [0.075, 0.35], [0.048, 0.5], [0.032, 0.62], [0.048, 0.73],
  [0.06, 0.79], [0.06, 0.83],
].map(([r, y]) => new THREE.Vector2(r, y)), 10);

function tileMaterial(kind: "roof" | "yard") {
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
  if (kind === "yard") {
    map.center.set(0.5, 0.5);
    map.rotation = Math.PI / 4;
    map.repeat.set(0.55, 0.55);
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
  box(g, length / 2, 0.075, 0, length, 0.15, 0.19, mat.trim);
  box(g, length / 2, 1.01, 0, length + 0.03, 0.15, 0.22, mat.trim);
  const count = Math.ceil(length / 0.24);
  for (let i = 1; i < count; i++) {
    const baluster = new THREE.Mesh(balusterGeometry, mat.inside);
    baluster.position.set(i * length / count, 0.14, 0);
    baluster.castShadow = baluster.receiveShadow = true;
    g.add(baluster);
  }
  for (const x of [0, length]) {
    box(g, x, 0.56, 0, 0.22, 1.12, 0.22, mat.trim);
    box(g, x, 1.16, 0, 0.28, 0.1, 0.28, mat.inside);
  }
  return g;
}

function romanColumn(parent: THREE.Object3D, x: number, z: number, y: number, height: number, mat: Mats) {
  const g = new THREE.Group();
  g.name = "罗马柱门厅";
  g.position.set(x, y, z);
  parent.add(g);
  box(g, 0, 0.14, 0, 0.58, 0.28, 0.58, mat.trim);
  box(g, 0, 0.32, 0, 0.44, 0.09, 0.44, mat.inside);
  const shaftHeight = height - 0.65;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.2, shaftHeight, 16), mat.trim);
  shaft.position.y = 0.37 + shaftHeight / 2;
  shaft.castShadow = shaft.receiveShadow = true;
  g.add(shaft);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    cylinder(g,
      new THREE.Vector3(Math.cos(angle) * 0.18, 0.48, Math.sin(angle) * 0.18),
      new THREE.Vector3(Math.cos(angle) * 0.16, height - 0.42, Math.sin(angle) * 0.16),
      0.016, mat.inside, 5);
  }
  box(g, 0, height - 0.2, 0, 0.44, 0.13, 0.44, mat.inside);
  box(g, 0, height - 0.075, 0, 0.57, 0.12, 0.57, mat.trim);
}

function blueRoof(parent: THREE.Object3D, mat: Mats, eaveY: number) {
  const g = new THREE.Group();
  g.name = "蓝瓦四坡五脊与前伸官帽";
  parent.add(g);
  const X = h.w / 2 + h.eave, Z = h.d / 2 + h.eave;
  const ridgeHalf = X - Z;
  const hatHalf = h.portico.w / 2 + 0.35;
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
  slab(g, outline, eaveY - 0.035, 0.16, mat.trim);
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x345485, roughness: 0.62 });
  for (const [p, q] of [[a, leftRidge], [b, rightRidge], [c, rightRidge], [d, leftRidge], [leftRidge, rightRidge], [hatRidge, join]])
    cylinder(g, p.clone().add(v(0, 0.055, 0)), q.clone().add(v(0, 0.055, 0)), 0.075, ridgeMat, 10);
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i], q = outline[(i + 1) % outline.length];
    cylinder(g, v(p[0], eaveY + 0.018, p[1]), v(q[0], eaveY + 0.018, q[1]), 0.055, mat.dark, 6);
  }
  for (const p of [hatLeft, hatRight])
    cylinder(g, p.clone().add(v(0, 0.035, -0.015)), hatRidge.clone().add(v(0, 0.035, -0.015)), 0.05, ridgeMat, 8);

  const tympanum = new THREE.Shape();
  tympanum.moveTo(-hatHalf + 0.12, eaveY - 0.04);
  tympanum.lineTo(hatHalf - 0.12, eaveY - 0.04);
  tympanum.lineTo(0, peak - 0.12);
  tympanum.closePath();
  const arch = new THREE.Path();
  arch.moveTo(-0.27, eaveY + 0.18);
  arch.lineTo(-0.27, eaveY + 0.82);
  arch.absarc(0, eaveY + 0.82, 0.27, Math.PI, 0, true);
  arch.lineTo(0.27, eaveY + 0.18);
  arch.closePath();
  tympanum.holes.push(arch);
  const triangle = new THREE.Mesh(new THREE.ExtrudeGeometry(tympanum, { depth: 0.14, bevelEnabled: false }), mat.inside);
  triangle.position.z = hatFront + 0.08;
  triangle.castShadow = triangle.receiveShadow = true;
  g.add(triangle);
  box(g, 0, eaveY + 0.66, hatFront + 0.2, 0.56, 1.05, 0.025, mat.glass, false);
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
        at: x - west, w: i === 1 ? 2.15 : 2.05,
        sill: i === 1 ? 0 : 0.72, h: i === 1 ? 2.66 : 2.04,
        door: i === 1, glazed: i === 1 && floor > 0,
      })), mat);
    wallWithOpenings(level, [west, back], [east, back], base, height,
      bayCenters.map((x) => ({ at: x - west, w: 1.45, sill: 1, h: 1.55 })), mat);
    wallWithOpenings(level, [west, front], [west, back], base, height,
      floor === 2
        ? [{ at: 2, w: 1.3, sill: 0.95, h: 1.55 }, { at: h.d - 1.9, w: 3.3, sill: 0, h: height - 0.22, open: true }]
        : [{ at: 2.2, w: 1.25, sill: 1.06, h: 1.45 }], mat);
    wallWithOpenings(level, [east, front], [east, back], base, height,
      floor === 0 ? [] : [{ at: 2.2, w: 1.2, sill: 0.95, h: 1.6 }, { at: 7, w: 1.45, sill: 0.95, h: 1.6 }], mat);
    slab(level, rect(west, front, h.w, h.d), base + 0.025, 0.16, mat.inside);
    if (floor === 0) {
      // 照片中的下部粉色墙裙，只附在外侧，不盖住窗洞。
      const skirtWidth = h.w / 2 - 1.18;
      for (const sign of [-1, 1])
        box(level, sign * (1.18 + skirtWidth / 2), 0.28, front - 0.14, skirtWidth, 0.56, 0.025, mat.trim);
      box(level, west - 0.14, 0.28, 0, 0.025, 0.56, h.d, mat.trim);
    } else {
      slab(level, rect(-h.portico.w / 2, porticoFront, h.portico.w, h.portico.d), base + 0.025, 0.19, mat.inside);
      stoneRail(level, [-h.portico.w / 2, porticoFront], [h.portico.w / 2, porticoFront], base + 0.025, mat);
      for (const x of [-h.portico.w / 2, h.portico.w / 2])
        stoneRail(level, [x, porticoFront + 0.08], [x, front - 0.1], base + 0.025, mat);
    }
    for (const x of [-h.portico.w / 2 + 0.27, h.portico.w / 2 - 0.27])
      romanColumn(level, x, porticoFront + 0.27, base + 0.03, height - 0.12, mat);
    box(level, 0, base + height - 0.1, porticoFront + 0.05, h.portico.w + 0.06, 0.2, 0.24, mat.trim);
    if (floor === 2) {
      stoneRail(level, [west - 0.025, back - 3.45], [west - 0.025, back - 0.2], base + 0.025, mat);
      box(level, west + 0.65, base + 0.48, back - 1.7, 0.45, 0.1, 1.7, baseMat.wood);
    }
    for (const x of [west + 0.11, east - 0.11])
      box(level, x, base + height / 2, front - 0.15, 0.26, height, 0.12, mat.trim);
    base += height;
  }
  blueRoof(group, mat, base);

  const wing = new THREE.Group();
  wing.name = "面对蓝顶邻房左侧单层平顶柴火房";
  group.add(wing);
  const wingFront = front + h.wing.setback, wingBack = wingFront + h.wing.d;
  wallWithOpenings(wing, [east, wingFront], [east + h.wing.w, wingFront], 0, h.wing.h,
    [{ at: h.wing.w * 0.3, w: 1.25, sill: 0, h: 2.45, door: true },
      { at: h.wing.w * 0.72, w: 1.4, sill: 0.92, h: 1.4 }], mat);
  wallWithOpenings(wing, [east + h.wing.w, wingFront], [east + h.wing.w, wingBack], 0, h.wing.h,
    [{ at: h.wing.d * 0.45, w: 1.5, sill: 1, h: 1.35 }], mat);
  box(wing, east + h.wing.w / 2, h.wing.h / 2, wingBack, h.wing.w, h.wing.h, 0.24, mat.wall);
  slab(wing, rect(east, wingFront, h.wing.w, h.wing.d), 0.025, 0.16, mat.inside);
  slab(wing, rect(east - 0.02, wingFront - 0.12, h.wing.w + 0.18, h.wing.d + 0.24), h.wing.h + 0.09, 0.18, mat.wall);
  for (const [a, b] of [
    [[east + 0.1, wingFront], [east + h.wing.w, wingFront]],
    [[east + h.wing.w, wingFront], [east + h.wing.w, wingBack]],
    [[east + 0.1, wingBack], [east + h.wing.w, wingBack]],
  ] as [Point, Point][])
    stoneRail(wing, a, b, h.wing.h + 0.09, { ...mat, trim: mat.wall });

  const yard = new THREE.Group();
  yard.name = "蓝顶邻房菱格前坪·首层同高";
  group.add(yard);
  const yardFront = porticoFront - 0.95;
  const yardEast = east + h.wing.w;
  slab(yard, rect(west - 0.25, yardFront, yardEast - west + 0.5, front - yardFront), 0.025, 0.22, tileMaterial("yard"));
  // 只画首层前坪及矮基础；不生成地下室、地下车位或架空柱。
  stoneRail(yard, [west, yardFront + 0.08], [-1.25, yardFront + 0.08], 0.04, mat);
  stoneRail(yard, [1.25, yardFront + 0.08], [yardEast, yardFront + 0.08], 0.04, mat);
  stoneRail(yard, [west - 0.13, yardFront + 0.08], [west - 0.13, front], 0.04, mat);
  stoneRail(yard, [yardEast + 0.12, yardFront + 0.08], [yardEast + 0.12, wingFront], 0.04, mat);
  return group;
}
