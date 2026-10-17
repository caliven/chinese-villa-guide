import { site, floors, frontFieldLevel, courtyardFront, roadsideVilla, contains, type Point } from "./data";
import { contourAt, insetContour, smoothContour } from "./contours";
import { roadsideToWorld } from "./roadside-villa-layout";

// 全部左右关系按站在北侧、面对房子描述：画面左侧为 X 增大。
// 对齐关系来自用户；周边房屋尺寸、未测标高和田坎折点仍是航拍估算。
// 自家旧木房前墙。左侧邻居木房前墙与它对齐；邻居进深更大，多出的长度在后墙。都是口述，不是测绘。
const alignedWoodFront = 1.1;
const sideHouse = { x: 21.75, z: alignedWoodFront, w: 12, d: 8.8, y: 0, h: 5.3 };
const leftEdge = sideHouse.x + sideHouse.w;
const rearRight = site.main.x + site.main.w / 2;
const frontRight = site.main.x + (site.main.w * 2) / 3;
const frontHouseY = frontFieldLevel - site.frontHouseDrop;
// 屋脊原先比自家一层顶高约 2 米。整栋再降 1.5 米后，约高 0.5 米。口述调整，不是测绘。
// 航拍里人字坡很平，起坡只留约 0.9 米，是照片估算。
const frontRoofRise = 0.9;
const frontRidgeDrop = 1.5;
const frontRidge = floors[0].y + floors[0].height + 2 - frontRidgeDrop;
const frontFloorHeight = (frontRidge - frontRoofRise - frontHouseY) / 2;
// 进深原 7.5 米。按航拍向北加 2 米，后墙和屋后 0.4 米田外沿不动。
const frontHouseDepth = 9.5;
const frontDepthAdded = frontHouseDepth - 7.5;
// 与 neighborBayPlan("side") 相同：三开间、堂屋居中且更宽。右沿是口述大约位置，不是测绘。
const sideHallScale = 1.45;
const sideOrdinary = sideHouse.w / (2 + sideHallScale);
const sideHallCenter =
  sideHouse.x + sideHouse.w - sideOrdinary - (sideOrdinary * sideHallScale) / 2;
const neighborYardWest = sideHallCenter - 0.5;
const neighborFrontZ = courtyardFront.at(-1)![1];
// 马路东侧高地比邻居院坪外沿再向房内收。4 米是口述，不是测绘。
const leftPlatformInset = 4;
const leftPlatformFront = neighborFrontZ + leftPlatformInset;
const frontSpan = leftEdge - frontRight;
// 屋后田原约1米。宽度按5/2压缩后为0.4米；房子朝道路反方向退0.6米，田埂外沿不动。
const frontRearTerrace = 1 * 2 / 5;
const frontHouseSetback = 1 - frontRearTerrace;
// 整条西侧上田田埂相对原曲线向房前平移 2.5 米（先前只拉了靠屋几米）。折点间距不变，弧度不变。
// 下方原田北沿仍贴地库外沿，因此这段下田比上田窄。
const rightTerraceAdvance = 2.5;
// 左侧马路连续上坡，接到屋后第一层与东侧大平地的同一标高后停止，不再往南爬。
const roadFrontZ = -26.5;
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
    z: 20,
    w: leftEdge - rearRight,
    d: 8,
    y: 5,
    h: 5.2,
  },
  frontHouse: {
    x: frontRight,
    z: -23.75 + frontHouseSetback - frontDepthAdded,
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
    w: 3.4,
    front: roadFrontZ,
    back: roadBackZ,
    // 连续纵坡在接入中心的高度，只作坡道初值，不是实测路面标高。
    entryY: Math.round(roadGrade(-7.35) * 100) / 100,
  },
  // 东侧大平地与屋后第一层梯田同一标高。2.5 米沿用屋后田，不是新的测绘。
  leftPlatform: { x: leftEdge + 3.4, front: leftPlatformFront, back: site.oldDepth, y: sharedPlaneY },
  rearFirst: { front: site.oldDepth, back: 16.2, y: site.rearField },
  rearSecond: { front: 16.2, back: 29.5, y: 5 },
  rearThird: { front: 29.5, back: 36, y: 6.8 },
  rightTerraceAdvance,
  rightStep: site.annex.z + (site.annex.d * 2) / 3 - rightTerraceAdvance,
  // 浏览器标记 2 的近屋同线段；长度是建模范围，不是新增实测。
  rightFrontAlignedWidth: 8,
  forestStart: 36,
  extent: { left: -32, right: 55, front: -30, back: 36 },
};

