import { smoothContour } from "./contours";
import { placeRoadsideVilla } from "./roadside-villa-layout";
import { roofGutterDesign, roofTileInset } from "./roof-options";
import { areaM2 } from "./units";
import { porticoColumnCenters } from "./frontage-geometry";
import { getFloorplanFurniture, type FloorplanFurnitureId } from "./floorplan-catalog";
import {
  DOOR_OPENING,
  doorOffsetAgainstHinge,
  type DoorHinge,
  type DoorSide,
  type WallOpening,
} from "./openings";
export type { WallOpening, OpeningKind, DoorHinge, DoorSide } from "./openings";
export { DOOR_HINGE_CORNER_GAP, DOOR_OPENING } from "./openings";

// 坐标：X 向东、Y 向上、Z 向南；旧房前坪外缘 Z=0，单位均为毫米（mm）。
export type Point = [number, number];
export type Evidence = "用户提供" | "照片估算" | "设计建议" | "待测";
export interface Fact {
  label: string;
  value: string;
  source: Evidence;
  note: string;
}
export interface Room {
  id: string;
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  kind:
    | "bed"
    | "living"
    | "hall"
    | "bath"
    | "stair"
    | "kitchen"
    | "dining"
    | "store"
    | "void";
  note?: string;
  label?: Point;
  purposeStatus?: "pending";
  /** 墙中线／外墙外皮组成的真实正交轮廓；缺省为 x/z/w/d 矩形。 */
  outline?: Point[];
  /** 稳定墙边界关联；开敞分区和已失围合不能冒充闭合房间。 */
  boundary?: { key: string; status: "enclosed" | "open" | "unbounded" };
}
/** virtual 仅为开放区域分界，无实体、无墙厚。 */
export type WallRole = "bearing" | "partition" | "virtual";
export interface Wall {
  /** 造型派生拆段对应的原始隔墙索引，不写入户型源稿。 */
  sourceIndex?: number;
  /** 编辑器内部的稳定身份，删除其他墙后不随数组下标变化。 */
  id?: string;
  a: Point;
  b: Point;
  /** 隔墙上的门／窗洞口（可含开向与类型） */
  door?: WallOpening;
  /**
   * 平面示意：承重、轻隔墙或虚拟分界。缺省按隔墙。
   * 按砖混开间／楼梯／横墙轴线标注，可被户型功能墙带偏处已降为隔墙；须结构核定。
   */
  role?: WallRole;
}
/** 平面／编辑用：未标注则按隔墙。 */
export function wallRoleOf(w: Wall): WallRole {
  return w.role === "virtual" ? "virtual" : w.role === "bearing" ? "bearing" : "partition";
}
export function isPhysicalWall(w: Wall): boolean {
  return wallRoleOf(w) !== "virtual";
}
export interface Furniture {
  kind:
    | "bed"
    | "tv"
    | "sofa"
    | "coffeeTable"
    | "table"
    | "roundTable"
    | "chair"
    | "dressingTable"
    | "cabinet"
    | "wardrobe"
    | "basin"
    | "toilet"
    | "squatToilet"
    | "shower"
    | "counter"
    | "stove"
    | "hob"
    | "sink"
    | "altar"
    | "shrine"
    | "railing"
    | FloorplanFurnitureId;
  x: number;
  z: number;
  w: number;
  d: number;
  rotation?: number;
  label?: string;
  /** 相对淋浴房局部方向，默认正面（花洒对面）。 */
  showerDoorSide?: "front" | "left" | "right";
}
export interface Floor {
  name: string;
  y: number;
  height: number;
  front: number;
  rooms: Room[];
  partitions: Wall[];
  furniture: Furniture[];
}

// 2026-10-16 用户口述：自屋后梯田边（Z=10.8）到老水泥地／屋前梯田内侧（Z=0）为10.8；
// 再往前到外沿：东界邻线 8.6（总进深19.4）、自东界往西约11米处 5（总15.8）、西端 0.2（总11）。
// 三点过圆，外沿向外鼓。辅楼前墙已内退至 Z=0，西端前墙外尚有约0.2米。
/** 院坪外沿三点锚点；可由方案参数重写后调用 rebuildCourtyardGeometry。 */
export const courtyardArcAnchors: [Point, Point, Point] = [
  [0, -200],
  [10000, -5000],
  [21000, -8600],
];
/** 三点近似共线时退化为极大半径圆弧，避免 det≈0 产生 NaN 污染地库外墙。 */
export function circleThrough(anchors: [Point, Point, Point]) {
  const [a, b, c] = anchors;
  const [x1, z1] = a, [x2, z2] = b, [x3, z3] = c;
  const det = 2 * (x1 * (z2 - z3) + x2 * (z3 - z1) + x3 * (z1 - z2));
  if (!Number.isFinite(det) || Math.abs(det) < 1) {
    // 用弦中点下方远处假圆心，使采样近似落在弦上（直线院坪外沿）。
    const mx = (x1 + x3) / 2;
    const mz = (z1 + z3) / 2;
    const chord = Math.hypot(x3 - x1, z3 - z1) || 1;
    const nx = -(z3 - z1) / chord;
    const nz = (x3 - x1) / chord;
    const radius = 1e9;
    const h = mx - nx * radius;
    const k = mz - nz * radius;
    const midOnChordZ = z1 + ((z3 - z1) * (x2 - x1)) / (x3 - x1 || 1);
    const sign = z2 >= midOnChordZ ? 1 : -1;
    return { h, k, radius, sign };
  }
  const h =
    ((x1 * x1 + z1 * z1) * (z2 - z3) +
      (x2 * x2 + z2 * z2) * (z3 - z1) +
      (x3 * x3 + z3 * z3) * (z1 - z2)) /
    det;
  const k =
    ((x1 * x1 + z1 * z1) * (x3 - x2) +
      (x2 * x2 + z2 * z2) * (x1 - x3) +
      (x3 * x3 + z3 * z3) * (x2 - x1)) /
    det;
  return { h, k, radius: Math.hypot(x1 - h, z1 - k), sign: z2 >= k ? 1 : -1 };
}
export let courtyardCircle = circleThrough(courtyardArcAnchors);
function courtyardArc(step = 2400): Point[] {
  const { h, k, radius, sign } = courtyardCircle;
  const [x1] = courtyardArcAnchors[0];
  const [x3, z3] = courtyardArcAnchors[2];
  const points: Point[] = [];
  for (let x = x1; x < x3 - 1e-3; x += step) {
    const rise = Math.sqrt(Math.max(0, radius * radius - (x - h) ** 2));
    points.push([
      Math.round(x),
      Math.round(k + sign * rise),
    ]);
  }
  points.push([x3, z3]);
  points[0] = [...courtyardArcAnchors[0]];
  return points;
}
export const courtyardFrontControls: Point[] = courtyardArc();
export const courtyardFront: Point[] = smoothContour(courtyardFrontControls, 300);

/** 按当前 courtyardArcAnchors 重算院坪外沿、site.field／boundary／cut。 */
export function rebuildCourtyardGeometry() {
  courtyardCircle = circleThrough(courtyardArcAnchors);
  const controls = courtyardArc();
  const front = smoothContour(controls, 300);
  courtyardFrontControls.length = 0;
  courtyardFrontControls.push(...controls);
  courtyardFront.length = 0;
  courtyardFront.push(...front);
  site.field = [[0, 0], [site.width, 0], ...courtyardFront.slice().reverse()];
  site.boundary = [
    [0, site.oldDepth],
    [site.width, site.oldDepth],
    ...courtyardFront.slice().reverse(),
  ];
  const eastFront = courtyardFront[courtyardFront.length - 1]?.[1] ?? -8600;
  site.cut = { x: site.width, z: eastFront, w: 5000, d: 2500 };
  // 邻院北缘取自家东界外沿最宽处，向东拉平，不再比自家多伸出。
  neighborCourtyardPlan.yardBeyondCement = neighborCourtyardPlan.cementFront - eastFront;
}

