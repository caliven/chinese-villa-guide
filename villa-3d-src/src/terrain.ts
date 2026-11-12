import { porticoFrontZ, recessedPortico } from "./building-variants";
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
  line,
  tag,
  type Mats,
} from "./primitives";
import { buildL9, buildXingyuan } from "./cars";
import { buildRoadsideVilla } from "./roadside-villa";
import { easternPhotoHouses, northPhotoReferences } from "./photo-context-layout";
import { roadsideFootprints, roadsideToWorld } from "./roadside-villa-layout";
import {
  surroundings,
  basementColumns,
  annexColumnInnerZ,
  mainFrontGaragePocket,
  mainFrontPadHole,
  rightTerraceBreak,
  rebuildTerraceLinkage,
  groundHeight,
} from "./surroundings";
import { buildContextGround, buildRoad } from "./site-ground";
import { buildNorthPhotoContext } from "./site-photo-context";
import { buildDistantTerrain } from "./terrain-horizon";
import {
  basementFloorY,
  beamSoffitAt,
  garageLayout,
  GARAGE_OUTER_WALL_CENTER_INSET,
  GARAGE_OUTER_WALL_THICKNESS,
  outerLaneDepth,
  rebuildGarageLayout,
  slabSoffitAt,
} from "./garage-layout";

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
  group.add(buildPhotoNeighbors(mat));
  return group;
}

/** 北侧两图中的东侧山脚邻房，位置、尺寸及台地标高均为照片估算。 */
function buildPhotoNeighbors(mat: Mats) {
  const group = new THREE.Group();
  group.name = "东侧山脚邻房群";
  group.userData.source = northPhotoReferences;
  for (const spec of easternPhotoHouses(surroundings.road.x)) {
    // 西向房屋先在局部坐标中建模，再整体旋转，保持原房基范围。
    const westFacing = spec.facing === "west";
    const h = westFacing ? { ...spec, x: -spec.d / 2, z: -spec.w / 2, w: spec.d, d: spec.w } : spec;
    const house = new THREE.Group();
    house.name = h.name;
    house.userData.accuracy = "尺寸及标高为照片估算，待测";
    house.userData.facing = spec.facing;
    house.userData.stories = spec.stories;
    if (westFacing) {
      house.position.set(spec.x + spec.w / 2, 0, spec.z + spec.d / 2);
      house.rotation.y = Math.PI / 2;
    }
    const masonry = h.kind === "masonry";
    const facade = masonry ? mat.wall : mat.wood;
    const floorHeight = masonry ? h.h / 2 : h.h;
    const stories = spec.stories;
    box(house, h.x + h.w / 2, h.y + h.h / 2, h.z + h.d / 2, h.w, h.h, h.d, facade);
    box(house, h.x + h.w / 2, h.y + 400, h.z - 35, h.w, 800, 100, mat.stone);
    slab(house, rect(h.x - 350, h.z - 1300, h.w + 700, 1300), h.y + 40, 180, mat.neighborCourtyard);
    for (let floor = 0; floor < stories; floor++) {
      for (const bay of [0.18, 0.5, 0.82]) {
        if (floor === 0 && bay === 0.5) continue;
        box(house, h.x + h.w * bay, h.y + floor * floorHeight + 1900, h.z - 40,
          1150, 1500, 80, mat.glass, false);
        box(house, h.x + h.w * bay, h.y + floor * floorHeight + 1900, h.z - 90,
          45, 1500, 45, mat.trim);
      }
    }
    box(house, h.x + h.w / 2, h.y + 1150, h.z - 100, 1450, 2300, 150, mat.wood).name = "邻房大门";
    if (masonry) {
      const pink = mat.roof.clone();
      pink.color.set(0x9b6f77);
      hipRoof(house, h.x + h.w / 2, h.z + h.d / 2, h.w + 800, h.d + 800,
        h.y + h.h, h.roofRise, { ...mat, roof: pink }, false);
      // 照片中的侧面平顶附属部分。
      box(house, h.x - 1400, h.y + 1550, h.z + h.d / 2, 2800, 3100, h.d - 800, mat.wall);
      slab(house, rect(h.x - 2800, h.z + 400, 2800, h.d - 800), h.y + 3200, 180, mat.stone);
    } else {
      gableRoof(house, h.x, h.z, h.w, h.d, h.y + h.h, h.roofRise, mat,
        { darkTiles: true, gable: mat.wood, overhang: 400 });
      const red = mat.roof.clone();
      red.color.set(0x92514b);
      const awning = box(house, h.x + h.w / 2, h.y + 2800, h.z - 600, h.w + 400, 100, 1200, red);
      awning.rotation.x = -0.12;
    }
    group.add(house);
  }
  return group;
}

const RAIL_HEIGHT = 1100;
const RAIL_POST_SPAN = 2600;
const RAIL_BALUSTER_SPAN = 230;

function railMaterials(mat: Mats) {
  const trim = mat.trim.clone();
  const metal = mat.metal.clone();
  const stone = mat.stone.clone();
  for (const material of [trim, metal, stone]) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = 2;
    material.polygonOffsetUnits = 2;
  }
  return { trim, metal, stone };
}

