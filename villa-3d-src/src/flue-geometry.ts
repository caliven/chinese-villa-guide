import type { Point } from "./data.ts";

/** 在X/Y侧面生成连续折弯扁管轮廓；转角共用斜接边，不叠放多个方盒。 */
export function flueOutline(path: Point[], thickness: number): Point[] {
  const normals = path.slice(1).map((p, i) => {
    const dx = p[0] - path[i][0], dy = p[1] - path[i][1], len = Math.hypot(dx, dy);
    return [-dy / len, dx / len] as Point;
  });
  const side = (sign: number) => path.map(([x, y], i): Point => {
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(i, normals.length - 1)];
    const divisor = 1 + a[0] * b[0] + a[1] * b[1];
    return [x + sign * thickness / 2 * (a[0] + b[0]) / divisor,
      y + sign * thickness / 2 * (a[1] + b[1]) / divisor];
  });
  return [...side(1), ...side(-1).reverse()];
}

/** 同一扁管的侧面与窄面供四向立面投影使用。 */
export function flueFaces(outline: Point[], z: number, width: number): [number, number, number][][] {
  const front = outline.map(([x, y]) => [x, y, z - width / 2] as [number, number, number]);
  const back = outline.map(([x, y]) => [x, y, z + width / 2] as [number, number, number]);
  const count = outline.length / 2;
  const sides = [front, back].flatMap(ring => Array.from({ length: count - 1 }, (_, i) =>
    [ring[i], ring[i + 1], ring[ring.length - 2 - i], ring[ring.length - 1 - i]]));
  return [...sides, ...front.map((p, i) => [p, front[(i + 1) % front.length], back[(i + 1) % front.length], back[i]])];
}
