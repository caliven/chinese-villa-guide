import * as THREE from "three";
import type { Point, Furniture } from "./data";

export const palette = {
  wall: 0xe6dfd0,
  trim: 0xf2ebdf,
  stone: 0x777872,
  roof: 0x343d3c,
  dark: 0x273331,
  timber: 0x654c36,
  grass: 0x697951,
  paving: 0xb5b3a5,
  gold: 0xa99670,
};
function seeded(seed: number) {
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
export const random = seeded(7349);
function surface(kind: "stone" | "grass" | "wall" | "wood") {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle =
    kind === "grass"
      ? "#82916a"
      : kind === "wood"
        ? "#887059"
        : kind === "stone"
          ? "#a5a598"
          : "#f0ebe0";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) {
    const n = random(),
      x = random() * 256,
      y = random() * 256;
    ctx.fillStyle =
      n > 0.5 ? `rgba(255,255,240,${n * 0.13})` : `rgba(28,37,20,${n * 0.18})`;
    ctx.fillRect(x, y, kind === "grass" ? 2 : 1, kind === "wood" ? 20 : 2);
  }
  if (kind === "stone") {
    ctx.strokeStyle = "#777b71";
    ctx.lineWidth = 1.5;
    for (let y = 0; y < 256; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
      for (let x = y % 64 ? 32 : 0; x < 256; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 32);
        ctx.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(kind === "grass" ? 12 : 2, kind === "grass" ? 12 : 2);
  return t;
}
export function materials() {
  const stoneMap = surface("stone"),
    wallMap = surface("wall"),
    grassMap = surface("grass"),
    woodMap = surface("wood");
  const std = (color: number, map?: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      color,
      ...(map ? { map } : {}),
      roughness: 0.87,
    });
  return {
    wall: std(palette.wall, wallMap),
    trim: std(palette.trim),
    stone: std(palette.stone, stoneMap),
    paving: std(palette.paving, wallMap),
    roof: std(palette.roof),
    dark: std(palette.dark),
    wood: std(palette.timber, woodMap),
    grass: std(palette.grass, grassMap),
    soil: std(0x847b5b, grassMap),
    metal: new THREE.MeshStandardMaterial({
      color: 0x34403c,
      metalness: 0.6,
      roughness: 0.38,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x668684,
      metalness: 0.2,
      roughness: 0.16,
      transparent: true,
      opacity: 0.57,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    inside: std(0xf5efe2),
    floor: std(0xccb995, wallMap),
    fabric: std(0xc5b89c),
    foliage: std(0x59753c),
    trunk: std(0x655745),
    gold: std(palette.gold),
  };
}
export type Mats = ReturnType<typeof materials>;
const unitBox = new THREE.BoxGeometry(1, 1, 1);
export function box(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  shadow = true,
) {
  const geo = (material as THREE.MeshStandardMaterial).map
    ? unitBox.clone()
    : unitBox;
  if (geo !== unitBox) {
    const uv = geo.getAttribute("uv"),
      normals = geo.getAttribute("normal");
    for (let i = 0; i < uv.count; i++) {
      const a = Math.abs(normals.getX(i)) > 0.5 ? d : w;
      const b = Math.abs(normals.getY(i)) > 0.5 ? d : h;
      uv.setXY(i, uv.getX(i) * a, uv.getY(i) * b);
    }
  }
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function cylinder(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  sides = 8,
) {
  const delta = b.clone().sub(a);
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, delta.length(), sides),
    material,
  );
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function slab(
  parent: THREE.Object3D,
  points: Point[],
  y: number,
  thickness: number,
  material: THREE.Material,
  holes: Point[][] = [],
) {
  const shape = new THREE.Shape(
    points.map(([x, z]) => new THREE.Vector2(x, -z)),
  );
  for (const h of holes)
    shape.holes.push(
      new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))),
    );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.y = y - thickness;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export const rect = (x: number, z: number, w: number, d: number): Point[] => [
  [x, z],
  [x + w, z],
  [x + w, z + d],
  [x, z + d],
];
export function line(
  parent: THREE.Object3D,
  points: THREE.Vector3[],
  color = 0xa77c39,
  dashed = false,
) {
  const material = dashed
    ? new THREE.LineDashedMaterial({
        color,
        dashSize: 0.28,
        gapSize: 0.14,
        depthTest: false,
      })
    : new THREE.LineBasicMaterial({ color });
  const m = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    material,
  );
  m.computeLineDistances();
  parent.add(m);
  return m;
}
export function tag(
  parent: THREE.Object3D,
  text: string,
  x: number,
  y: number,
  z: number,
  color = "#284b3b",
  scale = 1,
  prominent = false,
) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = prominent
    ? '700 72px "PingFang SC", "Microsoft YaHei", sans-serif'
    : '500 58px "PingFang SC", sans-serif';
  ctx.font = font;
  const width = prominent
    ? Math.min(1680, Math.max(280, Math.ceil(ctx.measureText(text).width) + 84))
    : 512;
  const height = prominent ? 128 : 96;
  canvas.width = width;
  canvas.height = height;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (prominent) {
    ctx.fillStyle = "#121a24";
    ctx.strokeStyle = "#ffbf3c";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(8, 8, width - 16, height - 16, 24);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffe566";
    ctx.fillText(text, width / 2, height / 2 + 2);
  } else {
    ctx.fillStyle = "#f8f6edee";
    ctx.beginPath();
    ctx.roundRect(2, 2, 508, 92, 16);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 49, 484);
  }
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  const worldH = (prominent ? 1.22 : 0.9) * scale;
  sprite.scale.set(prominent ? worldH * (width / height) : 4.8 * scale, worldH, 1);
  sprite.renderOrder = prominent ? 12 : 5;
  parent.add(sprite);
  return sprite;
}

