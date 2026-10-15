import "./style.css";
import { VillaViewer, defaultView, type CameraName } from "./viewer";
import { site, floors, facts, photos, annexRooms, buildingAreas } from "./data";
import { floorPlan, diningClearance } from "./plan";
import { roofPitch } from "./architecture";
import { surroundings } from "./surroundings";
import { garageLayout } from "./garage-layout";
import { formatRouteRanges, routeRanges, type SweepCell } from "./vehicle-route";
import { bedroomSummary, roomReference, type DesignIssue } from "./design-data";
import { mountDesignReview } from "./design-review";
import { viewFlags, type CameraPose, type MeetingView } from "./design-session";
import { projectMeta, escapeHtml } from "./project-meta";

const shapes: Record<string, string> = {
  house: '<path d="M3 10 12 3l9 7M5 9v12h14V9M10 21v-7h4v7"/>',
  aerial: '<path d="m3 9 9-5 9 5-9 5-9-5Zm0 6 9 5 9-5M3 12l9 5 9-5"/>',
  north: '<path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 8h1m6 0h1M8 11h1m6 0h1"/>',
  south: '<path d="m3 20 7-13 4 6 3-4 4 11H3Z"/><circle cx="17" cy="5" r="2"/>',
  courtyard: '<path d="M4 4h16v16H4zM8 8h8v8H8z"/>',
  garage:
    '<path d="m4 10 2-5h12l2 5M3 10h18v8H3zM6 18v3m12-3v3M6 13h2m8 0h2"/>',
  roadside: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7M7 10h2m6 0h2M7 13h2m6 0h2M4 17h4m8 0h4"/>',
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
  roadside: "蓝顶邻房",
};