/** 同一套栏杆：底托离开铺装，立柱处不再叠细栏杆，避免共面闪动。 */
function edgeRailing(parent: THREE.Object3D, path: Point[], mat: Mats, postPoints?: Point[]) {
  if (path.length < 2) return;
  const lengths = [0];
  for (let i = 1; i < path.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = lengths.at(-1)!;
  if (total < 200) return;
  const at = (distance: number): Point => {
    const index = lengths.findIndex((length, i) => i > 0 && length >= distance - 1e-6);
    if (index < 0) return path.at(-1)!;
    const span = lengths[index] - lengths[index - 1];
    const t = span < 1e-6 ? 0 : (distance - lengths[index - 1]) / span;
    const a = path[index - 1], b = path[index];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const project = (point: Point) => {
    let best = 0, bestD = Infinity;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / len2));
      const x = a[0] + dx * t, z = a[1] + dz * t;
      const d = (point[0] - x) ** 2 + (point[1] - z) ** 2;
      if (d < bestD) { bestD = d; best = lengths[i - 1] + Math.hypot(x - a[0], z - a[1]); }
    }
    return best;
  };
  const { trim, metal, stone } = railMaterials(mat);
  const strip = (halfWidth: number): Point[] => [
    ...insetContour(path, -halfWidth),
    ...insetContour(path, halfWidth).reverse(),
  ];
  slab(parent, strip(90), 140, 100, trim);
  slab(parent, strip(50), 1130, 65, metal);
  const posts = Math.max(1, Math.ceil(total / RAIL_POST_SPAN));
  const postDistances = postPoints?.map(project) ?? Array.from({ length: posts + 1 }, (_, i) => total * i / posts);
  const balusters = Math.ceil(total / RAIL_BALUSTER_SPAN);
  for (let i = 0; i <= balusters; i++) {
    const distance = total * i / balusters;
    if (postDistances.some((post) => Math.abs(post - distance) < 100)) continue;
    const [x, z] = at(distance);
    box(parent, x, 550, z, 25, RAIL_HEIGHT, 25, metal, false);
  }
  for (const distance of postDistances) {
    const [x, z] = at(Math.max(0, Math.min(total, distance)));
    box(parent, x, 550, z, 160, RAIL_HEIGHT, 160, trim);
    box(parent, x, 1175, z, 240, 90, 240, stone);
  }
}

/** 完成面铺装只留朝上的一张面，不挤出竖向侧壁，避免和相邻院坪共面闪线。 */
function gradeSurface(
  parent: THREE.Object3D,
  name: string,
  points: Point[],
  y: number,
  material: THREE.Material,
  holes: Point[][] = [],
) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const hole of holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
  }
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i));
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal");
  if (normal.getY(0) < 0) {
    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        index.setX(i, index.getX(i + 2));
        index.setX(i + 2, a);
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        for (const attr of [pos, uv]) {
          for (let k = 0; k < attr.itemSize; k++) {
            const keep = attr.getComponent(i, k);
            attr.setComponent(i, k, attr.getComponent(i + 2, k));
            attr.setComponent(i + 2, k, keep);
          }
        }
      }
    }
    geometry.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.y = y;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function courtyardRailing(parent: THREE.Group, mat: Mats) {
  const path = contourSection(insetContour(courtyardFront, 100), 130, site.width - 130);
  edgeRailing(parent, path, mat);
}