export const site = {
  porticoStyle: "projecting" as "projecting" | "recessed",
  buildingPlacement: "main-east" as "main-east" | "main-west",
  width: 21000,
  oldDepth: 10800,
  // 屋后至梯田边预留默认 1200 mm（2026-10-16 用户改）；前墙 Z＝oldDepth−rearGap−mainDepth＝−400。
  rearGap: 1200,
  sideGap: 800,
  lane: 1800,
  // 东墙锚定：21000−800−13600＝6600；西侧800＋辅楼4000＋子孙道1800＝6600。
  main: { x: 6600, z: -400, w: 13600, d: 10000 },
  // 相对主楼前墙内退2000：前墙 Z=1600、进深8000，后墙仍与主楼齐平 Z=9600。4000×8000＝32㎡。
  annex: { x: 800, z: 1600, w: 4000, d: 8000, height: 3600 },
  setback: 1200,
  // 页面可改。4.5 是当前默认，不是测绘。（分水比例，非长度，不换算毫米）
  roofFenShui: 4.5,
  // 主楼四坡默认起高：天沟外轮廓进深随 thirdEave（前退台＋后檐各 800 → 进深 9800）。
  // site.eave 仅表示辅楼四面挑出（默认与主楼同为 800），勿再当作主楼后檐。
  roofRise: 0.45 * (9800 - 2 * roofTileInset) / 2,
  eave: 800,
  secondFrontEave: 800,
  thirdEave: 800,
  // 西侧客厅4600＋堂屋4500＋东翼4500；门厅前沿两角为柱心。
  portico: { x: 11200, w: 4500, projection: 2000 },
  // 设计建议：室内一楼比院坪高三步。每步 150mm，不是测绘。面对房子时左侧为东。
  entranceRise: 450,
  rearField: 2500,
  originalField: -2000,
  // 旁田未挖；暂沿用原田面示意标高，但作为独立参数，不跟随地库完成面。
  adjacentUnexcavatedLevel: -2000,
  // 最新现场关系：地库外第一田再低2000，前方砖房台地再低1500。
  frontFieldDrop: 2000,
  frontHouseDrop: 1500,
  garageClear: 2500,
  // 450 是示意结构占用，不是设计梁高。地库绝对标高尚待联测。
  deckStructure: 450,
  garageFloor: -2950,
  latitude: 28.153355,
  longitude: 111.156546,
  // 西端不收尖。东端与旁边木屋前的接通院坪取同一外沿。
  field: [
    [0, 0],
    [21000, 0],
    ...courtyardFront.slice().reverse(),
  ] as Point[],
  boundary: [
    [0, 10800],
    [21000, 10800],
    ...courtyardFront.slice().reverse(),
  ] as Point[],
  cut: { x: 21000, z: -8600, w: 5000, d: 2500 },
  vehicle: {
    length: 5218,
    width: 1998,
    height: 1800,
    wheelbase: 3105,
    frontOverhang: 965,
    rearOverhang: 1148,
    groundClearance: 172,
  },
};

export const buildingAreas = {
  get main() {
    return areaM2(site.main.w, site.main.d) - (site.porticoStyle === "recessed" ? this.portico : 0);
  },
  get annex() {
    return areaM2(site.annex.w, site.annex.d);
  },
  // 按用户2026-10-21确认的方案口径，外伸通高门厅全额计入首层合计一次。
  get portico() {
    return areaM2(site.portico.w, site.portico.projection);
  },
  get total() {
    return this.main + this.annex + this.portico;
  },
};

/**
 * 户型「院坪」总图用的邻居木房占位。
 * 面宽13000、水泥2000＋木房8800＝10800：用户2026-10-16口述。
 * 水泥外院坪北缘与自家东界外沿最宽处齐平（不再北伸）；yardBeyondCement 由 rebuildCourtyardGeometry 写入。
 * 3D 左侧邻居木房随 neighborWood* 同步；前后邻房仅随东缘微调。不是测绘。
 * 平面北上东右：与自家东界（X=21000）相接后往东排。
 */
export const neighborCourtyardPlan = {
  x: site.width,
  w: 13000,
  cementFront: 0,
  cementDepth: 2000,
  woodDepth: 8800,
  /** 水泥边→邻院北缘；与自家东界外沿齐平，默认 0−(−8600)=8600 */
  yardBeyondCement: 8600,
};

// 主马路蓝顶邻房：首层与前方砖房首层同高，地下室按用户要求不建。
// roadside-villa-layout 以毫米计（与 data 同单位）。
export const roadsideVilla = placeRoadsideVilla(
  site.annex.x,
  site.garageFloor - site.frontFieldDrop - site.frontHouseDrop,
);

// 立面以新中式效果图1为准：700瓦檐、1200短柱来自用户，其余细部为造型参数。
// 官帽高柱向后退，前排只立短柱；中央露台开敞，两侧通道由后方柱墙隔开。
export const frontElevation = {
  // 露台北缘随后由 syncFrontElevation 按柱位重算；此处与默认柱位一致。
  terraceFront: site.main.z - 120 - 75 - 300,
  terraceBack: site.main.z + site.setback + 40,
  // 中间露台北缘＝门厅柱北皮。
  centerFront: site.main.z - site.portico.projection - 400,
  sideTerraces: [
    { x: site.main.x + 180, w: site.portico.x - (site.main.x + 180) },
    {
      x: site.portico.x + site.portico.w,
      w: site.main.x + site.main.w - 180 - (site.portico.x + site.portico.w),
    },
  ],
  // 贴前墙官帽柱与门厅柱共用堂屋两端分档轴线，门厅柱心在前沿两角。
  postXs: [site.portico.x, site.portico.x + site.portico.w],
  // 与一层前墙外皮同面（柱身进深 500 mm 时中心在外皮南 250 mm）；改参见 syncFrontElevation。
  postZ: site.main.z + 250,
  dividerWidth: 640,
  wallCornerXs: [site.main.x + 270, site.main.x + site.main.w - 270],
  // 包角柱外皮比墙面外凸；默认 150 mm＝15 cm，由方案尺寸 cornerProject 改写。
  // 直角原点取前墙外皮与侧墙外皮交点内侧 120 mm（与 syncFrontElevation 一致，勿写死旧 13500 坐标）。
  cornerProject: 150,
  cornerLeg: 500,
  cornerWestX: site.main.x + 120,
  cornerEastX: site.main.x + site.main.w - 120,
  // 短柱立在屋檐内挡墙上，不是直接立在露台地面。柱身 800，加 500 墙约 1300。
  balustradePostHeight: 800,
  eaveParapet: 500,
  // 两侧露台短柱柱身（中间两根与门厅柱同截面，见 balustradePosts）。盖板另在柱身外每边加 100。
  shortPostWidth: 600,
  // 柱心在北沿：内侧到前墙＝外伸−半柱（默认 2000−400＝1600）。三楼短柱与门厅柱同轴。
  porticoColumnWallGap: 1600,
  porticoColumnDepth: 800,
  porticoColumnZ: site.main.z - site.portico.projection,
  // 初始占位；加载／改参后由 villa-params.syncFrontElevation 写成与下层柱同轴。
  balustradePosts: [
    { x: 7095, z: site.main.z - 120 - 75, w: 600 },
    { x: porticoColumnCenters(site.portico)[0], z: site.main.z - site.portico.projection, w: 800 },
    { x: porticoColumnCenters(site.portico)[1], z: site.main.z - site.portico.projection, w: 800 },
    { x: 20105, z: site.main.z - 120 - 75, w: 600 },
  ],
  // 三楼瓦檐从挡墙顶落到外沿的高差，水平出檐是 secondFrontEave。380 是造型。
  tiledEaveDrop: 380,
  hatEave: 10650,
  hatFront: site.main.z - 980,
  hatWidth: site.portico.w + 1040,
};
export const frontFieldLevel = site.garageFloor - site.frontFieldDrop;