// 俯拍里主马路在蓝顶房前向西南转弯。保留东侧 T 形路口，只有西段随邻房转向。
// 道路宽度与曲线都是照片估算；与上坡支路不同，这一段与前方砖房首层同高。
// 路心贴近门厅前坪外沿（约 2.1 m），避免房前露出大块空白田面把路面“吃掉”。
const villageRoadWidth = 3.5;
const villageRoadFront = -roadsideVilla.d / 2 - roadsideVilla.portico.d - 2.1;
export const villageRoadCenter = smoothContour([
  [surroundings.extent.left, -14.5],
  roadsideToWorld(roadsideVilla, -roadsideVilla.w / 2 - 1.2, villageRoadFront),
  roadsideToWorld(roadsideVilla, -roadsideVilla.w / 2, villageRoadFront),
  roadsideToWorld(roadsideVilla, 2, villageRoadFront),
  roadsideToWorld(roadsideVilla, roadsideVilla.w / 2 + roadsideVilla.wing.w, villageRoadFront),
  roadsideToWorld(roadsideVilla, roadsideVilla.w / 2 + roadsideVilla.wing.w + 1.5, villageRoadFront - 0.4),
  [-5, -29.25], [2, -28.25], [20, -28.25], [surroundings.extent.right, -28.25],
], 0.45);
export const villageRoadEdges = (() => {
  const front: Point[] = [], back: Point[] = [];
  for (let i = 0; i < villageRoadCenter.length; i++) {
    const p = villageRoadCenter[i];
    const a = villageRoadCenter[Math.max(0, i - 1)], b = villageRoadCenter[Math.min(villageRoadCenter.length - 1, i + 1)];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const end = i === 0 || i === villageRoadCenter.length - 1;
    const nx = end ? 0 : -(b[1] - a[1]) / length;
    const nz = end ? 1 : (b[0] - a[0]) / length;
    front.push([p[0] - nx * villageRoadWidth / 2, p[1] - nz * villageRoadWidth / 2]);
    back.push([p[0] + nx * villageRoadWidth / 2, p[1] + nz * villageRoadWidth / 2]);
  }
  return { front, back, outline: [...front, ...back.slice().reverse()] };
})();

// 俯瞰航拍里西侧田埂远离房子后朝南弯。整条上田田埂按这条原弧向北平移
// rightTerraceAdvance，靠屋终点仍落在 rightStep。
const shiftedFar = (z: number) => z - rightTerraceAdvance;

function buildRightTerraceBreak(): Point[] {
  const zAtMinus6 = shiftedFar(5.5);
  const zAtHouse = surroundings.rightStep;
  return smoothContour([
    [-55, shiftedFar(21.5)], [-44, shiftedFar(18.2)], [-34, shiftedFar(14.4)],
    [-24, shiftedFar(10.6)], [-16, shiftedFar(7.8)],
    [-10, shiftedFar(6.3)], [-6, zAtMinus6],
    [-2.4, zAtMinus6 + (zAtHouse - zAtMinus6) * (3.6 / 6)],
    [0, zAtHouse],
  ]);
}

function buildUnexcavatedFront(): Point[] {
  // 取地库实际轮廓端点作为旁田基准。靠屋 8 米与地库外沿同线，再往西才朝南弯。
  const garageFrontZ = courtyardFront[0]?.[1] ?? 0;
  return smoothContour([
    [-55, 15.2], [-44, 11.4], [-34, 6.8], [-24, 2.4], [-16, -0.6], [-12, -2.1],
    [-surroundings.rightFrontAlignedWidth, garageFrontZ],
    [-5, garageFrontZ], [-2.5, garageFrontZ], [0, garageFrontZ],
  ]);
}

