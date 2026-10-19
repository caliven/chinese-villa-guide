import type { Room, Wall } from "./data";
import { validateProtectedRoomOverlaps } from "./layout-align";
import {
  applyRoomToEnclosedRegion,
  enclosedRoomRegions,
  findRoomForRegion,
  regionTouchesWall,
  roomRegionOverlap,
  type EnclosedRoomRegion,
} from "./plan-regions";

type Envelope = { x: number; z: number; w: number; d: number };

export type RoomSyncOptions = {
  /** 局部操作只在刚改墙附近新建；已有边界关联仍全量校验是否失围合。 */
  touchWall?: Wall;
  /** 由用户明确触发的全局生成可关联高度匹配的手工房；后台默认不改手工房。 */
  associateExisting?: boolean;
  create?: boolean;
  namePrefix?: string;
};

export type RoomSyncResult = { created: number; updated: number; issues: string[]; conflicts?: string[] };

function geometrySignature(room: Room): string {
  return JSON.stringify([room.x, room.z, room.w, room.d, room.outline ?? null, room.boundary ?? null]);
}

function nextRoomId(rooms: Room[]): string {
  const ids = new Set(rooms.map(r => r.id));
  let n = 1;
  while (ids.has(`room${n}`)) n++;
  return `room${n}`;
}

function significantOverlap(room: Room, region: EnclosedRoomRegion): boolean {
  const overlap = roomRegionOverlap(room, region);
  // 小卫浴／楼梯也不能因占新区面积较小而被大区吞并或重复填色。
  return overlap.room > 0.15 || overlap.region > 0.15;
}

/**
 * 以实际闭合墙边界同步房间。所有入口应共用此处，开敞候选由用户手工采纳。
 * 不删除房间，不改 void/stair，不按中心点把任意手工房强行撑大或缩小。
 * 墙改成未围合／一房分裂等无法唯一关联时保留几何和身份，报告失围合供用户处理。
 */
export function syncRoomsFromWalls(
  body: Envelope,
  walls: Wall[],
  rooms: Room[],
  options: RoomSyncOptions = {},
): RoomSyncResult {
  const result: RoomSyncResult = { created: 0, updated: 0, issues: [] };
  const regions = enclosedRoomRegions(body, walls);
  const remaining = new Set(regions);
  const assigned = new Set<string>();
  const changed = new Set<string>();
  const update = (room: Room, region: EnclosedRoomRegion) => {
    const before = geometrySignature(room);
    const candidate = structuredClone(room);
    applyRoomToEnclosedRegion(candidate, region);
    const protection = validateProtectedRoomOverlaps(rooms, rooms.map(r => r.id === room.id ? candidate : r));
    if (!protection.ok) {
      const reason = protection.reason ?? "房间边界侵入楼梯或挑空";
      result.issues.push(reason);
      (result.conflicts ??= []).push(reason);
      if (room.boundary) room.boundary = { ...room.boundary, status: "unbounded" };
    } else Object.assign(room, candidate);
    if (before !== geometrySignature(room)) changed.add(room.id);
    assigned.add(room.id);
    remaining.delete(region);
  };
  const editable = rooms.filter(r => r.kind !== "void" && r.kind !== "stair");
  const linked = editable.filter(r => r.boundary && r.boundary.status !== "open");

  // 先按稳定墙身份分配，避免墙移动后另一间的几何更接近而串换房名。
  for (const region of regions) {
    if (!region.boundaryKey) continue;
    const matches = linked.filter(r => !assigned.has(r.id) && r.boundary?.key === region.boundaryKey);
    if (matches.length === 1) update(matches[0]!, region);
    else if (matches.length > 1) result.issues.push("多个房间关联同一墙边界，请先处理重复房间。");
  }
  // 拆段等编辑改变边界键时，只接受双向高度覆盖的唯一几何匹配。
  for (const region of [...remaining]) {
    const existing = findRoomForRegion(linked.filter(r => !assigned.has(r.id)), region);
    if (existing) update(existing, region);
  }
  // 全局按钮允许首次建立关联；局部拖墙不擅自改写无边界关联的已有手工房。
  if (options.associateExisting) {
    for (const region of [...remaining]) {
      const existing = findRoomForRegion(editable.filter(r => !assigned.has(r.id) && !r.boundary), region);
      if (existing) update(existing, region);
    }
  }
  for (const room of linked) {
    if (assigned.has(room.id) || room.boundary?.status === "unbounded") continue;
    room.boundary = { ...room.boundary!, status: "unbounded" };
    changed.add(room.id);
    result.issues.push(`${room.name}已失去原闭合边界，已保留原房间轮廓。`);
  }
  if (options.create !== false) {
    for (const region of remaining) {
      if (options.touchWall && !regionTouchesWall(region, options.touchWall)) continue;
      const candidate: Room = { id: nextRoomId(rooms), name: "新房间", kind: "living", x: region.x, z: region.z, w: region.w, d: region.d };
      applyRoomToEnclosedRegion(candidate, region);
      const protection = validateProtectedRoomOverlaps(rooms, [...rooms, candidate]);
      if (!protection.ok) {
        result.issues.push(protection.reason ?? "闭合分区覆盖楼梯或挑空，未生成房间");
        continue;
      }
      const blockers = rooms.filter(room => room.kind !== "void" && room.kind !== "stair" && significantOverlap(room, region));
      if (blockers.length) {
        // 保留默认挑空、楼梯以及嵌套套间等手工语义，不生成覆盖它们的新房。
        const protectedOnly = blockers.every(r => r.kind === "void" || r.kind === "stair");
        if (!protectedOnly) result.issues.push(`闭合分区与${blockers.map(r => r.name).join("、")}重叠，已保留已有房间。`);
        continue;
      }
      const prefix = options.namePrefix ?? "房间";
      let number = 1;
      const names = new Set(rooms.map(r => r.name));
      while (names.has(`${prefix}${number}`)) number++;
      const room: Room = {
        id: nextRoomId(rooms), name: `${prefix}${number}`, kind: "living",
        x: region.x, z: region.z, w: region.w, d: region.d,
        purposeStatus: "pending",
        note: "按实际墙线闭合生成；面积为模型分区参考，房间用途待确认。",
      };
      applyRoomToEnclosedRegion(room, region);
      rooms.push(room);
      result.created++;
    }
  }
  result.updated = changed.size;
  result.issues = [...new Set(result.issues)];
  return result;
}
