import * as THREE from "three";
import { resolvedRailingStyle } from "./railing-options";
import { railingNetwork } from "./railing-network";
import { stairRailingSections } from "./stair-railing";
import { stairLayout, site, type Point, type Furniture } from "./data";
import type { CourtyardFinish } from "./courtyard-finishes";
import { bedLayout } from "./furniture-catalog";
import { stairShape, type StairShapeInput } from "./stair-geometry";
import { MM_PER_M } from "./units";
import { fitFurnitureFootprint, floorplanFurnitureModel } from "./floorplan-furniture";
import type { OpeningKind } from "./openings";
import { moveWindowDesign, windowDesign, windowInteriorSide } from "./window-design";
import { windowModel } from "./window-model";
import { doorFinishMaterials, doorModel, type DoorMaterials } from "./door-model";

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
  // 入口保留深色花岗岩质感，压低红相，改为与白麻墙、英国棕协调的暖炭灰。
  ctx.fillStyle = "#383630";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 36 + rand() * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.5 ? "rgba(110,104,88,0.24)" : "rgba(18,19,18,0.34)");
    g.addColorStop(1, "rgba(56,54,48,0)");
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
      ? `rgba(193,189,174,${0.24 + rand() * 0.35})`
      : gray
        ? `rgba(148,138,130,${0.28 + rand() * 0.35})`
        : `rgba(18,20,19,${0.25 + rand() * 0.35})`;
    const s = cream ? 1.2 + rand() * 1.5 : gray ? 0.9 + rand() : 0.7 + rand() * 1.1;
    ctx.fillRect(x, y, s, s);
  }
  // 大块石的细缝只留在左、上，重复铺贴时不会叠成双倍粗。
  ctx.fillStyle = "#292b27";
  ctx.fillRect(0, 0, 1.3, size);
  ctx.fillRect(0, 0, size, 1.3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  // UV 为世界毫米：重复数＝每毫米贴图周期
  t.repeat.set(1 / 1200, 1 / 1200);
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
      ? `rgba(69,68,64,${0.12 + n * 0.14})`
      : gray
        ? `rgba(140,138,130,${0.14 + n * 0.18})`
        : `rgba(255,253,248,${0.14 + n * 0.22})`;
    const s = black ? 1.2 : gray ? 1 : 0.8;
    ctx.fillRect(x, y, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.repeat.set(1 / MM_PER_M, 1 / MM_PER_M);
  return t;
}

function courtyardConcreteMap() {
  // 普通水泥地：中性灰、细砂颗粒和轻微抹面色差，不画砖缝或装饰分格。
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(size, size);
  const rand = seeded(83514), cycle = Math.PI * 2 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x * cycle, v = y * cycle;
    // 周期性低频色差在贴图边缘连续，避免重复处出现方块接缝。
    const mottling = Math.sin(u + Math.cos(v)) * 2.8
      + Math.cos(2 * v + Math.sin(2 * u)) * 2.1
      + Math.sin(4 * u - 3 * v) * 1.2;
    const tone = Math.round(174 + mottling + (rand() - 0.5) * 5);
    const index = (y * size + x) * 4;
    pixels.data[index] = tone;
    pixels.data[index + 1] = tone;
    pixels.data[index + 2] = tone - 1;
    pixels.data[index + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / 3200, 1 / 3200);
  texture.anisotropy = 16;
  return texture;
}

function terraceTileMap(kind: "terrace" | "courtyard" = "terrace") {
  // 2.4米纹理含4×4块600毫米砖；院坪用约4毫米灰缝，露台沿用约3毫米暖灰缝。
  const size = 1024, cell = size / 4;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const outdoor = kind === "courtyard", gap = outdoor ? 1.7 : 1.3;
  const rand = seeded(outdoor ? 76138 : 64271);
  ctx.fillStyle = outdoor ? "#858884" : "#aaa79d";
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = col * cell, y = row * cell, tone = Math.round(rand() * (outdoor ? 10 : 7));
    ctx.fillStyle = outdoor
      ? `rgb(${177 + tone},${179 + tone},${174 + tone})`
      : `rgb(${201 + tone},${198 + tone},${187 + tone})`;
    ctx.fillRect(x + gap, y + gap, cell - gap, cell - gap);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + gap, y + gap, cell - gap, cell - gap);
    ctx.clip();
    for (let i = 0; i < 10; i++) {
      const cx = x + rand() * cell, cy = y + rand() * cell, radius = 22 + rand() * 95;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, i % 2 ? "rgba(110,111,102,0.055)" : "rgba(251,249,239,0.12)");
      gradient.addColorStop(1, "rgba(200,198,187,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, cell, cell);
    }
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = rand() > 0.5 ? "rgba(255,253,243,0.10)" : "rgba(85,88,81,0.055)";
      ctx.fillRect(x + rand() * cell, y + rand() * cell, 0.8, 0.8);
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / 2400, 1 / 2400);
  texture.anisotropy = 16;
  return texture;
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
  t.repeat.set((kind === "grass" ? 12 : 2) / MM_PER_M, (kind === "grass" ? 12 : 2) / MM_PER_M);
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
  const lowE = architecturalGlass(true);
  const courtyardConcrete = new THREE.MeshStandardMaterial({
    name: "普通灰色水泥院坪",
    color: 0xffffff,
    map: courtyardConcreteMap(),
    roughness: 0.98,
    metalness: 0,
    envMapIntensity: 0.12,
  });
  const courtyardTile = new THREE.MeshStandardMaterial({
    name: "600毫米灰色哑光仿石院坪砖",
    color: 0xffffff,
    map: terraceTileMap("courtyard"),
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.15,
  });
  return {
    ...doorFinishMaterials(),
    wall: std(palette.wall, wallMap),
    trim: finishLayer(std(palette.trim), 3),
    stone: finishLayer(std(palette.stone, stoneMap), 2),
    paving: finishLayer(std(palette.paving, wallMap), 1),
    courtyard: finishLayer(courtyardConcrete.clone(), 1),
    neighborCourtyard: finishLayer(courtyardConcrete.clone(), 1),
    courtyardConcrete,
    courtyardTile,
    roof: std(palette.roof),
    // 新建主辅楼专用釉瓦材质；旧木房及邻房仍使用各自原有瓦色。
    villaRoof: new THREE.MeshPhysicalMaterial({
      name: "墨蓝色琉璃瓦",
      color: 0x222b45,
      roughness: 0.38,
      metalness: 0,
      clearcoat: 0.32,
      clearcoatRoughness: 0.32,
      envMapIntensity: 0.7,
    }),
    villaRoofJoint: new THREE.MeshStandardMaterial({ name: "墨蓝釉瓦搭接阴线", color: 0x1c2337, roughness: 0.58 }),
    roofGutter: new THREE.MeshStandardMaterial({
      name: "自然水泥灰天沟",
      color: 0xa6a8a5,
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0.12,
    }),
    relief: new THREE.MeshStandardMaterial({ name: "细石雕线饰", color: 0x858477, roughness: 0.82 }),
    dressedStone: new THREE.MeshStandardMaterial({ name: "整块细磨暖灰柱饰石", color: 0x77786f, roughness: 0.7 }),
    carvedStone: new THREE.MeshStandardMaterial({ name: "参考图浅色雕花柱石", color: 0xe8e4db, roughness: 0.77 }),
    carvingInset: new THREE.MeshStandardMaterial({ name: "浅石雕凹槽与花纹阴面", color: 0xb5b0a6, roughness: 0.9 }),
    carvingDark: new THREE.MeshStandardMaterial({ name: "雕花柱深咖嵌底", color: 0x302a27, roughness: 0.82 }),
    terrace: finishLayer(new THREE.MeshStandardMaterial({
      name: "600毫米浅暖灰仿石露台砖",
      color: 0xffffff,
      map: terraceTileMap(),
      roughness: 0.88,
      metalness: 0,
      envMapIntensity: 0.18,
    }), 4),
    terraceEdge: finishLayer(new THREE.MeshStandardMaterial({ name: "露台暖灰收边石", color: 0x96968b, roughness: 0.84 }), 5),
    dark: std(palette.dark),
    wood: std(palette.timber, woodMap),
    grass: std(palette.grass, grassMap),
    soil: std(0x847b5b, grassMap),
    metal: new THREE.MeshStandardMaterial({
      color: 0x34403c,
      metalness: 0.6,
      roughness: 0.38,
    }),
    // 全屋玻璃统一淡绿 Low-E 镀膜；保留 lowE 入口供一体门窗复用同一材质。
    glass: lowE,
    lowE,
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
      color: 0x666459,
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.08,
    }),
    // 坡道防滑条只比石面略浅，避免一条亮带。
    darkStoneRampMark: new THREE.MeshStandardMaterial({
      color: 0x55554c,
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
      name: "低红度深咖英国棕",
      color: 0x494039,
      roughness: 0.74,
    }), 3),
  };
}
export type Mats = ReturnType<typeof materials>;