// 地库下第一田外沿圆润前推，西端不收尖折回；接到砖房屋后田坎。
// 用固定控制点拟合，不再借用院坪三点大圆——院坪圆半径过大时中点会甩到几百米外，把马路和蓝顶房前台地盖住。
function basementOuterArc(): Point[] {
  const lipX = surroundings.frontHouse.x;
  const lipZ = surroundings.frontHouse.z + surroundings.frontHouse.d + frontRearTerrace;
  return smoothContour(
    [
      [-16, -7.1],
      [-8, -6.35],
      [0, -5.7],
      [8, Math.min(-5.1, lipZ + 0.9)],
      [Math.max(lipX - 3, 12), lipZ + 0.2],
      [lipX, lipZ],
    ],
    0.75,
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
    [-55, 27.2], [-44, 24], [-34, 20.2], [-24, 16.4], [-16, 13.6],
    [-8, 11.8], [-3, 11.1], [0, d], [w, d], [33.75, d],
    [42, 11.4], [54, 12.6], [66, 13.4], [77, 14.2],
  ]);
}

export const rightTerraceBreak = buildRightTerraceBreak();

export const terraceContours = {
  // 旁田近屋段与地库右端外沿同线；远处继续采用航拍估算曲线。
  sharedFront: buildSharedFront(),
  frontLower: smoothContour([
    [-55, 9.2], [-44, 5.2], [-34, 0.6], [-24, -4.2],
    // 靠屋外沿改成一条圆润圆弧，西端折角已往外拉齐。外偏接到砖房屋后田坎，不是新的测绘。
    ...basementOuterArc(),
    [24, surroundings.frontHouse.z + surroundings.frontHouse.d + frontRearTerrace],
    [surroundings.road.x, surroundings.frontHouse.z + surroundings.frontHouse.d + frontRearTerrace],
  ]),
  // 前坎停在院坪外沿以南约 4 米，远处不再朝北甩过这条线。
  leftPlatform: [] as Point[],
  rearFirst: buildRearFirst(),
  rearSecond: smoothContour([
    [-55, 33.4], [-44, 30.2], [-34, 26.4], [-24, 22.8], [-16, 20.4],
    [-8, 18.9], [0, 18.2], [7, 17.7], [13.55, 16.8], [21, 16.2],
    [28, 16.2], [33.75, 16.2], [44, 17.2], [56, 18.2], [66, 19], [77, 19.6],
  ]),
  rearThird: smoothContour([
    [-55, 40.2], [-44, 37.2], [-34, 34.2], [-24, 31.6], [-14, 30.2],
    [-6, 29.7], [0, 29.5], [13.55, 29.5], [28, 29.5], [33.75, 30.6],
    [46, 31.6], [60, 32.5], [77, 33.4],
  ]),
  hillFoot: smoothContour([
    [-55, 47], [-40, 43], [-28, 40], [-12, 37.4], [0, 36.5],
    [13.55, 36], [28, 36.2], [44, 38.2], [60, 40], [77, 41.2],
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
    [44, f + 0.35],
    [52, f + 0.7],
    [60, f + 0.5],
    [68, f + 0.2],
    [77, f],
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
    return [Math.round(z * 1000) / 1000, roadGrade(z)] as Point;
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
  const spacing = 4.2;
  const outerInset = 0.55;
  const ourFront = insetContour(courtyardFront, outerInset);
  const xs: number[] = [];
  const first = 0.7;
  const last = surroundings.road.x - 0.55;
  for (let x = first; x <= last + 1e-6; x += spacing)
    xs.push(Math.round(x * 100) / 100);
  if (last - xs[xs.length - 1] > 2.4) xs.push(Math.round(last * 100) / 100);
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
        span: Math.round(Math.abs(innerZ - outerZ) * 100) / 100,
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
      Math.sin(x * 0.13) * 1.6 * Math.min(1, distance / 12)
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
    const x = -48 + rand() * 120,
      z = Math.max(surroundings.forestStart, contourAt(terraceContours.hillFoot, x)) + 2 + rand() * 43;
    return {
      x,
      z,
      y: groundHeight(x, z),
      h: 4.5 + rand() * 7,
      r: 1.1 + rand() * 1.4,
    };
  });
}
