import * as THREE from "three";
import { site, type Point } from "./data";
import { facades } from "./facades";
import type { ExteriorOpeningDraft } from "./layout-draft";
import { box, type Mats } from "./primitives";
import { moveWindowDesign, windowDesign } from "./window-design";

export type EntryAssembly = { id: string; a: Point; b: Point; at: number; w: number; bottom: number; top: number; bandBottom: number; bandTop: number; sourceIndex?: number; upperSourceIndex?: number };
type EntryLayout = { exteriorOpenings?: ExteriorOpeningDraft[]; portico?: { x: number; w: number } };

/** 一楼门作为旧稿的宽度依据；主动编辑二楼窗时反向同步。只派生副本，不覆盖版本文件。 */
export function alignedEntryOpenings(layout: EntryLayout, preferredIndex?: number) {
  const items = layout.exteriorOpenings ?? [];
  const portico = layout.portico ?? site.portico;
  const face = facades(0)[0], length = Math.hypot(face.b[0] - face.a[0], face.b[1] - face.a[1]);
  const central = (item: ExteriorOpeningDraft) => {
    const center = item.opening.offset + item.opening.width / 2;
    const x = face.a[0] + (face.b[0] - face.a[0]) * center / length;
    return item.facadeIndex === 0 && x > portico.x && x < portico.x + portico.w;
  };
  const doors = items.map((item, index) => ({ item, index })).filter(({ item }) => item.floor === 0 && central(item) && ["door", "doubleDoor"].includes(item.opening.kind ?? "door"));
  if (doors.length !== 1) return items;
  const lower = doors[0];
  const peers = items.map((item, index) => ({ item, index })).filter(({ item }) => item.floor === 1 && central(item) && item.opening.kind === "window");
  if (peers.length !== 1) return items;
  const upper = peers[0], driver = preferredIndex === upper.index ? upper : lower;
  return items.map((item, index) => index === lower.index || index === upper.index
    ? { ...item, opening: { ...item.opening, offset: driver.item.opening.offset, width: driver.item.opening.width } } : item);
}

type EntryRect = { x: number; y: number; w: number; h: number; role: "door" | "panel" | "glass" | "frame" | "relief" | "bead" | "handle"; name: string; outline?: Point[] };
export const entryPartOutline = (part: EntryRect): Point[] => part.outline ?? [[part.x, part.y], [part.x + part.w, part.y], [part.x + part.w, part.y + part.h], [part.x, part.y + part.h]];
function clipPart(path: Point[], axis: 0 | 1, boundary: number, sign: number): Point[] {
  return path.flatMap((a, i) => {
    const b = path[(i + 1) % path.length], da = (a[axis] - boundary) * sign, db = (b[axis] - boundary) * sign;
    const result: Point[] = da >= 0 ? [a] : [];
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db); result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return result;
  });
}
/** 门、装饰段、玻璃共用两侧边线和连续外框；型材尺寸为概念表现。 */
export function entryAssemblyDesign(entry: EntryAssembly) {
  const edge = Math.min(70, entry.w / 10), x = entry.at - entry.w / 2 + edge, w = entry.w - edge * 2;
  const doorBottom = entry.bottom + edge, doorTop = entry.bandBottom;
  const glassBottom = entry.bandTop, glassTop = entry.top - edge, glassH = glassTop - glassBottom;
  const parts: EntryRect[] = [];
  const rect = (x: number, y: number, w: number, h: number, role: EntryRect["role"], name: string) => { if (w > 0 && h > 0) parts.push({ x, y, w, h, role, name }); };
  rect(x, doorBottom, w, doorTop - doorBottom, "door", "铸铝咖色大门");
  rect(x, doorTop, w, glassBottom - doorTop, "panel", "门厅中段棕色斜纹");
  const upperWindow = moveWindowDesign(windowDesign(w, glassH, "fixed", 0), x, glassBottom);
  upperWindow.panes.forEach(p => rect(p.x, p.y, p.w, p.h, "glass", "门厅上窗分格玻璃"));
  upperWindow.frames.forEach(f => rect(f.x, f.y, f.w, f.h, "frame", `门厅上窗${f.role}`));
  for (const p of upperWindow.panes) {
    for (const xx of [p.x - 12, p.x + p.w]) rect(xx, p.y - 12, 12, p.h + 24, "bead", "门厅上窗玻璃压条");
    for (const yy of [p.y - 12, p.y + p.h]) rect(p.x, yy, p.w, 12, "bead", "门厅上窗玻璃压条");
  }
  for (const xx of [x - edge, x + w]) rect(xx, entry.bottom, edge, entry.top - entry.bottom, "frame", "门厅通高门头边框");
  for (const yy of [entry.bottom, entry.top - edge]) rect(x, yy, w, edge, "frame", "门厅通高门头横框");
  for (const yy of [doorTop, glassBottom - 40]) rect(x, yy, w, 40, "frame", "门厅通高门头横框");
  // 双门扇中缝、分层内框与成对长执手。
  rect(entry.at - 12, doorBottom, 24, doorTop - doorBottom, "frame", "大门双扇中缝");
  for (const half of [0, 1]) {
    const left = x + half * w / 2 + 100, right = x + (half + 1) * w / 2 - 100;
    const low = doorBottom + 160, high = doorTop - 160;
    for (const xx of [left, right - 20]) rect(xx, low, 20, high - low, "relief", "大门扇装饰线");
    for (const yy of [low, high - 20]) rect(left, yy, right - left, 20, "relief", "大门扇装饰线");
  }
  for (const side of [-1, 1]) rect(entry.at + side * 90 - 14, doorBottom + (doorTop - doorBottom) * .4, 28, 600, "handle", "大门执手");
  // 层间深色装饰板的浅回纹压线，仍属于同一套门窗。
  const bandInset = 85, bandH = glassBottom - doorTop - bandInset * 2;
  for (const yy of [doorTop + bandInset, glassBottom - bandInset - 15]) rect(x + bandInset, yy, w - bandInset * 2, 15, "relief", "门厅装饰板压线");
  for (const xx of [x + bandInset, x + w - bandInset - 15]) rect(xx, doorTop + bandInset, 15, bandH, "relief", "门厅装饰板压线");
  // 参考图中段的浅人字斜纹；两半分别裁进压线内，不越过连续边框。
  const low = doorTop + bandInset + 30, high = glassBottom - bandInset - 30, h = high - low;
  for (const half of [0, 1]) {
    const left = x + bandInset + 30 + half * (w / 2 - bandInset - 30), right = half ? x + w - bandInset - 30 : entry.at;
    const slope = half ? -1 : 1;
    for (let xx = left - h; xx < right + h; xx += 95) {
      let outline: Point[] = [[xx, low], [xx + 9, low], [xx + 9 + slope * h, high], [xx + slope * h, high]];
      outline = clipPart(clipPart(outline, 0, left, 1), 0, right, -1);
      if (outline.length < 3) continue;
      const xs = outline.map(p => p[0]);
      parts.push({ x: Math.min(...xs), y: low, w: Math.max(...xs) - Math.min(...xs), h, role: "relief", name: "门厅装饰板浅人字纹", outline });
    }
  }
  return parts;
}

