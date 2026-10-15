import { smoothContour } from "./contours";
import { placeRoadsideVilla } from "./roadside-villa-layout";

// 坐标：X 向东、Y 向上、Z 向南；旧房前坪外缘 Z=0，单位均为米。
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
}
export interface Wall {
  a: Point;
  b: Point;
  door?: { offset: number; width: number };
}
export interface Furniture {
  kind:
    | "bed"
    | "sofa"
    | "table"
    | "roundTable"
    | "chair"
    | "counter"
    | "stove"
    | "hob"
    | "sink"
    | "toilet"
    | "basin"
    | "wardrobe"
    | "altar";
  x: number;
  z: number;
  w: number;
  d: number;
  rotation?: number;
  label?: string;
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

// 西端仍是旧前坪外缘外 3.1 米，不收尖。东端改为主楼前墙（Z=-1）以外 8.6 米。
// 中点取在两端连线以北，圆弧向外鼓，不再朝房子内凹。鼓出量是俯视图修正，不是新的实测。
const courtyardArcAnchors: [Point, Point, Point] = [
  [0, -3.1],
  [10.55, -8.15],
  [21.1, -1 - 8.6],
];
function circleThrough(anchors: [Point, Point, Point]) {
  const [a, b, c] = anchors;
  const [x1, z1] = a, [x2, z2] = b, [x3, z3] = c;
  const det = 2 * (x1 * (z2 - z3) + x2 * (z3 - z1) + x3 * (z1 - z2));
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
export const courtyardCircle = circleThrough(courtyardArcAnchors);
function courtyardArc(step = 2.4): Point[] {
  const { h, k, radius, sign } = courtyardCircle;
  const [x1] = courtyardArcAnchors[0];
  const [x3, z3] = courtyardArcAnchors[2];
  const points: Point[] = [];
  for (let x = x1; x < x3 - 1e-6; x += step) {
    const rise = Math.sqrt(Math.max(0, radius * radius - (x - h) ** 2));
    points.push([
      Math.round(x * 1000) / 1000,
      Math.round((k + sign * rise) * 1000) / 1000,
    ]);
  }
  points.push([x3, z3]);
  points[0] = [...courtyardArcAnchors[0]];
  return points;
}
export const courtyardFrontControls: Point[] = courtyardArc();
export const courtyardFront = smoothContour(courtyardFrontControls, 0.3);

export const site = {
  width: 21.1,
  oldDepth: 10.8,
  rearGap: 1.8,
  sideGap: 0.8,
  lane: 1.5,
  main: { x: 6.8, z: -1, w: 13.5, d: 10 },
  annex: { x: 0.8, z: -1, w: 4.5, d: 10, height: 3.6 },
  setback: 1.8,
  // 页面可改。4.5 是当前默认，不是测绘。
  roofFenShui: 4.5,
  // 主楼四坡在默认分水下的起高：天沟外轮廓进深 9.55 米，瓦边内收后半坡 4.495 米。
  roofRise: 0.45 * (9.55 - 0.56) / 2,
  eave: 0.55,
  secondFrontEave: 0.7,
  thirdEave: 0.8,
  portico: { x: 11.3, w: 4.8, projection: 2 },
  // 设计建议：室内一楼比院坪高三步。每步 150mm，不是测绘。面对房子时左侧为东。
  entranceRise: 0.45,
  rearField: 2.5,
  originalField: -2,
  // 旁田未挖；暂沿用原田面示意标高，但作为独立参数，不跟随地库完成面。
  adjacentUnexcavatedLevel: -2,
  // 最新现场关系：地库外第一田再低2米，前方砖房台地再低1.5米。
  frontFieldDrop: 2,
  frontHouseDrop: 1.5,
  garageClear: 2.5,
  // 0.45 是示意结构占用，不是设计梁高。地库绝对标高尚待联测。
  deckStructure: 0.45,
  garageFloor: -2.95,
  latitude: 28.153355,
  longitude: 111.156546,
  // 西端不收尖。东端与旁边木屋前的接通院坪取同一外沿。
  field: [
    [0, 0],
    [21.1, 0],
    ...courtyardFront.slice().reverse(),
  ] as Point[],
  boundary: [
    [0, 10.8],
    [21.1, 10.8],
    ...courtyardFront.slice().reverse(),
  ] as Point[],
  cut: { x: 21.1, z: -9.6, w: 5, d: 2.5 },
  vehicle: {
    length: 5.218,
    width: 1.998,
    height: 1.8,
    wheelbase: 3.105,
    frontOverhang: 0.965,
    rearOverhang: 1.148,
    groundClearance: 0.172,
  },
};

export const buildingAreas = {
  main: site.main.w * site.main.d,
  annex: site.annex.w * site.annex.d,
  // 几何投影，用户确认门厅另计；不冒充当地报建建筑面积口径。
  portico: site.portico.w * site.portico.projection,
};

// 主马路蓝顶邻房：首层与前方砖房首层同高，地下室按用户要求不建。
export const roadsideVilla = placeRoadsideVilla(
  site.annex.x,
  site.garageFloor - site.frontFieldDrop - site.frontHouseDrop,
);

// 立面以新中式效果图1为准：70cm瓦檐、1.2m短柱来自用户，其余细部为造型参数。
// 官帽高柱向后退，前排只立短柱；中央露台开敞，两侧通道由后方柱墙隔开。
export const frontElevation = {
  terraceFront: site.main.z + 0.04,
  terraceBack: site.main.z + site.setback + 0.04,
  centerFront: site.main.z - site.portico.projection + 0.04,
  sideTerraces: [
    { x: site.main.x + 0.18, w: site.portico.x - (site.main.x + 0.18) },
    {
      x: site.portico.x + site.portico.w,
      w: site.main.x + site.main.w - 0.18 - (site.portico.x + site.portico.w),
    },
  ],
  postXs: [site.portico.x + 0.38, site.portico.x + site.portico.w - 0.38],
  postZ: site.main.z - 0.18,
  dividerWidth: 0.64,
  wallCornerXs: [site.main.x + 0.27, site.main.x + site.main.w - 0.27],
  // 包角柱外皮比墙面凸出约15厘米，沿正面和侧面各占一截。15厘米是用户指定的造型尺寸。
  cornerProject: 0.15,
  cornerLeg: 0.5,
  cornerWestX: 6.92,
  cornerEastX: 20.42,
  // 短柱立在屋檐内挡墙上，不是直接立在露台地面。柱身 0.8 米，加 0.5 米墙约 1.3 米。
  balustradePostHeight: 0.8,
  eaveParapet: 0.5,
  // 四根露台短柱柱身。盖板另在柱身外每边加 10 厘米。门厅柱仍用下面两项里的 0.8 米。
  shortPostWidth: 0.6,
  // 门厅柱身靠墙一面到前墙外皮。1.8 米是用户指定，不是测绘。柱深 0.8 米，中心因此在外皮外 2.2 米。
  // 三楼短柱仍用下面 balustradePosts 的原位，不跟着这根柱外移。
  porticoColumnWallGap: 1.8,
  porticoColumnDepth: 0.8,
  porticoColumnZ: site.main.z - 1.8 - 0.4,
  balustradePosts: [
    { x: 7.12, z: site.main.z + 0.22, w: 0.6 },
    { x: site.portico.x + 0.38, z: site.main.z - site.portico.projection + 0.4, w: 0.8 },
    { x: site.portico.x + site.portico.w - 0.38, z: site.main.z - site.portico.projection + 0.4, w: 0.8 },
    { x: 20.0, z: site.main.z + 0.22, w: 0.6 },
  ],
  // 三楼瓦檐从挡墙顶落到外沿的高差，水平出檐是 secondFrontEave。0.38 米是造型。
  tiledEaveDrop: 0.38,
  hatEave: 10.65,
  hatFront: site.main.z - 0.98,
  hatWidth: site.portico.w + 1.04,
};
export const frontFieldLevel = site.garageFloor - site.frontFieldDrop;

const wall = (a: Point, b: Point, offset?: number, width = 0.9): Wall => ({
  a,
  b,
  ...(offset === undefined ? {} : { door: { offset, width } }),
});
const bed = (x: number, z: number, w = 1.8): Furniture => ({
  kind: "bed",
  x,
  z,
  w,
  d: 2.1,
});
const fixture = (
  kind: Furniture["kind"],
  x: number,
  z: number,
  w: number,
  d: number,
): Furniture => ({ kind, x, z, w, d });
// 楼梯在东跨，夹在茶室和尊亲房之间。两跑沿东西：下跑向东上，东端折返。x、z 为下跑西北角。西端开口对着预留空间。
export const stairLayout = {
  room: { x: 15.8, z: 2, w: 4.5, d: 2.8 },
  x: 16.52,
  z: 2.26,
  flight: 1.05,
  gap: 0.18,
  risers: 20,
  tread: 0.25,
  landing: 0.8,
  axis: "x" as const,
  hole: { x: 16.4, z: 2.14, w: 3.35, d: 2.5 },
};
// 与当前几何共用的示意尺寸；不是经结构或通行设计确认的数值。
export const construction = {
  outsideWall: 0.24,
  partition: 0.12,
  floorSlab: 0.18,
  connectionY: 0.015,
  entranceTread: 0.3,
  entranceLandingOffset: 0.15,
  entranceRampRun: 2,
};
export const circulation = {
  sideDoorZ: 4.8,
  sideDoorWidth: 1.2,
  // 挑空在面对房子时的右侧（西），对应参考图左侧客厅对调后的位置。
  livingVoid: { x: 6.8, z: -1, w: 4.5, d: 5.2 },
};
const stairRoom: Room = {
  id: "stair", name: "楼梯", ...stairLayout.room, kind: "stair",
  label: [18.05, 3.45],
  note: "夹在茶室和尊亲房之间，占满东跨。西侧开门，接到堂屋后的预留空间。两跑沿东西向。梯段尺寸是方案，不是结构图。",
};

export const floors: Floor[] = [
  {
    name: "一层", y: 0, height: 3.6, front: -1,
    rooms: [
      { id: "living", name: "右侧挑空客厅", ...circulation.livingVoid, kind: "living", label: [9.05, 1.5],
        note: "面对房子时在右侧，与堂屋打通；参考图客厅原在左侧，按你家要求对调到这边。二楼此处无楼板。" },
      { id: "hall", name: "堂屋", x: 11.3, z: -1, w: 4.5, d: 3.6, kind: "hall", label: [13.55, 0.7],
        note: "北侧正门入户，西侧连通挑空客厅。后方不再做餐厅。" },
      { id: "flex", name: "预留空间", x: 11.3, z: 2.6, w: 4.5, d: 2.8, kind: "hall", label: [14.15, 3.15],
        note: "堂屋后面的空位。东侧开门进楼梯，不摆餐桌。" },
      { id: "bridge0", name: "客厅后过道", x: 6.8, z: 4.2, w: 4.5, d: 1.2, kind: "hall", label: [8.4, 4.75],
        note: "挑空客厅南侧的联系过道，西墙开门通辅楼餐厅。" },
      { id: "tea", name: "茶室", x: 15.8, z: -1, w: 4.5, d: 3, kind: "living", label: [18.05, 0.35],
        note: "面对房子时在左边前部，外轮廓 4.5×3 米。西侧开门进堂屋。" },
      { id: "spare", name: "南侧房 · 待定", x: 6.8, z: 5.4, w: 4.5, d: 3.6, kind: "bed", purposeStatus: "pending", label: [9.05, 7.35],
        note: "参考图右上角的厨房和储物间合成这一间，靠南。先按卧室摆一张床，也可以改作杂物房，用途待定。主楼不设厨房，灶仍在辅楼。" },
      { id: "corridor0", name: "后过道", x: 11.3, z: 5.4, w: 4.5, d: 3.6, kind: "hall", label: [13.4, 7.3],
        note: "原楼梯让出后，这一跨打通。西进南侧房，东进尊亲房。" },
      { ...stairRoom, id: "stair0" },
      { id: "bath0", name: "公卫", x: 11.3, z: 3.55, w: 1.75, d: 1.75, kind: "bath", label: [12.15, 4.45],
        note: "放在预留空间西侧，给客人和茶室用。东侧留出进楼梯的路，不进尊亲房。" },
      { id: "elder", name: "尊亲房", x: 15.8, z: 4.8, w: 4.5, d: 4.2, kind: "bed", label: [17.15, 7.7],
        note: "在楼梯南侧，靠南。外轮廓 4.5×4.2 米，含内卫。西侧开门进后过道。尺寸是放进 13.5×10 米主楼后的方案。" },
      { id: "ensuite", name: "尊亲房内卫", x: 18.3, z: 4.8, w: 2, d: 2.2, kind: "bath", label: [19.3, 5.85] },
    ],
    partitions: [
      wall([11.3, 2.6], [15.8, 2.6], 1.2, 1.7),
      wall([6.8, 4.2], [11.3, 4.2], 3.05, 1),
      wall([6.8, 5.4], [11.3, 5.4]),
      wall([11.3, 5.4], [11.3, 9], 0.25, 0.9),
      wall([11.3, 5.4], [15.8, 5.4], 2.4, 1.2),
      wall([15.8, -1], [15.8, 2], 0.85, 0.9),
      wall([15.8, 2], [20.3, 2]),
      wall([15.8, 2], [15.8, 4.8], 0.75, 0.9),
      wall([15.8, 4.8], [20.3, 4.8]),
      wall([15.8, 4.8], [15.8, 9], 0.9, 0.9),
      wall([11.3, 3.55], [13.05, 3.55]),
      wall([11.3, 3.55], [11.3, 5.3]),
      wall([11.3, 5.3], [13.05, 5.3]),
      wall([13.05, 3.55], [13.05, 5.3], 0.45, 0.7),
      wall([18.3, 4.8], [18.3, 7], 0.55, 0.75),
      wall([18.3, 7], [20.3, 7]),
    ],
    furniture: [
      fixture("sofa", 7.55, 1.45, 0.95, 2.5),
      { ...fixture("sofa", 9.35, 0.15, 0.9, 2.2), rotation: Math.PI / 2 },
      fixture("table", 9.15, 1.7, 1.15, 0.7),
      fixture("altar", 13.55, 2.15, 1.6, 0.38),
      fixture("table", 18.15, 0.45, 1.15, 0.7),
      fixture("chair", 18.15, -0.15, 0.43, 0.45),
      fixture("chair", 18.15, 1.05, 0.43, 0.45),
      fixture("chair", 17.35, 0.45, 0.43, 0.45),
      fixture("chair", 18.95, 0.45, 0.43, 0.45),
      bed(9.05, 7.35, 1.5),
      fixture("wardrobe", 7.25, 7.6, 0.45, 1.6),
      bed(17.15, 7.85),
      fixture("wardrobe", 16.3, 8.45, 0.55, 1.0),
      fixture("toilet", 11.7, 4.75, 0.48, 0.7),
      fixture("basin", 12.45, 3.9, 0.55, 0.4),
      fixture("toilet", 19.7, 5.55, 0.48, 0.7),
      fixture("basin", 18.85, 6.45, 0.55, 0.4),
    ],
  },
  {
    name: "二层", y: 3.6, height: 3.6, front: -1,
    rooms: [
      { id: "void", name: "右侧客厅上空", ...circulation.livingVoid, kind: "void", label: [9.05, 1.5],
        note: "挑空随一楼客厅对调到面对房子时的右侧，这里没有二层楼板。" },
      { id: "family1", name: "起居室", x: 11.3, z: -1, w: 4.5, d: 6.4, kind: "living", label: [13.7, 1.15],
        note: "堂屋和预留空间的上方。西侧栏杆俯视挑空客厅。" },
      { id: "bridge1", name: "挑空边过道", x: 6.8, z: 4.2, w: 4.5, d: 1.2, kind: "hall", label: [8.5, 4.75],
        note: "挑空南侧留出的楼板，通向西侧卧室。" },
      { id: "bed3", name: "西侧卧室", x: 6.8, z: 5.4, w: 4.5, d: 3.6, kind: "bed", label: [9.05, 7.2],
        note: "与一楼待定房上下对齐。" },
      { id: "front2", name: "东前卧室", x: 15.8, z: -1, w: 4.5, d: 3, kind: "bed", label: [18.05, 0.4],
        note: "在茶室正上方，进深 3 米，放一张床。不再套卫生间。" },
      { id: "master2", name: "主卧室", x: 15.8, z: 4.8, w: 4.5, d: 4.2, kind: "bed", label: [17.15, 7.55],
        note: "在尊亲房正上方，带内卫。门开向后过道。" },
      { id: "ensuite2", name: "主卧内卫", x: 18.3, z: 4.8, w: 2, d: 2.2, kind: "bath", label: [19.3, 5.85] },
      { id: "corridor1", name: "后过道", x: 11.3, z: 5.4, w: 4.5, d: 3.6, kind: "hall", label: [13.4, 7.3] },
      { ...stairRoom, id: "stair1" },
      { id: "bath1", name: "公卫", x: 11.3, z: 3.55, w: 1.75, d: 1.75, kind: "bath", label: [12.15, 4.45] },
    ],
    partitions: [
      wall([6.8, 5.4], [11.3, 5.4], 3.05, 0.95),
      wall([11.3, 5.4], [11.3, 9], 0.25, 0.9),
      wall([11.3, 5.4], [15.8, 5.4], 2.4, 1.2),
      wall([15.8, -1], [15.8, 2], 0.7, 0.9),
      wall([15.8, 2], [20.3, 2]),
      wall([15.8, 2], [15.8, 4.8], 0.75, 0.9),
      wall([15.8, 4.8], [20.3, 4.8]),
      wall([15.8, 4.8], [15.8, 9], 0.9, 0.9),
      wall([18.3, 4.8], [18.3, 7], 0.55, 0.75),
      wall([18.3, 7], [20.3, 7]),
      wall([11.3, 3.55], [13.05, 3.55]),
      wall([11.3, 3.55], [11.3, 5.3]),
      wall([11.3, 5.3], [13.05, 5.3]),
      wall([13.05, 3.55], [13.05, 5.3], 0.45, 0.7),
    ],
    furniture: [
      { ...fixture("sofa", 13.6, 0.35, 0.9, 2.3), rotation: Math.PI / 2 },
      fixture("table", 13.55, 1.55, 1.1, 0.7),
      bed(9.05, 7.25, 1.5),
      fixture("wardrobe", 7.25, 7.5, 0.45, 1.5),
      bed(18.05, 0.2, 1.5),
      fixture("wardrobe", 19.75, 1.15, 0.45, 1.2),
      bed(17.15, 7.7),
      fixture("wardrobe", 16.25, 8.4, 0.45, 1.0),
      fixture("toilet", 19.7, 5.55, 0.48, 0.7),
      fixture("basin", 18.85, 6.45, 0.55, 0.4),
      fixture("toilet", 11.7, 4.75, 0.48, 0.7),
      fixture("basin", 12.45, 3.9, 0.55, 0.4),
    ],
  },
  {
    name: "三层", y: 7.2, height: 3.3, front: 0.8,
    rooms: [
      { id: "family2", name: "家庭多功能厅", x: 11.3, z: 0.8, w: 4.5, d: 4.6, kind: "living", label: [13.55, 2.7],
        note: "按参考图放在中间，北侧接通中央露台。" },
      { id: "master5", name: "主卧室", x: 6.8, z: 0.8, w: 4.5, d: 3.6, kind: "bed", label: [9.05, 2.3],
        note: "参考图右侧前部的主卧，北侧接通西侧露台，自带衣帽间和内卫。" },
      { id: "ensuite5", name: "主卧内卫", x: 6.8, z: 4.4, w: 2.2, d: 1.8, kind: "bath", label: [7.85, 5.3] },
      { id: "closet5", name: "主卧衣帽间", x: 9, z: 4.4, w: 2.3, d: 1.8, kind: "store", label: [10.15, 5.3] },
      { id: "media", name: "影音室", x: 6.8, z: 6.2, w: 4.5, d: 2.8, kind: "living", label: [9.05, 7.55],
        note: "按参考图放在主卧后部，从后过道进入。" },
      { id: "lobby3", name: "东侧过厅", x: 15.8, z: 0.8, w: 4.5, d: 1.2, kind: "hall", label: [18.05, 1.35],
        note: "茶室上方、楼梯以北。三楼北退 1.8 米之后，这里只剩 1.2 米，作为东侧露台进来的过厅，西侧通家庭厅。" },
      { id: "bed6", name: "卧室", x: 15.8, z: 4.8, w: 4.5, d: 4.2, kind: "bed", label: [17.15, 7.55],
        note: "在楼梯南侧，与一楼尊亲房对齐。北侧是内卫，南侧放床。从后过道进入。" },
      { id: "bath6", name: "卧室内卫", x: 18.3, z: 4.8, w: 2, d: 2.2, kind: "bath", label: [19.3, 5.85] },
      { id: "corridor2", name: "后过道", x: 11.3, z: 5.4, w: 4.5, d: 3.6, kind: "hall", label: [13.4, 7.3] },
      { ...stairRoom, id: "stair2" },
    ],
    partitions: [
      wall([11.3, 0.8], [11.3, 4.4], 1.15, 0.9),
      wall([11.3, 4.4], [11.3, 6.2]),
      wall([11.3, 6.2], [11.3, 9], 0.4, 0.9),
      wall([6.8, 4.4], [9, 4.4], 0.5, 0.8),
      wall([9, 4.4], [11.3, 4.4], 0.6, 0.8),
      wall([9, 4.4], [9, 6.2]),
      wall([6.8, 6.2], [11.3, 6.2]),
      wall([11.3, 5.4], [15.8, 5.4], 2.4, 1.2),
      wall([15.8, 0.8], [15.8, 2], 0.28, 0.7),
      wall([15.8, 2], [20.3, 2]),
      wall([15.8, 2], [15.8, 4.8], 0.75, 0.9),
      wall([15.8, 4.8], [20.3, 4.8]),
      wall([15.8, 4.8], [15.8, 9], 0.9, 0.9),
      wall([18.3, 4.8], [18.3, 7], 0.55, 0.75),
      wall([18.3, 7], [20.3, 7]),
    ],
    furniture: [
      bed(9.05, 2.15, 1.8),
      fixture("wardrobe", 7.25, 3.3, 0.45, 1.2),
      bed(17.15, 7.7),
      fixture("wardrobe", 16.25, 8.4, 0.45, 1.0),
      fixture("sofa", 8.2, 7.15, 0.9, 2.1),
      fixture("table", 13.55, 2.4, 1.4, 0.75),
      fixture("sofa", 12.35, 3.55, 0.85, 1.6),
      fixture("toilet", 7.35, 5.55, 0.48, 0.7),
      fixture("basin", 8.35, 4.85, 0.55, 0.4),
      fixture("toilet", 19.7, 5.55, 0.48, 0.7),
      fixture("basin", 18.85, 6.45, 0.55, 0.4),
    ],
  },
];

export const annexRooms: Room[] = [
  { id: "dining", name: "餐厅 · 双桌", x: 0.8, z: -1, w: 4.5, d: 6.8, kind: "dining", label: [3.9, 0.9],
    note: "东侧门与主楼客厅后过道对齐，通向辅楼餐厅。大圆桌与小桌保留，两桌满座拉椅仍偏紧。" },
  { id: "cook", name: "整体厨房", x: 0.8, z: 5.8, w: 4.5, d: 3.2, kind: "kitchen", label: [3.15, 6.45],
    note: "柴火灶和日常厨房同处一室，中间不隔墙；西侧柴火灶及储柴、东侧日常灶、后墙洗菜备菜，中间留操作通道。" },
];
export const annexPartitions = [wall([0.8, 5.8], [5.3, 5.8], 2.9, 1)];
export const annexFurniture: Furniture[] = [
  fixture("roundTable", 2.9, 1.12, 2, 2), fixture("table", 2.95, 4.1, 1.5, 0.85),
  { ...fixture("hob", 4.8, 7.35, 0.55, 1.65), label: "日常灶" },
  { ...fixture("sink", 3.4, 8.5, 2.2, 0.55), label: "洗菜 / 备菜" },
  { ...fixture("stove", 1.65, 7.9, 1.05, 1.2), label: "柴火灶" },
  { ...fixture("wardrobe", 1.35, 6.45, 0.55, 0.65), label: "储柴" },
  ...Array.from({ length: 12 }, (_, i): Furniture => {
    const a = (i * Math.PI) / 6;
    return { kind: "chair", x: 2.9 + Math.cos(a) * 1.28, z: 1.12 + Math.sin(a) * 1.28,
      w: 0.43, d: 0.45, rotation: -a + Math.PI / 2 };
  }),
  ...[1.55, 4.35].map(x => fixture("chair", x, 4.1, 0.43, 0.45)),
  ...[2.6, 3.3].flatMap(x => [fixture("chair", x, 3.34, 0.43, 0.45), fixture("chair", x, 4.86, 0.43, 0.45)]),
];

export const facts: Fact[] = [
  {
    label: "主马路边蓝顶邻房",
    value: "三层 · 三开间 · 左侧平顶柴火房",
    source: "用户提供",
    note: "对应红框内的房子：主楼三层、三开间，四坡五脊带中央官帽，前面有罗马柱门厅。面对这栋邻房时，柴火房在左侧，只有一层平顶；地下室未建模。首层与自家前方砖房首层同高。",
  },
  {
    label: "蓝顶邻房与辅楼延长线",
    value: `约 ${roadsideVilla.extensionGap} m`,
    source: "用户提供",
    note: "站在北侧面对自家，辅楼最右侧是西墙 X=0.8。沿这面墙向房前延长，仍不碰到蓝顶邻房。约5米按延长线到邻房整栋最东侧外墙的横向空隙表达，包含左侧柴火房，不是屋檐或用地界址的实测间距。",
  },
  {
    label: "蓝顶邻房朝向与外形",
    value: `北偏西约 ${roadsideVilla.angle}° · 照片估算`,
    source: "照片估算",
    note: `依据 DJI 132622 的俯拍屋面、IMG_5123 的屋脊和前坪，以及 IMG_5128、IMG_5135、IMG_5120 的立面交叉判断。沿用场景北向，暂转向西北约${roadsideVilla.angle}°；主楼暂${roadsideVilla.w}×${roadsideVilla.d}米，三层层高暂${roadsideVilla.floorHeights.join("/")}米，柴火房暂${roadsideVilla.wing.w}×${roadsideVilla.wing.d}米。蓝瓦、粉白柱栏、各层中央阳台、侧面三楼开敞廊及菱格前坪按照片近似。官帽为接入正屋的前伸屋面，前端带三角山墙。所有外观尺寸及纵向位置均待核对，不能作为测绘。`,
  },
  {
    label: "主楼三层户型",
    value: "右客厅 · 茶室 · 楼梯在东",
    source: "设计建议",
    note: "方位以面对房子为准：挑空客厅在右侧，左侧前部为 4.5×3 米茶室，楼梯在茶室和尊亲房之间，尊亲房靠南并带内卫。堂屋后只留空位。二楼挑空仍在右侧，茶室上方是进深 3 米的卧室，主卧在楼梯南侧。三楼东侧只留楼梯北的过厅和楼梯南的卧室。房间尺寸是方案，不是施工图。辅楼厨房未改。",
  },
  {
    label: "东西总面宽",
    value: "21.1 m",
    source: "用户提供",
    note: "总宽包含两侧各0.8米及中间1.5米子孙道：0.8＋4.5＋1.5＋13.5＋0.8＝21.1米。均为当前方案口径，界址与墙至界距离须现场复核，不再另加侧道。",
  },
  {
    label: "旧台地进深",
    value: "10.8 m",
    source: "用户提供",
    note: "包含房前、房后水泥空地，不含前方旱地。",
  },
  {
    label: "前田深度",
    value: "8.6 / 5 / 3 m",
    source: "用户提供",
    note: "西端仍按旧前坪外缘外3.1米，辅楼前留出栏杆和约2米通道，不收尖。东端8.6米改从主楼前墙往外量；若仍从旧前坪外缘Z=0量，前墙已在北侧1米，墙外只剩7.6米。外沿是向外鼓的圆弧，中段比两端连线更远离房子。旧的5米中点会把弧拉向房子，这次按俯视图放开，鼓出量不是新的实测。",
  },
  {
    label: "地块边界折点",
    value: "参考轮廓",
    source: "照片估算",
    note: "红线表示田埂外沿，周边各条红线不全是自家界址。无地籍或现场控制点，不能用本模型认定土地界址。",
  },
  {
    label: "屋后高田",
    value: "+2.5 m",
    source: "用户提供",
    note: "相对原房前坪；新院坪暂取同标高，需联测。原旱地相对前坪低约2米单独用于现状。",
  },
  {
    label: "地库前方两级梯田",
    value: "地库下2m，再下1.5m",
    source: "用户提供",
    note: `按新说明：第一田比地库低约2米，前方砖房台地再低约1.5米。随地库示意标高表达为${frontFieldLevel.toFixed(2)}米和${(frontFieldLevel - site.frontHouseDrop).toFixed(2)}米，绝对标高待测。`,
  },
  {
    label: "主楼 / 辅楼",
    value: "135 / 45 ㎡",
    source: "设计建议",
    note: "用户已选：13.5×10和4.5×10米。用户确认180㎡只控制主辅楼主体，外伸门厅另计，不是报建面积结论。",
  },
  {
    label: "外伸通高门厅",
    value: "外伸2m / 另计9.6㎡",
    source: "用户提供",
    note: "本版门厅4.8×2米，柱间二楼无平台，三楼为露台；主体与门厅几何投影合计189.6㎡。门厅宽度为设计参数。",
  },
  {
    label: "飘檐 / 官帽 / 天沟",
    value: "二楼前0.7m / 三楼三面0.8m",
    source: "用户提供",
    note: "三楼栏杆下沿连续瓦檐外挑约70cm，四个转角设柱身0.8m短柱，立于0.5m挡墙上，墙加柱身为1.3m（盖板另计），与下方两根构造柱、两根门厅柱对齐。官帽高柱和侧墙从栏杆后退，中央为前方敞开的内退露台；后方柱墙隔开两侧阳台。两侧玻璃前无独立高柱。左右包角柱包住墙角两面，比墙面凸出约15厘米。正面一二层包角柱顶收到三楼挑檐三眼皮下面，板底以下约8厘米，避免穿进瓦面；屋后两个墙角同样设置并通到檐口下；柱身中间一条竖黑线，上下为花板。两根门厅柱截面为80厘米见方，只有正面、壁灯以上有四道短竖纹，侧面不刻条纹；柱头与包角柱相同，柱脚为圆纹。大门为铸铝咖色双扇，和二楼正中玻璃做成一门到顶。主楼和辅楼外墙为白麻水包砂，四面墙上下每隔约45厘米一道浅凹横线，颜色贴近墙面，窗和门处断开；三眼皮和包角柱顶上顶住檐口的一截为英国棕。这些是涂料搭配，不是色卡实测，也不是测绘。",
  },
  {
    label: "院坪与人行通道",
    value: "前约2m / 侧过道0.8m",
    source: "用户提供",
    note: "院坪中间地库楼梯及护栏已取消；辅楼前绕右侧过道通往后段同高梯田。侧过道0.8米为墙至界，栏杆占用后略窄。前方电杆及架空线按拆除计划移除。",
  },
  {
    label: "两侧 / 子孙道",
    value: "0.8 / 1.5 m",
    source: "设计建议",
    note: "墙面间距，需另扣栏杆；主楼三楼侧檐80cm恰到参考边界。主楼和辅楼外的落水管已按用户要求删除。邻居屋檐间距仍需现场复核。",
  },
  {
    label: "后退 / 前伸",
    value: "1.8 / 1.0 m",
    source: "设计建议",
    note: "10米进深加1.8米后退，超过旧10.8米台地1米。",
  },
  {
    label: "层高",
    value: "3.6 / 3.6 / 3.3 m",
    source: "用户提供",
    note: "墙身和檐口仍按楼面0、3.6、7.2米、檐口10.5米。室内一楼完成面比院坪高0.45米，这是三步×150毫米的设计高度，不是测绘。门厅台阶、门前垫高和左右坡道用深褐近黑的抛光石，带浅麻点，对照用户照片，不是石材色卡。踏步前沿防滑线收细，颜色只比石面略浅。石面反光压低，正面看也是深色，不是只在俯瞰时才显出颜色。两根门厅柱前面是整块垫高，三步只嵌在柱与柱中间。柱身靠墙一面到前墙外皮 1.8 米，这是用户指定，不是测绘。面对房子时左右各有一条约2米的侧坡道·坡度待核，外侧边贴着柱子北缘，分别向东、向西降，按0.45米高差/2米投影约22.5%，仅是现有几何示意，适老和无障碍使用条件待设计核定。坡道防滑条改细，颜色只比石面略浅。屋顶没有跟着抬。",
  },
  {
    label: "三楼北退",
    value: "1.8 m",
    source: "设计建议",
    note: "仅北侧退台，三楼主体外轮廓13.5×8.2米。",
  },
  {
    label: "梁板与屋脊",
    value: "示意构件",
    source: "设计建议",
    note: "院坪结构占用暂0.45米，主楼檐口10.5米。主楼、辅楼四坡默认4.5分水，当前探索值见分水控件及导出图册；这是设计坡度，不是测绘。官帽脊与正屋脊齐平；屋脊、构件与天沟截面是造型示意，均非结构施工尺寸。",
  },
  {
    label: "地库净高 / 入口",
    value: "2.5 / 2.5 m",
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
    note: `未挖旁田暂取${site.adjacentUnexcavatedLevel.toFixed(2)}米、地库完成面${site.garageFloor.toFixed(2)}米，两者差${(site.adjacentUnexcavatedLevel - site.garageFloor).toFixed(2)}米仅为示意。旁田参数独立，不能据此确定开挖深度。`,
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
    if (Math.hypot(point[0] - x - t * dx, point[1] - z - t * dz) < 1e-5) return true;
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
