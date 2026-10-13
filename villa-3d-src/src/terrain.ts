import * as THREE from "three";
import { site, frontFieldLevel, type Point } from "./data";
import {
  box,
  hipRoof,
  slab,
  rect,
  railing,
  wallWithOpenings,
  random,
  line,
  tag,
  type Mats,
} from "./primitives";
import { buildCar } from "./architecture";
import { surroundings, forestTrees } from "./surroundings";
import { buildContextGround, buildRoad } from "./site-ground";

function woodenHouse(
  parent: THREE.Object3D,
  x: number,
  z: number,
  w: number,
  d: number,
  y: number,
  mat: Mats,
  height = 5.4,
) {
  const g = new THREE.Group();
  parent.add(g);
  box(g, x + w / 2, y + height / 2, z + d / 2, w, height, d, mat.wood);
  for (let xx = x + 0.4; xx < x + w; xx += 1.5) {
    box(g, xx, y + 2.6, z - 0.09, 0.14, height, 0.15, mat.dark);
    box(g, xx + 0.5, y + 1.45, z - 0.11, 0.65, 0.95, 0.04, mat.glass, false);
    box(g, xx + 0.5, y + 1.45, z - 0.14, 0.045, 1, 0.05, mat.wood);
    box(g, xx + 0.5, y + 1.45, z - 0.14, 0.68, 0.045, 0.05, mat.wood);
  }
  box(g, x + w / 2, y + 3.1, z - 0.45, w, 0.16, 0.95, mat.wood);
  railing(g, [x + 0.1, z - 0.85], [x + w - 0.1, z - 0.85], y + 3.2, mat, 0.95);
  hipRoof(g, x + w / 2, z + d / 2, w + 1.1, d + 1.1, y + height, 1.5, mat);
  return g;
}

export function buildSurroundingHouses(mat: Mats) {
  const group = new THREE.Group();
  group.name = "周边邻房";
  for (const [name, h] of [
    ["左侧邻居木房", surroundings.sideHouse],
    ["后方第二层梯田木房", surroundings.rearHouse],
  ] as const) {
    const house = woodenHouse(group, h.x, h.z, h.w, h.d, h.y, mat, h.h);
    house.name = name;
  }
  const rear = surroundings.rearHouse;
  slab(
    group,
    rect(rear.x, rear.z - 1.5, rear.w, 1.5),
    rear.y + 0.025,
    0.15,
    mat.paving,
  );
  for (let i = 0; i < 6; i++) {
    box(
      group,
      rear.x + rear.w - 0.8,
      rear.y - 0.8 + ((i + 1) * 0.8) / 12,
      rear.z - 2.9 + i * 0.24,
      1.5,
      ((i + 1) * 0.8) / 6,
      0.24,
      mat.paving,
    );
  }

  const h = surroundings.frontHouse;
  const house = new THREE.Group();
  house.name = "前方两层砖房";
  group.add(house);
  const height = h.floors * h.floorHeight;
  const back = h.z + h.d,
    left = h.x + h.w;
  // 两层楼的窗带、楼板线和阳台均可辨识，避免只有一块低矮的屋顶占位。
  for (let i = 0; i < h.floors; i++) {
    const y = h.y + i * h.floorHeight;
    const openings = Array.from({ length: 5 }, (_, j) => ({
      at: 1.7 + (j * (h.w - 3.4)) / 4,
      w: 1.6,
      sill: 0.9,
      h: 1.6,
    }));
    wallWithOpenings(
      house,
      [h.x, h.z],
      [left, h.z],
      y,
      h.floorHeight,
      openings,
      mat,
    );
    wallWithOpenings(
      house,
      [h.x, back],
      [left, back],
      y,
      h.floorHeight,
      openings,
      mat,
    );
    for (const x of [h.x, left]) {
      wallWithOpenings(
        house,
        [x, h.z],
        [x, back],
        y,
        h.floorHeight,
        [
          { at: 2, w: 1.4, sill: 0.9, h: 1.6 },
          { at: 5.4, w: 1.4, sill: 0.9, h: 1.6 },
        ],
        mat,
      );
    }
    slab(house, rect(h.x, h.z, h.w, h.d), y + 0.03, 0.15, mat.paving);
    box(
      house,
      h.x + h.w / 2,
      y + h.floorHeight - 0.08,
      h.z - 0.15,
      h.w + 0.1,
      0.16,
      0.15,
      mat.trim,
    );
  }
  slab(
    house,
    rect(h.x + 0.2, h.z - 1, h.w - 0.4, 1),
    h.y + h.floorHeight,
    0.17,
    mat.paving,
  );
  railing(
    house,
    [h.x + 0.3, h.z - 0.95],
    [left - 0.3, h.z - 0.95],
    h.y + h.floorHeight,
    mat,
  );
  const blue = mat.roof.clone();
  blue.color.set(0x708e9b);
  hipRoof(
    house,
    h.x + h.w / 2,
    h.z + h.d / 2,
    h.w + 0.5,
    h.d + 0.6,
    h.y + height,
    0.6,
    { ...mat, roof: blue },
    false,
  );
  return group;
}