const wall = (
  a: Point,
  b: Point,
  offset?: number,
  width = 900,
  doorExtra?: Pick<WallOpening, "hinge" | "side" | "kind">,
): Wall => ({
  a,
  b,
  role: "partition",
  ...(offset === undefined ? {} : { door: { offset, width, ...doorExtra } }),
});
/** 标为方案示意承重墙（可开门洞；非结构施工图）。 */
const bearing = (w: Wall): Wall => ({ ...w, role: "bearing" });
/** 隔墙单开门：铰链侧统一贴墙角净距摆放。 */
const doorWall = (
  a: Point,
  b: Point,
  width: number,
  hinge: DoorHinge,
  side: DoorSide,
): Wall => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return wall(a, b, doorOffsetAgainstHinge(len, width, hinge), width, { hinge, side });
};
/** 床宽为占地外轮廓（含两侧床头柜），与平面／墙同比例。 */
const bed = (x: number, z: number, w = 2700): Furniture => ({
  kind: "bed",
  x,
  z,
  w,
  d: 2100,
});
const fixture = (
  kind: Furniture["kind"],
  x: number,
  z: number,
  w: number,
  d: number,
): Furniture => ({ kind, x, z, w, d });
// 楼梯在东跨：进深 2.6 m；茶室吃进多出的 0.2 m。东侧梯下公卫（南北满进深），西侧可放工位。
// 两跑沿东西：下跑向东上，东端折返。x、z 为下跑西北角。
// 默认-版本1 以用户保存稿 户型-20261017-144026 为标准，尺寸已取整对齐。
export const stairLayout = {
  // 宽 3.6：西缘相对茶室西墙内收约 0.9 m，东缘与主楼东外墙齐平（书写系 6.8＋13.5＝20.3）
  room: { x: 16700, z: 2200, w: 3600, d: 2600 },
  x: 17050,
  z: 2460,
  flight: 1000,
  gap: 180,
  risers: 20,
  tread: 250,
  landing: 800,
  /** x＝两跑沿东西（左右折返）；z＝两跑沿南北（竖向折返）。布局编辑可选。 */
  axis: "x" as "x" | "z",
  direction: "positive" as "positive" | "negative",
  lowerSide: "min" as "min" | "max",
  hole: { x: 16900, z: 2340, w: 2950, d: 2300 },
};
// 与当前几何共用的示意尺寸；不是经结构或通行设计确认的数值。
export const construction = {
  outsideWall: 240,
  partition: 120,
  floorSlab: 180,
  connectionY: 15,
  entranceTread: 300,
  entranceLandingOffset: 150,
  entranceRampRun: 2000,
};
export const circulation = {
  // 通辅楼门：落在客厅后过道中线；门洞 0.9 m（小于过道 1.2 m，两侧留边）。
  sideDoorWidth: DOOR_OPENING.room as number,
  sideDoorZ: 4800,
  // 挑空在面对房子时的右侧（西），对应参考图左侧客厅对调后的位置。
  livingVoid: { x: 6800, z: -1000, w: 4500, d: 5200 },
};

/** 通辅楼门中心 Z：始终对齐一层「客厅后过道」中线；宽度保持房门洞口，不超过过道进深。 */
export function syncSideDoorToLivingBridge() {
  const bridge = floors[0]?.rooms.find((r) => r.id === "bridge0");
  if (!bridge) return;
  circulation.sideDoorZ = bridge.z + bridge.d / 2;
  circulation.sideDoorWidth = Math.min(DOOR_OPENING.room, bridge.d - 100);
}
const stairRoom: Room = {
  id: "stair", name: "楼梯", ...stairLayout.room, kind: "stair",
  // 标签偏西，避开东侧公卫与梯下工位文字
  label: [17400, 3350],
  note: "进深2.6米；东侧梯下公卫；西侧梯下可放工位；两跑沿东西向。梯段尺寸是方案，不是结构图。",
};

