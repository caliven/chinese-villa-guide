export interface CanvasView { x: number; y: number; w: number; h: number }
type Point = { x: number; y: number };

export function fitCanvasView(bounds: CanvasView, width: number, height: number): CanvasView {
  const ratio = width / Math.max(1, height);
  const w = Math.max(bounds.w, bounds.h * ratio), h = w / ratio;
  return { x: bounds.x + (bounds.w - w) / 2, y: bounds.y + (bounds.h - h) / 2, w, h };
}

/** 光标所指的毫米坐标在缩放前后保持不动。 */
export function zoomCanvasView(view: CanvasView, factor: number, anchor: Point): CanvasView {
  const w = Math.max(2000, Math.min(150000, view.w * factor)), scale = w / view.w;
  return { x: anchor.x - (anchor.x - view.x) * scale, y: anchor.y - (anchor.y - view.y) * scale, w, h: view.h * scale };
}

export function measuredPoint(start: Point, end: Point, orthogonal: boolean): Point {
  const point = { x: Math.round(end.x), y: Math.round(end.y) };
  if (orthogonal) {
    if (Math.abs(end.x - start.x) > Math.abs(end.y - start.y)) point.y = start.y;
    else point.x = start.x;
  }
  return point;
}

interface CanvasHost {
  active(): boolean;
  selecting(): boolean;
  clearSelection(): void;
  viewChanged(percent: number): void;
}

/** 连续毫米画布。只改变观看位置和临时测距，不写入户型草稿。 */
export class PlanCanvas {
  mode: "select" | "pan" | "measure" = "select";
  private svg: SVGSVGElement | null = null;
  private floor = -1;
  private views = new Map<number, CanvasView>();
  private base: CanvasView = { x: 0, y: 0, w: 25000, h: 18000 };
  private fitted = true;
  private space = false;
  private drag: { id: number; x: number; y: number; view: CanvasView; moved: boolean } | null = null;
  private measure: { start: Point; end: Point } | null = null;
  private measuring = false;

  constructor(private container: HTMLElement, private host: CanvasHost) {
    container.addEventListener("wheel", event => {
      if (!this.host.active() || !this.svg) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.zoom(Math.exp(Math.max(-200, Math.min(200, event.deltaY)) * .0018), event.clientX, event.clientY);
    }, { passive: false, capture: true });
    container.addEventListener("pointerdown", event => this.down(event), { capture: true });
    container.addEventListener("click", event => {
      if (this.host.active() && this.mode !== "select") { event.preventDefault(); event.stopImmediatePropagation(); }
    }, { capture: true });
    container.addEventListener("pointermove", event => this.move(event));
    container.addEventListener("pointerup", event => this.up(event));
    container.addEventListener("pointercancel", () => this.end());
    window.addEventListener("blur", () => { this.space = false; this.end(); });
    document.addEventListener("keydown", event => {
      if (!this.host.active() || (event.target as Element)?.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.code === "Space") { event.preventDefault(); this.space = true; this.cursor(); }
      if (event.key === "Escape" && this.mode !== "select") { this.setMode("select"); event.preventDefault(); }
    });
    document.addEventListener("keyup", event => { if (event.code === "Space") { this.space = false; this.cursor(); } });
    new ResizeObserver(() => {
      if (!this.host.active() || !this.svg || !this.container.clientHeight) return;
      if (this.fitted) this.fit();
      else {
        const view = this.view();
        const h = view.w * this.container.clientHeight / Math.max(1, this.container.clientWidth);
        this.views.set(this.floor, { ...view, y: view.y + (view.h - h) / 2, h });
        this.paint();
      }
    }).observe(container);
  }

