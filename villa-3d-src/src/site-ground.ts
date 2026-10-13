import * as THREE from "three";
import { site, frontFieldLevel, contains, type Point } from "./data";
import { rect, box, type Mats } from "./primitives";
import {
  surroundings as c,
  groundHeight,
  roadStations,
  roadHeight,
  rightTerraceBreak,
  rightLowerBreak,
} from "./surroundings";

function surface(
  parent: THREE.Object3D,
  name: string,
  points: Point[],
  y: number,
  material: THREE.Material,
) {
  const shape = new THREE.Shape(
    points.map(([x, z]) => new THREE.Vector2(x, -z)),
  );
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) / 30, uv.getY(i) / 30);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.y = y;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// 只生成高差处的立面，不用重叠的大盒子叠台地，避免共享面闪烁。
function riser(
  parent: THREE.Object3D,
  points: Point[],
  top: number,
  bottom: number | ((x: number, z: number) => number),
  mat: Mats,
) {
  const vertices: number[] = [],
    uv: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const ya = typeof bottom === "number" ? bottom : bottom(...a);
    const yb = typeof bottom === "number" ? bottom : bottom(...b);
    const quad = [
      [a[0], ya, a[1]],
      [b[0], yb, b[1]],
      [b[0], top, b[1]],
      [a[0], top, a[1]],
    ];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      vertices.push(...quad[index]);
      uv.push(quad[index][0] / 8 + quad[index][2] / 8, quad[index][1] / 8);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const material = mat.soil.clone();
  material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "梯田高差立面";
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
}

function cropRows(
  parent: THREE.Object3D,
  polygon: Point[],
  y: number,
  mat: Mats,
) {
  const xs = polygon.map((p) => p[0]),
    zs = polygon.map((p) => p[1]);
  const material = mat.grass.clone();
  material.color.set(0x75864d);
  for (let x = Math.min(...xs) + 0.8; x < Math.max(...xs) - 0.5; x += 1.25) {
    for (let z = Math.min(...zs) + 0.6; z < Math.max(...zs) - 0.7; z += 2.2) {
      if (!contains([x, z], polygon) || !contains([x, z + 1.7], polygon))
        continue;
      box(parent, x, y + 0.035, z + 0.85, 0.13, 0.07, 1.7, material, false);
    }
  }
}

