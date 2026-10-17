import * as THREE from "three";
import { site, floors, frontFieldLevel, courtyardFront, type Point } from "./data";
import { contourAt, contourSection, insetContour } from "./contours";
import {
  box,
  cylinder,
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
import { buildL9, buildXingyuan } from "./cars";
import { buildRoadsideVilla } from "./roadside-villa";
import { roadsideFootprints, roadsideToWorld } from "./roadside-villa-layout";
import { surroundings, forestTrees, basementColumns, roadHeight, rightTerraceBreak } from "./surroundings";
import { buildContextGround, buildRoad } from "./site-ground";

function gableRoof(
  parent: THREE.Object3D,
  x: number,
  z: number,
  w: number,
  d: number,
  y: number,
  rise: number,
  mat: Mats,
  options?: { darkTiles?: boolean; gable?: THREE.Material; overhang?: number },
) {
  const g = new THREE.Group();
  g.name = "人字坡屋顶";
  parent.add(g);
  const overhang = options?.overhang ?? 0.35,
    x0 = x - overhang,
    x1 = x + w + overhang,
    z0 = z - overhang,
    z1 = z + d + overhang,
    zMid = z + d / 2,
    peak = y + rise;
  const blue = mat.roof.clone();
  // 不传 darkTiles 时用浅青灰坡；传了就沿用深色瓦。
  if (!options?.darkTiles) blue.color.set(0x708e9b);
  blue.side = THREE.DoubleSide;
  const slopes = new THREE.BufferGeometry();
  const north = [
    [x0, y, z0],
    [x1, y, z0],
    [x1, peak, zMid],
    [x0, y, z0],
    [x1, peak, zMid],
    [x0, peak, zMid],
  ];
  const south = [
    [x1, y, z1],
    [x0, y, z1],
    [x0, peak, zMid],
    [x1, y, z1],
    [x0, peak, zMid],
    [x1, peak, zMid],
  ];
  slopes.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([...north, ...south].flat(), 3),
  );
  slopes.computeVertexNormals();
  const roof = new THREE.Mesh(slopes, blue);
  roof.castShadow = roof.receiveShadow = true;
  g.add(roof);
  const verge = 0.14;
  for (const [end, facingEast] of [
    [x - verge, false],
    [x + w + verge, true],
  ] as const) {
    const triangle = new THREE.BufferGeometry();
    const peakPoint = [end, peak, zMid];
    const north = [end, y, z];
    const south = [end, y, z + d];
    triangle.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        (facingEast
          ? [...north, ...peakPoint, ...south]
          : [...north, ...south, ...peakPoint]
        ),
        3,
      ),
    );
    triangle.computeVertexNormals();
    const wall = new THREE.Mesh(triangle, options?.gable ?? mat.wall);
    wall.castShadow = wall.receiveShadow = true;
    g.add(wall);
  }
  box(g, x + w / 2, peak + 0.06, zMid, w + overhang * 2, 0.08, 0.16, mat.dark);
  return g;
}

// 开间从东端数起。面对房子（从北往南看）时，东端就是左边第一间。
export function neighborBayPlan(kind: "side" | "rear" | "own", width: number) {
  const hallScale = kind === "side" ? 1.45 : 1.22;
  const count = kind === "rear" ? 8 : 3;
  const hallFromEast = kind === "rear" ? 2 : 1;
  const ordinary = width / (count - 1 + hallScale);
  const widths = Array.from({ length: count }, (_, index) =>
    index === hallFromEast ? ordinary * hallScale : ordinary,
  );
  return { hallFromEast, widths };
}

function drawBayFront(
  parent: THREE.Object3D,
  x: number,
  z: number,
  w: number,
  y: number,
  height: number,
  mat: Mats,
  kind: "side" | "rear" | "own",
) {
  const { hallFromEast, widths } = neighborBayPlan(kind, w);
  const frontage = new THREE.Group();
  frontage.name = kind === "rear" ? "八开间" : kind === "own" ? "自家三开间" : "一明两暗";
  parent.add(frontage);
  const edges = [x + w];
  for (const bay of widths) edges.push(edges[edges.length - 1] - bay);
  for (let i = 0; i < edges.length; i++) {
    const px =
      i === 0 ? edges[i] - 0.09 : i === edges.length - 1 ? edges[i] + 0.09 : edges[i];
    box(frontage, px, y + height / 2, z - 0.1, 0.16, height, 0.16, mat.dark);
  }
  let east = x + w;
  for (let i = 0; i < widths.length; i++) {
    const bay = widths[i];
    const center = east - bay / 2;
    const hall = i === hallFromEast;
    const roomWindow = Math.min(1.25, bay * 0.36);
    const upperW = hall ? Math.min(1.7, bay * 0.42) : roomWindow * 0.82;
    // 邻居木房檐高约 5.2 米以上，上窗保持原位。自家旧木房更矮，上窗跟着檐口上收。
    const upperCenter = Math.min(4.05, height - 0.72);
    box(
      frontage,
      center,
      y + upperCenter,
      z - 0.06,
      upperW,
      0.9,
      0.03,
      mat.glass,
      false,
    );
    box(frontage, center, y + upperCenter, z - 0.085, 0.04, 0.94, 0.035, mat.wood);
    box(frontage, center, y + upperCenter, z - 0.085, upperW + 0.06, 0.04, 0.035, mat.wood);
    if (hall) {
      const doorW = Math.min(1.85, bay * 0.4);
      const door = new THREE.Group();
      door.name = "堂屋门";
      frontage.add(door);
      const leaf = doorW / 2 - 0.03;
      for (const side of [-1, 1]) {
        const lx = center + side * (leaf / 2 + 0.015);
        box(door, lx, y + 1.22, z - 0.07, leaf, 2.28, 0.05, mat.dark);
        box(door, lx, y + 1.88, z - 0.1, Math.max(0.28, leaf - 0.16), 0.62, 0.02, mat.glass, false);
        box(door, lx, y + 1.88, z - 0.112, 0.035, 0.68, 0.02, mat.wood);
        box(door, lx, y + 1.88, z - 0.112, Math.max(0.34, leaf - 0.08), 0.035, 0.02, mat.wood);
      }
      box(door, center, y + 1.22, z - 0.1, 0.04, 2.34, 0.035, mat.dark);
      box(door, center, y + 2.46, z - 0.09, doorW + 0.14, 0.08, 0.07, mat.dark);
      box(door, center, y + 2.7, z - 0.065, doorW, 0.32, 0.03, mat.glass, false);
      box(frontage, center, y + 2.92, z - 0.12, bay - 0.28, 0.1, 0.08, mat.wood);
      if (kind === "side")
        for (const side of [-1, 1]) {
          const sx = center + side * (doorW / 2 + 0.55);
          box(frontage, sx, y + 1.45, z - 0.06, 0.62, 1.15, 0.03, mat.glass, false);
          box(frontage, sx, y + 1.45, z - 0.085, 0.04, 1.2, 0.035, mat.wood);
          box(frontage, sx, y + 1.45, z - 0.085, 0.68, 0.04, 0.035, mat.wood);
        }
    } else {
      box(frontage, center, y + 1.4, z - 0.06, roomWindow, 1.15, 0.03, mat.glass, false);
      box(frontage, center, y + 1.4, z - 0.085, 0.04, 1.2, 0.035, mat.wood);
      box(frontage, center, y + 1.4, z - 0.085, roomWindow + 0.06, 0.04, 0.035, mat.wood);
    }
    east -= bay;
  }
}

