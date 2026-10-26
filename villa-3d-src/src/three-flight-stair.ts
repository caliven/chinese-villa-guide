import type { StairShapeInput } from "./stair-geometry";

/** U形三跑：两侧平行梯段，中间横跑，两个独立的90°休息平台。 */
export function threeFlightCounts(risers: number) {
  const total = Math.max(12, Math.round(risers));
  const outer = Math.floor(total / 3);
  return { total, outer, middle: total - outer * 2 };
}

export function threeFlightShape(s: StairShapeInput) {
  const counts = threeFlightCounts(s.risers);
  const lowerRisers = counts.outer, upperRisers = counts.outer, middleRisers = counts.middle;
  const lowerTreads = lowerRisers - 1, upperTreads = upperRisers - 1, middleTreads = middleRisers - 1;
  const middleTread = s.middleTread ?? s.tread;
  const run = lowerTreads * s.tread, across = 2 * s.landing + middleTreads * middleTread;
  const length = run + s.landing;
  const lowerSide = s.lowerSide ?? (s.axis === "z" ? "max" : "min");
  const lowerAcross = lowerSide === "min" ? 0 : across - s.flight;
  const upperAcross = lowerSide === "min" ? across - s.flight : 0;
  const direction = s.direction ?? "positive";
  const point = (cross: number, along: number) => {
    const distance = direction === "negative" ? length - along : along;
    return s.axis === "z" ? { x: s.x + cross, z: s.z + distance } : { x: s.x + distance, z: s.z + cross };
  };
  const local = (x: number, z: number) => {
    const distance = s.axis === "z" ? z - s.z : x - s.x;
    return { across: s.axis === "z" ? x - s.x : z - s.z, along: direction === "negative" ? length - distance : distance };
  };
  const rect = (cross: number, along: number, width: number, depth: number) => {
    const a = point(cross, along), b = point(cross + width, along + depth);
    return { x: Math.min(a.x, b.x), z: Math.min(a.z, b.z), w: Math.abs(b.x - a.x), d: Math.abs(b.z - a.z) };
  };
  const firstAcross = lowerSide === "min" ? 0 : across - s.landing;
  const secondAcross = lowerSide === "min" ? across - s.landing : 0;
  const middleAlong = length - s.flight;
  // 每跑沿上行方向记录端点；二维、实体、板底与扶手读取同一份数据。
  const flights = [
    { cross: lowerAcross, along: 0, crossSize: s.flight, alongSize: run, axis: "along" as const, sign: 1, risers: lowerRisers, startRiser: 0 },
    { cross: s.landing, along: middleAlong, crossSize: middleTreads * middleTread, alongSize: s.flight, axis: "across" as const, sign: lowerSide === "min" ? 1 : -1, risers: middleRisers, startRiser: lowerRisers },
    { cross: upperAcross, along: 0, crossSize: s.flight, alongSize: run, axis: "along" as const, sign: -1, risers: upperRisers, startRiser: lowerRisers + middleRisers },
  ].map(f => ({ ...f, tread: f.axis === "across" ? middleTread : s.tread, bounds: rect(f.cross, f.along, f.crossSize, f.alongSize) }));
  const platforms = [
    { cross: firstAcross, along: run, riser: lowerRisers, bounds: rect(firstAcross, run, s.landing, s.landing) },
    { cross: secondAcross, along: run, riser: lowerRisers + middleRisers, bounds: rect(secondAcross, run, s.landing, s.landing) },
  ];
  return {
    model: "triple" as const, risers: counts.total, lowerRisers, upperRisers, middleRisers,
    lowerTreads, upperTreads, middleTreads, run, across, length, lowerSide, lowerAcross, upperAcross, direction,
    lowerStart: 0, upperStart: 0, point, local, rect, flights, platforms,
    lower: flights[0].bounds, upper: flights[2].bounds, landing: platforms[0].bounds,
    footprint: rect(0, 0, across, length),
  };
}
