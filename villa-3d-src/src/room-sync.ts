import type { Room, Wall } from "./data";
import { newRoomForRegion, subdivideRoomRegions } from "./room-subdivision";
import { validateProtectedRoomOverlaps } from "./layout-align";
import {
  applyRoomToEnclosedRegion,
  allRoomRegions,
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
  /** 新画墙或明确生成时创建开敞区；普通微调只同步已有开敞区。 */
  createOpen?: boolean;
  namePrefix?: string;
};

export type RoomSyncResult = { created: number; updated: number; issues: string[]; conflicts?: string[] };

function geometrySignature(room: Room): string {
  return JSON.stringify([room.x, room.z, room.w, room.d, room.outline ?? null, room.boundary ?? null]);
}

function significantOverlap(room: Room, region: EnclosedRoomRegion): boolean {
  const overlap = roomRegionOverlap(room, region);
  // 小卫浴／楼梯也不能因占新区面积较小而被大区吞并或重复填色。
  return overlap.room > 0.15 || overlap.region > 0.15;
}

/**
 * 以实际墙边界同步房间，空置的三面 U 形另标为开敞分区。
 * 完整墙线分割时最大子区保留原房身份，其余子区生成独立房间；不改 void/stair。
 * 未围合、带孔或与其它手工分区冲突时保留原几何，明确报告原因。
 */
