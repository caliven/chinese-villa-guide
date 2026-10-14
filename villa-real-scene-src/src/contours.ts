import type { Point } from "./data";

// 田埂控制点按 X 递增。保形 Hermite 插值保留转折，不越过相邻点的 Z 范围。
// 采样结果同时供田面、田坎、院坪和高度查询使用，避免各自拟合留下缝隙。
export function smoothContour(points: Point[], spacing = 0.45): Point[] {
  const slopes = points.slice(1).map((p, i) =>
    (p[1] - points[i][1]) / (p[0] - points[i][0]),
  );
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes.at(-1)!;
    const a = slopes[i - 1], b = slopes[i];
    if (a * b <= 0) return 0;
    const left = points[i][0] - points[i - 1][0];
    const right = points[i + 1][0] - points[i][0];
    const w1 = 2 * right + left, w2 = right + 2 * left;
    return (w1 + w2) / (w1 / a + w2 / b);
  });
  const result: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x, z] = points[i], [X, Z] = points[i + 1];
    const width = X - x;
    const steps = Math.max(1, Math.ceil(Math.hypot(width, Z - z) / spacing));
    for (let j = 0; j < steps; j++) {
      const t = j / steps, t2 = t * t, t3 = t2 * t;
      result.push([
        x + width * t,
        (2 * t3 - 3 * t2 + 1) * z + (t3 - 2 * t2 + t) * width * tangents[i]
          + (-2 * t3 + 3 * t2) * Z + (t3 - t2) * width * tangents[i + 1],
      ]);
    }
  }
  result.push([...points.at(-1)!]);
  return result;
}

export function contourAt(points: Point[], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const a = points[i - 1], b = points[i];
      return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
  }
  return points.at(-1)![1];
}

export function contourSection(points: Point[], from: number, to: number): Point[] {
  return [
    [from, contourAt(points, from)],
    ...points.filter(([x]) => x > from && x < to),
    [to, contourAt(points, to)],
  ];
}

export function betweenContours(front: Point[], back: Point[], from: number, to: number): Point[] {
  return [
    ...contourSection(front, from, to),
    ...contourSection(back, from, to).reverse(),
  ];
}

// 向田埂的南侧内收；只移动附属构件，田埂本身的控制点不变。
export function insetContour(points: Point[], distance: number): Point[] {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    return [p[0] - dz / length * distance, p[1] + dx / length * distance];
  });
}
