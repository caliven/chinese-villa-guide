import { frontApronOutline, entranceApproachLayout, porticoFrontZ, porticoWallZ, recessedPortico, hasThirdFloorSideTerraces } from "./building-variants";
import { continuousGlazingGrid } from "./continuous-glazing";
import { entryAssemblyDesign, entryPartOutline } from "./entry-assembly";
import { moveWindowDesign, windowDesign, windowOpeningLine } from "./window-design";
import { PORTICO_BEAM_DEPTH, porticoColumnOuterWidth } from "./frontage-geometry";
import { porticoShoulderProfile, cornerShoulderProfile, upperCornerProfile, hatPierCrownProfile, hatPierDesign, type ColumnCourse } from "./column-profiles";
import { Vector3 } from "three";
import { isHalfStoreyScheme } from "./construction-scheme";
import { clipHalfStoreyPolygon, halfStoreyRoof } from "./half-storey";
import { halfStoreyBalconyBeams, halfStoreyBalconyPieces, halfStoreyBalusterProfile, halfStoreyFloorOutline, halfStoreyPorticoColumns, halfStoreyPorticoDesign } from "./half-storey-portico.ts";
import { floatingHatJunctions, hatJunctionFaces } from "./hat-junctions";
import { elevationModel, rearBalconyLayout, withLayoutContext, type VillaLayoutLive } from "./architecture";
import { annexPartitions, construction, floors, site, type Point } from "./data";
import { joinedWallSpan, wallJunctionPeers } from "./partition-geometry";
import { raiseOpeningsToFinish } from "./foundation";
import type { Facade } from "./facades";
import { roofProjectedEdges } from "./roof-plan";
import { roofRidgeRings, subtractRoofPolygon, type RoofFace } from "./roof-surfaces";
import { bayOutline, cornerPilasterBody, eyelidLayerTops, floatingHatEaveRearZ, hatEaveRim, frontTerraceRailRuns, terraceParapetLayout, terraceParapetWallRuns, apronSupportOutline, hatSupportInset } from "./facade-details";
import { apronEaveDesign, floorSlabThickness, frontApronSection, fasciaBottomY, gutterOuterWallTop, eyelidFixed, withAnnexRoofDesign, roofGutterDesign, slabToTileEaveLift, roofTileInset, roofTileThickness, roofStyleLabels, type RoofStyle } from "./roof-options";

export const elevationLabels = {
  north: "北立面（正立面）", south: "南立面（背立面）", east: "东立面", west: "西立面",
} as const;
export type ElevationView = keyof typeof elevationLabels;
export type ElevationBuilding = "main" | "annex";
const directions = {
  north: { u: new Vector3(-1, 0, 0), eye: new Vector3(0, 0, -1), side: 0, left: "东", right: "西" },
  south: { u: new Vector3(1, 0, 0), eye: new Vector3(0, 0, 1), side: 3, left: "西", right: "东" },
  east: { u: new Vector3(0, 0, -1), eye: new Vector3(1, 0, 0), side: 2, left: "南", right: "北" },
  west: { u: new Vector3(0, 0, 1), eye: new Vector3(-1, 0, 0), side: 1, left: "北", right: "南" },
};
const n = (v: number) => Math.round(v);
const points = (p: Point[]) => p.map(([u, v]) => `${n(u)},${n(v)}`).join(" ");
const line = (a: Point, b: Point, cls = "el-detail") => `<path d="M${n(a[0])} ${n(a[1])} L${n(b[0])} ${n(b[1])}" class="${cls}"/>`;
const text = (u: number, v: number, label: string, cls = "el-label", anchor = "middle") => `<text x="${n(u)}" y="${n(v)}" text-anchor="${anchor}" class="${cls}">${label}</text>`;
const height = (v: number) => v === 0 ? "±0" : `${v > 0 ? "+" : ""}${n(v)}`;

export interface ElevationSurface {
  points: Vector3[];
  cls: string;
  detail?: string;
  occludes?: boolean;
  part?: string;
}
export function projectElevation(p: Vector3, view: ElevationView): Point {
  return [p.dot(directions[view].u), -p.y];
}
const area = (p: Point[]) => Math.abs(p.reduce((sum, a, i) => {
  const b = p[(i + 1) % p.length];
  return sum + a[0] * b[1] - a[1] * b[0];
}, 0) / 2);

/** 各平面在正投影中的深度为一次函数；遮挡只扣除真正位于该面前方的部分。 */
function depthPlane(surface: ElevationSurface, view: ElevationView) {
  const p = surface.points.map(v => ({ u: v.dot(directions[view].u), v: -v.y, d: v.dot(directions[view].eye) }));
  const a = p[0];
  for (let i = 1; i < p.length - 1; i++) {
    const b = p[i], c = p[i + 1];
    const det = (b.u - a.u) * (c.v - a.v) - (c.u - a.u) * (b.v - a.v);
    if (Math.abs(det) < .01) continue;
    const x = ((b.d - a.d) * (c.v - a.v) - (c.d - a.d) * (b.v - a.v)) / det;
    const y = ((b.u - a.u) * (c.d - a.d) - (c.u - a.u) * (b.d - a.d)) / det;
    return [x, y, a.d - x * a.u - y * a.v];
  }
  return [0, 0, a.d];
}
function clipNear(polygon: Point[], plane: number[]): Point[] {
  const result: Point[] = [];
  const distance = ([u, v]: Point) => plane[0] * u + plane[1] * v + plane[2] - .1;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length], a = distance(p), b = distance(q);
    if (a >= 0) result.push(p);
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const t = a / (a - b);
      result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  });
  return result;
}

const isElevationFloorSlab = (part?: string) => !!part && (
  part === "third-floor-slab" || part === "half-storey-balcony-slab" || part === "rear-balcony-slab"
);

