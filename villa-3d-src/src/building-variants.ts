import { site, frontElevation, type Point, type Room, type Floor, type Wall, type Furniture } from "./data";
import type { Facade } from "./facades";
import { porticoColumnCenters, porticoEaveCornerOffset } from "./frontage-geometry";
import { apronEaveDesign } from "./roof-options";
import { terraceParapetLayout } from "./facade-details";

export type PorticoStyle = "projecting" | "recessed";
export type BuildingPlacement = "main-east" | "main-west";
export type ThirdFloorMode = "setback" | "flush";
export const porticoStyleLabels = { projecting: "凸出式门厅", recessed: "平齐式门厅（原凹入式）" } as const;
export const buildingPlacementLabels = { "main-east": "主楼东 · 辅楼西", "main-west": "主楼西 · 辅楼东" } as const;
export const thirdFloorModeLabels = { setback: "北向内退", flush: "不内退" } as const;
export const hasThirdFloorSideTerraces = () => site.setback > 0;
export const frontTerracePosts = () => hasThirdFloorSideTerraces() ? frontElevation.balustradePosts : frontElevation.balustradePosts.slice(1, 3);
export const recessedPortico = () => site.porticoStyle === "recessed";
export const mirroredBuildings = () => site.buildingPlacement === "main-west";
export const porticoFrontZ = () => site.main.z - (recessedPortico() ? 0 : site.portico.projection);
// 沿用 recessed 存储键；现行平齐式不再内退各层墙体或大门。
export const porticoWallZ = (front = site.main.z) => front;
export const mainLocalX = (offset: number) => site.main.x + (mirroredBuildings() ? site.main.w - offset : offset);
export const annexLocalX = (offset: number) => site.annex.x + (mirroredBuildings() ? site.annex.w - offset : offset);

/** 当前户型的门厅柱、中央露台与官帽定位；平面及三维共用，计算不改写全局。 */
export function porticoElevation(porch: { x: number; w: number; projection: number }) {
  const elevation = frontElevation;
  const columnXs = porticoColumnCenters(porch);
  const columnZ = site.main.z - (recessedPortico() ? 0 : porch.projection);
  const centerFront = recessedPortico() ? elevation.terraceFront : columnZ;
  const sideTerraces = elevation.sideTerraces.map((terrace, i) => i === 0
    ? { ...terrace, w: porch.x - terrace.x }
    : { x: porch.x + porch.w, w: terrace.x + terrace.w - (porch.x + porch.w) });
  const local = {
    ...elevation,
    centerFront,
    sideTerraces,
    porticoColumnZ: columnZ,
    porticoColumnDepth: elevation.porticoColumnDepth,
  };
  return {
    ...local,
    postXs: columnXs,
    postZ: elevation.postZ,
    porticoColumnWallGap: porch.projection - elevation.porticoColumnDepth / 2,
    // 将军柱仍落在当前门厅露台的挡墙中线交点，不改回门厅柱轴。
    balustradePosts: terraceParapetLayout(local, porch).cornerPosts.map(post => ({ ...post })),
    terraceBack: elevation.terraceBack,
    hatFront: site.main.z + (elevation.hatFront - site.main.z) * porch.projection / site.portico.projection,
    hatWidth: porch.w + (elevation.hatWidth - site.portico.w),
  };
}

/** 两翼没有露台时，原露台推拉门派生为窗；中央露台入口保留。 */
export function thirdFloorWingIsClosed(floor: number, facadeIndex: number, at: number) {
  if (floor !== 2 || facadeIndex !== 0 || hasThirdFloorSideTerraces()) return false;
  const x = mainLocalX(at);
  return x <= site.portico.x || x >= site.portico.x + site.portico.w;
}

/** 改三楼前缘时只伸缩接北墙的房间和墙端；楼梯及后排房间保持原位。 */
export function resizeThirdFloorFront(floor: Floor, front: number): Floor {
  if (Math.abs(front - floor.front) < 1e-6) return { ...floor, front };
  const moveZ = (z: number) => z <= floor.front + 1 ? front : Math.max(front, z);
  return { ...floor, front,
    rooms: floor.rooms.map(room => {
      if (room.kind === "stair" || room.kind === "void") return room;
      const z = moveZ(room.z), south = room.z + room.d;
      const outline = room.outline?.map(([x, zz]) => [x, moveZ(zz)] as Point);
      return { ...room, z, d: Math.max(400, south - z),
        ...(outline ? { outline } : {}),
        ...(room.label ? { label: [room.label[0], Math.max(z, room.label[1])] as Point } : {}) };
    }),
    partitions: floor.partitions.map(wall => {
      const a: Point = [wall.a[0], moveZ(wall.a[1])], b: Point = [wall.b[0], moveZ(wall.b[1])];
      if (!wall.door) return { ...wall, a, b };
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const along = length > 0 ? ((wall.a[0] - a[0]) * (b[0] - a[0]) + (wall.a[1] - a[1]) * (b[1] - a[1])) / length : 0;
      return { ...wall, a, b, door: { ...wall.door, offset: Math.max(0, Math.min(length - wall.door.width, wall.door.offset + along)) } };
    }).filter(w => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 10),
    furniture: floor.furniture.map(f => f.z < front ? { ...f, z: front } : f),
  };
}