export function buildContextGround(mat: Mats) {
  const group = new THREE.Group();
  group.name = "航拍校准梯田";
  const e = c.extent,
    roadRight = c.road.x + c.road.w;
  const upper: Point[] = [
    [e.left, site.oldDepth],
    [0, site.oldDepth],
    ...rightTerraceBreak.slice().reverse(),
  ];
  const lower: Point[] = [
    ...rightTerraceBreak,
    ...rightLowerBreak.slice().reverse(),
  ];
  const rightFront: Point[] = [
    [e.left, c.road.front],
    [0, c.road.front],
    ...rightLowerBreak.slice().reverse(),
  ];
  surface(group, "辅楼右侧上田·与院坪齐平", upper, 0, mat.grass);
  surface(group, "辅楼右侧下田·与地库齐平", lower, site.garageFloor, mat.grass);
  surface(group, "右侧前方低田", rightFront, c.frontHouse.y, mat.grass);
  riser(group, rightTerraceBreak, 0, site.garageFloor, mat);
  riser(group, rightLowerBreak, site.garageFloor, c.frontHouse.y, mat);
  cropRows(group, upper, 0, mat);
  cropRows(group, lower, site.garageFloor, mat);

  // 自家异形旱地外侧的低田；田顶、道路、坡道使用相邻而不重叠的轮廓。
  surface(
    group,
    "前方旱地外缘",
    [
      [0, -12],
      [c.road.x, -12],
      [c.road.x, -8.6],
      [21.1, -8.6],
      ...site.field.slice(3),
    ],
    frontFieldLevel,
    mat.grass,
  );
  surface(
    group,
    "前方砖房台地",
    rect(0, c.road.front, c.road.x, -12 - c.road.front),
    c.frontHouse.y,
    mat.grass,
  );
  riser(
    group,
    [
      [0, -12],
      [c.road.x, -12],
    ],
    frontFieldLevel,
    c.frontHouse.y,
    mat,
  );
  // 右侧低田与正前方更低的田之间补竖向田坎，避免台地交接露空。
  riser(group, [[0, site.field.at(-1)![1]], [0, rightLowerBreak.at(-1)![1]]], site.garageFloor, frontFieldLevel, mat);
  riser(group, [[0, rightLowerBreak.at(-1)![1]], [0, -12]], frontFieldLevel, c.frontHouse.y, mat);
  surface(
    group,
    "邻居坪下地面",
    rect(21.1, -6.1, c.road.x - 21.1, 6.5),
    -2,
    mat.soil,
  );
  surface(
    group,
    "左侧邻居木房地基",
    rect(21.1, 0.4, c.road.x - 21.1, 10.4),
    0,
    mat.soil,
  );
  riser(
    group,
    [
      [21.1, 0.4],
      [c.road.x, 0.4],
    ],
    0,
    -2,
    mat,
  );

  const leftTop = rect(
    roadRight,
    c.leftPlatform.front,
    e.right - roadRight,
    c.leftPlatform.back - c.leftPlatform.front,
  );
  surface(group, "道路左侧外伸高地", leftTop, c.leftPlatform.y, mat.grass);
  surface(
    group,
    "高地前方低田",
    rect(
      roadRight,
      c.road.front,
      e.right - roadRight,
      c.leftPlatform.front - c.road.front,
    ),
    c.frontHouse.y,
    mat.grass,
  );
  riser(
    group,
    [
      [e.right, c.leftPlatform.front],
      [roadRight, c.leftPlatform.front],
    ],
    c.leftPlatform.y,
    c.frontHouse.y,
    mat,
  );
  riser(
    group,
    [
      [roadRight, c.leftPlatform.front],
      [roadRight, -8.6],
      [roadRight, -6.1],
      [roadRight, 0.4],
      [roadRight, 10.8],
    ],
    c.leftPlatform.y,
    (_x, z) => Math.min(c.leftPlatform.y, roadHeight(z)),
    mat,
  );
  cropRows(group, leftTop, c.leftPlatform.y, mat);

  // 屋后第一田 +2.5m；第二田承托后方木房，+5m 为本版照片估算。
  for (const [a, b] of [
    [e.left, c.road.x],
    [roadRight, e.right],
  ]) {
    surface(
      group,
      "屋后第一层梯田",
      rect(a, c.rearFirst.front, b - a, c.rearFirst.back - c.rearFirst.front),
      c.rearFirst.y,
      mat.grass,
    );
    riser(
      group,
      [
        [a, c.rearSecond.front],
        [b, c.rearSecond.front],
      ],
      c.rearSecond.y,
      c.rearFirst.y,
      mat,
    );
  }
  riser(
    group,
    [
      [e.left, 10.8],
      [0, 10.8],
    ],
    c.rearFirst.y,
    0,
    mat,
  );
  riser(
    group,
    [
      [21.1, 10.8],
      [c.road.x, 10.8],
    ],
    c.rearFirst.y,
    0,
    mat,
  );
  riser(
    group,
    [
      [roadRight, 10.8],
      [e.right, 10.8],
    ],
    c.rearFirst.y,
    c.leftPlatform.y,
    mat,
  );
  surface(
    group,
    "后方木房所在第二层梯田",
    [
      [e.left, 16.2],
      [c.road.x, 16.2],
      [c.road.x, 18],
      [roadRight, 18],
      [roadRight, 16.2],
      [e.right, 16.2],
      [e.right, 29.5],
      [e.left, 29.5],
    ],
    c.rearSecond.y,
    mat.grass,
  );
  surface(
    group,
    "后山前第三层梯田",
    rect(e.left, 29.5, e.right - e.left, 6.5),
    c.rearThird.y,
    mat.grass,
  );
  riser(
    group,
    [
      [e.left, 29.5],
      [e.right, 29.5],
    ],
    c.rearThird.y,
    c.rearSecond.y,
    mat,
  );
  cropRows(group, rect(-30, 17, 35, 10), c.rearSecond.y, mat);
  cropRows(group, rect(-30, 30, 82, 5), c.rearThird.y, mat);

  // 远处连续山坡只在近景精确轮廓外生成，不再覆盖路面或院坪。
  const xs = [
    ...new Set([
      ...Array.from({ length: 89 }, (_, i) => -55 + i * 1.5),
      e.left,
      e.right,
    ]),
  ].sort((a, b) => a - b);
  const zs = [
    ...new Set([
      ...Array.from({ length: 89 }, (_, i) => -45 + i * 1.5),
      e.front,
      e.back,
      -12,
      c.leftPlatform.front,
      8,
      -3,
      10.8,
      16.2,
      29.5,
    ]),
  ].sort((a, b) => a - b);
  const positions: number[] = [],
    uv: number[] = [];
  for (let i = 1; i < xs.length; i++)
    for (let j = 1; j < zs.length; j++) {
      const x = xs[i - 1],
        X = xs[i],
        z = zs[j - 1],
        Z = zs[j];
      if (
        (x + X) / 2 > e.left &&
        (x + X) / 2 < e.right &&
        (z + Z) / 2 > e.front &&
        (z + Z) / 2 < e.back
      )
        continue;
      const quad = [
        [x, z],
        [X, z],
        [X, Z],
        [x, Z],
      ];
      const flatY = groundHeight((x + X) / 2, (z + Z) / 2);
      for (const index of [0, 2, 1, 0, 3, 2]) {
        const [xx, zz] = quad[index];
        positions.push(
          xx,
          z >= c.forestStart ? groundHeight(xx, zz) : flatY,
          zz,
        );
        uv.push(xx / 30, zz / 30);
      }
      // 远田同样用水平田面和竖向田坎，接到近景边界时不留下斜三角空洞。
      if (z < c.forestStart) {
        const before = groundHeight((x + X) / 2, z - 0.001);
        if (Math.abs(flatY - before) > 0.01) {
          const edge = [
            [x, before, z],
            [X, before, z],
            [X, flatY, z],
            [x, flatY, z],
          ];
          for (const index of [0, 1, 2, 0, 2, 3]) {
            positions.push(...edge[index]);
            uv.push(edge[index][0] / 30, edge[index][1] / 30);
          }
        }
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const landscapeMaterial = mat.grass.clone();
  landscapeMaterial.side = THREE.DoubleSide;
  const mountain = new THREE.Mesh(geometry, landscapeMaterial);
  mountain.name = "后方山体与远田";
  mountain.castShadow = mountain.receiveShadow = true;
  group.add(mountain);
  return group;
}

export function buildRoad(mat: Mats) {
  const road = new THREE.Group();
  road.name = "邻居木房左侧道路";
  const { x, w } = c.road;
  const vertices: number[] = [],
    uv: number[] = [];
  for (let i = 1; i < roadStations.length; i++) {
    const [a, ya] = roadStations[i - 1],
      [b, yb] = roadStations[i];
    const quad = [
      [x, ya, a],
      [x + w, ya, a],
      [x + w, yb, b],
      [x, yb, b],
    ];
    for (const index of [0, 2, 1, 0, 3, 2]) {
      vertices.push(...quad[index]);
      uv.push(quad[index][0] / 8, quad[index][2] / 8);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const material = mat.paving.clone();
  material.side = THREE.DoubleSide;
  const strip = new THREE.Mesh(geometry, material);
  strip.name = "连续路面·无重复铺面";
  strip.receiveShadow = true;
  road.add(strip);
  // T形路口和坪下接入段均止于道路边线，不与主路面交叠。
  surface(
    road,
    "前方横向道路",
    rect(c.extent.left, -30, c.extent.right - c.extent.left, 3.5),
    c.frontHouse.y,
    mat.paving,
  );
  return road;
}
