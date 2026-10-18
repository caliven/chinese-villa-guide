import * as THREE from "three";
import { formatMm } from "./units";
import { site, floors, frontFieldLevel, courtyardFront, neighborCourtyardPlan, type Point } from "./data";
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
import { surroundings, forestTrees, basementColumns, roadHeight, rightTerraceBreak, rebuildTerraceLinkage } from "./surroundings";
import { buildContextGround, buildRoad } from "./site-ground";
import { garageLayout, rebuildGarageLayout } from "./garage-layout";

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
  const overhang = options?.overhang ?? 350,
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
  const verge = 140;
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
  box(g, x + w / 2, peak + 60, zMid, w + overhang * 2, 80, 160, mat.dark);
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
      i === 0 ? edges[i] - 90 : i === edges.length - 1 ? edges[i] + 90 : edges[i];
    box(frontage, px, y + height / 2, z - 100, 160, height, 160, mat.dark);
  }
  let east = x + w;
  for (let i = 0; i < widths.length; i++) {
    const bay = widths[i];
    const center = east - bay / 2;
    const hall = i === hallFromEast;
    const roomWindow = Math.min(1250, bay * 0.36);
    const upperW = hall ? Math.min(1700, bay * 0.42) : roomWindow * 0.82;
    // 邻居木房檐高约 5.2 米以上，上窗保持原位。自家旧木房更矮，上窗跟着檐口上收。
    const upperCenter = Math.min(4050, height - 720);
    box(
      frontage,
      center,
      y + upperCenter,
      z - 60,
      upperW,
      900,
      30,
      mat.glass,
      false,
    );
    box(frontage, center, y + upperCenter, z - 85, 40, 940, 35, mat.wood);
    box(frontage, center, y + upperCenter, z - 85, upperW + 60, 40, 35, mat.wood);
    if (hall) {
      const doorW = Math.min(1850, bay * 0.4);
      const door = new THREE.Group();
      door.name = "堂屋门";
      frontage.add(door);
      const leaf = doorW / 2 - 30;
      for (const side of [-1, 1]) {
        const lx = center + side * (leaf / 2 + 15);
        box(door, lx, y + 1220, z - 70, leaf, 2280, 50, mat.dark);
        box(door, lx, y + 1880, z - 100, Math.max(280, leaf - 160), 620, 20, mat.glass, false);
        box(door, lx, y + 1880, z - 112, 35, 680, 20, mat.wood);
        box(door, lx, y + 1880, z - 112, Math.max(340, leaf - 80), 35, 20, mat.wood);
      }
      box(door, center, y + 1220, z - 100, 40, 2340, 35, mat.dark);
      box(door, center, y + 2460, z - 90, doorW + 140, 80, 70, mat.dark);
      box(door, center, y + 2700, z - 65, doorW, 320, 30, mat.glass, false);
      box(frontage, center, y + 2920, z - 120, bay - 280, 100, 80, mat.wood);
      if (kind === "side")
        for (const side of [-1, 1]) {
          const sx = center + side * (doorW / 2 + 550);
          box(frontage, sx, y + 1450, z - 60, 620, 1150, 30, mat.glass, false);
          box(frontage, sx, y + 1450, z - 85, 40, 1200, 35, mat.wood);
          box(frontage, sx, y + 1450, z - 85, 680, 40, 35, mat.wood);
        }
    } else {
      box(frontage, center, y + 1400, z - 60, roomWindow, 1150, 30, mat.glass, false);
      box(frontage, center, y + 1400, z - 85, 40, 1200, 35, mat.wood);
      box(frontage, center, y + 1400, z - 85, roomWindow + 60, 40, 35, mat.wood);
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
  height = 5400,
  gable = false,
  bays?: "side" | "rear" | "own",
) {
  const g = new THREE.Group();
  parent.add(g);
  box(g, x + w / 2, y + height / 2, z + d / 2, w, height, d, mat.wood);
  if (bays) drawBayFront(g, x, z, w, y, height, mat, bays);
  else
    for (let xx = x + 400; xx < x + w; xx += 1500) {
      box(g, xx, y + 2600, z - 90, 140, height, 150, mat.dark);
      box(g, xx + 500, y + 1450, z - 110, 650, 950, 40, mat.glass, false);
      box(g, xx + 500, y + 1450, z - 140, 45, 1000, 50, mat.wood);
      box(g, xx + 500, y + 1450, z - 140, 680, 45, 50, mat.wood);
    }
  box(g, x + w / 2, y + 3100, z - 450, w, 160, 950, mat.wood);
  railing(g, [x + 100, z - 850], [x + w - 100, z - 850], y + 3200, mat, 950);
  if (gable)
    // 正脊沿长向。出檐和起坡仍用原来四坡的 0.55 米、1.5 米，只把两端收成山墙。
    gableRoof(g, x, z, w, d, y + height, 1500, mat, {
      darkTiles: true,
      gable: mat.wood,
      overhang: 550,
    });
  else hipRoof(g, x + w / 2, z + d / 2, w + 1100, d + 1100, y + height, 1500, mat);
  return g;
}

export function buildExistingHouses(parent: THREE.Object3D, mat: Mats) {
  // 用户口述：自家木房比旁边邻居木房大约低 30 厘米。前墙与邻居木房对齐。面宽进深仍用原模型，不是新的测绘。
  const ownWoodFront = surroundings.sideHouse.z;
  const ownWood = woodenHouse(
    parent,
    8800,
    ownWoodFront,
    12300,
    7900,
    0,
    mat,
    surroundings.sideHouse.h - 300,
    true,
    "own",
  );
  ownWood.name = "自家旧木房";
  ownWood.userData.frontZ = ownWoodFront;
  // 前墙比木屋大约多伸出 0.9 米。后墙比木房后墙更靠近后面的梯田，大约再多 1 米，这是口述，不是实测。
  const ownWoodRear = ownWoodFront + 7900;
  const brickRearPastWood = 1000;
  const brickFront = ownWoodFront - 900;
  const brickRear = ownWoodRear + brickRearPastWood;
  const brickDepth = brickRear - brickFront;
  const brick = new THREE.Group();
  brick.name = "自家旧砖房";
  brick.userData.frontZ = brickFront;
  parent.add(brick);
  box(brick, 4400, 1550, brickFront + brickDepth / 2, 8800, 3100, brickDepth, mat.wall).name =
    "旧砖房墙体";
  slab(brick, rect(0, brickFront, 8800, brickDepth), 3200, 170, mat.stone);
  flatRoofRails(
    brick,
    120,
    8680,
    brickFront + 120,
    brickFront + brickDepth - 120,
    3200,
    mat,
  );
  for (const x of [2300, 6300])
    box(brick, x, 1550, brickFront - 30, 1800, 1700, 35, mat.glass, false);
  // 红线轮廓：木墙到房前水泥外沿 2 米；邻居前坪和砖房前坪再向外。进深超出 2 米的部分按红线估算。
  const woodYardFront = ownWoodFront - 2000;
  const side = surroundings.sideHouse;
  const neighborRight = surroundings.neighborYard.x;
  // 邻院外沿跟 surroundings.neighborYard（与自家东界外沿拉齐）；水泥段另按 cementDepth。
  const neighborYardFront = surroundings.neighborYard.z;
  const neighborCementFront = side.z - neighborCourtyardPlan.cementDepth;
  const east = side.x + side.w;
  const passage = 800;
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
    250,
    mat.grass,
  );
  farm.name = "邻居房前农田";
  for (let x = site.width + 800; x < east - 600; x += 1250)
    for (let z = surroundings.neighborYard.z + 800; z < side.z - 1200; z += 2200)
      box(parent, x, fieldY + 40, z + 850, 130, 80, 1700, crops, false);
  slab(
    pads,
    rect(8800, woodYardFront, site.width - 8800, ownWoodFront - woodYardFront),
    0,
    160,
    mat.courtyard,
  ).name = "自家旧木房前水泥坪";
  slab(
    pads,
    rect(site.width, woodYardFront, neighborRight - site.width, side.z - woodYardFront),
    0,
    160,
    mat.neighborCourtyard,
  );
  // 面对房子：左侧接到下面农田外沿，比右侧长。西端外沿拉直并封口，不留折角。
  // 最右侧栏杆超过西墙约 1 米，并沿这条路伸到与院坪同高的梯田。1 米是口述。
  const brickRight = -1000;
  const brickLeft = 8650;
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
    160,
    mat.courtyard,
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
    160,
    mat.courtyard,
  ).name = "砖房西侧上田的路";
  slab(
    pads,
    rect(neighborRight, neighborCementFront, east - neighborRight, side.z - neighborCementFront),
    0,
    160,
    mat.neighborCourtyard,
  ).name = "邻居木房前水泥坪";
  // 水泥以南至邻院外沿：与自家东界外沿齐平的院坪示意（非水泥）。
  if (neighborCementFront - neighborYardFront > 50) {
    slab(
      pads,
      rect(neighborRight, neighborYardFront, east - neighborRight, neighborCementFront - neighborYardFront),
      0,
      120,
      mat.neighborCourtyard,
    ).name = "邻居水泥外院坪";
  }
  railing(pads, [8700, woodYardFront + 80], [neighborRight, woodYardFront + 80], 0, mat);
  const brickPath = new THREE.Group();
  brickPath.name = "砖房前坪右侧栏杆";
  pads.add(brickPath);
  // 外沿封口拉直；右侧这一条继续伸到上田，不在外沿留缺口。
  railing(brickPath, [brickRight, westEdgeZ], [brickRight, terraceZ], 0, mat);
  railing(pads, [brickLeft, woodYardFront], outerEdge.at(-1)!, 0, mat);
  let railFrom = outerEdge[0];
  for (let i = 1; i < outerEdge.length; i++) {
    if (i < outerEdge.length - 1 && i > 1 && outerEdge[i][0] - railFrom[0] < 1600) continue;
    railing(pads, railFrom, outerEdge[i], 0, mat);
    railFrom = outerEdge[i];
  }
  railing(
    pads,
    [neighborRight + 80, neighborYardFront + 80],
    [east - 150, neighborYardFront + 80],
    0,
    mat,
  );
  const neighborLeftRail = new THREE.Group();
  neighborLeftRail.name = "邻居前坪左侧栏杆";
  pads.add(neighborLeftRail);
  // 最左侧院坪靠木房一侧留 2 米缺口，出路不封死。2 米是口述。
  railing(
    neighborLeftRail,
    [east - 120, neighborYardFront + 80],
    [east - 120, side.z - 2000],
    0,
    mat,
  );
  const sideRail = new THREE.Group();
  sideRail.name = "邻居前坪右侧栏杆";
  pads.add(sideRail);
  railing(sideRail, [neighborRight, neighborYardFront + 80], [neighborRight, side.z - passage], 0, mat);
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
  const base = y + 20;
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
    box(g, x, base + 460, z, 80, 920, 80, mat.trim);
  for (const [ax, az, bx, bz] of edges) {
    const len = Math.hypot(bx - ax, bz - az);
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    box(g, mx, base + 100, mz, alongX ? len - 100 : 100, 200, alongX ? 100 : len - 100, mat.wall);
    box(g, mx, base + 880, mz, alongX ? len - 120 : 45, 40, alongX ? 45 : len - 120, mat.metal);
    const count = Math.max(2, Math.round(len / 160));
    for (let i = 1; i < count; i++) {
      const t = i / count;
      box(
        g,
        ax + (bx - ax) * t,
        base + 500,
        az + (bz - az) * t,
        alongX ? 18 : 40,
        680,
        alongX ? 40 : 18,
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
    rect(rear.x, rear.z - 1500, rear.w, 1500),
    rear.y + 25,
    150,
    mat.neighborCourtyard,
  );
  for (let i = 0; i < 6; i++) {
    box(
      rearHouse!,
      rear.x + rear.w - 800,
      rear.y - 800 + ((i + 1) * 800) / 12,
      rear.z - 2900 + i * 240,
      1500,
      ((i + 1) * 800) / 6,
      240,
      mat.neighborCourtyard,
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
  const windowH = 1850;
  const sill = 950;
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
      const wide = Math.min(2050, bay * 0.46);
      const narrow = Math.min(1550, bay * 0.38);
      if (hall && floor === 0)
        return { at: bayCenters[index], w: wide, sill: 0, h: 2750, door: true };
      if (hall)
        return { at: bayCenters[index], w: wide * 0.92, sill: 400, h: 2050 };
      return {
        at: bayCenters[index],
        w: narrow,
        sill: floor === 0 ? sill : 850,
        h: floor === 0 ? windowH : 1700,
      };
    });
  // 右侧主体进深两间，二楼两间都在，只向北内退一条走廊。1.4 米沿用自家过道外轮廓，不是测绘。
  // 内退的这一条是钢架加工层。开间仍是卧室、堂屋、卧室。
  const corridorSetback = 1400;
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
      openings.map((opening) => ({ ...opening, door: false, sill: 900, h: 1550 })),
      mat,
    );
    wallWithOpenings(
      house,
      [h.x, zWall],
      [h.x, back],
      y,
      h.floorHeight,
      [
        { at: depth * 0.25, w: 1400, sill: 900, h: 1600 },
        { at: depth * 0.75, w: 1400, sill: 900, h: 1600 },
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
            { at: depth * 0.25, w: 1250, sill: 900, h: 1550 },
            { at: depth * 0.75, w: 1250, sill: 900, h: 1550 },
          ]
        : [],
      mat,
    );
    slab(house, rect(h.x, h.z, mainW, h.d), y + 30, 150, i === 0 ? mat.neighborCourtyard : mat.paving);
    box(
      house,
      h.x + mainW / 2,
      y + h.floorHeight - 80,
      zWall - 180,
      mainW + 160,
      160,
      220,
      mat.trim,
    );
  }
  const fromWest = [widths[2], widths[1], widths[0]];
  let joint = h.x;
  for (const bay of [0, ...fromWest]) {
    joint += bay;
    box(house, joint, h.y + h.floorHeight / 2, h.z - 140, 220, h.floorHeight, 160, mat.trim);
    box(
      house,
      joint,
      h.y + h.floorHeight * 1.5,
      upperFront - 140,
      220,
      h.floorHeight,
      160,
      mat.trim,
    );
  }
  const hallMark = new THREE.Group();
  hallMark.name = "堂屋门";
  hallMark.position.set(h.x + bayCenters[1], h.y + 1350, h.z);
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
    const t = (z - (h.z - 450)) / (ridgeZ - (h.z - 450));
    return eaveY + Math.min(1, Math.max(0, t)) * h.roofRise;
  };
  const frameXs = [h.x + 450, h.x + mainW / 2, wingX - 450];
  const postZ = h.z + 350;
  const beamZ = upperFront - 200;
  for (const x of frameXs) {
    cylinder(
      workshop,
      new THREE.Vector3(x, deck + 80, postZ),
      new THREE.Vector3(x, roofAt(postZ) - 160, postZ),
      70,
      frameMat,
    );
    cylinder(
      workshop,
      new THREE.Vector3(x, roofAt(postZ) - 200, postZ),
      new THREE.Vector3(x, roofAt(beamZ) - 160, beamZ),
      50,
      frameMat,
    );
  }
  cylinder(
    workshop,
    new THREE.Vector3(frameXs[0], roofAt(postZ) - 180, postZ),
    new THREE.Vector3(frameXs[2], roofAt(postZ) - 180, postZ),
    50,
    frameMat,
  );
  gableRoof(house, h.x, h.z, mainW, h.d, h.y + height, h.roofRise, mat, {
    darkTiles: true,
    overhang: 450,
  });
  // 左侧一层与主楼一层同高，北面不砌墙，东墙离开马路约 0.8 米。
  // 红顶钢架跟着主体屋脊降：西侧高点仍低于屋脊约 1.8 米，朝东降低；东檐比一层东墙再挑出一点。
  const roadGap = 800;
  const eavePastWall = 400;
  const wingEast = h.x + h.w - roadGap;
  const wingSpan = wingEast - wingX;
  const wingWall = h.floorHeight;
  const deckY = h.y + wingWall;
  const yWest = h.y + height + h.roofRise - 1800;
  const yEast = yWest - 1150;
  wallWithOpenings(
    house,
    [wingX + 120, back],
    [wingEast, back],
    h.y,
    wingWall,
    [{ at: wingSpan * 0.5, w: 1250, sill: 900, h: 1350 }],
    mat,
  );
  wallWithOpenings(
    house,
    [wingEast, h.z],
    [wingEast, back],
    h.y,
    wingWall,
    [{ at: h.d / 2, w: 1150, sill: 850, h: 1300 }],
    mat,
  );
  box(house, (wingX + wingEast) / 2, deckY - 120, h.z, wingSpan, 220, 280, mat.trim);
  // 楼板收到墙内皮以内，顶面略低于墙顶，避免和墙顶共面，拖动时闪。
  slab(
    house,
    rect(wingX + 280, h.z + 40, wingSpan - 520, h.d - 280),
    deckY - 30,
    140,
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
  const z0 = h.z - 200;
  const z1 = back + 200;
  const roofY = (x: number) => yWest + ((yEast - yWest) * (x - x0)) / (x1 - x0);
  const postXs = [wingX + wingSpan * 0.08, (wingX + wingEast) / 2, wingEast - 350];
  const postZs = [h.z + 350, back - 350];
  for (const x of postXs)
    for (const z of postZs)
      cylinder(
        steel,
        new THREE.Vector3(x, deckY, z),
        new THREE.Vector3(x, roofY(x) - 280, z),
        55,
        steelMat,
      );
  for (const x of postXs)
    cylinder(
      steel,
      new THREE.Vector3(x, roofY(x) - 300, z0 + 150),
      new THREE.Vector3(x, roofY(x) - 300, z1 - 150),
      40,
      steelMat,
    );
  for (const z of postZs)
    cylinder(
      steel,
      new THREE.Vector3(postXs[0], roofY(postXs[0]) - 320, z),
      new THREE.Vector3(postXs[2], roofY(postXs[2]) - 320, z),
      40,
      steelMat,
    );
  const slopes = new THREE.BufferGeometry();
  const lip = 220;
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
    new THREE.CylinderGeometry(70, 150, 1, 6),
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
          t.y + t.h - 1000 + random() * t.r * 1.5,
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
  const path = contourSection(insetContour(courtyardFront, 100), 130, site.width - 130);
  const strip = (halfWidth: number): Point[] => [
    ...insetContour(path, -halfWidth),
    ...insetContour(path, halfWidth).reverse(),
  ];
  // 底托顶仍约 0.12；底面抬离院坪顶约 1cm，避免与铺装共面斜看闪白线。
  slab(parent, strip(90), 120, 110, mat.trim);
  slab(parent, strip(50), 1130, 65, mat.metal);
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
  const balusters = Math.ceil(total / 230), posts = Math.ceil(total / 2600);
  for (let i = 0; i <= balusters; i++) {
    const [x, z] = at(total * i / balusters);
    box(parent, x, 550, z, 25, 1100, 25, mat.metal, false);
  }
  for (let i = 0; i <= posts; i++) {
    const [x, z] = at(total * i / posts);
    box(parent, x, 550, z, 160, 1100, 160, mat.trim);
    box(parent, x, 1125, z, 240, 90, 240, mat.stone);
  }
}