function woodenHouse(
  parent: THREE.Object3D,
  x: number,
  z: number,
  w: number,
  d: number,
  y: number,
  mat: Mats,
  height = 5.4,
  gable = false,
  bays?: "side" | "rear" | "own",
) {
  const g = new THREE.Group();
  parent.add(g);
  box(g, x + w / 2, y + height / 2, z + d / 2, w, height, d, mat.wood);
  if (bays) drawBayFront(g, x, z, w, y, height, mat, bays);
  else
    for (let xx = x + 0.4; xx < x + w; xx += 1.5) {
      box(g, xx, y + 2.6, z - 0.09, 0.14, height, 0.15, mat.dark);
      box(g, xx + 0.5, y + 1.45, z - 0.11, 0.65, 0.95, 0.04, mat.glass, false);
      box(g, xx + 0.5, y + 1.45, z - 0.14, 0.045, 1, 0.05, mat.wood);
      box(g, xx + 0.5, y + 1.45, z - 0.14, 0.68, 0.045, 0.05, mat.wood);
    }
  box(g, x + w / 2, y + 3.1, z - 0.45, w, 0.16, 0.95, mat.wood);
  railing(g, [x + 0.1, z - 0.85], [x + w - 0.1, z - 0.85], y + 3.2, mat, 0.95);
  if (gable)
    // 正脊沿长向。出檐和起坡仍用原来四坡的 0.55 米、1.5 米，只把两端收成山墙。
    gableRoof(g, x, z, w, d, y + height, 1.5, mat, {
      darkTiles: true,
      gable: mat.wood,
      overhang: 0.55,
    });
  else hipRoof(g, x + w / 2, z + d / 2, w + 1.1, d + 1.1, y + height, 1.5, mat);
  return g;
}