export function buildCourtyard(mat: Mats) {
  const deck = new THREE.Group();
  deck.name = "完整院坪与右侧人行通道";
  const slabThick = site.garageSlabThickness;
  // 辅楼内退段下为实体台地：院坪楼板只铺到 Z=0，不再向前廊下挖悬空。
  slab(deck, site.field, 0, slabThick, mat.courtyard).name = "无中央楼梯洞的院坪";
  courtyardRailing(deck, mat);
  // 西侧栏杆北端落在院坪西端外沿，南端接到右田坎／辅楼侧通道，不伸出院坪。
  const westRailNorth = contourAt(courtyardFront, 120);
  railing(deck, [120, westRailNorth], [120, surroundings.rightStep], 0, mat, RAIL_HEIGHT);
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
  const contextGround = buildContextGround(mat);
  context.add(contextGround, road, buildNorthPhotoContext(mat));
  const distantTerrain = buildDistantTerrain(mat, undefined, context);
  context.add(distantTerrain);
  const neighbors = buildSurroundingHouses(mat);
  context.add(neighbors);
  const sideNeighbor = neighbors.getObjectByName("左侧邻居木房")!;
  const rearNeighbor = neighbors.getObjectByName("后方第二层梯田木房")!;
  const frontNeighbor = neighbors.getObjectByName("前方两层砖房")!;
  const roadsideNeighbor = neighbors.getObjectByName("主马路边蓝顶三层邻房")!;
  // 两家旧台地进深同为 oldDepth，南缘同为 Z=0、北缘齐平。
  // 主楼前墙若相对台地南缘外伸（mainDepth+rearGap−oldDepth），外伸段架空，地基实体不填出台地南缘。
  const platformSouth = 0;
  const platformDepth = site.oldDepth;
  const platformNorth = platformSouth + platformDepth;
  const foundationTop = site.garageFloor - site.garageSlabThickness;
  // 主楼仅外伸段架空：土基在前墙外伸范围开洞；Z≥0 实体台地实心，不向屋内下挖。
  const mainPocket = mainFrontGaragePocket();
  const soilHoles: Point[][] = mainPocket.length ? [mainPocket] : [];
  // 院坪、地库和基座共用外沿；相邻未挖田面在 X=0 接续这条曲线。
  slab(
    fixed,
    site.boundary,
    foundationTop,
    foundationTop - frontFieldLevel,
    mat.soil,
    soilHoles,
  ).name = "自家场地土基";
  // 自家及邻居地库共用连续地底封面，开挖孔只表达其上方的净空。
  // 封面略低于土基底面，避免与原有底面共面闪动。
  const undersideBoundary: Point[] = [
    [0, platformNorth],
    [surroundings.road.x, platformNorth],
    [surroundings.road.x, surroundings.neighborYard.z],
    ...courtyardFront.slice().reverse(),
  ];
  const undersideShape = new THREE.Shape(undersideBoundary.map(([x, z]) => new THREE.Vector2(x, z)));
  const undersideGeometry = new THREE.ShapeGeometry(undersideShape);
  undersideGeometry.rotateX(Math.PI / 2);
  const underside = new THREE.Mesh(undersideGeometry, mat.soil);
  underside.name = "自家及邻居地库地底封面";
  underside.position.y = frontFieldLevel - 2;
  underside.receiveShadow = true;
  fixed.add(underside);
  // 看见的地面与前院、邻居过道同一完成面。厚板侧壁会在水泥边闪成细线，铺装只留朝上的面。
  // 石基顶面留在铺装以下，避免鸟瞰时两层共面闪成格子。
  // 台地石基／铺装落在 [platformSouth, platformNorth]；整片实体，不开前廊屋内洞。
  const padThick = 70;
  const stoneTop = -padThick - 60;
  const ownPad = rect(0, platformSouth, site.width, platformDepth);
  const padHole = mainFrontPadHole();
  const padHoles = padHole.length ? [padHole] : [];
  slab(fixed, ownPad, stoneTop, stoneTop - foundationTop, mat.stone, padHoles).name = "自家旧台地石基";
  gradeSurface(fixed, "自家旧台地铺装", ownPad, 0, mat.courtyard, padHoles);
  box(fixed, site.width / 2, 1250, platformNorth + 160, site.width, 2500, 320, mat.stone);
  // 邻居台地与自家同一进深口径：南缘 Z=0、北缘 oldDepth 齐平（实景两家地基外沿持平）。
  // 木屋前地库仍是开挖净空，由地库水泥地面表达；台地土基／石基按整块台地填满，不再从木屋前墙起缩进。
  {
    const neighborX0 = site.width;
    const neighborW = surroundings.road.x - neighborX0;
    if (neighborW > 100 && platformDepth > 100) {
      const neighborPad = rect(neighborX0, platformSouth, neighborW, platformDepth);
      slab(fixed, neighborPad, foundationTop, foundationTop - frontFieldLevel, mat.soil)
        .name = "邻居台地土基";
      slab(fixed, neighborPad, stoneTop, stoneTop - foundationTop, mat.stone)
        .name = "邻居台地石基";
    }
  }
  // 屋后铺装上原先有一条深色细条（偏绿灰），用户要求删除。
  slab(fixed, rect(site.cut.x, site.cut.z, site.cut.w, site.cut.d), -3150, site.garageSlabThickness, mat.soil);

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
  // 前缘和靠路一侧栏杆按原范围恢复。靠木房留 2 米缺口，出路不封死。2 米是口述。
  // 与自家外侧栏杆同一套模型、同一高度。地库最外侧不再另做围栏。
  const neighborRail = new THREE.Group();
  neighborRail.name = "邻居前坪栏杆";
  neighborDeck.add(neighborRail);
  edgeRailing(neighborRail, [[site.width, yard.z + 100], [surroundings.road.x - 60, yard.z + 100]], mat);
  const neighborLeft = new THREE.Group();
  neighborLeft.name = "新建邻居前坪左侧栏杆";
  neighborDeck.add(neighborLeft);
  edgeRailing(
    neighborLeft,
    [[surroundings.road.x - 60, yard.z + 100], [surroundings.road.x - 60, surroundings.sideHouse.z - 2000]],
    mat,
  );
  // 邻居前坪与自家院坪楼板同级，不挂在周边 context 下，以便拆分展开／合拢单独显隐。
  context.add(cutPiece, cutOutline);

  // 正前方电杆及架空线按拆除计划移除。
  // 现状下保留自家两栋旧房和低田。
  slab(existing, site.field, site.originalField, 300, mat.grass);
  buildExistingHouses(existing, mat);
  // 邻居地库按现状院坪范围，标高取邻居完成面。木房右侧前面归自家，整片降到自家完成面。
  // 斜坡只留在最外层车道宽度内。
  const cement = mat.courtyardConcrete.clone();
  cement.name = "水泥地库";
  cement.polygonOffset = true;
  cement.polygonOffsetFactor = -2;
  cement.polygonOffsetUnits = -2;
  const floorThick = 150;
  // 18 墙：中线内收半厚 → 外皮贴院坪外沿；水泥铺到墙外皮，截面从墙下露出来。
  const wallCenterInset = GARAGE_OUTER_WALL_CENTER_INSET;
  const wallThick = GARAGE_OUTER_WALL_THICKNESS;
  const wallHalf = wallThick / 2;
  const floorOuterInset = wallCenterInset - wallHalf; // 0，与外皮齐
  const floorFrontOuter = contourSection(insetContour(courtyardFront, floorOuterInset), 0, site.width);
  slab(garage, [[0, 0], [site.width, 0], ...floorFrontOuter.slice().reverse()], site.garageFloor, floorThick, cement)
    .name = "自家地库地面";
  // 主楼外伸段已在上方院坪地库地面内；不再向屋内另铺地库板（避免叠面闪动）。
  const woodFront = surroundings.sideHouse.z;
  const lane = outerLaneDepth();
  const yardWest = yard.x;
  // 邻居／斜坡段：水泥外皮与墙外皮齐平（墙中线 yard.z+半厚，外皮贴外沿）。
  const wallCenterZ = yard.z + wallCenterInset;
  const outerZ = wallCenterZ - wallHalf;
  if (yardWest > site.width && woodFront > outerZ + lane) {
    slab(
      garage,
      rect(site.width, outerZ + lane, yardWest - site.width, woodFront - outerZ - lane),
      site.garageFloor,
      floorThick,
      cement,
    ).name = "木房右侧前自家地库";
  }
  if (surroundings.road.x > yardWest && woodFront > outerZ + lane) {
    slab(
      garage,
      rect(yardWest, outerZ + lane, surroundings.road.x - yardWest, woodFront - outerZ - lane),
      site.neighborGarageFloor,
      floorThick,
      cement,
    ).name = "邻居地库地面";
  }
  if (surroundings.road.x > yardWest) {
    slab(
      garage,
      rect(yardWest, outerZ, surroundings.road.x - yardWest, lane),
      site.neighborGarageFloor,
      floorThick,
      cement,
    ).name = "邻居外侧车道";
  }
  const rampStart = yardWest;
  const rampEnd = yardWest - 5000;
  inclinedSlab(
    garage,
    rampEnd,
    site.garageFloor,
    rampStart,
    site.neighborGarageFloor,
    outerZ,
    outerZ + lane,
    floorThick,
    cement,
    "外层进车斜坡",
  );
  if (rampEnd > site.width) {
    slab(
      garage,
      rect(site.width, outerZ, rampEnd - site.width, lane),
      site.garageFloor,
      floorThick,
      cement,
    ).name = "自家外侧车道";
  }
  const columns = basementColumns();
  const columnMat = cement.clone();
  columnMat.name = "地库柱";
  for (const column of garageLayout.columns) {
    const [a, , c] = column.footprint;
    box(garage, (a[0] + c[0]) / 2, (column.top + column.bottom) / 2,
      (a[1] + c[1]) / 2, garageLayout.columnWidth, column.top - column.bottom,
      garageLayout.columnWidth, columnMat).name = column.label;
  }
  // 主楼 6 根承重柱（前墙四＋门厅前沿二）柱下独立基础示意；平面尺寸／埋深待地勘核定。
  const footingMat = cement.clone();
  footingMat.name = "柱下独立基础";
  const footingW = Math.max(1200, garageLayout.columnWidth * 3);
  const footingH = 400;
  for (const column of columns.ownColumns.filter((entry) => entry.role === "main")) {
    const posts = [column.inner, ...(column.mid ? [column.mid] : [])];
    for (const [x, z] of posts) {
      box(
        garage,
        x,
        site.garageFloor - footingH / 2,
        z,
        footingW,
        footingH,
        footingW,
        footingMat,
      ).name = "承重柱独立基础";
    }
  }
  addGarageBeams(garage, mat, columns);
  // 自家外沿＋斜坡外侧一整段连续外墙：下沿贴水泥、顶贴楼板底，水泥色，中途不断开。
  const dwarfWall = new THREE.Group();
  dwarfWall.name = "地库外沿连续墙";
  garage.add(dwarfWall);
  const wallCement = cement.clone();
  wallCement.name = "地库外墙水泥";
  // 墙略拉前，避免与外沿土坎共面时输给土面闪绿；水泥地面用更强负偏移仍露截面。
  wallCement.polygonOffset = true;
  wallCement.polygonOffsetFactor = -1;
  wallCement.polygonOffsetUnits = -1;
  if (garageLayout.fullOuterWallPath.length >= 2) {
    addContinuousOuterWall(dwarfWall, garageLayout.fullOuterWallPath, wallThick, wallCement);
  }
  if (garageLayout.partitionWall) {
    const wall = garageLayout.partitionWall;
    const [a, , c] = wall.footprint;
    box(
      garage,
      (a[0] + c[0]) / 2,
      (wall.top + wall.bottom) / 2,
      (a[1] + c[1]) / 2,
      Math.abs(c[0] - a[0]),
      wall.top - wall.bottom,
      Math.abs(c[1] - a[1]),
      wallCement,
    ).name = wall.label;
  }
  // 局部下挖止于自家边界，旁田的原标高不随车库降低。
  slab(
    garage,
    garageLayout.westWall.footprint,
    garageLayout.westWall.top,
    garageLayout.westWall.top - garageLayout.westWall.bottom,
    mat.stone,
  ).name = "地库局部下挖与未挖旁田的交界";
  // 车位停在自家地库东侧（主楼东墙以东）：按院坪弧局部进深夹紧，
  // 车头／车身不得穿出外沿矮墙或落到 Z≥0 实体台地（改东／西进深后仍不穿模）。
  const l9HalfW = 1200;
  const l9HalfD = 2750;
  const xyHalfW = 1050;
  const xyHalfD = 2200;
  const [l9x, l9z] = clampParkedCar(21350, -4000, l9HalfW, l9HalfD);
  const [xyx, xyz] = clampParkedCar(24700, -3600, xyHalfW, xyHalfD);
  const parked = buildL9(mat);
  parked.position.set(l9x, site.garageFloor, l9z);
  garage.add(parked);
  const second = buildXingyuan(mat);
  second.position.set(xyx, site.garageFloor, xyz);
  garage.add(second);
  for (const [x, z, halfW, halfD, name] of [
    [l9x, l9z, l9HalfW, l9HalfD, "理想 L9 Max · 黑"],
    [xyx, xyz, xyHalfW, xyHalfD, "吉利星愿 · 银"],
  ] as [number, number, number, number, string][]) {
    const outline = rect(x - halfW, z - halfD, halfW * 2, halfD * 2);
    const innerFront = insetContour(courtyardFront, 260);
    for (let i = 0; i < outline.length; i++) {
      for (const segment of clipParkingLine(outline[i], outline[(i + 1) % outline.length], innerFront)) {
        line(garage, segment.map(([xx, zz]) => new THREE.Vector3(xx, site.garageFloor + 20, zz)), 0xc8bfa4);
      }
    }
    tag(garage, name, x, -1900, z, "#685b40", 0.7);
  }
  const overlapMat = new THREE.MeshBasicMaterial({
    color: 0xcf964c,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
    forceSinglePass: true,
  });
  slab(overlap, rect(site.main.x, site.main.z, site.main.w, 1000), 35, 25, overlapMat);
  if (!recessedPortico()) slab(overlap, rect(site.portico.x, porticoFrontZ(), site.portico.w, site.portico.projection), 35, 25, overlapMat);
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
  const own = columns.ownColumns;
  if (own[0]) markSpan(0);
  const midOwn = own.findIndex((column) => column.x > 10000 && column.x <= site.width);
  if (midOwn >= 0) markSpan(midOwn);
  const neighborIdx = columns.columns.findIndex((column) => column.domain === "neighbor");
  if (neighborIdx >= 0) markSpan(neighborIdx);
  const bay = own[1];
  if (own[0] && bay) {
    line(
      columnNotes,
      [
        new THREE.Vector3(own[0].x, site.garageFloor + 40, own[0].outer[1]),
        new THREE.Vector3(bay.x, site.garageFloor + 40, bay.outer[1]),
      ],
      0x466a59,
      true,
    );
    tag(
      columnNotes,
      `柱距 ${formatMm(columns.spacing)}`,
      (own[0].x + bay.x) / 2,
      noteY,
      (own[0].outer[1] + bay.outer[1]) / 2 - 800,
      "#ffe566",
      0.62,
      true,
    );
  }
  tag(columnNotes, "外沿柱", 9100, noteY, -6200, "#ffe566", 0.66, true);
  tag(columnNotes, "房前墙下柱", 13300, noteY, -1700, "#ffe566", 0.66, true);
  tag(columnNotes, "两家地库柱梁分开", 25000, -400, -4200, "#ffe566", 0.68, true);
  columnNotes.visible = false;
  proposed.add(deck, neighborDeck, garage, overlap, columnNotes);
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
  const west = Math.min(main.x, annex.x), east = Math.max(main.x + main.w, annex.x + annex.w);
  const laneWest = Math.min(main.x + main.w, annex.x + annex.w), laneEast = Math.max(main.x, annex.x);
  const eave = floors.reduce((sum, floor) => sum + floor.height, 0);
  const side = surroundings.sideHouse;
  const rear = surroundings.rearHouse;
  const front = surroundings.frontHouse;
  const roadside = surroundings.roadsideVilla;
  const roadsideDimensions = new THREE.Group();
  roadsideDimensions.name = "蓝顶邻房位置与朝向估算";
  dimensions.add(roadsideDimensions);
  const eastPoint = roadsideFootprints(roadside).flat().reduce((a, b) => a[0] > b[0] ? a : b);
  span(roadsideDimensions, p(site.sideGap, annex.z, 400), p(site.sideGap, eastPoint[1], 400));
  span(roadsideDimensions, p(site.sideGap, eastPoint[1], 400), p(eastPoint[0], eastPoint[1], 400));
  dim(roadsideDimensions, `西侧场地参考线 · 横向约 ${formatMm(roadside.extensionGap)}`, (site.sideGap + eastPoint[0]) / 2, 1800, eastPoint[1] - 700, 0.7);
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
  dim(dimensions, `后二层近田 +${formatMm(surroundings.rearSecond.y)} · 估算`, rear.x - 800, surroundings.rearSecond.y + 1300, rear.z + 2000, 0.7);
  dim(dimensions, "后方地面接DEM · 近场坡形估算", 8000, groundHeight(8000, 32200) + 1300, 32200, 0.7);
  dim(dimensions, `道路东侧近田 +${formatMm(surroundings.leftPlatform.y)} · 估算`, surroundings.leftPlatform.x + 500, surroundings.leftPlatform.y + 1400, 0, 0.7);
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
  dim(scheme, `主楼 ${formatMm(main.w)}×${formatMm(main.d)}`, main.x + main.w / 2, eave + 3600, 1500, 0.82);
  dim(scheme, `层高 ${floors.map((floor) => formatMm(floor.height)).join(" / ")}`, 4200, 5800, 9600, 0.74);
  span(scheme, p(main.x + main.w - 200, main.z + main.d, 300), p(main.x + main.w - 200, main.z + main.d, eave));
  dim(scheme, `檐口 ${formatMm(eave)}`, 18800, eave + 2600, 10600, 0.7);
  span(scheme, p(annex.x, -3500, 400), p(annex.x + annex.w, -3500, 400));
  dim(scheme, `辅楼 ${formatMm(annex.w)}×${formatMm(annex.d)} · 高 ${formatMm(annex.height)}`, annex.x + annex.w / 2, annex.height + 1600, 4000, 0.72);
  span(scheme, p(east, 6000, 400), p(site.width, 6000, 400));
  dim(scheme, `东侧 ${formatMm(site.width - east)}`, (east + site.width) / 2, 2200, 7200, 0.64);
  span(scheme, p(0, 3000, 400), p(west, 3000, 400));
  dim(scheme, `西侧 ${formatMm(site.sideGap)}`, 400, 2200, 1400, 0.64);
  span(scheme, p(Math.min(annex.x + annex.w, main.x + main.w), 5000, 400), p(Math.max(annex.x, main.x), 5000, 400));
  dim(scheme, `子孙道 ${formatMm(site.lane)}`, (laneWest + laneEast) / 2, 2500, 6200, 0.68);
  if (site.setback > 0) span(scheme, p(10000, main.z, 8400), p(10000, main.z + site.setback, 8400));
  dim(scheme, site.setback > 0 ? `三楼北退 ${formatMm(site.setback)}` : "三楼不内退 · 前墙齐平", 8600, 7600, -2600, 0.68);
  dim(scheme, `屋后留 ${formatMm(site.rearGap)}`, 17400, 3600, 9200, 0.68);
  if (!recessedPortico()) dim(scheme, `凸出式门厅 ${formatMm(site.portico.w)}×${formatMm(site.portico.projection)} · 计入首层合计`, site.portico.x + site.portico.w / 2, 3400, -5400, 0.72);
  dim(scheme, `二楼前檐 ${formatMm(site.secondFrontEave)} · 主楼顶檐 ${formatMm(site.thirdEave)} · 辅楼顶檐 ${formatMm(site.eave)}`, 17600, 4200, -4600, 0.68);
  dim(scheme, "前通道约 2000", 2800, 1600, -2500, 0.66);
  dim(scheme, `侧道 ${formatMm(site.sideGap)}`, 450, 1800, 6400, 0.64);
  dim(scheme, `自家地库 ${formatMm(site.garageFloor)} · 净高 ${formatMm(site.garageClear)}`, 16200, 2000, -7600, 0.7);
  dim(scheme, `邻居地库 ${formatMm(site.neighborGarageFloor)} · 梁下净高 ${formatMm(site.neighborBeamClear)} · 平接 ${formatMm(site.neighborBeamReach)}`, 25000, site.neighborGarageFloor + 1600, -5200, 0.7);
  dim(scheme, `右侧上田靠屋前伸 ${formatMm(surroundings.rightTerraceAdvance)}`, -4200, 1500, 2200, 0.68);
  span(scheme, p(main.x, main.z, 350), p(main.x, main.z + main.d, 350));
  dim(scheme, `进深 ${formatMm(main.d)}`, 4600, 4200, -1200, 0.68);
  for (const x of [main.x + main.w, main.x + main.w / 2, main.x]) {
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
    distantTerrain,
  };
}

