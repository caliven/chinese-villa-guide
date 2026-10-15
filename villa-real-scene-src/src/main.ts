import "./style.css";

type View = "front" | "aerial";
type Mode = "render" | "original" | "compare" | "model";
type ModelController = {
  setView(view: View): void;
  exportImage(): string | Promise<string>;
  dispose(): void;
};

const views: Record<View, { label: string; original: string; render: string }> = {
  front: {
    label: "近景正面",
    original: "./photos/front-original.jpg",
    render: "./photos/front-render.png",
  },
  aerial: {
    label: "全景航拍",
    original: "./photos/aerial-original.jpg",
    render: "./photos/aerial-render.png",
  },
};
const modes: Record<Mode, string> = {
  render: "建成效果",
  original: "原始航拍",
  compare: "前后对比",
  model: "建筑模型",
};
const icon = (name: "house" | "download" | "arrow" | "move") => {
  const paths = {
    house: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    move: '<path d="m9 8-4 4 4 4m6-8 4 4-4 4M5 12h14"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header class="page-header">
    <div class="brand">${icon("house")}<strong>安化<span>·</span>山居</strong></div>
    <a class="original-model-link" href="../villa-3d/" target="_blank" rel="noopener">打开原模型 ${icon("arrow")}</a>
  </header>
  <main class="workspace">
    <div class="toolbar">
      <fieldset class="view-picker" aria-label="选择机位"><div class="view-buttons">
        <button type="button" data-view="aerial" aria-pressed="false">全景航拍</button>
        <button type="button" data-view="front" aria-pressed="true">近景正面</button>
      </div></fieldset>
      <div class="mode-buttons" role="group" aria-label="查看模式">
        ${Object.entries(modes).map(([mode, label]) => `<button type="button" data-mode="${mode}" aria-pressed="${mode === "render"}">${label}</button>`).join("")}
      </div>
      <button type="button" class="download-button" id="download-image">${icon("download")}<span>下载建成效果</span></button>
    </div>
    <section class="viewer" aria-label="实景效果查看区">
      <div class="visual-bay">
        <div class="image-frame" id="image-frame">
          <img id="base-image" class="scene-image" alt="" hidden draggable="false" />
          <div id="comparison-layer" class="comparison-layer" hidden><img id="effect-image" class="scene-image" alt="" draggable="false" /></div>
          <div class="comparison-marker" id="comparison-marker" hidden role="slider" tabindex="0" aria-label="原始航拍显示比例" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="原始航拍 50%，建成效果 50%"><span title="左右拖动对比" aria-hidden="true">${icon("move")}</span></div>
          <div id="image-labels" class="image-labels" hidden aria-hidden="true"><span>原始航拍</span><span>建成效果</span></div>
          <div class="loading-state" id="loading-state" role="status"><span class="loading-dot" aria-hidden="true"></span><strong id="loading-message">正在加载实景画面</strong><button type="button" class="retry-button" id="retry-image" hidden>重新加载</button></div>
        </div>
        <div id="model-host" class="model-host" title="拖动旋转 · 滚轮或双指缩放" hidden></div>
      </div>
      <p id="asset-status" class="asset-status" role="status" hidden></p>
    </section>
    <footer class="page-footer"><p>合成参考，场地位置为估算；未同步最新方案，尺寸以当前方案模型为准。</p></footer>
  </main>
  <div id="toast" class="toast" role="status" hidden></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const modelParam = new URLSearchParams(window.location.search).get("model");
document.body.classList.toggle("is-embedded", new URLSearchParams(window.location.search).get("embed") === "1");
let view: View = modelParam === "aerial" ? "aerial" : "front";
let mode: Mode = modelParam === "front" || modelParam === "aerial" ? "model" : "render";
let model: ModelController | null = null;
let updateId = 0;
let imageReady = false;
let comparison = 50;
let comparisonDrag: { pointer: number; startX: number; startAmount: number } | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const imageCache = new Map<string, Promise<string>>();

Object.defineProperty(window, "__realSceneState", {
  get: () => ({ view, mode, imageReady, modelReady: model !== null }),
});

function toast(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4000);
}

function loadImage(url: string): Promise<string> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const promise = new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(url);
    image.onerror = () => {
      imageCache.delete(url);
      reject(new Error("图片暂时无法加载"));
    };
    image.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

function download(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function setImage(element: HTMLImageElement, url: string, description: string) {
  element.src = url;
  element.alt = description;
  element.hidden = false;
}

function updateComparison() {
  const amount = comparison;
  $("image-frame").style.setProperty("--comparison", `${amount}%`);
  const labels = $("image-labels").children;
  (labels[0] as HTMLElement).style.visibility = amount === 0 ? "hidden" : "visible";
  (labels[1] as HTMLElement).style.visibility = amount === 100 ? "hidden" : "visible";
  $("comparison-marker").setAttribute("aria-valuenow", String(amount));
  $("comparison-marker").setAttribute("aria-valuetext", `原始航拍 ${amount}%，建成效果 ${100 - amount}%`);
}

function setComparison(amount: number) {
  comparison = Math.max(0, Math.min(100, Math.round(amount)));
  updateComparison();
}

function endComparisonDrag() {
  const marker = $("comparison-marker"), pointer = comparisonDrag?.pointer;
  comparisonDrag = null;
  marker.classList.remove("is-dragging");
  if (pointer !== undefined && marker.hasPointerCapture(pointer)) marker.releasePointerCapture(pointer);
}

function updateSelection() {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  });
  $("download-image").querySelector("span")!.textContent = mode === "model" ? "下载模型截图" : mode === "original" ? "下载原始航拍" : "下载建成效果";
}

