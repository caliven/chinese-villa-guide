import { site, type Point, type Room } from "./data";
import type { LayoutDraft, VoidDraft } from "./layout-draft";
import { roomOutline } from "./room-geometry";
import { polygonIntersectionAreaMm2 } from "./plan-regions";

type Box = Pick<VoidDraft, "x" | "z" | "w" | "d">;
const keys = ["x", "z", "w", "d"] as const;
const outline = (box: Box): Point[] => [[box.x, box.z], [box.x + box.w, box.z], [box.x + box.w, box.z + box.d], [box.x, box.z + box.d]];
export const sameVoidBox = (a: Box, b: Box) => keys.every(key => Math.abs(a[key] - b[key]) < 1);
export const voidBox = (box: Box): Box => ({ x: box.x, z: box.z, w: box.w, d: box.d });

/** 老稿房间常名为“房间3”；按下层实际轮廓交集匹配，不依赖固定名称或编号。 */
export function livingVoidSource(draft: LayoutDraft): Room | undefined {
  const rooms = draft.floors[0]!.rooms.filter(room => room.kind !== "void" && room.kind !== "stair");
  if (draft.livingVoid.sourceRoomId) return rooms.find(room => room.id === draft.livingVoid.sourceRoomId);
  const ranked = rooms.map(room => ({ room, overlap: polygonIntersectionAreaMm2(outline(draft.livingVoid), roomOutline(room)) }))
    .filter(item => item.overlap > 1).sort((a, b) => b.overlap - a.overlap);
  return ranked[0]?.room;
}

/** 专用挑空编辑允许历史套叠减少，但不能新切入上层房间或楼梯。 */
export function livingVoidConflict(draft: LayoutDraft, next: Box, previous: Box = draft.livingVoid): string | undefined {
  const front = draft.floors[1]!.front;
  if (!keys.every(key => Number.isFinite(next[key])) || next.w < 1000 || next.d < 1000 || next.w > 40000 || next.d > 12000)
    return "挑空宽／进深至少1000，且需在可保存尺寸范围内";
  if (next.x < site.main.x - 1 || next.z < front - 1 || next.x + next.w > site.main.x + site.main.w + 1 || next.z + next.d > site.main.z + site.main.d + 1)
    return "挑空范围不能越出二楼主楼外墙";
  for (const room of draft.floors[1]!.rooms) {
    if (room.kind === "void") continue;
    const path = roomOutline(room);
    const before = previous.w > 0 && previous.d > 0 ? polygonIntersectionAreaMm2(outline(previous), path) : 0;
    const after = polygonIntersectionAreaMm2(outline(next), path);
    if (after > before + Math.max(next.w, next.d, room.w, room.d))
      return `挑空扩大后覆盖二楼「${room.name}」，请先调整该房间或楼梯范围`;
  }
}

/** 二维分区与真正楼板洞口只在这里一起写入；不推移上下层墙体和家具。 */
export function setLivingVoid(draft: LayoutDraft, next: VoidDraft) {
  draft.livingVoid = { ...next };
  const floor = draft.floors[1]!;
  const rooms = floor.rooms.filter(room => room.kind === "void");
  if (!next.w || !next.d) {
    floor.rooms = floor.rooms.filter(room => room.kind !== "void");
    return;
  }
  if (!rooms.length) {
    const used = new Set(floor.rooms.map(room => room.id));
    let id = "living-void";
    while (used.has(id)) id += "-1";
    const room: Room = { id, name: "客厅上空", kind: "void", ...voidBox(next) };
    floor.rooms.push(room);
    rooms.push(room);
  }
  for (const room of rooms) {
    Object.assign(room, voidBox(next));
    room.label = [next.x + next.w / 2, next.z + next.d / 2];
    delete room.outline;
    delete room.boundary;
  }
}

/** 旧稿首次接管：原先同一开间的挑空默认跟随；不同开间宽度的旧自定义范围保留。 */
export function initializeLivingVoid(draft: LayoutDraft) {
  const current = draft.livingVoid;
  if (!current.w || !current.d || !draft.floors[1]!.rooms.some(room => room.kind === "void")) return;
  const source = livingVoidSource(draft);
  if (current.mode == null) {
    current.mode = source && ["x", "z", "w"].every(key => Math.abs(source[key as keyof Box] - current[key as keyof Box]) < 1) ? "follow" : "custom";
    if (source) current.sourceRoomId = source.id;
  }
  // 跟随稿按来源保持一致；无法安全跟随的旧稿保留几何并明确标为自定义。
  if (current.mode === "follow") {
    if (source && (source.outline?.length ?? 0) <= 4 && !livingVoidConflict(draft, source))
      setLivingVoid(draft, { ...current, ...voidBox(source), sourceRoomId: source.id });
    else current.mode = "custom";
  }
}

/** 跟随模式仅响应已绑定一楼房间的几何变化，改名、换层不会重匹配其他房间。 */
export function followLivingVoid(draft: LayoutDraft, previous: LayoutDraft): string | undefined {
  if (draft.livingVoid.mode !== "follow") return;
  const source = livingVoidSource(draft), before = livingVoidSource(previous);
  if (!source) {
    draft.livingVoid.mode = "custom";
    delete draft.livingVoid.sourceRoomId;
    return;
  }
  if (before && sameVoidBox(source, before)) return;
  if ((source.outline?.length ?? 0) > 4) return "一楼客厅已变为凹形，请先将二楼挑空切换为自定义范围";
  const conflict = livingVoidConflict(draft, source);
  if (conflict) return conflict;
  setLivingVoid(draft, { ...draft.livingVoid, ...voidBox(source), sourceRoomId: source.id });
}