export interface Opening {
  at: number;
  w: number;
  sill: number;
  h: number;
  door?: boolean;
}
export function wallWithOpenings(
  parent: THREE.Object3D,
  a: Point,
  b: Point,
  base: number,
  height: number,
  openings: Opening[],
  mat: Mats,
  thickness = 0.24,
  interior = false,
) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.Group();
  g.position.set(a[0], base, a[1]);
  g.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  parent.add(g);
  // 整面墙一次挤出。按窗洞切成多块盒子时，相邻外表面共面，缩放时接缝会闪成竖线。
  const shape = new THREE.Shape();
  const doors = openings
    .filter((o) => o.sill <= 0.001)
    .sort((p, q) => p.at - q.at);
  shape.moveTo(0, 0);
  for (const o of doors) {
    const x0 = Math.max(0, o.at - o.w / 2),
      x1 = Math.min(len, o.at + o.w / 2),
      top = Math.min(height, o.sill + o.h);
    if (x1 - x0 < 0.02 || top < 0.02) continue;
    shape.lineTo(x0, 0);
    shape.lineTo(x0, top);
    shape.lineTo(x1, top);
    shape.lineTo(x1, 0);
  }
  shape.lineTo(len, 0);
  shape.lineTo(len, height);
  shape.lineTo(0, height);
  shape.closePath();
  for (const o of openings) {
    if (o.sill <= 0.001) continue;
    const x0 = Math.max(0.02, o.at - o.w / 2),
      x1 = Math.min(len - 0.02, o.at + o.w / 2),
      y0 = o.sill,
      y1 = Math.min(height - 0.02, o.sill + o.h);
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02) continue;
    const hole = new THREE.Path();
    hole.moveTo(x1, y0);
    hole.lineTo(x0, y0);
    hole.lineTo(x0, y1);
    hole.lineTo(x1, y1);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.translate(0, 0, -thickness / 2);
  const position = geo.getAttribute("position"),
    uv = geo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, position.getX(i), position.getY(i));
  geo.computeVertexNormals();
  const wallMesh = new THREE.Mesh(geo, interior ? mat.inside : mat.wall);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  g.add(wallMesh);
  for (const o of openings) {
    if (interior) {
      // 门扇停在打开位置，保留实际通行洞口。
      const door = box(
        g,
        o.at - o.w / 2,
        o.h / 2,
        o.w / 2,
        0.045,
        o.h,
        o.w,
        mat.wood,
      );
      door.castShadow = false;
      continue;
    }
    // 玻璃靠室内一侧，框料彼此只相接、不叠面，避免窗角和横档发暗闪。
    const midX = (a[0] + b[0]) / 2,
      midZ = (a[1] + b[1]) / 2,
      localZx = -(b[1] - a[1]) / len,
      localZz = (b[0] - a[0]) / len,
      intoRoom =
        (13.55 - midX) * localZx + (4 - midZ) * localZz > 0 ? 1 : -1;
    const clear = o.w - 0.062;
    box(
      g,
      o.at,
      o.sill + o.h / 2,
      intoRoom * 0.065,
      o.w - 0.08,
      o.h - 0.08,
      0.02,
      o.door ? mat.wood : mat.glass,
      o.door,
    );
    for (const x of [o.at - o.w / 2, o.at + o.w / 2])
      box(g, x, o.sill + o.h / 2, 0, 0.06, o.h, 0.1, mat.dark);
    for (const y of [o.sill, o.sill + o.h])
      box(g, o.at, y, 0, clear, 0.06, 0.1, mat.dark);
    box(g, o.at, o.sill + o.h / 2, 0, 0.04, o.h - 0.08, 0.06, mat.dark);
    if (!o.door && o.h > 1.7)
      box(g, o.at, o.sill + 0.85, 0, clear, 0.04, 0.045, mat.dark);
    if (o.door)
      for (const x of [o.at - 0.12, o.at + 0.12])
        box(g, x, 1.1, -intoRoom * 0.08, 0.024, 0.32, 0.04, mat.gold);
    if (!o.door)
      box(g, o.at, o.sill - 0.05, 0, o.w + 0.22, 0.1, 0.35, mat.trim);
  }
  return g;
}

