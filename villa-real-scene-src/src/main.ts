import "./style.css";

type View = "front" | "aerial";
type Mode = "render" | "original" | "compare" | "model";
type ModelController = {
  setView(view: View): void;
  exportImage(): string | Promise<string>;
  dispose(): void;
};

const views: Record<View, { label: string; original: string; render: string; number: string }> = {
  front: {
    label: "近景正面",
    original: "./photos/front-original.jpg",
    render: "./photos/front-render.png",
    number: "01",
  },
  aerial: {
    label: "全景航拍",
    original: "./photos/aerial-original.jpg",
    render: "./photos/aerial-render.png",
    number: "02",
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
    <div class="brand">${icon("house")}<strong>安化<span>·</span>山居</strong><span class="brand-divider" aria-hidden="true"></span><span class="edition">实景效果第一版</span></div>
    <a class="original-model-link" href="../villa-3d/" target="_blank" rel="noopener">打开原模型 ${icon("arrow")}</a>
  </header>
  <main class="workspace">
    <div class="toolbar">
      <fieldset class="view-picker"><legend>选择机位</legend><div class="view-buttons">
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
          <div class="comparison-marker" id="comparison-marker" hidden aria-hidden="true"><span>${icon("move")}</span></div>
          <div id="image-labels" class="image-labels" hidden aria-hidden="true"><span>原始航拍</span><span>建成效果</span></div>
          <div class="loading-state" id="loading-state" role="status"><span class="loading-dot" aria-hidden="true"></span><strong id="loading-message">正在加载实景画面</strong><button type="button" class="retry-button" id="retry-image" hidden>重新加载</button></div>
        </div>
        <div id="model-host" class="model-host" hidden></div>
      </div>
      <div class="viewer-caption">
        <div class="caption-title"><span class="view-number" id="view-number">01</span><h1 id="view-title">近景正面</h1><span class="mode-caption" id="mode-caption">建成效果</span></div>
        <p id="view-hint">保留原航拍环境，观察别墅建成后的外观与周边关系。</p>
      </div>
      <div class="comparison-controls" id="comparison-controls" hidden>
        <div class="comparison-heading"><label for="comparison-range">拖动查看前后变化</label><output id="comparison-output" for="comparison-range">50%</output></div>
        <input type="range" id="comparison-range" min="0" max="100" step="1" value="50" aria-label="原始航拍显示比例" aria-valuetext="原始航拍 50%，建成效果 50%" />
        <div class="range-labels"><span>全部效果</span><span>全部原片</span></div>
      </div>
      <p id="asset-status" class="asset-status" role="status" hidden></p>
    </section>
    <footer class="page-footer"><span>湖南 · 安化</span><p>根据现有方案与航拍制作，场地落位为估算；实景合成可能存在细节偏差，以原模型为准。</p></footer>
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
  const amount = Number($<HTMLInputElement>("comparison-range").value);
  $("image-frame").style.setProperty("--comparison", `${amount}%`);
  $("comparison-output").textContent = `原片 ${amount}%`;
  const labels = $("image-labels").children;
  (labels[0] as HTMLElement).style.visibility = amount === 0 ? "hidden" : "visible";
  (labels[1] as HTMLElement).style.visibility = amount === 100 ? "hidden" : "visible";
  $<HTMLInputElement>("comparison-range").setAttribute("aria-valuetext", `原始航拍 ${amount}%，建成效果 ${100 - amount}%`);
}

function updateSelection() {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  });
  $("view-number").textContent = views[view].number;
  $("view-title").textContent = views[view].label;
  $("mode-caption").textContent = modes[mode];
  $("view-hint").textContent = {
    render: "保留原航拍环境，观察别墅建成后的外观与周边关系。",
    original: "原始现场照片，可对照道路、邻房与梯田的位置。",
    compare: "以原航拍机位制作的合成预览。滑杆支持方向键、Home 和 End。",
    model: "拖动旋转 · 滚轮或双指缩放 · 右键平移",
  }[mode];
  $("download-image").querySelector("span")!.textContent = mode === "model" ? "下载模型截图" : mode === "original" ? "下载原始航拍" : "下载建成效果";
}

function showLoading(message: string) {
  $("loading-message").textContent = message;
  $("loading-state").classList.remove("is-error");
  $("loading-state").hidden = false;
  $("retry-image").hidden = true;
}

async function updateView() {
  const thisUpdate = ++updateId;
  imageReady = false;
  updateSelection();
  $<HTMLButtonElement>("download-image").disabled = true;
  $("asset-status").hidden = true;
  $("comparison-controls").hidden = true;
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
        $("asset-status").textContent = "这张效果图正在准备，当前先显示原始航拍。完成后刷新即可查看。";
        $("asset-status").hidden = false;
        $("mode-caption").textContent = "原片预览";
      }
    } else {
      const original = await loadImage(selected.original);
      let rendered: string;
      try {
        rendered = await loadImage(selected.render);
      } catch {
        if (thisUpdate !== updateId) return;
        setImage($<HTMLImageElement>("base-image"), original, `${selected.label} · 原始航拍`);
        $("asset-status").textContent = "这张效果图正在准备，暂时不能前后对比。当前显示原始航拍。";
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
      $("comparison-controls").hidden = false;
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
$("comparison-range").addEventListener("input", updateComparison);
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
