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
function darkStoneMap() {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const rand = seeded(44021);
  // 对照门厅照片：深褐近黑的抛光石，密布浅麻点。不是石材色卡。
  ctx.fillStyle = "#3a2422";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 36 + rand() * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.5 ? "rgba(98,62,54,0.42)" : "rgba(10,7,7,0.55)");
    g.addColorStop(1, "rgba(58,36,34,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 16000; i++) {
    const n = rand();
    const x = rand() * size;
    const y = rand() * size;
    const cream = n > 0.84;
    const gray = !cream && n > 0.68;
    ctx.fillStyle = cream
      ? `rgba(214,196,176,${0.4 + rand() * 0.45})`
      : gray
        ? `rgba(148,138,130,${0.28 + rand() * 0.35})`
        : `rgba(8,6,6,${0.4 + rand() * 0.45})`;
    const s = cream ? 1.2 + rand() * 1.5 : gray ? 0.9 + rand() : 0.7 + rand() * 1.1;
    ctx.fillRect(x, y, s, s);
  }
  // 大块石的细缝只留在左、上，重复铺贴时不会叠成双倍粗。
  ctx.fillStyle = "#1c100e";
  ctx.fillRect(0, 0, 2, size);
  ctx.fillRect(0, 0, size, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1 / 1.2, 1 / 1.2);
  return t;
}
function sandCoat() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  const rand = seeded(90210);
  // 白麻：冷灰白底，黑麻点和浅灰点。不是芝麻白的暖米色。涂料搭配，不是色卡。
  ctx.fillStyle = "#e4e0d7";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 22000; i++) {
    const n = rand();
    const x = rand() * 512;
    const y = rand() * 512;
    const black = n > 0.82;
    const gray = !black && n > 0.62;
    ctx.fillStyle = black
      ? `rgba(38,36,32,${0.45 + n * 0.45})`
      : gray
        ? `rgba(120,116,108,${0.28 + n * 0.35})`
        : `rgba(255,253,248,${0.14 + n * 0.22})`;
    const s = black ? 1.6 : gray ? 1.3 : 0.8;
    ctx.fillRect(x, y, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
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
// 用透射表达玻璃，保留正常深度测试和写入。透明度混合会随转动的排序改变遮挡。
// 闭合薄盒只绘制朝外的面，避免双面盒子的前后两层重复叠色。
export function architecturalGlass(lowE = false) {
  return new THREE.MeshPhysicalMaterial({
    name: lowE ? "Low-E 玻璃" : "普通玻璃",
    color: lowE ? 0xd7ebe4 : 0x668684,
    metalness: lowE ? 0.28 : 0.08,
    roughness: lowE ? 0.05 : 0.16,
    transmission: lowE ? 0.72 : 0.64,
    ior: lowE ? 1.8 : 1.5,
    envMapIntensity: lowE ? 1.5 : 1,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

// 不同开关组仍可能有完成面贴着墙顶、压顶贴着田面的接触。
// 对数深度写 gl_FragDepth 时会覆盖硬件 polygonOffset，因此也在片元里指定微小层次。
function finishLayer(material: THREE.MeshStandardMaterial, layer: number) {
  material.polygonOffset = true;
  material.polygonOffsetFactor = -layer;
  material.polygonOffsetUnits = -layer;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <logdepthbuf_fragment>",
      `#include <logdepthbuf_fragment>
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
  gl_FragDepth = max(0.0, gl_FragDepth - ${layer.toFixed(1)} * 0.0000005);
#endif`,
    );
  };
  material.customProgramCacheKey = () => `finish-layer-${layer}`;
  return material;
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
  const darkMap = darkStoneMap();
  return {
    wall: std(palette.wall, wallMap),
    trim: finishLayer(std(palette.trim), 3),
    stone: finishLayer(std(palette.stone, stoneMap), 2),
    paving: finishLayer(std(palette.paving, wallMap), 1),
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
    glass: architecturalGlass(),
    // 用户确认门上玻璃是 Low-E。比普通玻璃更亮、更反光，带一点淡绿镀膜。造型，不是玻璃样板。
    lowE: architecturalGlass(true),
    inside: std(0xf5efe2),
    // 楼面与下层墙顶的接触由完成面显示，跨楼层开关时也不用移高楼面。
    floor: finishLayer(std(0xccb995, wallMap), 3),
    fabric: std(0xc5b89c),
    foliage: std(0x59753c),
    trunk: std(0x655745),
    gold: std(palette.gold),
    marble: new THREE.MeshStandardMaterial({
      color: 0xe4dcd0,
      roughness: 0.42,
      metalness: 0.06,
    }),
    // 门厅台阶的深色抛光石。麻点对照用户照片，不是石材色卡。
    // 反光压低，避免北立面看顶面被太阳和天光照成白块。
    darkStone: finishLayer(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: darkMap,
      roughness: 0.78,
      metalness: 0,
      envMapIntensity: 0.08,
    }), 4),
    // 踏步前沿防滑线，只比石面略浅，避免白线打眼。
    darkStoneGroove: new THREE.MeshStandardMaterial({
      color: 0x645044,
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.08,
    }),
    // 坡道防滑条只比石面略浅，避免一条亮带。
    darkStoneRampMark: new THREE.MeshStandardMaterial({
      color: 0x5a4038,
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.08,
    }),
    bronze: new THREE.MeshStandardMaterial({
      color: 0x6e5138,
      metalness: 0.62,
      roughness: 0.38,
    }),
    bronzeDark: new THREE.MeshStandardMaterial({
      color: 0x3e2c20,
      metalness: 0.48,
      roughness: 0.46,
    }),
    // 白麻水包砂。色相是涂料搭配，不是色卡实测。贴图本身已是白麻，这里不再叠暖色。
    sand: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: sandCoat(),
      roughness: 0.94,
    }),
    // 英国棕取深咖底色，对照外墙涂料和英国棕花岗岩（Tan Brown），不用偏橘红的英国红棕。不是色卡实测。
    british: finishLayer(new THREE.MeshStandardMaterial({
      color: 0x4f3c34,
      roughness: 0.8,
    }), 3),
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
  const glass = (material as THREE.MeshPhysicalMaterial).transmission > 0;
  m.castShadow = shadow && !glass;
  m.receiveShadow = !glass;
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
        depthWrite: false,
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
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  const worldH = (prominent ? 1.22 : 0.9) * scale;
  sprite.scale.set(prominent ? worldH * (width / height) : 4.8 * scale, worldH, 1);
  sprite.renderOrder = prominent ? 12 : 5;
  parent.add(sprite);
  return sprite;
}