function showLoading(message: string) {
  $("loading-message").textContent = message;
  $("loading-state").classList.remove("is-error");
  $("loading-state").hidden = false;
  $("retry-image").hidden = true;
}

async function updateView() {
  endComparisonDrag();
  const thisUpdate = ++updateId;
  imageReady = false;
  updateSelection();
  $<HTMLButtonElement>("download-image").disabled = true;
  $("asset-status").hidden = true;
  $("comparison-layer").hidden = true;
  $("comparison-marker").hidden = true;
  $("image-labels").hidden = true;
  $("base-image").hidden = true;
  $("image-frame").hidden = mode === "model";
  $("model-host").hidden = mode !== "model";

  if (mode === "model") {
    if (model) {
      model.setView(view);
      imageReady = true;
      $<HTMLButtonElement>("download-image").disabled = false;
      return;
    }
    $("model-host").setAttribute("aria-busy", "true");
    $("model-host").innerHTML = '<div class="model-message" role="status"><span class="loading-dot" aria-hidden="true"></span><strong>正在加载建筑模型</strong></div>';
    try {
      const { ModelPreview } = await import("./model-preview");
      if (thisUpdate !== updateId) return;
      $("model-host").replaceChildren();
      model = new ModelPreview($("model-host"));
      model.setView(view);
      $("model-host").setAttribute("aria-busy", "false");
      imageReady = true;
      $<HTMLButtonElement>("download-image").disabled = false;
    } catch {
      if (thisUpdate !== updateId) return;
      $("model-host").setAttribute("aria-busy", "false");
      $("model-host").innerHTML = '<div class="model-message" role="status"><strong>建筑模型暂时无法加载</strong><span>可以先查看实景图片，或刷新页面重试。</span></div>';
    }
    return;
  }

  if (model) {
    model.dispose();
    model = null;
    $("model-host").replaceChildren();
  }
  showLoading("正在加载实景画面");
  const selected = views[view];
  try {
    if (mode === "original") {
      const original = await loadImage(selected.original);
      if (thisUpdate !== updateId) return;
      setImage($<HTMLImageElement>("base-image"), original, `${selected.label} · 原始航拍`);
      imageReady = true;
    } else if (mode === "render") {
      let rendered: string;
      let fallback = false;
      try {
        rendered = await loadImage(selected.render);
      } catch {
        rendered = await loadImage(selected.original);
        fallback = true;
      }
      if (thisUpdate !== updateId) return;
      setImage($<HTMLImageElement>("base-image"), rendered, `${selected.label} · ${fallback ? "原始航拍" : "建成效果"}`);
      imageReady = !fallback;
      if (fallback) {
        $("asset-status").textContent = "效果图暂不可用，当前显示原始航拍。";
        $("asset-status").hidden = false;
      }
    } else {
      const original = await loadImage(selected.original);
      let rendered: string;
      try {
        rendered = await loadImage(selected.render);
      } catch {
        if (thisUpdate !== updateId) return;
        setImage($<HTMLImageElement>("base-image"), original, `${selected.label} · 原始航拍`);
        $("asset-status").textContent = "效果图暂不可用，当前显示原始航拍。";
        $("asset-status").hidden = false;
        $("loading-state").hidden = true;
        return;
      }
      if (thisUpdate !== updateId) return;
      setImage($<HTMLImageElement>("base-image"), original, `${selected.label} · 原始航拍`);
      setImage($<HTMLImageElement>("effect-image"), rendered, `${selected.label} · 建成效果`);
      $("comparison-layer").hidden = false;
      $("comparison-marker").hidden = false;
      $("image-labels").hidden = false;
      updateComparison();
      imageReady = true;
    }
    $("loading-state").hidden = true;
    $<HTMLButtonElement>("download-image").disabled = !imageReady;
  } catch {
    if (thisUpdate !== updateId) return;
    $("loading-message").textContent = "这张照片暂时无法加载，请重新加载或切换机位。";
    $("loading-state").classList.add("is-error");
    $("retry-image").hidden = false;
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    const nextView = button.dataset.view as View;
    if (nextView === view) return;
    view = nextView;
    void updateView();
  });
});
document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(button => {
  button.addEventListener("click", () => {
    const nextMode = button.dataset.mode as Mode;
    if (nextMode === mode) return;
    mode = nextMode;
    void updateView();
  });
});
const comparisonMarker = $("comparison-marker");
comparisonMarker.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0 || mode !== "compare" || !imageReady) return;
  comparisonDrag = { pointer: event.pointerId, startX: event.clientX, startAmount: comparison };
  comparisonMarker.focus({ preventScroll: true });
  comparisonMarker.setPointerCapture(event.pointerId);
  comparisonMarker.classList.add("is-dragging");
  event.preventDefault();
});
function moveComparison(event: PointerEvent) {
  if (comparisonDrag?.pointer !== event.pointerId) return;
  const width = $("image-frame").getBoundingClientRect().width;
  if (width > 0) setComparison(comparisonDrag.startAmount + (event.clientX - comparisonDrag.startX) / width * 100);
}
comparisonMarker.addEventListener("pointermove", moveComparison);
comparisonMarker.addEventListener("pointerup", (event) => {
  if (comparisonDrag?.pointer !== event.pointerId) return;
  moveComparison(event);
  endComparisonDrag();
});
comparisonMarker.addEventListener("pointercancel", endComparisonDrag);
comparisonMarker.addEventListener("lostpointercapture", endComparisonDrag);
comparisonMarker.addEventListener("keydown", (event) => {
  const amount = {
    ArrowLeft: comparison - (event.shiftKey ? 10 : 1), ArrowDown: comparison - 1,
    ArrowRight: comparison + (event.shiftKey ? 10 : 1), ArrowUp: comparison + 1,
    PageDown: comparison - 10, PageUp: comparison + 10, Home: 0, End: 100,
  }[event.key];
  if (amount === undefined) return;
  event.preventDefault();
  setComparison(amount);
});
$("retry-image").addEventListener("click", () => { void updateView(); });
$("download-image").addEventListener("click", async () => {
  if (!imageReady) return;
  const selected = views[view];
  const selectedMode = mode;
  const button = $<HTMLButtonElement>("download-image");
  button.disabled = true;
  try {
    if (selectedMode === "model" && model) {
      const url = await model.exportImage();
      download(url, `安化山居-${selected.label}-模型.png`);
    } else {
      const original = selectedMode === "original";
      const url = await loadImage(original ? selected.original : selected.render);
      download(url, `安化山居-${selected.label}-${original ? "原始航拍.jpg" : "建成效果.png"}`);
    }
    toast("已开始下载，也可以长按图片保存。");
  } catch {
    toast("图片暂时无法下载，请稍后重试。");
  } finally {
    button.disabled = !imageReady;
  }
});
window.addEventListener("pagehide", () => { model?.dispose(); model = null; });
window.addEventListener("pageshow", event => { if (event.persisted) void updateView(); });
void updateView();