/** 车位线只画在弧形矮墙的内侧，按田坎采样点和真实交点裁剪。 */
/**
 * 停车位：车头朝南（−Z）。按院坪弧在车身宽度内的最北外沿夹紧，
 * 整车落在外沿矮墙／弧边以北、Z=0 台地以南、主楼以东、邻界分隔以西。
 */
export function clampParkedCar(
  preferX: number,
  preferZ: number,
  halfW: number,
  halfD: number,
  margin = 300,
): [number, number] {
  const yardWest = surroundings.neighborYard.x;
  const mainEast = site.main.x + site.main.w;
  const minX = mainEast + halfW + margin;
  const maxX = yardWest - halfW - margin - GARAGE_OUTER_WALL_THICKNESS;
  // 外沿内侧（过矮墙厚度），车头不得越过。
  const clearFront = insetContour(
    courtyardFront,
    GARAGE_OUTER_WALL_CENTER_INSET + GARAGE_OUTER_WALL_THICKNESS + 40,
  );
  const southEdgeAt = (x: number) => {
    const xs = [x - halfW, x, x + halfW];
    return Math.max(
      ...xs.map((sx) => {
        if (sx <= site.width) return contourAt(clearFront, Math.max(0, Math.min(site.width, sx)));
        // 自家东界以东仍按邻界外沿（邻院西界／进车带），避免车头伸进邻居前坪。
        return surroundings.neighborYard.z + GARAGE_OUTER_WALL_CENTER_INSET + GARAGE_OUTER_WALL_THICKNESS;
      }),
    );
  };
  // 北界：整车留在院坪开挖侧（南保险杠以南不超过 Z=0 台地）。
  const maxZ = -margin - halfD;
  const fits = (x: number) => southEdgeAt(x) + halfD + margin <= maxZ + 1;

  let x = Math.min(maxX, Math.max(minX, preferX));
  if (!fits(x)) {
    // 东侧变浅时向西找仍够停的进深；找不到则停在最浅可夹位置。
    let found = x;
    for (let tx = x; tx >= minX; tx -= 200) {
      if (fits(tx)) {
        found = tx;
        break;
      }
    }
    x = found;
  }
  const minZ = southEdgeAt(x) + halfD + margin;
  let z = Math.min(maxZ, Math.max(minZ, preferZ));
  if (minZ > maxZ) {
    // 进深不够整车：宁可贴齐外沿内侧，也不穿出弧边／矮墙。
    z = minZ;
  }
  return [Math.round(x), Math.round(z)];
}