export const floors: Floor[] = [
  {
    name: "一层", y: 0, height: 3600, front: -1000,
    rooms: [
      { id: "living", name: "右侧挑空客厅", ...circulation.livingVoid, kind: "living", label: [9050, 1600],
        note: "面对房子时在右侧，与堂屋打通；南墙为电视墙。北长沙发＋左右短沙发＋中茶几。二楼此处无楼板。" },
      { id: "hall", name: "堂屋", x: 11300, z: -1000, w: 4500, d: 5200, kind: "hall", label: [13550, 1600],
        note: "进深与客厅持平（5.2米）。南侧神龛墙右侧（东）预留1米开敞；东侧与茶室／楼梯开敞。" },
      { id: "bridge0", name: "客厅后过道", x: 6800, z: 4200, w: 4500, d: 1200, kind: "hall", label: [9050, 4800],
        note: "挑空客厅南侧联系带；西墙正中通辅楼门（扇叶开向主楼过道内侧）；南接南侧房。" },
      { id: "tea", name: "茶室", x: 15800, z: -1000, w: 4500, d: 3200, kind: "living", label: [18050, 500],
        note: "进深3.2米（楼梯进深收至2.6后吃进0.2米）。与堂屋、楼梯开敞。中间长桌竖放，两侧各三凳。" },
      { id: "spare", name: "南侧房 · 待定", x: 6800, z: 5400, w: 4500, d: 3600, kind: "bed", purposeStatus: "pending", label: [9050, 7200],
        note: "床头西贴墙；衣柜贴东墙。东门贴北墙，站在临时餐厅面对门往里推、门扇往右（北）。用途待定。" },
      { id: "corridor0", name: "临时餐厅", x: 11300, z: 5400, w: 4500, d: 3600, kind: "dining", label: [13550, 7200],
        note: "南墙内开门通屋后（铰链靠西／左），窗居中。" },
      { ...stairRoom, id: "stair0" },
      { id: "stairBath0", name: "梯下公卫", x: 18800, z: 2200, w: 1500, d: 2600, kind: "bath", label: [19550, 3500],
        note: "楼梯间东侧南北满进深、东缘贴主楼东外墙；西墙内门入（铰链靠南／右）；马桶靠北、洗漱靠南。" },
      { id: "elder", name: "尊亲房", x: 15800, z: 4800, w: 4500, d: 4200, kind: "bed", label: [18050, 6900],
        note: "北端内卫东3米。床头东贴墙；衣柜贴西墙。西门内开（铰链靠北／左）。" },
      { id: "ensuite", name: "尊亲房内卫", x: 17300, z: 4800, w: 3000, d: 1500, kind: "bath", label: [18800, 5550],
        note: "靠东3×1.5米；西墙门入卧室区（铰链贴墙角）。东淋浴、中马桶、西洗漱。" },
    ],
    // 承重示意：外墙另绘；内墙仅标开间轴 X≈11.3／15.8、横墙 Z≈4.2、楼梯南 Z≈4.8 及楼梯北残段。卫／套间墙为隔墙。
    partitions: [
      bearing(wall([6800, 4200], [11300, 4200])),
      bearing(wall([11300, 4200], [14800, 4200])),
      wall([6800, 5400], [11300, 5400]),
      // 竖墙 a→b 向南：side in＝扇叶向东，out＝向西（与 openings SVG 一致）
      // 南侧房门：贴北墙；站在临时餐厅面对门往里推，门扇往右（北）＝hinge start + side out
      bearing(doorWall([11300, 5400], [11300, 9000], DOOR_OPENING.room, "start", "out")),
      bearing(wall([15800, 4800], [20300, 4800])),
      // 尊亲房：内开入房（东），走廊看铰链在左＝北＝start
      bearing(doorWall([15800, 4800], [15800, 9000], DOOR_OPENING.room, "start", "in")),
      // 内卫：内开入卫（东），铰链贴南角；卫门洞口小于房门
      doorWall([17300, 4800], [17300, 6300], DOOR_OPENING.bath, "end", "in"),
      wall([17300, 6300], [20300, 6300]),
      // 梯下公卫：内开入卫（东），楼梯看铰链在右＝南＝end
      doorWall([18800, 2200], [18800, 4800], DOOR_OPENING.bath, "end", "in"),
      bearing(wall([18800, 2200], [20300, 2200])),
    ],
    furniture: [
      { ...fixture("sofa", 9050, -300, 2600, 900), rotation: Math.PI },
      { ...fixture("sofa", 7500, 1750, 1650, 850), rotation: -Math.PI / 2 },
      { ...fixture("sofa", 10800, 1750, 1650, 850), rotation: Math.PI / 2 },
      fixture("coffeeTable", 9050, 1700, 1150, 700),
      { ...fixture("tv", 9050, 3950, 1500, 350), label: "电视" },
      { ...fixture("shrine", 13550, 3950, 1800, 420), label: "神龛" },
      { ...fixture("table", 18050, 550, 750, 2400), label: "茶桌" },
      { ...fixture("chair", 17350, -300, 380, 400), rotation: -Math.PI / 2 },
      { ...fixture("chair", 17350, 550, 380, 400), rotation: -Math.PI / 2 },
      { ...fixture("chair", 17350, 1400, 380, 400), rotation: -Math.PI / 2 },
      { ...fixture("chair", 18750, -300, 430, 450), rotation: Math.PI / 2 },
      { ...fixture("chair", 18750, 550, 430, 450), rotation: Math.PI / 2 },
      { ...fixture("chair", 18750, 1400, 430, 450), rotation: Math.PI / 2 },
      { ...fixture("toilet", 19500, 2750, 480, 700), rotation: Math.PI, label: "公卫马桶" },
      { ...fixture("basin", 19500, 4250, 550, 400), rotation: Math.PI, label: "公卫洗漱" },
      { ...fixture("table", 17300, 4500, 1000, 550), rotation: Math.PI, label: "工位" },
      { ...bed(8100, 7050, 2200), rotation: -Math.PI / 2 },
      { ...fixture("wardrobe", 10950, 7900, 1600, 500), rotation: -Math.PI / 2 },
      { ...bed(19000, 7650, 2200), rotation: Math.PI / 2 },
      { ...fixture("wardrobe", 16150, 7900, 1600, 500), rotation: Math.PI / 2 },
      { ...fixture("shower", 19700, 5400, 700, 1000) },
      fixture("toilet", 18900, 5350, 480, 700),
      fixture("basin", 18150, 5200, 700, 450),
    ],
  },
  {
    name: "二层", y: 3600, height: 3600, front: -1000,
    rooms: [
      { id: "void", name: "右侧客厅上空", ...circulation.livingVoid, kind: "void", label: [9050, 1500],
        note: "挑空无二层楼板；南缘实体墙隔主卧内卫；临空边按实际范围自动生成栏杆。西外墙不开窗。" },
      { id: "family1", name: "起居室", x: 11300, z: -1000, w: 4500, d: 6400, kind: "living", label: [13550, 2000],
        note: "堂屋上方。西侧临挑空，自动生成栏杆；沙发背靠东墙面向挑空。南墙西进主卧衣帽间、东进短过道（通公卫／东南卧）。" },
      // 原挑空边过道加深为内卫；门靠东，西淋浴／中马桶／东洗漱沿北墙。
      { id: "masterBath2", name: "主卧内卫", x: 6800, z: 4200, w: 4500, d: 1800, kind: "bath", label: [9050, 5100],
        note: "北墙贴挑空南缘（实体墙，非栏杆）。南门靠东入（贴衣帽间一侧），避免挡床。西外墙不开窗。" },
      { id: "masterBed2", name: "主卧室", x: 6800, z: 6000, w: 4500, d: 3000, kind: "bed", label: [9050, 7500],
        note: "西房：床头贴西墙（无窗，不朝南窗）；东侧走道通衣帽间与内卫。经衣帽间进出。" },
      // 后过道西半＝衣帽间（套间门厅）；东半北＝短过道、南＝公卫（避免穿卫入东南卧）
      { id: "closet2", name: "主卧衣帽间", x: 11300, z: 5400, w: 2250, d: 3600, kind: "store", label: [12400, 7000],
        note: "北门起居进；西门靠南入主卧；衣柜贴东墙，西侧留走道。" },
      { id: "hall2", name: "东侧短过道", x: 13550, z: 5400, w: 2250, d: 1200, kind: "hall", label: [14650, 6000],
        note: "后过道东半北段；北接起居，东门进东南卧，南门进公卫。" },
      { id: "bath1", name: "公卫", x: 13550, z: 6600, w: 2250, d: 2400, kind: "bath", label: [14650, 7800],
        note: "北门自短过道进。洗漱靠北、马桶靠南；不与卧室共用门。" },
      { id: "front2", name: "东前卧室", x: 15800, z: -1000, w: 4500, d: 3200, kind: "bed", label: [18050, 600],
        note: "东房：床头贴东墙（无窗）；衣柜贴南墙。西门贴楼梯南端，门口留空。" },
      { id: "bedEast2", name: "东南卧室", x: 15800, z: 4800, w: 4500, d: 4200, kind: "bed", label: [18050, 7200],
        note: "东房：床头贴东墙（无窗）；衣柜贴西墙南段，不挡北侧门。" },
      { ...stairRoom, id: "stair1" },
    ],
    // 承重示意：X≈11.3／15.8 开间轴、楼梯南北墙；衣帽／公卫中缝 X≈13.55 与套间小墙为隔墙（不落承重轴）。
    partitions: [
      // 挑空南缘／内卫北墙：实体墙（非栏杆）
      bearing(wall([6800, 4200], [11300, 4200])),
      // 内卫东墙（对起居／衣帽间北段，无门）
      bearing(wall([11300, 4200], [11300, 5400])),
      bearing(wall([11300, 5400], [11300, 6000])),
      // 内卫南墙：门靠东（贴衣帽间）；内开入卫（北）＝side out（a→b 向东时 out＝北）
      doorWall([6800, 6000], [11300, 6000], DOOR_OPENING.bath, "end", "out"),
      // 衣帽间 → 主卧：门靠南；内开入卧（西）＝side out（a→b 向南时 out＝西）
      bearing(doorWall([11300, 6000], [11300, 9000], DOOR_OPENING.room, "end", "out")),
      // 衣帽间／东侧短过道＋公卫 分户墙
      wall([13550, 5400], [13550, 9000]),
      // 起居 → 衣帽间
      doorWall([11300, 5400], [13550, 5400], DOOR_OPENING.room, "start", "in"),
      // 起居 → 东侧短过道
      doorWall([13550, 5400], [15800, 5400], DOOR_OPENING.room, "start", "in"),
      // 短过道 → 公卫（南墙）
      doorWall([13550, 6600], [15800, 6600], DOOR_OPENING.bath, "start", "in"),
      // 东前卧：门靠楼梯（南端）
      bearing(doorWall([15800, -1000], [15800, 2200], DOOR_OPENING.room, "end", "in")),
      bearing(wall([16700, 2200], [20300, 2200])),
      bearing(wall([15800, 4800], [20300, 4800])),
      // 东南卧西墙：短过道段开门（z=5.4–6.6）；以南实墙隔公卫
      bearing(doorWall([15800, 5400], [15800, 6600], DOOR_OPENING.room, "start", "in")),
      bearing(wall([15800, 6600], [15800, 9000])),
    ],
    furniture: [
      // 起居：长沙发背靠东墙面向挑空，茶几居中偏西；南侧留门
      { ...fixture("sofa", 15150, 1800, 2400, 900), rotation: Math.PI / 2 },
      { ...fixture("sofa", 13000, 350, 1500, 850), rotation: Math.PI },
      fixture("coffeeTable", 13700, 1850, 1100, 700),
      // 主卧（西房）：床头贴西墙（−90°，同一层南侧房）；不朝南窗；东侧走道
      { ...bed(7950, 7550, 2200), rotation: -Math.PI / 2 },
      // 衣帽间：衣柜贴东墙（−90°），西侧走道
      { ...fixture("wardrobe", 13250, 6550, 1600, 500), rotation: -Math.PI / 2, label: "衣柜" },
      { ...fixture("wardrobe", 13250, 8250, 1600, 500), rotation: -Math.PI / 2, label: "衣柜" },
      // 主卧内卫：淋浴／马桶／洗漱贴北墙
      { ...fixture("shower", 7500, 4500, 900, 700) },
      fixture("toilet", 9200, 4550, 480, 700),
      fixture("basin", 10600, 4500, 700, 450),
      // 公卫：洗漱贴北墙、马桶贴南墙
      { ...fixture("basin", 14650, 6850, 550, 400), rotation: Math.PI, label: "公卫洗漱" },
      fixture("toilet", 14650, 8390, 480, 700),
      // 东前卧（东房）：床头贴东墙（+90°）；衣柜贴南墙（不朝北玻）
      { ...bed(18950, 550, 2200), rotation: Math.PI / 2 },
      { ...fixture("wardrobe", 17100, 1900, 1600, 500), rotation: 0 },
      // 东南卧（东房）：床头贴东墙；衣柜贴西墙（同一层尊亲房）
      { ...bed(19000, 7700, 2200), rotation: Math.PI / 2 },
      { ...fixture("wardrobe", 16150, 8300, 1600, 500), rotation: Math.PI / 2 },
    ],
  },
  {
    name: "三层", y: 7200, height: 3300, front: 800,
    rooms: [
      { id: "family2", name: "家庭多功能厅", x: 11300, z: 800, w: 4500, d: 4600, kind: "living", label: [13550, 2700],
        note: "按参考图放在中间，北侧接通中央露台。" },
      { id: "master5", name: "主卧室", x: 6800, z: 800, w: 4500, d: 3600, kind: "bed", label: [9050, 2300],
        note: "参考图右侧前部的主卧，北侧接通西侧露台，自带衣帽间和内卫。" },
      { id: "ensuite5", name: "主卧内卫", x: 6800, z: 4400, w: 2200, d: 1800, kind: "bath", label: [7850, 5300] },
      { id: "closet5", name: "主卧衣帽间", x: 9000, z: 4400, w: 2300, d: 1800, kind: "store", label: [10150, 5300] },
      { id: "media", name: "影音室", x: 6800, z: 6200, w: 4500, d: 2800, kind: "living", label: [9050, 7550],
        note: "按参考图放在主卧后部，从后过道进入。" },
      { id: "lobby3", name: "东侧过厅", x: 15800, z: 800, w: 4500, d: 1200, kind: "hall", label: [18050, 1350],
        note: "茶室上方、楼梯以北。三楼默认北退 1.2 米之后，这里只剩约 1.2 米进深，作为东侧露台进来的过厅，西侧通家庭厅。" },
      { id: "bed6", name: "卧室", x: 15800, z: 4800, w: 4500, d: 4200, kind: "bed", label: [17150, 7550],
        note: "在楼梯南侧，与一楼尊亲房对齐。北侧是内卫，南侧放床。从后过道进入。" },
      { id: "bath6", name: "卧室内卫", x: 18300, z: 4800, w: 2000, d: 2200, kind: "bath", label: [19300, 5850] },
      { id: "corridor2", name: "后过道", x: 11300, z: 5400, w: 4500, d: 3600, kind: "hall", label: [13400, 7300] },
      { ...stairRoom, id: "stair2" },
    ],
    // 承重示意：开间轴、楼梯围合、中横墙；主卧套间／影音小墙为隔墙。
    partitions: [
      bearing(wall([11300, 800], [11300, 4400], 1150, DOOR_OPENING.room)),
      bearing(wall([11300, 4400], [11300, 6200])),
      bearing(wall([11300, 6200], [11300, 9000], 400, DOOR_OPENING.room)),
      wall([6800, 4400], [9000, 4400], 500, DOOR_OPENING.bath),
      bearing(wall([9000, 4400], [11300, 4400], 600, DOOR_OPENING.room)),
      wall([9000, 4400], [9000, 6200]),
      wall([6800, 6200], [11300, 6200]),
      bearing(wall([11300, 5400], [15800, 5400], 2400, DOOR_OPENING.room)),
      bearing(wall([15800, 800], [15800, 2200], 280, DOOR_OPENING.room)),
      bearing(wall([16700, 2200], [20300, 2200])),
      bearing(wall([15800, 4800], [20300, 4800])),
      bearing(wall([15800, 4800], [15800, 9000], 900, DOOR_OPENING.room)),
      wall([18300, 4800], [18300, 7000], 550, DOOR_OPENING.bath),
      wall([18300, 7000], [20300, 7000]),
    ],
    furniture: [
      bed(9050, 2150, 2700),
      fixture("wardrobe", 7250, 3300, 450, 1200),
      bed(17150, 7700),
      fixture("wardrobe", 16250, 8400, 450, 1000),
      fixture("sofa", 8200, 7150, 900, 2100),
      fixture("table", 13550, 2400, 1400, 750),
      fixture("sofa", 12350, 3550, 850, 1600),
      fixture("toilet", 7350, 5550, 480, 700),
      fixture("basin", 8350, 4850, 550, 400),
      fixture("toilet", 19700, 5550, 480, 700),
      fixture("basin", 18850, 6450, 550, 400),
    ],
  },
];