export function bronzeEntryDoor(
  parent: THREE.Object3D,
  x: number,
  sill: number,
  z: number,
  w: number,
  h: number,
  mat: Mats,
) {
  const g = new THREE.Group();
  g.name = "铸铝咖色大门";
  g.position.set(x, sill, z);
  parent.add(g);
  const leaf = w / 2 - 0.02;
  const out = -0.028;
  for (const sign of [-1, 1] as const) {
    const cx = sign * (leaf / 2 + 0.014);
    box(g, cx, h / 2, 0, leaf, h, 0.032, mat.bronze);
    box(g, cx - sign * (leaf / 2 - 0.028), h / 2, out, 0.04, h, 0.014, mat.bronzeDark);
    box(g, cx + sign * (leaf / 2 - 0.026), h / 2, out, 0.032, h, 0.012, mat.bronzeDark);
    box(g, cx, 0.04, out, leaf, 0.05, 0.012, mat.bronzeDark);
    box(g, cx, h - 0.04, out, leaf, 0.05, 0.012, mat.bronzeDark);
    box(g, cx - sign * leaf * 0.16, h * 0.48, out - 0.01, 0.028, h * 0.42, 0.014, mat.bronzeDark);
  }
  box(g, 0, h / 2, out - 0.004, 0.026, h, 0.014, mat.bronzeDark);
  // 门扇四周一圈小回字，仍是棕色，不另做浅色角花。
  const hui = (ox: number, oy: number) => {
    const s = 0.085;
    const t = 0.011;
    box(g, ox, oy, out - 0.016, s, t, 0.008, mat.bronzeDark);
    box(g, ox, oy, out - 0.016, t, s, 0.008, mat.bronzeDark);
    box(g, ox, oy, out - 0.022, s * 0.46, t, 0.006, mat.bronzeDark);
    box(g, ox, oy, out - 0.022, t, s * 0.46, 0.006, mat.bronzeDark);
  };
  const edgeX = w / 2 - 0.1;
  for (const sx of [-1, 1])
    for (const sy of [0.14, h / 2, h - 0.14]) hui(sx * edgeX, sy);
  for (const tx of [-0.42, 0, 0.42])
    for (const sy of [0.14, h - 0.14]) hui(tx, sy);
}