/** 凸面片逐一消隐。保留原轮廓绘制，不把消隐切片或屋面共面缝画成实体边。 */
export function visibleElevationPolygons(surfaces: ElevationSurface[], view: ElevationView): Point[][][] {
  const projected = surfaces.map(s => s.points.map(p => projectElevation(p, view)));
  const planes = surfaces.map(s => depthPlane(s, view));
  const bounds = projected.map(polygon => ({
    left: Math.min(...polygon.map(p => p[0])), right: Math.max(...polygon.map(p => p[0])),
    top: Math.min(...polygon.map(p => p[1])), bottom: Math.max(...polygon.map(p => p[1])),
  }));
  // 楼板世界标高，用于清掉贴板厚的外墙残片。
  const slabBands = surfaces.filter(s => isElevationFloorSlab(s.part)).map(s => {
    const ys = s.points.map(point => point.y);
    return { bottom: Math.min(...ys), top: Math.max(...ys) };
  });
  return projected.map((polygon, i) => {
    let remaining = [polygon];
    for (let j = 0; j < surfaces.length && remaining.length; j++) {
      if (i === j || surfaces[j].occludes === false || area(projected[j]) < 1) continue;
      const a = bounds[i], b = bounds[j];
      if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) continue;
      // 楼板只表示板厚轮廓，不切割外墙，否则墙面会多出板底／板顶双线。
      if (surfaces[i].part === "exterior-wall" && isElevationFloorSlab(surfaces[j].part)) continue;
      // 与外墙外皮齐平的楼板侧面属于墙面内部，不显示独立板底轮廓。
      const flushSlab = isElevationFloorSlab(surfaces[i].part) && surfaces[j].part === "exterior-wall"
        && planes[j].every((v, k) => Math.abs(v - planes[i][k]) < 1e-6);
      const cover = flushSlab ? projected[j] : clipNear(projected[j], planes[j].map((v, k) => v - planes[i][k]));
      if (cover.length < 3 || area(cover) < 1) continue;
      remaining = remaining.flatMap(p => subtractRoofPolygon(p, cover)).filter(p => area(p) > 1);
    }
    // 门厅靠背等顶到板底时，可能留下贴楼板的外墙残片；立面楼面按单线接缝表达。
    if (surfaces[i].part === "exterior-wall" && slabBands.length)
      remaining = remaining.filter(p => {
        const ys = p.map(point => point[1]), lo = Math.min(...ys), hi = Math.max(...ys);
        return !slabBands.some(band => Math.abs(-lo - band.top) < 2 && Math.abs(-hi - band.bottom) < 2);
      });
    return remaining;
  });
}

export function elevationShell(view: ElevationView, style: RoofStyle, layout?: VillaLayoutLive | null, balcony = false, building: ElevationBuilding = "main") {
  return withLayoutContext(layout, () => buildElevationShell(view, style, layout, balcony, building));
}