export function railing(
  parent: THREE.Object3D,
  a: Point,
  b: Point,
  y: number,
  mat: Mats,
  height = 1.05,
) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.Group();
  g.position.set(a[0], y, a[1]);
  g.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  parent.add(g);
  box(g, length / 2, 0.06, 0, length, 0.12, 0.18, mat.trim);
  box(g, length / 2, height, 0, length + 0.08, 0.065, 0.1, mat.metal);
  for (let i = 0; i <= Math.ceil(length / 0.23); i++)
    box(
      g,
      (i * length) / Math.ceil(length / 0.23),
      height / 2,
      0,
      0.025,
      height,
      0.025,
      mat.metal,
      false,
    );
  for (let i = 0; i <= Math.ceil(length / 2.6); i++) {
    const x = (i * length) / Math.ceil(length / 2.6);
    box(g, x, height / 2, 0, 0.16, height, 0.16, mat.trim);
    box(g, x, height + 0.025, 0, 0.24, 0.09, 0.24, mat.stone);
  }
}

export function hipRoof(
  parent: THREE.Object3D,
  x: number,
  z: number,
  w: number,
  d: number,
  y: number,
  rise: number,
  mat: Mats,
  detailed = true,
  clip?: (point: Point) => Point,
) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const turned = w < d;
  if (turned) {
    [w, d] = [d, w];
    g.rotation.y = Math.PI / 2;
  }
  const X = w / 2,
    Z = d / 2,
    r = (w - d) / 2;
  const point = (xx: number, zz: number, lift = 0) => {
    if (clip) {
      const [wx, wz] = clip([x + (turned ? zz : xx), z + (turned ? -xx : zz)]);
      [xx, zz] = turned ? [z - wz, wx - x] : [wx - x, wz - z];
    }
    const t = Math.max(
      0,
      Math.min(1, 1 - Math.max(Math.abs(zz) / Z, (Math.abs(xx) - r) / Z)),
    );
    const corner =
      0.16 *
      Math.pow(Math.min(1, Math.abs(xx) / X), 8) *
      Math.pow(Math.min(1, Math.abs(zz) / Z), 8);
    return new THREE.Vector3(xx, rise * Math.pow(t, 1.22) + corner + lift, zz);
  };
  const A = [-X, -Z],
    B = [X, -Z],
    C = [X, Z],
    D = [-X, Z],
    L = [-r, 0],
    R = [r, 0];
  const triangles = [
    [A, B, R],
    [A, R, L],
    [C, D, L],
    [C, L, R],
    [B, C, R],
    [D, A, L],
  ];
  const pos: number[] = [],
    uv: number[] = [];
  const add = (p: THREE.Vector3) => {
    pos.push(p.x, p.y, p.z);
    uv.push(p.x, p.z);
  };
  // 细分曲面表现轻微举折与起翘，四坡、正脊和四条斜脊保持连续。
  const N = 14;
  for (const [a, b, c] of triangles) {
    const p = (i: number, j: number) =>
      point(
        a[0] + ((b[0] - a[0]) * i) / N + ((c[0] - a[0]) * j) / N,
        a[1] + ((b[1] - a[1]) * i) / N + ((c[1] - a[1]) * j) / N,
      );
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N - i; j++) {
        add(p(i, j));
        add(p(i + 1, j));
        add(p(i, j + 1));
        if (i + j < N - 1) {
          add(p(i + 1, j));
          add(p(i + 1, j + 1));
          add(p(i, j + 1));
        }
      }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const roofMat = mat.roof.clone();
  roofMat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, roofMat);
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  const outline = [A, B, C, D].map(([xx, zz]) => {
    const p = point(xx, zz);
    return [p.x, p.z] as Point;
  });
  slab(g, outline, -0.015, 0.16, mat.dark);
  const path = (
    a: number[],
    b: number[],
    radius: number,
    material: THREE.Material,
    steps = 10,
  ) => {
    const points = Array.from({ length: steps + 1 }, (_, i) =>
      point(
        a[0] + ((b[0] - a[0]) * i) / steps,
        a[1] + ((b[1] - a[1]) * i) / steps,
        radius / 2,
      ),
    );
    const curve = new THREE.CatmullRomCurve3(points);
    const m = new THREE.Mesh(
      new THREE.TubeGeometry(curve, steps, radius, 6, false),
      material,
    );
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  for (const [a, b] of [
    [A, L],
    [B, R],
    [C, R],
    [D, L],
    [L, R],
  ])
    path(a, b, 0.095, mat.roof);
  for (const [a, b] of [
    [A, B],
    [B, C],
    [C, D],
    [D, A],
  ])
    path(a, b, 0.055, mat.dark, 18);
  if (detailed) {
    const segments: [THREE.Vector3, THREE.Vector3][] = [];
    const tileRow = (a: number[], b: number[]) => {
      for (let i = 0; i < 9; i++)
        segments.push([
          point(
            a[0] + ((b[0] - a[0]) * i) / 9,
            a[1] + ((b[1] - a[1]) * i) / 9,
            0.035,
          ),
          point(
            a[0] + ((b[0] - a[0]) * (i + 1)) / 9,
            a[1] + ((b[1] - a[1]) * (i + 1)) / 9,
            0.035,
          ),
        ]);
    };
    for (let xx = -X + 0.08; xx < X; xx += 0.19) {
      const reach = Math.min(xx + X, X - xx, Z);
      for (const sign of [-1, 1])
        tileRow([xx, sign * Z], [xx, sign * (Z - reach)]);
    }
    for (let zz = -Z + 0.08; zz < Z; zz += 0.19) {
      const reach = Z - Math.abs(zz);
      for (const sign of [-1, 1])
        tileRow([sign * X, zz], [sign * (X - reach), zz]);
    }
    const tiles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.037, 0.037, 1, 6),
      mat.roof,
      segments.length,
    );
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      up = new THREE.Vector3(0, 1, 0);
    segments.forEach(([a, b], i) => {
      const v = b.clone().sub(a);
      q.setFromUnitVectors(up, v.clone().normalize());
      m.compose(
        a.clone().add(b).multiplyScalar(0.5),
        q,
        new THREE.Vector3(1, v.length(), 1),
      );
      tiles.setMatrixAt(i, m);
    });
    tiles.receiveShadow = true;
    g.add(tiles);
    for (let t = 0.13; t < 1; t += 0.105)
      for (const sign of [-1, 1])
        path(
          [-X + Z * t, sign * Z * (1 - t)],
          [X - Z * t, sign * Z * (1 - t)],
          0.012,
          mat.dark,
        );
  }
  return g;
}

