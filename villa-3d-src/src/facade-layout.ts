import { recessFrontFacades, thirdFloorWingIsClosed } from "./building-variants";
import { site, floors, circulation, type Floor, type Point } from "./data";
import { facades, secondFloorSideGlassHeadY, thirdFloorMaxOpeningHead, type Opening } from "./facades";
import { facadeOpeningToWallOpening, type ExteriorOpeningDraft, type VoidDraft } from "./layout-draft";
import { polygonContainsPoint, roomOutline } from "./room-geometry";
import { alignedEntryOpenings, type EntryAssembly } from "./entry-assembly";

export type FacadeLayout = { floors?: Floor[]; livingVoid?: VoidDraft; exteriorOpenings?: ExteriorOpeningDraft[]; exteriorManaged?: boolean };
export type ContinuousGlazing = { id: string; floor: number; upperFloor: number; facadeIndex: number; a: Point; b: Point; at: number; w: number; bottom: number; top: number; sourceIndex?: number; upperSourceIndices?: number[] };

function windowHeadLimit(floor: number, floorList: Floor[]) {
  const height = floor === 3 ? site.annex.height : floorList[floor].height;
  return floor === 2 ? Math.min(height, thirdFloorMaxOpeningHead()) : height;
}

export function frontOpeningsChanged(layout: FacadeLayout | null | undefined, indices = [0, 1]) {
  if (!layout?.exteriorOpenings) return false;
  return indices.some(index => {
    const originals = facades(index)[0].openings;
    const published = originals.map(facadeOpeningToWallOpening);
    const requested = layout.exteriorOpenings!.filter(item => item.floor === index && item.facadeIndex === 0).map(item => item.opening);
    const key = (openings: typeof published) => openings.map(o => {
      const template = nearestOpeningTemplate(originals, o);
      const rise = index === 0 ? site.entranceRise : 0;
      return JSON.stringify({
        offset: o.offset, width: o.width, kind: o.kind ?? "door", hinge: o.hinge, side: o.side,
        height: o.kind === "window" ? o.height ?? template?.h : undefined,
        sill: o.kind === "window" ? o.sill ?? (template ? template.sill - rise : undefined) : undefined,
      });
    }).sort().join("|");
    return key(layout.exteriorManaged ? requested : [...published, ...requested]) !== key(published);
  });
}

function nearestOpeningTemplate(originals: Opening[], opening: ExteriorOpeningDraft["opening"], kind = opening.kind ?? "door") {
  return originals.filter(original => facadeOpeningToWallOpening(original).kind === kind)
    .reduce<Opening | undefined>((closest, candidate) =>
      !closest || Math.abs(candidate.at - (opening.offset + opening.width / 2)) < Math.abs(closest.at - (opening.offset + opening.width / 2)) ? candidate : closest, undefined);
}

/** 草稿优先使用自定义窗高／窗台；缺项仍沿用对应立面模板，旧稿不改外观。 */
function ordinaryFacades(index: number, layout?: FacadeLayout | null) {
  const result = facades(index);
  if (!layout?.exteriorOpenings) return result;
  const customFront = frontOpeningsChanged(layout);
  return result.map((facade, facadeIndex) => {
    const requested = layout.exteriorOpenings!.filter(item => item.floor === index && item.facadeIndex === facadeIndex);
    const originals = facade.openings;
    const openings: Opening[] = layout.exteriorManaged ? [] : originals.map(o => ({ ...o }));
    for (const item of requested) {
      const o = item.opening;
      const kind = o.kind === "slidingDoor" && thirdFloorWingIsClosed(index, facadeIndex, o.offset + o.width / 2) ? "window" : o.kind ?? "door";
      const template = nearestOpeningTemplate(originals, o, kind);
      const height = index === 3 ? site.annex.height : (layout.floors ?? floors)[index].height;
      const rise = index === 0 || index === 3 ? site.entranceRise : 0;
      const sill = kind === "window" && o.sill != null ? o.sill + rise : template?.sill ?? (kind === "window" ? 900 : rise);
      openings.push({
        ...template, at: o.offset + o.width / 2, w: o.width,
        sill, h: kind === "window" && o.height != null ? o.height : template?.h ?? Math.min(kind === "window" ? 1800 : 2400, height - sill - 120),
        door: kind !== "window", kind, hinge: o.hinge, side: o.side,
        layoutSourceIndex: layout.exteriorOpenings!.indexOf(item),
        pattern: kind === "slidingDoor" ? "sliding" : template?.pattern === "sliding" ? undefined : template?.pattern,
      });
    }
    // 草稿改动先取消旧固定通高标记，再由实际挑空位置重新关联跨层窗。
    if (customFront && index < 2 && facadeIndex === 0)
      for (const opening of openings) delete opening.span;
    return { ...facade, openings };
  });
}