function buildElevationShell(view: ElevationView, style: RoofStyle, layout?: VillaLayoutLive | null, balcony = false, building: ElevationBuilding = "main") {
  const model = elevationModel(style, layout), { main: m, annex: a, front: f, roof: r } = model;
  const surfaces: ElevationSurface[] = [];
  let owner: ElevationBuilding = "main";
  const project = (p: Vector3) => projectElevation(p, view);
  const face = (p: Vector3[], cls: string, detail = "", occludes = true, part?: string) => {
    if (owner === building && area(p.map(project)) > 1) surfaces.push({ points: p, cls, detail, occludes, part });
  };
  const box = (x: number, z: number, w: number, d: number, y: number, h: number, cls: string, part?: string) => {
    const side = directions[view].side;
    const [p, q]: Point[] = side === 0 ? [[x, z], [x + w, z]] : side === 3 ? [[x, z + d], [x + w, z + d]]
      : side === 1 ? [[x, z], [x, z + d]] : [[x + w, z], [x + w, z + d]];
    face([new Vector3(p[0], y, p[1]), new Vector3(q[0], y, q[1]), new Vector3(q[0], y + h, q[1]), new Vector3(p[0], y + h, p[1])], cls, "", true, part);
  };
  const columnCourses = (x: number, z: number, base: number, courses: ColumnCourse[]) => {
    const at = (p: Point, y: number) => new Vector3(x + p[0], base + y, z + p[1]);
    for (const c of courses) for (let i = 0; i < c.lower.length; i++) {
      const j = (i + 1) % c.lower.length;
      face([at(c.lower[i], c.bottom), at(c.lower[j], c.bottom), at(c.upper[j], c.top), at(c.upper[i], c.top)],
        "el-trim", "", true, "column-shoulder");
    }
  };
  const wall = (facade: Facade, base: number, h: number, join = { start: 0, end: 0 }) => {
    const { a, b } = facade, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tangent = new Vector3((b[0] - a[0]) / len, 0, (b[1] - a[1]) / len);
    const normal = new Vector3(tangent.z, 0, -tangent.x);
    const half = construction.outsideWall / 2;
    const skin = normal.dot(directions[view].eye) >= 0 ? half : -half;
    const at = (distance: number, y: number, offset = skin) => new Vector3(a[0], base + y, a[1])
      .addScaledVector(tangent, distance).addScaledVector(normal, offset);
    let detail = "";
    for (const o of facade.openings) {
      if (o.continuous || o.entryAssembly) continue;
      const low = o.sill, high = o.span === "lower" ? h : Math.min(h, o.sill + o.h);
      const start = o.at - o.w / 2, end = o.at + o.w / 2;
      const p = [at(start, low), at(end, low), at(end, high), at(start, high)].map(project);
      if (o.kind === "passage") {
        detail += `<polygon points="${points(p)}" class="el-passage"><title>门洞（无门）</title></polygon>`;
        continue;
      }
      if (!o.door) {
        const grid = moveWindowDesign(windowDesign(o.w, o.h), start, low);
        const shape = (r: { x: number; y: number; w: number; h: number }) => points([at(r.x, r.y), at(r.x + r.w, r.y), at(r.x + r.w, r.y + r.h), at(r.x, r.y + r.h)].map(project));
        detail += `<g><title>组合窗 · ${n(o.w)}×${n(o.h)} · 固定玻璃与开启扇按尺寸分格</title>`
          + grid.panes.map(p => `<polygon points="${shape(p)}" class="el-window" data-window-pane="1"/>`).join("")
          + grid.frames.map(f => `<polygon points="${shape(f)}" class="el-glazing-frame" data-window-frame="${f.role}"/>`).join("")
          + grid.windows.map(w => `<polyline points="${points(windowOpeningLine(w).map(([x, y]) => project(at(x, y))))}" class="el-opening-sash"><title>可开启窗</title></polyline>`).join("") + `</g>`;
        continue;
      }
      detail += `<polygon points="${points(p)}" class="${o.door && !o.glazed ? "el-door" : "el-window"}"/>`;
      detail += line(project(at(o.at, low)), project(at(o.at, high)));
      if (!o.door || o.glazed) detail += line(project(at(start, low + (high - low) * .65)), project(at(end, low + (high - low) * .65)));
    }
    // 门窗仍沿原墙线定位，外轮廓沿用实体的墙角搭接延长量。
    const start = -join.start, end = len + join.end;
    const outline = [at(start, 0), at(end, 0), at(end, h), at(start, h)];
    const drawWall = (points: Vector3[], detail = "") => face(
      isHalfStoreyScheme && base === model.floors[2].y ? clipHalfStoreyPolygon(points) : points,
      "el-wall", detail, true, "exterior-wall");
    drawWall(outline, detail);
    // 垂直于观察面的墙端同样形成可见外壳，避免墙角少画半个墙厚。
    const endDistance = tangent.dot(directions[view].eye) >= 0 ? end : start;
    drawWall([at(endDistance, 0, -half), at(endDistance, 0, half),
      at(endDistance, h, half), at(endDistance, h, -half)]);
  };
  model.floors.forEach((floor, index) => {
    const peers = wallJunctionPeers((layout?.floors ?? floors)[index].partitions, floor.facades);
    const rise = index === 0 ? site.entranceRise : 0;
    const topSlab = !isHalfStoreyScheme && index === 2 ? floorSlabThickness : 0;
    floor.facades.forEach(w => wall({ ...w, openings: raiseOpeningsToFinish(w.openings, rise) },
      floor.y + rise, Math.max(200, floor.height - rise - topSlab),
      isHalfStoreyScheme && index === 2 ? { start: 0, end: 0 } : joinedWallSpan(w, peers).join));
  });
  box(m.x, m.z, m.w, m.d, 0, site.entranceRise, "el-wall");
  owner = "annex";
  const annexPeers = wallJunctionPeers(layout?.annexPartitions ?? annexPartitions, model.annexFacades);
  model.annexFacades.forEach(w => wall({ ...w, openings: raiseOpeningsToFinish(w.openings, site.entranceRise) },
    site.entranceRise, Math.max(200, a.height - site.entranceRise), joinedWallSpan(w, annexPeers).join));
  box(a.x, a.z, a.w, a.d, 0, site.entranceRise, "el-wall");
  owner = "main";

  for (const panel of model.glazing) {
    const dx = panel.b[0] - panel.a[0], dz = panel.b[1] - panel.a[1], len = Math.hypot(dx, dz);
    if (view === "north" || view === "south" ? Math.abs(dz) > 1 : Math.abs(dx) > 1) continue;
    const mid = new Vector3((panel.a[0] + panel.b[0]) / 2 - (m.x + m.w / 2), 0, (panel.a[1] + panel.b[1]) / 2 - (m.z + m.d / 2));
    if (mid.dot(directions[view].eye) <= 0) continue;
    const at = (t: number, y: number) => new Vector3(panel.a[0] + dx * t / len, y, panel.a[1] + dz * t / len).addScaledVector(directions[view].eye, construction.outsideWall / 2 + 1);
    const start = panel.at - panel.w / 2, end = panel.at + panel.w / 2;
    const grid = continuousGlazingGrid(panel);
    const shape = (r: { x: number; y: number; w: number; h: number }) => points([at(r.x, r.y), at(r.x + r.w, r.y), at(r.x + r.w, r.y + r.h), at(r.x, r.y + r.h)].map(project));
    const detail = `<title>挑空客厅通高玻璃 · ${n(panel.w)}×${n(panel.top - panel.bottom)} · 按尺寸分格，下方可开启窗</title>`
      + grid.panes.map(p => `<polygon points="${shape(p)}" class="el-window" data-glazing-pane="1"/>`).join("")
      + grid.frames.map(f => `<polygon points="${shape(f)}" class="el-glazing-frame"><title>${f.role}</title></polygon>`).join("")
      + grid.windows.map(w => {
        const p = windowOpeningLine(w).map(([x, y]) => project(at(x, y)));
        return `<polyline points="${points(p)}" class="el-opening-sash"><title>下方可开启窗</title></polyline>`;
      }).join("");
    face([at(start, panel.bottom), at(end, panel.bottom), at(end, panel.top), at(start, panel.top)], "el-glazing-frame", detail);
  }

  for (const entry of model.entries) {
    if (view !== "north") continue;
    const dx = entry.b[0] - entry.a[0], dz = entry.b[1] - entry.a[1], length = Math.hypot(dx, dz);
    const at = (t: number, y: number) => new Vector3(entry.a[0] + dx * t / length, y, entry.a[1] + dz * t / length - 140);
    const shape = (r: { x: number; y: number; w: number; h: number }) => [at(r.x, r.y), at(r.x + r.w, r.y), at(r.x + r.w, r.y + r.h), at(r.x, r.y + r.h)];
    const parts = entryAssemblyDesign(entry);
    const detail = `<title>一门到顶门窗 · ${n(entry.w)}×${n(entry.top - entry.bottom)} · 上下同宽，中段装饰板，上部固定组合窗</title>`
      + parts.map(part => `<polygon points="${points(entryPartOutline(part).map(([x, y]) => project(at(x, y))))}" class="${part.role === "glass" ? "el-window" : part.role === "relief" || part.role === "handle" ? "el-entry-relief" : "el-entry-frame"}" data-entry-part="${part.role}"><title>${part.name}</title></polygon>`).join("");
    face(shape({ x: entry.at - entry.w / 2, y: entry.bottom, w: entry.w, h: entry.top - entry.bottom }), "el-entry-frame", detail);
  }

  // 檐口按真实折线挤出；雕花、瓦垄与细部节点在立面中简化表达。
  const rim = (outline: Point[], y: number, h: number, cls: string, frontGap?: [number, number], part?: string) => {
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % outline.length];
      const segments: [Point, Point][] = frontGap && i === 0
        ? [[p, [frontGap[0], p[1]]], [[frontGap[1], p[1]], q]] : [[p, q]];
      for (const [a, b] of segments)
        face([new Vector3(a[0], y, a[1]), new Vector3(b[0], y, b[1]), new Vector3(b[0], y + h, b[1]), new Vector3(a[0], y + h, a[1])], cls, "", cls !== "el-glass-rail", part);
    });
  };
  const rect = (x: number, z: number, w: number, d: number): Point[] => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
  const mainOutline = (inset: number) => style === "joined"
    ? bayOutline(r.main.x, r.main.z, r.main.w, r.main.d, r.hat.x, r.hat.w, r.hat.z, inset)
    : rect(r.main.x + inset, r.main.z + inset, r.main.w - 2 * inset, r.main.d - 2 * inset);
  // 与实体共用三眼皮分层，保留阶梯外缘及压顶，而非整块等高矩形。
  const eaveLayers = (outline: (inset: number) => Point[], base: number, gap?: [number, number]) => {
    for (const layer of eyelidLayerTops(base))
      rim(outline(layer.inset), layer.top - layer.thick, layer.thick, "el-trim", gap, "roof-eyelid");
    const copingBase = base + floorSlabThickness + roofGutterDesign.clearDepth;
    rim(outline(-eyelidFixed.copingOverhang), copingBase,
      gutterOuterWallTop() - roofGutterDesign.clearDepth, "el-trim", gap, "roof-coping");
  };
  eaveLayers(mainOutline, r.main.eave, r.frontTrimGap);
  owner = "annex";
  withAnnexRoofDesign(() => eaveLayers(inset => rect(r.annex.x + inset, r.annex.z + inset,
    r.annex.w - 2 * inset, r.annex.d - 2 * inset), r.annex.eave));
  owner = "main";
  if (style === "floating") {
    const end = floatingHatEaveRearZ(r.main.z + roofTileInset, r.main.eave + slabToTileEaveLift(), r.pitch.fenShui / 10, r.hat.eave);
    eaveLayers(inset => hatEaveRim(r.hat.x, r.hat.z, r.hat.w, inset,
      roofGutterDesign.outerTopWidth, end), r.hat.eave);
    for (const j of floatingHatJunctions(r.hat.z, r.hat.eave, r.main.eave, model.floors[2].front, hatSupportInset(), f))
      for (const polygon of hatJunctionFaces(j))
        face(polygon.map(p => new Vector3(...p)), "el-trim", "", true, "hat-junction");
  }
  const onSegment = (p: Vector3, a: Vector3, b: Vector3) => {
    const ab = b.clone().sub(a), t = p.clone().sub(a).dot(ab) / ab.lengthSq();
    return t >= -1e-6 && t <= 1 + 1e-6 && a.clone().addScaledVector(ab, t).distanceTo(p) < .1;
  };
  const roofs = (faces: RoofFace[]) => {
    const edges = roofProjectedEdges(faces);
    for (const f of faces) {
      const normal = new Vector3();
      for (let i = 1; i < f.points.length - 1 && normal.lengthSq() < .01; i++) normal.copy(f.points[i]).sub(f.points[0]).cross(f.points[i + 1].clone().sub(f.points[0]));
      if (normal.y < 0) normal.negate();
      if (normal.dot(directions[view].eye) <= .01) continue;
      const detail = edges.filter(e => f.points.some((a, i) => onSegment(e.a, a, f.points[(i + 1) % f.points.length]) && onSegment(e.b, a, f.points[(i + 1) % f.points.length])))
        .map(e => line(project(e.a), project(e.b), "el-roof-edge")).join("");
      face(f.points, f.owner === 1 ? "el-hat" : "el-roof", detail);
    }
    for (const edge of edges.filter(edge => edge.kind === "edge"))
      face([edge.a, edge.b, edge.b.clone().add(new Vector3(0, -roofTileThickness, 0)),
        edge.a.clone().add(new Vector3(0, -roofTileThickness, 0))], "el-trim", "", true, "roof-tile-edge");
  };
  const ridges = (segments: [Vector3, Vector3][]) => {
    for (const [a, b] of segments) {
      const axis = b.clone().sub(a).normalize();
      const [lower, upper] = roofRidgeRings(a, b);
      for (let i = 0; i < 16; i++) {
        const next = (i + 1) % 16;
        const normal = lower[i].clone().add(lower[next]).multiplyScalar(.5).sub(a);
        if (normal.dot(directions[view].eye) > .01)
          face([lower[i], lower[next], upper[next], upper[i]], "el-trim", "", true, "roof-ridge");
      }
      face(axis.dot(directions[view].eye) >= 0 ? upper : lower, "el-trim", "", true, "roof-ridge");
    }
  };
  roofs(r.mainFaces);
  ridges(r.mainRidges);
  owner = "annex";
  roofs(r.annexFaces);
  ridges(r.annexRidges);
  const c = model.chimney;
  box(c.x - 230, c.z - 230, 460, 460, c.base - 400, c.capY - c.base + 400, "el-wall");
  box(c.x - 360, c.z - 360, 720, 720, c.capY, 120, "el-trim");

  owner = "main";
  const y3 = model.floors[2].y, p = r.portico;
  const apronHeights = frontApronSection(y3 + f.eaveParapet, f.tiledEaveDrop);
  const capitalTop = apronHeights.columnTopY, fasciaBot = apronHeights.fasciaBottomY;
  // 立面门厅柱按堂屋角点；将军柱另在露台段绘制。
  const columnSize = f.porticoColumnDepth;
  if (isHalfStoreyScheme && !recessedPortico()) {
    const drawPiece = (piece: ReturnType<typeof halfStoreyPorticoColumns>[number]) => {
      if (piece.shape === "baluster") {
        const profile = halfStoreyBalusterProfile.filter(([radius]) => radius > 0);
        const outline = [...profile, ...profile.slice().reverse().map(([radius, y]): Point => [-radius, y])];
        const center = new Vector3(piece.x + piece.w / 2, piece.y, piece.z + piece.d / 2)
          .addScaledVector(directions[view].eye, piece.w / 2);
        face(outline.map(([radius, y]) => center.clone().addScaledVector(directions[view].u, radius * piece.w)
          .add(new Vector3(0, y * piece.h, 0))), "el-column", `<title>${piece.name}</title>`);
      } else {
        box(piece.x, piece.z, piece.w, piece.d, piece.y, piece.h, "el-column");
      }
    };
    halfStoreyPorticoColumns(model.floors, p).forEach(drawPiece);
    for (const index of [1, 2]) {
      const floor = model.floors[index];
      rim(halfStoreyFloorOutline(floor.front, p, index), floor.y - construction.floorSlab,
        construction.floorSlab, "el-trim", undefined, "half-storey-balcony-slab");
      for (const beam of halfStoreyBalconyBeams(p))
        box(beam.x, beam.z, beam.w, beam.d,
          floor.y - construction.floorSlab - halfStoreyPorticoDesign.beamDepth,
          halfStoreyPorticoDesign.beamDepth, "el-trim");
      halfStoreyBalconyPieces(floor, index, p).forEach(drawPiece);
    }
  }
  for (const x of recessedPortico() || isHalfStoreyScheme ? [] : f.postXs) {
    box(x - columnSize / 2, f.porticoColumnZ - columnSize / 2, columnSize, columnSize,
      site.entranceRise - 20, capitalTop - (site.entranceRise - 20), "el-column");
    columnCourses(x, f.porticoColumnZ, 0, porticoShoulderProfile(columnSize, columnSize, capitalTop, fasciaBot));
  }
  if (!recessedPortico() && !isHalfStoreyScheme) box(f.postXs[0] + columnSize / 2 - 8, f.porticoColumnZ - PORTICO_BEAM_DEPTH / 2,
    f.postXs[1] - f.postXs[0] - columnSize + 16, PORTICO_BEAM_DEPTH, fasciaBot - 670, 670, "el-trim");
  if (!recessedPortico() && !isHalfStoreyScheme) {
    const returns = frontApronOutline(f.terraceBack, 0, f, p);
    const backing = (a: Point, b: Point, outward: Point, depth: number) => {
      const height = apronHeights.soffitY - fasciaBot;
      const rake = Math.min(60, height * .2, depth * .25);
      const footprint = [a, b, [b[0] - outward[0] * depth, b[1] - outward[1] * depth],
        [a[0] - outward[0] * depth, a[1] - outward[1] * depth]];
      const lower = footprint.map(point => new Vector3(point[0], fasciaBot, point[1]));
      const upper = footprint.map(point => new Vector3(point[0] + outward[0] * rake,
        apronHeights.soffitY, point[1] + outward[1] * rake));
      face(upper, "el-trim", "", true, "portico-backing");
      for (let i = 0; i < 4; i++)
        face([lower[i], lower[(i + 1) % 4], upper[(i + 1) % 4], upper[i]],
          "el-trim", "", true, "portico-backing");
    };
    backing(returns[3], returns[4], [0, -1], PORTICO_BEAM_DEPTH);
    const depth = Math.min(280, columnSize * .35);
    const from = f.porticoColumnZ - columnSize / 2 + 8;
    const to = m.z + construction.outsideWall / 2;
    if (to > from + 40) {
      for (const [x, outward] of [[returns[3][0], -1], [returns[4][0], 1]]) {
        box(outward < 0 ? x : x - depth, from, depth, to - from,
          fasciaBot - 670, 670, "el-trim");
        backing([x, from], [x, to], [outward, 0], depth);
      }
    }
  }
  for (const x of isHalfStoreyScheme ? [] : f.postXs) {
    const height = fasciaBottomY(r.hat.eave, 0) - y3;
    box(x - f.dividerWidth / 2, f.postZ - hatPierDesign.depth / 2, f.dividerWidth, hatPierDesign.depth,
      y3, height - hatPierDesign.capHeight, "el-column");
    columnCourses(x, f.postZ, y3, hatPierCrownProfile(f.dividerWidth, height));
  }
  // 包角柱以 L 形两肢概括；檐口高度四周对齐正屋下沿线底（三层下层正面仍对挑檐下沿线）。
  const frontCornerZ = m.z - (isHalfStoreyScheme ? 0 : 120);
  const eaveFasciaBottom = fasciaBottomY(r.main.eave, 0);
  for (const [x, outward] of [[f.cornerWestX, -1], [f.cornerEastX, 1]]) {
    const x0 = x + (outward < 0 ? -f.cornerProject : -f.cornerLeg);
    const frontTop = isHalfStoreyScheme ? eaveFasciaBottom
      : frontApronSection(y3 + f.eaveParapet, f.tiledEaveDrop).columnTopY;
    const cornerBearingTop = isHalfStoreyScheme ? eaveFasciaBottom : fasciaBot;
    box(x0, frontCornerZ - f.cornerProject, f.cornerLeg + f.cornerProject, f.cornerProject + 20, 0, frontTop, "el-column");
    box(outward < 0 ? x - f.cornerProject : x - 20, frontCornerZ, f.cornerProject + 20, f.cornerLeg, 0, frontTop, "el-column");
    columnCourses(x, frontCornerZ, 0, cornerShoulderProfile(f.cornerProject, f.cornerLeg, outward, frontTop, cornerBearingTop));
    if (!isHalfStoreyScheme) columnCourses(x, model.floors[2].front, y3,
      upperCornerProfile(f.cornerProject, f.cornerLeg, outward, eaveFasciaBottom - y3));
  }
  for (const [x, outward] of [[m.x, -1], [m.x + m.w, 1]])
    for (const piece of cornerPilasterBody(eaveFasciaBottom, outward, 1))
      box(x + piece.x - piece.w / 2, m.z + m.d + piece.z - piece.d / 2,
        piece.w, piece.d, piece.y - piece.h / 2, piece.h, "el-column", "rear-corner-column");
  const { westOuter, westInner, eastInner, eastOuter, columnNorth } = entranceApproachLayout(f, p);
  const landing = columnNorth - construction.entranceLandingOffset, steps = landing - construction.entranceTread * 2;
  box(westOuter, landing, eastOuter - westOuter, porticoWallZ() - landing, 0, site.entranceRise, "el-wall");
  for (const [x0, x1] of [[westOuter, westInner], [eastInner, eastOuter]]) box(x0, steps, x1 - x0, landing - steps, 0, site.entranceRise, "el-wall");
  for (let i = 0; i < 2; i++) box(westInner, steps + i * construction.entranceTread, eastInner - westInner, construction.entranceTread + 10, 0, site.entranceRise * (i + 1) / 3, "el-wall");
  for (const [high, low] of recessedPortico() ? [] : [[eastOuter - 20, eastOuter + construction.entranceRampRun], [westOuter + 20, westOuter - construction.entranceRampRun]]) {
    const shape = (z: number) => [new Vector3(high, 0, z), new Vector3(low, 0, z), new Vector3(low, 20, z), new Vector3(high, site.entranceRise, z)];
    face(shape(columnNorth), "el-wall"); face(shape(m.z + 20), "el-wall");
    face([new Vector3(high, site.entranceRise, columnNorth), new Vector3(low, 20, columnNorth), new Vector3(low, 20, m.z + 20), new Vector3(high, site.entranceRise, m.z + 20)], "el-wall");
  }
  const apron = frontApronSection(y3 + f.eaveParapet, f.tiledEaveDrop);
  const cornerPosts = terraceParapetLayout(f, p).cornerPosts;
  const terracePosts = isHalfStoreyScheme ? [] : hasThirdFloorSideTerraces() ? cornerPosts : cornerPosts.slice(1, 3);
  if (!isHalfStoreyScheme) {
    for (const run of frontTerraceRailRuns(model.floors[2].front)) {
      const bottom = y3 + f.eaveParapet;
      const a = new Vector3(run.a[0], bottom, run.a[1]), b = new Vector3(run.b[0], bottom, run.b[1]);
      face([a, b, b.clone().add(new Vector3(0, 680, 0)), a.clone().add(new Vector3(0, 680, 0))], "el-glass-rail", "", false);
    }
    const { thick } = terraceParapetLayout(f, p);
    for (const { a, b } of terraceParapetWallRuns(model.floors[2].front, f, p)) {
      if (Math.abs(b[0] - a[0]) > 1)
        box(Math.min(a[0], b[0]), a[1] - thick / 2, Math.abs(b[0] - a[0]), thick, y3, f.eaveParapet, "el-wall");
      else box(a[0] - thick / 2, Math.min(a[1], b[1]), thick, Math.abs(b[1] - a[1]), y3, f.eaveParapet, "el-wall");
    }
    for (const post of terracePosts) {
      const foot = post.w + 80;
      const central = post.x >= p.x && post.x <= p.x + p.w;
      const capWidth = Math.min(post.w + 120, central ? porticoColumnOuterWidth(post.w) : Infinity);
      box(post.x - foot / 2, post.z - foot / 2, foot, foot,
        y3, f.eaveParapet + 130, "el-column");
      box(post.x - post.w / 2, post.z - post.w / 2, post.w, post.w,
        y3 + f.eaveParapet + 130, f.balustradePostHeight - 130, "el-column");
      box(post.x - capWidth / 2, post.z - (post.w + 120) / 2, capWidth, post.w + 120,
        y3 + f.eaveParapet + f.balustradePostHeight - 80, 80, "el-trim");
    }
  }
  // 二楼顶部仅为无天沟瓦挑檐，外缘按独立薄檐板高度概括，不套屋顶反坎或三眼皮。
  const e = site.secondFrontEave;
  const apronBack = hasThirdFloorSideTerraces() ? f.terraceBack : model.floors[2].front + 40;
  const inner = frontApronOutline(apronBack, 0, f, p);
  const outer = frontApronOutline(apronBack, e, f, p);
  const { fasciaOuter: fascia, outer: apronOuter } = apronSupportOutline(inner, outer,
    [m.x - construction.outsideWall / 2, m.x + m.w + construction.outsideWall / 2]);
  if (!isHalfStoreyScheme) for (let i = 0; i < inner.length - 1; i++) {
    const at = (p: Point, y: number) => new Vector3(p[0], y, p[1]);
    const tile = [at(apronOuter[i], apron.tileOuterY), at(apronOuter[i + 1], apron.tileOuterY),
      at(inner[i + 1], apron.tileInnerY), at(inner[i], apron.tileInnerY)];
    const bed = tile.map(point => point.clone().add(new Vector3(0, -roofTileThickness - 2, 0)));
    face(tile, "el-roof", "", true, "apron-tiles");
    face(bed, "el-trim", "", true, "apron-bedding");
    for (let edge = 0; edge < bed.length; edge++) {
      const a = bed[edge], b = bed[(edge + 1) % bed.length];
      face([new Vector3(a.x, y3, a.z), new Vector3(b.x, y3, b.z), b, a],
        "el-trim", "", true, "apron-bedding");
    }
  }
  if (!isHalfStoreyScheme) for (let i = 0; i < fascia.length - 1; i++) {
    const [a, b] = [fascia[i], fascia[i + 1]];
    face([new Vector3(a[0], apron.fasciaBottomY, a[1]), new Vector3(b[0], apron.fasciaBottomY, b[1]),
      new Vector3(b[0], apron.fasciaTopY, b[1]), new Vector3(a[0], apron.fasciaTopY, a[1])], "el-trim", "", true, "apron-support");
  }
  if (!isHalfStoreyScheme) rim([...apronOuter, [m.x + m.w, apronBack], [m.x + m.w, m.z + m.d],
    [m.x, m.z + m.d], [m.x, apronBack]], apron.soffitY, apronEaveDesign.boardThickness, "el-trim", undefined, "third-floor-slab");
  if (balcony) {
    const { x, w, z } = rearBalconyLayout();
    box(x, z, w, 1200, y3 - 180, 180, "el-trim", "rear-balcony-slab");
    rim([[x + 50, z], [x + 50, z + 1150], [x + w - 50, z + 1150], [x + w - 50, z]], y3, 1120, "el-glass-rail");
  }
  // 下沿线只作外壳控制线，屋面及墙体共享同一檐口标高。
  rim(rect(m.x - 100, model.floors[2].front - 100, m.w + 200,
    m.z + m.d - model.floors[2].front + 200), fasciaBottomY(r.main.eave, 0),
    100, "el-trim", r.frontTrimGap, "roof-fascia");
  return { model, surfaces };
}