export function integratedEntry(parent: THREE.Object3D, entry: EntryAssembly, mat: Mats, bottom = entry.bottom, top = entry.top) {
  const group = new THREE.Group(); parent.add(group);
  group.name = "门厅一二层通高门"; group.userData.entryAssembly = entry.id;
  const dx = entry.b[0] - entry.a[0], dz = entry.b[1] - entry.a[1], length = Math.hypot(dx, dz);
  group.position.set(entry.a[0], bottom, entry.a[1]); group.rotation.y = -Math.atan2(dz, dx);
  const midX = (entry.a[0] + entry.b[0]) / 2, midZ = (entry.a[1] + entry.b[1]) / 2;
  const outward = ((site.main.x + site.main.w / 2 - midX) * -dz + (site.main.z + site.main.d / 2 - midZ) * dx) / length > 0 ? -1 : 1;
  const upperGlass = new THREE.Group(); upperGlass.name = "门厅二楼门头玻璃"; group.add(upperGlass);
  for (const part of entryAssemblyDesign(entry)) {
    const lo = Math.max(bottom, part.y), hi = Math.min(top, part.y + part.h);
    if (hi <= lo) continue;
    const glass = part.role === "glass", base = part.role === "door" || part.role === "panel";
    const material = glass ? mat.lowE : part.role === "handle" ? mat.bronze : part.role === "relief" ? mat.bronzeDark : mat.dark;
    const depth = glass ? 24 : base ? 50 : part.role === "frame" ? 100 : part.role === "bead" ? 10 : 30;
    // 门窗在外墙皮前安装，装饰板覆盖层间楼板端头。
    const z = outward * (glass ? 165 : base ? 140 : part.role === "handle" ? 215 : part.role === "bead" ? 240 : 185);
    if (part.outline) {
      const path = clipPart(clipPart(part.outline, 1, bottom, 1), 1, top, -1);
      if (path.length < 3) continue;
      const shape = new THREE.Shape(path.map(([x, y]) => new THREE.Vector2(x, y - bottom)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: 8, bevelEnabled: false, steps: 1 });
      geometry.translate(0, 0, z - 4);
      const mesh = new THREE.Mesh(geometry, material); mesh.name = part.name; group.add(mesh);
    } else box(glass ? upperGlass : group, part.x + part.w / 2, (lo + hi) / 2 - bottom, z, part.w, hi - lo, depth, material, false).name = part.name;
  }
  return group;
}