export function setCourtyardFinishes(mat: Mats, own: CourtyardFinish, neighbor: CourtyardFinish) {
  for (const [target, finish] of [[mat.courtyard, own], [mat.neighborCourtyard, neighbor]] as const) {
    const source = finish === "tile" ? mat.courtyardTile : mat.courtyardConcrete;
    if (target.map === source.map) continue;
    // 保留材质对象及完成面深度层次，让已经合批的地坪直接换肤，无须重建几何。
    target.map = source.map;
    target.name = source.name;
    target.color.copy(source.color);
    target.roughness = source.roughness;
    target.envMapIntensity = source.envMapIntensity;
    target.needsUpdate = true;
  }
}
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
        dashSize: 280,
        gapSize: 140,
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
  const worldH = (prominent ? 1220 : 900) * scale;
  sprite.scale.set(prominent ? worldH * (width / height) : 4800 * scale, worldH, 1);
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
  return doorModel(parent, { at: x, sill, w, h, kind: "doubleDoor" }, mat, { style: "bronze", open: false, frame: false, z });
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
  continuous?: string;
  entryAssembly?: string;
  /** 与 WallOpening 一致：铰链贴洞口起点／终点。 */
  hinge?: "start" | "end";
  /**
   * 开启侧：与平面 openingSymbolSvg 相同——in 扇叶沿墙局部 −Z，out 沿 ＋Z。
   */
  side?: "in" | "out";
  kind?: OpeningKind;
}