function dimension(a: number, b: number, y: number, from: number) {
  const [u0, u1] = [a, b].sort((x, y) => x - y);
  return `<path d="M${n(u0)} ${n(from)} V${n(y + 100)} M${n(u1)} ${n(from)} V${n(y + 100)} M${n(u0)} ${n(y)} H${n(u1)} M${n(u0 - 65)} ${n(y + 65)} l130 -130 M${n(u1 - 65)} ${n(y + 65)} l130 -130" class="el-dim"/>${text((u0 + u1) / 2, y - 170, String(n(u1 - u0)), "el-dim-label")}`;
}
/** 标注文字避让短尺寸段，尺寸界线始终连接真实标高。 */
function heightDimensions(segments: [string, number, number][], edge: number) {
  let previousY = Infinity;
  return segments.filter(([, bottom, top]) => top > bottom).map(([name, bottom, top]) => {
    const x = edge + 500, y0 = -bottom, y1 = -top;
    const middle = (y0 + y1) / 2;
    const labelY = Math.min(middle, previousY - 390);
    previousY = labelY;
    const ticks = [y0, y1].map(y => line([x - 65, y + 65], [x + 65, y - 65], "el-dim")).join("");
    return `<g data-height-region="${name}" data-height-bottom="${n(bottom)}" data-height-top="${n(top)}">`
      + line([edge + 100, y0], [x + 120, y0], "el-dim")
      + line([edge + 100, y1], [x + 120, y1], "el-dim")
      + line([x, y0], [x, y1], "el-dim") + ticks
      + line([x + 80, middle], [x + 240, labelY], "el-dim")
      + text(x + 320, labelY, String(n(top) - n(bottom)), "el-dim-label", "start")
      + text(x + 1170, labelY, name, "el-small", "start") + "</g>";
  }).join("");
}