export function clipParkingLine(a: Point, b: Point, front: Point[]): Point[][] {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const cuts = [0, 1, ...(dx === 0 ? [] : front.map(([x]) => (x - a[0]) / dx).filter((t) => t > 0 && t < 1))].sort((x, y) => x - y);
  const point = (t: number): Point => [a[0] + dx * t, a[1] + dz * t];
  const distance = (t: number) => { const p = point(t); return p[1] - contourAt(front, p[0]); };
  const result: Point[][] = [];
  for (let i = 1; i < cuts.length; i++) {
    let start = cuts[i - 1], end = cuts[i];
    const da = distance(start), db = distance(end);
    if (da < 0 && db < 0) continue;
    if (da * db < 0) {
      const crossing = start + (end - start) * da / (da - db);
      if (da < 0) start = crossing; else end = crossing;
    }
    if (end - start > 1e-9) result.push([point(start), point(end)]);
  }
  return result;
}

/** 梁端停在楼板边缘内侧这段距离，挑出支撑楼板。 */
const BEAM_EDGE_STOP = 400;

/**
 * 柱间梁：弧形外沿走边梁（贴弧折线），房前横梁与纵梁仍走柱网。
 * 梁顶贴楼板底、梁底贴柱顶；外沿端头距板边 ≥400，不得穿出弧边。
 * 真实弧形地库常见做法：边柱沿弧、边梁随弧，纵梁收到边柱／板边内侧。
 */
