import { site, floors, frontFieldLevel, courtyardFront, roadsideVilla, contains, type Point } from "./data.ts";
import { contourAt, contourSection, insetContour, smoothContour } from "./contours.ts";
import { placeRoadsideVilla, roadsideToWorld, roadsideFootprints } from "./roadside-villa-layout.ts";
import { defaultTerrainHorizon, modelPointToTerrain, terrainHeightM, type TerrainHorizonData, type TerrainBoundsMm } from "./terrain-elevation.ts";
import { easternPhotoHouses, easternPhotoContours, northCreekSection, northernPhotoWatercourses, distanceToPhotoPath } from "./photo-context-layout.ts";

// 全部左右关系按站在北侧、面对房子描述：画面左侧为 X 增大。
// 对齐关系来自用户；周边房屋尺寸、未测标高和田坎折点仍是航拍估算。
// 自家旧木房前墙。左侧邻居木房前墙与它对齐；邻居进深更大，多出的长度在后墙。都是口述，不是测绘。
const alignedWoodFront = 1100;
const sideHouse = { x: 21750, z: alignedWoodFront, w: 12000, d: 8800, y: 0, h: 5300 };
const leftEdge = sideHouse.x + sideHouse.w;
const rearRight = site.main.x + site.main.w / 2;
const frontRight = site.main.x + (site.main.w * 2) / 3;
const frontHouseY = frontFieldLevel - site.frontHouseDrop;
// 屋脊原先比自家一层顶高约 2 米。整栋再降 1.5 米后，约高 0.5 米。口述调整，不是测绘。
// 航拍里人字坡很平，起坡只留约 0.9 米，是照片估算。
const frontRoofRise = 900;
const frontRidgeDrop = 1500;
const frontRidge = floors[0].y + floors[0].height + 2000 - frontRidgeDrop;
const frontFloorHeight = (frontRidge - frontRoofRise - frontHouseY) / 2;
// 进深原 7.5 米。按航拍向北加 2 米，后墙和屋后 0.4 米田外沿不动。
const frontHouseDepth = 9500;
const frontDepthAdded = frontHouseDepth - 7500;
// 与 neighborBayPlan("side") 相同：三开间、堂屋居中且更宽。右沿是口述大约位置，不是测绘。
const sideHallScale = 1.45;
const sideOrdinary = sideHouse.w / (2 + sideHallScale);
const sideHallCenter =
  sideHouse.x + sideHouse.w - sideOrdinary - (sideOrdinary * sideHallScale) / 2;
const neighborYardWest = sideHallCenter - 500;
const neighborFrontZ = courtyardFront.at(-1)![1];
// 马路东侧高地比邻居院坪外沿再向房内收。4 米是口述，不是测绘。
const leftPlatformInset = 4000;
const leftPlatformFront = neighborFrontZ + leftPlatformInset;
const frontSpan = leftEdge - frontRight;
// 屋后田原约1米。宽度按5/2压缩后为0.4米；房子朝道路反方向退0.6米，田埂外沿不动。
const frontRearTerrace = 1000 * 2 / 5;
const frontHouseSetback = 1000 - frontRearTerrace;
// 保留上田靠屋端向房前伸出 2.5 米的口述定位；远田弧线按东西两侧航拍另行描画。
const rightTerraceAdvance = 2500;
// 左侧马路连续上坡，接到屋后第一层与东侧大平地的同一标高后停止，不再往南爬。
const roadFrontZ = -26500;
const sharedPlaneY = site.rearField;
let roadBackZ = site.oldDepth;
let roadLowY = frontHouseY;
function roadGrade(z: number): number {
  const t = Math.min(1, Math.max(0, (z - roadFrontZ) / (roadBackZ - roadFrontZ)));
  return roadLowY + t * (sharedPlaneY - roadLowY);
}

export const surroundings = {
  sideHouse,
  roadsideVilla,
  rearHouse: {
    x: rearRight,
    z: 20000,
    w: leftEdge - rearRight,
    d: 8000,
    y: 5000,
    h: 5200,
  },
  frontHouse: {
    x: frontRight,
    z: -23750 + frontHouseSetback - frontDepthAdded,
    w: leftEdge - frontRight,
    d: frontHouseDepth,
    y: frontHouseY,
    floorHeight: frontFloorHeight,
    floors: 2,
    roofRise: frontRoofRise,
    // 一层与两层的交接对齐邻居院坪右沿，不再用三分之一面宽的照片比例。
    wingRatio: (leftEdge - neighborYardWest) / frontSpan,
  },
  neighborYard: {
    x: neighborYardWest,
    z: neighborFrontZ,
    w: leftEdge - neighborYardWest,
    d: sideHouse.z - neighborFrontZ,
  },
  road: {
    x: leftEdge,
    w: 3400,
    front: roadFrontZ,
    back: roadBackZ,
    // 连续纵坡在接入中心的高度，只作坡道初值，不是实测路面标高。
    entryY: Math.round(roadGrade(-7350)),
  },
  // 东侧大平地与屋后第一层梯田同一标高。2.5 米沿用屋后田，不是新的测绘。
  leftPlatform: { x: leftEdge + 3400, front: leftPlatformFront, back: site.oldDepth, y: sharedPlaneY },
  rearFirst: { front: site.oldDepth, back: 16200, y: site.rearField },
  rearSecond: { front: 16200, back: 29500, y: 5000 },
  rearThird: { front: 29500, back: 36000, y: 6800 },
  rightTerraceAdvance,
  rightStep: site.annex.z + (site.annex.d * 2) / 3 - rightTerraceAdvance,
  extent: { left: -32000, right: 92000, front: -72000, back: 36000 },
};

function roadsideGroundFootprint(): Point[] {
  const h = surroundings.roadsideVilla;
  const left = -h.w / 2 - 275, right = h.w / 2 + h.wing.w + 275;
  const front = -h.d / 2 - h.portico.d - 1125, back = h.d / 2 + 175;
  return [[left, front], [right, front], [right, back], [left, back]]
    .map(([x, z]) => roadsideToWorld(h, x, z));
}

/** 保留宅院、邻房和近处道路。外围地面交给DEM，随尺寸调整时仍容纳邻房。 */
export function handmadeTerrainBounds(): TerrainBoundsMm {
  const neighbor = roadsideFootprints(roadsideVilla).flat();
  const yard = roadsideGroundFootprint();
  return {
    // 让门厅／前坪与DEM之间留足过渡空间，外沿按2m显示网格取整。
    left: Math.floor(Math.min(-50000, ...yard.map(point => point[0] - 6000)) / 2000) * 2000,
    right: Math.max(128000, surroundings.road.x + 90000, site.width + 3000),
    front: Math.min(-96000, ...neighbor.map(point => point[1] - 3500)),
    back: Math.max(60000, surroundings.rearHouse.z + surroundings.rearHouse.d + 32000),
  };
}

// 记录初始现状邻房，避免调新方案参数时改写海拔配准控制点。
const elevationControlHouses = [
  { x: 0, z: 200, w: 8800, d: 9800, y: 0 },
  { x: 8800, z: 1100, w: 12300, d: 7900, y: 0 },
  { ...surroundings.sideHouse }, { ...surroundings.rearHouse }, { ...surroundings.frontHouse },
];
const elevationControlBlue = { ...surroundings.roadsideVilla };