export const elevationStyles = `
.elevation-svg text{font-family:system-ui,sans-serif;fill:#333;dominant-baseline:middle}
.elevation-svg .el-label{font-size:250px}.elevation-svg .el-title{font-size:350px;font-weight:600}
.elevation-svg .el-small{font-size:220px;fill:#555}.elevation-svg .el-dim-label{font-size:250px;fill:#444}
.elevation-svg .el-wall,.elevation-svg .el-column,.elevation-svg .el-trim{fill:#fff;stroke:#444;stroke-width:24px}
.elevation-svg .el-roof,.elevation-svg .el-hat{fill:url(#elevation-tiles);stroke:#444;stroke-width:24px}
.elevation-svg .el-roof-edge{fill:none;stroke:#333;stroke-width:30px}
.elevation-svg .el-window{fill:#fff;stroke:#444;stroke-width:30px}
.elevation-svg .el-glazing-frame,.elevation-svg .el-entry-frame{fill:#555;stroke:none}
.elevation-svg .el-entry-relief{fill:#aaa;stroke:none}
.elevation-svg .el-opening-sash{fill:none;stroke:#666;stroke-width:18px;stroke-dasharray:75 45}
.elevation-svg .el-door,.elevation-svg .el-passage{fill:#fff;stroke:#444;stroke-width:25px}
.elevation-svg .el-glass-rail{fill:none;stroke:#555;stroke-width:28px}
.elevation-svg .el-detail{fill:none;stroke:#555;stroke-width:20px}
.elevation-svg .el-dim{fill:none;stroke:#666;stroke-width:18px}
.elevation-svg .el-level{fill:none;stroke:#777;stroke-width:18px;stroke-dasharray:130 90}
.elevation-svg .el-ground{fill:none;stroke:#222;stroke-width:50px}
`;