function addGarageBeams(
  parent: THREE.Object3D,
  mat: Mats,
  columns: ReturnType<typeof basementColumns>,
) {
  const beams = new THREE.Group();
  beams.name = "地库柱间梁";
  parent.add(beams);
  const beamWidth = Math.max(200, site.garageBeamWidth || 350);
  const beamMat = mat.courtyardConcrete.clone();
  beamMat.name = "地库梁";
  beamMat.onBeforeCompile = () => {};
  beamMat.customProgramCacheKey = () => "garage-beam-flush-slab";
  beamMat.polygonOffset = true;
  beamMat.polygonOffsetFactor = 2;
  beamMat.polygonOffsetUnits = 2;
  /** 沿平面任意方向的梁段（绕 Y 旋转）：柱心到柱心的直梁。 */
  const spanBeam = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    label: string,
  ) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const length = Math.hypot(dx, dz);
    if (length < 100) return;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const soffit = beamSoffitAt(mx);
    const top = slabSoffitAt(mx);
    const depth = top - soffit;
    if (depth < 80) return;
    const mesh = box(beams, mx, (soffit + top) / 2, mz, length, depth, beamWidth, beamMat);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.name = label;
  };
  const addOwnGrid = () => {
    const byX = [...columns.ownColumns].sort((a, b) => a.x - b.x);
    if (!byX.length) return;
    const yard = surroundings.neighborYard;
    const first = byX[0], last = byX.at(-1)!;
    const xTip0 = BEAM_EDGE_STOP;
    // 东端接到分界墙中线，覆盖边柱柱头；其余外沿仍按板边退距收头。
    const xTip1 = yard.x;
    const arcEdge = insetContour(courtyardFront, columns.outerInset);

    type Post = { x: number; z: number; row: "outer" | "mid" | "inner"; axis: number };
    const posts: Post[] = [];
    const colW = Math.max(300, site.garageColumnSize || 400);
    for (const [axis, column] of byX.entries()) {
      const samePost =
        Math.hypot(column.outer[0] - column.inner[0], column.outer[1] - column.inner[1]) < colW * 0.5;
      if (samePost) {
        // 院坪极浅轴只落一根柱，避免外沿／里侧重叠。
        posts.push({ x: column.inner[0], z: column.inner[1], row: "inner", axis });
        continue;
      }
      posts.push({ x: column.outer[0], z: column.outer[1], row: "outer", axis });
      if (column.mid) posts.push({ x: column.mid[0], z: column.mid[1], row: "mid", axis });
      posts.push({ x: column.inner[0], z: column.inner[1], row: "inner", axis });
    }

    // 1) 外沿横梁：按 X 顺序柱心直段（贴弧折线），含东西挑出。
    const outers = posts.filter((p) => p.row === "outer").sort((a, b) => a.x - b.x);
    if (outers.length && outers[0].x - xTip0 > 50) {
      spanBeam(xTip0, contourAt(arcEdge, xTip0), outers[0].x, outers[0].z, "自家外沿横梁西挑");
    }
    for (let i = 1; i < outers.length; i++) {
      spanBeam(outers[i - 1].x, outers[i - 1].z, outers[i].x, outers[i].z, `自家外沿横梁 ${i}`);
    }
    if (outers.length && xTip1 - outers.at(-1)!.x > 50) {
      spanBeam(outers.at(-1)!.x, outers.at(-1)!.z, xTip1, outers.at(-1)!.z, "自家外沿横梁东挑");
    }

    // 2) 同标高横梁：凡同一排（门厅／辅楼前墙／主楼前墙）相邻柱必有梁，不漏跨。
    const rowPosts = posts.filter((p) => p.row !== "outer");
    const zKeys = [...new Set(rowPosts.map((p) => Math.round(p.z / 50) * 50))].sort((a, b) => a - b);
    const westTipZ = first.inner[1];
    const eastTipZ = last.inner[1];
    for (const zKey of zKeys) {
      const line = rowPosts
        .filter((p) => Math.abs(p.z - zKey) <= 50)
        .sort((a, b) => a.x - b.x);
      if (line.length < 1) continue;
      const z = line[0].z;
      const label = Math.abs(z - annexColumnInnerZ()) < 80
        ? "辅楼前院坪"
        : line.some((p) => p.row === "mid")
          ? "门厅前沿"
          : "主楼房前";
      // 西挑只接最西侧房前排（辅楼），东挑只接最东侧房前排，避免门厅排误挑到邻界。
      if (Math.abs(z - westTipZ) <= 50 && line[0].x - xTip0 > 50) {
        spanBeam(xTip0, z, line[0].x, z, `自家${label}横梁西挑`);
      }
      for (let i = 1; i < line.length; i++) {
        spanBeam(line[i - 1].x, z, line[i].x, z, `自家${label}横梁 ${i}`);
      }
      if (Math.abs(z - eastTipZ) <= 50 && xTip1 - line.at(-1)!.x > 50) {
        spanBeam(line.at(-1)!.x, z, xTip1, z, `自家${label}横梁东挑`);
      }
    }

    // 3) 纵梁：同一轴上按 Z 从南到北，相邻柱位点必有梁（外沿→门厅→前墙）。
    for (const [axis, column] of byX.entries()) {
      const stack = posts
        .filter((p) => p.axis === axis)
        .sort((a, b) => a.z - b.z);
      for (let i = 1; i < stack.length; i++) {
        spanBeam(
          stack[i - 1].x, stack[i - 1].z,
          stack[i].x, stack[i].z,
          `自家纵梁 C${axis + 1}-${i}`,
        );
      }
    }
  };
  const addNeighborGrid = () => {
    const byX = [...columns.neighborColumns].sort((a, b) => a.x - b.x);
    if (!byX.length) return;
    const yard = surroundings.neighborYard;
    const xTip0 = yard.x + BEAM_EDGE_STOP;
    const xTip1 = surroundings.road.x - BEAM_EDGE_STOP;
    const first = byX[0], last = byX.at(-1)!;
    if (first.x - xTip0 > 50) {
      spanBeam(xTip0, first.outer[1], first.outer[0], first.outer[1], "邻居外沿横梁西挑");
    }
    for (let i = 1; i < byX.length; i++) {
      const a = byX[i - 1], b = byX[i];
      spanBeam(a.outer[0], a.outer[1], b.outer[0], b.outer[1], `邻居外沿横梁 ${i}`);
    }
    if (xTip1 - last.x > 50) {
      spanBeam(last.outer[0], last.outer[1], xTip1, last.outer[1], "邻居外沿横梁东挑");
    }
    if (first.x - xTip0 > 50) {
      spanBeam(xTip0, first.inner[1], first.inner[0], first.inner[1], "邻居房前横梁西挑");
    }
    for (let i = 1; i < byX.length; i++) {
      const a = byX[i - 1], b = byX[i];
      spanBeam(a.inner[0], a.inner[1], b.inner[0], b.inner[1], `邻居房前横梁 ${i}`);
    }
    if (xTip1 - last.x > 50) {
      spanBeam(last.inner[0], last.inner[1], xTip1, last.inner[1], "邻居房前横梁东挑");
    }
    for (const [i, column] of byX.entries()) {
      // 外侧纵梁越过外沿柱向院坪前缘悬挑，柱中心至梁端 2000。
      spanBeam(
        column.outer[0], column.outer[1] - 2000,
        column.inner[0], column.inner[1],
        `邻居纵梁 C${i + 1}`,
      );
    }
  };
  addOwnGrid();
  addNeighborGrid();
}

