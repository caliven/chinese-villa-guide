import { courtyardFront, garageLevelValues, NEIGHBOR_COURTYARD_SLAB_THICKNESS, site, type Point } from "./data.ts";
import { contourSection, insetContour } from "./contours.ts";
import { basementColumns, surroundings } from "./surroundings.ts";

export const rectangle = (x: number, z: number, w: number, d: number): Point[] => [
  [x, z], [x + w, z], [x + w, z + d], [x, z + d],
];

export interface GarageObstacle {
  id: string;
  label: string;
  kind: "column" | "wall";
  footprint: Point[];
  bottom: number;
  top: number;
}

/** 自家到邻居外沿的过渡围墙：平面沿外沿，立面用圆弧衔接两家完成面，不做阶梯。 */
export interface GarageTransitionWall {
  /** 外沿中线，自西（自家）向东（邻居院坪西界） */
  path: Point[];
  thickness: number;
  height: number;
  westFloor: number;
  eastFloor: number;
}

export interface GarageLayout {
  columns: GarageObstacle[];
  columnWidth: number;
  outerWall: Point[];
  /** 自家外沿＋斜坡外侧整段外墙中线，一张连续网格，中途不断开 */
  fullOuterWallPath: Point[];
  wallSegments: GarageObstacle[];
  /** 斜坡段参数（完成面高低）；几何已并入 fullOuterWallPath */
  transitionWall: GarageTransitionWall | null;
  /** 邻居院坪西界分隔墙（外层车道留空），两家地库下面断开 */
  partitionWall: GarageObstacle | null;
  westWall: GarageObstacle;
  obstacles: GarageObstacle[];
  entry: { x: number; z: number; w: number; d: number };
  retainedDeck: {
    footprint: Point[];
    modelSlabBottom: number;
    soffitY: null;
  };
  proposedCut: {
    footprint: Point[];
    confirmed: boolean;
  };
}

function columnSize() {
  return Math.max(300, site.garageColumnSize || 400);
}

export { NEIGHBOR_COURTYARD_SLAB_THICKNESS };

/** 地库外沿矮墙厚：18 墙。 */
export const GARAGE_OUTER_WALL_THICKNESS = 180;
/** 墙中线相对院坪外沿内收半厚，外皮贴外沿。 */
export const GARAGE_OUTER_WALL_CENTER_INSET = GARAGE_OUTER_WALL_THICKNESS / 2;

/** 外沿车道进深。斜坡只做在这一条最外层里。 */
export function outerLaneDepth() {
  return Math.max(2200, site.neighborBeamReach);
}

/** 现状邻居院坪西界。此线以西、木房前的区域按自家地库。 */
export function neighborYardWestX() {
  return surroundings.neighborYard.x;
}

/**
 * 地库完成面。
 * 邻居院坪范围内（不含最外层车道）为邻居标高；其余为自家标高。
 * 最外层车道只在邻居院坪西界向西放一段斜坡，其余保持所在一侧的水平标高。
 */
export function basementFloorY(x: number, z = Number.NaN) {
  const lane = outerLaneDepth();
  const outerZ = surroundings.neighborYard.z;
  const yardWest = surroundings.neighborYard.x;
  const rampStart = yardWest;
  const rampEnd = yardWest - 5000;
  const inNeighborYard = x >= yardWest && x < surroundings.road.x
    && z >= outerZ && z < surroundings.sideHouse.z;
  const inLane = Number.isFinite(z) && z < outerZ + lane;
  if (inLane && x < rampStart && x > rampEnd) {
    const t = (rampStart - x) / (rampStart - rampEnd);
    return site.neighborGarageFloor + t * (site.garageFloor - site.neighborGarageFloor);
  }
  if (inNeighborYard && !inLane) return site.neighborGarageFloor;
  if (inLane && x >= rampStart) return site.neighborGarageFloor;
  return site.garageFloor;
}

export function basementClearAt(x: number, z = Number.NaN) {
  const floor = basementFloorY(x, z);
  const span = site.neighborGarageFloor - site.garageFloor;
  const t = span === 0 ? 1 : (site.neighborGarageFloor - floor) / span;
  return site.neighborBeamClear + t * (site.garageClear - site.neighborBeamClear);
}