export const annexRooms: Room[] = [
  { id: "dining", name: "餐厅", x: 800, z: 0, w: 4500, d: 4800, kind: "dining", label: [3050, 2400],
    note: "圆桌居中六座。东侧通楼门：站在子孙道面对门往里推，门扇往右（北）；南与厨房隔墙正中推拉门。" },
  { id: "cook", name: "整体厨房", x: 800, z: 4800, w: 4500, d: 3200, kind: "kitchen", label: [3050, 6400],
    note: "北隔墙正中推拉门通餐厅；东墙无门无窗。日常灶靠北墙西端、柴火灶靠西墙距南1米左右摆放，成L型；储柴在柴火灶南、南窗旁贴西墙。" },
];
// 餐厅／厨房隔墙：正中推拉门
export const annexPartitions = [
  wall(
    [800, 4800],
    [5300, 4800],
    (4500 - DOOR_OPENING.sliding) / 2,
    DOOR_OPENING.sliding,
    { kind: "slidingDoor" },
  ),
];
/** 辅楼家具：圆桌在餐厅居中；厨房 L 型灶具＋储柴。 */
export const annexFurniture: Furniture[] = [
  fixture("roundTable", 3050, 2400, 1600, 1600),
  ...Array.from({ length: 6 }, (_, i): Furniture => {
    const a = (i * Math.PI) / 3;
    return {
      kind: "chair",
      x: 3050 + Math.cos(a) * 1050,
      z: 2400 + Math.sin(a) * 1050,
      w: 430,
      d: 450,
      rotation: -a + Math.PI / 2,
    };
  }),
  { ...fixture("hob", 1550, 5200, 750, 600), rotation: Math.PI, label: "日常灶" },
  { ...fixture("stove", 1700, 6650, 700, 1500), rotation: Math.PI / 2, label: "柴火灶" },
  { ...fixture("wardrobe", 1200, 7550, 700, 550), rotation: Math.PI / 2, label: "储柴" },
];

/**
 * 主楼／辅楼室内坐标按书写系（主楼前墙 Z=-1000、X=6800、面宽13500；辅楼前墙 Z=0、X=800、面宽4500）书写。
 * 外包络变更后，加载时以东南角为不动点缩放并平移到当前 site，避免漏改墙／家具。
 */
