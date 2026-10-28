import { porticoFrontZ, porticoWallZ, recessedPortico, hasThirdFloorSideTerraces } from "./building-variants";
import { continuousGlazingGrid } from "./continuous-glazing";
import { entryAssemblyDesign, entryPartOutline } from "./entry-assembly";
import { moveWindowDesign, windowDesign, windowOpeningLine } from "./window-design";
import { PORTICO_BEAM_DEPTH, porticoColumnOuterWidth } from "./frontage-geometry";
import { porticoShoulderProfile, cornerShoulderProfile, upperCornerProfile, hatPierCrownProfile, hatPierDesign, type ColumnCourse } from "./column-profiles";
import { Vector3 } from "three";
import { floatingHatJunctions, hatJunctionFaces } from "./hat-junctions";
import { elevationModel, type VillaLayoutLive } from "./architecture";
import { construction, site, type Point } from "./data";
import type { Facade } from "./facades";
import { roofProjectedEdges } from "./roof-plan";
import { subtractRoofPolygon, type RoofFace } from "./roof-surfaces";
import { bayOutline, hatEaveRim, frontTerraceRailRuns, apronSupportOutline, hatSupportInset } from "./facade-details";
import { apronEaveDesign, frontApronSection, fasciaBottomY, gutterOuterWallTop, roofGutterDesign, roofTileEaveLift, roofTileInset, roofStyleLabels, type RoofStyle } from "./roof-options";

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

/** 凸面片逐一消隐。保留原轮廓绘制，不把消隐切片或屋面共面缝画成实体边。 */
export function visibleElevationPolygons(surfaces: ElevationSurface[], view: ElevationView): Point[][][] {
  const projected = surfaces.map(s => s.points.map(p => projectElevation(p, view)));
  const planes = surfaces.map(s => depthPlane(s, view));
  return projected.map((polygon, i) => {
    let remaining = [polygon];
    for (let j = 0; j < surfaces.length && remaining.length; j++) {
      if (i === j || surfaces[j].occludes === false || area(projected[j]) < 1) continue;
      const cover = clipNear(projected[j], planes[j].map((v, k) => v - planes[i][k]));
      if (cover.length < 3 || area(cover) < 1) continue;
      remaining = remaining.flatMap(p => subtractRoofPolygon(p, cover)).filter(p => area(p) > 1);
    }
    return remaining;
  });
}