export function mirrorRoom(r: Room, sum: number): Room {
  return { ...r, x: sum - r.x - r.w, ...(r.label ? { label: [sum - r.label[0], r.label[1]] as Point } : {}),
    ...(r.outline ? { outline: r.outline.map(([x, z]) => [sum - x, z] as Point).reverse() } : {}) };
}
export function mirrorWall(w: Wall, sum: number): Wall {
  return { ...w, a: [sum - w.a[0], w.a[1]], b: [sum - w.b[0], w.b[1]],
    door: w.door ? { ...w.door, side: w.door.side === "in" ? "out" : "in" } : undefined };
}
export function mirrorFurniture(f: Furniture, sum: number): Furniture {
  const showerDoorSide = f.showerDoorSide === "left" ? "right" : f.showerDoorSide === "right" ? "left" : f.showerDoorSide;
  return { ...f, x: sum - f.x, ...(f.rotation == null ? {} : { rotation: f.rotation === 0 ? 0 : -f.rotation }), ...(showerDoorSide ? { showerDoorSide } : {}) };
}
/** 保留原立面序号和端点次序；洞口偏移仍相对同一端，开向反射。 */
export function mirrorFacade(f: Facade, sum: number): Facade {
  return { ...f, a: [sum - f.a[0], f.a[1]], b: [sum - f.b[0], f.b[1]], openings: f.openings.map(o => ({ ...o,
    side: o.side ? o.side === "in" ? "out" : "in" : undefined })) };
}

/** 两种门厅均保留完整主体；保留共用入口供各图纸与编辑模型调用。 */
export function recessedFootprint(front: number, inset = 0): Point[] {
  const m = site.main;
  return [[m.x + inset, front + inset], [m.x + m.w - inset, front + inset],
    [m.x + m.w - inset, m.z + m.d - inset], [m.x + inset, m.z + m.d - inset]];
}
export function recessedRoom(room: Room, _front: number): Room { return room; }
export function recessedFloor(floor: Floor): Floor { return floor; }

/** 二楼飘檐平齐式为连续直檐，凸出式保留门厅折角；三维与立面同源。 */
export function frontApronOutline(back: number, eave = 0, e = frontElevation, p = site.portico): Point[] {
  const west = e.sideTerraces[0].x, east = e.sideTerraces[1].x + e.sideTerraces[1].w;
  if (recessedPortico()) return [[west - eave, back], [west - eave, e.terraceFront - eave],
    [east + eave, e.terraceFront - eave], [east + eave, back]];
  // 柱位与露台控制区不动，仅将檐下折角移向柱身外侧；线脚外边距各留截面的1/8。
  const westOffset = porticoEaveCornerOffset(e.porticoColumnDepth, apronEaveDesign.fasciaProtrusion);
  const eastOffset = porticoEaveCornerOffset(e.porticoColumnDepth, apronEaveDesign.fasciaProtrusion);
  const frontOffset = porticoEaveCornerOffset(e.porticoColumnDepth, apronEaveDesign.fasciaProtrusion);
  const centerWest = p.x - westOffset, centerEast = p.x + p.w + eastOffset;
  const centerFront = e.centerFront - frontOffset;
  return [[west - eave, back], [west - eave, e.terraceFront - eave],
    [centerWest - eave, e.terraceFront - eave], [centerWest - eave, centerFront - eave],
    [centerEast + eave, centerFront - eave], [centerEast + eave, e.terraceFront - eave],
    [east + eave, e.terraceFront - eave], [east + eave, back]];
}

/** 入口台阶随大门留在主楼前墙；平齐式没有柱脚垫高和外伸门厅平台。按门厅柱而非将军柱取外皮。 */
export function entranceApproachLayout(e = frontElevation, p = site.portico) {
  const flat = recessedPortico();
  const [westX, eastX] = porticoColumnCenters(p);
  const half = e.porticoColumnDepth / 2;
  return {
    westOuter: flat ? p.x : westX - half,
    westInner: flat ? p.x : westX + half,
    eastInner: flat ? p.x + p.w : eastX - half,
    eastOuter: flat ? p.x + p.w : eastX + half,
    columnNorth: flat ? site.main.z : e.porticoColumnZ - e.porticoColumnDepth / 2,
  };
}

/** 保留洞口中心，向开间两端各留40；二维、三维共用凹角收口。 */
export function fitFacadeOpening(center: number, width: number, start: number, end: number) {
  const fittedWidth = Math.min(width, 2 * Math.min(center - start, end - center) - 80);
  return fittedWidth > 0 ? { offset: center - fittedWidth / 2 - start, width: fittedWidth } : undefined;
}

/** 平齐式不再拆分中央凹墙、两翼或返墙，保留原门窗尺寸与编辑身份。 */
export function recessFrontFacades(faces: Facade[], _front: number): Facade[] { return faces; }
