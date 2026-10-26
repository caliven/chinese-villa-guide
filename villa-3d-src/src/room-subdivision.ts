import type { Room, Wall } from "./data";
import { validateProtectedRoomOverlaps } from "./layout-align";
import { applyRoomToEnclosedRegion, regionTouchesWall, roomRegionOverlap, type EnclosedRoomRegion } from "./plan-regions";
import { polygonAreaMm2, roomContainsPoint, roomOutline, roundedRoomOutline } from "./room-geometry";

/** 旧稿可能保留小数毫米；与墙线一样按坐标取整比较，不放宽真实缝隙。 */
function referenceRoom(room: Room): Room {
  return { ...room, outline: roundedRoomOutline(room) };
}

export function newRoomForRegion(rooms: readonly Room[], region: EnclosedRoomRegion, prefix = "房间"): Room {
  let id = 1, number = 1;
  while (rooms.some(r => r.id === `room${id}`)) id++;
  while (rooms.some(r => r.name === `${prefix}${number}`)) number++;
  return applyRoomToEnclosedRegion({
    id: `room${id}`, name: `${prefix}${number}`, kind: "living",
    x: region.x, z: region.z, w: region.w, d: region.d, purposeStatus: "pending",
    note: region.openSide
      ? "按三面墙生成的开敞分区，未补实体墙；面积为模型分区参考，房间用途待确认。"
      : "按实际墙线闭合生成；面积为模型分区参考，房间用途待确认。",
  }, region);
}