/** 用现状旧房与邻房的落地点估算统一海拔，结果仍需现场测量标定。 */
export function fitTerrainElevation(data: TerrainHorizonData): TerrainHorizonData {
  if (!data.reference || data.reference.elevationMeasured) return data;
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  // 旧房尺寸固定，地理基准不随新方案主辅楼尺寸变化。
  const previousOffset = data.reference.courtyardElevationM - data.siteElevM;
  const difference = (x: number, z: number, y: number) => {
    const point = modelPointToTerrain(x, 0, z, data);
    const height = terrainHeightM(point.eastM, point.northM, data);
    if (height == null) throw new Error("DEM未覆盖高程配准点");
    return height + previousOffset - y / 1000;
  };
  const offsets = elevationControlHouses.map(house => median([0, 0.5, 1].flatMap(u =>
    [0, 0.5, 1].map(v => difference(house.x + house.w * u, house.z + house.d * v, house.y)))));
  const blue = elevationControlBlue;
  offsets.push(median([0, 0.5, 1].flatMap(u => [0, 0.5, 1].map(v => {
    const [x, z] = roadsideToWorld(blue, (u - 0.5) * blue.w, (v - 0.5) * blue.d);
    return difference(x, z, blue.y);
  }))));
  const offsetM = Math.round(median(offsets) * 1000) / 1000;
  return { ...data, reference: { ...data.reference,
    courtyardElevationM: data.siteElevM + offsetM,
    elevationFit: { method: "现状六栋房基各九点DEM差值的分组中位数，待实测", offsetM,
      residualM: offsets.map(offset => Math.round((offset - offsetM) * 1000) / 1000) },
  } };
}

export const TERRAIN_JOIN_WIDTH_MM = 20000;

export function terrainAnalysisData(data = defaultTerrainHorizon): TerrainHorizonData {
  const bounds = handmadeTerrainBounds();
  const margin = TERRAIN_JOIN_WIDTH_MM;
  return { ...data, localModelBoundsMm: {
    left: bounds.left - margin, right: bounds.right + margin,
    front: bounds.front - margin, back: bounds.back + margin,
  } };
}

// 俯拍里主马路在蓝顶房前向西南转弯。保留东侧 T 形路口，只有西段随邻房转向。
// 道路宽度与曲线都是照片估算；与上坡支路不同，这一段与前方砖房首层同高。
// 路心贴近门厅前坪外沿（约 2.1 m），避免房前露出大块空白田面把路面“吃掉”。
const villageRoadWidth = 3500;

function buildVillageRoadCenter(): Point[] {
  const villageRoadFront = -roadsideVilla.d / 2 - roadsideVilla.portico.d - 5100;
  return smoothContour([
    [surroundings.extent.left, -14500],
    roadsideToWorld(roadsideVilla, -roadsideVilla.w / 2 - 1200, villageRoadFront),
    roadsideToWorld(roadsideVilla, -roadsideVilla.w / 2, villageRoadFront),
    roadsideToWorld(roadsideVilla, 2000, villageRoadFront),
    roadsideToWorld(roadsideVilla, roadsideVilla.w / 2 + roadsideVilla.wing.w, villageRoadFront),
    roadsideToWorld(roadsideVilla, roadsideVilla.w / 2 + roadsideVilla.wing.w + 1500, villageRoadFront - 400),
    [-5000, -29250], [2000, -28250], [20000, -28250], [40000, -26500], [55000, -20000], [65000, -13000],
    [surroundings.road.x + 46000, -7250], [surroundings.extent.right, -6500],
  ], 450);
}

function buildVillageRoadEdges(center: Point[]) {
  const front: Point[] = [], back: Point[] = [];
  for (let i = 0; i < center.length; i++) {
    const p = center[i];
    const a = center[Math.max(0, i - 1)], b = center[Math.min(center.length - 1, i + 1)];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const end = i === 0 || i === center.length - 1;
    const nx = end ? 0 : -(b[1] - a[1]) / length;
    const nz = end ? 1 : (b[0] - a[0]) / length;
    front.push([p[0] - nx * villageRoadWidth / 2, p[1] - nz * villageRoadWidth / 2]);
    back.push([p[0] + nx * villageRoadWidth / 2, p[1] + nz * villageRoadWidth / 2]);
  }
  return { front, back, outline: [...front, ...back.slice().reverse()] };
}

export const villageRoadCenter = buildVillageRoadCenter();
export const villageRoadEdges = buildVillageRoadEdges(villageRoadCenter);

/** 东段村道随地势升至最东侧木房前，西段沿用既有路面标高。 */
export function villageRoadElevation(x: number) {
  const outer = easternPhotoHouses(surroundings.road.x)[2];
  const from = surroundings.road.x + surroundings.road.w + 2000;
  const t = Math.max(0, Math.min(1, (x - from) / (outer.x + outer.w - from)));
  return surroundings.frontHouse.y + (outer.y - surroundings.frontHouse.y) * t * t * (3 - 2 * t);
}

/** 两溪按北侧照片在蓝顶邻房前桥位附近衔接，桥跨东侧支溪，接入路沿主溪东岸。 */
export function northPhotoLayout() {
  const roadFront = (x: number) => contourAt(villageRoadEdges.front, x);
  // 桥南端接蓝顶房前路，轴向略向东偏，北端接入路再往东，与村道呈树杈而不是直角。
  const southX = surroundings.roadsideVilla.x + 4800;
  const southZ = roadFront(southX) - 900;
  const yaw = 48 * Math.PI / 180;
  const dirX = Math.sin(yaw), dirZ = -Math.cos(yaw);
  let crossDist = 8000;
  for (let i = 0; i < 6; i++) {
    const x = southX + dirX * crossDist;
    const creekZ = northCreekSection(x, roadFront(x), villageRoadElevation(x)).centerZ;
    const rayZ = southZ + dirZ * crossDist;
    crossDist += (creekZ - rayZ) / dirZ;
  }
  const length = crossDist + 6800;
  const northX = southX + dirX * length;
  const northZ = southZ + dirZ * length;
  const bridgeX = southX + dirX * crossDist;
  const dx = northX - southX, dz = northZ - southZ, span = Math.hypot(dx, dz);
  const sideX = dz / span, sideZ = -dx / span;
  const half = 2100;
  const corner = (x: number, z: number, side: number): Point => [x + sideX * side * half, z + sideZ * side * half];
  const [southWest, southEast] = [corner(southX, southZ, -1), corner(southX, southZ, 1)].sort((a, b) => a[0] - b[0]);
  const [northWest, northEast] = [corner(northX, northZ, -1), corner(northX, northZ, 1)].sort((a, b) => a[0] - b[0]);
  const bridge = {
    x: bridgeX, width: 4200, top: surroundings.frontHouse.y + 75,
    // 斜桥四角 Z 不等：startZ／endZ 取最南／最北角，供桥洞范围；南端接路与北端接入另用边线。
    startZ: Math.max(southWest[1], southEast[1]),
    endZ: Math.min(northWest[1], northEast[1]),
    south: [southX, southZ] as Point,
    north: [northX, northZ] as Point,
    southEdge: [southWest, southEast] as Point[],
    northEdge: [northWest, northEast] as Point[],
    deck: [northWest, northEast, southEast, southWest] as Point[],
  };
  // 北端接入从北侧桥沿中点接出，避免中心点落在桥面斜边南侧而与桥面脱节。
  const approach: Point[] = [
    [northX, northZ],
    [northX + 3200, northZ - 9000],
    [northX + 4800, -72000],
  ];
  return { bridge, approach, courses: northernPhotoWatercourses(roadFront, villageRoadElevation, bridgeX) };
}

