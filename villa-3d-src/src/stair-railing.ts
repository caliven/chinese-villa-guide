import * as THREE from "three";
import { stairShape, type StairShapeInput } from "./stair-geometry";
import { railingThickness, type RailingStyle } from "./railing-options";
import type { RailingSection } from "./railing-network";

/** 只描述扶手路径和踏步支承；平台、斜段及楼层转角在同一网络中连接。 */
export function stairRailingSections(geometry: StairShapeInput, base: number, height: number, style: RailingStyle): RailingSection[] {
  const shape = stairShape(geometry), rise = height / shape.risers;
  const inset = railingThickness(style) / 2 + 20, railInset = Math.max(60, inset), flight = geometry.flight;
  const sections: RailingSection[] = [];
  const world = (p: number[]) => {
    const point = shape.point(p[0], p[2]);
    return new THREE.Vector3(point.x, base + p[1], point.z);
  };
  const guard = (a: number[], b: number[], footing?: { t: number; y: number }[], startHeight = 950, endHeight = 950) => {
    if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 1) return;
    sections.push({ a: world(a), b: world(b), height: 950, style, startHeight, endHeight,
      footing: footing?.map(p => ({ ...p, y: base + p.y })), connectionGroup: "stair" });
  };
  const innerCross = (offset: number) => offset + (offset === 0 ? flight - railInset : railInset);
  if (shape.model === "triple") {
    for (const [index, f] of shape.flights.entries()) {
      const length = f.axis === "along" ? f.alongSize : f.crossSize;
      const pos = (distance: number, y: number) => {
        const along = f.sign > 0 ? distance : length - distance;
        return f.axis === "along"
          ? [innerCross(index === 0 ? shape.lowerAcross : shape.upperAcross), y, f.along + along]
          : [f.cross + along, y, f.along + railInset];
      };
      const start = pos(index === 0 ? -inset : 0, rise * f.startRiser);
      const end = pos(length + (index === 2 ? inset : 0), rise * (f.startRiser + f.risers));
      const total = length + (index === 0 || index === 2 ? inset : 0);
      const footing = Array.from({ length: f.risers }, (_, i) => ({
        t: (i * f.tread + (index === 0 ? inset : 0)) / total, y: rise * (f.startRiser + i + 1),
      }));
      if (index === 0) footing.unshift({ t: 0, y: 0 });
      guard(start, end, footing, index === 0 ? 1100 : 950 + rise, index === 2 ? 1100 : 950);
    }
    for (const [i, p] of shape.platforms.entries()) {
      const outer = i === 0 ? shape.lowerAcross : shape.upperAcross;
      const cross = innerCross(outer), along = shape.length - flight + railInset;
      const end = p.cross + (outer === 0 ? geometry.landing : 0), y = rise * p.riser;
      const a = [cross, y, shape.run], b = [cross, y, along], c = [end, y, along];
      guard(a, b); guard(b, c);
    }
    return sections;
  }
  const left = innerCross(shape.lowerAcross), right = innerCross(shape.upperAcross), mid = rise * shape.lowerRisers;
  const total = shape.run + inset;
  const lowerFooting = [{ t: 0, y: 0 }, ...Array.from({ length: shape.lowerTreads + 1 }, (_, i) => ({
    t: (shape.lowerStart + i * geometry.tread + inset) / total, y: rise * Math.min(shape.lowerRisers, i + 1),
  }))];
  const upperFooting = Array.from({ length: shape.upperTreads + 1 }, (_, i) => ({
    t: i * geometry.tread / total, y: mid + rise * Math.min(shape.upperRisers, i + 1),
  }));
  guard([left, 0, -inset], [left, mid, shape.run], lowerFooting, 1100, 950);
  guard([right, mid, shape.run], [right, height, -inset], upperFooting, 950 + rise, 1100);
  guard([left, mid, shape.run], [right, mid, shape.run]);
  return sections;
}