export function furnish(
  parent: THREE.Object3D,
  f: Furniture,
  y: number,
  mat: Mats,
) {
  const g = new THREE.Group();
  g.position.set(f.x, y, f.z);
  g.rotation.y = f.rotation ?? 0;
  parent.add(g);
  if (f.kind === "bed") {
    box(g, 0, 0.2, 0, f.w, 0.35, f.d, mat.wood);
    box(g, 0, 0.43, 0, f.w - 0.05, 0.18, f.d - 0.06, mat.fabric);
    box(g, 0, 0.7, f.d / 2 - 0.05, f.w + 0.12, 0.95, 0.12, mat.wood);
    for (const x of [-f.w / 4, f.w / 4])
      box(g, x, 0.57, f.d / 2 - 0.38, f.w / 2 - 0.12, 0.14, 0.42, mat.inside);
    box(g, 0, 0.55, -0.33, f.w, 0.07, f.d * 0.58, mat.fabric);
  } else if (f.kind === "roundTable") {
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(f.w / 2, f.w / 2, 0.09, 48),
      mat.wood,
    );
    top.position.y = 0.77;
    top.castShadow = true;
    g.add(top);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.4, 0.72, 16),
      mat.wood,
    );
    base.position.y = 0.36;
    g.add(base);
    const turntable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.58, 0.035, 32),
      mat.glass,
    );
    turntable.position.y = 0.84;
    g.add(turntable);
  } else if (["table", "altar", "chair"].includes(f.kind)) {
    const h = f.kind === "chair" ? 0.46 : f.kind === "altar" ? 0.95 : 0.76;
    box(g, 0, h, 0, f.w, 0.07, f.d, mat.wood);
    for (const xx of [-1, 1])
      for (const zz of [-1, 1])
        box(
          g,
          xx * (f.w / 2 - 0.08),
          h / 2,
          zz * (f.d / 2 - 0.08),
          0.05,
          h,
          0.05,
          mat.wood,
        );
    if (f.kind === "chair")
      box(g, 0, 0.69, f.d / 2 - 0.04, f.w, 0.44, 0.06, mat.wood);
  } else if (f.kind === "sofa") {
    box(g, 0, 0.32, 0, f.w, 0.48, f.d, mat.fabric);
    box(g, -f.w / 2 + 0.08, 0.65, 0, 0.17, 0.45, f.d, mat.fabric);
  } else if (f.kind === "wardrobe")
    box(g, 0, 1.02, 0, f.w, 2.04, f.d, mat.wood);
  else if (f.kind === "counter" || f.kind === "stove") {
    box(
      g,
      0,
      0.42,
      0,
      f.w,
      0.84,
      f.d,
      f.kind === "stove" ? mat.stone : mat.wood,
    );
    box(g, 0, 0.86, 0, f.w + 0.04, 0.06, f.d + 0.04, mat.inside);
    if (f.kind === "stove") {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.24, 0.08, 20),
        mat.dark,
      );
      pot.position.y = 0.93;
      g.add(pot);
      box(g, 0, 0.25, -f.d / 2 - 0.01, 0.4, 0.28, 0.02, mat.dark);
    }
  } else {
    box(
      g,
      0,
      f.kind === "toilet" ? 0.23 : 0.42,
      0,
      f.w,
      f.kind === "toilet" ? 0.45 : 0.82,
      f.d,
      mat.inside,
    );
    if (f.kind === "toilet")
      box(g, 0, 0.56, f.d / 2 - 0.06, f.w, 0.52, 0.14, mat.inside);
  }
  return g;
}

