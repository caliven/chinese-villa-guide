import type { Point } from "./data";

// 这栋蓝顶邻房按航拍重建。只有三层、三开间、左侧单层柴火房、
// 一楼同高及约 5 米（5000 mm）横向空隙来自用户；本文件长度单位均为毫米，具体外轮廓、层高、转角和纵向位置均为估算。
export const roadsideVillaShape = {
  w: 12400,
  d: 9800,
  floorHeights: [3400, 3300, 3200],
  angle: 43,
  z: -16600,
  extensionGap: 5000,
  eave: 550,
  roofRise: 2450,
  portico: { w: 4400, d: 1800 },
  wing: { w: 4200, d: 8800, setback: 200, h: 3400 },
};

export function placeRoadsideVilla(annexWest: number, firstFloor: number) {
  const h = roadsideVillaShape;
  const rotation = h.angle * Math.PI / 180;
  const c = Math.cos(rotation), s = Math.sin(rotation);
  // 最东侧取整栋外墙，包括面对邻房时左侧的柴火房；不能只比较未旋转的主楼。
  const wingEast = h.w / 2 + h.wing.w;
  const wingBack = -h.d / 2 + h.wing.setback + h.wing.d;
  const eastReach = Math.max(h.w / 2 * c + h.d / 2 * s, wingEast * c + wingBack * s);
  return { ...h, x: annexWest - h.extensionGap - eastReach, y: firstFloor, rotation };
}

export type RoadsideVilla = ReturnType<typeof placeRoadsideVilla>;

// 与 Three.js 绕 Y 轴的正旋转一致：本地 -Z 正面转到世界西北，+X 是面对邻房的左侧。
export function roadsideToWorld(h: RoadsideVilla, x: number, z: number): Point {
  const c = Math.cos(h.rotation), s = Math.sin(h.rotation);
  return [h.x + x * c + z * s, h.z - x * s + z * c];
}

export function roadsideFootprints(h: RoadsideVilla): Point[][] {
  const rectangle = (x: number, z: number, w: number, d: number) =>
    [[x, z], [x + w, z], [x + w, z + d], [x, z + d]]
      .map(([px, pz]) => roadsideToWorld(h, px, pz));
  return [
    rectangle(-h.w / 2, -h.d / 2, h.w, h.d),
    rectangle(h.w / 2, -h.d / 2 + h.wing.setback, h.wing.w, h.wing.d),
  ];
}
