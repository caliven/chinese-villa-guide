import { construction, floors, site, type Point } from "./data.ts";
import { annexGlassCanopy } from "./annex-canopy.ts";
import { facades } from "./facades.ts";
import { annexRoofGutterDesign, eyelidInset, withAnnexRoofDesign } from "./roof-options.ts";
import { DEFAULT_DOOR_HEIGHT } from "./openings.ts";
import type { ExteriorOpeningDraft } from "./layout-draft.ts";

/** 平顶露台为效果方案：铺装、护栏与跨子孙道平台共用这份几何，尺寸非施工核定。 */
export interface TerracePiece {
  x: number; z: number; w: number; d: number; bottom: number; top: number;
  finish: "paving" | "trim" | "glass" | "canopyGlass" | "metal" | "concrete";
  name: string;
  slopeX?: number;
  slopeZ?: number;
}

/** 从实际世界坐标选择朝辅楼的侧墙，不把数组索引当东西方向。 */
export function annexFacingFacadeIndex() {
  const faces = facades(1), center = site.annex.x + site.annex.w / 2;
  const sides = faces.map((face, index) => ({ face, index })).filter(({ face }) => Math.abs(face.a[0] - face.b[0]) < 1);
  return sides.reduce((best, side) => Math.abs(side.face.a[0] - center) < Math.abs(best.face.a[0] - center) ? side : best).index;
}

function terraceDoor(openings?: ExteriorOpeningDraft[]) {
  const facadeIndex = annexFacingFacadeIndex(), face = facades(1)[facadeIndex];
  const defaults: ExteriorOpeningDraft[] = face.openings.map(o => ({ floor: 1, facadeIndex,
    opening: { offset: o.at - o.w / 2, width: o.w, kind: o.door ? "door" : "window" } }));
  const items = openings ?? defaults;
  const centerZ = (item: ExteriorOpeningDraft) => {
    const t = (item.opening.offset + item.opening.width / 2) / Math.hypot(face.b[0] - face.a[0], face.b[1] - face.a[1]);
    return face.a[1] + (face.b[1] - face.a[1]) * t;
  };
  const candidates = items.filter(o => o.floor === 1 && o.facadeIndex === facadeIndex
    && centerZ(o) - o.opening.width / 2 > site.annex.z + 200
    && centerZ(o) + o.opening.width / 2 < site.annex.z + site.annex.d - 200);
  // 优先沿用已有门；有多个窗时只改最接近辅楼中部的一樘，不凭空增加洞口。
  candidates.sort((a, b) => Number(a.opening.kind === "window") - Number(b.opening.kind === "window")
    || Math.abs(centerZ(a) - site.annex.z - site.annex.d / 2) - Math.abs(centerZ(b) - site.annex.z - site.annex.d / 2));
  const item = candidates[0];
  return item ? { item, index: items.indexOf(item), z: centerZ(item) } : null;
}

/** 仅派生平顶状态的门，不回写户型；恢复瓦顶时原窗尺寸、窗台和位置完整保留。 */
export function annexTerraceOpenings(items: ExteriorOpeningDraft[]): ExteriorOpeningDraft[] {
  if (site.annexRoofType !== "flat") return items;
  const door = terraceDoor(items);
  return items.map((item, index) => index === door?.index && item.opening.kind === "window"
    ? { ...item, opening: { ...item.opening, kind: "door", sill: 0, height: DEFAULT_DOOR_HEIGHT } } : item);
}

