/** 院坪尺寸线拖动：黄点固定；只改尺寸线位置与虚线长短，可翻到被量边另一侧。SVG 用户单位＝mm，shift 亦为 mm。 */

export type CourtyardDimLayout = Record<string, number>;

/** @deprecated 已改存 scheme 文件，保留键名仅供旧迁移识别。 */
export const courtyardDimLayoutKey = "anhua-villa-courtyard-dim-layout-v1";

/** 字到尺寸线间距；plan 渲染与拖动刷新共用。 */
export const yardDimLabelGap = 200;
/** 尺寸线贴边时不画虚线。 */
export const yardDimDirectEps = 120;
/** 箭头尖端横线半宽（mm）。 */
export const yardDimTick = 80;
const labelGap = yardDimLabelGap;
const directEps = yardDimDirectEps;
const tick = yardDimTick;
const ah = 130;
const aw = 110;

/** 内存布局；持久化由 scheme-store 写入文件。 */
let memoryDimLayout: CourtyardDimLayout = {};

export function loadCourtyardDimLayout(): CourtyardDimLayout {
  return { ...memoryDimLayout };
}

export function saveCourtyardDimLayout(layout: CourtyardDimLayout) {
  memoryDimLayout = { ...layout };
}

export function replaceCourtyardDimLayout(layout: CourtyardDimLayout) {
  memoryDimLayout = { ...layout };
}

export function clearCourtyardDimLayout() {
  memoryDimLayout = {};
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(ctm.inverse());
}

function n(v: number) {
  return Math.round(v);
}

export function yardDimDir(edge: number, dim: number, fallback: 1 | -1): 1 | -1 {
  const d = dim - edge;
  if (Math.abs(d) < 1e-3) return fallback;
  return d > 0 ? 1 : -1;
}

function ensureExt(g: SVGElement): SVGPathElement {
  let ext = g.querySelector(".dim-ext") as SVGPathElement | null;
  if (!ext) {
    ext = document.createElementNS("http://www.w3.org/2000/svg", "path");
    ext.setAttribute("class", "dim-ext");
    const span = g.querySelector(".dim-span");
    if (span) g.insertBefore(ext, span);
    else g.appendChild(ext);
  }
  return ext;
}

function removeExt(g: SVGElement) {
  g.querySelector(".dim-ext")?.remove();
}

/** 按当前 shift 刷新竖直尺寸线几何（黄点不动）。 */
export function applyYardVDimShift(g: SVGElement, shift: number) {
  const edge = Number(g.dataset.edge);
  const base = Number(g.dataset.baseDim);
  const z0 = Number(g.dataset.z0);
  const z1 = Number(g.dataset.z1);
  const fallback: 1 | -1 = g.dataset.side === "west" ? -1 : 1;
  if (![edge, base, z0, z1].every(Number.isFinite)) return;
  const dx = n(base + shift);
  const dir = yardDimDir(edge, base + shift, fallback);
  const sep = Math.abs(base + shift - edge);
  const showExt = sep >= directEps;
  const stop = n(edge + dir * Math.max(sep - 120, sep * 0.88));
  const lx = n(dx + dir * labelGap);
  const mid = n((z0 + z1) / 2);
  const rot = dir >= 0 ? 90 : -90;

  const span = g.querySelector(".dim-span");
  const arrow = g.querySelector(".dim-arrow");
  const tickPath = g.querySelector(".dim-tick");
  const hit = g.querySelector(".yard-dim-hit");
  const text = g.querySelector("text");

  span?.setAttribute("d", `M${dx} ${z0} V${z1}`);
  arrow?.setAttribute(
    "d",
    `M${dx} ${z0} l${-ah} ${aw} M${dx} ${z0} l${ah} ${aw} M${dx} ${z1} l${-ah} ${-aw} M${dx} ${z1} l${ah} ${-aw}`,
  );
  tickPath?.setAttribute(
    "d",
    `M${n(dx - tick)} ${z0} H${n(dx + tick)} M${n(dx - tick)} ${z1} H${n(dx + tick)}`,
  );
  hit?.setAttribute("d", `M${dx} ${z0} V${z1}`);
  if (text) {
    text.setAttribute("x", String(lx));
    text.setAttribute("y", String(mid));
    text.setAttribute("transform", `rotate(${rot} ${lx} ${mid})`);
  }

  if (showExt) {
    ensureExt(g).setAttribute("d", `M${edge} ${z0} H${stop} M${edge} ${z1} H${stop}`);
    g.classList.add("yard-dim-extend");
    g.classList.remove("yard-dim-direct");
  } else {
    removeExt(g);
    g.classList.add("yard-dim-direct");
    g.classList.remove("yard-dim-extend");
  }

  g.dataset.shift = String(n(shift));
}