export function elevationSvg(view: ElevationView, style: RoofStyle, layout?: VillaLayoutLive | null, balcony = false, building: ElevationBuilding = "main") {
  return withLayoutContext(layout, () => buildElevationDrawing(view, style, layout, balcony, building).svg);
}

function buildElevationDrawing(view: ElevationView, style: RoofStyle, layout?: VillaLayoutLive | null, balcony = false, building: ElevationBuilding = "main") {
  const { model, surfaces } = elevationShell(view, style, layout, balcony, building);
  const visible = visibleElevationPolygons(surfaces, view);
  const all = surfaces.flatMap(s => s.points.map(p => projectElevation(p, view)));
  const min = Math.min(...all.map(p => p[0])), max = Math.max(...all.map(p => p[0]));
  const roofPeak = building === "main" ? model.roof.mainRidgePeak : model.roof.annexRidgePeak;
  const peak = Math.max(roofPeak, ...surfaces.flatMap(s => s.points.map(p => p.y)));
  const left = min - 3600, top = -peak - 1800, width = max - min + 8000, bottom = 2350;
  const id = `el-${view}-${style}-${building}`;
  const buildingLabel = building === "main" ? "主楼" : "辅楼";
  const clip = visible.map((p, i) => `<clipPath id="${id}-${i}" clipPathUnits="userSpaceOnUse">${p.map(p => `<polygon points="${points(p)}"/>`).join("")}</clipPath>`).join("");
  const drawing = surfaces.map((s, i) => visible[i].length ? `<g clip-path="url(#${id}-${i})"><polygon points="${points(s.points.map(p => projectElevation(p, view)))}" class="${s.cls}"/>${s.detail ?? ""}</g>` : "").join("");
  const { main: m, annex: a, roof: r } = model;
  const u = (x: number, z: number) => projectElevation(new Vector3(x, 0, z), view)[0];
  let dimensions = "";
  if (view === "north" || view === "south") {
    const b = building === "main" ? m : a;
    dimensions += dimension(u(b.x, 0), u(b.x + b.w, 0), 850, 0);
    if (building === "main" && view === "north") dimensions += dimension(u(r.portico.x, 0), u(r.portico.x + r.portico.w, 0), -peak - 420, -r.hat.peak);
  } else {
    const b = building === "main" ? m : a;
    dimensions += dimension(u(0, b.z), u(0, b.z + b.d), 850, 0);
    if (building === "main" && !recessedPortico()) dimensions += dimension(u(0, porticoFrontZ()), u(0, porticoWallZ()), 850, 0);
  }
  const levels: [string, number][] = building === "main"
    ? [["院坪基准", 0], ["首层完成面", site.entranceRise], ["二层楼面", model.floors[1].y],
      [isHalfStoreyScheme ? "半层楼面" : "三层楼面", model.floors[2].y],
      ["屋面板底", r.main.eave],
      [isHalfStoreyScheme ? "三楼天沟板面" : "主楼屋面板顶", r.main.eave + floorSlabThickness],
      ["瓦檐面", r.main.eave + slabToTileEaveLift()], ["主楼坡面脊线", r.mainPeak],
      ["屋脊最高点", roofPeak]]
    : [["院坪基准", 0], ["首层完成面", site.entranceRise], ["屋面板底", r.annex.eave],
      ["辅楼屋面板顶", r.annex.eave + floorSlabThickness], ["瓦檐面", r.annex.eave + r.annexProfile.tileLift],
      ["辅楼坡面脊线", r.annexPeak], ["屋脊最高点", roofPeak], ["辅楼最高点", peak]];
  let previousLevelY = Infinity;
  const labels = levels.sort((a, b) => a[1] - b[1]).map(([name, y]) => {
    const x = min - 250, ty = Math.min(-y, previousLevelY - 390);
    previousLevelY = ty;
    return line([x, -y], [min, -y], "el-level")
      + `<path d="M${n(x)} ${n(-y)} l-110 -150 h220 Z" fill="#555"/>`
      + line([x - 120, -y], [x - 250, ty], "el-level")
      + text(x - 300, ty, `${name} ${height(y)}`, "el-label", "end");
  }).join("");
  const segments: [string, number, number][] = [["地基抬高", 0, site.entranceRise]];
  if (building === "main") {
    model.floors.forEach((floor, index) => {
      const bottom = index === 0 ? site.entranceRise : floor.y;
      const top = index === 2 ? r.main.eave + floorSlabThickness : floor.y + floor.height;
      segments.push([isHalfStoreyScheme && index === 2 ? "半层高度" : `${["一", "二", "三"][index]}层层高`, bottom, top]);
    });
  } else segments.push(["一层层高", site.entranceRise, a.height + floorSlabThickness]);
  const roof = building === "main" ? r.main : r.annex;
  const tileEave = roof.eave + (building === "main" ? slabToTileEaveLift() : r.annexProfile.tileLift);
  const tilePeak = building === "main" ? r.mainPeak : r.annexPeak;
  segments.push(["屋面构造", roof.eave + floorSlabThickness, tileEave], ["坡屋顶升高", tileEave, tilePeak], ["脊瓦高度", tilePeak, roofPeak]);
  if (peak > roofPeak) segments.push([building === "annex" ? "烟囱超出屋脊" : "构件超出屋脊", roofPeak, peak]);
  const totalX = max + 3700, totalY = -peak / 2;
  const heights = heightDimensions(segments, max)
    + `<g data-height-region="总高度" data-height-bottom="0" data-height-top="${n(peak)}">`
    + line([max + 100, 0], [totalX + 120, 0], "el-dim")
    + line([max + 100, -peak], [totalX + 120, -peak], "el-dim")
    + line([totalX, 0], [totalX, -peak], "el-dim")
    + `<text x="${n(totalX + 250)}" y="${n(totalY)}" transform="rotate(-90 ${n(totalX + 250)} ${n(totalY)})" text-anchor="middle" class="el-dim-label">总高度 ${n(peak)}</text></g>`;
  const sumLabel = text((min + max) / 2, 1510, `高度合计：${segments.filter(([, bottom, top]) => top > bottom).map(([, bottom, top]) => n(top) - n(bottom)).join("＋")}＝${n(peak)}`, "el-small");
  const extra = building === "main" && !isHalfStoreyScheme
    ? text((min + max) / 2, -peak - 1050, `官帽瓦脊 ${height(r.hat.peak)}`, "el-small") : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="floor-svg elevation-svg" data-elevation="${view}" data-building="${building}" data-roof-style="${style}" viewBox="${n(left)} ${n(top)} ${n(width)} ${n(bottom - top)}" role="img" aria-label="${buildingLabel}${elevationLabels[view]}，当前方案正投影"><title>${buildingLabel}${elevationLabels[view]} · ${roofStyleLabels[style]} · 单位 mm</title><desc>左为${directions[view].left}，右为${directions[view].right}。${buildingLabel}的外墙、洞口和屋面${building === "main" ? "及门厅" : "及烟囱"}正投影，按深度消隐；雕花、栏杆及檐口细部简化。标高相对暂定院坪基准，非施工图。</desc><defs><style>${elevationStyles.replaceAll("elevation-tiles", `${id}-tiles`)}</style><pattern id="${id}-tiles" width="240" height="120" patternUnits="userSpaceOnUse"><rect width="240" height="120" fill="white"/><path d="M0 0h240 M0 120h240 M0 0q30 0 30 60t30 60 M120 0q30 0 30 60t30 60" fill="none" stroke="#999" stroke-width="10"/></pattern>${clip}</defs><rect x="${n(left)}" y="${n(top)}" width="${n(width)}" height="${n(bottom - top)}" fill="#fff"/>${drawing}${line([min - 180, 0], [max + 180, 0], "el-ground")}${labels}${heights}${extra}${dimensions}${sumLabel}${text((min + max) / 2, 2100, `${buildingLabel}${elevationLabels[view]}　｜　左：${directions[view].left} · 右：${directions[view].right}`, "el-title")}</svg>`;
  return { svg, segments, levels, peak, roofPeak, plateBottom: roof.eave, plateTop: roof.eave + floorSlabThickness };
}

/** 与SVG共用同一次标高计算，显示值以取整后的端点相减，分段相加严格等于总高。 */
function heightSummary(drawing: ReturnType<typeof buildElevationDrawing>, building: ElevationBuilding) {
  const { segments, peak, roofPeak, plateBottom, plateTop } = drawing;
  const parts = segments.filter(([, bottom, top]) => top > bottom);
  const rows = parts.map(([name, bottom, top]) => `<tr><th scope="row">${name}</th><td>${n(top) - n(bottom)}</td><td>${height(bottom)} → ${height(top)}</td></tr>`).join("");
  const formula = parts.map(([, bottom, top]) => n(top) - n(bottom)).join("＋");
  const firstHeight = n(segments[1][2]) - n(segments[1][1]);
  const firstNote = building === "main" && !isHalfStoreyScheme
    ? `三层方案的二层楼面标高参数从院坪起算；当前首层实际层高＝${n(segments[1][2])}－${n(site.entranceRise)}＝${firstHeight}。`
    : "各层高度从本层楼面／完成面起算，入户抬高单列。";
  return `<div class="elevation-height-summary" data-height-summary="${building}"><h4>高度明细 · mm · 院坪为 ±0</h4><p>${firstNote}层高包含上方120板厚，屋面构造从板顶起算。板底 ${height(plateBottom)}，板顶 ${height(plateTop)}；板厚120已计入层高。</p><table><thead><tr><th scope="col">层次</th><th scope="col">分段高度</th><th scope="col">起止标高</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">总高度</th><td>${n(peak)}</td><td>±0 → ${height(peak)}</td></tr></tfoot></table><p class="elevation-height-sum">${formula}＝${n(peak)}</p><p>屋面构造＝天沟内挡高度＋瓦檐面至内挡顶高差。坡屋顶升高＝瓦檐面至坡面脊线的竖向高差，由跨度与分水计算。脊瓦高度按实际构件截面计算，默认130。${building === "annex" ? `屋脊最高点 ${height(roofPeak)}；总高度包含烟囱盖板。` : "总高度量至最高构件顶。"}各标高取整到毫米后求段差，细部不再另外累加。</p></div>`;
}