export function annexFlatRoofLayout(openings?: ExteriorOpeningDraft[]) {
  const a = site.annex, e = site.eave;
  // 铺装延展到檐口内侧；外侧三眼皮保留台阶，整面平顶不留环形沟槽。
  const inset = withAnnexRoofDesign(() => eyelidInset(2)) + 2;
  const footprint = { x: a.x - e + inset, z: a.z - e + inset, w: a.w + 2 * e - inset * 2, d: a.d + 2 * e - inset * 2 };
  const slabTop = a.height + construction.floorSlab;
  const curbTop = slabTop + annexRoofGutterDesign.clearDepth;
  const deckY = Math.max(curbTop + 50, floors[1].y);
  const pieces: TerracePiece[] = [];
  const add = (name: string, finish: TerracePiece["finish"], x: number, z: number, w: number, d: number, bottom: number, top: number) => {
    if (w > 0 && d > 0 && top > bottom) pieces.push({ name, finish, x, z, w, d, bottom, top });
  };
  const x0 = footprint.x, x1 = x0 + footprint.w, z0 = footprint.z, z1 = z0 + footprint.d;
  add("辅楼平顶露台垫层", "concrete", (x0 + x1) / 2, (z0 + z1) / 2, footprint.w, footprint.d, slabTop, deckY - 20);
  add("辅楼平顶露台铺装", "paving", (x0 + x1) / 2, (z0 + z1) / 2, footprint.w, footprint.d, deckY - 20, deckY);
  const door = terraceDoor(openings);
  const towardEast = site.main.x > a.x;
  const bridgeWidth = door ? Math.max(1200, door.item.opening.width + 400) : 0;
  const b0 = door ? door.z - bridgeWidth / 2 : 0, b1 = b0 + bridgeWidth;
  // 暖灰主体铺装配窄深色周边收口，收口填实至檐口，不形成高反坎。
  const border = inset - 20;
  const edge = (x: number, z: number, w: number, d: number) =>
    add("辅楼露台深色收边", "trim", x, z, w, d, curbTop, deckY);
  edge((x0 + x1) / 2, z0 - border / 2, footprint.w + border * 2, border);
  edge((x0 + x1) / 2, z1 + border / 2, footprint.w + border * 2, border);
  for (const [x, nearMain] of [[x0 - border / 2, !towardEast], [x1 + border / 2, towardEast]] as const) {
    if (door && nearMain) {
      edge(x, (z0 + b0) / 2, border, b0 - z0);
      edge(x, (z1 + b1) / 2, border, z1 - b1);
    } else edge(x, (z0 + z1) / 2, border, footprint.d);
  }
  // 大板分缝疏朗；缝顶与铺装错开1，交点互让，避免共面闪动。
  for (let z = z0 + 1200; z < z1 - 100; z += 1200)
    add("辅楼露台铺装分缝", "concrete", (x0 + x1) / 2, z, footprint.w, 4, deckY, deckY + 1);
  for (let z = z0; z < z1; z += 1200) {
    const end = Math.min(z + 1200, z1);
    add("辅楼露台铺装分缝", "concrete", (x0 + x1) / 2, (z + end) / 2, 4, end - z - 6, deckY, deckY + 1);
  }
  // 两处点式地漏位于外侧边带，侧排管线在檐口内预留，不恢复环形天沟。
  const drainX = towardEast ? x0 + 180 : x1 - 180;
  const drains = [z0 + footprint.d / 4, z1 - footprint.d / 4].map(z => ({ x: drainX, z }));
  for (const drain of drains)
    add("辅楼露台侧排地漏示意", "metal", drain.x, drain.z, 100, 180, deckY, deckY + 2);
  // 沿可使用露台的结构承托边顶装；80为效果边距，不是锚栓设计值。
  // 三眼皮外挑饰面留在栏杆外，不能把栏杆底座移到装饰唇边上。
  const railInset = Math.min(80, footprint.w / 6, footprint.d / 6);
  const railX = towardEast ? x1 - railInset : x0 + railInset;
  const guards: { a: Point; b: Point; y: number }[] = [];
  const posts = new Set<string>();
  const guard = (aa: Point, bb: Point, y = deckY) => {
    if (Math.hypot(bb[0] - aa[0], bb[1] - aa[1]) < 1) return;
    guards.push({ a: aa, b: bb, y });
    const vertical = aa[0] === bb[0], length = Math.hypot(bb[0] - aa[0], bb[1] - aa[1]);
    const count = Math.max(1, Math.ceil(length / 1300));
    for (let i = 0; i < count; i++) {
      const t = (i + .5) / count, x = aa[0] + (bb[0] - aa[0]) * t, z = aa[1] + (bb[1] - aa[1]) * t;
      const w = vertical ? 12 : length / count - 32, d = vertical ? length / count - 32 : 12;
      add("辅楼露台玻璃护栏", "glass", x, z, w, d, y + 100, y + 1050);
      // 纵向扶手在转角让开横向扶手的半宽，顶面不重叠；柱子仍位于真实交点。
      const startTrim = vertical && i === 0 ? 26 : 0, endTrim = vertical && i === count - 1 ? 26 : 0;
      const handrailLength = length / count - startTrim - endTrim;
      if (handrailLength > 0)
        add("辅楼露台深色扶手", "metal", x, z + (startTrim - endTrim) / 2,
          vertical ? 50 : handrailLength, vertical ? handrailLength : 50, y + 1050, y + 1100);
    }
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = aa[0] + (bb[0] - aa[0]) * t, z = aa[1] + (bb[1] - aa[1]) * t;
      const key = `${x.toFixed(3)}:${z.toFixed(3)}:${y.toFixed(3)}`;
      if (!posts.has(key)) {
        add("辅楼露台栏杆立柱", "metal", x, z, 30, 30, y + 14, y + 1050);
        // 露台顶装底座完整落在铺装内；连接平台另按桥面节点表达。
        if (x - 40 >= x0 && x + 40 <= x1 && z - 40 >= z0 && z + 40 <= z1)
          add("辅楼露台栏杆顶装底座", "metal", x, z, 80, 80, y + 2, y + 14);
      }
      posts.add(key);
    }
  };
  // 四角共用一根柱及底座，扶手在几何上互让，避免靠外沿后转角叠件闪动。
  guard([x0 + railInset, z0 + railInset], [x1 - railInset, z0 + railInset]);
  guard([x0 + railInset, z1 - railInset], [x1 - railInset, z1 - railInset]);
  const farX = towardEast ? x0 + railInset : x1 - railInset;
  guard([farX, z0 + railInset], [farX, z1 - railInset]);
  if (door) {
    // 桥面栏杆同样落在边内，门口开口仍宽于原门洞。
    const railB0 = b0 + 50, railB1 = b1 - 50;
    guard([railX, z0 + railInset], [railX, railB0]);
    guard([railX, railB1], [railX, z1 - railInset]);
    const mainX = towardEast ? site.main.x : site.main.x + site.main.w;
    const bridgeEnd = towardEast ? x1 : x0;
    const steps = Math.max(1, Math.ceil(Math.abs(deckY - floors[1].y) / 150));
    for (let i = 0; i < steps; i++) {
      const xa = mainX + (bridgeEnd - mainX) * i / steps, xb = mainX + (bridgeEnd - mainX) * (i + 1) / steps;
      const y = floors[1].y + (deckY - floors[1].y) * (i + 1) / steps;
      add("二楼通辅楼连接平台", "concrete", (xa + xb) / 2, door.z, Math.abs(xb - xa), bridgeWidth, y - Math.min(120, Math.max(20, y - curbTop - 10)), y);
      // 最后一段直接接到露台栏杆，取消原来紧挨着的短玻璃和重复柱。
      const railEnd = i === steps - 1 ? railX : xb;
      guard([xa, railB0], [railEnd, railB0], y);
      guard([xa, railB1], [railEnd, railB1], y);
    }
  } else guard([railX, z0 + railInset], [railX, z1 - railInset]);
  const canopy = annexGlassCanopy(deckY, footprint);
  if (canopy) pieces.push(...canopy.pieces);
  return { footprint, slabTop, deckY, pieces, guards, drains, canopy, doorZ: door?.z ?? null };
}