/** 按当前 shift 刷新水平尺寸线几何（黄点不动）。 */
export function applyYardHDimShift(g: SVGElement, shift: number) {
  const edge = Number(g.dataset.edge);
  const base = Number(g.dataset.baseDim);
  const x0 = Number(g.dataset.x0);
  const x1 = Number(g.dataset.x1);
  const fallback: 1 | -1 = g.dataset.side === "north" ? -1 : 1;
  if (![edge, base, x0, x1].every(Number.isFinite)) return;
  const dz = n(base + shift);
  const dir = yardDimDir(edge, base + shift, fallback);
  const sep = Math.abs(base + shift - edge);
  const showExt = sep >= directEps;
  const stop = n(edge + dir * Math.max(sep - 120, sep * 0.88));
  const ly = n(dz + dir * labelGap);
  const mid = n((x0 + x1) / 2);

  const span = g.querySelector(".dim-span");
  const arrow = g.querySelector(".dim-arrow");
  const tickPath = g.querySelector(".dim-tick");
  const hit = g.querySelector(".yard-dim-hit");
  const text = g.querySelector("text");

  span?.setAttribute("d", `M${x0} ${dz} H${x1}`);
  arrow?.setAttribute(
    "d",
    `M${x0} ${dz} l${aw} ${-ah} M${x0} ${dz} l${aw} ${ah} M${x1} ${dz} l${-aw} ${-ah} M${x1} ${dz} l${-aw} ${ah}`,
  );
  tickPath?.setAttribute(
    "d",
    `M${x0} ${n(dz - tick)} V${n(dz + tick)} M${x1} ${n(dz - tick)} V${n(dz + tick)}`,
  );
  hit?.setAttribute("d", `M${x0} ${dz} H${x1}`);
  if (text) {
    text.setAttribute("x", String(mid));
    text.setAttribute("y", String(ly));
    text.removeAttribute("transform");
  }

  if (showExt) {
    ensureExt(g).setAttribute("d", `M${x0} ${edge} V${stop} M${x1} ${edge} V${stop}`);
    g.classList.add("yard-dim-extend");
    g.classList.remove("yard-dim-direct");
  } else {
    removeExt(g);
    g.classList.add("yard-dim-direct");
    g.classList.remove("yard-dim-extend");
  }

  g.dataset.shift = String(n(shift));
}

/**
 * 绑定院坪 SVG 上 `.yard-dim` 的拖动。返回取消绑定函数。
 */
export function bindCourtyardDimDrag(
  svg: SVGSVGElement,
  getLayout: () => CourtyardDimLayout,
  setLayout: (next: CourtyardDimLayout) => void,
): () => void {
  type Drag = {
    id: string;
    axis: "x" | "z";
    el: SVGElement;
    startShift: number;
    originX: number;
    originY: number;
    pointerId: number;
  };
  let drag: Drag | null = null;

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = (event.target as Element | null)?.closest?.(".yard-dim") as SVGElement | null;
    if (!target || !svg.contains(target)) return;
    const id = target.dataset.yardDim;
    const axis = target.dataset.axis === "z" ? "z" : target.dataset.axis === "x" ? "x" : null;
    if (!id || !axis) return;
    const pt = clientToSvg(svg, event.clientX, event.clientY);
    if (!pt) return;
    event.preventDefault();
    event.stopPropagation();
    const startShift = Number(target.dataset.shift ?? "0") || 0;
    drag = {
      id,
      axis,
      el: target,
      startShift,
      originX: pt.x,
      originY: pt.y,
      pointerId: event.pointerId,
    };
    target.classList.add("dragging");
    target.setPointerCapture?.(event.pointerId);
  };

  const onMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pt = clientToSvg(svg, event.clientX, event.clientY);
    if (!pt) return;
    event.preventDefault();
    const delta = drag.axis === "x" ? pt.x - drag.originX : pt.y - drag.originY;
    const shift = n(drag.startShift + delta);
    if (drag.axis === "x") applyYardVDimShift(drag.el, shift);
    else applyYardHDimShift(drag.el, shift);
  };

  const onUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { id, el, axis } = drag;
    const shift = Number(el.dataset.shift ?? "0") || 0;
    el.classList.remove("dragging");
    try {
      el.releasePointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
    drag = null;
    const next = { ...getLayout(), [id]: shift };
    if (Math.abs(shift) < 1e-3) delete next[id];
    setLayout(next);
    saveCourtyardDimLayout(next);
    if (axis === "x") applyYardVDimShift(el, shift);
    else applyYardHDimShift(el, shift);
  };

  svg.classList.add("courtyard-dim-draggable");
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);

  return () => {
    svg.classList.remove("courtyard-dim-draggable");
    svg.removeEventListener("pointerdown", onDown);
    svg.removeEventListener("pointermove", onMove);
    svg.removeEventListener("pointerup", onUp);
    svg.removeEventListener("pointercancel", onUp);
  };
}
