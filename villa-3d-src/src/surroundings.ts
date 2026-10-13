import { site, frontFieldLevel, type Point } from "./data";

// 全部左右关系按站在北侧、面对房子描述：画面左侧为 X 增大。
// 对齐关系来自用户；周边房屋尺寸、未测标高和田坎折点仍是航拍估算。
const sideHouse = { x: 21.75, z: 0.4, w: 12, d: 8.5, y: 0, h: 5.3 };
const leftEdge = sideHouse.x + sideHouse.w;
const rearRight = site.main.x + site.main.w / 2;
const frontRight = site.main.x + (site.main.w * 2) / 3;

export const surroundings = {
  sideHouse,
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
    z: -23.75,
    w: leftEdge - frontRight,
    d: 7.5,
    y: frontFieldLevel - site.frontHouseDrop,
    floorHeight: 3.2,
    floors: 2,
  },
  neighborYard: { x: site.width, z: -8.6, w: leftEdge - site.width, d: 9 },
  road: { x: leftEdge, w: 3.4, front: -26.5, back: 18, entryY: -2 },
  leftPlatform: { x: leftEdge + 3.4, front: -10.5, back: 10.8, y: 0.6 },
  rearFirst: { front: site.oldDepth, back: 16.2, y: site.rearField },
  rearSecond: { front: 16.2, back: 29.5, y: 5 },
  rearThird: { front: 29.5, back: 36, y: 6.8 },
  rightStep: site.annex.z + (site.annex.d * 2) / 3,
  forestStart: 36,
  extent: { left: -32, right: 55, front: -30, back: 36 },
};

// 辅楼前墙向后约 2/3 处起坎；后段与院坪齐平，前段与地库地坪齐平。
export const rightTerraceBreak: Point[] = [
  [-32, 8],
  [-24, 6.9],
  [-16, 4.9],
  [-8, 4.2],
  [0, surroundings.rightStep],
];
export const rightLowerBreak = rightTerraceBreak.map(([x, z]): Point => [
  x,
  z - 11,
]);

function interpolate(points: Point[], position: number) {
  for (let i = 1; i < points.length; i++) {
    if (position <= points[i][0]) {
      const [a, b] = points[i - 1],
        [c, d] = points[i];
      return b + ((position - a) / (c - a)) * (d - b);
    }
  }
  return points.at(-1)![1];
}

// 道路在邻居木房左墙外，入口一段保持同一标高，避免坡道接口出现高低缝。
export const roadStations: Point[] = [
  [-26.5, surroundings.frontHouse.y],
  [-16, frontFieldLevel],
  [-8.6, -2],
  [-6.1, -2],
  [0.4, 0],
  [10.8, 0.8],
  [18, 4.2],
];
export function roadHeight(z: number) {
  return interpolate(roadStations, z);
}

export function groundHeight(x: number, z: number) {
  const c = surroundings;
  if (z >= c.forestStart) {
    const distance = z - c.forestStart;
    return (
      c.rearThird.y +
      distance * 0.34 +
      Math.sin(x * 0.13) * 1.6 * Math.min(1, distance / 12)
    );
  }
  if (z >= c.rearThird.front) return c.rearThird.y;
  if (z >= c.rearSecond.front) return c.rearSecond.y;
  if (z >= c.rearFirst.front) return c.rearFirst.y;
  if (x >= c.leftPlatform.x && z >= c.leftPlatform.front)
    return c.leftPlatform.y;
  if (x < 0) {
    if (z >= interpolate(rightTerraceBreak, Math.max(-32, x))) return 0;
    if (z >= interpolate(rightLowerBreak, Math.max(-32, x)))
      return site.garageFloor;
    return c.frontHouse.y;
  }
  if (z < -12) return c.frontHouse.y;
  if (z >= 0 && x <= c.road.x) return 0;
  return frontFieldLevel;
}

export function forestTrees() {
  // 独立种子使建模顺序改变时，后山树群也保持稳定；近景两侧不种树。
  let seed = 92013;
  const rand = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: 420 }, () => {
    const x = -48 + rand() * 120,
      z = surroundings.forestStart + 2 + rand() * 43;
    return {
      x,
      z,
      y: groundHeight(x, z),
      h: 4.5 + rand() * 7,
      r: 1.1 + rand() * 1.4,
    };
  });
}