/** 蓝顶邻房重定位后刷新弯道路心／路缘（原地替换数组，供 groundHeight 与场地重建共用）。 */
export function rebuildVillageRoad() {
  const next = buildVillageRoadCenter();
  replacePoints(villageRoadCenter, next);
  const edges = buildVillageRoadEdges(next);
  replacePoints(villageRoadEdges.front, edges.front);
  replacePoints(villageRoadEdges.back, edges.back);
  replacePoints(villageRoadEdges.outline, edges.outline);
}

/**
 * 邻居木房面宽／进深写入 3D `sideHouse`，并刷新马路东缘、邻院、前后邻房面宽。
 * 木房前墙 Z 仍与自家旧木房对齐（口述），不随参移动。
 */
export function syncNeighborFootprint(width: number, depth: number) {
  sideHouse.w = width;
  sideHouse.d = depth;
  const left = sideHouse.x + sideHouse.w;
  const ordinary = sideHouse.w / (2 + sideHallScale);
  const hallCenter = sideHouse.x + sideHouse.w - ordinary - (ordinary * sideHallScale) / 2;
  const yardWest = hallCenter - 500;
  surroundings.neighborYard.x = yardWest;
  surroundings.neighborYard.w = left - yardWest;
  surroundings.neighborYard.d = sideHouse.z - surroundings.neighborYard.z;
  surroundings.road.x = left;
  surroundings.leftPlatform.x = left + surroundings.road.w;
  surroundings.rearHouse.w = left - surroundings.rearHouse.x;
  surroundings.frontHouse.w = left - surroundings.frontHouse.x;
  const span = surroundings.frontHouse.w;
  if (span > 100) surroundings.frontHouse.wingRatio = (left - yardWest) / span;
}

/** 蓝顶邻房仍以场地西侧余量定位；互换建筑不移动邻房或道路。 */
export function syncRoadsideVillaPlacement() {
  surroundings.frontHouse.y = site.garageFloor - site.frontFieldDrop - site.frontHouseDrop;
  roadLowY = surroundings.frontHouse.y;
  const next = placeRoadsideVilla(
    site.sideGap,
    surroundings.frontHouse.y,
  );
  Object.assign(roadsideVilla, next);
  rebuildVillageRoad();
}

// 2026-10-28：对照西面 DJI 135142 与东面 IMG_5116，西侧两道坎远离房子后
// 向南渐弯，近屋处逐渐放平；消除旧控制点先向北鼓、再向南折回的反弯。
// 控制点是斜向照片估算，靠屋端继续使用院坪／辅楼的同源定位，不是测绘。
const shiftedFar = (z: number) => z - rightTerraceAdvance;

function buildRightTerraceBreak(): Point[] {
  const zAtHouse = surroundings.rightStep;
  return smoothContour([
    [-55000, shiftedFar(21500)], [-44000, shiftedFar(18200)], [-34000, shiftedFar(14400)],
    [-24000, shiftedFar(10600)], [-16000, zAtHouse + 2700],
    [-10000, zAtHouse + 1300], [-6000, zAtHouse + 550],
    [-2400, zAtHouse + 100],
    [0, zAtHouse],
  ]);
}

function buildUnexcavatedFront(): Point[] {
  // 旁田与地库西端接在同一点，往西缓缓抬向南侧，不再在 -12000 处凹下后折回，
  // 也不再把近屋 8 米做成僵直的横线。两级田的宽窄随各自弧线自然变化。
  const garageFrontZ = courtyardFront[0]?.[1] ?? 0;
  return smoothContour([
    [-55000, 15200], [-44000, 11400], [-34000, 6800], [-24000, 2400],
    [-16000, garageFrontZ + 2400], [-10000, garageFrontZ + 2100],
    [-6000, garageFrontZ + 1750], [-2400, garageFrontZ + 900], [0, garageFrontZ],
  ]);
}

function buildFrontLower(): Point[] {
  const lipX = surroundings.frontHouse.x;
  const lipZ = surroundings.frontHouse.z + surroundings.frontHouse.d + frontRearTerrace;
  // 地库下方田块的外沿是向砖房屋后渐收的长弧，不在主楼中部突然折成 S 弯。
  // 西侧和正前方增加过渡长度；东端仍保留砖房屋后 400 的原定位。
  const westZ = -11200;
  const transition = (t: number): Point => [lipX * t, westZ + (lipZ - westZ) * (2 * t - t * t)];
  // 直接拟合原始控制点一次，避免把已采样的局部弧再次拟合而固化急弯。
  return smoothContour([
    [-55000, 9200], [-44000, 5200], [-34000, 600], [-24000, -4200],
    [-16000, -7100], [-8000, -9000], [0, westZ],
    transition(.35), transition(.7), [lipX, lipZ],
    [surroundings.road.x, lipZ],
  ]);
}

function buildSharedFront(): Point[] {
  return [
    ...buildUnexcavatedFront().slice(0, -1),
    ...courtyardFront,
    [surroundings.road.x, surroundings.neighborYard.z] as Point,
  ];
}

function buildRearFirst(): Point[] {
  // 邻居木房屋后这一段与自家屋后田坎同一直线，不在中段外鼓。
  const d = site.oldDepth;
  const w = site.width;
  return smoothContour([
    [-55000, 27200], [-44000, 24000], [-34000, 20200], [-24000, 16400], [-16000, 13600],
    [-8000, 11800], [-3000, 11100], [0, d], [w, d], [33750, d],
    [42000, 11400], [54000, 12600], [66000, 13400], [77000, 14200],
  ]);
}

export const rightTerraceBreak = buildRightTerraceBreak();

export const terraceContours = {
  // 旁田与地库西端相接，三道近景田坎分别按航拍描画。
  sharedFront: buildSharedFront(),
  frontLower: buildFrontLower(),
  // 前坎停在院坪外沿以南约 4 米，远处不再朝北甩过这条线。
  leftPlatform: [] as Point[],
  rearFirst: buildRearFirst(),
  rearSecond: smoothContour([
    [-55000, 33400], [-44000, 30200], [-34000, 26400], [-24000, 22800], [-16000, 20400],
    [-8000, 18900], [0, 18200], [7000, 17700], [13550, 16800], [21000, 16200],
    [28000, 16200], [33750, 16200], [44000, 17200], [56000, 18200], [66000, 19000], [77000, 19600],
  ]),
  rearThird: smoothContour([
    [-55000, 40200], [-44000, 37200], [-34000, 34200], [-24000, 31600], [-14000, 30200],
    [-6000, 29700], [0, 29500], [13550, 29500], [28000, 29500], [33750, 30600],
    [46000, 31600], [60000, 32500], [77000, 33400],
  ]),
  hillFoot: smoothContour([
    [-55000, 47000], [-40000, 43000], [-28000, 40000], [-12000, 37400], [0, 36500],
    [13550, 36000], [28000, 36200], [44000, 38200], [60000, 40000], [77000, 41200],
  ]),
};