/** 室内门窗按洞口毫米规格建模；编辑剖切与房屋视图复用同一份实体。 */
export function interiorOpeningModel(parent: THREE.Object3D, o: Opening, mat: DoorMaterials, cut = Infinity, thickness = 200) {
  const g = new THREE.Group(); parent.add(g);
  g.name = "室内门窗";
  if (o.kind === "passage") return g;
  const bottom = o.sill, top = Math.min(cut, o.sill + o.h);
  if (top <= bottom) return g;
  if (!o.door) {
    windowModel(g, moveWindowDesign(windowDesign(o.w, o.h), o.at - o.w / 2, o.sill), mat, { top: cut });
    return g;
  }
  doorModel(g, o, mat, { thickness, top: cut });
  return g;
}

/** 外门与户型编辑共用造型；仅内门保持平面符号对应的90度开启表达。 */
export function exteriorDoorModel(parent: THREE.Object3D, o: Opening, mat: DoorMaterials, intoRoom: number, cut = Infinity, thickness = 240) {
  const sliding = o.kind ? o.kind === "slidingDoor" : o.pattern === "sliding" || o.glazed;
  return doorModel(parent, { ...o, kind: sliding ? "slidingDoor" : o.kind ?? (o.w >= 1400 ? "doubleDoor" : "door") }, mat,
    { style: o.kind === "bathroomDoor" ? "bathroom" : sliding ? "glazed" : "bronze", open: false, thickness, outward: -intoRoom, top: cut });
}
export function wallWithOpenings(
  parent: THREE.Object3D,
  a: Point,
  b: Point,
  base: number,
  height: number,
  openings: Opening[],
  mat: Mats,
  thickness = 240,
  interior = false,
  skin?: THREE.Material,
  join: { start: number; end: number } = { start: 0, end: 0 },
) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const start = -join.start, end = len + join.end;
  const g = new THREE.Group();
  g.position.set(a[0], base, a[1]);
  g.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  parent.add(g);
  // 整面墙一次挤出。按窗洞切成多块盒子时，相邻外表面共面，缩放时接缝会闪成竖线。
  const shape = new THREE.Shape();
  const doors = openings
    .filter((o) => o.sill <= 1)
    .sort((p, q) => p.at - q.at);
  shape.moveTo(start, 0);
  for (const o of doors) {
    const x0 = Math.max(0, o.at - o.w / 2),
      x1 = Math.min(len, o.at + o.w / 2),
      top = Math.min(height, o.sill + o.h);
    if (x1 - x0 < 20 || top < 20) continue;
    shape.lineTo(x0, 0);
    shape.lineTo(x0, top);
    shape.lineTo(x1, top);
    shape.lineTo(x1, 0);
  }
  shape.lineTo(end, 0);
  shape.lineTo(end, height);
  // 通高玻璃从墙顶向下开到窗台，不能用内孔，内孔贴到外轮廓时挤出会破。
  for (const o of openings.filter((item) => item.span === "lower").sort((p, q) => q.at - p.at)) {
    const x0 = Math.max(0, o.at - o.w / 2),
      x1 = Math.min(len, o.at + o.w / 2),
      y0 = Math.max(20, o.sill);
    if (x1 - x0 < 20 || height - y0 < 20) continue;
    shape.lineTo(x1, height);
    shape.lineTo(x1, y0);
    shape.lineTo(x0, y0);
    shape.lineTo(x0, height);
  }
  shape.lineTo(start, height);
  shape.closePath();
  for (const o of openings) {
    if (o.sill <= 1 || o.span === "lower") continue;
    const x0 = Math.max(20, o.at - o.w / 2),
      x1 = Math.min(len - 20, o.at + o.w / 2),
      y0 = o.sill,
      y1 = Math.min(height - 20, o.sill + o.h);
    if (x1 - x0 < 20 || y1 - y0 < 20) continue;
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
    normal = geo.getAttribute("normal"),
    uv = geo.getAttribute("uv");
  // 各面按实际朝向铺毫米贴图；端面若仍用XY，横坐标恒定，会把麻点拉成整条横纹。
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, Math.abs(normal.getX(i)) > .5 ? position.getZ(i) : position.getX(i),
      Math.abs(normal.getY(i)) > .5 ? position.getZ(i) : position.getY(i));
  geo.computeVertexNormals();
  const wallMesh = new THREE.Mesh(geo, skin ?? (interior ? mat.inside : mat.wall));
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  g.add(wallMesh);
  for (const o of openings) {
    if (o.continuous || o.entryAssembly || o.kind === "passage") continue;
    if (interior) {
      interiorOpeningModel(g, o, mat, height, thickness);
      continue;
    }
    // 玻璃靠室内一侧，框料彼此只相接、不叠面，避免窗角和横档发暗闪。
    const midX = (a[0] + b[0]) / 2;
    const body = midX >= site.annex.x && midX <= site.annex.x + site.annex.w ? site.annex : site.main;
    const intoRoom = windowInteriorSide(a, b, body);
    if (!o.door && !o.span && !o.open) {
      windowModel(g, moveWindowDesign(windowDesign(o.w, o.h), o.at - o.w / 2, o.sill), mat, { intoRoom, top: height });
      box(g, o.at, o.sill - 50, 0, o.w + 220, 100, 350, mat.trim);
      continue;
    }
    if (o.door && !o.open && !o.span) {
      exteriorDoorModel(g, o, mat, intoRoom, height, thickness);
      continue;
    }
    const clear = o.w - 120;
    // 一体通高窗由专用模型补齐；这里仅保留分层墙洞及开敞口的边框。
    for (const x of [o.at - o.w / 2 + 30, o.at + o.w / 2 - 30])
      box(g, x, o.sill + o.h / 2, 0, 60, o.h, 100, mat.dark);
    for (const y of [o.sill, o.sill + o.h]) {
      if (o.span === "lower" && y > o.sill) continue;
      if (o.span === "upper" && y === o.sill) continue;
      box(g, o.at, y === o.sill ? y + 30 : y - 30, 0, clear, 60, 100, mat.dark);
    }
    if (!o.open && !o.door && o.span !== "upper")
      box(g, o.at, o.sill - 50, 0, o.w + 220, 100, 350, mat.trim);
  }
  return g;
}