export interface Opening {
  at: number;
  w: number;
  sill: number;
  h: number;
  door?: boolean;
  glazed?: boolean;
  open?: boolean;
  pattern?: "villa" | "panorama" | "lattice" | "sliding";
  span?: "lower" | "upper";
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
  skin?: THREE.Material,
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
  // 通高玻璃从墙顶向下开到窗台，不能用内孔，内孔贴到外轮廓时挤出会破。
  for (const o of openings.filter((item) => item.span === "lower").sort((p, q) => q.at - p.at)) {
    const x0 = Math.max(0, o.at - o.w / 2),
      x1 = Math.min(len, o.at + o.w / 2),
      y0 = Math.max(0.02, o.sill);
    if (x1 - x0 < 0.02 || height - y0 < 0.02) continue;
    shape.lineTo(x1, height);
    shape.lineTo(x1, y0);
    shape.lineTo(x0, y0);
    shape.lineTo(x0, height);
  }
  shape.lineTo(0, height);
  shape.closePath();
  for (const o of openings) {
    if (o.sill <= 0.001 || o.span === "lower") continue;
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
  const wallMesh = new THREE.Mesh(geo, skin ?? (interior ? mat.inside : mat.wall));
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
    const glassBottom = o.span === "upper" ? o.sill : o.sill + 0.04;
    const glassTop = o.span === "lower" ? o.sill + o.h : o.sill + o.h - 0.04;
    if (o.door && !o.glazed && !o.open && !o.span)
      bronzeEntryDoor(g, o.at, o.sill, -intoRoom * 0.015, o.w - 0.1, o.h, mat);
    else if (!o.open && !o.span && o.pattern !== "sliding") box(
      g,
      o.at,
      (glassBottom + glassTop) / 2,
      intoRoom * 0.065,
      o.w - 0.08,
      glassTop - glassBottom,
      0.02,
      mat.glass,
      false,
    );
    for (const x of [o.at - o.w / 2, o.at + o.w / 2])
      box(g, x, o.sill + o.h / 2, 0, 0.06, o.h, 0.1, mat.dark);
    for (const y of [o.sill, o.sill + o.h]) {
      if (o.span === "lower" && y > o.sill) continue;
      if (o.span === "upper" && y === o.sill) continue;
      box(g, o.at, y, 0, clear, 0.06, 0.1, mat.dark);
    }
    if (o.open) continue;
    if (!o.span && o.pattern === "villa") {
      // 效果图1：大玻璃配两边窄扇，横档错开，不把整窗切成等分网格。
      const wing = Math.min(0.52, o.w * 0.2);
      for (const sign of [-1, 1]) {
        const x = o.at + sign * (o.w / 2 - wing);
        box(g, x, o.sill + o.h / 2, 0, 0.055, o.h - 0.08, 0.075, mat.dark);
        for (const t of [0.22, 0.62, 0.9])
          box(g, o.at + sign * (o.w / 2 - wing / 2), o.sill + o.h * t, 0, wing - 0.05, 0.045, 0.075, mat.dark);
      }
      box(g, o.at, o.sill + o.h * 0.28, 0, o.w - wing * 2, 0.045, 0.075, mat.dark);
    } else if (!o.span && o.pattern === "lattice") {
      const columns = Math.max(2, Math.floor((o.w - 0.12) / 0.26));
      const rows = Math.max(1, Math.floor((o.h - 0.12) / 0.32));
      const cellW = (o.w - 0.12) / columns, cellH = (o.h - 0.12) / rows;
      for (let col = 0; col < columns; col++)
        for (let row = 0; row < rows; row++) {
          const x = o.at - o.w / 2 + 0.06 + (col + 0.5) * cellW;
          const y = o.sill + 0.06 + (row + 0.5) * cellH;
          const flip = (row + col) % 2 ? 1 : -1;
          box(g, x, y, 0, cellW, 0.027, 0.065, mat.dark);
          box(g, x + flip * cellW * 0.27, y, 0, 0.027, cellH, 0.065, mat.dark);
          box(g, x, y + cellH * 0.27, 0, cellW * 0.55, 0.027, 0.065, mat.dark);
        }
    } else if (!o.span && o.pattern === "sliding") {
      // 两扇玻璃错台 4 厘米，中间叠 8 厘米，表示推拉。拉手在靠外那扇的交接边上。
      const y0 = o.sill + 0.04;
      const y1 = o.sill + o.h - 0.04;
      const midY = (y0 + y1) / 2;
      const leafH = y1 - y0;
      const drawLeaf = (x0: number, x1: number, z: number) => {
        const cx = (x0 + x1) / 2;
        const lw = x1 - x0;
        box(g, cx, midY, z, lw - 0.07, leafH - 0.07, 0.016, mat.glass, false);
        box(g, x0, midY, z, 0.045, leafH, 0.04, mat.dark);
        box(g, x1, midY, z, 0.045, leafH, 0.04, mat.dark);
        box(g, cx, y1, z, lw, 0.04, 0.04, mat.dark);
        box(g, cx, y0, z, lw, 0.04, 0.04, mat.dark);
      };
      drawLeaf(o.at - o.w / 2 + 0.03, o.at + 0.04, intoRoom * 0.04);
      drawLeaf(o.at - 0.04, o.at + o.w / 2 - 0.03, intoRoom * 0.08);
      box(g, o.at - 0.02, o.sill + 1.05, intoRoom * 0.11, 0.018, 0.26, 0.012, mat.dark);
    } else if (!o.span) {
      box(g, o.at, o.sill + o.h / 2, 0, 0.045, o.h - 0.08, 0.075, mat.dark);
    }
    if (!o.span && !o.pattern && !o.door && o.h > 1.7)
      box(g, o.at, o.sill + 0.85, 0, clear, 0.04, 0.045, mat.dark);
    if (o.door && o.glazed && o.pattern !== "sliding")
      for (const x of [o.at - 0.12, o.at + 0.12])
        box(g, x, 1.1, -intoRoom * 0.08, 0.024, 0.32, 0.04, mat.gold);
    if (!o.door && o.span !== "upper")
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
    // 四坡五脊按直线收。最早没有天沟，坡面和脊端不再做举折、起翘。
    return new THREE.Vector3(xx, rise * t + lift, zz);
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
  // 细分只用于铺瓦，坡面本身是平面，正脊和四条斜脊都是直线。
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
    // 筒瓦完全离开坡面，近看、俯看时不再由相交表面的细边争抢像素。
    const tileLift = 0.037 * Math.hypot(1, rise / Z) + 0.006;
    const tileRow = (a: number[], b: number[]) => {
      for (let i = 0; i < 9; i++)
        segments.push([
          point(
            a[0] + ((b[0] - a[0]) * i) / 9,
            a[1] + ((b[1] - a[1]) * i) / 9,
            tileLift,
          ),
          point(
            a[0] + ((b[0] - a[0]) * (i + 1)) / 9,
            a[1] + ((b[1] - a[1]) * (i + 1)) / 9,
            tileLift,
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
  else if (["counter", "stove", "hob", "sink"].includes(f.kind)) {
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
    } else if (f.kind === "hob") {
      box(g, 0, 0.91, 0, f.w - 0.07, 0.035, 0.95, mat.dark);
      for (const z of [-0.25, 0.25]) {
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.025, 20), mat.metal);
        burner.position.set(0, 0.943, z);
        g.add(burner);
      }
    } else if (f.kind === "sink") {
      box(g, -0.5, 0.903, 0, 0.76, 0.025, 0.43, mat.metal);
      box(g, -0.5, 0.919, 0, 0.63, 0.01, 0.31, mat.dark);
      cylinder(g, new THREE.Vector3(-0.5, 0.9, 0.18), new THREE.Vector3(-0.5, 1.17, 0.18), 0.018, mat.metal, 8);
      cylinder(g, new THREE.Vector3(-0.5, 1.17, 0.18), new THREE.Vector3(-0.5, 1.17, 0), 0.018, mat.metal, 8);
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
  axis: "x" | "z" = "z",
) {
  // axis z：两跑沿南北，下跑向南。axis x：两跑沿东西，下跑向东。x、z 为下跑起始侧的外侧角。
  const rise = height / 20,
    tread = 0.25,
    flight = 1.05,
    gap = 0.18;
  const put = (
    across: number,
    y: number,
    along: number,
    acrossSize: number,
    ySize: number,
    alongSize: number,
  ) => {
    if (axis === "z")
      box(parent, x + across, base + y, z + along, acrossSize, ySize, alongSize, mat.paving);
    else box(parent, x + along, base + y, z + across, alongSize, ySize, acrossSize, mat.paving);
  };
  for (let i = 0; i < 9; i++) {
    put(flight / 2, (rise * (i + 1)) / 2, tread * (i + 0.5), flight, rise * (i + 1), tread);
    const h = height / 2 + rise * (i + 1);
    put(flight + gap + flight / 2, h / 2, tread * (8.5 - i), flight, h, tread);
  }
  put(flight + gap / 2, height / 2 - 0.09, 9 * tread + 0.4, flight * 2 + gap, 0.18, 0.8);
  for (const side of [0, 1]) {
    const across = side === 0 ? flight - 0.06 : flight + gap + 0.06;
    const reverse = side === 1;
    const rail = (aAlong: number, aY: number, bAlong: number, bY: number, radius: number) => {
      const pa =
        axis === "z"
          ? new THREE.Vector3(x + across, base + aY, z + aAlong)
          : new THREE.Vector3(x + aAlong, base + aY, z + across);
      const pb =
        axis === "z"
          ? new THREE.Vector3(x + across, base + bY, z + bAlong)
          : new THREE.Vector3(x + bAlong, base + bY, z + across);
      cylinder(parent, pa, pb, radius, mat.metal);
    };
    rail(0, (reverse ? height : 0) + 0.95, 2.25, height / 2 + 0.95, 0.02);
    for (let i = 0; i < 7; i++) {
      const along = i * 0.32,
        y0 = reverse ? height - (i * height) / 12 : (i * height) / 12;
      rail(along, y0, along, y0 + 0.95, 0.012);
    }
  }
}