function vegetation(parent: THREE.Object3D, mat: Mats) {
  const trees = forestTrees();
  // 透明叶簇替代整颗球形树冠，保留不规则轮廓、枝叶间隙和真实阴影。
  const leafCanvas = document.createElement("canvas");
  leafCanvas.width = leafCanvas.height = 256;
  const ctx = leafCanvas.getContext("2d")!;
  for (let i = 0; i < 15; i++) {
    const angle = random() * Math.PI * 2,
      radius = 35 + random() * 73;
    const xx = 128 + Math.cos(angle) * radius,
      yy = 134 + Math.sin(angle) * radius * 0.8;
    ctx.strokeStyle = "#6a7154";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(128, 182);
    ctx.quadraticCurveTo(128, 110, xx, yy);
    ctx.stroke();
    for (let k = 0; k < 27; k++) {
      const a = random() * Math.PI * 2,
        r = Math.sqrt(random()) * 32;
      ctx.fillStyle = `hsl(${78 + random() * 29} ${23 + random() * 17}% ${30 + random() * 29}%)`;
      ctx.beginPath();
      ctx.ellipse(
        xx + Math.cos(a) * r,
        yy + Math.sin(a) * r,
        3 + random() * 3,
        1.4 + random() * 2.1,
        a,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  const leafMap = new THREE.CanvasTexture(leafCanvas);
  leafMap.colorSpace = THREE.SRGBColorSpace;
  const leaves = new THREE.MeshStandardMaterial({
    map: leafMap,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 1,
    color: 0xb0c9a0,
  });
  const countPerTree = 24;
  const crowns = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    leaves,
    trees.length * countPerTree,
  );
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.07, 0.15, 1, 6),
    mat.trunk,
    trees.length,
  );
  const matrix = new THREE.Matrix4(),
    q = new THREE.Quaternion();
  trees.forEach((t, i) => {
    q.identity();
    matrix.compose(
      new THREE.Vector3(t.x, t.y + t.h / 2, t.z),
      q,
      new THREE.Vector3(1, t.h, 1),
    );
    trunks.setMatrixAt(i, matrix);
    for (let j = 0; j < countPerTree; j++) {
      const angle = random() * Math.PI * 2,
        reach = Math.sqrt(random()) * t.r,
        size = t.r * (1.1 + random() * 0.8);
      q.setFromEuler(
        new THREE.Euler(random() * 2.4, random() * Math.PI * 2, random() * 2),
      );
      matrix.compose(
        new THREE.Vector3(
          t.x + Math.cos(angle) * reach,
          t.y + t.h - 1 + random() * t.r * 1.5,
          t.z + Math.sin(angle) * reach,
        ),
        q,
        new THREE.Vector3(size, size, size),
      );
      crowns.setMatrixAt(i * countPerTree + j, matrix);
      crowns.setColorAt(
        i * countPerTree + j,
        new THREE.Color().setHSL(
          0.23 + random() * 0.06,
          0.13 + random() * 0.2,
          0.52 + random() * 0.18,
        ),
      );
    }
  });
  crowns.castShadow = crowns.receiveShadow = true;
  trunks.castShadow = true;
  crowns.name = "后山树冠";
  trunks.name = "后山树干";
  parent.add(crowns, trunks);
}

