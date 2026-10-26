import { site, floors, frontFieldLevel, courtyardFront, roadsideVilla, contains, type Point } from "./data";
import { contourAt, insetContour, smoothContour } from "./contours";
import { placeRoadsideVilla, roadsideToWorld } from "./roadside-villa-layout";

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
// 整条西侧上田田埂相对原曲线向房前平移 2.5 米（先前只拉了靠屋几米）。折点间距不变，弧度不变。
// 下方原田北沿仍贴地库外沿，因此这段下田比上田窄。
const rightTerraceAdvance = 2500;
// 左侧马路连续上坡，接到屋后第一层与东侧大平地的同一标高后停止，不再往南爬。
const roadFrontZ = -26500;
const sharedPlaneY = site.rearField;
let roadBackZ = site.oldDepth;
function roadGrade(z: number) {
  const t = Math.min(1, Math.max(0, (z - roadFrontZ) / (roadBackZ - roadFrontZ)));
  return frontHouseY + t * (sharedPlaneY - frontHouseY);
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
  // 浏览器标记 2 的近屋同线段；长度是建模范围，不是新增实测。
  rightFrontAlignedWidth: 8000,
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
  const next = placeRoadsideVilla(
    site.sideGap,
    site.garageFloor - site.frontFieldDrop - site.frontHouseDrop,
  );
  Object.assign(roadsideVilla, next);
  rebuildVillageRoad();
}

// 俯瞰航拍里西侧田埂远离房子后朝南弯。整条上田田埂按这条原弧向北平移
// rightTerraceAdvance，靠屋终点仍落在 rightStep。
const shiftedFar = (z: number) => z - rightTerraceAdvance;

function buildRightTerraceBreak(): Point[] {
  const zAtMinus6 = shiftedFar(5500);
  const zAtHouse = surroundings.rightStep;
  return smoothContour([
    [-55000, shiftedFar(21500)], [-44000, shiftedFar(18200)], [-34000, shiftedFar(14400)],
    [-24000, shiftedFar(10600)], [-16000, shiftedFar(7800)],
    [-10000, shiftedFar(6300)], [-6000, zAtMinus6],
    [-2400, zAtMinus6 + (zAtHouse - zAtMinus6) * (3.6 / 6)],
    [0, zAtHouse],
  ]);
}

function buildUnexcavatedFront(): Point[] {
  // 取地库实际轮廓端点作为旁田基准。靠屋 8 米与地库外沿同线，再往西才朝南弯。
  const garageFrontZ = courtyardFront[0]?.[1] ?? 0;
  return smoothContour([
    [-55000, 15200], [-44000, 11400], [-34000, 6800], [-24000, 2400], [-16000, -600], [-12000, -2100],
    [-surroundings.rightFrontAlignedWidth, garageFrontZ],
    [-5000, garageFrontZ], [-2500, garageFrontZ], [0, garageFrontZ],
  ]);
}

// 地库下第一田外沿圆润前推，西端不收尖折回；接到砖房屋后田坎。
// 用固定控制点拟合，不再借用院坪三点大圆——院坪圆半径过大时中点会甩到几百米外，把马路和蓝顶房前台地盖住。
function basementOuterArc(): Point[] {
  const lipX = surroundings.frontHouse.x;
  const lipZ = surroundings.frontHouse.z + surroundings.frontHouse.d + frontRearTerrace;
  return smoothContour(
    [
      [-16000, -7100],
      [-8000, -6350],
      [0, -5700],
      [8000, Math.min(-5100, lipZ + 900)],
      [Math.max(lipX - 3000, 12000), lipZ + 200],
      [lipX, lipZ],
    ],
    750,
  );
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
  // 旁田近屋段与地库右端外沿同线；远处继续采用航拍估算曲线。
  sharedFront: buildSharedFront(),
  frontLower: smoothContour([
    [-55000, 9200], [-44000, 5200], [-34000, 600], [-24000, -4200],
    // 靠屋外沿改成一条圆润圆弧，西端折角已往外拉齐。外偏接到砖房屋后田坎，不是新的测绘。
    ...basementOuterArc(),
    [24000, surroundings.frontHouse.z + surroundings.frontHouse.d + frontRearTerrace],
    [surroundings.road.x, surroundings.frontHouse.z + surroundings.frontHouse.d + frontRearTerrace],
  ]),
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

// 地库只留两排柱：外沿内收一排，房前墙下一排。中间不立柱。柱距是示意模数。
export function basementColumns() {
  const spacing = 4200;
  const outerInset = 550;
  const ourFront = insetContour(courtyardFront, outerInset);
  const xs: number[] = [];
  const first = 700;
  const last = surroundings.road.x - 550;
  for (let x = first; x <= last + 1e-3; x += spacing)
    xs.push(Math.round(x));
  if (last - xs[xs.length - 1] > 2400) xs.push(Math.round(last));
  return {
    spacing,
    outerInset,
    columns: xs.map((x) => {
      const onOurPlot = x <= site.width;
      const outerZ = onOurPlot
        ? contourAt(ourFront, x)
        : surroundings.neighborYard.z + outerInset;
      // 内沿取房子前墙位置：自家前墙 Z=-1，邻居木屋前墙与自家旧木房前墙对齐。
      const innerZ = onOurPlot ? site.main.z : surroundings.sideHouse.z;
      return {
        x,
        outer: [x, outerZ] as Point,
        inner: [x, innerZ] as Point,
        span: Math.round(Math.abs(innerZ - outerZ)),
      };
    }),
  };
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
