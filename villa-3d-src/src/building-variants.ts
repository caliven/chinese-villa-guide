import { site, construction, frontElevation, type Point, type Room, type Floor, type Wall, type Furniture } from "./data";
import { roomNetGeometry, polygonAreaMm2, roomLabelPoint } from "./room-geometry";
import type { Facade } from "./facades";

export type PorticoStyle = "projecting" | "recessed";
export type BuildingPlacement = "main-east" | "main-west";
export type ThirdFloorMode = "setback" | "flush";
export const porticoStyleLabels = { projecting: "凸出式门厅", recessed: "凹入式门厅" } as const;
export const buildingPlacementLabels = { "main-east": "主楼东 · 辅楼西", "main-west": "主楼西 · 辅楼东" } as const;
export const thirdFloorModeLabels = { setback: "北向内退", flush: "不内退" } as const;
export const hasThirdFloorSideTerraces = () => site.setback > 0;
export const frontTerracePosts = () => hasThirdFloorSideTerraces() ? frontElevation.balustradePosts : frontElevation.balustradePosts.slice(1, 3);
export const recessedPortico = () => site.porticoStyle === "recessed";
export const mirroredBuildings = () => site.buildingPlacement === "main-west";
export const porticoFrontZ = () => site.main.z - (recessedPortico() ? 0 : site.portico.projection);
export const porticoWallZ = (front = site.main.z) => front + (recessedPortico() ? site.portico.projection : 0);
export const mainLocalX = (offset: number) => site.main.x + (mirroredBuildings() ? site.main.w - offset : offset);
export const annexLocalX = (offset: number) => site.annex.x + (mirroredBuildings() ? site.annex.w - offset : offset);

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

/** 门厅凹口；三层各自从本层前墙起退，保留三楼原有退台。 */
export function recessedFootprint(front: number, inset = 0): Point[] {
  const m = site.main, p = site.portico, back = m.z + m.d;
  if (!recessedPortico()) return [[m.x + inset, front + inset], [m.x + m.w - inset, front + inset], [m.x + m.w - inset, back - inset], [m.x + inset, back - inset]];
  return [[m.x + inset, front + inset], [p.x - inset, front + inset], [p.x - inset, front + p.projection + inset],
    [p.x + p.w + inset, front + p.projection + inset], [p.x + p.w + inset, front + inset],
    [m.x + m.w - inset, front + inset], [m.x + m.w - inset, back - inset], [m.x + inset, back - inset]];
}

/** 凹口只派生显示，不删改用户稿；切回凸出式原户型逐项恢复。 */
export function recessedRoom(room: Room, front: number): Room {
  if (!recessedPortico()) return room;
  const p = site.portico, bottom = front + p.projection;
  if (room.z >= bottom || room.x >= p.x + p.w || room.x + room.w <= p.x) return room;
  const cut: Wall = { a: [p.x, front], b: [p.x + p.w, front] };
  const result = roomNetGeometry(room, { x: -100000, z: -100000, w: 200000, d: 200000 },
    [cut], 0, p.projection * 2);
  const paths = result.paths.sort((a, b) => polygonAreaMm2(b) - polygonAreaMm2(a));
  // 凹口可能把原房间分成多个片区；以往返零宽连接保留全部轮廓，不能只留下最大一块。
  const path = paths[0]?.slice();
  if (path) for (const island of paths.slice(1)) path.push(path[0], ...island, island[0], path[0]);
  if (!path) return { ...room, outline: [], w: 0, d: 0 };
  const xs = path.map(p => p[0]), zs = path.map(p => p[1]);
  const next = { ...room, x: Math.min(...xs), z: Math.min(...zs), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs), outline: path };
  next.label = roomLabelPoint(next);
  return next;
}

export function recessedFloor(floor: Floor): Floor {
  if (!recessedPortico()) return floor;
  const p = site.portico, back = floor.front + p.projection;
  return { ...floor, rooms: floor.rooms.map(r => recessedRoom(r, floor.front)).filter(r => r.w > 0 && r.d > 0),
    partitions: floor.partitions.flatMap((w, sourceIndex) => {
      const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], length = Math.hypot(dx, dz);
      let enter = 0, leave = 1;
      for (const [at, delta, lo, hi] of [[w.a[0], dx, p.x, p.x + p.w], [w.a[1], dz, -100000, back]]) {
        if (Math.abs(delta) < 1e-9) { if (at < lo || at > hi) return [{ ...w, sourceIndex }]; }
        else { const t0 = (lo - at) / delta, t1 = (hi - at) / delta; enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1)); }
      }
      if (leave <= enter) return [{ ...w, sourceIndex }];
      return [[0, enter], [leave, 1]].filter(([a, b]) => (b - a) * length > 1).map(([a, b]) => {
        const door = w.door && w.door.offset >= a * length && w.door.offset + w.door.width <= b * length ? { ...w.door, offset: w.door.offset - a * length } : undefined;
        return { ...w, sourceIndex, a: [w.a[0] + dx * a, w.a[1] + dz * a] as Point, b: [w.a[0] + dx * b, w.a[1] + dz * b] as Point, door };
      });
    }),
    furniture: floor.furniture.map(f => {
      const angle = f.rotation ?? 0;
      const hw = (Math.abs(f.w * Math.cos(angle)) + Math.abs(f.d * Math.sin(angle))) / 2;
      const hd = (Math.abs(f.w * Math.sin(angle)) + Math.abs(f.d * Math.cos(angle))) / 2;
      return f.x + hw > p.x && f.x - hw < p.x + p.w && f.z - hd < back && f.z + hd > floor.front
        ? { ...f, z: back + hd + construction.outsideWall } : f;
    }) };
}

/** 保留洞口中心，向开间两端各留40；二维、三维共用凹角收口。 */
export function fitFacadeOpening(center: number, width: number, start: number, end: number) {
  const fittedWidth = Math.min(width, 2 * Math.min(center - start, end - center) - 80);
  return fittedWidth > 0 ? { offset: center - fittedWidth / 2 - start, width: fittedWidth } : undefined;
}

/** 首面保持洞口来源索引，按中央开间拆成凹口后墙、两翼、两道返墙。 */
export function recessFrontFacades(faces: Facade[], front: number): Facade[] {
  if (!recessedPortico()) return faces;
  const [face, ...rest] = faces.map((f, sourceFacadeIndex) => ({ ...f, sourceFacadeIndex, sourceOffset: 0 })), p = site.portico;
  const reversed = face.b[0] < face.a[0];
  const lo = Math.min(face.a[0], face.b[0]), hi = Math.max(face.a[0], face.b[0]);
  const z = face.a[1], sum = face.a[0] + face.b[0];
  const original = reversed ? mirrorFacade(face, sum) : face;
  const px = reversed ? sum - p.x - p.w : p.x;
  const segment = (x0: number, x1: number, zz: number): Facade => ({ sourceFacadeIndex: 0, sourceOffset: x0 - lo, a: [x0, zz], b: [x1, zz],
    openings: original.openings.flatMap(o => {
      const fitted = fitFacadeOpening(lo + o.at, o.w, x0, x1);
      return fitted ? [{ ...o, at: lo + o.at - x0, w: fitted.width }] : [];
    }) });
  const parts: Facade[] = [segment(px, px + p.w, z + p.projection), segment(lo, px, z), segment(px + p.w, hi, z),
    { a: [px, z], b: [px, z + p.projection], openings: [] },
    { a: [px + p.w, z], b: [px + p.w, z + p.projection], openings: [] }];
  return [...(reversed ? parts.map(f => mirrorFacade(f, sum)) : parts), ...rest];
}