function replacePoints(target: Point[], next: Point[]) {
  target.length = 0;
  target.push(...next);
}

function buildLeftPlatformContour(): Point[] {
  const f = surroundings.leftPlatform.front;
  return smoothContour([
    [surroundings.leftPlatform.x, f],
    [44000, f + 350],
    [52000, f + 700],
    [60000, f + 500],
    [68000, f + 200],
    [77000, f],
  ]);
}

/**
 * 院坪外沿／辅楼／oldDepth 变化后刷新：邻居前坪 Z、西侧田坎终点、
 * sharedFront、屋后第一坎自家段、道路尽头。须在 rebuildCourtyardGeometry 之后调用。
 */
export function rebuildTerraceLinkage() {
  const eastZ = courtyardFront.at(-1)?.[1] ?? site.cut.z;
  surroundings.neighborYard.z = eastZ;
  surroundings.neighborYard.d = surroundings.sideHouse.z - eastZ;
  surroundings.rightStep = site.annex.z + (site.annex.d * 2) / 3 - rightTerraceAdvance;
  surroundings.leftPlatform.back = site.oldDepth;
  surroundings.rearFirst.front = site.oldDepth;
  surroundings.leftPlatform.front = eastZ + leftPlatformInset;

  replacePoints(rightTerraceBreak, buildRightTerraceBreak());
  replacePoints(terraceContours.sharedFront, buildSharedFront());
  replacePoints(terraceContours.frontLower, buildFrontLower());
  replacePoints(terraceContours.rearFirst, buildRearFirst());
  replacePoints(terraceContours.leftPlatform, buildLeftPlatformContour());

  roadBackZ = contourAt(terraceContours.rearFirst, surroundings.road.x);
  surroundings.road.back = roadBackZ;
  rebuildRoadStations();
}

function buildRoadStations(): Point[] {
  return Array.from({ length: 29 }, (_, i) => {
    const z = roadFrontZ + ((roadBackZ - roadFrontZ) * i) / 28;
    return [Math.round(z), roadGrade(z)] as Point;
  });
}

export const roadStations: Point[] = [];

function rebuildRoadStations() {
  replacePoints(roadStations, buildRoadStations());
}

rebuildTerraceLinkage();

export function roadHeight(z: number) {
  return roadGrade(z);
}

export type BasementColumn = {
  x: number;
  /** 院坪外沿内侧（楼板边梁下）。 */
  outer: Point;
  /** 房前／前墙线（主楼前墙或辅楼前墙）。 */
  inner: Point;
  /**
   * 门厅前沿承重柱（仅凸出式门厅的 B／C 轴）。
   * 有则纵梁按 外沿→门厅→前墙 两段落柱，对应地上门厅通高柱向下贯通。
   */
  mid?: Point;
  span: number;
  /** 自家与邻居柱网完全分开，梁不跨界。 */
  domain: "own" | "neighbor";
  /** 主楼承重轴优先；其余为两侧板跨／辅楼示意柱。 */
  role: "main" | "side" | "neighbor";
};

/**
 * 地库最里侧对齐参考（开挖北缘）：
 * 辅楼内退段整段（含西侧）下面是实体台地、不悬空 → 地库只挖到台地南缘 Z=0；
 * 其余（主楼及以东）→ 主楼前墙。
 * 柱落在院坪地库内，不得伸进辅楼投影下的实体地基。
 */
export function garageBuildingFrontZ(x: number) {
  const annex = site.annex;
  // 只按辅楼面宽判断（主楼改到西侧时不能从 0 扫到辅楼东缘盖住主楼）。
  if (x >= annex.x - 1 && x <= annex.x + annex.w + 1) return 0;
  return site.main.z;
}

/** 辅楼段地库柱里侧：贴实体台地南缘（Z=0），整柱在院坪地库，不进辅楼地基。 */
export function annexColumnInnerZ() {
  return 0;
}

/** 外沿柱到房前柱的最小进深；过浅则该轴不设柱／纵梁（西端院坪几乎贴前墙时）。 */
const MIN_GARAGE_BAY_DEPTH = 2000;

/** 侧跨补柱与主楼承重轴的最小中心距，避免贴着承重柱挡车／抢位。 */
const MIN_SIDE_CLEAR_FROM_MAIN = 2500;

/**
 * 主楼前墙相对台地南缘（Z=0）的外伸量（mm）。
 * 仅外伸段架空；实体台地不开洞、不向屋内下挖。
 */
export function mainFrontOverhangDepth() {
  return Math.max(0, Math.round(-site.main.z));
}

/**
 * 外伸段下的土基开洞：南起主楼前墙外皮，北至台地南缘 Z=0。
 * 地库地面已由院坪段覆盖，不再另铺；Z≥0 实体台地保持实心。
 */
export function mainFrontGaragePocket(): Point[] {
  const main = site.main;
  const depth = mainFrontOverhangDepth();
  if (depth < 1) return [];
  return rectPoints(main.x, main.z, main.w, depth);
}

/** 实体台地石基／铺装不开洞（旧「屋内下挖」已取消）。 */
export function mainFrontPadHole(): Point[] {
  return [];
}