export function buildExistingHouses(parent: THREE.Object3D, mat: Mats) {
  // 用户口述：自家木房比旁边邻居木房大约低 30 厘米。前墙与邻居木房对齐。面宽进深仍用原模型，不是新的测绘。
  const ownWoodFront = surroundings.sideHouse.z;
  const ownWood = woodenHouse(
    parent,
    8.8,
    ownWoodFront,
    12.3,
    7.9,
    0,
    mat,
    surroundings.sideHouse.h - 0.3,
    true,
    "own",
  );
  ownWood.name = "自家旧木房";
  ownWood.userData.frontZ = ownWoodFront;
  // 前墙比木屋大约多伸出 0.9 米。后墙比木房后墙更靠近后面的梯田，大约再多 1 米，这是口述，不是实测。
  const ownWoodRear = ownWoodFront + 7.9;
  const brickRearPastWood = 1;
  const brickFront = ownWoodFront - 0.9;
  const brickRear = ownWoodRear + brickRearPastWood;
  const brickDepth = brickRear - brickFront;
  const brick = new THREE.Group();
  brick.name = "自家旧砖房";
  brick.userData.frontZ = brickFront;
  parent.add(brick);
  box(brick, 4.4, 1.55, brickFront + brickDepth / 2, 8.8, 3.1, brickDepth, mat.wall).name =
    "旧砖房墙体";
  slab(brick, rect(0, brickFront, 8.8, brickDepth), 3.2, 0.17, mat.stone);
  flatRoofRails(
    brick,
    0.12,
    8.68,
    brickFront + 0.12,
    brickFront + brickDepth - 0.12,
    3.2,
    mat,
  );
  for (const x of [2.3, 6.3])
    box(brick, x, 1.55, brickFront - 0.03, 1.8, 1.7, 0.035, mat.glass, false);
  // 红线轮廓：木墙到房前水泥外沿 2 米；邻居前坪和砖房前坪再向外。进深超出 2 米的部分按红线估算。
  const woodYardFront = ownWoodFront - 2;
  const side = surroundings.sideHouse;
  const neighborRight = surroundings.neighborYard.x;
  const neighborYardFront = -7.8;
  const east = side.x + side.w;
  const passage = 0.8;
  const fieldY = site.originalField;
  const pads = new THREE.Group();
  pads.name = "现状屋前水泥坪";
  pads.userData.frontZ = woodYardFront;
  parent.add(pads);
  const crops = mat.grass.clone();
  crops.color.set(0x75864d);
  const farm = slab(
    parent,
    rect(site.width, surroundings.neighborYard.z, east - site.width, side.z - surroundings.neighborYard.z),
    fieldY,
    0.25,
    mat.grass,
  );
  farm.name = "邻居房前农田";
  for (let x = site.width + 0.8; x < east - 0.6; x += 1.25)
    for (let z = surroundings.neighborYard.z + 0.8; z < side.z - 1.2; z += 2.2)
      box(parent, x, fieldY + 0.04, z + 0.85, 0.13, 0.08, 1.7, crops, false);
  slab(
    pads,
    rect(8.8, woodYardFront, site.width - 8.8, ownWoodFront - woodYardFront),
    0,
    0.16,
    mat.paving,
  ).name = "自家旧木房前水泥坪";
  slab(
    pads,
    rect(site.width, woodYardFront, neighborRight - site.width, side.z - woodYardFront),
    0,
    0.16,
    mat.paving,
  );
  // 面对房子：左侧接到下面农田外沿，比右侧长。西端外沿拉直并封口，不留折角。
  // 最右侧栏杆超过西墙约 1 米，并沿这条路伸到与院坪同高的梯田。1 米是口述。
  const brickRight = -1;
  const brickLeft = 8.65;
  const westEdgeZ = contourAt(courtyardFront, 0);
  const outerEdge: Point[] = [
    [brickRight, westEdgeZ],
    [0, westEdgeZ],
    ...contourSection(courtyardFront, 0, brickLeft).slice(1),
  ];
  slab(
    pads,
    [[brickLeft, brickFront], [brickRight, brickFront], ...outerEdge],
    0,
    0.16,
    mat.paving,
  ).name = "自家旧砖房前水泥坪";
  const terraceZ = contourAt(rightTerraceBreak, brickRight);
  slab(
    pads,
    [
      [0, brickFront],
      [brickRight, brickFront],
      [brickRight, terraceZ],
      [0, contourAt(rightTerraceBreak, 0)],
    ],
    0,
    0.16,
    mat.paving,
  ).name = "砖房西侧上田的路";
  slab(
    pads,
    rect(neighborRight, neighborYardFront, east - neighborRight, side.z - neighborYardFront),
    0,
    0.16,
    mat.paving,
  ).name = "邻居木房前水泥坪";
  railing(pads, [8.7, woodYardFront + 0.08], [neighborRight, woodYardFront + 0.08], 0, mat);
  const brickPath = new THREE.Group();
  brickPath.name = "砖房前坪右侧栏杆";
  pads.add(brickPath);
  // 外沿封口拉直；右侧这一条继续伸到上田，不在外沿留缺口。
  railing(brickPath, [brickRight, westEdgeZ], [brickRight, terraceZ], 0, mat);
  railing(pads, [brickLeft, woodYardFront], outerEdge.at(-1)!, 0, mat);
  let railFrom = outerEdge[0];
  for (let i = 1; i < outerEdge.length; i++) {
    if (i < outerEdge.length - 1 && i > 1 && outerEdge[i][0] - railFrom[0] < 1.6) continue;
    railing(pads, railFrom, outerEdge[i], 0, mat);
    railFrom = outerEdge[i];
  }
  railing(
    pads,
    [neighborRight + 0.08, neighborYardFront + 0.08],
    [east - 0.15, neighborYardFront + 0.08],
    0,
    mat,
  );
  const neighborLeftRail = new THREE.Group();
  neighborLeftRail.name = "邻居前坪左侧栏杆";
  pads.add(neighborLeftRail);
  // 最左侧院坪靠木房一侧留 2 米缺口，出路不封死。2 米是口述。
  railing(
    neighborLeftRail,
    [east - 0.12, neighborYardFront + 0.08],
    [east - 0.12, side.z - 2],
    0,
    mat,
  );
  const sideRail = new THREE.Group();
  sideRail.name = "邻居前坪右侧栏杆";
  pads.add(sideRail);
  railing(sideRail, [neighborRight, neighborYardFront + 0.08], [neighborRight, side.z - passage], 0, mat);
  const skirt: Point[] = [
    [brickRight, terraceZ],
    [brickRight, brickFront],
    ...outerEdge,
    [brickLeft, woodYardFront],
    [neighborRight, woodYardFront],
    [neighborRight, neighborYardFront],
    [east, neighborYardFront],
    [east, side.z],
  ];
  const skirtVerts: number[] = [];
  for (let i = 1; i < skirt.length; i++) {
    const a = skirt[i - 1],
      b = skirt[i];
    const quad = [
      [a[0], fieldY, a[1]],
      [b[0], fieldY, b[1]],
      [b[0], 0, b[1]],
      [a[0], 0, a[1]],
    ];
    for (const index of [0, 1, 2, 0, 2, 3]) skirtVerts.push(...quad[index]);
  }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute("position", new THREE.Float32BufferAttribute(skirtVerts, 3));
  skirtGeo.computeVertexNormals();
  const skirtMat = mat.soil.clone();
  skirtMat.side = THREE.DoubleSide;
  const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
  skirtMesh.name = "现状前坪挡墙";
  pads.add(skirtMesh);
  return { ownWood, brick };
}

// 旧砖房平顶栏杆。面对房子时只做前、后、右三边，靠木房的东侧不加。
function flatRoofRails(
  parent: THREE.Object3D,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  mat: Mats,
) {
  const g = new THREE.Group();
  g.name = "旧砖房屋顶栏杆";
  parent.add(g);
  const base = y + 0.02;
  const edges: [number, number, number, number][] = [
    [x0, z0, x1, z0],
    [x0, z1, x1, z1],
    [x0, z0, x0, z1],
  ];
  for (const [x, z] of [
    [x0, z0],
    [x1, z0],
    [x0, z1],
    [x1, z1],
  ])
    box(g, x, base + 0.46, z, 0.08, 0.92, 0.08, mat.trim);
  for (const [ax, az, bx, bz] of edges) {
    const len = Math.hypot(bx - ax, bz - az);
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    box(g, mx, base + 0.1, mz, alongX ? len - 0.1 : 0.1, 0.2, alongX ? 0.1 : len - 0.1, mat.wall);
    box(g, mx, base + 0.88, mz, alongX ? len - 0.12 : 0.045, 0.04, alongX ? 0.045 : len - 0.12, mat.metal);
    const count = Math.max(2, Math.round(len / 0.16));
    for (let i = 1; i < count; i++) {
      const t = i / count;
      box(
        g,
        ax + (bx - ax) * t,
        base + 0.5,
        az + (bz - az) * t,
        alongX ? 0.018 : 0.04,
        0.68,
        alongX ? 0.04 : 0.018,
        mat.metal,
        false,
      );
    }
  }
  return g;
}