export function syncRoomsFromWalls(
  body: Envelope,
  walls: Wall[],
  rooms: Room[],
  options: RoomSyncOptions = {},
): RoomSyncResult {
  const result: RoomSyncResult = { created: 0, updated: 0, issues: [] };
  const protectedRooms = rooms.filter(r => r.kind === "void" || r.kind === "stair");
  const includeOpen = (options.create !== false && options.createOpen !== false) ||
    rooms.some(r => r.boundary?.key.startsWith("open-walls:"));
  // 已完全占用的保护区不是待生成房间；全层扫描时静默跳过。
  const allRegions = includeOpen ? allRoomRegions(body, walls) : enclosedRoomRegions(body, walls);
  const regions = allRegions.filter(region =>
    !protectedRooms.some(room => roomRegionOverlap(room, region).region >= 1 - 1e-9));
  const remaining = new Set(regions);
  const assigned = new Set<string>();
  const changed = new Set<string>();
  if (options.create !== false) {
    const split = subdivideRoomRegions(rooms, allRegions, options);
    result.created += split.created;
    result.issues.push(...split.issues);
    for (const id of split.changedIds) changed.add(id);
    for (const id of split.assignedIds) assigned.add(id);
    for (const region of split.claimed) remaining.delete(region);
  }
  const description = (region: EnclosedRoomRegion) =>
    `${region.openSide ? "开敞分区" : "闭合分区"} ${region.w}×${region.d}（距西墙${Math.round(region.x - body.x)}、北墙${Math.round(region.z - body.z)}）`;
  const canMatch = (room: Room, region: EnclosedRoomRegion) =>
    !region.openSide || room.boundary?.key.startsWith("open-walls:");
  const update = (room: Room, region: EnclosedRoomRegion) => {
    const before = geometrySignature(room);
    const candidate = structuredClone(room);
    applyRoomToEnclosedRegion(candidate, region);
    if (!region.openSide && room.boundary?.key.startsWith("open-walls:") && room.note?.startsWith("按三面墙生成")) {
      candidate.note = "按实际墙线闭合生成；面积为模型分区参考，房间用途待确认。";
    }
    const protection = validateProtectedRoomOverlaps(rooms, rooms.map(r => r.id === room.id ? candidate : r));
    const occupied = region.openSide ? rooms.filter(r => r.id !== room.id && r.kind !== "void" && r.kind !== "stair" && significantOverlap(r, region)) : [];
    if (!protection.ok || occupied.length) {
      const reason = protection.reason ?? `${room.name}调整后的${description(region)}与已有「${occupied.map(r => r.name).join("、")}」重叠，已保留原轮廓`;
      result.issues.push(reason);
      (result.conflicts ??= []).push(reason);
      if (room.boundary) room.boundary = { ...room.boundary, status: "unbounded" };
    } else Object.assign(room, candidate);
    if (before !== geometrySignature(room)) changed.add(room.id);
    assigned.add(room.id);
    remaining.delete(region);
  };
  const editable = rooms.filter(r => r.kind !== "void" && r.kind !== "stair");
  const linked = editable.filter(r => r.boundary && (r.boundary.status !== "open" || r.boundary.key.startsWith("open-walls:")));

  // 先按稳定墙身份分配，避免墙移动后另一间的几何更接近而串换房名。
  for (const region of remaining) {
    if (!region.boundaryKey) continue;
    const matches = linked.filter(r => !assigned.has(r.id) && canMatch(r, region) && r.boundary?.key === region.boundaryKey);
    if (matches.length === 1) update(matches[0]!, region);
    else if (matches.length > 1) result.issues.push("多个房间关联同一墙边界，请先处理重复房间。");
  }
  // 拆段等编辑改变边界键时，只接受双向高度覆盖的唯一几何匹配。
  for (const region of [...remaining]) {
    const existing = findRoomForRegion(linked.filter(r => !assigned.has(r.id) && canMatch(r, region)), region);
    if (existing) update(existing, region);
  }
  // 全局按钮允许首次建立关联；局部拖墙不擅自改写无边界关联的已有手工房。
  if (options.associateExisting) {
    for (const region of [...remaining]) {
      if (region.openSide) continue;
      const existing = findRoomForRegion(editable.filter(r => !assigned.has(r.id) && !r.boundary), region);
      if (existing) update(existing, region);
    }
  }
  for (const room of linked) {
    if (assigned.has(room.id) || room.boundary?.status === "unbounded") continue;
    const wasOpen = room.boundary?.key.startsWith("open-walls:");
    room.boundary = { ...room.boundary!, status: "unbounded" };
    changed.add(room.id);
    result.issues.push(`${room.name}已失去原${wasOpen ? "三面墙" : "闭合"}边界，已保留原房间轮廓。`);
  }
  if (options.create !== false) {
    // 闭合轮廓优先，避免把完整 L 形房拆成几个 U 形小区。
    for (const region of remaining) {
      if (region.openSide && options.createOpen === false) continue;
      if (options.touchWall && !regionTouchesWall(region, options.touchWall)) continue;
      const candidate = newRoomForRegion(rooms, region, options.namePrefix);
      const protection = validateProtectedRoomOverlaps(rooms, [...rooms, candidate]);
      if (!protection.ok) {
        const overlaps = protectedRooms.filter(r => roomRegionOverlap(r, region).region > 0);
        result.issues.push(`未生成${description(region)}：与「${overlaps.map(r => r.name).join("、")}」重叠，请补充分界或调整墙线`);
        continue;
      }
      const blockers = rooms.filter(room => room.kind !== "void" && room.kind !== "stair" && significantOverlap(room, region));
      if (blockers.length) {
        // 相同或已完全占用的房间不重复生成；部分重叠才报告需补分界。
        if (!region.openSide && blockers.length === 1 && roomRegionOverlap(blockers[0]!, region).region >= 1 - 1e-9 && roomRegionOverlap(blockers[0]!, region).room < 0.8) {
          result.issues.push(`未生成${description(region)}：位于「${blockers[0]!.name}」内部，剩余区域未形成可表达的闭合轮廓（可能有孔），请补充分界`);
        } else if (blockers.length !== 1 || roomRegionOverlap(blockers[0]!, region).region < 1 - 1e-9) {
          result.issues.push(`未生成${description(region)}：与已有「${blockers.map(r => r.name).join("、")}」重叠，请补充分界`);
        }
        continue;
      }
      rooms.push(candidate);
      result.created++;
    }
  }
  result.updated = changed.size;
  result.issues = [...new Set(result.issues)];
  return result;
}