export function buildCourtyard(mat: Mats) {
  const deck = new THREE.Group();
  deck.name = "完整院坪与右侧人行通道";
  slab(deck, site.field, 0, 230, mat.courtyard).name = "无中央楼梯洞的院坪";
  courtyardRailing(deck, mat);
  // 西侧栏杆北端落在院坪西端外沿，南端接到右田坎／辅楼侧通道，不伸出院坪。
  const westRailNorth = contourAt(courtyardFront, 120);
  railing(deck, [120, westRailNorth], [120, surroundings.rightStep], 0, mat, 1100);
  box(deck, 13600, -335, -500, 13600, 230, 360, mat.stone);
  return deck;
}

export function buildSite(mat: Mats) {
  // 建场地前按当前院坪／房子参数刷新梯田接缝与地库布局。
  rebuildTerraceLinkage();
  rebuildGarageLayout();
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
  const foundationTop = site.garageFloor - 150;
  slab(fixed, site.boundary, foundationTop, foundationTop - frontFieldLevel, mat.soil);
  // 铺装是看见的地面。石基顶面留在铺装底面以下，避免鸟瞰时两层共面闪成格子。
  const padTop = 10;
  const padThick = 70;
  const stoneTop = padTop - padThick - 60;
  slab(fixed, rect(0, 0, site.width, site.oldDepth), stoneTop, stoneTop - foundationTop, mat.stone);
  slab(fixed, rect(0, 0, site.width, site.oldDepth), padTop, padThick, mat.courtyard);
  box(fixed, site.width / 2, 1250, site.oldDepth + 160, site.width, 2500, 320, mat.stone);
  // 屋后铺装上原先有一条深色细条（偏绿灰），用户要求删除。
  vegetation(context, mat);
  context.add(road);
  slab(fixed, rect(site.cut.x, site.cut.z, site.cut.w, site.cut.d), -3150, 150, mat.soil);

  const yard = surroundings.neighborYard;
  neighborDeck.name = "新建邻居前坪";
  // 木屋前整段与自家院坪、邻居左侧院坪同一标高接通，不再留一块挖低的空地。现状另画旧水泥坪。
  slab(
    neighborDeck,
    garageLayout.retainedDeck.footprint,
    0,
    -garageLayout.retainedDeck.modelSlabBottom,
    mat.neighborCourtyard,
  ).name = "与两侧院坪接通的邻居前坪";
  const neighborLeft = new THREE.Group();
  neighborLeft.name = "新建邻居前坪左侧栏杆";
  neighborDeck.add(neighborLeft);
  // 最左侧靠木房留 2 米缺口，出路不封死。2 米是口述。
  railing(
    neighborLeft,
    [surroundings.road.x - 60, yard.z + 100],
    [surroundings.road.x - 60, surroundings.sideHouse.z - 2000],
    0,
    mat,
  );
  railing(
    neighborDeck,
    [site.width, yard.z + 100],
    [surroundings.road.x - 60, yard.z + 100],
    0,
    mat,
  );
  context.add(neighborDeck, cutPiece, cutOutline);

  // 正前方电杆及架空线按拆除计划移除。
  // 现状下保留自家两栋旧房和低田。
  slab(existing, site.field, site.originalField, 300, mat.grass);
  buildExistingHouses(existing, mat);
  // 新地库顶板与楼下空间。木屋前的地下室也按自家地库铺装。
  slab(garage, site.field, site.garageFloor, 150, mat.paving);
  const woodFront = surroundings.sideHouse.z;
  slab(
    garage,
    rect(site.width, yard.z, surroundings.road.x - site.width, woodFront - yard.z),
    site.garageFloor,
    150,
    mat.paving,
  ).name = "木屋前自家地下室地面";
  const columns = basementColumns();
  for (const column of garageLayout.columns) {
    const [a, , c] = column.footprint;
    box(garage, (a[0] + c[0]) / 2, (column.top + column.bottom) / 2,
      (a[1] + c[1]) / 2, garageLayout.columnWidth, column.top - column.bottom,
      garageLayout.columnWidth, mat.stone).name = column.label;
  }
  // 梁底 -.45、地面 -2.95，示意最低净高2.50；不代表结构梁高可成立。
  // 外墙只做到约 1 米，上面敞开，便于从外侧看到地库。样式一直延续到木屋前。
  slab(
    garage,
    garageLayout.outerWall,
    site.garageFloor + 1040,
    1040,
    mat.stone,
  ).name = "沿同一外沿的地库矮墙";
  // 局部下挖止于自家边界，旁田的原标高不随车库降低。
  slab(
    garage,
    garageLayout.westWall.footprint,
    garageLayout.westWall.top,
    garageLayout.westWall.top - garageLayout.westWall.bottom,
    mat.stone,
  ).name = "地库局部下挖与未挖旁田的交界";
  // 车位锚到地库外墙包络内侧，避免院坪总进深变浅后伸出边界。
  const wallPts = garageLayout.outerWall;
  const wallMinX = Math.min(...wallPts.map((p) => p[0]));
  const wallMaxX = Math.max(...wallPts.map((p) => p[0]));
  const wallMinZ = Math.min(...wallPts.map((p) => p[1]));
  const wallMaxZ = Math.max(...wallPts.map((p) => p[1]));
  const clampPark = (x: number, z: number, halfW: number, halfD: number): [number, number] => [
    Math.min(wallMaxX - halfW - 300, Math.max(wallMinX + halfW + 300, x)),
    Math.min(wallMaxZ - halfD - 300, Math.max(wallMinZ + halfD + 300, z)),
  ];
  const [l9x, l9z] = clampPark(18500, -4020, 1350, 2750);
  const [xyx, xyz] = clampPark(14650, -3750, 1100, 2300);
  const parked = buildL9(mat);
  parked.position.set(l9x, site.garageFloor, l9z);
  garage.add(parked);
  const second = buildXingyuan(mat);
  second.position.set(xyx, site.garageFloor, xyz);
  garage.add(second);
  for (const [x, z, name] of [
    [l9x, l9z, "理想 L9 Max · 黑"],
    [xyx, xyz, "吉利星愿 · 银"],
  ] as [number, number, string][]) {
    line(
      garage,
      [...rect(x - 1350, z - 2750, 2700, 5500), [x - 1350, z - 2750]].map(
        ([xx, zz]) => new THREE.Vector3(xx, site.garageFloor + 20, zz),
      ),
      0xc8bfa4,
    );
    tag(garage, name, x, -1900, z, "#685b40", 0.7);
  }
  box(garage, 3700, -2250, -850, 3600, 1300, 800, mat.wood);
  const overlapMat = new THREE.MeshBasicMaterial({
    color: 0xcf964c,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
    forceSinglePass: true,
  });
  slab(overlap, rect(site.main.x, site.main.z, site.main.w, 1000), 35, 25, overlapMat);
  slab(overlap, rect(site.portico.x, site.main.z - site.portico.projection, site.portico.w, site.portico.projection), 35, 25, overlapMat);
  tag(overlap, "主楼前伸 1.0 m · 与地库重叠", 13550, 1400, -400, "#ffe566", 0.78, true);
  overlap.visible = false;
  const columnNotes = new THREE.Group();
  columnNotes.name = "地库柱位";
  const noteY = -1150;
  const markSpan = (index: number) => {
    const column = columns.columns[index];
    line(
      columnNotes,
      [
        new THREE.Vector3(column.x, site.garageFloor + 40, column.outer[1]),
        new THREE.Vector3(column.x, site.garageFloor + 40, column.inner[1]),
      ],
      0xa77332,
      true,
    );
    tag(
      columnNotes,
      `净跨 ${formatMm(column.span)}`,
      column.x,
      noteY,
      (column.outer[1] + column.inner[1]) / 2,
      "#ffe566",
      0.62,
      true,
    );
  };
  markSpan(0);
  markSpan(columns.columns.findIndex((column) => column.x > 10000 && column.x <= site.width));
  markSpan(columns.columns.findIndex((column) => column.x > site.width));
  const bay = columns.columns[1];
  line(
    columnNotes,
    [
      new THREE.Vector3(columns.columns[0].x, site.garageFloor + 40, columns.columns[0].outer[1]),
      new THREE.Vector3(bay.x, site.garageFloor + 40, bay.outer[1]),
    ],
    0x466a59,
    true,
  );
  tag(
    columnNotes,
    `柱距 ${formatMm(columns.spacing)}`,
    (columns.columns[0].x + bay.x) / 2,
    noteY,
    (columns.columns[0].outer[1] + bay.outer[1]) / 2 - 800,
    "#ffe566",
    0.62,
    true,
  );
  tag(columnNotes, "外沿柱", 9100, noteY, -6200, "#ffe566", 0.66, true);
  tag(columnNotes, "房前墙下柱", 13300, noteY, -1700, "#ffe566", 0.66, true);
  tag(columnNotes, "中间不立柱 · 梁高待核算", 16000, -400, -4200, "#ffe566", 0.68, true);
  columnNotes.visible = false;
  proposed.add(deck, garage, overlap, columnNotes);
  const scheme = new THREE.Group();
  scheme.name = "新建尺寸";
  const current = new THREE.Group();
  current.name = "现状尺寸";
  dimensions.add(scheme, current);
  const p = (x: number, z: number, y = 150) => new THREE.Vector3(x, y, z);
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
  span(roadsideDimensions, p(annex.x, annex.z, 400), p(annex.x, eastPoint[1], 400));
  span(roadsideDimensions, p(annex.x, eastPoint[1], 400), p(eastPoint[0], eastPoint[1], 400));
  dim(roadsideDimensions, `辅楼西墙延长线 · 横向约 ${formatMm(roadside.extensionGap)}`, (annex.x + eastPoint[0]) / 2, 1800, eastPoint[1] - 700, 0.7);
  const eaveHeight = roadside.floorHeights.reduce((sum, height) => sum + height, 0);
  dim(roadsideDimensions, `蓝顶邻房 ${formatMm(roadside.w)}×${formatMm(roadside.d)} · 三层 · 估算`, roadside.x, roadside.y + eaveHeight + roadside.roofRise + 1500, roadside.z, 0.75);
  const facing = roadsideToWorld(roadside, 0, -roadside.d / 2 - roadside.portico.d - 1000);
  dim(roadsideDimensions, `朝西北 · 北偏西约 ${roadside.angle}° · 估算`, facing[0], roadside.y + 1600, facing[1] - 700, 0.72);
  span(dimensions, p(0, 11200, 2400), p(site.width, 11200, 2400));
  dim(dimensions, `东西总宽 ${formatMm(site.width)}`, site.width / 2, 3800, 12600, 0.86);
  span(dimensions, p(0, 0, 1400), p(0, site.oldDepth, 1400));
  dim(dimensions, `旧台地进深 ${formatMm(site.oldDepth)}`, 2400, 3300, 11600, 0.74);
  span(dimensions, p(350, 0, 1200), p(350, courtyardFront[0][1], 1200));
  dim(dimensions, `西端外沿 ${formatMm(Math.abs(courtyardFront[0][1]))}`, 2600, 2000, courtyardFront[0][1] / 2, 0.7);
  dim(dimensions, `旁田 ${formatMm(site.adjacentUnexcavatedLevel)} · 示意待测`, -7000, site.adjacentUnexcavatedLevel + 1100, 1000, 0.74);
  dim(dimensions, `前田低于地库约 ${formatMm(site.frontFieldDrop)}`, 5000, frontFieldLevel + 1100, -13000, 0.74);
  dim(dimensions, `砖房台地再低约 ${formatMm(site.frontHouseDrop)}`, 18000, front.y + 1300, -19000, 0.74);
  dim(dimensions, `屋后田 +${formatMm(site.rearField)}`, 7000, site.rearField + 1400, 13600, 0.74);
  dim(dimensions, `后二层田 +${formatMm(surroundings.rearSecond.y)} · 估算`, 8000, surroundings.rearSecond.y + 1300, 22000, 0.7);
  dim(dimensions, `后三层田 +${formatMm(surroundings.rearThird.y)} · 估算`, 8000, surroundings.rearThird.y + 1300, 32200, 0.7);
  dim(dimensions, `东侧大平地与屋后田同高 +${formatMm(surroundings.leftPlatform.y)}`, 46000, surroundings.leftPlatform.y + 1400, 0, 0.7);
  span(dimensions, p(surroundings.road.x, -14000, 1300), p(surroundings.road.x + surroundings.road.w, -14000, 1300));
  dim(dimensions, `道路宽 ${formatMm(surroundings.road.w)} · 待测`, 35500, 2400, -15400, 0.7);
  dim(dimensions, `邻居木房 ${formatMm(side.w)}×${formatMm(side.d)} · 前墙对齐 · 估算`, side.x + side.w / 2, side.h + 1600, side.z + side.d / 2, 0.72);
  dim(dimensions, `屋后木房 ${formatMm(rear.w)}×${formatMm(rear.d)} · 台地 +${formatMm(rear.y)} · 估算`, rear.x + rear.w / 2, rear.y + rear.h + 1400, rear.z + rear.d / 2, 0.7);
  dim(dimensions, `前方砖房 ${formatMm(front.w)}×${formatMm(front.d)} · 侧面两间 · 二楼内退走廊 1400`, front.x + front.w / 2, front.y + front.floorHeight * front.floors + 1600, front.z - 1600, 0.7);
  dim(dimensions, "屋脊高于一层顶约 2000", front.x + front.w * 0.72, front.y + front.floorHeight * front.floors + 3200, front.z + front.d / 2, 0.66);
  dim(dimensions, "矮楼与主楼一层齐平 · 红顶低于屋脊约 1800", front.x + front.w - 1200, front.y + 4200, front.z + 2200, 0.64);
  dim(dimensions, "屋后田宽约 400", front.x + 4000, front.y + 1500, front.z + front.d + 900, 0.66);
  dim(dimensions, "靠木房出口 2000", surroundings.road.x - 800, 1800, side.z - 1000, 0.66);
  span(scheme, p(main.x, -4300, 400), p(main.x + main.w, -4300, 400));
  dim(scheme, `主楼 ${formatMm(main.w)}×${formatMm(main.d)}`, 13550, eave + 3600, 1500, 0.82);
  dim(scheme, `层高 ${floors.map((floor) => formatMm(floor.height)).join(" / ")}`, 4200, 5800, 9600, 0.74);
  span(scheme, p(main.x + main.w - 200, main.z + main.d, 300), p(main.x + main.w - 200, main.z + main.d, eave));
  dim(scheme, `檐口 ${formatMm(eave)}`, 18800, eave + 2600, 10600, 0.7);
  span(scheme, p(annex.x, -3500, 400), p(annex.x + annex.w, -3500, 400));
  dim(scheme, `辅楼 ${formatMm(annex.w)}×${formatMm(annex.d)} · 高 ${formatMm(annex.height)}`, 3050, annex.height + 1600, 4000, 0.72);
  span(scheme, p(main.x + main.w, 6000, 400), p(site.width, 6000, 400));
  dim(scheme, `东侧 ${formatMm((site.width - main.x - main.w))}`, (main.x + main.w + site.width) / 2, 2200, 7200, 0.64);
  span(scheme, p(0, 3000, 400), p(annex.x, 3000, 400));
  dim(scheme, `西侧 ${formatMm(site.sideGap)}`, 400, 2200, 1400, 0.64);
  span(scheme, p(annex.x + annex.w, 5000, 400), p(main.x, 5000, 400));
  dim(scheme, `子孙道 ${formatMm(site.lane)}`, 6050, 2500, 6200, 0.68);
  span(scheme, p(10000, main.z, 8400), p(10000, main.z + site.setback, 8400));
  dim(scheme, `三楼北退 ${formatMm(site.setback)}`, 8600, 7600, -2600, 0.68);
  dim(scheme, `屋后留 ${formatMm(site.rearGap)}`, 17400, 3600, 9200, 0.68);
  dim(scheme, `门厅 ${formatMm(site.portico.w)}×${formatMm(site.portico.projection)} · 另计`, 13700, 3400, -5400, 0.72);
  dim(scheme, `二楼前檐 ${formatMm(site.secondFrontEave)} · 顶檐 ${formatMm(site.thirdEave)} · 同构造`, 17600, 4200, -4600, 0.68);
  dim(scheme, "前通道约 2000", 2800, 1600, -2500, 0.66);
  dim(scheme, `侧道 ${formatMm(site.sideGap)}`, 450, 1800, 6400, 0.64);
  dim(scheme, `地库 ${formatMm(site.garageFloor)} · 净高目标 ${formatMm(site.garageClear)}`, 16200, 2000, -7600, 0.7);
  dim(scheme, `右侧上田整体再向前 ${formatMm(surroundings.rightTerraceAdvance)}`, -4200, 1500, 2200, 0.68);
  span(scheme, p(main.x, main.z, 350), p(main.x, main.z + main.d, 350));
  dim(scheme, `进深 ${formatMm(main.d)}`, 4600, 4200, -1200, 0.68);
  for (const x of [main.x + main.w, 13550, main.x]) {
    const z = contourAt(courtyardFront, x);
    const depth = main.z - z;
    span(scheme, p(x, main.z, 200), p(x, z, 200));
    dim(scheme, `距前墙 ${formatMm(depth)}`, x, 1500, (main.z + z) / 2, 0.64);
  }
  // 与 buildExistingHouses 同一组现状尺寸：面宽进深沿用原模型，0.9 米和 2 米是口述。
  const ownWoodH = side.h - 300;
  dim(current, `旧木房 12300×7900 · 檐墙约 ${formatMm(ownWoodH)}`, 15000, ownWoodH + 1500, 5000, 0.72);
  dim(current, "旧砖房 8800×9800 · 墙高约 3100", 4400, 4600, 5100, 0.72);
  dim(current, "前墙多伸出 900", 4400, 2000, 550, 0.66);
  dim(current, "后墙比木房更靠近后田约 1000", 4400, 2200, 9600, 0.66);
  dim(current, "木墙到外沿 2000", 15000, 1800, 150, 0.66);
  dim(current, "西侧栏杆过墙约 1000", -200, 1800, -1400, 0.66);
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
  const z0 = garageLayout.entry.z, z1 = z0 + garageLayout.entry.d, strips = 5;
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
  return g;
}