export function railing(
  parent: THREE.Object3D,
  a: Point,
  b: Point,
  y: number,
  mat: Mats,
  height = 1050,
) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.Group();
  g.position.set(a[0], y, a[1]);
  g.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  parent.add(g);
  box(g, length / 2, 60, 0, length, 120, 180, mat.trim);
  box(g, length / 2, height, 0, length + 80, 65, 100, mat.metal);
  for (let i = 0; i <= Math.ceil(length / 230); i++)
    box(
      g,
      (i * length) / Math.ceil(length / 230),
      height / 2,
      0,
      25,
      height,
      25,
      mat.metal,
      false,
    );
  for (let i = 0; i <= Math.ceil(length / 2600); i++) {
    const x = (i * length) / Math.ceil(length / 2600);
    box(g, x, height / 2, 0, 160, height, 160, mat.trim);
    box(g, x, height + 25, 0, 240, 90, 240, mat.stone);
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
  slab(g, outline, -15, 160, mat.dark);
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
    path(a, b, 95, mat.roof);
  for (const [a, b] of [
    [A, B],
    [B, C],
    [C, D],
    [D, A],
  ])
    path(a, b, 55, mat.dark, 18);
  if (detailed) {
    const segments: [THREE.Vector3, THREE.Vector3][] = [];
    // 筒瓦完全离开坡面，近看、俯看时不再由相交表面的细边争抢像素。
    const tileLift = 37 * Math.hypot(1, rise / Z) + 6;
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
    for (let xx = -X + 80; xx < X; xx += 190) {
      const reach = Math.min(xx + X, X - xx, Z);
      for (const sign of [-1, 1])
        tileRow([xx, sign * Z], [xx, sign * (Z - reach)]);
    }
    for (let zz = -Z + 80; zz < Z; zz += 190) {
      const reach = Z - Math.abs(zz);
      for (const sign of [-1, 1])
        tileRow([sign * X, zz], [sign * (X - reach), zz]);
    }
    const tiles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(37, 37, 1, 6),
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
          12,
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
  const upstream = floorplanFurnitureModel(f, mat.glass);
  if (upstream) {
    g.add(upstream);
    return g;
  }
  if (f.kind === "bed") {
    // 宽／深为占地外轮廓；床垫与床头柜都落在轮廓内，与平面图 1:1。
    const layout = bedLayout(f);
    box(g, 0, 200, 0, layout.mattressW, 350, f.d, mat.wood);
    box(g, 0, 430, 0, Math.max(400, layout.mattressW - 50), 180, f.d - 60, mat.fabric);
    box(g, 0, 700, f.d / 2 - 50, layout.mattressW, 950, 120, mat.wood);
    for (const x of [-layout.mattressW / 4, layout.mattressW / 4])
      box(g, x, 570, f.d / 2 - 380, layout.mattressW / 2 - 120, 140, 420, mat.inside);
    box(g, 0, 550, -330, layout.mattressW, 70, f.d * 0.58, mat.fabric);
    if (layout.showNightstands) {
      const nsH = 520;
      for (const side of [-1, 1]) {
        box(
          g,
          side * (f.w / 2 - layout.nsW / 2),
          nsH / 2,
          f.d / 2 - layout.nsD / 2,
          layout.nsW,
          nsH,
          layout.nsD,
          mat.wood,
        );
      }
    }
  } else if (f.kind === "tv") {
    box(g, 0, 350, 0, f.w * 0.55, 700, f.d * 0.7, mat.wood);
    box(g, 0, 950, -f.d * 0.05, f.w, 700, 60, mat.dark);
    box(g, 0, 950, -f.d * 0.08, f.w - 80, 580, 20, mat.glass);
  } else if (f.kind === "coffeeTable") {
    box(g, 0, 380, 0, f.w, 60, f.d, mat.wood);
    for (const xx of [-1, 1])
      for (const zz of [-1, 1])
        box(g, xx * (f.w / 2 - 80), 190, zz * (f.d / 2 - 80), 50, 380, 50, mat.wood);
  } else if (f.kind === "dressingTable") {
    box(g, 0, 380, 0, f.w, 760, f.d, mat.wood);
    box(g, 0, 780, 0, f.w + 20, 40, f.d + 20, mat.inside);
    box(g, 0, 1150, -f.d / 2 + 20, f.w * 0.7, 550, 40, mat.glass);
  } else if (f.kind === "cabinet") {
    box(g, 0, 750, 0, f.w, 1500, f.d, mat.wood);
  } else if (f.kind === "squatToilet") {
    box(g, 0, 80, 0, f.w, 160, f.d, mat.inside);
    box(g, 0, 120, 0, f.w * 0.45, 40, f.d * 0.55, mat.dark);
  } else if (f.kind === "roundTable") {
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(f.w / 2, f.w / 2, 90, 48),
      mat.wood,
    );
    top.position.y = 770;
    top.castShadow = true;
    g.add(top);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(320, 400, 720, 16),
      mat.wood,
    );
    base.position.y = 360;
    g.add(base);
    const turntable = new THREE.Mesh(
      new THREE.CylinderGeometry(580, 580, 35, 32),
      mat.glass,
    );
    turntable.position.y = 840;
    g.add(turntable);
  } else if (["table", "altar", "chair"].includes(f.kind)) {
    const h = f.kind === "chair" ? 460 : f.kind === "altar" ? 950 : 760;
    box(g, 0, h, 0, f.w, 70, f.d, mat.wood);
    for (const xx of [-1, 1])
      for (const zz of [-1, 1])
        box(
          g,
          xx * (f.w / 2 - 80),
          h / 2,
          zz * (f.d / 2 - 80),
          50,
          h,
          50,
          mat.wood,
        );
    if (f.kind === "chair")
      box(g, 0, 690, f.d / 2 - 40, f.w, 440, 60, mat.wood);
  } else if (f.kind === "sofa") {
    // 与平面一致：+Z 靠背，−Z 落座，±X 双侧扶手
    const armW = 170;
    box(g, 0, 320, 0, f.w - armW * 2, 420, f.d - 120, mat.fabric);
    box(g, 0, 720, f.d / 2 - 80, f.w - armW * 2, 500, 140, mat.fabric);
    for (const side of [-1, 1])
      box(g, side * (f.w / 2 - armW / 2), 550, 0, armW, 550, f.d, mat.fabric);
  } else if (f.kind === "wardrobe") {
    box(g, 0, 1020, 0, f.w, 2040, f.d, mat.wood);
  } else if (f.kind === "shrine") {
    // +Z 贴墙柜背，−Z 龛台朝人（与平面／catalog 约定一致）
    const h = 2200;
    box(g, 0, h / 2, 0, f.w, h, f.d, mat.wood);
    box(g, 0, h - 60, f.d / 2 - 30, f.w + 40, 120, 60, mat.wood);
    for (const y of [550, 1050, 1550]) {
      box(g, 0, y, 20, f.w - 120, 40, f.d - 100, mat.inside);
      box(g, 0, y + 180, -f.d / 2 + 60, f.w - 200, 280, 40, mat.dark);
    }
  } else if (["counter", "stove", "hob", "sink"].includes(f.kind)) {
    box(
      g,
      0,
      420,
      0,
      f.w,
      840,
      f.d,
      f.kind === "stove" ? mat.stone : mat.wood,
    );
    box(g, 0, 860, 0, f.w + 40, 60, f.d + 40, mat.inside);
    if (f.kind === "stove") {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(280, 240, 80, 20),
        mat.dark,
      );
      pot.position.y = 930;
      g.add(pot);
      box(g, 0, 250, -f.d / 2 - 10, 400, 280, 20, mat.dark);
    } else if (f.kind === "hob") {
      box(g, 0, 910, 0, f.w - 70, 35, 950, mat.dark);
      for (const z of [-250, 250]) {
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(130, 130, 25, 20), mat.metal);
        burner.position.set(0, 943, z);
        g.add(burner);
      }
    } else if (f.kind === "sink") {
      box(g, -500, 903, 0, 760, 25, 430, mat.metal);
      box(g, -500, 919, 0, 630, 10, 310, mat.dark);
      cylinder(g, new THREE.Vector3(-500, 900, 180), new THREE.Vector3(-500, 1170, 180), 18, mat.metal, 8);
      cylinder(g, new THREE.Vector3(-500, 1170, 180), new THREE.Vector3(-500, 1170, 0), 18, mat.metal, 8);
    }
  } else if (f.kind === "railing") {
    // 局部宽沿 X，与平面窄条一致；高度沿用通用室内栏杆
    railing(g, [-f.w / 2, 0], [f.w / 2, 0], 0, mat);
  } else if (f.kind === "toilet" || f.kind === "basin") {
    box(
      g,
      0,
      f.kind === "toilet" ? 230 : 420,
      0,
      f.w,
      f.kind === "toilet" ? 450 : 820,
      f.d,
      mat.inside,
    );
    if (f.kind === "toilet")
      box(g, 0, 560, f.d / 2 - 60, f.w, 520, 140, mat.inside);
    if (f.kind === "basin") {
      box(g, 0, 860, 0, f.w * 0.7, 40, f.d * 0.55, mat.metal);
    }
  } else if (f.kind === "shower") {
    // 托盘及单面玻璃；示意用，非卫浴施工详图。
    box(g, 0, 50, 0, f.w, 100, f.d, mat.inside);
    const glassH = 1850;
    const t = 30;
    box(g, 0, glassH / 2, f.d / 2 - t / 2, f.w, glassH, t, mat.glass);
  } else {
    box(g, 0, 400, 0, f.w, 800, f.d, mat.wood);
  }
  // 未映射到新库的神龛、柴火灶、栏杆等旧件也按保存的完整占地收口。
  const shape = new THREE.Group();
  shape.add(...g.children);
  g.add(fitFurnitureFootprint(shape, f.w, f.d));
  return g;
}