export function stairs(
  parent: THREE.Object3D,
  x: number,
  z: number,
  base: number,
  height: number,
  mat: Mats,
) {
  // 两跑各10个高差，9个踏面；两端平台与楼层洞口使用同一组米制坐标。
  const rise = height / 20,
    tread = 0.25,
    start = x + 0.9;
  for (let i = 0; i < 9; i++) {
    box(
      parent,
      start + tread * (i + 0.5),
      base + (rise * (i + 1)) / 2,
      z + 0.55,
      tread,
      rise * (i + 1),
      1.1,
      mat.paving,
    );
    const h = height / 2 + rise * (i + 1);
    box(
      parent,
      start + tread * (8.5 - i),
      base + h / 2,
      z + 2.5,
      tread,
      h,
      1.1,
      mat.paving,
    );
  }
  box(
    parent,
    start + 2.7,
    base + height / 2 - 0.1,
    z + 1.525,
    0.9,
    0.2,
    3.05,
    mat.paving,
  );
  for (const zz of [z + 1.08, z + 1.97]) {
    const reverse = zz > z + 1.5;
    cylinder(
      parent,
      new THREE.Vector3(start, base + (reverse ? height : 0) + 0.95, zz),
      new THREE.Vector3(start + 2.25, base + height / 2 + 0.95, zz),
      0.027,
      mat.metal,
    );
    for (let i = 0; i < 7; i++) {
      const xx = start + i * 0.375,
        yy = base + (reverse ? height - (i * height) / 12 : (i * height) / 12);
      cylinder(
        parent,
        new THREE.Vector3(xx, yy, zz),
        new THREE.Vector3(xx, yy + 0.95, zz),
        0.015,
        mat.metal,
      );
    }
  }
}