function rectPoints(x: number, z: number, w: number, d: number): Point[] {
  return [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
}

/**
 * 主楼地库承重轴（与地上门厅／开间一致，优先固定）：
 * A／D＝前墙两角；B／C＝门厅两柱柱心。
 * 凸出式时 B／C 另在门厅前沿落柱（与地上通高柱同轴），前墙线再各一根 → 主楼下共 6 根承重柱。
 */
export function mainGarageStructuralAxes() {
  const main = site.main;
  const porch = site.portico;
  // 与立面包角参考同值：前墙转角内侧 120，柱心贴近包角。
  const axisA = Math.round(main.x + 120);
  const axisD = Math.round(main.x + main.w - 120);
  const axisB = Math.round(porch.x);
  const axisC = Math.round(porch.x + porch.w);
  const wallZ = main.z;
  const porticoZ = site.porticoStyle === "recessed" ? null : wallZ - porch.projection;
  return {
    axisA,
    axisB,
    axisC,
    axisD,
    wallZ,
    porticoZ,
    /** 外伸架空北缘＝台地南缘；不向屋内下挖 */
    pocketNorth: Math.max(0, wallZ),
    /** 前墙一排四根 */
    wallXs: [axisA, axisB, axisC, axisD] as const,
    /** 门厅前沿两根（平齐式无） */
    porticoXs: porticoZ == null ? ([] as number[]) : [axisB, axisC],
  };
}

/**
 * 两家地库独立柱网。
 * 自家：**先固定主楼 6 根承重柱**（前墙 A–D；凸出式另加门厅前沿 B／C），
 * 再在主楼两侧（辅楼前、斜坡／木屋前）按行车净宽补板跨柱；邻居仍左右各两根。
 * 弧形外沿边柱贴弧；纵梁两端落柱，门厅轴为外沿→门厅→前墙两段。
 */
export function basementColumns() {
  const spacing = 4200;
  const outerInset = 550;
  const edgeInset = Math.max(300, site.neighborColumnEdgeInset);
  const outerLane = Math.max(2200, site.neighborBeamReach);
  const columnSize = Math.max(300, site.garageColumnSize || 400);
  const yard = surroundings.neighborYard;
  const ourFront = insetContour(courtyardFront, outerInset);
  // 自家东侧两根边柱外皮贴分界线；邻居柱的退距只作用邻居柱网。
  const lastOwn = yard.x - columnSize / 2;
  const outerZAt = (x: number) => (x <= site.width ? contourAt(ourFront, x) : yard.z + outerInset);
  const axes = mainGarageStructuralAxes();

  const makeOwn = (
    x: number,
    role: "main" | "side",
    opts?: { midZ?: number | null; minBay?: number; innerZ?: number },
  ): BasementColumn | null => {
    const xi = Math.round(x);
    const outerZ = outerZAt(xi);
    const innerZ = opts?.innerZ ?? garageBuildingFrontZ(xi);
    const minBay = opts?.minBay ?? MIN_GARAGE_BAY_DEPTH;
    if (innerZ - outerZ < minBay) return null;
    const midZ = opts?.midZ;
    const mid =
      midZ != null && midZ < innerZ - 100 && midZ > outerZ + 100
        ? ([xi, midZ] as Point)
        : undefined;
    return {
      x: xi,
      outer: [xi, outerZ],
      inner: [xi, innerZ],
      mid,
      span: Math.round(innerZ - outerZ),
      domain: "own",
      role,
    };
  };

  // —— 1. 主楼承重轴（最高优先，位置锁死）——
  const ownColumns: BasementColumn[] = [];
  const mainXs = new Set<number>();
  for (const x of axes.wallXs) {
    const col = makeOwn(x, "main", {
      midZ: axes.porticoXs.includes(x) ? axes.porticoZ : null,
    });
    if (!col) continue;
    ownColumns.push(col);
    mainXs.add(col.x);
  }

  // —— 2. 主楼两侧：以承重边柱为端点等分，间距贴近主楼开间，不密不疏 ——
  // 辅楼内退段下为实体地基：该带内柱里侧贴 Z=0，不进楼底。
  const annexOut = Math.max(350, columnSize / 2);
  const annexInnerZ = annexColumnInnerZ();
  const ANNEX_EDGE_MIN_BAY = Math.max(250, Math.round(columnSize * 0.6));
  const annexOuterInset = Math.min(outerInset, 220);
  const annexOurFront = insetContour(courtyardFront, annexOuterInset);
  const annexOuterZAt = (x: number) => contourAt(annexOurFront, x);
  const makeAnnexOwn = (x: number): BasementColumn | null => {
    const xi = Math.round(x);
    const edge = contourAt(courtyardFront, xi);
    const edgeClear = 200;
    const usable = annexInnerZ - (edge + edgeClear);
    if (usable < columnSize + 50) {
      return {
        x: xi,
        outer: [xi, annexInnerZ],
        inner: [xi, annexInnerZ],
        span: 0,
        domain: "own",
        role: "side",
      };
    }
    let outerZ = annexOuterZAt(xi);
    if (outerZ < edge + edgeClear) outerZ = edge + edgeClear;
    if (annexInnerZ - outerZ < Math.max(ANNEX_EDGE_MIN_BAY, columnSize + 50)) {
      outerZ = annexInnerZ - Math.max(ANNEX_EDGE_MIN_BAY, columnSize + 50);
    }
    if (outerZ < edge + edgeClear) outerZ = edge + edgeClear;
    if (annexInnerZ - outerZ < columnSize + 50) {
      return {
        x: xi,
        outer: [xi, annexInnerZ],
        inner: [xi, annexInnerZ],
        span: 0,
        domain: "own",
        role: "side",
      };
    }
    return {
      x: xi,
      outer: [xi, outerZ],
      inner: [xi, annexInnerZ],
      span: Math.round(annexInnerZ - outerZ),
      domain: "own",
      role: "side",
    };
  };

  /** 两端固定，中间等分；跨度过大则加密开间，目标约 spacing（与主楼开间同量级）。 */
  const evenSideXs = (fromX: number, toX: number): number[] => {
    const span = toX - fromX;
    if (span < spacing * 0.55) return [];
    let nBays = Math.max(1, Math.round(span / spacing));
    const maxBay = spacing * 1.35;
    while (span / nBays > maxBay) nBays += 1;
    const xs: number[] = [];
    for (let i = 0; i <= nBays; i++) xs.push(Math.round(fromX + (span * i) / nBays));
    return xs;
  };

  // 西：辅楼西墙外皮 → 主楼 A 轴；东：主楼 D 轴 → 邻界内侧。端点上的承重柱已有，只落侧柱。
  const westTip = Math.round(site.annex.x - annexOut);
  const eastTip = Math.round(lastOwn);
  const westGrid = evenSideXs(westTip, axes.axisA);
  const eastGrid = evenSideXs(axes.axisD, eastTip);
  for (const x of [...westGrid, ...eastGrid]) {
    if (mainXs.has(x) || ownColumns.some((c) => Math.abs(c.x - x) < 100)) continue;
    // 紧贴承重轴的等分端点跳过（已是主柱）；其余须保持净距。
    if ([...mainXs].some((mx) => Math.abs(x - mx) < MIN_SIDE_CLEAR_FROM_MAIN * 0.85)) continue;
    const inAnnexFrontBand =
      x >= site.annex.x - annexOut - 1 && x <= site.annex.x + site.annex.w + annexOut + 1;
    const col = inAnnexFrontBand ? makeAnnexOwn(x) : makeOwn(x, "side");
    if (col) ownColumns.push(col);
  }
  ownColumns.sort((a, b) => a.x - b.x);

  const westX = Math.round(yard.x + edgeInset);
  const eastX = Math.round(surroundings.road.x - edgeInset);
  const neighborOuterZ = yard.z + outerLane;
  const neighborInnerZ = surroundings.sideHouse.z - edgeInset;
  const neighborColumns: BasementColumn[] = [westX, eastX].map((x) => ({
    x,
    outer: [x, neighborOuterZ] as Point,
    inner: [x, neighborInnerZ] as Point,
    span: Math.round(Math.abs(neighborInnerZ - neighborOuterZ)),
    domain: "neighbor" as const,
    role: "neighbor" as const,
  }));
  return {
    spacing,
    outerInset,
    edgeInset,
    outerLane,
    /** 侧跨目标柱净宽示意；主楼开间以门厅／面宽分档为准。 */
    clearSpan: spacing - columnSize,
    mainAxes: axes,
    ownColumns,
    neighborColumns,
    columns: [...ownColumns, ...neighborColumns],
  };
}

/** 在轮廓 [fromX, toX] 段上按弧长取样（含两端），用于弧形边柱。 */
function sampleContourByArc(contour: Point[], fromX: number, toX: number, spacing: number): Point[] {
  const section = contourSection(contour, fromX, toX);
  if (section.length < 2) return [[fromX, contourAt(contour, fromX)]];
  const lengths = [0];
  for (let i = 1; i < section.length; i++) {
    lengths.push(
      lengths[i - 1] + Math.hypot(section[i][0] - section[i - 1][0], section[i][1] - section[i - 1][1]),
    );
  }
  const total = lengths.at(-1)!;
  if (total < 100) return [section[0], section.at(-1)!];
  const count = Math.max(1, Math.round(total / spacing));
  const step = total / count;
  const points: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const target = Math.min(total, i * step);
    const index = lengths.findIndex((length, j) => j > 0 && length >= target - 1e-6);
    if (index < 0) {
      points.push(section.at(-1)!);
      continue;
    }
    const span = lengths[index] - lengths[index - 1];
    const t = span < 1e-6 ? 0 : (target - lengths[index - 1]) / span;
    const a = section[index - 1], b = section[index];
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return points;
}

function manualGroundHeight(x: number, z: number) {
  const c = surroundings;
  const edges = terraceContours;
  if (contains([x, z], villageRoadEdges.outline)) return c.frontHouse.y;
  if (x >= c.road.x && x <= c.road.x + c.road.w && z >= c.road.front && z <= c.road.back)
    return roadHeight(z);
  if (z >= contourAt(edges.rearThird, x)) return c.rearThird.y;
  if (z >= contourAt(edges.rearSecond, x)) return c.rearSecond.y;
  if (z >= contourAt(edges.rearFirst, x)) return c.rearFirst.y;
  if (x < 0) {
    if (z >= contourAt(rightTerraceBreak, x)) return 0;
    if (z >= contourAt(edges.sharedFront, x)) return site.adjacentUnexcavatedLevel;
  } else if (x <= site.width) {
    if (z >= 0) return 0;
    if (z >= contourAt(courtyardFront, x)) return site.garageFloor;
  } else {
    if (z >= c.sideHouse.z) return 0;
    // 木屋前整段与两侧院坪同高，不再在堂屋西侧挖低。
    if (x < c.road.x && z >= c.neighborYard.z) return 0;
    // 东侧切口／院坪东端外沿以北按道路接入标高（与 site.cut 同源，勿写死 −8.6）
    if (z >= site.cut.z) return c.road.entryY;
  }
  return z >= contourAt(edges.frontLower, x) ? frontFieldLevel : c.frontHouse.y;
}

/** 近场显示细分，原始DEM的资料分辨率仍约30m。 */
export const TERRAIN_JOIN_GRID_STEP_MM = 2000;

/**
 * 宅院、近处田面及邻房台地沿用口述／照片标高，外围逐渐回到DEM。
 * 在共用三角网内插值纵向缩放与位移，田面、田坎和高度查询使用同一变换。
 */
export function createLocalTerrainSampler(data = defaultTerrainHorizon) {
  const bounds = handmadeTerrainBounds();
  const step = TERRAIN_JOIN_GRID_STEP_MM;
  const rectangle = (left: number, front: number, right: number, back: number): Point[] =>
    [[left, front], [right, front], [right, back], [left, back]];
  const c = surroundings;
  // 包括蓝顶邻房外伸门厅、前坪与台基，防止DEM坡面穿进铺装。
  const blueBase = roadsideGroundFootprint();
  const photoLayout = northPhotoLayout();
  const photoHouses = easternPhotoHouses(c.road.x);
  const photoEast = Math.max(...photoHouses.map(h => h.x + h.w + 2000));
  const smooth = (value: number) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };
  const controls = [
    // 留出近屋梯田、地库外第一田与东侧道路，外围田地不再无限延伸为平面。
    rectangle(-8000, Math.min(-18000, ...courtyardFront.map(p => p[1] - 4000)), c.road.x + c.road.w, site.oldDepth + 4000),
    rectangle(c.rearHouse.x, c.rearHouse.z, c.rearHouse.x + c.rearHouse.w, c.rearHouse.z + c.rearHouse.d),
    rectangle(c.frontHouse.x, c.frontHouse.z, c.frontHouse.x + c.frontHouse.w, c.frontHouse.z + c.frontHouse.d),
    rectangle(c.road.x, c.road.front, c.road.x + c.road.w, c.road.back),
    blueBase,
    villageRoadEdges.outline,
    rectangle(c.leftPlatform.x, -24000, photoEast, 25000),
    ...photoHouses.map(h => rectangle(h.x - (h.kind === "masonry" && h.facing !== "west" ? 2800 : 0), h.z - (h.kind === "masonry" && h.facing === "west" ? 2800 : 0), h.x + h.w, h.z + h.d)),
  ];
  const distanceToControls = (x: number, z: number) => {
    let distance = Infinity;
    for (const polygon of controls) {
      if (contains([x, z], polygon)) return 0;
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
        distance = Math.min(distance, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
      }
    }
    // 房基／门前留2m缓冲，覆盖共用网格插值，近房铺装保持平整。
    return Math.max(0, distance - 2000);
  };
  const nodes = new Map<string, { weight: number; offset: number; demWeight: number }>();
  const rawHeight = createJoinedTerrainSampler(data);
  const node = (column: number, row: number) => {
    const key = `${column},${row}`;
    const cached = nodes.get(key);
    if (cached != null) return cached;
    const x = column * step, z = row * step;
    const distance = distanceToControls(x, z);
    // 最外一格完全采用DEM，避免边界落在网格中部时仍混入旧平台标高。
    const edge = Math.max(0, Math.min(x - bounds.left, bounds.right - x, z - bounds.front, bounds.back - z) - step);
    const t = distance === 0 ? 0 : Math.min(1, distance / Math.min(12000, distance + edge));
    const weight = t * t * (3 - 2 * t);
    const raw = rawHeight(x, z) * 1000;
    const value = { weight, offset: weight * raw, demWeight: weight };
    const roadFront = contourAt(villageRoadEdges.front, x);
    if (z < roadFront + 8000) {
      const section = northCreekSection(x, roadFront, villageRoadElevation(x));
      const center = roadFront - section.centerZ;
      const roadY = villageRoadElevation(x);
      const profile: Point[] = [
        [-8000, roadY], [0, roadY], [900, roadY],
        [center - section.halfWidth, section.bedY + 350], [center, section.bedY],
        [center + section.halfWidth, section.bedY + 350],
        [center + section.halfWidth + 3500, roadY - 400],
        [roadFront - bounds.front, raw],
      ];
      let target = contourAt(profile, roadFront - z);
      const main = photoLayout.courses[1];
      const channel = distanceToPhotoPath(x, z, main.points);
      if (channel.distance < main.halfWidth + 3500) {
        const junction = photoLayout.courses[0].points.at(-1)!;
        const bed = northCreekSection(channel.x, contourAt(villageRoadEdges.front, channel.x), villageRoadElevation(channel.x)).bedY
          + Math.max(0, junction[1] - channel.z) * 0.012;
        const bank = smooth((channel.distance - main.halfWidth) / 3500);
        const channelHeight = bed + 350 * (channel.distance / main.halfWidth) ** 2;
        target = Math.min(target, channelHeight + (target - channelHeight) * bank);
      }
      // 桥南端到村道之间的树杈引道保持路面标高；斜桥西侧更靠北，须按南沿两侧判断，桥下河床不填。
      if (z <= roadFront + 800) {
        const edge = distanceToPhotoPath(x, z, photoLayout.bridge.southEdge);
        const onRoadSide = z >= edge.z - 200;
        const lane = distanceToPhotoPath(x, z, [photoLayout.bridge.south, photoLayout.bridge.north]);
        const entrance = onRoadSide
          ? Math.max(
            1 - smooth((edge.distance - 900) / 1800),
            1 - smooth((lane.distance - 2100) / 1500),
          )
          : 0;
        target += (roadY - target) * entrance;
      }
      // 过桥后接入路位于主溪东岸。近桥端抬到桥面标高，避免中心线掉进河床造成断口；桥洞下仍空。
      {
        const lane = distanceToPhotoPath(x, z, photoLayout.approach);
        const laneWeight = 1 - smooth((lane.distance - 2100) / 2200);
        if (laneWeight > 0 && z <= photoLayout.bridge.north[1] + 2800) {
          const along = Math.max(0, photoLayout.bridge.north[1] - z);
          const grade = smooth(along / Math.max(8000, photoLayout.bridge.north[1] - bounds.front));
          target += (c.frontHouse.y + (raw - c.frontHouse.y) * grade - target) * laneWeight;
        }
      }
      // 村道保持台地标高，防止弯道被相邻溪谷拉低。
      const roadDistance = distanceToPhotoPath(x, z, villageRoadCenter).distance;
      const roadWeight = 1 - smooth((roadDistance - villageRoadWidth / 2 - 1500) / 500);
      target += (roadY - target) * roadWeight;
      const mask = smooth((roadFront + 8000 - z) / 8000)
        * smooth((Math.min(x - bounds.left, Math.min(bounds.right, surroundings.extent.right) - x, z - bounds.front) - step) / 6000);
      const previous = c.frontHouse.y * (1 - weight) + value.offset;
      value.offset += (target - previous) * mask;
      value.demWeight *= 1 - mask;
    }
    nodes.set(key, value);
    return value;
  };
  return (x: number, z: number, heightMm: number) => {
    const column = Math.floor(x / step), row = Math.floor(z / step);
    const u = x / step - column, v = z / step - row;
    const a = node(column, row), b = node(column + 1, row + 1);
    const c = u >= v ? node(column + 1, row) : node(column, row + 1);
    const middle = Math.abs(u - v), end = Math.min(u, v), start = 1 - Math.max(u, v);
    const demWeight = a.demWeight * start + c.demWeight * middle + b.demWeight * end;
    const heightAtNode = (value: { weight: number; offset: number }, nx: number, nz: number) => {
      const original = heightMm * (1 - value.weight) + value.offset;
      const roadFront = contourAt(villageRoadEdges.front, nx);
      if (value.weight === 0 || nx >= 8000 || nz <= roadFront + 4000) return original;
      // 西侧田面保持水平，山坡自下而上覆盖田坎末端。
      const hillside = surroundings.frontHouse.y * (1 - value.weight) + value.offset;
      // 在交汇高度上下各0.8m内圆顺收口，积分渐变保持坡面切向连续。
      const delta = hillside - heightMm;
      const rounding = 800 * value.weight;
      const t = Math.max(0, Math.min(1, (delta + rounding) / (2 * rounding)));
      const joined = heightMm + Math.max(0, delta - rounding) + 2 * rounding * (t ** 3 - t ** 4 / 2);
      const edge = Math.min(nx - bounds.left, bounds.right - nx, nz - bounds.front, bounds.back - nz);
      const fieldWeight = smooth((8000 - nx) / 8000) * smooth((nz - roadFront - 4000) / 4000)
        * smooth((edge - step) / 6000);
      return original + (joined - original) * fieldWeight;
    };
    const result = heightAtNode(a, column * step, row * step) * start
      + heightAtNode(c, (u >= v ? column + 1 : column) * step, (u >= v ? row : row + 1) * step) * middle
      + heightAtNode(b, (column + 1) * step, (row + 1) * step) * end;
    return { heightMm: Math.abs(result - heightMm) < 1e-7 ? heightMm : result, demWeight };
  };
}