/** 地库外沿矮墙高度（完成面起）。非通高封闭，只改水泥色。 */
const GARAGE_OUTER_WALL_HEIGHT = 1040;

/**
 * 地库外沿连续矮墙：自家水平段与斜坡段同一张索引网格，共享顶点、不画东端封板。
 * 下沿略嵌入水泥完成面（含斜坡），顶面平行抬高固定矮墙高；厚度沿南北偏移。
 * 不画底面，避免与水泥顶共面闪烁；外皮略收进，避免与土坎立面共面闪绿。
 */
function addContinuousOuterWall(
  parent: THREE.Object3D,
  path: Point[],
  thickness: number,
  material: THREE.Material,
) {
  const cleaned: Point[] = [];
  for (const point of path) {
    const prev = cleaned.at(-1);
    if (!prev || Math.hypot(point[0] - prev[0], point[1] - prev[1]) > 15) cleaned.push(point);
  }
  if (cleaned.length < 2) return;
  const lengths = [0];
  for (let i = 1; i < cleaned.length; i++) {
    lengths.push(
      lengths[i - 1] + Math.hypot(cleaned[i][0] - cleaned[i - 1][0], cleaned[i][1] - cleaned[i - 1][1]),
    );
  }
  const total = lengths.at(-1)!;
  if (total < 50) return;
  const at = (distance: number): Point => {
    const index = lengths.findIndex((length, i) => i > 0 && length >= distance - 1e-6);
    if (index < 0) return cleaned.at(-1)!;
    const span = lengths[index] - lengths[index - 1];
    const t = span < 1e-6 ? 0 : (distance - lengths[index - 1]) / span;
    const a = cleaned[index - 1], b = cleaned[index];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  // 加密采样；斜坡段底标高连续变化时靠共享顶点抹平竖向硬边。
  const samples = Math.max(96, Math.ceil(total / 120));
  const halfT = thickness / 2;
  // 外皮相对理论外沿内收，与土坎立面错开，消除斜坡段闪绿。
  const outerInset = 25;
  // 下沿嵌入水泥，封住接缝且不必再画底面。
  const embed = 30;
  const positions: number[] = [];
  const indices: number[] = [];
  // 每站 4 顶点：外底、外顶、内顶、内底。相邻站共享，避免每段独立复制出竖缝。
  for (let i = 0; i <= samples; i++) {
    const distance = (total * i) / samples;
    const [x, z] = at(distance);
    const floor = basementFloorY(x, z);
    const bottom = floor - embed;
    const top = floor + GARAGE_OUTER_WALL_HEIGHT;
    const oz = z - halfT + outerInset;
    const iz = z + halfT;
    positions.push(x, bottom, oz, x, top, oz, x, top, iz, x, bottom, iz);
  }
  const ring = (i: number) => i * 4;
  for (let i = 0; i < samples; i++) {
    const a = ring(i);
    const b = ring(i + 1);
    // 外立面
    indices.push(a, b, b + 1, a, b + 1, a + 1);
    // 内立面
    indices.push(a + 3, a + 2, b + 2, a + 3, b + 2, b + 3);
    // 顶面
    indices.push(a + 1, b + 1, b + 2, a + 1, b + 2, a + 2);
    // 底面不画：贴在水泥里，画了会与水泥顶共面闪烁。
  }
  // 西端封板保留；东端（斜坡起点／邻界）不封，避免模型上出现明显分割线。
  {
    const a = ring(0);
    indices.push(a, a + 1, a + 2, a, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "地库外沿连续矮墙";
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
}

function inclinedSlab(
  parent: THREE.Object3D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z0: number,
  z1: number,
  thick: number,
  material: THREE.Material,
  name: string,
) {
  if (x1 - x0 < 50 || z1 - z0 < 50) return;
  const top = (x: number, y: number, z: number) => [x, y, z];
  const bot = (x: number, y: number, z: number) => [x, y - thick, z];
  const vertices: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    vertices.push(...a, ...c, ...b, ...a, ...d, ...c);
  };
  quad(top(x0, y0, z0), top(x1, y1, z0), top(x1, y1, z1), top(x0, y0, z1));
  quad(bot(x0, y0, z1), bot(x1, y1, z1), bot(x1, y1, z0), bot(x0, y0, z0));
  quad(top(x0, y0, z0), top(x0, y0, z1), bot(x0, y0, z1), bot(x0, y0, z0));
  quad(top(x1, y1, z1), top(x1, y1, z0), bot(x1, y1, z0), bot(x1, y1, z1));
  quad(top(x0, y0, z1), top(x1, y1, z1), bot(x1, y1, z1), bot(x0, y0, z1));
  quad(top(x1, y1, z0), top(x0, y0, z0), bot(x0, y0, z0), bot(x1, y1, z0));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
}

export function makeRamp(
  parent: THREE.Group,
  _mat: Mats,
  _roadY: number,
  _length: number,
) {
  // 进库斜坡做在地库最外层车道上，见上方地面。
  const g = new THREE.Group();
  g.name = "地库交界平接";
  parent.add(g);
  return g;
}