/** 按当前院坪外沿／site.cut／房子前墙现场计算地库布局（勿模块级快照）。 */
export function buildGarageLayout(): GarageLayout {
  const levels = garageLevelValues(site);
  const columns = basementColumns();
  const columnWidth = columnSize();
  const columnObstacles: GarageObstacle[] = columns.columns.flatMap((column, i) => {
    const samePost =
      Math.hypot(column.outer[0] - column.inner[0], column.outer[1] - column.inner[1]) < columnWidth * 0.5;
    const rows: { key: "outer" | "mid" | "inner"; point: Point; tag: string }[] = samePost
      ? [{ key: "inner", point: column.inner, tag: "房前柱" }]
      : [
          { key: "outer", point: column.outer, tag: "外沿柱" },
          ...(column.mid ? [{ key: "mid" as const, point: column.mid, tag: "门厅下柱" }] : []),
          { key: "inner", point: column.inner, tag: "房前柱" },
        ];
    return rows.map(({ key, point, tag }) => {
      const [x, z] = point;
      const floor = basementFloorY(x, z);
      return {
        id: `column-${i + 1}-${key}`,
        label: `C${i + 1}${tag}`,
        kind: "column" as const,
        footprint: rectangle(x - columnWidth / 2, z - columnWidth / 2, columnWidth, columnWidth),
        bottom: floor,
        // 柱顶贴梁底，中间不留缝。
        top: beamSoffitAt(x),
      };
    });
  });
  // 外沿矮墙：自家水平段与斜坡段同一条中线，高度固定（非通高封闭），水泥色在渲染侧处理。
  // 邻居地库最外侧仍是进车空档，不再做围栏。
  const wallThick = GARAGE_OUTER_WALL_THICKNESS;
  const wallHeight = 1040;
  // 中线内收半厚，外皮与院坪外沿齐平，水泥可铺到墙下露截面。
  const wallOuter: Point[] = [
    ...contourSection(insetContour(courtyardFront, GARAGE_OUTER_WALL_CENTER_INSET), 120, site.width),
  ];
  const wallInner = insetContour(wallOuter, wallThick);
  const wallSegments: GarageObstacle[] = wallOuter.slice(1).flatMap((p, i) => {
    const a = wallOuter[i];
    const b = p;
    const innerA = wallInner[i];
    const innerB = wallInner[i + 1];
    const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1200));
    const lerp = (u: Point, v: Point, t: number): Point => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t];
    return Array.from({ length: pieces }, (_, k) => {
      const t0 = k / pieces, t1 = (k + 1) / pieces;
      const p0 = lerp(a, b, t0), p1 = lerp(a, b, t1);
      return {
        id: `outer-wall-${i + 1}-${k + 1}`,
        label: "外沿矮墙",
        kind: "wall" as const,
        footprint: [p0, p1, lerp(innerA, innerB, t1), lerp(innerA, innerB, t0)],
        bottom: levels.ownFloor,
        top: levels.ownFloor + wallHeight,
      };
    });
  });
  const wallEast = wallOuter.at(-1);
  const yardWest = surroundings.neighborYard.x;
  let transitionWall: GarageTransitionWall | null = null;
  if (wallEast && yardWest > wallEast[0] + 200) {
    // 平面仍贴外沿中线；Z 用平滑插值接到邻居院坪西界，避免折角竖缝。
    const end: Point = [yardWest, surroundings.neighborYard.z + GARAGE_OUTER_WALL_CENTER_INSET];
    const samples = Math.max(32, Math.ceil((yardWest - wallEast[0]) / 180));
    const path: Point[] = Array.from({ length: samples + 1 }, (_, i) => {
      const t = i / samples;
      const s = t * t * (3 - 2 * t); // smoothstep，接缝处切线更顺
      return [
        wallEast[0] + (end[0] - wallEast[0]) * t,
        wallEast[1] + (end[1] - wallEast[1]) * s,
      ] as Point;
    });
    transitionWall = {
      path,
      thickness: wallThick,
      height: wallHeight,
      westFloor: levels.ownFloor,
      eastFloor: levels.neighborFloor,
    };
  }
  const westFront = courtyardFront[0]?.[1] ?? 0;
  const westWall: GarageObstacle = {
    id: "west-wall",
    label: "旁田交界墙",
    kind: "wall",
    footprint: rectangle(0, westFront, 120, -westFront),
    bottom: levels.ownFloor,
    top: site.adjacentUnexcavatedLevel,
  };
  // 两家地库在院坪西界断开：隔墙只挡内区，最外层车道留给进车斜坡。
  const lane = outerLaneDepth();
  const partitionZ0 = surroundings.neighborYard.z + lane;
  const partitionZ1 = surroundings.sideHouse.z;
  let partitionWall: GarageObstacle | null = null;
  if (partitionZ1 - partitionZ0 > 400) {
    partitionWall = {
      id: "garage-partition",
      label: "两家地库分隔墙",
      kind: "wall",
      footprint: rectangle(yardWest - wallThick / 2, partitionZ0, wallThick, partitionZ1 - partitionZ0),
      bottom: levels.ownFloor,
      top: slabSoffitAt(yardWest),
    };
  }
  const fullOuterWallPath = transitionWall
    ? [...wallOuter, ...transitionWall.path.slice(1)]
    : wallOuter;
  return {
    columns: columnObstacles,
    columnWidth,
    outerWall: [...fullOuterWallPath, ...insetContour(fullOuterWallPath, wallThick).reverse()],
    fullOuterWallPath,
    wallSegments,
    transitionWall,
    partitionWall,
    westWall,
    obstacles: [
      ...columnObstacles,
      ...wallSegments,
      ...(partitionWall ? [partitionWall] : []),
      westWall,
    ],
    entry: {
      x: site.cut.x,
      z: site.cut.z,
      w: surroundings.road.x - site.width,
      d: site.cut.d,
    },
    retainedDeck: {
      footprint: rectangle(
        site.width,
        surroundings.neighborYard.z,
        surroundings.road.x - site.width,
        surroundings.sideHouse.z - surroundings.neighborYard.z,
      ),
      // 邻居院坪板底（已建，板厚写死 150）。地库视图里梁从这块板往下伸到最低梁。
      modelSlabBottom: -NEIGHBOR_COURTYARD_SLAB_THICKNESS,
      soffitY: null,
    },
    proposedCut: {
      footprint: rectangle(site.cut.x, site.cut.z, site.cut.w, site.cut.d),
      confirmed: false,
    },
  };
}