let groundSamplerKey = "";
let groundSampler: ReturnType<typeof createLocalTerrainSampler>;
let easternSampler: ReturnType<typeof createEasternTerrainSampler>;
export function groundHeight(x: number, z: number) {
  const key = JSON.stringify([site, surroundings, courtyardFront]);
  if (!groundSampler || key !== groundSamplerKey) {
    groundSampler = createLocalTerrainSampler();
    easternSampler = createEasternTerrainSampler();
    groundSamplerKey = key;
  }
  if (x >= surroundings.leftPlatform.x || (x >= surroundings.road.x && z > surroundings.road.back)) {
    return easternSampler.sample(x, z).heightMm;
  }
  return groundSampler(x, z, manualGroundHeight(x, z)).heightMm;
}

/** 东侧按道路边缘、屋后田面与DEM生成估算坡面，1m网格与高度查询共用。 */
export function createEasternTerrainSampler(data = defaultTerrainHorizon) {
  const c = surroundings, bounds = handmadeTerrainBounds();
  const roadRight = c.road.x + c.road.w;
  const local = createLocalTerrainSampler(data), raw = createJoinedTerrainSampler(data);
  const smooth = (value: number) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * t * (10 + t * (-15 + 6 * t));
  };
  const mix = (a: number, b: number, weight: number) => a + (b - a) * weight;
  const axis = (from: number, to: number, stations: number[]) => {
    const values = [from, to, ...stations.filter(value => value > from && value < to)];
    for (let value = Math.ceil(from / 1000) * 1000; value < to; value += 1000) values.push(value);
    return [...new Set(values)].sort((a, b) => a - b);
  };
  const xs = axis(c.road.x, bounds.right, [roadRight]);
  const zs = axis(bounds.front, bounds.back, [c.road.front, c.road.back]);
  const photoContours = easternPhotoContours(roadRight);
  const photoHouses = easternPhotoHouses(c.road.x);
  const [brick, timber, outer] = photoHouses;
  // 共用林缘绕过三户台地。保形曲线和实际平面距离让转角圆顺，
  // 避免按每栋房子的矩形范围分别压低DEM而留下方形凹槽。
  const mountainFoot = smoothContour([
    [c.road.x - 10000, brick.z + brick.d + 5000],
    [brick.x + brick.w - 3000, brick.z + brick.d + 5000],
    [brick.x + brick.w + 5000, brick.z + brick.d / 2],
    [timber.x + timber.w + 5000, timber.z + timber.d / 2],
    [outer.x + outer.w - 1000, outer.z + outer.d + 5000],
    [outer.x + outer.w + 7000, outer.z - 4000],
    [bounds.right + 15000, outer.z - 10000],
  ], 500);
  // 道路末端向屋后第二田升高，消除沿用2.5m平台形成的长槽。
  const rearGrade = (z: number) => c.leftPlatform.y
    + (c.rearSecond.y - c.leftPlatform.y) * smooth((z - c.road.back) / Math.max(1000, c.rearHouse.z - c.road.back))
    + (c.rearThird.y - c.rearSecond.y) * smooth((z - c.rearHouse.z - c.rearHouse.d) / (bounds.back - c.rearHouse.z - c.rearHouse.d));
  const nodes = zs.map(z => xs.map(x => {
    if (x <= roadRight && z > c.road.back) return local(x, z, rearGrade(z));
    const edgeHeight = z > c.road.back
      ? local(roadRight, z, rearGrade(z)).heightMm : roadHeight(z);
    // 前田从路缘连续抬升，取消旧低田与高台之间8.95m的突跳。
    let bench = c.frontHouse.y;
    let foundationY: number | undefined;
    let foundationProtection = 0;
    for (const [index, contour] of photoContours.entries()) {
      const previousY = index === 0 ? c.frontHouse.y : photoContours[index - 1].y;
      bench += (contour.y - previousY) * smooth((z - contourAt(contour.points, x)) / 1800);
    }
    // 北侧保留照片田块，屋后统一为共用台地接连续山坡。
    // 不在林缘下方叠加多级照片田面，防止这些田坎透进山坡形成折面。
    // 沿南北高差抬升外侧木房屋后的坡脚，不能把中间木房背后的地面
    // 随X降低到外侧木房标高，否则两户后方又会出现低槽。
    const baseY = mix(outer.y, timber.y, smooth((z - outer.z - outer.d) / 4000));
    bench = mix(bench, baseY, smooth((z + 3500) / 3500));
    // 三角形田块向最东侧木房收尖，临路一级进深占总深度的2.5/4.5。
    const tipX = outer.x + outer.w;
    const fraction = Math.max(0, Math.min(1, (x - roadRight) / (tipX - roadRight)));
    const upperZ = -1000 + (outer.z + 1000) * fraction;
    const lowerZ = contourAt(villageRoadEdges.back, x);
    if (x >= roadRight && x <= tipX && z <= upperZ && z >= lowerZ && upperZ - lowerZ > 100) {
      const t = (upperZ - z) / (upperZ - lowerZ);
      const roadLevel = villageRoadElevation(x);
      const middleLevel = (-2000 + roadLevel) / 2;
      bench = -2000 + (middleLevel + 2000) * smooth((t - 1 / 4.5 + 0.015) / 0.03)
        + (roadLevel - middleLevel) * smooth((t - 2 / 4.5 + 0.015) / 0.03);
      if (x >= roadRight + 4000) foundationY = bench;
      foundationProtection = 1;
    }
    // 房基范围独立保持估算台地，缓冲外再接回田面。
    for (const house of photoHouses) {
      const left = house.x - (house.kind === "masonry" && house.facing !== "west" ? 2800 : 0);
      const front = house.z - (house.kind === "masonry" && house.facing === "west" ? 2800 : 0);
      const distance = Math.hypot(Math.max(left - x, 0, x - house.x - house.w), Math.max(front - z, 0, z - house.z - house.d));
      const protection = 1 - smooth((distance - 2000) / 3500);
      foundationProtection = Math.max(foundationProtection, protection);
      bench = mix(bench, house.y, protection);
      if (distance <= 2000) foundationY = house.y;
    }
    if (z > c.road.back && x <= roadRight + 1500) bench = edgeHeight;
    const distance = Math.max(0, x - roadRight);
    // 路后高地用宽缓坡连接共用山脚，避免窄路缘渐变在坡中留下直线深槽。
    const roadBlendWidth = 4000 + 20000 * smooth((z - brick.z - brick.d) / 10000);
    const apron = foundationY ?? mix(edgeHeight, bench, smooth(distance / roadBlendWidth));
    const footZ = contourAt(mountainFoot, x);
    const rise = z > footZ ? distanceToPhotoPath(x, z, mountainFoot).distance : 0;
    // 五次渐变在山脚及DEM端的一、二阶导数归零，坡面连续圆顺。
    // 24m是近场估算过渡宽度，原始DEM网格不做平滑或改写。
    const hillWeight = smooth(rise / 24000);
    let height = mix(apron, raw(x, z) * 1000, hillWeight);
    const boundaryWeight = 1 - smooth(Math.min(bounds.right - x, z - bounds.front, bounds.back - z) / 6000);
    height = mix(height, raw(x, z) * 1000, boundaryWeight);
    // 房基与三角形田保持已确认的标高，其余坡面连续接入共用山脚。
    const result = { heightMm: mix(height, apron, foundationProtection), demWeight: Math.max(hillWeight, boundaryWeight) * (1 - foundationProtection) };
    const roadBack = contourAt(villageRoadEdges.back, x);
    const roadFront = contourAt(villageRoadEdges.front, x);
    const nearValley = (1 - smooth((z - roadBack) / 2000))
      * (z < roadFront ? 1 : smooth(distance / 4000)) * (1 - foundationProtection);
    const valley = local(x, z, c.frontHouse.y);
    return { heightMm: mix(result.heightMm, valley.heightMm, nearValley), demWeight: mix(result.demWeight, valley.demWeight, nearValley) };
  }));
  const cell = (value: number, axis: number[]) => {
    let low = 0, high = axis.length - 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (value < axis[middle]) high = middle;
      else low = middle;
    }
    return low;
  };
  const sample = (x: number, z: number) => {
    if (x < xs[0] || x > bounds.right || z < bounds.front || z > bounds.back) {
      return { heightMm: raw(x, z) * 1000, demWeight: 1 };
    }
    const column = cell(x, xs), row = cell(z, zs);
    const u = Math.max(0, Math.min(1, (x - xs[column]) / (xs[column + 1] - xs[column])));
    const v = Math.max(0, Math.min(1, (z - zs[row]) / (zs[row + 1] - zs[row])));
    const a = nodes[row][column], b = nodes[row + 1][column + 1];
    const middle = u >= v ? nodes[row][column + 1] : nodes[row + 1][column];
    const blend = (key: "heightMm" | "demWeight") => a[key] * (1 - Math.max(u, v))
      + middle[key] * Math.abs(u - v) + b[key] * Math.min(u, v);
    return { heightMm: blend("heightMm"), demWeight: blend("demWeight") };
  };
  return { xs, zs, sample };
}

/** 手绘外沿已经回到DEM，外围直接沿用原始三角网高程。 */
export function createJoinedTerrainSampler(data = defaultTerrainHorizon) {
  return (x: number, z: number) => {
    const point = modelPointToTerrain(x, 0, z, data);
    const raw = terrainHeightM(point.eastM, point.northM, data);
    if (raw == null) throw new Error("DEM未覆盖场地接缝");
    return raw;
  };
}