(function alignPlanToEnvelope(
  authoredMain = { x: 6800, z: -1000, w: 13500, d: 10000 },
  authoredAnnex = { x: 800, z: 0, w: 4500, d: 8000 },
) {
  const sx = site.main.w / authoredMain.w;
  const sz = site.main.d / authoredMain.d;
  const asx = site.annex.w / authoredAnnex.w;
  const asz = site.annex.d / authoredAnnex.d;
  const oE = authoredMain.x + authoredMain.w;
  const oS = authoredMain.z + authoredMain.d;
  const nE = site.main.x + site.main.w;
  const nS = site.main.z + site.main.d;
  const aoE = authoredAnnex.x + authoredAnnex.w;
  const aoS = authoredAnnex.z + authoredAnnex.d;
  const anE = site.annex.x + site.annex.w;
  const anS = site.annex.z + site.annex.d;
  const fixedFurniture = new Set<Furniture["kind"]>([
    "bed", "toilet", "squatToilet", "shower", "roundTable", "basin", "chair", "hob", "sink", "stove",
  ]);
  const mapPoint = (p: Point, east0: number, south0: number, east1: number, south1: number, kx: number, kz: number): Point => [
    east1 - (east0 - p[0]) * kx,
    south1 - (south0 - p[1]) * kz,
  ];
  const mapRoom = (r: Room, east0: number, south0: number, east1: number, south1: number, kx: number, kz: number) => {
    r.x = east1 - (east0 - r.x) * kx;
    r.z = south1 - (south0 - r.z) * kz;
    r.w *= kx;
    r.d *= kz;
    if (r.label) r.label = mapPoint(r.label, east0, south0, east1, south1, kx, kz);
  };
  const mapFurniture = (f: Furniture, east0: number, south0: number, east1: number, south1: number, kx: number, kz: number) => {
    f.x = east1 - (east0 - f.x) * kx;
    f.z = south1 - (south0 - f.z) * kz;
    if (!fixedFurniture.has(f.kind) && !getFloorplanFurniture(f.kind)) {
      f.w *= kx;
      f.d *= kz;
    }
  };
  const mapWall = (w: Wall, east0: number, south0: number, east1: number, south1: number, kx: number, kz: number) => {
    const oldLen = Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]);
    const door = w.door;
    const marginT =
      door && oldLen > door.width + 1e-6
        ? door.offset / (oldLen - door.width)
        : 0;
    w.a = mapPoint(w.a, east0, south0, east1, south1, kx, kz);
    w.b = mapPoint(w.b, east0, south0, east1, south1, kx, kz);
    if (door) {
      // 洞口宽度保持市面标准档；offset 按「在可滑动余量上的相对位置」重算，避免默认面宽≠书写系时把 900 放大成 ~907。
      const len = Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]);
      const width = door.width;
      const offset = Math.min(Math.max(0, marginT * Math.max(0, len - width)), Math.max(0, len - width));
      w.door = { ...door, offset, width };
    }
  };
  const mainChanged =
    Math.abs(sx - 1) > 1e-9 || Math.abs(sz - 1) > 1e-9 ||
    Math.abs(site.main.x - authoredMain.x) > 1e-6 || Math.abs(site.main.z - authoredMain.z) > 1e-6;
  const annexChanged =
    Math.abs(asx - 1) > 1e-9 || Math.abs(asz - 1) > 1e-9 ||
    Math.abs(site.annex.x - authoredAnnex.x) > 1e-6 || Math.abs(site.annex.z - authoredAnnex.z) > 1e-6;
  if (mainChanged) {
    for (const floor of floors) {
      floor.front = nS - (oS - floor.front) * sz;
      floor.rooms.forEach((r) => mapRoom(r, oE, oS, nE, nS, sx, sz));
      floor.partitions.forEach((w) => mapWall(w, oE, oS, nE, nS, sx, sz));
      floor.furniture.forEach((f) => mapFurniture(f, oE, oS, nE, nS, sx, sz));
    }
    const mapBox = (b: { x: number; z: number; w?: number; d?: number }) => {
      b.x = nE - (oE - b.x) * sx;
      b.z = nS - (oS - b.z) * sz;
      if (typeof b.w === "number") b.w *= sx;
      if (typeof b.d === "number") b.d *= sz;
    };
    mapBox(stairLayout.room);
    stairLayout.x = nE - (oE - stairLayout.x) * sx;
    stairLayout.z = nS - (oS - stairLayout.z) * sz;
    mapBox(stairLayout.hole);
    circulation.sideDoorZ = nS - (oS - circulation.sideDoorZ) * sz;
    mapBox(circulation.livingVoid);
  }
  if (annexChanged) {
    annexRooms.forEach((r) => mapRoom(r, aoE, aoS, anE, anS, asx, asz));
    annexPartitions.forEach((w) => mapWall(w, aoE, aoS, anE, anS, asx, asz));
    annexFurniture.forEach((f) => mapFurniture(f, aoE, aoS, anE, anS, asx, asz));
  }
  syncSideDoorToLivingBridge();
})();