/** 可变布局对象；改院坪／参数后调用 rebuildGarageLayout 刷新。 */
export const garageLayout: GarageLayout = buildGarageLayout();

export function rebuildGarageLayout() {
  const next = buildGarageLayout();
  garageLayout.columns = next.columns;
  garageLayout.columnWidth = next.columnWidth;
  garageLayout.outerWall = next.outerWall;
  garageLayout.fullOuterWallPath = next.fullOuterWallPath;
  garageLayout.wallSegments = next.wallSegments;
  garageLayout.transitionWall = next.transitionWall;
  garageLayout.partitionWall = next.partitionWall;
  garageLayout.westWall = next.westWall;
  garageLayout.obstacles = next.obstacles;
  garageLayout.entry = next.entry;
  garageLayout.retainedDeck = next.retainedDeck;
  garageLayout.proposedCut = next.proposedCut;
}

/** 梁底绝对标高。自家用 deckStructure，邻居用 neighborBeamDrop。 */
export function beamSoffitAt(x: number) {
  return x >= surroundings.neighborYard.x ? -site.neighborBeamDrop : -site.deckStructure;
}

/** 楼板底绝对标高。梁顶／外墙顶贴此处，中间不留缝。 */
export function slabSoffitAt(x: number) {
  if (x >= surroundings.neighborYard.x) return -NEIGHBOR_COURTYARD_SLAB_THICKNESS;
  return -site.garageSlabThickness;
}

/** 梁截面高度＝板底 − 梁底（梁顶已贴板底）。 */
export function beamDepthAt(x: number) {
  return slabSoffitAt(x) - beamSoffitAt(x);
}