/** 楼梯示意几何（与 stairLayout／草稿 stair 字段对齐）。 */
export type StairSoffitGeom = {
  middleTread?: number;
  model?: "double" | "triple";
  x: number;
  z: number;
  flight: number;
  gap: number;
  tread: number;
  risers: number;
  landing: number;
  axis: "x" | "z";
  lowerSide?: "min" | "max";
  direction?: "positive" | "negative";
  room: { x: number; z: number; w: number; d: number };
};

const STAIR_TREAD_THICK = 55;
const STAIR_LANDING_THICK = 180;

/**
 * 点位在楼梯板底的净空高度（相对楼梯 base）；不在梯下则 null。
 * 用于梯下公卫隔墙封顶，避免穿出踏步／休息平台。
 */
export function stairSoffitClearHeight(
  px: number,
  pz: number,
  stair: StairSoffitGeom,
  storyHeight: number,
): number | null {
  const shape = stairShape(stair);
  const rise = storyHeight / shape.risers;
  const { along, across } = shape.local(px, pz);
  if (shape.model === "triple") {
    for (const p of shape.platforms) {
      if (across >= p.cross && across <= p.cross + stair.landing && along >= p.along && along <= p.along + stair.landing)
        return rise * p.riser - STAIR_LANDING_THICK;
    }
    for (const f of shape.flights) {
      if (across < f.cross || across > f.cross + f.crossSize || along < f.along || along > f.along + f.alongSize) continue;
      const distance = f.axis === "along" ? along - f.along : across - f.cross;
      const length = f.axis === "along" ? f.alongSize : f.crossSize;
      const travel = f.sign > 0 ? distance : length - distance;
      const step = Math.min(f.risers - 1, Math.floor(travel / f.tread) + 1);
      const treadBottom = rise * (f.startRiser + step) - STAIR_TREAD_THICK;
      const riserBottom = travel % f.tread < 40 ? rise * (f.startRiser + step - 1) : Infinity;
      return Math.max(0, Math.min(treadBottom, riserBottom));
    }
    return null;
  }
  const run = shape.run;
  const flight = stair.flight;
  const gap = stair.gap;
  const midY = rise * shape.lowerRisers;
  const inLower = across >= shape.lowerAcross && across <= shape.lowerAcross + flight;
  const inUpper = across >= shape.upperAcross && across <= shape.upperAcross + flight;
  if (along >= run && along <= run + stair.landing && across >= 0 && across <= 2 * flight + gap) {
    return midY - STAIR_LANDING_THICK;
  }
  if (inLower && along >= shape.lowerStart && along < run) {
    const step = Math.floor((along - shape.lowerStart) / stair.tread) + 1;
    return Math.max(0, rise * step - STAIR_TREAD_THICK);
  }
  if (inUpper && along >= shape.upperStart && along < run) {
    const step = Math.min(shape.upperTreads, Math.ceil((run - along) / stair.tread));
    return midY + rise * step - STAIR_TREAD_THICK;
  }
  // 梯井缝、梯间预留与实体外部均无板底，不能按平台高度压低整片隔墙。
  return null;
}