/** 按真实子区完整覆盖拆房；自动开敞区允许稳定墙边界延伸越过旧投影。 */
export function subdivideRoomRegions(
  rooms: Room[], regions: EnclosedRoomRegion[], options: { touchWall?: Wall; namePrefix?: string; targetRegion?: EnclosedRoomRegion },
) {
  const result = { created: 0, changedIds: new Set<string>(), assignedIds: new Set<string>(), claimed: new Set<EnclosedRoomRegion>(), issues: [] as string[] };
  const closed = regions.filter(r => !r.openSide);
  for (const parent of [...rooms]) {
    if (parent.kind === "stair" || parent.kind === "void" || result.assignedIds.has(parent.id)) continue;
    const reference = referenceRoom(parent);
    let children = closed.filter(r => !result.claimed.has(r) && roomRegionOverlap(reference, r).region >= 1 - 1e-9);
    const area = polygonAreaMm2(roomOutline(reference));
    let evolved = false;
    const totalArea = (items: EnclosedRoomRegion[]) => items.reduce((sum, r) => sum + (r.geometryArea ?? r.buildingArea) * 1e6, 0);
    // 自动开敞区的第四边只是旧墙端的投影。补墙、延长侧墙并分房后，真实子区
    // 可以越过旧投影；按稳定边界和完整覆盖重建，不能继续用旧色块挡住新房。
    if ((children.length < 2 || Math.abs(area - totalArea(children)) > 1) && parent.boundary) {
      const keys = new Set(parent.boundary.key.replace(/^open-walls:/, "").split("|"));
      const candidates: EnclosedRoomRegion[] = [];
      const eligible = regions.filter(r => !result.claimed.has(r) &&
        roomRegionOverlap(reference, r).region >= 0.5 &&
        ((r.boundaryKey?.replace(/^open-walls:/, "").split("|").filter(key => keys.has(key)).length) ?? 0) >= 2)
        .sort((a, b) => Number(!!a.openSide) - Number(!!b.openSide) || roomRegionOverlap(reference, b).room - roomRegionOverlap(reference, a).room);
      for (const region of eligible) {
        // 开敞候选可能互相重叠，只采纳互不重叠且完整覆盖旧区的一组；
        // 实际开口仍保留 open 状态，不用残余整栋轮廓吞并其它房间。
        if (candidates.some(other => roomRegionOverlap({ ...parent, x: other.x, z: other.z, w: other.w, d: other.d, outline: other.polygon }, region).room > 1e-9)) continue;
        candidates.push(region);
      }
      const covered = candidates.reduce((sum, r) => sum + roomRegionOverlap(reference, r).room * area, 0);
      if (candidates.length >= 2 && Math.abs(area - covered) <= 1) {
        children = candidates;
        evolved = true;
      }
    }
    if (children.length < 2 || (options.touchWall && !children.some(r => regionTouchesWall(r, options.touchWall!)))) continue;
    if (options.targetRegion && !children.some(r => r.boundaryKey === options.targetRegion!.boundaryKey)) continue;
    const childArea = totalArea(children);
    // 不能遗留未识别条带、带孔残余，也不能跨出手工房或把开敞候选凑成闭合。
    if (!evolved && Math.abs(area - childArea) > 1) continue;
    const owners = new Map<EnclosedRoomRegion, Room>();
    const others = rooms.filter(r => r !== parent && children.some(c => roomRegionOverlap(referenceRoom(r), c).region > 1e-9));
    let reason = "";
    for (const other of others) {
      // 已有内卫等手工子房允许按与普通关联相同的双向 80% 覆盖归位，不能跨两区猜身份。
      const matches = children.filter(r => {
        const overlap = roomRegionOverlap(referenceRoom(other), r);
        return overlap.room >= 0.8 && overlap.region >= 0.8;
      });
      if (other.kind === "stair" || other.kind === "void" || matches.length !== 1 || owners.has(matches[0]!)) {
        reason = `「${parent.name}」内部划分与已有「${other.name}」重叠，已保留原房间，请核对分界`;
        break;
      }
      owners.set(matches[0]!, other);
    }
    // 最大子区沿用原用途、名称和身份；面积相同按原标签、坐标稳定选择。
    const available = children.filter(c => !owners.has(c)).sort((a, b) => {
      const containsLabel = (r: EnclosedRoomRegion) => parent.label && roomContainsPoint({ ...parent, x: r.x, z: r.z, w: r.w, d: r.d, outline: r.polygon }, parent.label) ? 1 : 0;
      if (evolved && containsLabel(a) !== containsLabel(b)) return containsLabel(b) - containsLabel(a);
      const delta = (b.geometryArea ?? b.buildingArea) - (a.geometryArea ?? a.buildingArea);
      if (Math.abs(delta) > 1e-9) return delta;
      return containsLabel(b) - containsLabel(a) || a.x - b.x || a.z - b.z;
    });
    if (!available.length) reason ||= `「${parent.name}」内部已有其它完整房间，保留原数据，请先处理重复分区`;
    const replacements = new Map<string, Room>();
    const additions: Room[] = [];
    if (!reason) {
      owners.set(available[0]!, parent);
      for (const region of children) {
        const owner = owners.get(region);
        if (owner) {
          const replacement = applyRoomToEnclosedRegion(structuredClone(owner), region);
          if (!region.openSide && owner.note?.startsWith("按三面墙生成")) replacement.note = "按实际墙线闭合生成；面积为模型分区参考，房间用途待确认。";
          replacements.set(owner.id, replacement);
        }
        else additions.push(newRoomForRegion([...rooms, ...additions], region, options.namePrefix));
      }
      const protection = validateProtectedRoomOverlaps(rooms, [...rooms.map(r => replacements.get(r.id) ?? r), ...additions]);
      if (!protection.ok) reason = protection.reason ?? "内部划分与楼梯或挑空冲突，已保留原房间";
    }
    // 成功或拒绝均不再让后续一对一启发式处理半个事务。
    for (const child of children) result.claimed.add(child);
    result.assignedIds.add(parent.id);
    for (const other of others) result.assignedIds.add(other.id);
    if (reason) { result.issues.push(reason); continue; }
    for (const room of rooms) {
      const replacement = replacements.get(room.id);
      if (!replacement) continue;
      if (JSON.stringify(room) !== JSON.stringify(replacement)) result.changedIds.add(room.id);
      Object.assign(room, replacement);
    }
    rooms.push(...additions);
    for (const room of additions) result.assignedIds.add(room.id);
    result.created += additions.length;
  }
  return result;
}