export function elevationShell(view: ElevationView, style: RoofStyle, layout?: VillaLayoutLive | null, balcony = false, building: ElevationBuilding = "main") {
  const model = elevationModel(style, layout), { main: m, annex: a, front: f, roof: r } = model;
  const surfaces: ElevationSurface[] = [];
  let owner: ElevationBuilding = "main";
  const project = (p: Vector3) => projectElevation(p, view);
  const face = (p: Vector3[], cls: string, detail = "", occludes = true, part?: string) => {
    if (owner === building && area(p.map(project)) > 1) surfaces.push({ points: p, cls, detail, occludes, part });
  };
  const box = (x: number, z: number, w: number, d: number, y: number, h: number, cls: string) => {
    const side = directions[view].side;
    const [p, q]: Point[] = side === 0 ? [[x, z], [x + w, z]] : side === 3 ? [[x, z + d], [x + w, z + d]]
      : side === 1 ? [[x, z], [x, z + d]] : [[x + w, z], [x + w, z + d]];
    face([new Vector3(p[0], y, p[1]), new Vector3(q[0], y, q[1]), new Vector3(q[0], y + h, q[1]), new Vector3(p[0], y + h, p[1])], cls);
  };
  const columnCourses = (x: number, z: number, base: number, courses: ColumnCourse[]) => {
    const at = (p: Point, y: number) => new Vector3(x + p[0], base + y, z + p[1]);
    for (const c of courses) for (let i = 0; i < c.lower.length; i++) {
      const j = (i + 1) % c.lower.length;
      face([at(c.lower[i], c.bottom), at(c.lower[j], c.bottom), at(c.upper[j], c.top), at(c.upper[i], c.top)],
        "el-trim", "", true, "column-shoulder");
    }
  };
  const wall = (facade: Facade, base: number, h: number) => {
    const { a, b } = facade, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const at = (distance: number, y: number) => new Vector3(a[0] + (b[0] - a[0]) * distance / len, base + y, a[1] + (b[1] - a[1]) * distance / len);
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
    face([at(0, 0), at(len, 0), at(len, h), at(0, h)], "el-wall", detail);
  };
  const outside = (facades: Facade[]) => facades.filter(w => view === "north" || view === "south" ? Math.abs(w.a[1] - w.b[1]) < 1 : Math.abs(w.a[0] - w.b[0]) < 1)
    .sort((a, b) => new Vector3(b.a[0], 0, b.a[1]).dot(directions[view].eye) - new Vector3(a.a[0], 0, a.a[1]).dot(directions[view].eye))[0];
  model.floors.forEach(floor => {
    const visible = floor.facades.filter(w => view === "north" || view === "south" ? Math.abs(w.a[1] - w.b[1]) < 1 : Math.abs(w.a[0] - w.b[0]) < 1);
    visible.forEach(w => wall(w, floor.y, floor.height));
    // 三楼门厅分隔侧墙也参与侧立面的消隐，不显示室内隔墙或家具。
    if (view === "east" || view === "west") {
      const extra = floor.facades.slice(1).filter(w => Math.abs(w.a[0] - w.b[0]) < 1 && w.a[0] > m.x + 240 && w.a[0] < m.x + m.w - 240);
      extra.forEach(w => wall(w, floor.y, floor.height));
    }
  });
  owner = "annex";
  wall(outside(model.annexFacades), 0, a.height);
  owner = "main";

  for (const panel of model.glazing) {
    const dx = panel.b[0] - panel.a[0], dz = panel.b[1] - panel.a[1], len = Math.hypot(dx, dz);
    if (view === "north" || view === "south" ? Math.abs(dz) > 1 : Math.abs(dx) > 1) continue;
    const mid = new Vector3((panel.a[0] + panel.b[0]) / 2 - (m.x + m.w / 2), 0, (panel.a[1] + panel.b[1]) / 2 - (m.z + m.d / 2));
    if (mid.dot(directions[view].eye) <= 0) continue;
    const at = (t: number, y: number) => new Vector3(panel.a[0] + dx * t / len, y, panel.a[1] + dz * t / len).addScaledVector(directions[view].eye, 1);
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
  const mainOutline = style === "joined" ? bayOutline(r.main.x, r.main.z, r.main.w, r.main.d, r.hat.x, r.hat.w, r.hat.z, 0) : rect(r.main.x, r.main.z, r.main.w, r.main.d);
  rim(mainOutline, r.main.eave - 350, 350 + gutterOuterWallTop(), "el-trim", r.frontTrimGap);
  owner = "annex";
  rim(rect(r.annex.x, r.annex.z, r.annex.w, r.annex.d), r.annex.eave - 350, 350 + r.annexProfile.outerWallTop, "el-trim");
  owner = "main";
  if (style === "floating") {
    const end = Math.max(r.main.z, r.main.z + roofTileInset + (r.hat.eave + roofGutterDesign.clearDepth + 30 - r.main.eave - roofTileEaveLift()) / (r.pitch.fenShui / 10));
    rim(hatEaveRim(r.hat.x, r.hat.z, r.hat.w, 0, roofGutterDesign.outerTopWidth, end), r.hat.eave - 350, 350 + gutterOuterWallTop(), "el-trim");
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
  };
  roofs(r.mainFaces);
  owner = "annex";
  roofs(r.annexFaces);
  const c = model.chimney;
  box(c.x - 230, c.z - 230, 460, 460, c.base - 400, c.capY - c.base + 400, "el-wall");
  box(c.x - 360, c.z - 360, 720, 720, c.capY, 120, "el-trim");

  owner = "main";
  const y3 = model.floors[2].y, p = r.portico;
  const apronHeights = frontApronSection(y3 + f.eaveParapet, f.tiledEaveDrop);
  const capitalTop = apronHeights.columnTopY, fasciaBot = apronHeights.fasciaBottomY;
  for (const post of f.balustradePosts.slice(1, 3)) {
    box(post.x - post.w / 2, f.porticoColumnZ - f.porticoColumnDepth / 2, post.w, f.porticoColumnDepth,
      site.entranceRise - 20, capitalTop - (site.entranceRise - 20), "el-column");
    columnCourses(post.x, f.porticoColumnZ, 0, porticoShoulderProfile(post.w, f.porticoColumnDepth, capitalTop, fasciaBot));
  }
  const [westColumn, eastColumn] = f.balustradePosts.slice(1, 3);
  const clearSpan = eastColumn.x - westColumn.x - westColumn.w;
  box(westColumn.x + westColumn.w / 2 - 8, f.porticoColumnZ - PORTICO_BEAM_DEPTH / 2,
    clearSpan + 16, PORTICO_BEAM_DEPTH, fasciaBot - 670, 670, "el-trim");
  for (const x of f.postXs) {
    const height = fasciaBottomY(r.hat.eave, 0) - y3;
    box(x - f.dividerWidth / 2, f.postZ - hatPierDesign.depth / 2, f.dividerWidth, hatPierDesign.depth,
      y3, height - hatPierDesign.capHeight, "el-column");
    columnCourses(x, f.postZ, y3, hatPierCrownProfile(f.dividerWidth, height));
  }
  // 包角柱以 L 形两肢概括，保留当前突出量及与屋檐的高度关系。
  for (const [x, outward] of [[f.cornerWestX, -1], [f.cornerEastX, 1]]) {
    const x0 = x + (outward < 0 ? -f.cornerProject : -f.cornerLeg);
    const frontTop = frontApronSection(y3 + f.eaveParapet, f.tiledEaveDrop).columnTopY;
    box(x0, m.z - 120 - f.cornerProject, f.cornerLeg + f.cornerProject, f.cornerProject + 20, 0, frontTop, "el-column");
    box(outward < 0 ? x - f.cornerProject : x - 20, m.z - 120, f.cornerProject + 20, f.cornerLeg, 0, frontTop, "el-column");
    columnCourses(x, m.z - 120, 0, cornerShoulderProfile(f.cornerProject, f.cornerLeg, outward, frontTop, fasciaBot));
    columnCourses(x, model.floors[2].front, y3,
      upperCornerProfile(f.cornerProject, f.cornerLeg, outward, fasciaBottomY(r.main.eave, 0) - y3));
  }
  const [west, east] = f.balustradePosts.slice(1, 3);
  const westOuter = west.x - west.w / 2, eastOuter = east.x + east.w / 2;
  const westInner = west.x + west.w / 2, eastInner = east.x - east.w / 2;
  const columnNorth = f.porticoColumnZ - f.porticoColumnDepth / 2;
  const landing = columnNorth - construction.entranceLandingOffset, steps = landing - construction.entranceTread * 2;
  box(westOuter, landing, eastOuter - westOuter, porticoWallZ() - landing, 0, site.entranceRise, "el-wall");
  for (const [x0, x1] of [[westOuter, westInner], [eastInner, eastOuter]]) box(x0, steps, x1 - x0, landing - steps, 0, site.entranceRise, "el-wall");
  for (let i = 0; i < 2; i++) box(westInner, steps + i * construction.entranceTread, eastInner - westInner, construction.entranceTread + 10, 0, site.entranceRise * (i + 1) / 3, "el-wall");
  for (const [high, low] of recessedPortico() ? [] : [[eastOuter - 20, eastOuter + construction.entranceRampRun], [westOuter + 20, westOuter - construction.entranceRampRun]]) {
    const shape = (z: number) => [new Vector3(high, 0, z), new Vector3(low, 0, z), new Vector3(low, 20, z), new Vector3(high, site.entranceRise, z)];
    face(shape(columnNorth), "el-wall"); face(shape(m.z + 20), "el-wall");
    face([new Vector3(high, site.entranceRise, columnNorth), new Vector3(low, 20, columnNorth), new Vector3(low, 20, m.z + 20), new Vector3(high, site.entranceRise, m.z + 20)], "el-wall");
  }
  const terrace = (x: number, z: number, w: number, d: number) => {
    box(x, z, w, d, y3 - 180, 180, "el-trim");
  };
  if (hasThirdFloorSideTerraces()) for (const t of f.sideTerraces) terrace(t.x, f.terraceFront, t.w, model.floors[2].front + 40 - f.terraceFront);
  terrace(p.x, f.centerFront, p.w, f.terraceBack - f.centerFront);
  for (const run of frontTerraceRailRuns(model.floors[2].front)) {
    const bottom = y3 + f.eaveParapet;
    const a = new Vector3(run.a[0], bottom, run.a[1]), b = new Vector3(run.b[0], bottom, run.b[1]);
    face([a, b, b.clone().add(new Vector3(0, 680, 0)), a.clone().add(new Vector3(0, 680, 0))], "el-glass-rail", "", false);
  }
  for (const x of [p.x, p.x + p.w - apronEaveDesign.parapetThickness])
    box(x, hasThirdFloorSideTerraces() ? f.terraceFront : f.centerFront, apronEaveDesign.parapetThickness, f.postZ - 250 - (hasThirdFloorSideTerraces() ? f.terraceFront : f.centerFront),
      y3, f.eaveParapet, "el-wall");
  const apron = frontApronSection(y3 + f.eaveParapet, f.tiledEaveDrop);
  const terracePosts = hasThirdFloorSideTerraces() ? f.balustradePosts : f.balustradePosts.slice(1, 3);
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
  // 二楼顶部仅为无天沟瓦挑檐，外缘按独立薄檐板高度概括，不套屋顶反坎或三眼皮。
  const e = site.secondFrontEave;
  const apronBack = hasThirdFloorSideTerraces() ? f.terraceBack : model.floors[2].front + 40;
  const westEdge = f.sideTerraces[0].x, eastEdge = f.sideTerraces[1].x + f.sideTerraces[1].w;
  const inner: Point[] = [[westEdge, apronBack], [westEdge, f.terraceFront], [p.x, f.terraceFront],
    [p.x, f.centerFront], [p.x + p.w, f.centerFront], [p.x + p.w, f.terraceFront],
    [eastEdge, f.terraceFront], [eastEdge, apronBack]];
  const outer: Point[] = [[westEdge-e, apronBack], [westEdge-e, f.terraceFront-e], [p.x-e, f.terraceFront-e],
    [p.x-e, f.centerFront-e], [p.x+p.w+e, f.centerFront-e], [p.x+p.w+e, f.terraceFront-e],
    [eastEdge+e, f.terraceFront-e], [eastEdge+e, apronBack]];
  const { fasciaOuter: fascia, beamBack, beamFace, outer: apronOuter } = apronSupportOutline(inner, outer,
    [m.x - construction.outsideWall / 2, m.x + m.w + construction.outsideWall / 2]);
  const strips = (a: Point[], b: Point[]) => a.slice(0, -1).map((point, i) => [point, a[i + 1], b[i + 1], b[i]]);
  const beamArea = strips(beamFace, beamBack);
  // 与三维同源：下沿线与背梁连续绕折角；柱位不另投实心块隔断梁托。
  for (const polygon of beamArea) rim(polygon, apron.fasciaBottomY, apron.soffitY - apron.fasciaBottomY, "el-trim", undefined, "apron-support");
  for (const post of terracePosts) {
    const foot = post.w + 80;
    const footprint = rect(post.x - foot / 2, post.z - foot / 2, foot, foot);
    if (y3 > apron.soffitY) rim(footprint, apron.soffitY, y3 - apron.soffitY, "el-column", undefined, "apron-support");
  }
  for (let i = 0; i < fascia.length - 1; i++) {
    const [a, b] = [fascia[i], fascia[i + 1]];
    face([new Vector3(a[0], apron.fasciaBottomY, a[1]), new Vector3(b[0], apron.fasciaBottomY, b[1]),
      new Vector3(b[0], apron.fasciaTopY, b[1]), new Vector3(a[0], apron.fasciaTopY, a[1])], "el-trim", "", true, "apron-support");
  }
  rim([...apronOuter, ...inner.slice().reverse()], apron.soffitY, apronEaveDesign.boardThickness, "el-trim");
  if (balcony) {
    const x = m.x + m.w * (12650 - 6800) / 13500, w = 2500 * m.w / 13500, z = m.z + m.d;
    box(x, z, w, 1200, y3 - 180, 180, "el-trim");
    rim(rect(x, z, w, 1200), y3, 1100, "el-glass-rail");
  }
  // 下沿线只作外壳控制线，屋面及墙体共享同一檐口标高。
  box(m.x - 100, model.floors[2].front - 100, m.w + 200, m.z + m.d - model.floors[2].front + 200, fasciaBottomY(r.main.eave, 0), 100, "el-trim");
  return { model, surfaces };
}

function dimension(a: number, b: number, y: number, from: number) {
  const [u0, u1] = [a, b].sort((x, y) => x - y);
  return `<path d="M${n(u0)} ${n(from)} V${n(y + 100)} M${n(u1)} ${n(from)} V${n(y + 100)} M${n(u0)} ${n(y)} H${n(u1)} M${n(u0 - 65)} ${n(y + 65)} l130 -130 M${n(u1 - 65)} ${n(y + 65)} l130 -130" class="el-dim"/>${text((u0 + u1) / 2, y - 170, String(n(u1 - u0)), "el-dim-label")}`;
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
  const { model, surfaces } = elevationShell(view, style, layout, balcony, building);
  const visible = visibleElevationPolygons(surfaces, view);
  const all = surfaces.flatMap(s => s.points.map(p => projectElevation(p, view)));
  const min = Math.min(...all.map(p => p[0])), max = Math.max(...all.map(p => p[0]));
  const peak = building === "main" ? model.roof.mainPeak : Math.max(model.chimney.capY + 120, ...model.roof.annexFaces.flatMap(f => f.points.map(p => p.y)));
  const left = min - 3400, top = -peak - 900, width = max - min + 6800, bottom = 2350;
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
    if (building === "main") dimensions += dimension(u(0, porticoFrontZ()), u(0, porticoWallZ()), 850, 0);
  }
  const levels: [string, number][] = building === "main"
    ? [["院坪基准", 0], ["首层完成面", site.entranceRise], ["二层楼面", model.floors[1].y], ["三层楼面", model.floors[2].y], ["主楼屋面基准", r.main.eave], ["主楼瓦脊", r.mainPeak]]
    : [["院坪基准", 0], ["辅楼屋面基准", r.annex.eave], ["辅楼最高点", peak]];
  const labels = levels.map(([name, y], i) => {
    const x = min - 250, ty = -y + (i === 0 ? 100 : i === 1 ? -140 : 0);
    return line([x, -y], [min, -y], "el-level") + `<path d="M${n(x)} ${n(-y)} l-110 -150 h220 Z" fill="#555"/>` + text(x - 170, ty, `${name} ${height(y)}`, "el-label", "end");
  }).join("");
  let heights = "";
  for (const floor of building === "main" ? model.floors : [{ y: 0, height: a.height }]) {
    const x = max + 500, y0 = -floor.y, y1 = -floor.y - floor.height;
    heights += line([max + 100, y0], [x + 120, y0], "el-dim") + line([max + 100, y1], [x + 120, y1], "el-dim") + line([x, y0], [x, y1], "el-dim") + text(x + 180, (y0 + y1) / 2, String(n(floor.height)), "el-dim-label", "start");
  }
  const extra = building === "main" ? text(max + 1100, -r.hat.peak, `官帽瓦脊 ${height(r.hat.peak)}`, "el-small", "start") : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" class="floor-svg elevation-svg" data-elevation="${view}" data-building="${building}" data-roof-style="${style}" viewBox="${n(left)} ${n(top)} ${n(width)} ${n(bottom - top)}" role="img" aria-label="${buildingLabel}${elevationLabels[view]}，当前方案正投影"><title>${buildingLabel}${elevationLabels[view]} · ${roofStyleLabels[style]} · 单位 mm</title><desc>左为${directions[view].left}，右为${directions[view].right}。${buildingLabel}的外墙、洞口和屋面${building === "main" ? "及门厅" : "及烟囱"}正投影，按深度消隐；雕花、栏杆及檐口细部简化。标高相对暂定院坪基准，非施工图。</desc><defs><style>${elevationStyles.replaceAll("elevation-tiles", `${id}-tiles`)}</style><pattern id="${id}-tiles" width="240" height="120" patternUnits="userSpaceOnUse"><rect width="240" height="120" fill="white"/><path d="M0 0h240 M0 120h240 M0 0q30 0 30 60t30 60 M120 0q30 0 30 60t30 60" fill="none" stroke="#999" stroke-width="10"/></pattern>${clip}</defs><rect x="${n(left)}" y="${n(top)}" width="${n(width)}" height="${n(bottom - top)}" fill="#fff"/>${drawing}${line([min - 180, 0], [max + 180, 0], "el-ground")}${labels}${heights}${extra}${dimensions}${text((min + max) / 2, 2100, `${buildingLabel}${elevationLabels[view]}　｜　左：${directions[view].left} · 右：${directions[view].right}`, "el-title")}</svg>`;
}