  sync(svg: SVGSVGElement, floor: number) {
    this.svg = svg;
    const [x, y, w, h] = svg.getAttribute("viewBox")!.split(/\s+/).map(Number);
    this.base = { x, y, w, h };
    if (this.floor !== floor) { this.floor = floor; this.measure = null; this.fitted = !this.views.has(floor); }
    if (this.fitted || !this.views.has(floor)) this.views.set(floor, this.fitView());
    else {
      const view = this.view(), h = view.w * (this.container.clientHeight || 700) / (this.container.clientWidth || 1000);
      this.views.set(floor, { ...view, y: view.y + (view.h - h) / 2, h });
    }
    this.paint();
  }
  setMode(mode: PlanCanvas["mode"]) {
    this.end();
    this.mode = mode;
    this.measuring = false;
    if (mode !== "measure") this.measure = null;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-canvas-tool]")) {
      const active = button.dataset.canvasTool === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    const hint = document.getElementById("editor-mode-hint");
    if (hint) {
      hint.textContent = mode === "measure" ? "依次点击两点测距 · Shift 锁定水平 / 竖直 · Esc 退出" : mode === "pan" ? "拖动画布平移 · 滚轮缩放 · Esc 返回选择" : "";
      hint.hidden = mode === "select";
    }
    this.cursor();
    this.paintMeasure();
  }
  fit() {
    if (!this.svg) return;
    this.fitted = true;
    this.views.set(this.floor, this.fitView());
    this.paint();
  }
  zoom(factor: number, clientX?: number, clientY?: number) {
    if (!this.svg) return;
    const rect = this.svg.getBoundingClientRect();
    const view = this.view();
    const px = clientX == null ? .5 : (clientX - rect.left) / rect.width;
    const py = clientY == null ? .5 : (clientY - rect.top) / rect.height;
    this.views.set(this.floor, zoomCanvasView(view, factor, { x: view.x + px * view.w, y: view.y + py * view.h }));
    this.fitted = false;
    this.paint();
  }
  focus(bounds: DOMRect) {
    if (!this.svg) return;
    const box = this.svg.getBoundingClientRect(), view = this.view();
    const point = { x: view.x + (bounds.x + bounds.width / 2 - box.x) / box.width * view.w, y: view.y + (bounds.y + bounds.height / 2 - box.y) / box.height * view.h };
    const w = Math.max(5000, view.w * Math.max(bounds.width / box.width, bounds.height / box.height) * 2.5);
    const h = w * box.height / box.width;
    this.views.set(this.floor, { x: point.x - w / 2, y: point.y - h / 2, w, h });
    this.fitted = false;
    this.paint();
  }
  private fitView() { return fitCanvasView(this.base, this.container.clientWidth || 1000, this.container.clientHeight || 700); }
  private view() { return this.views.get(this.floor) ?? this.fitView(); }
  private worldPoint(event: PointerEvent) {
    const world = this.svg!.querySelector<SVGGElement>(".plan-world")!;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(world.getScreenCTM()!.inverse());
    return { x: Math.round(point.x), y: Math.round(point.y) };
  }
  private down(event: PointerEvent) {
    if (!this.host.active() || !this.svg || !event.isPrimary) return;
    if (this.mode === "measure" && event.button === 0 && !this.space) {
      event.preventDefault(); event.stopImmediatePropagation();
      const point = this.worldPoint(event);
      if (!this.measuring) { this.measure = { start: point, end: point }; this.measuring = true; }
      else { this.measure!.end = measuredPoint(this.measure!.start, point, event.shiftKey); this.measuring = false; }
      this.paintMeasure(); return;
    }
    const object = (event.target as Element).closest("[data-edit],[data-room],[data-furniture]");
    const pan = event.button === 1 || (event.button === 0 && (this.space || this.mode === "pan" || (!object && this.host.selecting())));
    if (!pan) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, view: { ...this.view() }, moved: false };
    this.container.setPointerCapture(event.pointerId);
    this.cursor();
  }
  private move(event: PointerEvent) {
    if (!this.host.active() || !this.svg) return;
    if (this.mode === "measure" && this.measuring && this.measure) {
      this.measure.end = measuredPoint(this.measure.start, this.worldPoint(event), event.shiftKey);
      this.paintMeasure();
    }
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    const rect = this.svg.getBoundingClientRect();
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    this.views.set(this.floor, { ...drag.view, x: drag.view.x - dx / rect.width * drag.view.w, y: drag.view.y - dy / rect.height * drag.view.h });
    this.fitted = false;
    this.paint();
  }
  private up(event: PointerEvent) {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    if (!this.drag.moved && this.mode === "select" && !this.space) this.host.clearSelection();
    this.end();
  }
  private end() {
    if (this.drag && this.container.hasPointerCapture(this.drag.id)) this.container.releasePointerCapture(this.drag.id);
    this.drag = null;
    this.cursor();
  }
  private cursor() { this.container.style.cursor = this.drag ? "grabbing" : this.space || this.mode === "pan" ? "grab" : this.mode === "measure" ? "crosshair" : ""; }
  private paint() {
    if (!this.svg) return;
    const view = this.view();
    this.svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
    const scale = Math.max(.001, this.svg.getBoundingClientRect().width / view.w);
    this.svg.style.setProperty("--editor-name-size", `${Math.max(290, 12 / scale)}px`);
    this.svg.style.setProperty("--editor-area-size", `${Math.max(215, 10 / scale)}px`);
    this.svg.style.setProperty("--editor-dim-size", `${Math.max(220, 9 / scale)}px`);
    for (const label of this.svg.querySelectorAll<SVGGElement>(".room-label[data-label-x]")) {
      const x = Number(label.dataset.labelX), z = Number(label.dataset.labelZ);
      const gap = Math.max(180, 7 / scale);
      for (const [index, text] of Array.from(label.querySelectorAll("text")).entries()) {
        const y = z + (index === 0 ? gap : -gap);
        text.setAttribute("y", String(y));
        text.setAttribute("transform", `rotate(180 ${x} ${y})`);
      }
    }
    for (const handle of this.svg.querySelectorAll<SVGRectElement>("rect.edit-handle")) {
      const x = Number(handle.getAttribute("x")), y = Number(handle.getAttribute("y"));
      const w = Number(handle.getAttribute("width")), h = Number(handle.getAttribute("height"));
      const size = 9 / scale;
      handle.setAttribute("x", String(x + w / 2 - size / 2)); handle.setAttribute("y", String(y + h / 2 - size / 2));
      handle.setAttribute("width", String(size)); handle.setAttribute("height", String(size));
    }
    for (const handle of this.svg.querySelectorAll<SVGCircleElement>("circle.edit-rotate-handle")) handle.setAttribute("r", String(6 / scale));
    const distance = [100, 200, 500, 1000, 2000, 5000, 10000].find(n => n * scale >= 55) ?? 10000;
    const line = document.getElementById("editor-scale-line"), label = document.getElementById("editor-scale-value");
    if (line) line.style.width = `${distance * scale}px`;
    if (label) label.textContent = `${distance} mm`;
    this.host.viewChanged(Math.round(this.fitView().w / view.w * 100));
    this.paintMeasure();
  }
  private paintMeasure() {
    this.svg?.querySelector(".editor-measure")?.remove();
    if (!this.svg || !this.measure) return;
    const { start: a, end: b } = this.measure;
    const scale = this.svg.getBoundingClientRect().width / this.view().w;
    const size = 12 / scale, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    this.svg.querySelector(".plan-world")?.insertAdjacentHTML("beforeend", `<g class="editor-measure" pointer-events="none"><path d="M${a.x} ${a.y} L${b.x} ${b.y}"/><circle cx="${a.x}" cy="${a.y}" r="${3 / scale}"/><circle cx="${b.x}" cy="${b.y}" r="${3 / scale}"/><text x="${mx}" y="${my + size}" font-size="${size}" text-anchor="middle" transform="rotate(180 ${mx} ${my + size})">${Math.round(Math.hypot(b.x - a.x, b.y - a.y))}</text></g>`);
  }
}