export function stairs(
  parent: THREE.Object3D,
  x: number,
  z: number,
  base: number,
  height: number,
  mat: Mats,
  axis: "x" | "z" = "z",
  geometry: StairShapeInput = { ...stairLayout, x, z, axis },
  withRailings = true,
) {
  // x、z 始终为包络最小角；实体、栏杆和板底共用上行方向变换。
  // 踏步用薄板（踏面＋踢面），不做从地面堆高的实心楔块。
  const shape = stairShape({ ...geometry, x, z, axis });
  const rise = height / shape.risers,
    tread = geometry.tread,
    flight = geometry.flight,
    gap = geometry.gap;
  const treadThick = STAIR_TREAD_THICK;
  const riserThick = 40;
  const put = (
    across: number,
    y: number,
    along: number,
    acrossSize: number,
    ySize: number,
    alongSize: number,
  ) => {
    const point = shape.point(across, along);
    if (axis === "z")
      box(parent, point.x, base + y, point.z, acrossSize, ySize, alongSize, mat.paving);
    else box(parent, point.x, base + y, point.z, alongSize, ySize, acrossSize, mat.paving);
  };
  if (withRailings) railingNetwork(stairRailingSections({ ...geometry, x, z, axis }, base, height, resolvedRailingStyle(geometry.railingStyle, "stair"))).render(parent);
  if (shape.model === "triple") {
    for (const f of shape.flights) {
      const tread = f.tread;
      const length = f.axis === "along" ? f.alongSize : f.crossSize;
      const pos = (distance: number, y: number) => {
        const along = f.sign > 0 ? distance : length - distance;
        return f.axis === "along"
          ? [f.cross + flight / 2, y, f.along + along]
          : [f.cross + along, y, f.along + flight / 2];
      };
      for (let i = 0; i < f.risers - 1; i++) {
        const p = pos((i + .5) * tread, 0);
        put(p[0], rise * (f.startRiser + i + 1) - treadThick / 2, p[2], f.axis === "along" ? flight : tread, treadThick, f.axis === "along" ? tread : flight);
      }
      // 包括平台／上层楼面前的最后一个踢面，接住完整层高。
      for (let i = 0; i < f.risers; i++) {
        const p = pos(i * tread + riserThick / 2, 0);
        // 最后踢面向梯段内侧收厚，避免穿进平台或楼层出口。
        const last = i === f.risers - 1 ? pos(i * tread - riserThick / 2, 0) : p;
        put(last[0], rise * (f.startRiser + i + .5), last[2], f.axis === "along" ? flight : riserThick, rise, f.axis === "along" ? riserThick : flight);
      }
    }
    for (const p of shape.platforms) {
      put(p.cross + geometry.landing / 2, rise * p.riser - STAIR_LANDING_THICK / 2, p.along + geometry.landing / 2, geometry.landing, STAIR_LANDING_THICK, geometry.landing);
    }
    return;
  }
  const flightAcross = shape.lowerAcross + flight / 2;
  const returnAcross = shape.upperAcross + flight / 2;
  for (let i = 0; i < shape.lowerTreads; i++) {
    // 下跑：向 along 正向上
    const y1 = rise * (i + 1);
    put(flightAcross, y1 - treadThick / 2, shape.lowerStart + tread * (i + 0.5), flight, treadThick, tread);
    put(flightAcross, y1 - rise / 2, shape.lowerStart + tread * i + riserThick / 2, flight, rise, riserThick);
  }
  for (let i = 0; i < shape.upperTreads; i++) {
    // 上跑：折返沿 along 负向上
    const y2 = rise * (shape.lowerRisers + i + 1);
    put(returnAcross, y2 - treadThick / 2, shape.run - tread * (i + 0.5), flight, treadThick, tread);
    put(returnAcross, y2 - rise / 2, shape.run - tread * i - riserThick / 2, flight, rise, riserThick);
  }
  // 休息平台：薄楼板
  put(
    flight + gap / 2,
    rise * shape.lowerRisers - STAIR_LANDING_THICK / 2,
    shape.run + geometry.landing / 2,
    flight * 2 + gap,
    STAIR_LANDING_THICK,
    geometry.landing,
  );
}
