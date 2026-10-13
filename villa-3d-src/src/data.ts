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
    | "toilet"
    | "basin"
    | "wardrobe"
    | "altar";
  x: number;
  z: number;
  w: number;
  d: number;
  rotation?: number;
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

export const site = {
  width: 21.1,
  oldDepth: 10.8,
  rearGap: 1.8,
  sideGap: 0.8,
  lane: 1.5,
  main: { x: 6.8, z: -1, w: 13.5, d: 10 },
  annex: { x: 0.8, z: -1, w: 4.5, d: 10, height: 3.6 },
  setback: 1.8,
  roofRise: 1.45,
  eave: 0.55,
  secondFrontEave: 0.7,
  thirdEave: 0.8,
  portico: { x: 11.3, w: 4.8, projection: 2 },
  rearField: 2.5,
  originalField: -2,
  // 最新现场关系：地库外第一田再低2米，前方砖房台地再低1.5米。
  frontFieldDrop: 2,
  frontHouseDrop: 1.5,
  garageClear: 2.5,
  // 0.45 是示意结构占用，不是设计梁高。地库绝对标高尚待联测。
  deckStructure: 0.45,
  garageFloor: -2.95,
  latitude: 28.153355,
  longitude: 111.156546,
  // X=8.8为旧砖房/木屋分界。右端不收尖，按用户约3米及栏杆占用示意3.1米。
  field: [
    [0, 0],
    [21.1, 0],
    [21.1, -8.6],
    [16, -7.6],
    [8.8, -5],
    [2.6, -3.1],
    [0, -3.1],
  ] as Point[],
  boundary: [
    [0, 10.8],
    [21.1, 10.8],
    [21.1, -8.6],
    [16, -7.6],
    [8.8, -5],
    [2.6, -3.1],
    [0, -3.1],
  ] as Point[],
  cut: { x: 21.1, z: -8.6, w: 5, d: 2.5 },
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
const stairRoom: Room = {
  id: "stair",
  name: "楼梯",
  x: 16,
  z: 0.8,
  w: 4.3,
  d: 3.9,
  kind: "stair",
  label: [18.15, 2.6],
};

export const floors: Floor[] = [
  {
    name: "一层",
    y: 0,
    height: 3.6,
    front: -1,
    rooms: [
      {
        id: "flex",
        name: "卧室 / 多功能房",
        x: 6.8,
        z: -1,
        w: 4.6,
        d: 4,
        kind: "bed",
        note: "北向窗，保留卧室条件。",
      },
      {
        id: "living",
        name: "挑空客厅",
        x: 6.8,
        z: 3,
        w: 4.6,
        d: 6,
        kind: "living",
        note: "跨一、二层，与堂屋开敞连通；南、西双向开窗。",
        label: [9.1, 6.6],
      },
      {
        id: "hall",
        name: "堂屋 · 开敞连通",
        x: 11.4,
        z: 0.7,
        w: 4.6,
        d: 5.8,
        kind: "hall",
        note: "北侧入户，南端留供桌位置；西侧连通客厅。",
        label: [13.65, 3.4],
      },
      {
        id: "elder",
        name: "老人房",
        x: 16,
        z: 4.7,
        w: 4.3,
        d: 4.3,
        kind: "bed",
        note: "东南位置，独立卫生间占用本房东北角；面积为含卫外轮廓。",
        label: [17.9, 7.8],
      },
      {
        id: "ensuite",
        name: "独卫",
        x: 18.3,
        z: 4.7,
        w: 2,
        d: 2,
        kind: "bath",
        note: "老人房内独立卫生间。",
      },
      {
        id: "bath0",
        name: "公卫",
        x: 12.8,
        z: 6.5,
        w: 2.2,
        d: 2.5,
        kind: "bath",
      },
      { ...stairRoom, id: "stair0" },
    ],
    partitions: [
      wall([6.8, 3], [11.4, 3]),
      wall([11.4, -1], [11.4, 3], 2.4),
      wall([16, 0.8], [16, 2.7], 0.45),
      wall([16, 2.7], [16, 4.7], 0.4),
      wall([16, 4.7], [20.3, 4.7]),
      wall([16, 4.7], [16, 9], 0.4),
      wall([18.3, 4.7], [18.3, 6.7], 0.55, 0.8),
      wall([18.3, 6.7], [20.3, 6.7]),
      wall([12.8, 6.5], [15, 6.5], 0.6, 0.8),
      wall([12.8, 6.5], [12.8, 9]),
      wall([15, 6.5], [15, 9]),
    ],
    furniture: [
      bed(9, 0.7, 1.5),
      bed(17.85, 7.55),
      fixture("wardrobe", 19.83, 7.75, 0.45, 1.8),
      fixture("sofa", 7.65, 6.05, 1, 2.7),
      fixture("sofa", 9.15, 8.1, 2.3, 0.8),
      fixture("table", 9.35, 6.1, 1.25, 0.7),
      fixture("altar", 13.55, 6.1, 2, 0.45),
      fixture("toilet", 19.55, 5.55, 0.48, 0.7),
      fixture("basin", 18.8, 6.28, 0.65, 0.4),
      fixture("toilet", 14.35, 8.25, 0.48, 0.7),
      fixture("basin", 13.32, 8.45, 0.65, 0.4),
    ],
  },
  {
    name: "二层",
    y: 3.6,
    height: 3.6,
    front: -1,
    rooms: [
      { id: "bed3", name: "卧室 3", x: 6.8, z: -1, w: 4.6, d: 4, kind: "bed" },
      {
        id: "void",
        name: "客厅上空",
        x: 6.8,
        z: 3,
        w: 4.6,
        d: 6,
        kind: "void",
        note: "此处没有二层楼板，不计为卧室或使用面积。",
      },
      {
        id: "bed4",
        name: "卧室 4",
        x: 11.4,
        z: 5.2,
        w: 4.6,
        d: 3.8,
        kind: "bed",
      },
      {
        id: "bed5",
        name: "卧室 5",
        x: 16,
        z: 4.7,
        w: 4.3,
        d: 4.3,
        kind: "bed",
      },
      {
        id: "bath1",
        name: "公卫",
        x: 12.8,
        z: 2.7,
        w: 2.2,
        d: 2.5,
        kind: "bath",
      },
      {
        id: "family1",
        name: "起居 / 走廊",
        x: 11.4,
        z: 0.7,
        w: 4.6,
        d: 2,
        kind: "hall",
        label: [13.7, 1.65],
      },
      { ...stairRoom, id: "stair1" },
    ],
    partitions: [
      wall([6.8, 3], [11.4, 3]),
      wall([11.4, -1], [11.4, 3], 1.6),
      wall([16, 0.8], [16, 2.7], 0.45),
      wall([16, 2.7], [16, 4.7], 0.4),
      wall([16, 4.7], [20.3, 4.7]),
      wall([16, 4.7], [16, 9], 0.6),
      wall([11.4, 5.2], [16, 5.2], 3.5),
      wall([12.8, 2.7], [15, 2.7]),
      wall([12.8, 2.7], [12.8, 5.2]),
      wall([15, 2.7], [15, 5.2], 0.55, 0.8),
    ],
    furniture: [
      bed(9, 0.7),
      bed(13.4, 7.2),
      bed(18.3, 7.2),
      fixture("wardrobe", 11.85, 7.65, 0.45, 1.9),
      fixture("wardrobe", 19.82, 7.4, 0.45, 1.9),
      fixture("toilet", 13.4, 4.4, 0.48, 0.7),
      fixture("basin", 14.4, 3.2, 0.65, 0.4),
    ],
  },
  {
    name: "三层",
    y: 7.2,
    height: 3.3,
    front: 0.8,
    rooms: [
      { id: "bed6", name: "卧室 6", x: 6.8, z: 5.2, w: 6, d: 3.8, kind: "bed" },
      {
        id: "bed7",
        name: "卧室 7",
        x: 15,
        z: 5.2,
        w: 5.3,
        d: 3.8,
        kind: "bed",
      },
      {
        id: "bath2",
        name: "公卫",
        x: 10.6,
        z: 2.7,
        w: 2.2,
        d: 2.5,
        kind: "bath",
      },
      {
        id: "family2",
        name: "家庭厅",
        x: 6.8,
        z: 0.8,
        w: 6,
        d: 4.4,
        kind: "living",
        note: "南侧内含公共卫生间，家庭厅沿西侧展开。",
        label: [9, 2.9],
      },
      {
        id: "rearHall",
        name: "南向过厅",
        x: 12.8,
        z: 5.2,
        w: 2.2,
        d: 3.8,
        kind: "hall",
      },
      { ...stairRoom, id: "stair2" },
    ],
    partitions: [
      wall([6.8, 5.2], [12.8, 5.2], 2.8),
      wall([12.8, 5.2], [12.8, 9]),
      wall([15, 5.2], [20.3, 5.2], 0.35),
      wall([15, 5.2], [15, 9]),
      wall([16, 0.8], [16, 2.7], 0.45),
      wall([16, 2.7], [16, 4.7], 0.4),
      wall([10.6, 2.7], [12.8, 2.7]),
      wall([10.6, 2.7], [10.6, 5.2]),
      wall([12.8, 2.7], [12.8, 5.2], 0.55, 0.8),
    ],
    furniture: [
      bed(9.8, 7.2),
      bed(17.8, 7.2),
      fixture("sofa", 7.8, 3.05, 1, 2.5),
      fixture("table", 9.2, 3.05, 1.2, 0.7),
      fixture("toilet", 11.2, 4.4, 0.48, 0.7),
      fixture("basin", 12.2, 3.2, 0.65, 0.4),
    ],
  },
];

export const annexRooms: Room[] = [
  {
    id: "dining",
    name: "餐厅 · 双桌",
    x: 0.8,
    z: -1,
    w: 4.5,
    d: 6.35,
    kind: "dining",
    label: [3.9, 0.9],
    note: "大圆桌直径2米；两桌同时使用偏紧，黄色区域显示拉椅范围。",
  },
  {
    id: "cook",
    name: "日常厨房",
    x: 3,
    z: 5.35,
    w: 2.3,
    d: 3.65,
    kind: "kitchen",
  },
  {
    id: "fire",
    name: "柴火灶间",
    x: 0.8,
    z: 5.35,
    w: 2.2,
    d: 3.65,
    kind: "kitchen",
    note: "独立门墙、烟囱；西南角预留储柴，尺寸为概念占位。",
  },
];
export const annexPartitions = [
  wall([0.8, 5.35], [5.3, 5.35], 2.9),
  wall([3, 5.35], [3, 9], 0.55),
];
export const annexFurniture: Furniture[] = [
  fixture("roundTable", 2.9, 1.12, 2, 2),
  fixture("table", 2.95, 4.1, 1.5, 0.85),
  fixture("counter", 4.82, 7.9, 0.55, 1.7),
  fixture("counter", 4.1, 8.5, 1.8, 0.55),
  fixture("stove", 1.65, 7.9, 1.05, 1.2),
  fixture("wardrobe", 1.45, 6.15, 0.6, 1),
  ...Array.from({ length: 12 }, (_, i): Furniture => {
    const a = (i * Math.PI) / 6;
    return {
      kind: "chair",
      x: 2.9 + Math.cos(a) * 1.28,
      z: 1.12 + Math.sin(a) * 1.28,
      w: 0.43,
      d: 0.45,
      rotation: -a + Math.PI / 2,
    };
  }),
  ...[1.55, 4.35].map((x) => fixture("chair", x, 4.1, 0.43, 0.45)),
  ...[2.6, 3.3].flatMap((x) => [
    fixture("chair", x, 3.34, 0.43, 0.45),
    fixture("chair", x, 4.86, 0.43, 0.45),
  ]),
];

export const facts: Fact[] = [
  {
    label: "东西总面宽",
    value: "21.1 m",
    source: "用户提供",
    note: "全部可用宽度，已包含东侧约0.6米过道，不再外加。",
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
    note: "由旧前坪外缘测量；用户补充确认右端仍约3米、不收成尖角。本版以3.1米留出栏杆和约2米前通道，中间折点待测。",
  },
  {
    label: "地块边界折点",
    value: "参考轮廓",
    source: "照片估算",
    note: "无地籍或现场控制点，不能用本模型认定土地界址。",
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
    note: "二楼顶部前檐70cm，三楼屋顶前及左右80cm；中央官帽抬高、四坡五脊瓦口内收至天沟，设墙边落水管。参照新中式效果图1，细部为建模表达。",
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
    note: "墙面间距，需另扣管线和栏杆；主楼三楼侧檐80cm恰到参考边界，落水管内收布置，邻居屋檐间距仍需现场复核。",
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
    note: "累计楼面标高0、3.6、7.2米，屋顶檐口基准10.5米。",
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
    note: "院坪结构占用暂0.45米，两翼檐基10.5米、中央官帽檐基11.8米；屋脊、构件与天沟截面是造型示意，均非结构施工尺寸。",
  },
  {
    label: "地库净高 / 入口",
    value: "2.5 / 2.5 m",
    source: "用户提供",
    note: "地库最低净高为目标；入口净宽为预计值，上方切为露天口。",
  },
  {
    label: "道路与坡道",
    value: "需实测",
    source: "待测",
    note: "道路标高、坡道可用长度、坡道折点与转弯区域未确认。",
  },
  {
    label: "邻居平台切除",
    value: "需协商与复核",
    source: "待测",
    note: "场地视图保持完整邻居地坪，仅地库视图揭示拟露天切口。示意5×2.5米不能作为可切割范围；保留梁柱位置待测。",
  },
  {
    label: "车辆通行参数",
    value: "未完成校核",
    source: "待测",
    note: "L9含镜宽和可靠转弯参数、第二辆车车型尚缺。",
  },
  {
    label: "邻房、树木、道路",
    value: "位置关系已按现场说明修正",
    source: "用户提供",
    note: "面对房子：道路贴左侧邻居木房左墙；其前方为整块地坪；两侧为梯田，树木只在后方木房之后的山上。",
  },
  {
    label: "前后邻房对齐",
    value: "后方木房 / 前方两层砖房",
    source: "用户提供",
    note: "两栋左边均与左侧邻居木房齐平；后方木房右边到主楼中部，前方砖房右边到主楼面宽从左起约1/3处。后方木房位于第二层梯田。",
  },
  {
    label: "辅楼右侧梯田",
    value: "上田齐院坪 / 下田齐地库",
    source: "用户提供",
    note: "田坎在辅楼进深约2/3处。本版以从前墙向后计，后段高、前段低；精确田坎位置待现场校准。",
  },
  {
    label: "周边高度与轮廓",
    value: "照片估算，非实测",
    source: "照片估算",
    note: "参考 DJI 131730：左侧外伸高地暂+0.6米，后方木房第二层田暂+5米，前方砖房层高暂3.2米。道路纵坡、田坎折点、树高与屋檐间距仍未经测绘。",
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