export function buildCourtyard(mat: Mats) {
  const deck = new THREE.Group();
  deck.name = "完整院坪与右侧人行通道";
  slab(deck, site.field, 0, 0.23, mat.paving).name = "无中央楼梯洞的院坪";
  for (let i = 2; i < site.field.length - 1; i++) {
    const a = site.field[i], b = site.field[i + 1];
    railing(deck, [a[0], a[1] + 0.08], [b[0], b[1] + 0.08], 0, mat, 1.1);
  }
  // 两米左右前通道接右侧过道，在后段与院坪同高的梯田处开放出口。
  const path = mat.trim.clone();
  slab(deck, rect(0.18, -2.85, 5.12, 1.55), 0.015, 0.01, path).name = "辅楼前约2米人行通道";
  slab(deck, rect(0.18, -1.3, 0.58, 8.6), 0.015, 0.01, path).name = "通往右侧同高梯田的侧道";
  railing(deck, [0.12, -2.98], [0.12, surroundings.rightStep], 0, mat, 1.1);
  box(deck, 13.6, -0.335, -0.5, 13.6, 0.23, 0.36, mat.stone);
  return deck;
}

export function buildSite(mat: Mats) {
  const context = new THREE.Group(),
    fixed = new THREE.Group(),
    existing = new THREE.Group(),
    proposed = new THREE.Group(),
    deck = buildCourtyard(mat),
    garage = new THREE.Group(),
    road = buildRoad(mat),
    neighborDeck = new THREE.Group(),
    cutPiece = new THREE.Group(),
    cutOutline = new THREE.Group(),
    dimensions = new THREE.Group(),
    overlap = new THREE.Group();
  context.add(buildContextGround(mat));
  context.add(buildSurroundingHouses(mat));
  // 自家基础与边界维持已确认方案；场地以外的梯田由独立近景轮廓承接。
  const foundationTop = site.garageFloor - 0.15;
  slab(fixed, site.boundary, foundationTop, foundationTop - frontFieldLevel, mat.soil);
  slab(fixed, rect(0, 0, 21.1, 10.8), 0, -foundationTop, mat.stone);
  slab(fixed, rect(0, 0, 21.1, 10.8), 0.01, 0.07, mat.paving);
  box(fixed, 10.55, 1.25, 10.96, 21.1, 2.5, 0.32, mat.stone);
  box(fixed, 10.55, 0.025, 10.52, 20.9, 0.035, 0.16, mat.dark);
  vegetation(context, mat);
  context.add(road);
  slab(fixed, rect(21.1, -8.6, 5, 2.5), -3.15, 0.15, mat.soil);

  const yard = surroundings.neighborYard;
  // 铺满邻居木房的整个面宽。只有已确认的拟切块可独立隐藏，保留其余地坪。
  slab(neighborDeck, rect(yard.x, -6.1, yard.w, 6.5), 0, 0.23, mat.paving);
  slab(
    neighborDeck,
    rect(26.1, -8.6, surroundings.road.x - 26.1, 2.5),
    0,
    0.23,
    mat.paving,
  );
  slab(cutPiece, rect(21.1, -8.6, 5, 2.5), 0, 0.23, mat.paving);
  for (const x of [21.5, 25.7, 29.7, surroundings.road.x - 0.35]) {
    for (const z of [-5.7, 0.15])
      box(neighborDeck, x, -1.1, z, 0.25, 1.8, 0.25, mat.stone);
  }
  railing(
    neighborDeck,
    [surroundings.road.x - 0.06, -8.6],
    [surroundings.road.x - 0.06, 0.35],
    0,
    mat,
  );
  railing(
    neighborDeck,
    [26.1, -8.5],
    [surroundings.road.x - 0.06, -8.5],
    0,
    mat,
  );
  railing(cutPiece, [21.15, -8.5], [26.1, -8.5], 0, mat);
  line(
    cutOutline,
    [...rect(21.1, -8.6, 5, 2.5), [21.1, -8.6]].map(
      ([x, z]) => new THREE.Vector3(x, 0.07, z),
    ),
    0xc78a3a,
    true,
  );
  tag(cutOutline, "拟露天切口 · 待协商复核", 23.6, 0.55, -8.6, "#85551b", 0.9);
  tag(
    cutOutline,
    "保留坪下接入段 · 净高待核",
    30.2,
    0.6,
    -7.35,
    "#85551b",
    0.85,
  );
  context.add(neighborDeck, cutPiece, cutOutline);

  // 正前方电杆及架空线按拆除计划移除。
  // 现状下保留自家两栋旧房和低田。
  slab(
    existing,
    rect(21.1, -8.6, surroundings.road.x - 21.1, 2.5),
    -2,
    0.15,
    mat.paving,
  );
  slab(existing, site.field, site.originalField, 0.3, mat.grass);
  woodenHouse(existing, 8.8, 1.1, 12.3, 7.9, 0, mat, 4.6);
  box(existing, 4.4, 1.55, 5.0, 8.8, 3.1, 8.5, mat.wall);
  slab(existing, rect(0, 0.75, 8.8, 8.5), 3.2, 0.17, mat.stone);
  railing(existing, [0.1, 0.85], [8.7, 0.85], 3.2, mat);
  for (const x of [2.3, 6.3])
    box(existing, x, 1.55, 0.72, 1.8, 1.7, 0.035, mat.glass, false);
  slab(
    existing,
    [
      [0.2, -0.1],
      [8.6, -0.1],
      [7.7, -4.2],
      [1.2, -2.7],
    ],
    0,
    0.22,
    mat.paving,
  );
  railing(existing, [1.2, -2.7], [7.7, -4.2], 0, mat);
  // 新地库顶板与楼下空间。
  slab(garage, site.field, site.garageFloor, 0.15, mat.paving);
  for (const [x, z] of [
    [1.8, -0.9],
    [6.1, -3.5],
    [10.2, -4.6],
    [16.7, -7.05],
    [20.65, -8.05],
    [6.9, -0.5],
    [13.5, -0.5],
    [20.0, -0.5],
  ]) {
    box(garage, x, -1.59, z, 0.32, 2.72, 0.32, mat.stone);
  }
  // 梁底 -.45、地面 -2.95，示意最低净高2.50；不代表结构梁高可成立。
  const routeWall: Point[] = [
    [0.2, -2.95],
    [2.6, -2.95],
    [8.8, -4.85],
    [16, -7.45],
    [20.9, -8.42],
  ];
  for (let i = 1; i < routeWall.length; i++) {
    const a = routeWall[i - 1],
      b = routeWall[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = box(
      garage,
      (a[0] + b[0]) / 2,
      -2.43,
      (a[1] + b[1]) / 2,
      len,
      1.04,
      0.2,
      mat.stone,
    );
    m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  }
  const parked = buildCar(mat);
  parked.position.set(18.5, site.garageFloor, -4.02);
  garage.add(parked);
  const second = buildCar(mat, 0x988164, true);
  second.position.set(14.65, site.garageFloor, -3.75);
  garage.add(second);
  for (const [x, z, name] of [
    [18.5, -4.02, "L9 · 车位示意"],
    [14.65, -3.75, "第二辆车 · 待定"],
  ] as [number, number, string][]) {
    line(
      garage,
      [...rect(x - 1.35, z - 2.75, 2.7, 5.5), [x - 1.35, z - 2.75]].map(
        ([xx, zz]) => new THREE.Vector3(xx, site.garageFloor + 0.02, zz),
      ),
      0xc8bfa4,
    );
    tag(garage, name, x, -1.9, z, "#685b40", 0.7);
  }
  box(garage, 3.7, -2.25, -0.85, 3.6, 1.3, 0.8, mat.wood);
  const overlapMat = new THREE.MeshBasicMaterial({
    color: 0xcf964c,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  slab(overlap, rect(6.8, -1, 13.5, 1), 0.035, 0.025, overlapMat);
  slab(overlap, rect(site.portico.x, site.main.z - site.portico.projection, site.portico.w, site.portico.projection), 0.035, 0.025, overlapMat);
  tag(overlap, "主楼前伸 1.0m · 与地库重叠", 13.55, 0.9, -0.4, "#835824");
  overlap.visible = false;
  proposed.add(deck, garage, overlap);
  const p = (x: number, z: number, y = 0.08) => new THREE.Vector3(x, y, z);
  line(
    dimensions,
    [...site.boundary, site.boundary[0]].map(([x, z]) => p(x, z)),
    0xa77332,
    true,
  );
  line(dimensions, [p(0, 11.55, 2.7), p(21.1, 11.55, 2.7)], 0x466a59);
  tag(dimensions, "东西总宽 21.1m", 10.55, 3.4, 11.55);
  for (const [x, depth] of [
    [21.1, 8.6],
    [8.8, 5],
    [2.6, 3],
  ]) {
    line(dimensions, [p(x, 0, 0.13), p(x, -depth, 0.13)], 0xa77332, true);
    tag(
      dimensions,
      `${depth.toFixed(1)}m`,
      x,
      0.5,
      -depth / 2,
      "#835824",
      0.48,
    );
  }
  tag(dimensions, "子孙道 1.5m", 6.05, 0.9, 4, "#284b3b", 0.7);
  tag(dimensions, "后退 1.8m", 13.7, 0.5, 9.9, "#284b3b", 0.65);
  tag(dimensions, "门厅外伸 2m · 投影另计", 13.7, 0.7, -2, "#835824", 0.8);
  tag(dimensions, "约2m人行通道", 2.9, 0.5, -2.1, "#284b3b", 0.75);
  tag(dimensions, "通往右侧同高梯田", 0.2, 0.6, 7, "#284b3b", 0.8);
  tag(dimensions, "前田比地库低约2m", 8, frontFieldLevel + 0.55, -9, "#284b3b", 0.9);
  tag(dimensions, "砖房台地再低约1.5m", 11, surroundings.frontHouse.y + 0.55, -16, "#284b3b", 0.9);
  dimensions.visible = false;
  return {
    context,
    fixed,
    existing,
    proposed,
    deck,
    garage,
    cutPiece,
    cutOutline,
    dimensions,
    overlap,
    parked,
    road,
    second,
  };
}

export function makeRamp(
  parent: THREE.Group,
  mat: Mats,
  roadY: number,
  length: number,
) {
  const startX = 21.1 + length,
    endX = 21.1;
  const g = new THREE.Group();
  parent.add(g);
  // 接入道路随坡长变化，始终衔接左墙外的道路，不额外切除邻居地坪。
  slab(
    g,
    rect(startX, -8.6, surroundings.road.x - startX, 2.5),
    roadY,
    0.15,
    mat.paving,
  );
  const p = new Float32Array([
    startX,
    roadY,
    -8.6,
    startX,
    roadY,
    -6.1,
    endX,
    site.garageFloor,
    -6.1,
    endX,
    site.garageFloor,
    -8.6,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  geo.computeVertexNormals();
  const material = mat.paving.clone();
  material.side = THREE.DoubleSide;
  const ramp = new THREE.Mesh(geo, material);
  ramp.receiveShadow = true;
  g.add(ramp);
  line(
    g,
    [
      new THREE.Vector3(startX, roadY + 0.03, -7.35),
      new THREE.Vector3(endX, site.garageFloor + 0.03, -7.35),
    ],
    0xbd8136,
    true,
  );
  return g;
}
