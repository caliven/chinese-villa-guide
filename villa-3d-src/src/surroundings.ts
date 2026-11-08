import { site, floors, frontFieldLevel, courtyardFront, roadsideVilla, contains, type Point } from "./data.ts";
import { contourAt, contourSection, insetContour, smoothContour } from "./contours.ts";
import { placeRoadsideVilla, roadsideToWorld } from "./roadside-villa-layout.ts";

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
  forestStart: 36000,
  extent: { left: -32000, right: 55000, front: -30000, back: 36000 },
};

// 俯拍里主马路在蓝顶房前向西南转弯。保留东侧 T 形路口，只有西段随邻房转向。
// 道路宽度与曲线都是照片估算；与上坡支路不同，这一段与前方砖房首层同高。
// 路心贴近门厅前坪外沿（约 2.1 m），避免房前露出大块空白田面把路面“吃掉”。
const villageRoadWidth = 3500;

function buildVillageRoadCenter(): Point[] {
  const villageRoadFront = -roadsideVilla.d / 2 - roadsideVilla.portico.d - 2100;
  return smoothContour([
    [surroundings.extent.left, -14500],
    roadsideToWorld(roadsideVilla, -roadsideVilla.w / 2 - 1200, villageRoadFront),
    roadsideToWorld(roadsideVilla, -roadsideVilla.w / 2, villageRoadFront),
    roadsideToWorld(roadsideVilla, 2000, villageRoadFront),
    roadsideToWorld(roadsideVilla, roadsideVilla.w / 2 + roadsideVilla.wing.w, villageRoadFront),
    roadsideToWorld(roadsideVilla, roadsideVilla.w / 2 + roadsideVilla.wing.w + 1500, villageRoadFront - 400),
    [-5000, -29250], [2000, -28250], [20000, -28250], [surroundings.extent.right, -28250],
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
 * 主楼前墙向屋内下挖进深（mm）：前廊下挖悬空，承重柱／地梁落在地库净空；
 * 再往北仍为实体台地／条基。2400 为安全示意净空，埋深与配筋待结构／地勘核定。
 */
export const MAIN_FRONT_GARAGE_INSET = 2400;

/**
 * 主楼前廊下挖范围（含原外伸段）：土基开洞、地库地面伸入，楼板下悬空。
 * 南起主楼前墙外皮，北至屋内 MAIN_FRONT_GARAGE_INSET。
 */
export function mainFrontGaragePocket(): Point[] {
  const main = site.main;
  if (MAIN_FRONT_GARAGE_INSET < 100) return [];
  return rectPoints(main.x, main.z, main.w, MAIN_FRONT_GARAGE_INSET);
}

/** 台地石基／铺装开洞：只切 Z≥0 与下挖相交段，避免洞口伸出台地轮廓导致重面。 */
export function mainFrontPadHole(): Point[] {
  const main = site.main;
  const north = main.z + MAIN_FRONT_GARAGE_INSET;
  if (north <= 1) return [];
  return rectPoints(main.x, 0, main.w, north);
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
    /** 前墙向屋内下挖北缘 */
    pocketNorth: wallZ + MAIN_FRONT_GARAGE_INSET,
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
  const lastOwn = yard.x - edgeInset;
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

export function groundHeight(x: number, z: number) {
  const c = surroundings;
  const edges = terraceContours;
  const hillStart = contourAt(edges.hillFoot, x);
  if (z >= hillStart) {
    const distance = z - hillStart;
    // 马路东侧红框里是一块平地，山从这块平地后面抬起，不再从最高一层梯田起坡。
    const base = x >= c.road.x ? c.leftPlatform.y : c.rearThird.y;
    return (
      base +
      distance * 0.34 +
      Math.sin(x * 0.00013) * 1600 * Math.min(1, distance / 12000)
    );
  }
  if (contains([x, z], villageRoadEdges.outline)) return c.frontHouse.y;
  if (x >= c.road.x && x <= c.road.x + c.road.w && z >= c.road.front && z <= c.road.back)
    return roadHeight(z);
  // 马路尽头以后，路床并入东侧大平地，不再升到屋后木房那一层。
  if (x >= c.road.x && x < c.leftPlatform.x && z > c.road.back) return c.leftPlatform.y;
  if (x >= c.leftPlatform.x) {
    return z >= contourAt(edges.leftPlatform, x) ? c.leftPlatform.y : c.frontHouse.y;
  }
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

export function forestTrees() {
  // 独立种子使建模顺序改变时，后山树群也保持稳定；近景两侧不种树。
  let seed = 92013;
  const rand = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: 420 }, () => {
    const x = -48000 + rand() * 120000,
      z = Math.max(surroundings.forestStart, contourAt(terraceContours.hillFoot, x)) + 2000 + rand() * 43000;
    return {
      x,
      z,
      y: groundHeight(x, z),
      h: 4500 + rand() * 7000,
      r: 1100 + rand() * 1400,
    };
  });
}