document.querySelector("#app")!.innerHTML = `
  <header class="app-header">
    <a href="../docs/" class="brand" aria-label="安化山居，返回建房指南">${icon("house")}<strong>安化 · 山居</strong><span>实景别墅方案</span></a>
    <nav aria-label="查看模式" class="main-tabs">
      ${[
        ["model", "场地模型"],
        ["floor", "分层户型"],
        ["sun", "日照分析"],
        ["real", "实景"],
        ["design", "设计沟通"],
        ["sources", "资料与校核"],
      ]
        .map(
          ([id, name]) =>
            `<button data-tab="${id}" ${id === "real" ? 'title="合成参考，未同步最新方案；尺寸以场地模型为准。"' : ""} class="${id === "model" ? "active" : ""}" aria-pressed="${id === "model"}">${name}</button>`,
        )
        .join("")}
    </nav>
    <a class="back-link" href="../docs/">${icon("arrow")}<span>返回建房指南</span></a>
  </header>
  <main class="workspace">
    <section class="stage" aria-label="方案查看区">
      <div id="viewport"></div>
      <div id="loading"><span class="spinner"></span><strong>正在构建山居场景</strong><span>加载地形、屋顶与楼层模型</span></div>
      <div class="scene-tools" id="scene-tools">
        <button class="icon-button" id="reset-camera" aria-label="恢复当前视角" title="恢复视角">${icon("reset")}</button>
        <button class="icon-button" id="save-view" aria-label="保存当前模型图片" title="保存视图">${icon("save")}</button>
        <button class="icon-button" id="record-view" aria-label="记录当前机位和参数为会议快照" title="记录会议快照">${icon("check")}</button>
        <button class="icon-button" id="fullscreen" aria-label="全屏查看" title="全屏查看">${icon("expand")}</button>
      </div>
      <div class="photo-comparison" id="comparison" hidden><div><strong id="comparison-title"></strong><button id="photo-expand" class="icon-button" aria-label="放大航拍参考">${icon("expand")}</button><button id="close-comparison" class="icon-button" aria-label="关闭航拍对照">${icon("close")}</button></div><img id="comparison-img" alt="航拍对照"/><p id="comparison-note"></p></div>
      <div class="photo-strip" id="photo-strip" aria-label="航拍对照">${photos
        .slice(0, 4)
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
      <div id="plan-panel" class="plan-panel" hidden><div class="plan-toolbar"><div class="floor-pills">${floors.map((f, i) => `<button data-floor="${i}" class="${i === 0 ? "active" : ""}">${f.name}</button>`).join("")}</div><span>北 ↑ · 东 →</span></div><div class="plan-scroll" id="plan-drawing"></div><p class="plan-caption">点击房间查看口径。内侧约值和0.60m家具留位均为讨论参考，非实测或通行结论；北向上，东向右。</p></div>
      <article id="sources-panel" class="sources-panel" hidden><h1>设计依据与待核对事项</h1><p class="lead">把已经知道的、照片估算的和设计提出的分开记录，方便家人与现场一起核对。</p><div class="source-gallery">${photos.map((p, i) => `<button data-photo-modal="${i}"><img src="./photos/${p.file}" alt="${p.title}" loading="lazy"/><strong>${p.title}</strong><span>${p.note}</span></button>`).join("")}</div><h2>尺寸与证据</h2><div class="fact-list" id="fact-list"></div><h2>使用范围</h2><p>这是按现有照片与尺寸制作的方案模型。围护墙、楼梯、柱梁、挡土、排水、柴火烟道和邻居平台切除均需结合现场深化；模型没有代替结构施工图，也未认定宅基地审批范围。</p><p>太阳位置采用安化地区坐标和北京时间。周边树高、远山天际线与邻房标高未经测绘，日照结果只用于当前模型内的方案比较。</p><p class="source-links"><a href="https://manuals.lixiang.com/zh-cn/X012022MAX/20250916140616/topic-2022-702D4999-001.html" target="_blank" rel="noreferrer">2022款理想L9官方整车参数 ↗</a><a href="https://bsesc.energy.gov/energy-basics/natural-light-and-daylighting" target="_blank" rel="noreferrer">自然采光与遮阳原理 ↗</a><a href="../sunlight-3d/">原四季日照模拟器 ↗</a></p></article>
      <div class="sun-stamp" id="sun-stamp" hidden>${icon("sun")}<span id="sun-stamp-text"></span></div>
    </section>
    <section id="real-scene-panel" class="real-scene-panel" aria-label="实景效果" aria-description="合成参考，未同步最新方案；尺寸以场地模型为准。" hidden>
      <iframe id="real-scene-frame" title="安化山居实景效果与原片对比" allow="fullscreen"></iframe>
    </section>
    <section id="design-panel" class="design-panel" aria-label="设计沟通资料" hidden></section>
    <aside class="inspector" aria-label="模型设置">
      <div class="scene-heading" id="scene-heading"><h1 id="scene-title">新建方案</h1><p id="scene-subtitle">依据航拍与已知尺寸重建 · 周边为估算</p></div>
      <div id="model-controls">
        <section><h2>方案概览</h2><div class="segmented"><button data-existing="false" class="active" aria-pressed="true">新建</button><button data-existing="true" aria-pressed="false">现状</button></div><div class="area-number">180<span>m²</span></div><p class="area-caption">主楼 135 m² ＋ 辅楼 45 m²</p><p class="micro">主体首层投影 · 门厅另计 ${buildingAreas.portico.toFixed(1)} m²</p></section>
        <section><h2>模型显示</h2>${check("roof", "屋顶", true)}${check("dimensions", "尺寸标注")}${check("context", "周边环境", true)}${check("main-building", "主楼", true)}${check("annex-building", "辅楼", true)}${check("neighbor-side", "左侧邻居房子", true)}${check("neighbor-rear", "屋后邻居房子", true)}${check("neighbor-front", "前面邻居房子", true)}${check("neighbor-roadside", "马路边蓝顶邻房", true)}${check("overlap", "主楼与地库重叠")}<label class="select-label">南侧阳台<select id="balcony"><option value="none">无连续后阳台 · 基准</option><option value="local">三楼局部浅阳台 · 1.2 m</option></select></label></section>
        <section><h2>屋面坡度</h2><p class="micro">分水＝水平10对应的升高。主辅楼同步调整，官帽脊与主楼齐平。</p><div class="range-heading"><label for="fen-shui">分水</label><output id="fen-shui-output">${site.roofFenShui.toFixed(1)}</output></div><input type="range" id="fen-shui" min="1" max="10" step="0.1" value="${site.roofFenShui}"/><label class="select-label">直接输入<input type="number" id="fen-shui-number" min="1" max="10" step="0.1" value="${site.roofFenShui}"/></label><p class="calculation" id="fen-shui-result"></p></section>
        <section><h2>关键尺寸</h2><dl class="metric-list"><div><dt>总面宽</dt><dd>21.1 m</dd></div><div><dt>主楼</dt><dd>13.5 × 10 m</dd></div><div><dt>辅楼</dt><dd>4.5 × 10 m</dd></div><div><dt>子孙道</dt><dd>1.5 m</dd></div><div><dt>三楼北退</dt><dd>1.8 m</dd></div><div><dt>门厅外伸</dt><dd>2.0 m</dd></div><div><dt>二楼前檐</dt><dd>0.70 m</dd></div><div><dt>三楼三面檐</dt><dd>0.80 m</dd></div><div><dt>右端人行通道</dt><dd>约 2 m</dd></div></dl></section>
        <button class="notice notice-button" id="open-garage">${icon("info")}<span><strong>地库车辆路线待校核</strong><small>查看车身扫掠、净高待核区与柱墙潜在冲突。<br/>道路与梁底待测，切口协商待确认。</small></span><span>↗</span></button>
      </div>
      <div id="floor-controls" hidden>
        <section><h2>分层户型</h2><div class="segmented"><button data-plan-mode="2d" class="active">平面图</button><button data-plan-mode="3d">立体剖看</button></div><fieldset id="floor-select" class="floor-choices"><legend>选择楼层</legend><div>${floors.map((f, i) => `<label><input type="radio" name="floor" value="${i}" ${i === 0 ? "checked" : ""}/><span><strong>${f.name}</strong><small>${bedroomSummary(i)}</small></span></label>`).join("")}</div></fieldset>${check("explode", "楼层分离展示")}${check("chair-clearance", "餐厅拉椅范围", true)}${check("room-inside", "模型内侧参考尺寸", true)}${check("room-clearance", "家具使用讨论留位")}<label class="select-label">餐厅平面情景<select id="dining-mode"><option value="full">双桌满座 · 18座／偏紧</option><option value="daily">日常建议 · 小桌6座</option></select></label><button class="secondary-button" data-design-issue="D08">记录房间深化意见 ↗</button></section>
        <section><h2 id="floor-summary-title">一层 · 1间卧室＋1间用途待定</h2><p id="floor-summary" class="description"></p><div id="room-detail" class="room-detail" hidden></div></section>
        <section id="dining-check"><h2>餐厅满座</h2><p class="description">圆桌12座＋小桌6座。</p><div class="notice"><span><strong>拉椅空间偏紧</strong><small id="dining-warning"></small></span></div></section>
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
        <section><h2>后阳台对比</h2><select id="sun-balcony" aria-label="选择南侧阳台方案"><option value="none">无连续后阳台 · 基准</option><option value="local">三楼局部浅阳台 · 1.2 m</option></select><p class="micro">浅阳台仅在三楼公共过厅外，卧室南窗保持开敞。</p><button class="primary-button" id="analyze-sun">计算两种方案的南窗遮挡</button><div id="sun-report" aria-live="polite"></div></section>
        <p class="micro">每半小时采样窗外竖向3点，显示直射光是否受阻；不是室内照度或法定日照时数。树木、邻房和地形为照片估算。</p>
      </div>
      <div id="garage-controls" hidden>
        <section>
          <div class="section-heading"><h2>地库与入口</h2><button id="leave-garage" class="text-button">返回场地</button></div>
          <div class="notice"><span><strong>车辆路线 · 通行未确认</strong><small>道路与最低梁底待测，切口协商待确认；当前仅作模型平面筛查。</small></span></div>
          <dl class="metric-list">
            <div><dt>地库最低净高目标</dt><dd>${site.garageClear.toFixed(2)} m · 待核</dd></div>
            <div><dt>预计入口净宽 · 待测</dt><dd>${garageLayout.entry.d.toFixed(2)} m</dd></div>
            <div><dt>L9长 / 宽 / 高 · 不含镜</dt><dd>${site.vehicle.length} / ${site.vehicle.width} / ${site.vehicle.height} m</dd></div>
            <div><dt>居中直行单侧几何余量</dt><dd>约 ${Math.round((garageLayout.entry.d - site.vehicle.width) * 50)} cm</dd></div>
          </dl><p class="micro">轴距 ${site.vehicle.wheelbase} m，沿用项目已有车辆尺寸。上列余量只是假定入口宽度减车身宽，不含后视镜、转弯及安全余量。</p>
        </section>
        <section><h2>扫掠与风险图层</h2>
          ${check("route-sweep", "车身扫掠范围", true)}${check("route-clearance", "净高待核区与拟切口", true)}${check("route-conflicts", "柱墙与越界提示", true)}
          <ul class="route-legend"><li><i class="route-sweep-key"></i>蓝色：沿途整车占位包络</li><li><i class="route-pending-key"></i>橙色：保留地坪下方 · 净高待测</li><li><i class="route-conflict-key"></i>红色：柱墙投影相交或超出示意通道</li><li><i class="route-cut-key"></i>紫色虚线：拟切口 · 协商待确认</li></ul>
          <p id="route-summary" class="description"></p><div id="route-findings" class="route-findings" aria-label="沿途待核区段，点击定位车辆"></div>
          <p class="micro">平面扫掠包含前后悬；含镜宽、实际转弯、纵坡俯仰、底盘、驶出及两车独立进出待核。</p>
        </section>
        <section><h2>坡道参数探索</h2><p class="micro">院坪暂定±0.000；道路标高与坡长均为待测示意值。</p><label class="select-label">接入处道路标高 · 待测 / 示意（m）<input type="number" id="road-level" value="${surroundings.road.entryY.toFixed(2)}" step="0.1" min="-3.8" max="0"/></label><label class="select-label">坡道投影长度 · 待测 / 示意（m）<input type="number" id="ramp-length" value="5" step="0.5" min="3" max="10"/></label><p class="calculation" id="ramp-result"></p><p class="micro">地库完成面暂${site.garageFloor} m、结构预留${site.deckStructure} m；${site.garageClear} m为净高目标，实际梁底和柱墙待测。</p></section>
        <section><div class="range-heading"><label for="route-progress">车辆沿示意路线移动</label><output id="route-output">0%</output></div><input type="range" id="route-progress" min="0" max="100" value="0" step="1"/><p id="route-status" class="description" aria-live="polite"></p><p class="micro">拖动滑杆或点击待核区段定位车辆。</p></section>
      </div>
      <div id="sources-controls" hidden><section><h2>证据状态</h2><ul class="evidence-legend"><li><i class="e-user"></i>用户提供</li><li><i class="e-photo"></i>照片估算</li><li><i class="e-design"></i>设计建议</li><li><i class="e-pending"></i>待测 / 待校核</li></ul>${check("pending-only", "只看待补测项目")}</section><section><h2>下一步现场补测</h2><ol class="measure-list"><li>道路、邻居院坪与旧房前坪的高差。</li><li>切口、保留柱墙及可用坡道的平面尺寸。</li><li>L9含镜宽、转弯参数。第二辆已按吉利星愿外观示意，不参与通行占位。</li><li>地块转折点、屋后田坎及邻居屋檐位置。</li></ol></section><button class="secondary-button" id="download-data">下载当前方案参数</button></div>
    </aside>
  </main>
  <footer class="app-footer"><span id="interaction-hint">拖动旋转 · 滚轮缩放 · 右键平移</span><span>概念方案 · 待实测与设计</span><a href="#" id="footer-sources">查看数据依据 ↗</a></footer>
  <dialog id="photo-modal"><form method="dialog"><button class="icon-button" aria-label="关闭图片">${icon("close")}</button></form><img id="modal-img" alt="现场参考"/><div><h2 id="modal-title"></h2><p id="modal-note"></p><button id="match-photo" class="secondary-button">按此照片方向观察模型</button></div></dialog>
  <dialog id="export-modal"><form method="dialog"><button class="icon-button" aria-label="关闭导出预览">${icon("close")}</button></form><img id="export-image" alt="当前模型视图导出预览"/><div><h2>当前模型视图</h2><p>图片附版本与未核状态。</p><a id="export-download" class="secondary-button" download="安化山居.png">下载 PNG 图片</a></div></dialog>
  <div id="toast" role="status" hidden></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let viewer: VillaViewer | null = null;
let review: ReturnType<typeof mountDesignReview> | null = null;
let lastViewingTab: MeetingView["tab"] = "model";
let reviewPose: CameraPose | null = null;
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
    { inside: checked("room-inside"), useZones: checked("room-clearance"), dining: $<HTMLSelectElement>("dining-mode").value as "full" | "daily" },
  );
  active("[data-floor]", (b) => Number(b.dataset.floor) === level);
  document.querySelectorAll<HTMLInputElement>('input[name="floor"]').forEach(input => {
    input.checked = Number(input.value) === level;
  });
  $("floor-summary-title").textContent =
    `${floors[level].name} · ${bedroomSummary(level)}`;
  $("floor-summary").textContent = [
    "面对房子时，右侧是挑空客厅，左侧前部是 4.5×3 米茶室，茶室和尊亲房中间是楼梯。尊亲房靠南，带内卫。右后是一间用途待定的房间。堂屋后面只留空位。辅楼厨房未改。",
    "挑空仍在右侧。茶室上方是一间 3 米进深的东前卧室；主卧改到楼梯南侧，带内卫。西侧另有一间卧室。楼梯和公卫与一楼对齐。",
    "中间仍是家庭多功能厅。西侧前为主卧，后部是影音室。东侧楼梯与下面对齐，楼梯北是通东侧露台的过厅，南侧是卧室和内卫。",
  ][level];
  $("room-detail").hidden = true;
  $("room-detail").replaceChildren();
  $("dining-check").hidden = level !== 0;
  document.querySelector<HTMLElement>(".plan-caption")!.textContent = level === 0 && $<HTMLSelectElement>("dining-mode").value === "daily"
    ? "日常6座：圆桌与12椅暂收起，收纳待定；3D保留双桌。尺寸与留位仅作模型参考。"
    : "尺寸为外轮廓／模型内侧参考，未扣装修和套内占用；0.60m家具留位非通行校核。";
}
function updateScene() {
  const design = tab === "design";
  const realScene = tab === "real";
  document.querySelector<HTMLElement>(".app-footer")!.hidden = design || realScene || tab === "sources";
  document.body.classList.toggle("focused-view", design || realScene || tab === "sources");
  $("design-panel").hidden = !design;
  $("real-scene-panel").hidden = !realScene;
  document.querySelector<HTMLElement>(".stage")!.hidden = realScene || design;
  document.querySelector<HTMLElement>(".inspector")!.hidden = realScene || design;
  if (design) {
    $("loading").hidden = true;
    $("interaction-hint").textContent = "按编号记录意见 · 保存快照与JSON备份 · 导出离线沟通图册";
    review?.refresh();
    return;
  }
  if (realScene) {
    const frame = $<HTMLIFrameElement>("real-scene-frame");
    if (!frame.hasAttribute("src")) frame.src = "../villa-real-scene/?embed=1&ui=2";
    $("interaction-hint").textContent = "切换机位 · 原片对比 · 下载实景效果";
    return;
  }
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
  $("photo-strip").hidden = tab !== "model" || garage;
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
    mainBuilding: checked("main-building"),
    annexBuilding: checked("annex-building"),
    sideNeighbor: checked("neighbor-side"),
    rearNeighbor: checked("neighbor-rear"),
    frontNeighbor: checked("neighbor-front"),
    roadsideNeighbor: checked("neighbor-roadside"),
  });
  $("scene-title").textContent = garage
    ? "地库车辆路线与待核区"
    : floor3d
      ? `${floors[level].name} · 立体剖看`
      : tab === "sun"
        ? "南侧日照与遮挡"
        : isExisting
          ? "老房现状"
          : "新建方案";
  $("scene-subtitle").textContent = garage
    ? "车身平面扫掠 · 净高待测 · 切口协商待确认"
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
  const resumePose = tab === "design" && name === lastViewingTab ? reviewPose : null;
  if (name === "design" && tab !== "design") reviewPose = viewer?.cameraPose() ?? null;
  tab = name;
  if (name === "model" || name === "floor" || name === "sun") lastViewingTab = name;
  active("[data-tab]", (b) => b.dataset.tab === tab);
  if (tab === "real" || tab === "design") {
    updateScene();
    return;
  }
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
  if (resumePose) viewer?.restoreCameraPose(resumePose);
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
function updateFenShui(source?: HTMLInputElement) {
  const range = $<HTMLInputElement>("fen-shui");
  const field = $<HTMLInputElement>("fen-shui-number");
  const current = source ?? field;
  const value = Number(current.value);
  if (!current.value || !Number.isFinite(value) || value < 1 || value > 10) {
    $("fen-shui-result").textContent = "请输入 1 到 10 之间的分水。";
    return;
  }
  (current === range ? field : range).value = current.value;
  $("fen-shui-output").textContent = String(Math.round(value * 10) / 10);
  const pitch = roofPitch(value);
  $("fen-shui-result").textContent =
    `主楼升高 ${pitch.mainRise.toFixed(2)} m，半坡 ${pitch.mainRun.toFixed(2)} m。辅楼升高 ${pitch.annexRise.toFixed(2)} m，半坡 ${pitch.annexRun.toFixed(2)} m。`;
  viewer?.setRoofFenShui(value);
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
      "请输入有效范围：道路−3.8～0米，坡长3～10米。图中沿用上次有效的示意参数。";
    return;
  }
  viewer?.updateRamp(roadY, len);
  const grade = ((roadY - site.garageFloor) / len) * 100;
  $("ramp-result").textContent =
    `示意高差 ${Math.abs(roadY - site.garageFloor).toFixed(2)} m / ${len.toFixed(1)} m → ${grade >= 0 ? "下坡" : "上坡"} ${Math.abs(grade).toFixed(1)}%`;
  renderRouteReview();
  updateRoute();
}
function renderRouteReview() {
  if (!viewer) return;
  const assessment = viewer.routeAssessment;
  const columns = assessment.conflicts.filter((o) => o.kind === "column");
  const walls = [...new Set(assessment.conflicts.filter((o) => o.kind === "wall").map((o) => o.label))];
  $("route-summary").textContent =
    `全程平面筛查：${columns.length ? `${columns.length}根模型柱有投影潜在冲突` : "未见模型柱投影相交"}；${walls.length ? `${walls.length}处墙体有投影潜在冲突` : "未见模型墙体投影相交"}。道路与梁底标高待测，通行未确认。点击下列区段定位查看。`;
  const findings = $("route-findings");
  findings.replaceChildren();
  const add = (label: string, kind: string, predicate: (cell: SweepCell) => boolean) => {
    const ranges = routeRanges(assessment.cells, predicate);
    if (!ranges.length) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-finding";
    button.dataset.kind = kind;
    button.dataset.routeTo = String(Math.round((ranges[0][0] + ranges[0][1]) * 50));
    const name = document.createElement("strong"), range = document.createElement("small");
    name.textContent = label;
    range.textContent = `${formatRouteRanges(ranges)} · 点击定位`;
    button.append(name, range);
    findings.append(button);
  };
  add("保留地坪下方 · 净高待测", "pending", (c) => c.underDeck);
  add("越出示意通道 · 需复核", "conflict", (c) => c.outside);
  for (const o of columns)
    add(`${o.label} · 平面潜在冲突`, "conflict", (c) => c.obstacles.includes(o));
  for (const wall of walls)
    add(`${wall} · 平面潜在冲突`, "conflict", (c) => c.obstacles.some((o) => o.label === wall));
}
function updateRoute() {
  const n = Number($<HTMLInputElement>("route-progress").value);
  $("route-output").textContent = `${n}%`;
  const result = viewer?.routeAt(n);
  if (result) {
    $("route-status").textContent = result.note;
    $("route-status").dataset.kind = result.outside || result.obstacles.length ? "conflict" : "pending";
  }
}
function showRoom(id: string) {
  const room = [...floors[level].rooms, ...(level === 0 ? annexRooms : [])].find((r) => r.id === id);
  if (!room) return;
  const ref = roomReference(room, level);
  $("room-detail").hidden = false;
  $("room-detail").innerHTML = `<strong>${escapeHtml(room.name)}</strong><p>${room.w.toFixed(2)} × ${room.d.toFixed(2)} m · 外轮廓</p>${room.kind !== "void" ? `<p>模型内侧参考约 ${ref.w.toFixed(2)} × ${ref.d.toFixed(2)} m</p><p class="micro">${escapeHtml(ref.note)}</p>` : ""}<p>${escapeHtml(room.note ?? "家具与空间为方案参考，需结合结构、装修和使用进一步深化。")}</p>${room.purposeStatus ? "<p>用途待确认；当前不计入6间用途明确的卧室。</p>" : ""}<button class="text-button" data-design-issue="${room.id === "dining" ? "D09" : room.id === "stair" ? "D03" : room.id === "spare" ? "D10" : "D08"}">打开相关议题与记录 ↗</button>`;
}
function captureMeetingView(): MeetingView {
  return {
    tab: ["model", "floor", "sun"].includes(tab) ? tab as MeetingView["tab"] : lastViewingTab,
    camera: viewer?.activeCamera ?? camera,
    level, planMode: planMode as "2d" | "3d", existing: viewer?.state.existing ?? (isExisting && lastViewingTab === "model"), balcony,
    fenShui: Number($<HTMLInputElement>("fen-shui").value),
    roadY: viewer?.roadY ?? surroundings.road.entryY, rampLength: viewer?.rampLength ?? 5,
    progress: Number($<HTMLInputElement>("route-progress").value),
    sunDate: $<HTMLInputElement>("sun-date").value, sunTime: Number($<HTMLInputElement>("sun-time").value),
    dining: $<HTMLSelectElement>("dining-mode").value as "full" | "daily",
    flags: Object.fromEntries(viewFlags.map((id) => [id, checked(id)])),
    pose: viewer?.cameraPose() ?? null,
  };
}
function restoreMeetingView(view: MeetingView) {
  level = view.level; planMode = view.planMode; isExisting = view.existing; balcony = view.balcony; camera = view.camera;
  for (const id of viewFlags) $<HTMLInputElement>(id).checked = view.flags[id];
  for (const id of ["fen-shui", "fen-shui-number"]) $<HTMLInputElement>(id).value = String(view.fenShui);
  $<HTMLInputElement>("road-level").value = String(view.roadY);
  $<HTMLInputElement>("ramp-length").value = String(view.rampLength);
  $<HTMLInputElement>("route-progress").value = String(view.progress);
  $<HTMLInputElement>("sun-date").value = view.sunDate;
  $<HTMLInputElement>("sun-time").value = String(view.sunTime);
  $<HTMLSelectElement>("dining-mode").value = view.dining;
  for (const id of ["balcony", "sun-balcony"]) $<HTMLSelectElement>(id).value = balcony ? "local" : "none";
  active("[data-existing]", (b) => b.dataset.existing === String(isExisting));
  active("[data-plan-mode]", (b) => b.dataset.planMode === planMode);
  updateFenShui(); updateRamp(); updateSun();
  switchTab(view.tab);
  camera = view.camera;
  viewer?.setCamera(view.camera);
  if (view.pose) viewer?.restoreCameraPose(view.pose);
  viewer?.setRouteLayers({ sweep: view.flags["route-sweep"], clearance: view.flags["route-clearance"], conflicts: view.flags["route-conflicts"] });
  active("[data-camera]", (b) => b.dataset.camera === camera);
}
function locateDesignIssue(issue: DesignIssue) {
  if (issue.target === "real" || issue.target === "sources" || issue.target === "sun") {
    switchTab(issue.target);
  } else if (["floor", "stair", "roof"].includes(issue.target)) {
    level = issue.floor ?? (issue.target === "roof" ? 2 : 0);
    planMode = "2d";
    active("[data-plan-mode]", (b) => b.dataset.planMode === "2d");
    $<HTMLInputElement>("room-clearance").checked = issue.target === "floor";
    switchTab("floor");
    if (issue.room) {
      showRoom(issue.room);
      document.querySelectorAll<HTMLElement>("[data-room]").forEach((r) => r.classList.toggle("selected", r.dataset.room === issue.room));
    }
  } else {
    isExisting = false;
    active("[data-existing]", (b) => b.dataset.existing === "false");
    switchTab("model");
    setCamera(issue.target === "garage" ? "garage" : issue.target === "entrance" ? "courtyard" : "aerial");
  }
  toast(`${issue.id} · ${issue.title}；可返回设计沟通记录意见。`);
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
    showRoom(el.dataset.room);
    document
      .querySelectorAll("[data-room]")
      .forEach((r) => r.classList.toggle("selected", r === el));
  }
  if (el.dataset.designIssue) {
    switchTab("design");
    review?.openIssue(el.dataset.designIssue);
  }
});
document.addEventListener("keydown", (e) => {
  const el = (e.target as Element).closest<HTMLElement>("[data-room]");
  if (el && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
});
for (const id of ["roof", "dimensions", "context", "overlap", "main-building", "annex-building", "neighbor-side", "neighbor-rear", "neighbor-front", "neighbor-roadside"])
  $(id).addEventListener("change", updateScene);
for (const id of ["balcony", "sun-balcony"])
  $(id).addEventListener("change", () => {
    balcony = $<HTMLSelectElement>(id).value === "local";
    $<HTMLSelectElement>("balcony").value = $<HTMLSelectElement>(
      "sun-balcony",
    ).value = balcony ? "local" : "none";
    updateScene();
  });
$("floor-select").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (!input.matches('input[name="floor"]') || !input.checked) return;
  level = Number(input.value);
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
for (const id of ["room-inside", "room-clearance", "dining-mode"])
  $(id).addEventListener("change", drawPlan);
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
for (const id of ["fen-shui", "fen-shui-number"])
  $(id).addEventListener("input", (event) => updateFenShui(event.target as HTMLInputElement));
$("route-progress").addEventListener("input", updateRoute);
for (const [id, layer] of [["route-sweep", "sweep"], ["route-clearance", "clearance"], ["route-conflicts", "conflicts"]] as const)
  $(id).addEventListener("change", () => viewer?.setRouteLayers({ [layer]: checked(id) }));
$("route-findings").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-route-to]");
  if (!button) return;
  $<HTMLInputElement>("route-progress").value = button.dataset.routeTo!;
  updateRoute();
});
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
$("record-view").addEventListener("click", () => review?.saveSnapshot());
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
          projectMeta,
          meeting: review?.exportSession(),
          description: "概念模型参数，不能作为测绘或施工图使用。",
          units: "m",
          axes: "X东 Y上 Z南；旧前坪外缘Z=0",
          site,
          buildingAreas,
          surroundings,
          facts,
          floors,
          garageRoute: {
            status: "模型平面筛查，通行未确认",
            evidence: "原空间探索曲线与模型柱墙投影，实际结构和标高待测",
            vehicle: site.vehicle,
            controlPoints: viewer?.route.points.map((p) => [p.x, p.z]),
            retainedDeck: garageLayout.retainedDeck,
            proposedCut: garageLayout.proposedCut,
            modelObstacles: garageLayout.obstacles,
            limitations: "含镜宽、可靠转弯参数、纵坡俯仰、底盘、驶出及第二辆车独立进出均待校核",
          },
          preview: {
            fenShui: Number($<HTMLInputElement>("fen-shui").value),
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
review = mountDesignReview($("design-panel"), {
  getView: captureMeetingView, restore: restoreMeetingView,
  options: () => ({ fenShui: Number($<HTMLInputElement>("fen-shui").value), roadY: viewer?.roadY ?? surroundings.road.entryY, rampLength: viewer?.rampLength ?? 5 }),
  navigate: locateDesignIssue, image: () => viewer?.exportImage(), toast,
});
renderFacts();
drawPlan();
updateFenShui();
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
  const initialView = new URLSearchParams(location.search).get("view");
  if (initialView === "roadside" || initialView === "garage") setCamera(initialView);
  $("loading").hidden = true;
} catch (error) {
  console.error(error);
  $("loading").innerHTML =
    "<strong>当前环境未能启动3D</strong><p>请在支持WebGL2的浏览器打开。分层平面与资料仍可查看。</p>";
  toast("3D加载失败，平面图与资料可以继续查看。");
}
const initialTab = new URLSearchParams(location.search).get("tab");
if (initialTab && ["model", "floor", "sun", "sources", "real", "design"].includes(initialTab)) switchTab(initialTab);