/** 挑空外窗由下层洞口定位／宽度和上层窗顶共同确定，只派生渲染数据，不改户型稿。 */
export function resolveLayoutFacades(layout?: FacadeLayout | null) {
  if (layout?.exteriorOpenings) layout = { ...layout, exteriorOpenings: alignedEntryOpenings(layout) };
  const walls = [0, 1, 2, 3].map(index => {
    const faces = ordinaryFacades(index, layout);
    return index === 3 ? faces : recessFrontFacades(faces, (layout?.floors ?? floors)[index].front);
  });
  const floorList = layout?.floors ?? floors;
  const entries: EntryAssembly[] = [];
  walls[0].forEach((face, facadeIndex) => {
    if ((face.sourceFacadeIndex ?? facadeIndex) !== 0) return;
    const dx = face.b[0] - face.a[0], dz = face.b[1] - face.a[1], length = Math.hypot(dx, dz);
    const peer = walls[1].find(f => Math.hypot(f.a[0] - face.a[0], f.a[1] - face.a[1]) < 1 && Math.hypot(f.b[0] - face.b[0], f.b[1] - face.b[1]) < 1);
    if (!peer) return;
    for (const door of face.openings) {
      const x = face.a[0] + dx * door.at / length;
      if (!door.door || door.kind === "passage" || door.pattern === "sliding" || x <= site.portico.x || x >= site.portico.x + site.portico.w) continue;
      const matches = peer.openings.filter(o => !o.door && o.at - o.w / 2 < door.at + door.w / 2 && o.at + o.w / 2 > door.at - door.w / 2);
      if (matches.length !== 1) continue;
      const window = matches[0], id = `integrated-entry-${entries.length}`;
      const sourceIndex = (floor: number) => layout?.exteriorOpenings?.findIndex(item => item.floor === floor && item.facadeIndex === 0 && Math.abs(item.opening.offset + item.opening.width / 2 - (door.at + (face.sourceOffset ?? 0))) < 1);
      const lowerIndex = sourceIndex(0), upperIndex = sourceIndex(1);
      const windowDraft = window.layoutSourceIndex == null ? undefined : layout?.exteriorOpenings?.[window.layoutSourceIndex]?.opening;
      const bandTop = floorList[1].y + (windowDraft?.sill ?? 320);
      const bottom = floorList[0].y + door.sill;
      const top = windowDraft?.height != null ? Math.min(bandTop + windowDraft.height, floorList[1].y + floorList[1].height) : floorList[1].y + window.sill + window.h;
      if (top <= bandTop) continue;
      entries.push({ id, a: face.a, b: face.b, at: door.at, w: door.w, bottom, top,
        bandBottom: floorList[1].y - 320, bandTop,
        sourceIndex: lowerIndex != null && lowerIndex >= 0 ? lowerIndex : undefined,
        upperSourceIndex: upperIndex != null && upperIndex >= 0 ? upperIndex : undefined });
      door.span = "lower"; door.h = floorList[0].height - door.sill; door.entryAssembly = id;
      window.at = door.at; window.w = door.w; window.span = "upper";
      window.sill = 0; window.h = top - floorList[1].y; window.entryAssembly = id;
    }
  });
  const glazing: ContinuousGlazing[] = [];
  for (let upperFloor = 1; upperFloor < floorList.length; upperFloor++) {
    const floor = upperFloor - 1, lower = floorList[floor], upper = floorList[upperFloor];
    const regions = upper.rooms.filter(room => room.kind === "void").map(roomOutline);
    const living = layout?.livingVoid ?? circulation.livingVoid;
    if (upperFloor === 1 && living.w > 0 && living.d > 0)
      regions.push([[living.x, living.z], [living.x + living.w, living.z], [living.x + living.w, living.z + living.d], [living.x, living.z + living.d]]);
    walls[floor].forEach((face, facadeIndex) => {
      const dx = face.b[0] - face.a[0], dz = face.b[1] - face.a[1], length = Math.hypot(dx, dz);
      const peer = walls[upperFloor].find(f => Math.hypot(f.a[0] - face.a[0], f.a[1] - face.a[1]) < 1 && Math.hypot(f.b[0] - face.b[0], f.b[1] - face.b[1]) < 1);
      if (!peer) return; // 退台等不同墙面不能跨接成同一面玻璃。
      const touchesVoid = (o: Opening) => regions.some(path => {
        const start = o.at - o.w / 2, end = o.at + o.w / 2;
        const stations = [start, end, ...path.map(p => ((p[0] - face.a[0]) * dx + (p[1] - face.a[1]) * dz) / length).filter(t => t > start && t < end)].sort((a, b) => a - b);
        return stations.slice(1).every((t, i) => {
          const mid = (stations[i] + t) / 2;
          return polygonContainsPoint(path, [face.a[0] + dx * mid / length, face.a[1] + dz * mid / length]);
        });
      });
      for (const opening of face.openings) {
        if (opening.door || opening.entryAssembly || opening.continuous || !touchesVoid(opening)) continue;
        const start = opening.at - opening.w / 2, end = opening.at + opening.w / 2;
        if (peer.openings.some(o => o.at + o.w / 2 > start && o.at - o.w / 2 < end && (o.door || !touchesVoid(o)))) continue;
        const matches = peer.openings.filter(o => !o.door && !o.continuous && touchesVoid(o) && o.at + o.w / 2 > start && o.at - o.w / 2 < end);
        const defaultTop = matches.length ? Math.max(...matches.map(o => upper.y + o.sill + o.h))
          : upperFloor === 1 ? secondFloorSideGlassHeadY() : upper.y + upper.height - 800;
        const bottom = lower.y + opening.sill;
        const source = opening.layoutSourceIndex == null ? undefined : layout?.exteriorOpenings?.[opening.layoutSourceIndex]?.opening;
        const top = source?.height != null ? Math.min(bottom + source.height, upper.y + windowHeadLimit(upperFloor, floorList)) : defaultTop;
        if (top <= upper.y || bottom >= lower.y + lower.height) continue;
        const id = `void-glass-${floor}-${facadeIndex}-${glazing.length}`;
        const sourceIndex = layout?.exteriorOpenings?.findIndex(item => item.floor === floor && item.facadeIndex === (face.sourceFacadeIndex ?? facadeIndex) && item.opening.kind === "window" && Math.abs(item.opening.offset + item.opening.width / 2 - (opening.at + (face.sourceOffset ?? 0))) < 1);
        glazing.push({ id, floor, upperFloor, facadeIndex, a: face.a, b: face.b, at: opening.at, w: opening.w, bottom, top, sourceIndex: sourceIndex != null && sourceIndex >= 0 ? sourceIndex : undefined,
          upperSourceIndices: matches.flatMap(o => o.layoutSourceIndex == null ? [] : [o.layoutSourceIndex]) });
        opening.span = "lower"; opening.h = lower.height - opening.sill; opening.continuous = id;
        peer.openings = peer.openings.filter(o => !matches.includes(o));
        peer.openings.push({ ...opening, sill: 0, h: top - upper.y, span: "upper" });
      }
    });
  }
  // 原模板的客厅通高标记不能在已取消挑空的方案中继续压掉普通窗玻璃。
  walls.slice(0, 2).forEach((floor, index) => floor.forEach((face, facadeIndex) => {
    for (const o of face.openings) {
      const overDoor = index > 0 && walls[index - 1][facadeIndex]?.openings.some(lower => lower.door && lower.span === "lower" && Math.abs(lower.at - o.at) < 1 && Math.abs(lower.w - o.w) < 1);
      if (!o.door && o.span && !o.continuous && !overDoor) delete o.span;
    }
  }));
  // 自定义普通窗不能穿过本层墙顶／屋檐；通高窗已按整窗规格拆成上下层洞口。
  walls.forEach((faces, floor) => faces.forEach(face => face.openings.forEach(opening => {
    const source = opening.layoutSourceIndex == null ? undefined : layout?.exteriorOpenings?.[opening.layoutSourceIndex]?.opening;
    if (opening.door || opening.continuous || opening.entryAssembly || source?.height == null && source?.sill == null) return;
    const rise = floor === 0 || floor === 3 ? site.entranceRise : 0;
    const maxTop = windowHeadLimit(floor, floorList);
    opening.sill = Math.max(rise, Math.min(opening.sill, maxTop - 200));
    opening.h = Math.max(0, Math.min(opening.h, maxTop - opening.sill));
  })));
  return { facades: walls, glazing, entries };
}