export function buildSurroundingHouses(mat: Mats) {
  const group = new THREE.Group();
  group.name = "周边邻房";
  group.add(buildRoadsideVilla(mat));
  let rearHouse: THREE.Object3D | undefined;
  for (const [name, h] of [
    ["左侧邻居木房", surroundings.sideHouse],
    ["后方第二层梯田木房", surroundings.rearHouse],
  ] as const) {
    const house = woodenHouse(
      group,
      h.x,
      h.z,
      h.w,
      h.d,
      h.y,
      mat,
      h.h,
      true,
      name === "左侧邻居木房" ? "side" : "rear",
    );
    house.name = name;
    if (name === "后方第二层梯田木房") rearHouse = house;
  }
  const rear = surroundings.rearHouse;
  // 门前台阶跟着整栋一起关，下面露出的仍是第二层田的草地。
  slab(
    rearHouse!,
    rect(rear.x, rear.z - 1.5, rear.w, 1.5),
    rear.y + 0.025,
    0.15,
    mat.paving,
  );
  for (let i = 0; i < 6; i++) {
    box(
      rearHouse!,
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
  const back = h.z + h.d;
  const wingW = h.w * h.wingRatio;
  const mainW = h.w - wingW;
  const wingX = h.x + mainW;
  const windowH = 1.85;
  const sill = 0.95;
  const bayPlan = neighborBayPlan("own", mainW);
  const { widths } = bayPlan;
  let bayEast = mainW;
  const bayCenters = widths.map((bay) => {
    const center = bayEast - bay / 2;
    bayEast -= bay;
    return center;
  });
  const bayOpenings = (floor: number) =>
    widths.map((bay, index) => {
      const hall = index === bayPlan.hallFromEast;
      const wide = Math.min(2.05, bay * 0.46);
      const narrow = Math.min(1.55, bay * 0.38);
      if (hall && floor === 0)
        return { at: bayCenters[index], w: wide, sill: 0, h: 2.75, door: true };
      if (hall)
        return { at: bayCenters[index], w: wide * 0.92, sill: 0.4, h: 2.05 };
      return {
        at: bayCenters[index],
        w: narrow,
        sill: floor === 0 ? sill : 0.85,
        h: floor === 0 ? windowH : 1.7,
      };
    });
  // 右侧主体进深两间，二楼两间都在，只向北内退一条走廊。1.4 米沿用自家过道外轮廓，不是测绘。
  // 内退的这一条是钢架加工层。开间仍是卧室、堂屋、卧室。
  const corridorSetback = 1.4;
  const upperFront = h.z + corridorSetback;
  for (let i = 0; i < h.floors; i++) {
    const y = h.y + i * h.floorHeight;
    const zWall = i === 0 ? h.z : upperFront;
    const depth = back - zWall;
    const openings = bayOpenings(i);
    const north = wallWithOpenings(
      house,
      [h.x, zWall],
      [wingX, zWall],
      y,
      h.floorHeight,
      openings,
      mat,
    );
    if (i === 0) north.name = "前方砖房三开间";
    wallWithOpenings(
      house,
      [h.x, back],
      [wingX, back],
      y,
      h.floorHeight,
      openings.map((opening) => ({ ...opening, door: false, sill: 0.9, h: 1.55 })),
      mat,
    );
    wallWithOpenings(
      house,
      [h.x, zWall],
      [h.x, back],
      y,
      h.floorHeight,
      [
        { at: depth * 0.25, w: 1.4, sill: 0.9, h: 1.6 },
        { at: depth * 0.75, w: 1.4, sill: 0.9, h: 1.6 },
      ],
      mat,
    );
    wallWithOpenings(
      house,
      [wingX, zWall],
      [wingX, back],
      y,
      h.floorHeight,
      i === 1
        ? [
            { at: depth * 0.25, w: 1.25, sill: 0.9, h: 1.55 },
            { at: depth * 0.75, w: 1.25, sill: 0.9, h: 1.55 },
          ]
        : [],
      mat,
    );
    slab(house, rect(h.x, h.z, mainW, h.d), y + 0.03, 0.15, mat.paving);
    box(
      house,
      h.x + mainW / 2,
      y + h.floorHeight - 0.08,
      zWall - 0.18,
      mainW + 0.16,
      0.16,
      0.22,
      mat.trim,
    );
  }
  const fromWest = [widths[2], widths[1], widths[0]];
  let joint = h.x;
  for (const bay of [0, ...fromWest]) {
    joint += bay;
    box(house, joint, h.y + h.floorHeight / 2, h.z - 0.14, 0.22, h.floorHeight, 0.16, mat.trim);
    box(
      house,
      joint,
      h.y + h.floorHeight * 1.5,
      upperFront - 0.14,
      0.22,
      h.floorHeight,
      0.16,
      mat.trim,
    );
  }
  const hallMark = new THREE.Group();
  hallMark.name = "堂屋门";
  hallMark.position.set(h.x + bayCenters[1], h.y + 1.35, h.z);
  house.add(hallMark);
  const workshop = new THREE.Group();
  workshop.name = "二楼前钢架加工层";
  house.add(workshop);
  const frameMat = mat.metal.clone();
  frameMat.color.set(0x8d9499);
  const eaveY = h.y + height;
  const deck = h.y + h.floorHeight;
  const ridgeZ = h.z + h.d / 2;
  const roofAt = (z: number) => {
    const t = (z - (h.z - 0.45)) / (ridgeZ - (h.z - 0.45));
    return eaveY + Math.min(1, Math.max(0, t)) * h.roofRise;
  };
  const frameXs = [h.x + 0.45, h.x + mainW / 2, wingX - 0.45];
  const postZ = h.z + 0.35;
  const beamZ = upperFront - 0.2;
  for (const x of frameXs) {
    cylinder(
      workshop,
      new THREE.Vector3(x, deck + 0.08, postZ),
      new THREE.Vector3(x, roofAt(postZ) - 0.16, postZ),
      0.07,
      frameMat,
    );
    cylinder(
      workshop,
      new THREE.Vector3(x, roofAt(postZ) - 0.2, postZ),
      new THREE.Vector3(x, roofAt(beamZ) - 0.16, beamZ),
      0.05,
      frameMat,
    );
  }
  cylinder(
    workshop,
    new THREE.Vector3(frameXs[0], roofAt(postZ) - 0.18, postZ),
    new THREE.Vector3(frameXs[2], roofAt(postZ) - 0.18, postZ),
    0.05,
    frameMat,
  );
  gableRoof(house, h.x, h.z, mainW, h.d, h.y + height, h.roofRise, mat, {
    darkTiles: true,
    overhang: 0.45,
  });
  // 左侧一层与主楼一层同高，北面不砌墙，东墙离开马路约 0.8 米。
  // 红顶钢架跟着主体屋脊降：西侧高点仍低于屋脊约 1.8 米，朝东降低；东檐比一层东墙再挑出一点。
  const roadGap = 0.8;
  const eavePastWall = 0.4;
  const wingEast = h.x + h.w - roadGap;
  const wingSpan = wingEast - wingX;
  const wingWall = h.floorHeight;
  const deckY = h.y + wingWall;
  const yWest = h.y + height + h.roofRise - 1.8;
  const yEast = yWest - 1.15;
  wallWithOpenings(
    house,
    [wingX + 0.12, back],
    [wingEast, back],
    h.y,
    wingWall,
    [{ at: wingSpan * 0.5, w: 1.25, sill: 0.9, h: 1.35 }],
    mat,
  );
  wallWithOpenings(
    house,
    [wingEast, h.z],
    [wingEast, back],
    h.y,
    wingWall,
    [{ at: h.d / 2, w: 1.15, sill: 0.85, h: 1.3 }],
    mat,
  );
  box(house, (wingX + wingEast) / 2, deckY - 0.12, h.z, wingSpan, 0.22, 0.28, mat.trim);
  // 楼板收到墙内皮以内，顶面略低于墙顶，避免和墙顶共面，拖动时闪。
  slab(
    house,
    rect(wingX + 0.28, h.z + 0.04, wingSpan - 0.52, h.d - 0.28),
    deckY - 0.03,
    0.14,
    mat.stone,
  ).name = "一楼楼顶";
  const shed = new THREE.Group();
  shed.name = "左侧斜坡屋顶";
  shed.userData.westY = yWest;
  shed.userData.eastY = yEast;
  shed.userData.deckY = deckY;
  house.add(shed);
  const steel = new THREE.Group();
  steel.name = "红色屋顶钢架";
  shed.add(steel);
  const steelMat = mat.metal.clone();
  steelMat.color.set(0x8a9298);
  const x0 = wingX;
  const x1 = wingEast + eavePastWall;
  const z0 = h.z - 0.2;
  const z1 = back + 0.2;
  const roofY = (x: number) => yWest + ((yEast - yWest) * (x - x0)) / (x1 - x0);
  const postXs = [wingX + wingSpan * 0.08, (wingX + wingEast) / 2, wingEast - 0.35];
  const postZs = [h.z + 0.35, back - 0.35];
  for (const x of postXs)
    for (const z of postZs)
      cylinder(
        steel,
        new THREE.Vector3(x, deckY, z),
        new THREE.Vector3(x, roofY(x) - 0.28, z),
        0.055,
        steelMat,
      );
  for (const x of postXs)
    cylinder(
      steel,
      new THREE.Vector3(x, roofY(x) - 0.3, z0 + 0.15),
      new THREE.Vector3(x, roofY(x) - 0.3, z1 - 0.15),
      0.04,
      steelMat,
    );
  for (const z of postZs)
    cylinder(
      steel,
      new THREE.Vector3(postXs[0], roofY(postXs[0]) - 0.32, z),
      new THREE.Vector3(postXs[2], roofY(postXs[2]) - 0.32, z),
      0.04,
      steelMat,
    );
  const slopes = new THREE.BufferGeometry();
  const lip = 0.22;
  const yw0 = yWest - lip;
  const ye0 = yEast - lip;
  slopes.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        x0, yWest, z0, x1, yEast, z0, x1, yEast, z1,
        x0, yWest, z0, x1, yEast, z1, x0, yWest, z1,
        x0, yw0, z1, x1, ye0, z1, x1, ye0, z0,
        x0, yw0, z1, x1, ye0, z0, x0, yw0, z0,
        x0, yWest, z0, x0, yWest, z1, x0, yw0, z1,
        x0, yWest, z0, x0, yw0, z1, x0, yw0, z0,
        x1, yEast, z1, x1, yEast, z0, x1, ye0, z0,
        x1, yEast, z1, x1, ye0, z0, x1, ye0, z1,
        x0, yWest, z0, x1, ye0, z0, x1, yEast, z0,
        x0, yWest, z0, x0, yw0, z0, x1, ye0, z0,
        x0, yWest, z1, x1, yEast, z1, x1, ye0, z1,
        x0, yWest, z1, x1, ye0, z1, x0, yw0, z1,
      ],
      3,
    ),
  );
  slopes.computeVertexNormals();
  const red = mat.roof.clone();
  red.color.set(0xb8433c);
  red.polygonOffset = true;
  red.polygonOffsetFactor = 1;
  red.polygonOffsetUnits = 1;
  const roof = new THREE.Mesh(slopes, red);
  roof.castShadow = roof.receiveShadow = true;
  shed.add(roof);
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
    alphaToCoverage: true,
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

