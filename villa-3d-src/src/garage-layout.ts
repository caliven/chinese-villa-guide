import { courtyardFront, site, type Point } from "./data";
import { contourSection, insetContour } from "./contours";
import { basementColumns, surroundings } from "./surroundings";

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

export interface GarageLayout {
  columns: GarageObstacle[];
  columnWidth: number;
  outerWall: Point[];
  wallSegments: GarageObstacle[];
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

const modelSlabBottom = -230;
const columnWidth = 360;

/** 按当前院坪外沿／site.cut／房子前墙现场计算地库布局（勿模块级快照）。 */
export function buildGarageLayout(): GarageLayout {
  const columns = basementColumns();
  const columnObstacles: GarageObstacle[] = columns.columns.flatMap((column, i) =>
    (["outer", "inner"] as const).map((row) => {
      const [x, z] = column[row];
      return {
        id: `column-${i + 1}-${row}`,
        label: `C${i + 1}${row === "outer" ? "外沿柱" : "房前柱"}`,
        kind: "column",
        footprint: rectangle(x - columnWidth / 2, z - columnWidth / 2, columnWidth, columnWidth),
        bottom: site.garageFloor,
        top: modelSlabBottom,
      };
    }),
  );
  const wallOuter: Point[] = [
    ...contourSection(insetContour(courtyardFront, 35), 120, site.width),
    [surroundings.road.x - 350, surroundings.neighborYard.z + 35],
  ];
  const wallInner = insetContour(wallOuter, 200);
  const wallSegments: GarageObstacle[] = wallOuter.slice(1).map((p, i) => ({
    id: `outer-wall-${i + 1}`,
    label: "外沿矮墙",
    kind: "wall",
    footprint: [wallOuter[i], p, wallInner[i + 1], wallInner[i]],
    bottom: site.garageFloor,
    top: site.garageFloor + 1040,
  }));
  const westFront = courtyardFront[0]?.[1] ?? 0;
  const westWall: GarageObstacle = {
    id: "west-wall",
    label: "旁田交界墙",
    kind: "wall",
    footprint: rectangle(0, westFront, 120, -westFront),
    bottom: site.garageFloor,
    top: site.adjacentUnexcavatedLevel,
  };
  return {
    columns: columnObstacles,
    columnWidth,
    outerWall: [...wallOuter, ...wallInner.slice().reverse()],
    wallSegments,
    westWall,
    obstacles: [...columnObstacles, ...wallSegments, westWall],
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
      // 仅用于画出保留地坪投影。真实最低梁底与道路必须联测，不能拿板底代替梁底。
      modelSlabBottom,
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
  garageLayout.wallSegments = next.wallSegments;
  garageLayout.westWall = next.westWall;
  garageLayout.obstacles = next.obstacles;
  garageLayout.entry = next.entry;
  garageLayout.retainedDeck = next.retainedDeck;
  garageLayout.proposedCut = next.proposedCut;
}
