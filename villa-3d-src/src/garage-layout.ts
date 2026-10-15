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

// 统一供实体建模和路线筛查使用；以下构件仍是方案示意，不是保留结构测绘。
const columns = basementColumns();
const columnWidth = 0.36;
const modelSlabBottom = -0.23;
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
  ...contourSection(insetContour(courtyardFront, 0.035), 0.12, site.width),
  [surroundings.road.x - 0.35, surroundings.neighborYard.z + 0.035],
];
const wallInner = insetContour(wallOuter, 0.2);
const wallSegments: GarageObstacle[] = wallOuter.slice(1).map((p, i) => ({
  id: `outer-wall-${i + 1}`,
  label: "外沿矮墙",
  kind: "wall",
  footprint: [wallOuter[i], p, wallInner[i + 1], wallInner[i]],
  bottom: site.garageFloor,
  top: site.garageFloor + 1.04,
}));
const westWall: GarageObstacle = {
  id: "west-wall",
  label: "旁田交界墙",
  kind: "wall",
  footprint: rectangle(0, courtyardFront[0][1], 0.12, -courtyardFront[0][1]),
  bottom: site.garageFloor,
  top: site.adjacentUnexcavatedLevel,
};

export const garageLayout = {
  columns: columnObstacles,
  columnWidth,
  outerWall: [...wallOuter, ...wallInner.slice().reverse()],
  wallSegments,
  westWall,
  obstacles: [...columnObstacles, ...wallSegments, westWall],
  entry: { x: site.width, z: -8.6, w: surroundings.road.x - site.width, d: 2.5 },
  retainedDeck: {
    footprint: rectangle(
      site.width, surroundings.neighborYard.z,
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