function courtyardRailing(parent: THREE.Group, mat: Mats) {
  const path = contourSection(insetContour(courtyardFront, 0.1), 0.13, site.width - 0.13);
  const strip = (halfWidth: number): Point[] => [
    ...insetContour(path, -halfWidth),
    ...insetContour(path, halfWidth).reverse(),
  ];
  slab(parent, strip(0.09), 0.12, 0.12, mat.trim);
  slab(parent, strip(0.05), 1.13, 0.065, mat.metal);
  const lengths = [0];
  for (let i = 1; i < path.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = lengths.at(-1)!;
  const at = (distance: number): Point => {
    const index = lengths.findIndex((length, i) => i > 0 && length >= distance);
    if (index < 0) return path.at(-1)!;
    const t = (distance - lengths[index - 1]) / (lengths[index] - lengths[index - 1]);
    const a = path[index - 1], b = path[index];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  // 柱子按弧长间隔布置，不能每个曲线采样点都立一根粗柱。
  const balusters = Math.ceil(total / 0.23), posts = Math.ceil(total / 2.6);
  for (let i = 0; i <= balusters; i++) {
    const [x, z] = at(total * i / balusters);
    box(parent, x, 0.55, z, 0.025, 1.1, 0.025, mat.metal, false);
  }
  for (let i = 0; i <= posts; i++) {
    const [x, z] = at(total * i / posts);
    box(parent, x, 0.55, z, 0.16, 1.1, 0.16, mat.trim);
    box(parent, x, 1.125, z, 0.24, 0.09, 0.24, mat.stone);
  }
}

export function buildCourtyard(mat: Mats) {
  const deck = new THREE.Group();
  deck.name = "完整院坪与右侧人行通道";
  slab(deck, site.field, 0, 0.23, mat.paving).name = "无中央楼梯洞的院坪";
  courtyardRailing(deck, mat);
  // 辅楼前约2米和西侧过道都走在这块院坪上，不再另铺一层近白色的条子。
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
  const neighbors = buildSurroundingHouses(mat);
  context.add(neighbors);
  const sideNeighbor = neighbors.getObjectByName("左侧邻居木房")!;
  const rearNeighbor = neighbors.getObjectByName("后方第二层梯田木房")!;
  const frontNeighbor = neighbors.getObjectByName("前方两层砖房")!;
  const roadsideNeighbor = neighbors.getObjectByName("主马路边蓝顶三层邻房")!;
  // 院坪、地库和基座共用外沿；相邻未挖田面在 X=0 接续这条曲线。
  const foundationTop = site.garageFloor - 0.15;
  slab(fixed, site.boundary, foundationTop, foundationTop - frontFieldLevel, mat.soil);
  // 铺装是看见的地面。石基顶面留在铺装底面以下，避免鸟瞰时两层共面闪成格子。
  const padTop = 0.01;
  const padThick = 0.07;
  const stoneTop = padTop - padThick - 0.06;
  slab(fixed, rect(0, 0, site.width, 10.8), stoneTop, stoneTop - foundationTop, mat.stone);
  slab(fixed, rect(0, 0, site.width, 10.8), padTop, padThick, mat.paving);
  box(fixed, site.width / 2, 1.25, 10.96, site.width, 2.5, 0.32, mat.stone);
  box(fixed, site.width / 2, 0.025, 10.52, site.width - 0.2, 0.035, 0.16, mat.dark);
  vegetation(context, mat);
  context.add(road);
  slab(fixed, rect(site.width, -8.6, 5, 2.5), -3.15, 0.15, mat.soil);

  const yard = surroundings.neighborYard;
  neighborDeck.name = "新建邻居前坪";
  // 木屋前整段与自家院坪、邻居左侧院坪同一标高接通，不再留一块挖低的空地。现状另画旧水泥坪。
  slab(
    neighborDeck,
    rect(site.width, yard.z, surroundings.road.x - site.width, yard.d),
    0,
    0.23,
    mat.paving,
  ).name = "与两侧院坪接通的邻居前坪";
  const neighborLeft = new THREE.Group();
  neighborLeft.name = "新建邻居前坪左侧栏杆";
  neighborDeck.add(neighborLeft);
  // 最左侧靠木房留 2 米缺口，出路不封死。2 米是口述。
  railing(
    neighborLeft,
    [surroundings.road.x - 0.06, yard.z + 0.1],
    [surroundings.road.x - 0.06, surroundings.sideHouse.z - 2],
    0,
    mat,
  );
  railing(
    neighborDeck,
    [site.width, yard.z + 0.1],
    [surroundings.road.x - 0.06, yard.z + 0.1],
    0,
    mat,
  );
  context.add(neighborDeck, cutPiece, cutOutline);

  // 正前方电杆及架空线按拆除计划移除。
  // 现状下保留自家两栋旧房和低田。
  slab(existing, site.field, site.originalField, 0.3, mat.grass);
  buildExistingHouses(existing, mat);
  // 新地库顶板与楼下空间。木屋前的地下室也按自家地库铺装。
  slab(garage, site.field, site.garageFloor, 0.15, mat.paving);
  const woodFront = surroundings.sideHouse.z;
  slab(
    garage,
    rect(site.width, yard.z, surroundings.road.x - site.width, woodFront - yard.z),
    site.garageFloor,
    0.15,
    mat.paving,
  ).name = "木屋前自家地下室地面";
  const columns = basementColumns();
  const soffit = -0.23;
  const columnHeight = soffit - site.garageFloor;
  const columnY = (soffit + site.garageFloor) / 2;
  for (const column of columns.columns) {
    for (const [x, z] of [column.outer, column.inner])
      box(garage, x, columnY, z, 0.36, columnHeight, 0.36, mat.stone);
  }
  // 梁底 -.45、地面 -2.95，示意最低净高2.50；不代表结构梁高可成立。
  // 外墙只做到约 1 米，上面敞开，便于从外侧看到地库。样式一直延续到木屋前。
  const ourOuter = contourSection(insetContour(courtyardFront, 0.035), 0.12, site.width);
  const routeWall: Point[] = [
    ...ourOuter,
    [surroundings.road.x - 0.35, yard.z + 0.035],
  ];
  slab(
    garage,
    [...routeWall, ...insetContour(routeWall, 0.2).reverse()],
    site.garageFloor + 1.04,
    1.04,
    mat.stone,
  ).name = "沿同一外沿的地库矮墙";
  // 局部下挖止于自家边界，旁田的原标高不随车库降低。
  slab(
    garage,
    rect(0, courtyardFront[0][1], 0.12, -courtyardFront[0][1]),
    site.adjacentUnexcavatedLevel,
    site.adjacentUnexcavatedLevel - site.garageFloor,
    mat.stone,
  ).name = "地库局部下挖与未挖旁田的交界";
  const parked = buildL9(mat);
  parked.position.set(18.5, site.garageFloor, -4.02);
  garage.add(parked);
  const second = buildXingyuan(mat);
  second.position.set(14.65, site.garageFloor, -3.75);
  garage.add(second);
  for (const [x, z, name] of [
    [18.5, -4.02, "理想 L9 Max · 黑"],
    [14.65, -3.75, "吉利星愿 · 银"],
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
    forceSinglePass: true,
  });
  slab(overlap, rect(6.8, -1, 13.5, 1), 0.035, 0.025, overlapMat);
  slab(overlap, rect(site.portico.x, site.main.z - site.portico.projection, site.portico.w, site.portico.projection), 0.035, 0.025, overlapMat);
  tag(overlap, "主楼前伸 1.0 m · 与地库重叠", 13.55, 1.4, -0.4, "#ffe566", 0.78, true);
  overlap.visible = false;
  const columnNotes = new THREE.Group();
  columnNotes.name = "地库柱位";
  const noteY = -1.15;
  const markSpan = (index: number) => {
    const column = columns.columns[index];
    line(
      columnNotes,
      [
        new THREE.Vector3(column.x, site.garageFloor + 0.04, column.outer[1]),
        new THREE.Vector3(column.x, site.garageFloor + 0.04, column.inner[1]),
      ],
      0xa77332,
      true,
    );
    tag(
      columnNotes,
      `净跨 ${column.span.toFixed(1)} m`,
      column.x,
      noteY,
      (column.outer[1] + column.inner[1]) / 2,
      "#ffe566",
      0.62,
      true,
    );
  };
  markSpan(0);
  markSpan(columns.columns.findIndex((column) => column.x > 10 && column.x <= site.width));
  markSpan(columns.columns.findIndex((column) => column.x > site.width));
  const bay = columns.columns[1];
  line(
    columnNotes,
    [
      new THREE.Vector3(columns.columns[0].x, site.garageFloor + 0.04, columns.columns[0].outer[1]),
      new THREE.Vector3(bay.x, site.garageFloor + 0.04, bay.outer[1]),
    ],
    0x466a59,
    true,
  );
  tag(
    columnNotes,
    `柱距 ${columns.spacing.toFixed(1)} m`,
    (columns.columns[0].x + bay.x) / 2,
    noteY,
    (columns.columns[0].outer[1] + bay.outer[1]) / 2 - 0.8,
    "#ffe566",
    0.62,
    true,
  );
  tag(columnNotes, "外沿柱", 9.1, noteY, -6.2, "#ffe566", 0.66, true);
  tag(columnNotes, "房前墙下柱", 13.3, noteY, -1.7, "#ffe566", 0.66, true);
  tag(columnNotes, "中间不立柱 · 梁高待核算", 16, -0.4, -4.2, "#ffe566", 0.68, true);
  columnNotes.visible = false;
  proposed.add(deck, garage, overlap, columnNotes);
  const scheme = new THREE.Group();
  scheme.name = "新建尺寸";
  const current = new THREE.Group();
  current.name = "现状尺寸";
  dimensions.add(scheme, current);
  const p = (x: number, z: number, y = 0.15) => new THREE.Vector3(x, y, z);
  const dim = (
    parent: THREE.Object3D,
    text: string,
    x: number,
    y: number,
    z: number,
    scale = 0.72,
  ) => tag(parent, text, x, y, z, "#ffe566", scale, true);
  const span = (parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) =>
    line(parent, [a, b], 0xffc43d, true);
  const main = site.main;
  const annex = site.annex;
  const eave = floors.reduce((sum, floor) => sum + floor.height, 0);
  const side = surroundings.sideHouse;
  const rear = surroundings.rearHouse;
  const front = surroundings.frontHouse;
  const roadside = surroundings.roadsideVilla;
  const roadsideDimensions = new THREE.Group();
  roadsideDimensions.name = "蓝顶邻房位置与朝向估算";
  dimensions.add(roadsideDimensions);
  const eastPoint = roadsideFootprints(roadside).flat().reduce((a, b) => a[0] > b[0] ? a : b);
  span(roadsideDimensions, p(annex.x, annex.z, 0.4), p(annex.x, eastPoint[1], 0.4));
  span(roadsideDimensions, p(annex.x, eastPoint[1], 0.4), p(eastPoint[0], eastPoint[1], 0.4));
  dim(roadsideDimensions, `辅楼西墙延长线 · 横向约 ${roadside.extensionGap} m`, (annex.x + eastPoint[0]) / 2, 1.8, eastPoint[1] - 0.7, 0.7);
  const eaveHeight = roadside.floorHeights.reduce((sum, height) => sum + height, 0);
  dim(roadsideDimensions, `蓝顶邻房 ${roadside.w}×${roadside.d} m · 三层 · 估算`, roadside.x, roadside.y + eaveHeight + roadside.roofRise + 1.5, roadside.z, 0.75);
  const facing = roadsideToWorld(roadside, 0, -roadside.d / 2 - roadside.portico.d - 1);
  dim(roadsideDimensions, `朝西北 · 北偏西约 ${roadside.angle}° · 估算`, facing[0], roadside.y + 1.6, facing[1] - 0.7, 0.72);
  span(dimensions, p(0, 11.2, 2.4), p(site.width, 11.2, 2.4));
  dim(dimensions, `东西总宽 ${site.width} m`, site.width / 2, 3.8, 12.6, 0.86);
  span(dimensions, p(0, 0, 1.4), p(0, site.oldDepth, 1.4));
  dim(dimensions, `旧台地进深 ${site.oldDepth} m`, 2.4, 3.3, 11.6, 0.74);
  span(dimensions, p(0.35, 0, 1.2), p(0.35, courtyardFront[0][1], 1.2));
  dim(dimensions, "西端外沿 3.1 m", 2.6, 2, -1.6, 0.7);
  dim(dimensions, `旁田 ${site.adjacentUnexcavatedLevel.toFixed(1)} m · 示意待测`, -7, site.adjacentUnexcavatedLevel + 1.1, 1, 0.74);
  dim(dimensions, `前田低于地库约 ${site.frontFieldDrop} m`, 5, frontFieldLevel + 1.1, -13, 0.74);
  dim(dimensions, `砖房台地再低约 ${site.frontHouseDrop} m`, 18, front.y + 1.3, -19, 0.74);
  dim(dimensions, `屋后田 +${site.rearField} m`, 7, site.rearField + 1.4, 13.6, 0.74);
  dim(dimensions, `后二层田 +${surroundings.rearSecond.y} m · 估算`, 8, surroundings.rearSecond.y + 1.3, 22, 0.7);
  dim(dimensions, `后三层田 +${surroundings.rearThird.y} m · 估算`, 8, surroundings.rearThird.y + 1.3, 32.2, 0.7);
  dim(dimensions, `东侧大平地与屋后田同高 +${surroundings.leftPlatform.y} m`, 46, surroundings.leftPlatform.y + 1.4, 0, 0.7);
  span(dimensions, p(surroundings.road.x, -14, 1.3), p(surroundings.road.x + surroundings.road.w, -14, 1.3));
  dim(dimensions, `道路宽 ${surroundings.road.w} m · 待测`, 35.5, 2.4, -15.4, 0.7);
  dim(dimensions, `邻居木房 ${side.w}×${side.d} m · 前墙对齐 · 估算`, side.x + side.w / 2, side.h + 1.6, side.z + side.d / 2, 0.72);
  dim(dimensions, `屋后木房 ${rear.w.toFixed(1)}×${rear.d} m · 台地 +${rear.y} m · 估算`, rear.x + rear.w / 2, rear.y + rear.h + 1.4, rear.z + rear.d / 2, 0.7);
  dim(dimensions, `前方砖房 ${front.w.toFixed(1)}×${front.d} m · 侧面两间 · 二楼内退走廊 1.4 m`, front.x + front.w / 2, front.y + front.floorHeight * front.floors + 1.6, front.z - 1.6, 0.7);
  dim(dimensions, "屋脊高于一层顶约 2 m", front.x + front.w * 0.72, front.y + front.floorHeight * front.floors + 3.2, front.z + front.d / 2, 0.66);
  dim(dimensions, "矮楼与主楼一层齐平 · 红顶低于屋脊约 1.8 m", front.x + front.w - 1.2, front.y + 4.2, front.z + 2.2, 0.64);
  dim(dimensions, "屋后田宽约 0.4 m", front.x + 4, front.y + 1.5, front.z + front.d + 0.9, 0.66);
  dim(dimensions, "靠木房出口 2 m", surroundings.road.x - 0.8, 1.8, side.z - 1, 0.66);
  span(scheme, p(main.x, -4.3, 0.4), p(main.x + main.w, -4.3, 0.4));
  dim(scheme, `主楼 ${main.w}×${main.d} m`, 13.55, eave + 3.6, 1.5, 0.82);
  dim(scheme, `层高 ${floors.map((floor) => floor.height).join(" / ")} m`, 4.2, 5.8, 9.6, 0.74);
  span(scheme, p(main.x + main.w - 0.2, main.z + main.d, 0.3), p(main.x + main.w - 0.2, main.z + main.d, eave));
  dim(scheme, `檐口 ${eave.toFixed(1)} m`, 18.8, eave + 2.6, 10.6, 0.7);
  span(scheme, p(annex.x, -3.5, 0.4), p(annex.x + annex.w, -3.5, 0.4));
  dim(scheme, `辅楼 ${annex.w}×${annex.d} m · 高 ${annex.height} m`, 3.05, annex.height + 1.6, 4, 0.72);
  span(scheme, p(main.x + main.w, 6, 0.4), p(site.width, 6, 0.4));
  dim(scheme, `东侧 ${site.sideGap} m`, 20.7, 2.2, 7.2, 0.64);
  span(scheme, p(0, 3, 0.4), p(annex.x, 3, 0.4));
  dim(scheme, `西侧 ${site.sideGap} m`, 0.4, 2.2, 1.4, 0.64);
  span(scheme, p(annex.x + annex.w, 5, 0.4), p(main.x, 5, 0.4));
  dim(scheme, `子孙道 ${site.lane} m`, 6.05, 2.5, 6.2, 0.68);
  span(scheme, p(10, main.z, 8.4), p(10, main.z + site.setback, 8.4));
  dim(scheme, `三楼北退 ${site.setback} m`, 8.6, 7.6, -2.6, 0.68);
  dim(scheme, `屋后留 ${site.rearGap} m`, 17.4, 3.6, 9.2, 0.68);
  dim(scheme, `门厅 ${site.portico.w}×${site.portico.projection} m · 另计`, 13.7, 3.4, -5.4, 0.72);
  dim(scheme, `栏杆下瓦檐约 ${site.secondFrontEave} m · 三楼顶檐 ${site.thirdEave} m`, 17.6, 4.2, -4.6, 0.68);
  dim(scheme, "前通道约 2 m", 2.8, 1.6, -2.5, 0.66);
  dim(scheme, `侧道 ${site.sideGap} m`, 0.45, 1.8, 6.4, 0.64);
  dim(scheme, `地库 ${site.garageFloor} m · 净高目标 ${site.garageClear} m`, 16.2, 2, -7.6, 0.7);
  dim(scheme, `右侧上田整体再向前 ${surroundings.rightTerraceAdvance} m`, -4.2, 1.5, 2.2, 0.68);
  span(scheme, p(main.x, main.z, 0.35), p(main.x, main.z + main.d, 0.35));
  dim(scheme, `进深 ${main.d} m`, 4.6, 4.2, -1.2, 0.68);
  for (const x of [main.x + main.w, 13.55, main.x]) {
    const z = contourAt(courtyardFront, x);
    const depth = main.z - z;
    span(scheme, p(x, main.z, 0.2), p(x, z, 0.2));
    dim(scheme, `距前墙 ${depth.toFixed(1)} m`, x, 1.5, (main.z + z) / 2, 0.64);
  }
  // 与 buildExistingHouses 同一组现状尺寸：面宽进深沿用原模型，0.9 米和 2 米是口述。
  const ownWoodH = side.h - 0.3;
  dim(current, `旧木房 12.3×7.9 m · 檐墙约 ${ownWoodH.toFixed(1)} m`, 15, ownWoodH + 1.5, 5, 0.72);
  dim(current, "旧砖房 8.8×9.8 m · 墙高约 3.1 m", 4.4, 4.6, 5.1, 0.72);
  dim(current, "前墙多伸出 0.9 m", 4.4, 2, 0.55, 0.66);
  dim(current, "后墙比木房更靠近后田约 1 m", 4.4, 2.2, 9.6, 0.66);
  dim(current, "木墙到外沿 2 m", 15, 1.8, 0.15, 0.66);
  dim(current, "西侧栏杆过墙约 1 m", -0.2, 1.8, -1.4, 0.66);
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
    dimensionsScheme: scheme,
    dimensionsCurrent: current,
    overlap,
    parked,
    road,
    second,
    neighborDeck,
    columnNotes,
    sideNeighbor,
    rearNeighbor,
    frontNeighbor,
    roadsideNeighbor,
    roadsideDimensions,
  };
}

export function makeRamp(
  parent: THREE.Group,
  mat: Mats,
  roadY: number,
  length: number,
) {
  const startX = site.width + length,
    endX = site.width;
  const g = new THREE.Group();
  parent.add(g);
  const z0 = -8.6, z1 = -6.1, strips = 5;
  const surface = (z: number) =>
    roadHeight(z) + roadY - surroundings.road.entryY;
  const material = mat.paving.clone();
  material.side = THREE.DoubleSide;
  const positions: number[] = [];
  const push = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
  ) => {
    positions.push(ax, ay, az, cx, cy, cz, bx, by, bz, ax, ay, az, dx, dy, dz, cx, cy, cz);
  };
  for (let i = 0; i < strips; i++) {
    const a = z0 + ((z1 - z0) * i) / strips;
    const b = z0 + ((z1 - z0) * (i + 1)) / strips;
    const ya = surface(a), yb = surface(b);
    // 接入段跟着马路纵坡走，不再做成一块平台阶。
    push(startX, ya, a, surroundings.road.x, ya, a, surroundings.road.x, yb, b, startX, yb, b);
    push(endX, site.garageFloor, a, startX, ya, a, startX, yb, b, endX, site.garageFloor, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const ramp = new THREE.Mesh(geo, material);
  ramp.receiveShadow = true;
  g.add(ramp);
  const mid = (z0 + z1) / 2;
  line(
    g,
    [
      new THREE.Vector3(surroundings.road.x, surface(mid) + 0.03, mid),
      new THREE.Vector3(startX, surface(mid) + 0.03, mid),
      new THREE.Vector3(endX, site.garageFloor + 0.03, mid),
    ],
    0xbd8136,
    true,
  );
  return g;
}
