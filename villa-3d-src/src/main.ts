import "./style.css";
import { VillaViewer, defaultView, type CameraName } from "./viewer";
import { site, floors, facts, photos, annexRooms, buildingAreas } from "./data";
import { floorPlan, diningClearance } from "./plan";
import { surroundings } from "./surroundings";

const shapes: Record<string, string> = {
  house: '<path d="M3 10 12 3l9 7M5 9v12h14V9M10 21v-7h4v7"/>',
  aerial: '<path d="m3 9 9-5 9 5-9 5-9-5Zm0 6 9 5 9-5M3 12l9 5 9-5"/>',
  north: '<path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 8h1m6 0h1M8 11h1m6 0h1"/>',
  south: '<path d="m3 20 7-13 4 6 3-4 4 11H3Z"/><circle cx="17" cy="5" r="2"/>',
  courtyard: '<path d="M4 4h16v16H4zM8 8h8v8H8z"/>',
  garage:
    '<path d="m4 10 2-5h12l2 5M3 10h18v8H3zM6 18v3m12-3v3M6 13h2m8 0h2"/>',
  photo:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 6-5 4 4 3-3 5 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  reset: '<path d="M4 11a8 8 0 1 1 2 7M4 4v7h7"/>',
  save: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6"/>',
  arrow: '<path d="m14 5-7 7 7 7"/>',
  close: '<path d="m5 5 14 14M5 19 19 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] ?? shapes.info}</svg>`;
const check = (id: string, label: string, checked = false) =>
  `<label class="toggle-row"><span>${label}</span><input type="checkbox" id="${id}" ${checked ? "checked" : ""}/><span class="switch" aria-hidden="true"></span></label>`;
const cameraLabels: Record<string, string> = {
  aerial: "鸟瞰",
  north: "北立面",
  south: "南侧",
  courtyard: "院坪",
  garage: "地库",
};

document.querySelector("#app")!.innerHTML = `
  <header class="app-header">
    <a href="../docs/" class="brand" aria-label="安化山居，返回建房指南">${icon("house")}<strong>安化 · 山居</strong><span>实景别墅方案</span></a>
    <nav aria-label="查看模式" class="main-tabs">
      ${[
        ["model", "场地模型"],
        ["floor", "分层户型"],
        ["sun", "日照分析"],
        ["sources", "资料与校核"],
      ]
        .map(
          ([id, name]) =>
            `<button data-tab="${id}" class="${id === "model" ? "active" : ""}" aria-pressed="${id === "model"}">${name}</button>`,
        )
        .join("")}
    </nav>
    <a class="back-link" href="../docs/">${icon("arrow")}<span>返回建房指南</span></a>
  </header>
  <main class="workspace">
    <section class="stage" aria-label="方案查看区">
      <div id="viewport"></div>
      <div id="loading"><span class="spinner"></span><strong>正在构建山居场景</strong><span>加载地形、屋顶与楼层模型</span></div>
      <div class="scene-heading" id="scene-heading"><h1 id="scene-title">新建方案</h1><p id="scene-subtitle">依据航拍与已知尺寸重建 · 周边为估算</p></div>
      <div class="scene-tools" id="scene-tools">
        <button class="icon-button" id="reset-camera" aria-label="恢复当前视角" title="恢复视角">${icon("reset")}</button>
        <button class="icon-button" id="save-view" aria-label="保存当前模型图片" title="保存视图">${icon("save")}</button>
        <button class="icon-button" id="fullscreen" aria-label="全屏查看" title="全屏查看">${icon("expand")}</button>
      </div>
      <div class="photo-comparison" id="comparison" hidden><div><strong id="comparison-title"></strong><button id="photo-expand" class="icon-button" aria-label="放大航拍参考">${icon("expand")}</button><button id="close-comparison" class="icon-button" aria-label="关闭航拍对照">${icon("close")}</button></div><img id="comparison-img" alt="航拍对照"/><p id="comparison-note"></p></div>
      <div class="photo-strip" id="photo-strip" aria-label="航拍对照">${photos
        .slice(0, 3)
        .map(
          (p, i) =>
            `<button data-photo="${i}" title="${p.title}" aria-label="对照${p.title}"><img src="./photos/${p.file}" alt="${p.title}"/><span>${p.title}</span></button>`,
        )
        .join("")}</div>
      <div class="camera-bar" id="camera-bar" aria-label="预设视角">${Object.entries(
        cameraLabels,
      )
        .map(
          ([id, name]) =>
            `<button data-camera="${id}" aria-pressed="${id === "aerial"}" class="${id === "aerial" ? "active" : ""}">${icon(id)}<span>${name}</span></button>`,
        )
        .join("")}</div>
      <div class="compass" id="compass"><span>N</span><svg viewBox="0 0 52 52" aria-label="指北针"><circle cx="26" cy="26" r="23"/><g id="compass-arrow"><path d="m26 7 9 34-9-7-9 7Z"/></g></svg></div>
      <div id="plan-panel" class="plan-panel" hidden><div class="plan-toolbar"><div class="floor-pills">${floors.map((f, i) => `<button data-floor="${i}" class="${i === 0 ? "active" : ""}">${f.name}</button>`).join("")}</div><span>北 ↑ · 东 →</span></div><div class="plan-scroll" id="plan-drawing"></div><p class="plan-caption">点击房间查看说明。平面与3D共用尺寸、门窗及家具数据。</p></div>
      <article id="sources-panel" class="sources-panel" hidden><h1>设计依据与待核对事项</h1><p class="lead">把已经知道的、照片估算的和设计提出的分开记录，方便家人与现场一起核对。</p><div class="source-gallery">${photos.map((p, i) => `<button data-photo-modal="${i}"><img src="./photos/${p.file}" alt="${p.title}" loading="lazy"/><strong>${p.title}</strong><span>${p.note}</span></button>`).join("")}</div><h2>尺寸与证据</h2><div class="fact-list" id="fact-list"></div><h2>使用范围</h2><p>这是按现有照片与尺寸制作的方案模型。围护墙、楼梯、柱梁、挡土、排水、柴火烟道和邻居平台切除均需结合现场深化；模型没有代替结构施工图，也未认定宅基地审批范围。</p><p>太阳位置采用安化地区坐标和北京时间。周边树高、远山天际线与邻房标高未经测绘，日照结果只用于当前模型内的方案比较。</p><p class="source-links"><a href="https://manuals.lixiang.com/zh-cn/X012022MAX/20250916140616/topic-2022-702D4999-001.html" target="_blank" rel="noreferrer">2022款理想L9官方整车参数 ↗</a><a href="https://bsesc.energy.gov/energy-basics/natural-light-and-daylighting" target="_blank" rel="noreferrer">自然采光与遮阳原理 ↗</a><a href="../sunlight-3d/">原四季日照模拟器 ↗</a></p></article>
      <div class="sun-stamp" id="sun-stamp" hidden>${icon("sun")}<span id="sun-stamp-text"></span></div>
    </section>
    <aside class="inspector" aria-label="模型设置">
      <div id="model-controls">
        <section><h2>方案概览</h2><div class="segmented"><button data-existing="false" class="active" aria-pressed="true">新建</button><button data-existing="true" aria-pressed="false">现状</button></div><div class="area-number">180<span>m²</span></div><p class="area-caption">主楼 135 m² ＋ 辅楼 45 m²</p><p class="micro">主体首层投影 · 门厅另计 ${buildingAreas.portico.toFixed(1)} m²</p></section>
        <section><h2>模型显示</h2>${check("roof", "屋顶", true)}${check("dimensions", "尺寸标注")}${check("context", "周边环境", true)}${check("overlap", "主楼与地库重叠")}<label class="select-label">南侧阳台<select id="balcony"><option value="none">无连续后阳台 · 基准</option><option value="local">三楼局部浅阳台 · 1.2 m</option></select></label></section>
        <section><h2>关键尺寸</h2><dl class="metric-list"><div><dt>总面宽</dt><dd>21.1 m</dd></div><div><dt>主楼</dt><dd>13.5 × 10 m</dd></div><div><dt>辅楼</dt><dd>4.5 × 10 m</dd></div><div><dt>子孙道</dt><dd>1.5 m</dd></div><div><dt>三楼北退</dt><dd>1.8 m</dd></div><div><dt>门厅外伸</dt><dd>2.0 m</dd></div><div><dt>二楼前檐</dt><dd>0.70 m</dd></div><div><dt>三楼三面檐</dt><dd>0.80 m</dd></div><div><dt>右端人行通道</dt><dd>约 2 m</dd></div></dl></section>
        <button class="notice notice-button" id="open-garage">${icon("info")}<span><strong>地库入口待校核</strong><small>邻居木屋前的田已与两侧院坪拉平接通。<br/>原切口不在这块院坪上，通行仍待复核。</small></span><span>↗</span></button>
      </div>
      <div id="floor-controls" hidden>
        <section><h2>分层户型</h2><div class="segmented"><button data-plan-mode="2d" class="active">平面图</button><button data-plan-mode="3d">立体剖看</button></div><label class="select-label">选择楼层<select id="floor-select">${floors.map((f, i) => `<option value="${i}">${f.name} · ${i === 1 ? "3" : "2"}间卧室</option>`).join("")}</select></label>${check("explode", "楼层分离展示")}${check("chair-clearance", "餐厅拉椅范围", true)}</section>
        <section><h2 id="floor-summary-title">一层 · 2间卧室</h2><p id="floor-summary" class="description"></p><div id="room-detail" class="room-detail"><strong>点击图中的房间</strong><p>查看空间尺寸和设计说明。</p></div></section>
        <section><h2>餐厅使用检查</h2><p class="description">大圆桌直径2 m，12把椅子；小桌1.5 × 0.85 m，6把椅子。两桌同时摆入。</p><div class="notice"><span><strong>拉椅空间偏紧</strong><small id="dining-warning"></small></span></div><p class="micro">虚线按圆桌外1.85 m半径示意拉椅范围。12人满座时需调整桌径、位置或座椅形式，尚未满足宽松通行。</p></section>
      </div>
      <div id="sun-controls" hidden>
        <section><h2>四季日照</h2><p class="description">按真实朝北方向观察光线，重点比较南窗与屋后高田的遮挡。</p><div class="season-grid">${[
          ["03-20", "春分"],
          ["06-21", "夏至"],
          ["09-23", "秋分"],
          ["12-22", "冬至"],
        ]
          .map(
            ([date, name]) =>
              `<button data-season="${date}" class="${name === "秋分" ? "active" : ""}">${name}</button>`,
          )
          .join(
            "",
          )}</div><label class="select-label">日期<input type="date" id="sun-date" value="2026-09-23" min="2020-01-01" max="2100-12-31"/></label><div class="range-heading"><label for="sun-time">北京时间</label><output id="time-output">10:30</output></div><input type="range" id="sun-time" min="6" max="18" step="0.25" value="10.5"/><div class="range-ends"><span>06:00</span><span>12:00</span><span>18:00</span></div><dl class="metric-list"><div><dt>太阳高度角</dt><dd id="sun-alt"></dd></div><div><dt>方位角 · 北起顺时针</dt><dd id="sun-az"></dd></div></dl></section>
        <section><h2>后阳台对比</h2><select id="sun-balcony" aria-label="选择南侧阳台方案"><option value="none">无连续后阳台 · 基准</option><option value="local">三楼局部浅阳台 · 1.2 m</option></select><p class="micro">浅阳台位于三楼公共过厅外，两侧卧室南窗保持开敞。切换后视角与时间不变。</p><button class="primary-button" id="analyze-sun">计算两种方案的南窗遮挡</button><div id="sun-report" aria-live="polite"></div></section>
        <p class="micro">每半小时采样窗外竖向3点，显示直射光是否受阻；不是室内照度或法定日照时数。树木、邻房和地形为照片估算。</p>
      </div>
      <div id="garage-controls" hidden>
        <section><div class="section-heading"><h2>地库与入口</h2><button id="leave-garage" class="text-button">返回场地</button></div><div class="notice"><span><strong>路线示意 · 待校核</strong><small>左侧马路是连续上坡。亮色带子从这条路转入地库。木屋前地下室外侧已敞开，柱只在外沿和房前墙下。车身占位不代表L9可以完成通行。</small></span></div><dl class="metric-list"><div><dt>目标最低净高</dt><dd>2.50 m</dd></div><div><dt>预计入口净宽</dt><dd>2.50 m</dd></div><div><dt>L9车身 · 不含镜</dt><dd>1.998 m</dd></div><div><dt>居中直行单侧余量</dt><dd>约 25 cm</dd></div></dl></section>
        <section><h2>坡道参数探索</h2><p class="micro">以下初值是示意值，不是由邻居地下室净高推算的道路标高。左侧马路按连续上坡，中间没有平台阶。院坪暂定±0.000。</p><label class="select-label">接入处道路标高 · 示意（m）<input type="number" id="road-level" value="${surroundings.road.entryY.toFixed(2)}" step="0.1" min="-3.8" max="0"/></label><label class="select-label">坡道投影长度 · 示意（m）<input type="number" id="ramp-length" value="5" step="0.5" min="3" max="10"/></label><p class="calculation" id="ramp-result"></p><p class="micro">梁板占用暂0.45 m → 地库地面−2.95 m。坡道折点、底盘离地和相邻基础均未验算。</p></section>
        <section><div class="range-heading"><label for="route-progress">车辆沿示意路线移动</label><output id="route-output">0%</output></div><input type="range" id="route-progress" min="0" max="100" value="0" step="1"/><p id="route-status" class="description" aria-live="polite"></p><p class="micro">拖动滑杆，车辆沿亮色带子从左侧上坡马路转入地库。带子上有箭头和“左侧上坡路 / 转入地库 / 地库内”标记。转弯、含镜宽和净高仍待校核。</p></section>
      </div>
      <div id="sources-controls" hidden><section><h2>证据状态</h2><ul class="evidence-legend"><li><i class="e-user"></i>用户提供</li><li><i class="e-photo"></i>照片估算</li><li><i class="e-design"></i>设计建议</li><li><i class="e-pending"></i>待测 / 待校核</li></ul>${check("pending-only", "只看待补测项目")}</section><section><h2>下一步现场补测</h2><ol class="measure-list"><li>道路、邻居院坪与旧房前坪的高差。</li><li>切口、保留柱墙及可用坡道的平面尺寸。</li><li>L9含镜宽、转弯参数和第二辆车车型。</li><li>地块转折点、屋后田坎及邻居屋檐位置。</li></ol></section><button class="secondary-button" id="download-data">下载当前方案参数</button></div>
    </aside>
  </main>
  <footer class="app-footer"><span id="interaction-hint">拖动旋转 · 滚轮缩放 · 右键平移</span><span>湖南 · 安化　/　概念方案 02</span><a href="#" id="footer-sources">查看数据依据 ↗</a></footer>
  <dialog id="photo-modal"><form method="dialog"><button class="icon-button" aria-label="关闭图片">${icon("close")}</button></form><img id="modal-img" alt="现场参考"/><div><h2 id="modal-title"></h2><p id="modal-note"></p><button id="match-photo" class="secondary-button">按此照片方向观察模型</button></div></dialog>
  <dialog id="export-modal"><form method="dialog"><button class="icon-button" aria-label="关闭导出预览">${icon("close")}</button></form><img id="export-image" alt="当前模型视图导出预览"/><div><h2>当前模型视图</h2><p>保存的是当前3D模型画面。也可右键或长按图片保存。</p><a id="export-download" class="secondary-button" download="安化山居.png">下载 PNG 图片</a></div></dialog>
  <div id="toast" role="status" hidden></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let viewer: VillaViewer | null = null;
let tab = "model",
  level = 0,
  planMode = "2d",
  photoIndex = 0;
let camera: CameraName = "aerial",
  isExisting = false,
  balcony = false;
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 3500);
}
function active(selector: string, matches: (button: HTMLElement) => boolean) {
  document.querySelectorAll<HTMLElement>(selector).forEach((b) => {
    const yes = matches(b);
    b.classList.toggle("active", yes);
    b.setAttribute("aria-pressed", String(yes));
  });
}
const checked = (id: string) => $<HTMLInputElement>(id).checked;
function renderFacts() {
  $("fact-list").innerHTML = facts
    .filter((f) => !checked("pending-only") || f.source === "待测")
    .map(
      (f) =>
        `<div class="fact-row"><div><strong>${f.label}</strong><span class="evidence ${f.source === "用户提供" ? "user" : f.source === "照片估算" ? "photo" : f.source === "设计建议" ? "design" : "pending"}">${f.source}</span></div><b>${f.value}</b><p>${f.note}</p></div>`,
    )
    .join("");
}
function drawPlan() {
  $("plan-drawing").innerHTML = floorPlan(
    level,
    checked("chair-clearance"),
    balcony,
  );
  active("[data-floor]", (b) => Number(b.dataset.floor) === level);
  $<HTMLSelectElement>("floor-select").value = String(level);
  $("floor-summary-title").textContent =
    `${floors[level].name} · ${level === 1 ? 3 : 2}间卧室`;
  $("floor-summary").textContent = [
    "老人房设独卫；西南侧客厅挑空，与堂屋连通。辅楼集中做饭与聚餐。",
    "西侧客厅上方保留挑空；3间卧室，公共卫生间与楼梯通过走廊连接。",
    "北侧退让1.8米，形成露台；2间南向卧室与家庭厅，南侧公共过厅可对比浅阳台。",
  ][level];
  $("room-detail").innerHTML =
    "<strong>点击图中的房间</strong><p>查看空间尺寸和设计说明。</p>";
}
function updateScene() {
  const garage = tab === "model" && camera === "garage";
  const floor3d = tab === "floor" && planMode === "3d";
  const plan = tab === "floor" && planMode === "2d";
  if (plan || tab === "sources") $("loading").hidden = true;
  $("viewport").hidden = plan || tab === "sources";
  $("plan-panel").hidden = !plan;
  $("sources-panel").hidden = tab !== "sources";
  $("scene-heading").hidden = plan || tab === "sources";
  $("scene-tools").hidden = plan || tab === "sources";
  $("compass").hidden = plan || tab === "sources";
  $("photo-strip").hidden = tab !== "model";
  $("camera-bar").hidden = tab === "sources" || tab === "floor";
  $("sun-stamp").hidden = tab !== "sun";
  document.querySelector<HTMLElement>('[data-camera="garage"]')!.hidden =
    tab === "sun";
  $<HTMLInputElement>("roof").disabled = isExisting && tab === "model";
  $<HTMLSelectElement>("balcony").disabled = isExisting && tab === "model";
  for (const p of ["model", "floor", "sun", "garage", "sources"])
    $(`${p}-controls`).hidden =
      p === "model"
        ? tab !== "model" || garage
        : p === "garage"
          ? !garage
          : tab !== p;
  if (tab !== "model") $("comparison").hidden = true;
  viewer?.setState({
    existing: isExisting && tab === "model",
    roof: checked("roof"),
    dimensions: checked("dimensions"),
    context: checked("context"),
    balcony,
    floor: floor3d ? level : null,
    exploded: floor3d && checked("explode"),
    garage,
    overlap: checked("overlap"),
  });
  $("scene-title").textContent = garage
    ? "地库空间与露天入口"
    : floor3d
      ? `${floors[level].name} · 立体剖看`
      : tab === "sun"
        ? "南侧日照与遮挡"
        : isExisting
          ? "老房现状"
          : "新建方案";
  $("scene-subtitle").textContent = garage
    ? "院坪与主楼隐藏 · 柱梁、车位和路线均为示意"
    : floor3d
      ? checked("explode")
        ? "楼层竖向分离展示 · 不改变实际层高"
        : "显示本层与真实门窗 · 其他楼层隐藏"
      : "依据航拍与已知尺寸重建 · 周边为估算";
  $("interaction-hint").textContent = plan
    ? "点击房间查看说明 · 小屏可横向滚动图纸"
    : "拖动旋转 · 滚轮缩放 · 右键平移";
  if (tab === "floor") drawPlan();
}
function switchTab(name: string) {
  tab = name;
  active("[data-tab]", (b) => b.dataset.tab === tab);
  if (tab === "floor") {
    updateScene();
    if (planMode === "3d" && !checked("explode")) viewer?.setCamera("top");
  } else {
    if (tab === "sun") camera = "south";
    if (tab === "model" && camera === "top") camera = "aerial";
    updateScene();
    viewer?.setCamera(camera);
  }
  active("[data-camera]", (b) => b.dataset.camera === camera);
}
function setCamera(name: CameraName) {
  camera = name;
  if (name === "garage") {
    isExisting = false;
    active("[data-existing]", (b) => b.dataset.existing === "false");
  }
  updateScene();
  viewer?.setCamera(name);
  active("[data-camera]", (b) => b.dataset.camera === name);
}
function timeText(hour: number) {
  return `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;
}
function updateSun() {
  const date = $<HTMLInputElement>("sun-date").value,
    hour = Number($<HTMLInputElement>("sun-time").value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const pos = viewer?.setSun(date, hour);
  $("time-output").textContent = timeText(hour);
  $("sun-stamp-text").textContent = `${date}　${timeText(hour)}　北京时间`;
  if (pos) {
    $("sun-alt").textContent = `${pos.altitude.toFixed(1)}°`;
    $("sun-az").textContent = `${pos.azimuth.toFixed(1)}°`;
  }
  active("[data-season]", (b) => date.endsWith(b.dataset.season!));
}
function updateRamp() {
  const roadY = Number($<HTMLInputElement>("road-level").value),
    len = Number($<HTMLInputElement>("ramp-length").value);
  if (
    !$<HTMLInputElement>("road-level").value ||
    !Number.isFinite(roadY) ||
    roadY < -3.8 ||
    roadY > 0 ||
    !Number.isFinite(len) ||
    len < 3 ||
    len > 10
  ) {
    $("ramp-result").textContent =
      "请输入有效范围：道路−3.8～0米，坡长3～10米。";
    return;
  }
  viewer?.updateRamp(roadY, len);
  const grade = ((roadY - site.garageFloor) / len) * 100;
  $("ramp-result").textContent =
    `示意高差 ${Math.abs(roadY - site.garageFloor).toFixed(2)} m / ${len.toFixed(1)} m → ${grade >= 0 ? "下坡" : "上坡"} ${Math.abs(grade).toFixed(1)}%`;
  updateRoute();
}
function updateRoute() {
  const n = Number($<HTMLInputElement>("route-progress").value);
  $("route-output").textContent = `${n}%`;
  const result = viewer?.routeAt(n);
  if (result) $("route-status").textContent = result.note;
}
function openPhoto(index: number, modal = false) {
  photoIndex = index;
  const p = photos[index];
  if (modal) {
    $<HTMLImageElement>("modal-img").src = `./photos/${p.file}`;
    $<HTMLImageElement>("modal-img").alt = p.title;
    $("modal-title").textContent = p.title;
    $("modal-note").textContent = p.note;
    $<HTMLDialogElement>("photo-modal").showModal();
  } else {
    $<HTMLImageElement>("comparison-img").src = `./photos/${p.file}`;
    $<HTMLImageElement>("comparison-img").alt = p.title;
    $("comparison-title").textContent = p.title;
    $("comparison-note").textContent = `${p.note} · 方向参考，非相机精确配准`;
    $("comparison").hidden = false;
  }
}

document.addEventListener("click", (event) => {
  const el = (event.target as Element).closest<HTMLElement>(
    "button, [data-room]",
  );
  if (!el) return;
  if (el.dataset.tab) switchTab(el.dataset.tab);
  if (el.dataset.camera) setCamera(el.dataset.camera as CameraName);
  if (el.dataset.existing) {
    isExisting = el.dataset.existing === "true";
    if (isExisting && camera === "garage") camera = "aerial";
    active("[data-existing]", (b) => b === el);
    updateScene();
    viewer?.setCamera(camera);
  }
  if (el.dataset.floor) {
    level = Number(el.dataset.floor);
    updateScene();
    if (planMode === "3d" && !checked("explode")) viewer?.setCamera("top");
  }
  if (el.dataset.planMode) {
    planMode = el.dataset.planMode;
    active("[data-plan-mode]", (b) => b === el);
    updateScene();
    if (planMode === "3d" && !checked("explode")) viewer?.setCamera("top");
  }
  if (el.dataset.photo) openPhoto(Number(el.dataset.photo));
  if (el.dataset.photoModal) openPhoto(Number(el.dataset.photoModal), true);
  if (el.dataset.season) {
    $<HTMLInputElement>("sun-date").value = `2026-${el.dataset.season}`;
    $("sun-report").innerHTML = "";
    updateSun();
  }
  if (el.dataset.room) {
    const room = [...floors[level].rooms, ...annexRooms].find(
      (r) => r.id === el.dataset.room,
    )!;
    $("room-detail").innerHTML =
      `<strong>${room.name}</strong><p>${room.w.toFixed(1)} × ${room.d.toFixed(1)} m · 外轮廓</p><p>${room.note ?? (room.kind === "bed" ? "卧室保留独立门窗；家具为尺度参考。" : "空间布置为概念方案，需结合结构与门窗进一步深化。")}</p>`;
    document
      .querySelectorAll("[data-room]")
      .forEach((r) => r.classList.toggle("selected", r === el));
  }
});
document.addEventListener("keydown", (e) => {
  const el = (e.target as Element).closest<HTMLElement>("[data-room]");
  if (el && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    el.click();
  }
});
for (const id of ["roof", "dimensions", "context", "overlap"])
  $(id).addEventListener("change", updateScene);
for (const id of ["balcony", "sun-balcony"])
  $(id).addEventListener("change", () => {
    balcony = $<HTMLSelectElement>(id).value === "local";
    $<HTMLSelectElement>("balcony").value = $<HTMLSelectElement>(
      "sun-balcony",
    ).value = balcony ? "local" : "none";
    updateScene();
  });
$("floor-select").addEventListener("change", () => {
  level = Number($<HTMLSelectElement>("floor-select").value);
  updateScene();
  if (planMode === "3d" && !checked("explode")) viewer?.setCamera("top");
});
$("explode").addEventListener("change", () => {
  if (checked("explode")) {
    planMode = "3d";
    active("[data-plan-mode]", (b) => b.dataset.planMode === "3d");
  }
  updateScene();
});
$("chair-clearance").addEventListener("change", drawPlan);
$("sun-date").addEventListener("change", () => {
  $("sun-report").innerHTML = "";
  updateSun();
});
$("sun-time").addEventListener("input", updateSun);
$("analyze-sun").addEventListener("click", async () => {
  const b = $<HTMLButtonElement>("analyze-sun");
  if (!viewer || !$<HTMLInputElement>("sun-date").value) return;
  b.disabled = true;
  b.textContent = "正在计算遮挡…";
  $("sun-report").setAttribute("aria-busy", "true");
  await new Promise((resolve) => setTimeout(resolve, 40));
  try {
    const rows = viewer.analyzeSun($<HTMLInputElement>("sun-date").value);
    $("sun-report").innerHTML =
      `<div class="sun-report-legend"><span><i></i>有直射点</span><span><i></i>全部受遮挡</span></div>${rows.map((r) => `<div class="sun-row"><strong>${r.name}</strong>${(["plain", "balcony"] as const).map((key) => `<div class="sun-sample-row"><span>${key === "plain" ? "无阳台" : "浅阳台"}</span><div class="sun-samples">${r.samples.map((s) => `<i style="--lit:${s[key] / 3}" title="${timeText(s.hour)} · ${s[key]}/3点有直射光"></i>`).join("")}</div></div>`).join("")}</div>`).join("")}<div class="sample-axis"><span>07:00</span><span>12:00</span><span>17:00</span></div><p class="micro">颜色为当前模型采样结果，不包含天气、室内反射光和未测绘远山的精确遮挡。</p>`;
  } catch {
    $("sun-report").textContent = "本次计算未完成，请重试。";
  } finally {
    b.disabled = false;
    b.textContent = "重新计算南窗遮挡";
    $("sun-report").removeAttribute("aria-busy");
  }
});
$("open-garage").addEventListener("click", () => setCamera("garage"));
$("leave-garage").addEventListener("click", () => setCamera("aerial"));
for (const id of ["road-level", "ramp-length"])
  $(id).addEventListener("input", updateRamp);
$("route-progress").addEventListener("input", updateRoute);
$("reset-camera").addEventListener("click", () =>
  viewer?.setCamera(tab === "floor" ? "top" : camera),
);
$("save-view").addEventListener("click", () => {
  if (viewer) {
    const data = viewer.exportImage();
    $<HTMLImageElement>("export-image").src = data;
    $<HTMLAnchorElement>("export-download").href = data;
    $<HTMLAnchorElement>("export-download").download =
      `安化山居-${viewer.activeCamera}.png`;
    $<HTMLDialogElement>("export-modal").showModal();
  }
});
$("fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast("当前浏览器不支持全屏，请使用浏览器缩放。");
  }
});
$("close-comparison").addEventListener("click", () => {
  $("comparison").hidden = true;
});
$("photo-expand").addEventListener("click", () => openPhoto(photoIndex, true));
$("match-photo").addEventListener("click", () => {
  $<HTMLDialogElement>("photo-modal").close();
  switchTab("model");
  setCamera(photos[photoIndex].camera as CameraName);
  openPhoto(photoIndex);
});
$("pending-only").addEventListener("change", renderFacts);
$("footer-sources").addEventListener("click", (e) => {
  e.preventDefault();
  switchTab("sources");
});
$("download-data").addEventListener("click", () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          description: "概念模型参数，不能作为测绘或施工图使用。",
          units: "m",
          axes: "X东 Y上 Z南；旧前坪外缘Z=0",
          site,
          buildingAreas,
          surroundings,
          facts,
          floors,
          preview: {
            roadY: viewer?.roadY,
            rampLength: viewer?.rampLength,
            roadAndRampEvidence: "设计示意，未测",
            balcony,
          },
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "安化山居-方案参数.json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
renderFacts();
drawPlan();
const clear = diningClearance();
$("dining-warning").textContent =
  `按当前拉椅包络，西侧余量${clear.west.toFixed(2)} m、北侧${clear.north.toFixed(2)} m；东侧仅${clear.east.toFixed(2)} m。两桌拉椅包络局部相交，满座上菜需错让。`;
await new Promise((resolve) => requestAnimationFrame(resolve));
try {
  viewer = new VillaViewer($("viewport"));
  viewer.onCompass = (angle) =>
    $("compass-arrow").setAttribute(
      "transform",
      `rotate(${(angle * 180) / Math.PI} 26 26)`,
    );
  viewer.onContextLoss = () => {
    $("loading").hidden = false;
    $("loading").innerHTML =
      "<strong>图形上下文已中断</strong><p>请刷新页面恢复3D；仍可查看分层平面与资料。</p>";
  };
  updateSun();
  updateRamp();
  updateScene();
  $("loading").hidden = true;
} catch (error) {
  console.error(error);
  $("loading").innerHTML =
    "<strong>当前环境未能启动3D</strong><p>请在支持WebGL2的浏览器打开。分层平面与资料仍可查看。</p>";
  toast("3D加载失败，平面图与资料可以继续查看。");
}