export const facts: Fact[] = [
  {
    label: "主马路边蓝顶邻房",
    value: "三层 · 三开间 · 左侧平顶柴火房",
    source: "用户提供",
    note: "对应红框内的房子：主楼三层、三开间，四坡五脊带中央官帽，前面有罗马柱门厅。面对这栋邻房时，柴火房在左侧，只有一层平顶；地下室未建模。首层与自家前方砖房首层同高。",
  },
  {
    label: "蓝顶邻房与辅楼延长线",
    value: `约 ${roadsideVilla.extensionGap} mm`,
    source: "用户提供",
    note: "站在北侧面对自家，辅楼最右侧是西墙 X=0.8。沿这面墙向房前延长，仍不碰到蓝顶邻房。约5米按延长线到邻房整栋最东侧外墙的横向空隙表达，包含左侧柴火房，不是屋檐或用地界址的实测间距。",
  },
  {
    label: "蓝顶邻房朝向与外形",
    value: `北偏西约 ${roadsideVilla.angle}° · 照片估算`,
    source: "照片估算",
    note: `依据 DJI 132622 的俯拍屋面、IMG_5123 的屋脊和前坪，以及 IMG_5128、IMG_5135、IMG_5120 的立面交叉判断。沿用场景北向，暂转向西北约${roadsideVilla.angle}°；主楼暂${roadsideVilla.w}×${roadsideVilla.d}毫米，三层层高暂${roadsideVilla.floorHeights.join("/")}毫米，柴火房暂${roadsideVilla.wing.w}×${roadsideVilla.wing.d}毫米。蓝瓦、粉白柱栏、各层中央阳台、侧面三楼开敞廊按照片近似；照片中的菱格前坪改按“邻居院坪”铺装选项显示，默认普通水泥地。官帽为接入正屋的前伸屋面，前端带三角山墙。所有外观尺寸及纵向位置均待核对，不能作为测绘。`,
  },
  {
    label: "主楼三层户型",
    value: "右客厅 · 茶室 · 楼梯在东",
    source: "设计建议",
    note: "方位以面对房子为准：挑空客厅在右侧，左侧前部为 4.5×3 米茶室，楼梯在茶室和尊亲房之间，尊亲房靠南并带内卫。堂屋后只留空位。二楼挑空仍在右侧，茶室上方是进深 3 米的卧室，主卧在楼梯南侧。三楼东侧只留楼梯北的过厅和楼梯南的卧室。房间尺寸是方案，不是施工图。辅楼厨房未改。",
  },
  {
    label: "东西总面宽",
    value: "21000 mm",
    source: "用户提供",
    note: "总宽含西侧0.8米、东侧0.8米及中间1.8米子孙道：0.8＋4.0＋1.8＋13.6＋0.8＝21米。均为当前方案口径，界址与墙至界距离须现场复核，不再另加侧道。",
  },
  {
    label: "邻居木房院坪占位",
    value: "面宽13000 mm · 进深10800 mm · 水泥外与东界外沿齐平",
    source: "用户提供",
    note: "从自家东界往东13米为邻居面宽；水泥边到屋后最里10.8米＝木房8.8＋房前水泥2。水泥外院坪北缘与自家东界外沿最宽处齐平向东拉，不再北伸（约8.6米，随院坪东端变化）。3D邻房仍可能约12米旧估算，以口述与现场为准。",
  },
  {
    label: "旧台地进深",
    value: "10800 mm",
    source: "用户提供",
    note: "包含房前、房后水泥空地，不含前方旱地。",
  },
  {
    label: "院坪南北总进深",
    value: "东19400 / 中约15800 / 西11000 mm",
    source: "用户提供",
    note: "2026-10-16：屋后梯田边到老水泥地边10.8米；水泥边再往前到外沿为东界8.6、自东界往西约11米处5、西端0.2。合计东19.4、中15.8、西11。模型用(0,−0.2)(10,−5)(21,−8.6)三点过圆；辅楼前墙内退后西端前墙外约0.2米。不是测绘。",
  },
  {
    label: "地块边界折点",
    value: "参考轮廓",
    source: "照片估算",
    note: "红线表示田埂外沿，周边各条红线不全是自家界址。无地籍或现场控制点，不能用本模型认定土地界址。",
  },
  {
    label: "屋后高田",
    value: "+2500 mm",
    source: "用户提供",
    note: "相对原房前坪；新院坪暂取同标高，需联测。原旱地相对前坪低约2米单独用于现状。",
  },
  {
    label: "地库前方两级梯田",
    value: "地库下2000，再下1500 mm",
    source: "用户提供",
    note: `按新说明：第一田比地库低约2米，前方砖房台地再低约1.5米。随地库示意标高表达为${Math.round(frontFieldLevel)}毫米和${Math.round(frontFieldLevel - site.frontHouseDrop)}毫米，绝对标高待测。`,
  },
  {
    label: "主楼 / 辅楼",
    get value() { return `${buildingAreas.main.toFixed(1)} / ${buildingAreas.annex.toFixed(1)} ㎡`; },
    source: "设计建议",
    get note() { return `主辅楼按当前尺寸参数计算；辅楼前墙内退${site.annex.z - site.main.z} mm，后墙齐平。加上门厅${buildingAreas.portico.toFixed(1)}㎡，首层建筑面积合计${buildingAreas.total.toFixed(1)}㎡；报建面积以核定为准。`; },
  },
  {
    get label() { return site.porticoStyle === "recessed" ? "凹入通高门厅" : "外伸通高门厅"; },
    get value() { return `${site.porticoStyle === "recessed" ? "凹入" : "外伸"}${site.portico.projection} mm / 计入${buildingAreas.portico.toFixed(1)}㎡`; },
    source: "用户提供",
    get note() { return `堂屋／门厅面宽${site.portico.w} mm（两柱柱心对齐门厅前沿两角，柱心距等于面宽）、${site.porticoStyle === "recessed" ? "凹入" : "外伸"}${site.portico.projection} mm，${site.porticoStyle === "recessed" ? "主楼先扣凹口；" : ""}投影${buildingAreas.portico.toFixed(1)}㎡全额计入首层合计一次。柱间二楼无平台，三楼为露台；首层合计${buildingAreas.total.toFixed(1)}㎡，不等于全楼各层建筑面积总和。`; },
  },
  {
    label: "飘檐 / 官帽 / 天沟",
    value: "二楼前800 mm / 三楼四面800 mm",
    source: "用户提供",
    note: "主楼屋顶、辅楼四面与二楼顶部挑檐默认均出800 mm。二楼顶部（三楼栏杆下）无天沟：瓦铺到檐边，下方为薄檐板与梁托；主辅楼屋顶及官帽保留天沟、反坎、压顶和三眼皮。梁托默认500×200×160。主楼东檐约超地块东界100 mm，辅楼前檐可略超院坪西端外沿，邻居／院坪间距仍需现场复核。",
  },
  {
    label: "院坪与人行通道",
    value: "前约2000 mm / 侧过道800 mm",
    source: "用户提供",
    note: "院坪中间地库楼梯及护栏已取消；辅楼前绕右侧过道通往后段同高梯田。侧过道0.8米为墙至界，栏杆占用后略窄。前方电杆及架空线按拆除计划移除。",
  },
  {
    label: "两侧 / 子孙道",
    get value() { return `西${site.sideGap}／东${site.width - Math.max(site.main.x + site.main.w, site.annex.x + site.annex.w)}／${site.lane} mm`; },
    source: "设计建议",
    get note() { return `墙面间距，需另扣栏杆；当前${site.buildingPlacement === "main-east" ? "主楼在东、辅楼在西" : "主楼在西、辅楼在东"}，主辅楼面宽${site.main.w}／${site.annex.w} mm、子孙道${site.lane} mm；两侧余量与总宽同步重算。屋檐及邻居间距仍需现场复核。`; },
  },
  {
    label: "后退 / 前伸",
    value: "1200 / 约400 mm",
    source: "设计建议",
    note: "屋后至梯田边预留默认1.2米；主楼进深10米时前墙约在Z=−0.4（相对旧水泥边），前伸量随预留与进深变化，不是固定1米。",
  },
  {
    label: "层高",
    value: "3600 / 3600 / 3300 mm",
    source: "用户提供",
    note: "墙身和檐口仍按楼面0、3.6、7.2米、檐口10.5米。室内一楼完成面比院坪高0.45米，这是三步×150毫米的设计高度，不是测绘。门厅台阶、门前垫高和左右坡道用深褐近黑的抛光石，带浅麻点，对照用户照片，不是石材色卡。踏步前沿防滑线收细，颜色只比石面略浅。石面反光压低，正面看也是深色，不是只在俯瞰时才显出颜色。两根门厅柱前面是整块垫高，三步只嵌在柱与柱中间。门厅两柱柱心落在门厅北沿的两个直角顶点，柱身与饰线跨轴线居中；柱内侧到前墙＝外伸−半柱（默认 1.6 米）。面对房子时左右各有一条约2米的侧坡道·坡度待核，外侧边贴着柱子北缘，分别向东、向西降，按0.45米高差/2米投影约22.5%，仅是现有几何示意，适老和无障碍使用条件待设计核定。坡道防滑条改细，颜色只比石面略浅。屋顶没有跟着抬。",
  },
  {
    label: "三楼北退",
    get value() { return site.setback > 0 ? `${site.setback} mm` : "不内退"; },
    source: "设计建议",
    get note() { return `三楼主体外包络${site.main.w}×${site.main.d - site.setback} mm；${site.setback > 0 ? "仅北侧退台，两侧露台与中央露台分开" : "两翼前墙与二楼齐平，取消两侧露台、栏杆及短柱，保留中央门厅露台"}。`; },
  },
  {
    label: "梁板与屋脊",
    value: "示意构件",
    source: "设计建议",
    note: "院坪结构占用暂0.45米，主楼檐口10.5米。主楼、辅楼四坡默认4.5分水，当前探索值见分水控件及导出图册；这是设计坡度，不是测绘。默认使用按2026-10-15用户参考图近似的悬浮官帽，帽脊默认低于主脊约50厘米，纵脊直接接入正屋前坡，前斜脊与主屋两侧斜脊平行，檐底贴近屋面；后侧及两侧后段融入正屋。普通官帽作为可选造型，与正屋同脊高、檐口相连，瓦面独立加宽、前部起脊点后移。正屋与辅楼的檐口和主体尺寸不随造型切换改变。天沟净宽、净深及挡墙顶面找坡按用户要求设置；其他屋脊、抬高量与构件仍为造型示意，非实测或结构施工尺寸。",
  },
  {
    label: "天沟净尺寸与挡墙顶面",
    value: `净宽${roofGutterDesign.clearWidth * 1000}mm、外边反坎高${roofGutterDesign.clearDepth * 1000}mm、内侧反坎高${roofGutterDesign.innerDepth * 1000}mm、外边顶宽${roofGutterDesign.outerTopWidth * 1000}mm、找坡${Math.round((Math.atan(roofGutterDesign.bedSlope) * 180) / Math.PI)}°、瓦至内挡顶${roofGutterDesign.tileGap * 1000}mm、瓦边探入${roofGutterDesign.tileOverhang * 1000}mm，压顶内倾${roofGutterDesign.copingSlopeDegrees}°`,
    source: "用户提供",
    note: "净宽600、外边反坎高200、内侧250、外边顶宽300、槽底找坡默认1°、压顶外飘三眼皮20毫米来自本轮方案；外边反坎立面与压顶、三眼皮同为英国棕。瓦至内挡顶与瓦边探入沿用前轮。内挡厚55毫米为模型取值。三眼皮出檐与级高、下沿线凸出／高度为固定造型。",
  },
  {
    label: "地库净高 / 入口",
    value: "2500 / 2500 mm",
    source: "用户提供",
    note: "地库最低净高为目标。柱只排两列：外沿内收0.55米一排，自家房前墙下和邻居木屋前墙下一排，中间不立柱，柱距4.2米。东端净跨大约8到10米，0.45米只是结构占用预留，梁高、跨度、承载与净高须由结构师结合勘察计算，现无承载结论。邻居木屋前的地下室按用户说明归自家，外侧用同一道约1米矮墙，上面敞开；邻居自己房子下面的地下室外侧不另加遮挡。",
  },
  {
    label: "道路与坡道",
    value: "需实测",
    source: "待测",
    note: "左侧马路从前方台地连续上坡，接到屋后第一层与东侧大平地的同一标高后停止，不再往南爬。屋后木房左侧不再留路。接入标高、坡道长度、折点和转弯区域仍未实测。",
  },
  {
    label: "邻居平台切除",
    value: "需协商与复核",
    source: "待测",
    note: "邻居木屋前的田已与他家左侧院坪、自家院坪拉成同一标高并接通。前方砖房一层与两层的交接仍对齐堂屋中线以西约0.5米。原先画在自家东界外的5×2.5米切口不再铺成地坪；切口要按接通后的院坪边重核，不能当作可切割范围。",
  },
  {
    label: "车辆通行参数",
    value: "未完成校核",
    source: "待测",
    note: "地库页沿原有空间探索曲线显示L9整车平面扫掠，按模型柱墙投影相交、示意通道越界提示潜在风险，可点击区段定位。L9含镜宽和可靠转弯参数仍缺；路线没有按转弯半径求解，纵坡俯仰、底盘、驶出和第二辆独立进出未校核。第二辆按2025款吉利星愿外观示意，慕斯银、黑顶，尺寸用厂商公开的4135×1805×1570毫米、轴距2650毫米，不参与L9通行占位。",
  },
  {
    label: "保留地坪下方净高",
    value: "道路与最低梁底标高待联测",
    source: "待测",
    note: "地库页用橙色标出保留地坪投影及扫掠进入该投影的区段。模型板底−0.23米只用于绘图，真实最低梁底标高未知；邻居口述梁底净高1.8米、板底净高2米缺少同一基准，不能用于推算这段路面的车顶余量。拟切口协商结果待确认，未从净高待核区扣除；自家地库2.5米是目标，不是此段实测净高。",
  },
  {
    label: "邻房、树木、道路",
    value: "位置关系已按现场说明修正",
    source: "用户提供",
    note: "面对房子：道路贴左侧邻居木房左墙。木屋前面整段与左侧院坪、自家院坪同一标高接通，不再留空。两侧为梯田，树木只在后方木房之后的山上。左侧邻居木房为一明两暗，中间堂屋宽于两侧卧室；前墙与自家旧木房前墙对齐，进深约8.8米，比自家旧木房大约深0.9米，多出的长度在后墙。面宽仍是原先约12米的估算。屋后木房为八开间，面对房子时自左数第三间是稍宽的堂屋，其余为普通房间。现状里的自家旧木房也是人字坡、三开间，堂屋居中并稍宽于两侧卧室，檐口比左侧邻居木房低约0.30米。旧砖房前墙比木屋前墙大约多伸出0.9米，后墙比木房后墙更靠近后面的梯田，大约再多出1米。对照红线轮廓和DJI 135022，木屋墙面到房前水泥外沿为2米。自家砖房前坪面对房子时，左侧接到下面农田外沿，比右侧长；西端外沿栏杆封口并拉直，不留折角。最右侧栏杆超过砖房西墙约1米，沿这条路伸到与院坪同高的梯田。邻居最左侧院坪靠木房留2米缺口，出路不封死；新建前坪同样留这个出口。不在坪上另加楼梯。邻居前坪右侧栏杆与前坪直角相接，在墙前留约0.8米过人。没有水泥的邻居房前是农田，与前方田同一颜色。0.9米和2米是口述，再向外的进深和0.8米缺口是照片估算。旧白砖房平顶的前、后、右侧有栏杆，靠木房一侧不加。开间宽度是在既有总宽里划分的，不是逐间实测。",
  },
  {
    label: "前后邻房对齐",
    value: "后方木房 / 前方两层砖房",
    source: "用户提供",
    note: "两栋左边均与左侧邻居木房齐平；后方木房右边到主楼中部，前方砖房右边到主楼面宽从左起约1/3处。后方木房位于第二层梯田。",
  },
  {
    label: "辅楼右侧梯田",
    value: "同一原台地 / 地库局部下挖",
    source: "用户提供",
    note: "靠屋段上田在原先向房前伸出约1米的基础上，再向房前伸出1.5米。近屋下田北沿仍与地库右端同线，所以下田比上田窄。2026-10-13俯瞰航拍里，西侧田埂远离房子后朝南弯，不再朝北甩；远处折点是照片估算。上田齐院坪，前段原田面未挖，仍与开挖后的地库地面分开表达。",
  },
  {
    label: "旁田与地库开挖高差",
    value: "待测 · 分开表达",
    source: "待测",
    note: `未挖旁田暂取${Math.round(site.adjacentUnexcavatedLevel)}毫米、地库完成面${Math.round(site.garageFloor)}毫米，两者差${Math.round(site.adjacentUnexcavatedLevel - site.garageFloor)}毫米仅为示意。旁田参数独立，不能据此确定开挖深度。`,
  },
  {
    label: "周边高度与轮廓",
    value: "照片估算，非实测",
    source: "照片估算",
    note: "参考 DJI 131730：东侧大平地与屋后第一层梯田同一标高，沿用屋后田+2.5米，这是口述对齐，不是新的测绘。后方木房第二层田暂+5米。前方砖房右侧主体仍是两层人字坡，屋脊在原先高于自家一层顶2米的基础上整栋降低1.5米，现约高0.5米；左侧一层红顶钢架随屋脊同步降低，高点仍约低于屋脊1.8米。航拍里坡很平，起坡约0.9米。进深在原先7.5米上向北加2米，后墙和屋后田外沿不动，9.5米是照片估算。右侧高楼侧面按两间进深，每层侧面两个窗；二楼两间都在，只向北内退一条走廊，约1.4米，沿用自家过道外轮廓，不是测绘。内退的这一条是钢架加工层，人字坡屋顶仍覆盖整个进深。二楼中间不设露台栏杆。左侧矮楼是一层，墙高与主楼一层相同，东墙离开马路约0.8米，北面不砌墙。红色坡顶仍用钢架架在楼顶上，西侧高点大约低于主体屋脊1.8米，朝东降低，东檐比一层东墙再挑出约0.4米。一层与两层的交接对齐旁边邻居院坪右沿。主体北立面为三开间，中间堂屋、两侧卧室。左右分界和这些高度是口述大约值或外观调整，不是实测。左侧邻居木房和屋后木房也是人字坡，屋脊高度仍沿用原模型。台地标高仍是既有示意。道路纵坡、田坎折点、树高与屋檐间距仍未经测绘。",
  },
];

