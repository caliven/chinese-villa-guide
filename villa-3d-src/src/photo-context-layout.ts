import type { Point } from "./data.ts";

/** 北侧131730与IMG_5135照片估算。长度mm，标高相对院坪，均待现场复核。 */
export const northPhotoReferences = [
  "dji_fly_20260816_131730_732_1786857561396_photo.jpg",
  "IMG_5135.JPG",
];

export function easternPhotoHouses(roadX: number) {
  return [
    { name: "东侧山脚粉顶两层邻房", kind: "masonry", facing: "west", stories: 2, x: roadX + 15500, z: 17000,
      w: 8500, d: 8500, y: 2500, h: 6600, roofRise: 1100 },
    { name: "东侧山脚中间木石邻房", kind: "timber", facing: "west", stories: 1, x: roadX + 24000, z: 3500,
      w: 6667, d: 7500, y: 2500, h: 3200, roofRise: 950 },
    { name: "东侧山脚外侧木房", kind: "timber", facing: "north", stories: 1, x: roadX + 36000, z: -5500,
      w: 10000, d: 7200, y: 0, h: 4000, roofRise: 1100 },
  ];
}

// 东侧窄田随山脚斜向房前展开，屋后林缘继续用原始DEM坡势。
export function easternPhotoContours(roadRight: number): { y: number; points: Point[] }[] {
  const contours: { y: number; points: Point[] }[] = [
    { y: -4500, points: [[roadRight, -19000], [50000, -21000], [65000, -23000], [83000, -25000]] },
    { y: -2000, points: [[roadRight, -13000], [50000, -15500], [65000, -18500], [83000, -21000]] },
    { y: 0, points: [[roadRight, -9000], [50000, -11500], [65000, -14500], [83000, -17500]] },
    { y: 2500, points: [[roadRight, -4000], [50000, -8000], [65000, -11000], [83000, -13500]] },
    { y: 3500, points: [[roadRight, 9000], [50000, 4000], [65000, -2500], [83000, -9500]] },
    { y: 5000, points: [[roadRight, 20000], [50000, 15000], [65000, 9500], [83000, 3000]] },
    { y: 6800, points: [[roadRight, 31000], [50000, 28000], [65000, 25000], [83000, 21500]] },
  ];
  const shift = roadRight - 37150;
  return contours.map(contour => ({
    y: contour.y,
    points: contour.points.map(([x, z], index): Point => [index === 0 ? roadRight : x + shift, z]),
  }));
}

/** 照片只确定河道关系、岸线和桥位。河床落差沿用路面以下3.8m的估算。 */
export function northCreekSection(x: number, roadFrontZ: number, roadY: number) {
  const t = Math.max(0, Math.min(1, (x + 32000) / 115000));
  return {
    centerZ: roadFrontZ - (8000),
    halfWidth: 4000 + 1800 * Math.sin(t * Math.PI),
    bedY: roadY - 3800 + 1000 * (t - 0.4),
  };
}

export function northernPhotoWatercourses(roadFront: (x: number) => number, roadY: number | ((x: number) => number), bridgeX: number) {
  // 用户确认两溪经过桥洞后汇合，合流流向西面。汇合点放在桥西侧出口外。
  const elevation = typeof roadY === "number" ? () => roadY : roadY;
  const junctionX = bridgeX - 4200;
  const junction = northCreekSection(junctionX, roadFront(junctionX), elevation(junctionX));
  const east: Point[] = [];
  const west: Point[] = [];
  for (let x = junctionX; x <= 83000; x += 1000) east.push([x, northCreekSection(x, roadFront(x), elevation(x)).centerZ]);
  east.push([83000, northCreekSection(83000, roadFront(83000), elevation(83000)).centerZ]);
  for (let x = -32000; x < junctionX; x += 1000) west.push([x, northCreekSection(x, roadFront(x), elevation(x)).centerZ]);
  west.push([junctionX, junction.centerZ], [junctionX - 1200, junction.centerZ - 8000],
    [junctionX - 4500, junction.centerZ - 18000], [junctionX - 8000, -70000]);
  return [
    { name: "东侧支溪", points: east.reverse(), halfWidth: 4200, wetWidth: 1800, bedY: elevation(bridgeX) - 3800 },
    { name: "北侧支溪与西向合流段", points: west.reverse(), halfWidth: 5800, wetWidth: 2600, bedY: elevation(bridgeX) - 3800 },
  ];
}

export function distanceToPhotoPath(x: number, z: number, points: Point[]) {
  let closest = { distance: Infinity, x: 0, z: 0 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    const px = a[0] + dx * t, pz = a[1] + dz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (distance < closest.distance) closest = { distance, x: px, z: pz };
  }
  return closest;
}