/** 编辑旧窗前记录实际竖向规格；以后移动／改宽不再重新套用附近的窗型。 */
export function freezeExteriorWindowDimensions(layout: FacadeLayout) {
  const resolved = resolveLayoutFacades(layout);
  resolved.facades.forEach((faces, floor) => faces.forEach(face => face.openings.forEach(opening => {
    if (opening.door || opening.continuous || opening.entryAssembly || opening.layoutSourceIndex == null) return;
    const source = layout.exteriorOpenings?.[opening.layoutSourceIndex]?.opening;
    if (!source || source.kind !== "window") return;
    const rise = floor === 0 || floor === 3 ? site.entranceRise : 0;
    source.height ??= opening.h;
    source.sill ??= Math.max(0, opening.sill - rise);
  })));
}

/** 属性面板与实体共用最终规格；选择通高窗的任一层时都编辑下层保存的整窗尺寸。 */
export function exteriorWindowProfile(layout: FacadeLayout, index: number) {
  const item = layout.exteriorOpenings?.[index];
  if (!item || item.opening.kind !== "window") return null;
  const resolved = resolveLayoutFacades(layout), floorList = layout.floors ?? floors;
  const panel = resolved.glazing.find(p => p.sourceIndex === index || p.upperSourceIndices?.includes(index));
  if (panel && panel.sourceIndex != null) {
    const base = floorList[panel.floor].y + (panel.floor === 0 ? site.entranceRise : 0);
    return { sourceIndex: panel.sourceIndex, floor: panel.floor, mode: "continuous" as const,
      sill: panel.bottom - base, height: panel.top - panel.bottom, maxTop: floorList[panel.upperFloor].y + windowHeadLimit(panel.upperFloor, floorList) - base,
      maxSill: floorList[panel.floor].y + floorList[panel.floor].height - base - 200 };
  }
  const entry = resolved.entries.find(e => e.upperSourceIndex === index);
  if (entry) return { sourceIndex: index, floor: 1, mode: "entry" as const, sill: entry.bandTop - floorList[1].y,
    height: entry.top - entry.bandTop, maxTop: floorList[1].height, maxSill: floorList[1].height - 200 };
  const opening = resolved.facades[item.floor].flatMap(face => face.openings).find(o => o.layoutSourceIndex === index);
  if (!opening) return null;
  const rise = item.floor === 0 || item.floor === 3 ? site.entranceRise : 0;
  const maxTop = windowHeadLimit(item.floor, floorList);
  return { sourceIndex: index, floor: item.floor, mode: "ordinary" as const, sill: Math.max(0, opening.sill - rise), height: opening.h, maxTop: maxTop - rise, maxSill: maxTop - rise - 200 };
}