export const photos = [
  {
    file: "north.webp",
    title: "正面航拍",
    note: "DJI 135022 · 自家木房与白砖房",
    camera: "north",
  },
  {
    file: "entry.webp",
    title: "入口与邻居平台",
    note: "IMG_5116 · 露天切口拟位于东侧",
    camera: "aerial",
  },
  {
    file: "plan.webp",
    title: "屋顶与异形旱地",
    note: "俯视参考 · 非正射测绘图",
    camera: "top",
  },
  {
    file: "roadside.webp",
    title: "马路边蓝顶邻房",
    note: "IMG_5135 · 红框邻房的柱廊、官帽及平顶柴火房",
    camera: "roadside",
  },
  {
    file: "style.webp",
    title: "新中式造型参考",
    note: "用户提供 · 通高门厅、灰瓦官帽",
    camera: "north",
  },
];

export function polygonArea(points: Point[]) {
  return (
    Math.abs(
      points.reduce((s, p, i) => {
        const q = points[(i + 1) % points.length];
        return s + p[0] * q[1] - q[0] * p[1];
      }, 0),
    ) / 2
  );
}
export function contains(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, z] = polygon[i],
      [u, v] = polygon[j];
    // 地界本身也属于轮廓；容差只处理Float32网格坐标误差（0.01毫米）。
    const dx = u - x, dz = v - z, length2 = dx * dx + dz * dz;
    const t = length2 ? Math.max(0, Math.min(1, ((point[0] - x) * dx + (point[1] - z) * dz) / length2)) : 0;
    if (Math.hypot(point[0] - x - t * dx, point[1] - z - t * dz) < 0.01) return true;
    if (
      z > point[1] !== v > point[1] &&
      point[0] < ((u - x) * (point[1] - z)) / (v - z) + x
    )
      inside = !inside;
  }
  return inside;
}

export function carCorners(
  x: number,
  z: number,
  yaw: number,
  margin = 0,
): Point[] {
  const w = site.vehicle.width / 2 + margin,
    l = site.vehicle.length / 2;
  return [
    [-w, -l],
    [w, -l],
    [w, l],
    [-w, l],
  ].map(([a, b]) => [
    x + a * Math.cos(yaw) + b * Math.sin(yaw),
    z - a * Math.sin(yaw) + b * Math.cos(yaw),
  ]);
}