export function elevationPlan(view: ElevationView, style: RoofStyle, layout?: VillaLayoutLive | null, balcony = false) {
  const controls = `<section class="plan-sheet"><div class="plan-sheet-head"><h3>建筑立面图</h3><div class="roof-drawing-tabs" role="group" aria-label="选择立面方向">${(Object.keys(elevationLabels) as ElevationView[]).map(key => `<button type="button" data-elevation-view="${key}" class="secondary-button${view === key ? " active" : ""}" aria-pressed="${view === key}">${elevationLabels[key]}</button>`).join("")}</div></div><div class="roof-plan-meta elevation-plan-meta"><span>正投影 · 长度／相对标高：mm</span><span>左：${directions[view].left} · 右：${directions[view].right}</span><span>当前屋面：${roofStyleLabels[style]}</span><div class="elevation-roof-switch" role="group" aria-label="立面官帽造型">${(Object.keys(roofStyleLabels) as RoofStyle[]).map(key => `<button type="button" data-roof-style="${key}" class="secondary-button${style === key ? " active" : ""}" aria-pressed="${style === key}">${roofStyleLabels[key]}</button>`).join("")}</div></div></section>`;
  const sheets = (["main", "annex"] as ElevationBuilding[]).map(building => {
    const label = building === "main" ? "主楼" : "辅楼";
    return `<section class="plan-sheet"><div class="plan-sheet-head"><h3>${label} · ${elevationLabels[view]}</h3><div class="roof-drawing-tabs"><button type="button" data-download-elevation="${building}" class="secondary-button">下载${label} SVG</button></div></div>${elevationSvg(view, style, layout, balcony, building)}<p class="roof-plan-note">${label}独立正投影，与当前方案的尺寸和外部门窗联动；雕花、瓦垄、栏杆与檐口细部简化，标高相对暂定院坪基准。方案示意，非施工图。</p></section>`;
  }).join("");
  return `<div class="plan-sheets">${controls}${sheets}</div>`;
}
