/** 毫米窗型：参照真实铝合金固定窗＋开启扇的构成，不按整窗比例拉伸型材。
 * 框扇尺度参考 Reynaers MasterLine 8（53/37 可视宽、77/87 深度）；
 * 以下分格阈值是本模型的造型选择，不代表品牌加工或承载极限。
 */
export type WindowMode = "standard" | "continuous" | "fixed";
export type WindowRect = { x: number; y: number; w: number; h: number };
export type WindowFrame = WindowRect & { role: "边框" | "竖梃" | "横梃" | "开启扇框" | "密封胶条" };
export type WindowPane = WindowRect & { row: number; column: number; operable: boolean };
export type WindowSash = WindowRect & { hinge: "left" | "right" | "top" };
export interface WindowDesign {
  width: number;
  height: number;
  mode: WindowMode;
  panes: WindowPane[];
  frames: WindowFrame[];
  windows: WindowSash[];
}
export const windowProfiles = { outer: 60, mullion: 80, sash: 37, joint: 3, bead: 12, frameDepth: 77, sashDepth: 87, glassDepth: 24 } as const;

/** 以洞口左下角为原点；完整窗先排格，剖切仅在渲染时裁剪。 */
export function windowDesign(width: number, height: number, mode: WindowMode = "standard", outer: number = windowProfiles.outer): WindowDesign {
  const result: WindowDesign = { width, height, mode, panes: [], frames: [], windows: [] };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return result;
  const edge = Math.min(outer, width / 8, height / 8), cw = width - 2 * edge, ch = height - 2 * edge;
  const mullion = Math.min(windowProfiles.mullion, cw / 8, ch / 8), gap = Math.min(windowProfiles.joint, cw / 30, ch / 30);
  const frame = (r: WindowRect, role: WindowFrame["role"]) => { if (r.w > 0 && r.h > 0) result.frames.push({ ...r, role }); };
  const ring = (r: WindowRect, t: number, role: WindowFrame["role"]) => {
    frame({ x: r.x, y: r.y, w: t, h: r.h }, role);
    frame({ x: r.x + r.w - t, y: r.y, w: t, h: r.h }, role);
    frame({ x: r.x + t, y: r.y, w: r.w - 2 * t, h: t }, role);
    frame({ x: r.x + t, y: r.y + r.h - t, w: r.w - 2 * t, h: t }, role);
  };
  if (edge) ring({ x: 0, y: 0, w: width, h: height }, edge, "边框");
  let widths: number[];
  if (mode === "fixed") {
    const count = Math.max(1, Math.ceil((cw + mullion) / (1500 + mullion)));
    widths = Array(count).fill((cw - (count - 1) * mullion) / count);
  } else if (mode === "continuous" && cw >= 1980 && cw <= 3100) {
    const side = (cw - 2 * mullion) / 3.5;
    widths = [side, side * 1.5, side];
  } else if (width <= 1000) {
    // 洞宽1000及以下只设一个开启扇，避免扣除框料后再分成两条窄扇。
    widths = [cw];
  } else if (cw < 1980) {
    const available = cw - mullion;
    widths = available / 2 <= 780 ? [available / 2, available / 2] : [available - 650, 650];
  } else {
    const middle = cw - 1300 - 2 * mullion, count = Math.max(1, Math.ceil((middle + mullion) / (1500 + mullion)));
    widths = [650, ...Array(count).fill((middle - (count - 1) * mullion) / count), 650];
  }
  const columns = widths.map((w, i) => ({ x: edge + widths.slice(0, i).reduce((a, b) => a + b, 0) + i * mullion, w }));
  // 竖梃连续到外框；横梃逐格抵住竖梃，不出现悬空横杆或交点叠料。
  columns.slice(0, -1).forEach(c => frame({ x: c.x + c.w, y: edge, w: mullion, h: ch }, "竖梃"));
  columns.forEach((c, column) => {
    const side = column === 0 || column === columns.length - 1;
    const canOpen = mode !== "fixed" && c.w >= 360 && c.w <= (columns.length === 1 ? 900 : 850) && (side || columns.length <= 2) && ch >= 300;
    const broadCenter = mode === "standard" && columns.length >= 3 && !side;
    let heights: number[], openingRow = 0;
    if (mode === "continuous" && ch > 1600) {
      const first = Math.min(1300, ch - mullion - 350), count = Math.max(1, Math.ceil((ch - first) / (2400 + mullion)));
      heights = [first, ...Array(count).fill((ch - first - count * mullion) / count)];
    } else if (canOpen && ch > 2350) {
      const low = 500, main = 1400, count = Math.max(1, Math.ceil((ch - low - main - mullion) / (2400 + mullion)));
      heights = [low, main, ...Array(count).fill((ch - low - main - (count + 1) * mullion) / count)];
      openingRow = 1;
    } else if (!broadCenter && mode === "standard" && ch > 1500 && ch <= 2350) {
      const main = Math.min(1400, ch - mullion - 350);
      heights = [main, ch - main - mullion];
    } else {
      const count = Math.max(1, Math.ceil((ch + mullion) / ((broadCenter ? 2700 : 2400) + mullion)));
      heights = Array(count).fill((ch - (count - 1) * mullion) / count);
    }
    let y = edge;
    heights.forEach((h, row) => {
      if (row) frame({ x: c.x, y: y - mullion, w: c.w, h: mullion }, "横梃");
      const operable = canOpen && row === openingRow && h <= 1500;
      const cell = { x: c.x + gap, y: y + gap, w: c.w - 2 * gap, h: h - 2 * gap };
      const sash = operable ? Math.min(windowProfiles.sash, cell.w / 6, cell.h / 6) : 0;
      if (operable) {
        ring({ x: c.x, y, w: c.w, h }, gap, "密封胶条");
        ring(cell, sash, "开启扇框");
        result.windows.push({ ...cell, hinge: h < 600 ? "top" : column === columns.length - 1 && columns.length > 1 ? "right" : "left" });
      }
      const inset = sash + (operable ? gap : 0);
      result.panes.push({ x: cell.x + inset, y: cell.y + inset, w: cell.w - 2 * inset, h: cell.h - 2 * inset, row, column, operable });
      y += h + mullion;
    });
  });
  return result;
}

export function windowInteriorSide(a: readonly number[], b: readonly number[], body: { x: number; z: number; w: number; d: number }) {
  return ((body.x + body.w / 2 - (a[0] + b[0]) / 2) * -(b[1] - a[1])
    + (body.z + body.d / 2 - (a[1] + b[1]) / 2) * (b[0] - a[0])) > 0 ? 1 : -1;
}

export function moveWindowDesign(design: WindowDesign, x: number, y: number): WindowDesign {
  const move = <T extends WindowRect>(r: T) => ({ ...r, x: r.x + x, y: r.y + y });
  return { ...design, panes: design.panes.map(move), frames: design.frames.map(move), windows: design.windows.map(move) };
}

/** 开启线只用于图纸；平开扇的尖端为执手边，上悬扇的尖端在下方。 */
export function windowOpeningLine(sash: WindowSash): [number, number][] {
  if (sash.hinge === "top") return [[sash.x, sash.y + sash.h], [sash.x + sash.w / 2, sash.y], [sash.x + sash.w, sash.y + sash.h]];
  const hinge = sash.hinge === "left" ? sash.x : sash.x + sash.w, latch = sash.hinge === "left" ? sash.x + sash.w : sash.x;
  return [[hinge, sash.y], [latch, sash.y + sash.h / 2], [hinge, sash.y + sash.h]];
}