export function elevationPlan(view: ElevationView, style: RoofStyle, layout?: VillaLayoutLive | null, balcony = false) {
  const drawings = (["main", "annex"] as ElevationBuilding[]).map(building => ({
    building, drawing: withLayoutContext(layout, () => buildElevationDrawing(view, style, layout, balcony, building)),
  }));
  const overallPeak = Math.max(...drawings.map(({ drawing }) => drawing.peak));
  const controls = `<section class="plan-sheet"><div class="plan-sheet-head"><h3>建筑立面图</h3><div class="roof-drawing-tabs" role="group" aria-label="选择立面方向">${(Object.keys(elevationLabels) as ElevationView[]).map(key => `<button type="button" data-elevation-view="${key}" class="secondary-button${view === key ? " active" : ""}" aria-pressed="${view === key}">${elevationLabels[key]}</button>`).join("")}</div></div><div class="roof-plan-meta elevation-plan-meta"><span>正投影 · 长度／相对标高：mm</span><span>左：${directions[view].left} · 右：${directions[view].right}</span><span>当前屋面：${roofStyleLabels[style]}</span><div class="elevation-roof-switch" role="group" aria-label="立面官帽造型">${(Object.keys(roofStyleLabels) as RoofStyle[]).map(key => `<button type="button" data-roof-style="${key}" class="secondary-button${style === key ? " active" : ""}" aria-pressed="${style === key}">${roofStyleLabels[key]}</button>`).join("")}</div></div><p class="elevation-height-summary" data-overall-height="${n(overallPeak)}">整屋总高度 <strong>${n(overallPeak)}</strong>（院坪至最高构件，mm）；主楼 ${n(drawings[0].drawing.peak)}，辅楼含烟囱 ${n(drawings[1].drawing.peak)}。主辅楼并列，总高度取最高点。</p></section>`;
  const sheets = drawings.map(({ building, drawing }) => {
    const label = building === "main" ? "主楼" : "辅楼";
    return `<section class="plan-sheet"><div class="plan-sheet-head"><h3>${label} · ${elevationLabels[view]}</h3><div class="roof-drawing-tabs"><button type="button" data-download-elevation="${building}" class="secondary-button">下载${label} SVG</button></div></div>${drawing.svg}${heightSummary(drawing, building)}<p class="roof-plan-note">${label}独立正投影，与当前方案的尺寸和外部门窗联动；雕花、瓦垄、栏杆与檐口细部简化，标高相对暂定院坪基准。方案示意，非施工图。</p></section>`;
  }).join("");
  return `<div class="plan-sheets">${controls}${sheets}</div>`;
}
