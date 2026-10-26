import "./style.css";
import "./plan-designer.css";
import { planDesignerHtml, libraryCardsHtml, designerRoomListHtml, type LibraryCategory } from "./plan-designer";
import { loadingOverlayHtml, withLoadingOverlay } from "./loading-overlay";
import { DeferredSceneUpdate, FrameRedraw } from "./deferred-scene-update";
import { patchPlanDrawing } from "./plan-dom";
import { roofPlan, roofDrawingLabels, type RoofDrawingView } from "./roof-plan";
import { elevationPlan, elevationLabels, type ElevationView } from "./elevation-plan";
import { formatMm } from "./units";
import { VillaViewer, defaultView, type CameraName } from "./viewer";
import { site, floors, facts, photos, annexRooms, buildingAreas } from "./data";
import {
  floorPlan,
  courtyardSitePlan,
  diningClearance,
  planSourceFromDraft,
  planSourceFromPublished,
  PLAN_ENTRANCE_DOWN,
} from "./plan";
import { LayoutEditor } from "./layout-editor";
import { LayoutScene, selectionKey } from "./layout-scene";
import { PlanCanvas } from "./plan-canvas";
import { furniturePickerOrder, furnitureLabels } from "./furniture-catalog";
import { OPENING_KINDS, openingLabels } from "./openings";

const roomKindOptions = [
  ["bed", "卧室"],
  ["living", "客厅"],
  ["hall", "堂屋／过道"],
  ["bath", "卫生间"],
  ["store", "储物"],
  ["stair", "双跑楼梯"],
  ["stair-triple", "三跑楼梯"],
] as const;
import { roofPitch, villaLayoutFromDraft } from "./architecture";
import { surroundings } from "./surroundings";
import { garageLayout } from "./garage-layout";
import { formatRouteRanges, routeRanges, type SweepCell } from "./vehicle-route";
import { bedroomSummary, roomAreas, type DesignIssue } from "./design-data";
import { mountDesignReview } from "./design-review";
import { viewFlags, type CameraPose, type MeetingView } from "./design-session";
import { projectMeta, escapeHtml } from "./project-meta";
import { parseCourtyardFinish, type CourtyardFinish } from "./courtyard-finishes";
import { parseRoofStyle, type RoofStyle } from "./roof-options";
import {
  bindCourtyardDimDrag,
  clearCourtyardDimLayout,
  loadCourtyardDimLayout,
  replaceCourtyardDimLayout,
  type CourtyardDimLayout,
} from "./courtyard-dim-drag";
import {
  applyVillaParams,
  DEFAULT_VILLA_PARAMS,
  getVillaParams,
  LOCKED_SITE_WIDTH,
  rememberVillaParams,
  saveVillaParams,
  validateVillaParams,
  type VillaParams,
} from "./villa-params";
import {
  bindParamsInnerTabs,
  fillVillaParamsDom,
  readVillaParamsFromDom,
  hasPendingVillaParamChanges,
  sanitizeVillaParamInput,
  updateVillaParamsMeta,
  villaParamsPanelHtml,
} from "./villa-params-ui";
import {
  clearLayoutDraft,
  clonePublishedLayout,
  envelopeFromSite,
  loadLayoutDraft,
  replaceLayoutDraftMemory,
  saveLayoutDraft,
  scaleLayoutDraftToEnvelope,
  type LayoutDraft,
} from "./layout-draft";
import {
  buildSchemeDocument,
  clearLegacyLocalStorage,
  formatSavedAt,
  formatSavedAtDisplay,
  loadCurrentScheme,
  migrateLegacyLocalStorage,
  persistSchemeFile,
  resetSchemeDocument,
  type SchemeDocument,
} from "./scheme-store";
import {
  buildLayoutVersionDocument,
  emptyDataIndex,
  buildSizeVersionDocument,
  loadDataVersionsIndex,
  loadLayoutVersion,
  loadSizeVersion,
  makeDataVersionTitle,
  deleteDataVersion,
  persistDataVersion,
  prependVersionMeta,
  removeVersionMeta,
  type DataVersionsIndex,
  type LayoutVersionDocument,
  type SizeVersionDocument,
} from "./data-versions";

import { blankLayoutDraft, createLayoutVersion, layoutVersionName, renameLayoutVersion, suggestLayoutVersionName } from "./layout-version-management";

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
  sliders:
    '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
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
  ${villaParamsPanelHtml()}
  <header class="app-header">
    <div class="header-brand">
      <a class="back-link" href="../docs/" aria-label="返回建房指南" title="返回建房指南">${icon("arrow")}</a>
      <a href="../docs/" class="brand" aria-label="安化山居，返回建房指南">${icon("house")}<strong>安化 · 山居</strong><span>实景别墅方案</span></a>
    </div>
    <nav aria-label="查看模式" class="main-tabs">
      ${[
        ["model", "场地模型"],
        ["floor", "分层户型"],
        ["sun", "日照分析"],
        ["real", "实景"],
        ["design", "设计沟通"],
        ["sources", "资料与校核"],
        ["originals", "原始资料"],
      ]
        .map(
          ([id, name]) =>
            `<button data-tab="${id}" ${id === "real" ? 'title="合成参考，未同步最新方案；尺寸以场地模型为准。"' : ""} class="${id === "model" ? "active" : ""}" aria-pressed="${id === "model"}">${name}</button>`,
        )
        .join("")}
    </nav>
    <button type="button" class="header-action" id="open-params-panel" aria-pressed="false" title="打开尺寸设置">${icon("sliders")}<span>尺寸设置</span></button>
  </header>
  <main class="workspace">
    <section class="stage" aria-label="方案查看区">
      <div id="viewport"></div>
      ${loadingOverlayHtml({ id: "loading", text: "正在构建山居场景…", hidden: false })}
      ${loadingOverlayHtml({ id: "scene-loading", text: "正在更新立体模型…" })}
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
      ${planDesignerHtml(floors.map(f => f.name))}
      <article id="sources-panel" class="sources-panel" hidden><h1>设计依据与待核对事项</h1><p class="lead">把已经知道的、照片估算的和设计提出的分开记录，方便家人与现场一起核对。</p><div class="source-gallery">${photos.map((p, i) => `<button data-photo-modal="${i}"><img src="./photos/${p.file}" alt="${p.title}" loading="lazy"/><strong>${p.title}</strong><span>${p.note}</span></button>`).join("")}</div><h2>尺寸与证据</h2><div class="fact-list" id="fact-list"></div><h2>使用范围</h2><p>这是按现有照片与尺寸制作的方案模型。围护墙、楼梯、柱梁、挡土、排水、柴火烟道和邻居平台切除均需结合现场深化；模型没有代替结构施工图，也未认定宅基地审批范围。</p><p>太阳位置采用安化地区坐标和北京时间。周边树高、远山天际线与邻房标高未经测绘，日照结果只用于当前模型内的方案比较。</p><p class="source-links"><a href="https://manuals.lixiang.com/zh-cn/X012022MAX/20250916140616/topic-2022-702D4999-001.html" target="_blank" rel="noreferrer">2022款理想L9官方整车参数 ↗</a><a href="https://bsesc.energy.gov/energy-basics/natural-light-and-daylighting" target="_blank" rel="noreferrer">自然采光与遮阳原理 ↗</a><a href="../sunlight-3d/">原四季日照模拟器 ↗</a></p></article>
      <div class="sun-stamp" id="sun-stamp" hidden>${icon("sun")}<span id="sun-stamp-text"></span></div>
    </section>
    <section id="originals-panel" class="real-scene-panel" aria-label="原始资料" hidden><iframe id="originals-frame" title="原始资料图片与文件浏览"></iframe></section>
    <section id="real-scene-panel" class="real-scene-panel" aria-label="实景效果" aria-description="合成参考，未同步最新方案；尺寸以场地模型为准。" hidden>
      <iframe id="real-scene-frame" title="安化山居实景效果与原片对比" allow="fullscreen"></iframe>
    </section>
    <section id="design-panel" class="design-panel" aria-label="设计沟通资料" hidden></section>
    <aside class="inspector" aria-label="模型设置">
      <div class="scene-heading" id="scene-heading"><h1 id="scene-title">新建方案</h1><p id="scene-subtitle">依据航拍与已知尺寸重建 · 周边为估算</p></div>
      <div id="model-controls">
        <section><h2>方案概览</h2><div class="segmented"><button data-existing="false" class="active" aria-pressed="true">新建</button><button data-existing="true" aria-pressed="false">现状</button></div><div class="area-number" id="area-number">${buildingAreas.total.toFixed(1)}<span>m²</span></div><p class="area-caption" id="area-caption">主楼 ${buildingAreas.main.toFixed(1)}㎡ ＋ 辅楼 ${buildingAreas.annex.toFixed(1)}㎡ ＋ 门厅 ${buildingAreas.portico.toFixed(1)}㎡</p><p class="micro" id="area-micro">首层建筑面积合计 · 已含外伸门厅 · 全楼各层总面积另行汇总</p><button type="button" class="secondary-button" id="open-params-from-inspector">打开尺寸设置</button></section>
        <section><h2>模型显示</h2>${check("roof", "屋顶", true)}${check("dimensions", "尺寸标注")}${check("context", "周边环境", true)}${check("main-building", "主楼", true)}${check("annex-building", "辅楼", true)}${check("neighbor-side", "左侧邻居房子", true)}${check("neighbor-rear", "屋后邻居房子", true)}${check("neighbor-front", "前面邻居房子")}${check("neighbor-roadside", "马路边蓝顶邻房", true)}${check("overlap", "主楼与地库重叠")}<label class="select-label">南侧阳台<select id="balcony"><option value="none">无连续后阳台 · 基准</option><option value="local">三楼局部浅阳台 · 1200 mm</option></select></label></section>
        <section><h2>屋面坡度</h2><p class="micro">分水＝水平10对应的升高。主辅楼同步调整，官帽按所选造型重画。</p><div class="range-heading"><label for="fen-shui">分水</label><output id="fen-shui-output">${site.roofFenShui.toFixed(1)}</output></div><input type="range" id="fen-shui" min="1" max="10" step="0.1" value="${site.roofFenShui}"/><label class="select-label">直接输入<input type="number" id="fen-shui-number" min="1" max="10" step="0.1" value="${site.roofFenShui}"/></label><p class="calculation" id="fen-shui-result"></p></section>
        <section><h2>关键尺寸</h2><dl class="metric-list" id="metric-list"></dl></section>
        <button class="notice notice-button" id="open-garage">${icon("info")}<span><strong>地库车辆路线待校核</strong><small>查看车身扫掠、净高待核区与柱墙潜在冲突。<br/>道路与梁底待测，切口协商待确认。</small></span><span>↗</span></button>
      </div>
      <div id="floor-controls" hidden>
        <section><h2>分层户型</h2><div class="segmented"><button data-plan-mode="2d" class="active">平面图</button><button data-plan-mode="3d">立体剖看</button></div><div id="floor-room-options"><fieldset id="floor-select" class="floor-choices"><legend>选择楼层</legend><div>${floors.map((f, i) => `<label><input type="radio" name="floor" value="${i}" ${i === 0 ? "checked" : ""}/><span><strong>${f.name}</strong><small>${bedroomSummary(i)}</small></span></label>`).join("")}</div></fieldset>${check("explode", "楼层分离展示")}${check("chair-clearance", "餐厅拉椅范围", true)}${check("room-clearance", "家具使用讨论留位")}<label class="select-label">辅楼前圆桌情景<select id="dining-mode"><option value="full">室外圆桌 · 6座</option><option value="daily">圆桌收起 · 日常</option></select></label><button class="secondary-button" data-design-issue="D08">记录房间深化意见 ↗</button></div></section>
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
        <section><h2>后阳台对比</h2><select id="sun-balcony" aria-label="选择南侧阳台方案"><option value="none">无连续后阳台 · 基准</option><option value="local">三楼局部浅阳台 · 1200 mm</option></select><p class="micro">浅阳台仅在三楼公共过厅外，卧室南窗保持开敞。</p><button class="primary-button" id="analyze-sun">计算两种方案的南窗遮挡</button><div id="sun-report" aria-live="polite"></div></section>
        <p class="micro">每半小时采样窗外竖向3点，显示直射光是否受阻；不是室内照度或法定日照时数。树木、邻房和地形为照片估算。</p>
      </div>
      <div id="garage-controls" hidden>
        <section>
          <div class="section-heading"><h2>地库与入口</h2><button id="leave-garage" class="text-button">返回场地</button></div>
          <div class="notice"><span><strong>车辆路线 · 通行未确认</strong><small>道路与最低梁底待测，切口协商待确认；当前仅作模型平面筛查。</small></span></div>
          <dl class="metric-list">
            <div><dt>地库最低净高目标</dt><dd>${formatMm(site.garageClear)} mm · 待核</dd></div>
            <div><dt>预计入口净宽 · 待测</dt><dd>${formatMm(garageLayout.entry.d)} mm</dd></div>
            <div><dt>L9长 / 宽 / 高 · 不含镜</dt><dd>${formatMm(site.vehicle.length)} / ${formatMm(site.vehicle.width)} / ${formatMm(site.vehicle.height)} mm</dd></div>
            <div><dt>居中直行单侧几何余量</dt><dd>约 ${Math.round((garageLayout.entry.d - site.vehicle.width) * 50)} cm</dd></div>
          </dl><p class="micro">轴距 ${formatMm(site.vehicle.wheelbase)} mm，沿用项目已有车辆尺寸。上列余量只是假定入口宽度减车身宽，不含后视镜、转弯及安全余量。</p>
        </section>
        <section><h2>扫掠与风险图层</h2>
          ${check("route-sweep", "车身扫掠范围", true)}${check("route-clearance", "净高待核区与拟切口", true)}${check("route-conflicts", "柱墙与越界提示", true)}
          <ul class="route-legend"><li><i class="route-sweep-key"></i>蓝色：沿途整车占位包络</li><li><i class="route-pending-key"></i>橙色：保留地坪下方 · 净高待测</li><li><i class="route-conflict-key"></i>红色：柱墙投影相交或超出示意通道</li><li><i class="route-cut-key"></i>紫色虚线：拟切口 · 协商待确认</li></ul>
          <p id="route-summary" class="description"></p><div id="route-findings" class="route-findings" aria-label="沿途待核区段，点击定位车辆"></div>
          <p class="micro">平面扫掠包含前后悬；含镜宽、实际转弯、纵坡俯仰、底盘、驶出及两车独立进出待核。</p>
        </section>
        <section><h2>坡道参数探索</h2><p class="micro">院坪暂定±0.000；道路标高与坡长均为待测示意值。</p><label class="select-label">接入处道路标高 · 待测 / 示意（mm）<input type="number" id="road-level" value="${Math.round(surroundings.road.entryY)}" step="100" min="-3800" max="0"/></label><label class="select-label">坡道投影长度 · 待测 / 示意（mm）<input type="number" id="ramp-length" value="5000" step="500" min="3000" max="10000"/></label><p class="calculation" id="ramp-result"></p><p class="micro">地库完成面暂${formatMm(site.garageFloor)} mm、结构预留${formatMm(site.deckStructure)} mm；${formatMm(site.garageClear)} mm为净高目标，实际梁底和柱墙待测。</p></section>
        <section><div class="range-heading"><label for="route-progress">车辆沿示意路线移动</label><output id="route-output">0%</output></div><input type="range" id="route-progress" min="0" max="100" value="0" step="1"/><p id="route-status" class="description" aria-live="polite"></p><p class="micro">拖动滑杆或点击待核区段定位车辆。</p></section>
      </div>
      <div id="sources-controls" hidden><section><h2>证据状态</h2><ul class="evidence-legend"><li><i class="e-user"></i>用户提供</li><li><i class="e-photo"></i>照片估算</li><li><i class="e-design"></i>设计建议</li><li><i class="e-pending"></i>待测 / 待校核</li></ul>${check("pending-only", "只看待补测项目")}</section><section><h2>下一步现场补测</h2><ol class="measure-list"><li>道路、邻居院坪与旧房前坪的高差。</li><li>切口、保留柱墙及可用坡道的平面尺寸。</li><li>L9含镜宽、转弯参数。第二辆已按吉利星愿外观示意，不参与通行占位。</li><li>地块转折点、屋后田坎及邻居屋檐位置。</li></ol></section><button class="secondary-button" id="download-data">下载当前方案参数</button></div>
    </aside>
  </main>
  <footer class="app-footer"><span id="interaction-hint">拖动旋转 · 滚轮缩放 · 右键平移</span><span>概念方案 · 待实测与设计</span><a href="#" id="footer-sources">查看数据依据 ↗</a></footer>
  <dialog id="layout-version-dialog" class="layout-version-dialog" aria-labelledby="layout-version-dialog-title">
    <form id="layout-version-form">
      <h2 id="layout-version-dialog-title">新增户型</h2>
      <p id="layout-version-dialog-note"></p>
      <label for="layout-version-name">户型名称</label>
      <input id="layout-version-name" name="title" required maxlength="80" autocomplete="off" />
      <p id="layout-version-error" class="layout-version-error" role="alert"></p>
      <div class="layout-version-dialog-actions"><button type="button" id="layout-version-cancel" class="secondary-button">取消</button><button type="submit" id="layout-version-submit" class="secondary-button">确定</button></div>
    </form>
  </dialog>
  <dialog id="photo-modal"><form method="dialog"><button class="icon-button" aria-label="关闭图片">${icon("close")}</button></form><img id="modal-img" alt="现场参考"/><div><h2 id="modal-title"></h2><p id="modal-note"></p><button id="match-photo" class="secondary-button">按此照片方向观察模型</button></div></dialog>
  <dialog id="export-modal"><form method="dialog"><button class="icon-button" aria-label="关闭导出预览">${icon("close")}</button></form><img id="export-image" alt="当前模型视图导出预览"/><div><h2>当前模型视图</h2><p>图片附版本与未核状态。</p><a id="export-download" class="secondary-button" download="安化山居.png">下载 PNG 图片</a></div></dialog>
  <div id="toast" role="status" hidden></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let viewer: VillaViewer | null = null;
let layoutScene: LayoutScene | null = null;
let planCanvas: PlanCanvas | null = null;
let designerSceneCamera: "orbit" | "top" = "orbit";
const designerScenePoses = new Map<number, CameraPose>();
let designerSceneLevel = 0;
let designerSceneActive = false;
let designerCameraRevision = 0;
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
let roofStyle: RoofStyle = "joined";
let drawingView: "floor" | "roof" | "elevation" = "floor";
let elevationView: ElevationView = "north";
let roofDrawingView: RoofDrawingView = "joined";
let toastTimer: ReturnType<typeof setTimeout>;
let layoutEditing = false;
let layoutEditor: LayoutEditor | null = null;
let unbindLayoutEditor: (() => void) | null = null;
type LayoutInspectorPosition = { left: number; top: number };
/** 手动拖动后保留本次页面会话的位置，不写入户型数据。 */
let layoutInspectorPosition: LayoutInspectorPosition | null = null;
let layoutInspectorDrag: {
  pointerId: number;
  clientX: number;
  clientY: number;
  position: LayoutInspectorPosition;
} | null = null;
let unbindCourtyardDims: (() => void) | null = null;
let courtyardDimLayout: CourtyardDimLayout = loadCourtyardDimLayout();
/**
 * 拖放模型后短暂忽略 click：浏览器在 dragend 之后仍可能冒泡一次 click。
 * 不可用「拖放全程锁死」——轻微拖动就会 dragstart，若用 setTimeout 清标志，
 * click 会在清之前被拦掉，表现为切几次模型后芯片再也点不动。
 */
let suppressPaletteClickUntil = 0;
let libraryCategory: LibraryCategory = "furniture";
let libraryGroup = "全部";
let libraryHtml = "";
let inspectorHtml = "";
let inspectorSelectionKey = "";
let inspectorFloating = false;
let planZoom = 1;
let initialPlanFit = true;
const planZoomMin = 0.5;
const planZoomMax = 3;
const planZoomStep = 0.25;
let showWallWidth = false;
let planEditorFocus = false;
/** 布局编辑连按 Esc：第二次在时限内则取消选中并回到「选择」工具。 */
let lastLayoutEscAt = 0;
const LAYOUT_DOUBLE_ESC_MS = 450;

function applyPlanZoom() {
  const scroll = $("plan-drawing");
  if (planMode === "2d" && scroll.querySelector(".editor-floor-svg")) {
    $<HTMLButtonElement>("plan-zoom-out").disabled = $<HTMLButtonElement>("plan-zoom-in").disabled = false;
    positionLayoutInspector();
    return;
  }
  scroll.style.setProperty("--plan-zoom", String(planZoom));
  const reset = document.getElementById("plan-zoom-reset");
  if (reset) reset.textContent = planMode === "3d" ? "适应" : `${Math.round(planZoom * 100)}%`;
  const out = document.getElementById("plan-zoom-out") as HTMLButtonElement | null;
  const inn = document.getElementById("plan-zoom-in") as HTMLButtonElement | null;
  if (out) out.disabled = planMode === "2d" && planZoom <= planZoomMin + 1e-6;
  if (inn) inn.disabled = planMode === "2d" && planZoom >= planZoomMax - 1e-6;
  positionLayoutInspector();
}

function syncWallWidthToggle() {
  const btn = document.getElementById("toggle-wall-width");
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(showWallWidth));
  btn.classList.toggle("active", showWallWidth);
}

function setPlanEditorFocus(on: boolean) {
  planEditorFocus = on;
  document.body.classList.toggle("plan-editor-focus", on);
  const btn = document.getElementById("plan-focus-toggle");
  if (btn) {
    btn.setAttribute("aria-pressed", String(on));
    btn.title = on ? "退出撑满" : "撑满编辑区域";
    btn.setAttribute("aria-label", on ? "退出撑满编辑区域" : "撑满编辑区域");
    btn.innerHTML = icon(on ? "close" : "expand");
  }
  if (on && tab !== "floor") switchTab("floor");
}

function setPlanZoom(next: number, anchor?: { clientX: number; clientY: number }) {
  const scroll = $("plan-drawing");
  if (planMode === "2d" && scroll.querySelector(".editor-floor-svg")) {
    planCanvas?.zoom(next > planZoom ? 1 / 1.2 : 1.2, anchor?.clientX, anchor?.clientY);
    return;
  }
  const clamped = Math.min(planZoomMax, Math.max(planZoomMin, Math.round(next / planZoomStep) * planZoomStep));
  if (Math.abs(clamped - planZoom) < 1e-6) {
    applyPlanZoom();
    return;
  }
  const before = planZoom;
  // 以指针（或视口中心）为锚，缩放后尽量保持该点仍在视野中。
  const rect = scroll.getBoundingClientRect();
  const cx = anchor ? anchor.clientX - rect.left : rect.width / 2;
  const cy = anchor ? anchor.clientY - rect.top : rect.height / 2;
  const contentX = (scroll.scrollLeft + cx) / before;
  const contentY = (scroll.scrollTop + cy) / before;
  planZoom = clamped;
  applyPlanZoom();
  const applyScroll = () => {
    const maxX = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const maxY = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    scroll.scrollLeft = Math.min(maxX, Math.max(0, contentX * planZoom - cx));
    scroll.scrollTop = Math.min(maxY, Math.max(0, contentY * planZoom - cy));
  };
  // 等宽度按 --plan-zoom 重算后再夹紧滚动，避免滚不到左右边缘。
  requestAnimationFrame(applyScroll);
}

/** 适应当前画布的宽、高；缩放只改变显示，不改变图纸尺寸。 */
function fitPlanToWindow() {
  const scroll = $("plan-drawing");
  if (scroll.querySelector(".editor-floor-svg")) { planCanvas?.fit(); return; }
  const sheets = scroll.querySelector<HTMLElement>(".plan-sheets");
  if (!sheets || scroll.clientHeight < 1) {
    setPlanZoom(1);
    scroll.scrollTo(0, 0);
    return;
  }
  const padding = getComputedStyle(scroll);
  const summary = scroll.querySelector<HTMLElement>(".plan-shared-dimensions");
  const summaryHeight = summary ? summary.offsetHeight + parseFloat(getComputedStyle(summary).marginBottom) : 0;
  const svgHeight = Math.max(...Array.from(sheets.querySelectorAll("svg.floor-svg"), svg => svg.getBoundingClientRect().height / planZoom));
  const headingHeight = Math.max(...Array.from(sheets.querySelectorAll<HTMLElement>(".plan-sheet-head"), heading => heading.offsetHeight));
  const available = scroll.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom) - summaryHeight - headingHeight;
  planZoom = Math.max(planZoomMin, Math.min(1, Math.floor(available / svgHeight * 100) / 100));
  applyPlanZoom();
  scroll.scrollTo(0, 0);
}
function toast(message: string) {
  if (!message.trim()) return;
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
const selectedCourtyardFinish = (id: string): CourtyardFinish =>
  parseCourtyardFinish(document.querySelector<HTMLInputElement>(`input[name="${id}-choice"]:checked`)?.value);
function applyCourtyardFinishInputs(own: CourtyardFinish, neighbor: CourtyardFinish) {
  $<HTMLInputElement>(`courtyard-finish-${own}`).checked = true;
  $<HTMLInputElement>(`neighbor-courtyard-finish-${neighbor}`).checked = true;
}
function setSchemeStatus(message: string) {
  const el = document.getElementById("scheme-persist-status");
  if (el) el.textContent = message;
}

let paramsPanelTrigger: HTMLElement | null = null;

/** 把尺寸面板吸附到顶栏「尺寸设置」Tab 正下方。 */
function positionParamsFloat() {
  const panel = document.getElementById("params-float");
  const toggle = document.getElementById("open-params-panel");
  const header = document.querySelector(".app-header");
  if (!panel || panel.hidden || !toggle || !header) return;
  const headerRect = header.getBoundingClientRect();
  const toggleRect = toggle.getBoundingClientRect();
  const margin = 12;
  const preferredWidth = Math.min(810, window.innerWidth - margin * 2);
  // 右对齐吸附在「尺寸设置」按钮下，向左展开以用满宽度
  const right = Math.min(window.innerWidth - margin, toggleRect.right);
  const left = Math.max(margin, right - preferredWidth);
  panel.style.top = `${Math.round(headerRect.bottom)}px`;
  panel.style.left = `${Math.round(left)}px`;
  panel.style.width = `${Math.round(Math.min(preferredWidth, window.innerWidth - left - margin))}px`;
  panel.style.maxHeight = `${Math.round(Math.max(240, window.innerHeight - headerRect.bottom - margin))}px`;
}

function setParamsPanelOpen(open: boolean) {
  const panel = document.getElementById("params-float");
  const toggle = document.getElementById("open-params-panel");
  if (!panel) return;
  if (open) {
    const active = document.activeElement;
    paramsPanelTrigger = active instanceof HTMLElement ? active : toggle;
  }
  panel.hidden = !open;
  if (toggle) {
    toggle.classList.toggle("active", open);
    toggle.setAttribute("aria-pressed", String(open));
  }
  if (open) {
    positionParamsFloat();
    syncVillaParamsWidthSum();
    const firstField = panel.querySelector<HTMLInputElement>("[data-villa-param]");
    firstField?.focus({ preventScroll: true });
  } else {
    paramsPanelTrigger?.focus({ preventScroll: true });
    paramsPanelTrigger = null;
  }
}

function collectSchemeDocument(title = "当前方案", id = "current"): SchemeDocument {
  return buildSchemeDocument({
    id,
    title,
    layoutDraft: loadLayoutDraft(),
    courtyardDimLayout: loadCourtyardDimLayout(),
    roofStyle,
    courtyardFinish: selectedCourtyardFinish("courtyard-finish"),
    neighborCourtyardFinish: selectedCourtyardFinish("neighbor-courtyard-finish"),
  });
}

function fillVersionSelect(select: HTMLSelectElement | null, index: DataVersionsIndex, emptyLabel: string) {
  if (!select) return;
  const current = select.value;
  select.innerHTML =
    `<option value="">${escapeHtml(emptyLabel)}</option>` +
    index.versions
      .map(
        (v) =>
          `<option value="${escapeHtml(v.file)}">${escapeHtml(v.title)} · ${escapeHtml(formatSavedAtDisplay(v.savedAt))}</option>`,
      )
      .join("");
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

async function refreshSizeVersionSelect(index?: DataVersionsIndex) {
  const data = index ?? (await loadDataVersionsIndex("尺寸"));
  fillVersionSelect(
    document.getElementById("scheme-version-select") as HTMLSelectElement | null,
    data,
    "（当前尺寸）",
  );
}

let layoutVersionsIndex = emptyDataIndex("户型");
let activeLayoutVersionFile = "";
function syncLayoutVersionActions() {
  for (const id of ["layout-version-select", "layout-new-version", "layout-copy-version", "layout-rename-version", "layout-delete-version", "layout-save"]) {
    const control = document.getElementById(id) as HTMLButtonElement | HTMLSelectElement | null;
    if (control) control.disabled = planLoadingTasks > 0 || (["layout-rename-version", "layout-delete-version"].includes(id) && !activeLayoutVersionFile);
  }
}
async function refreshLayoutVersionSelect(index?: DataVersionsIndex) {
  layoutVersionsIndex = index ?? (await loadDataVersionsIndex("户型"));
  const select = $("layout-version-select") as HTMLSelectElement;
  select.innerHTML = layoutVersionsIndex.versions.map(v =>
    `<option value="${escapeHtml(v.file)}">${escapeHtml(v.title)} · ${escapeHtml(formatSavedAtDisplay(v.savedAt))}</option>`).join("");
  if (!layoutVersionsIndex.versions.some(v => v.file === activeLayoutVersionFile)) {
    select.insertAdjacentHTML("afterbegin", '<option value="">（当前草稿）</option>');
    activeLayoutVersionFile = "";
  }
  select.value = activeLayoutVersionFile;
  syncLayoutVersionActions();
}

async function selectLayoutVersion(file: string, silent = false) {
  const doc = await loadLayoutVersion(file);
  if (!doc) throw new Error("载入户型版本失败，当前编辑已保留");
  await applyLayoutVersion(doc, silent);
  activeLayoutVersionFile = file;
  await refreshLayoutVersionSelect(layoutVersionsIndex);
  drawPlan();
}

async function runLayoutVersionTask(message: string, work: () => Promise<void>) {
  if (planLoadingTasks) return;
  try { await withPlanLoading(message, work); }
  catch (error) { toast(error instanceof Error ? error.message : "户型版本操作失败"); }
}

function currentLayoutDraft() {
  return layoutEditor?.draft ?? loadLayoutDraft() ?? clonePublishedLayout();
}

let layoutVersionAction: "new" | "copy" | "rename" = "new";
let layoutVersionDialogFile = "";
function openLayoutVersionDialog(action: typeof layoutVersionAction) {
  if (planLoadingTasks) return;
  layoutVersionAction = action;
  layoutVersionDialogFile = activeLayoutVersionFile;
  const current = layoutVersionsIndex.versions.find(v => v.file === activeLayoutVersionFile);
  if (action === "rename" && !current) return;
  $("layout-version-dialog-title").textContent = action === "new" ? "新增户型" : action === "copy" ? "复制户型" : "重命名户型";
  $("layout-version-dialog-note").textContent = action === "new"
    ? "保留当前建筑外轮廓、层高和外部门窗，清空三层及辅楼内部布局。当前版本保留。"
    : action === "copy" ? "复制当前三层及辅楼的完整户型，包含尚未保存的编辑。原版本保留。" : "只修改版本名称，编号、排序和图纸内容保持不变。";
  const input = $("layout-version-name") as HTMLInputElement;
  input.value = action === "rename" ? current!.title : suggestLayoutVersionName(action === "new" ? "新户型" : `${current?.title ?? "当前户型"} - 副本`, layoutVersionsIndex);
  $("layout-version-error").textContent = "";
  ($("layout-version-dialog") as HTMLDialogElement).showModal();
  input.focus();
  input.select();
}

async function submitLayoutVersionDialog(event: SubmitEvent) {
  event.preventDefault();
  if (planLoadingTasks) return;
  const dialog = $("layout-version-dialog") as HTMLDialogElement;
  const submit = $("layout-version-submit") as HTMLButtonElement;
  const cancel = $("layout-version-cancel") as HTMLButtonElement;
  try {
    const title = layoutVersionName(($("layout-version-name") as HTMLInputElement).value);
    submit.disabled = cancel.disabled = true;
    await withPlanLoading("正在保存户型版本…", async () => {
      const index = await loadDataVersionsIndex("户型");
      if (layoutVersionAction === "rename") {
        const original = await loadLayoutVersion(layoutVersionDialogFile);
        if (!original) throw new Error("载入原版本失败，未修改名称");
        const renamed = renameLayoutVersion(original, index, layoutVersionDialogFile, title);
        const result = await persistDataVersion({ kind: "户型", ...renamed });
        if (!result.ok) throw new Error(result.message);
        await refreshLayoutVersionSelect(renamed.index);
        drawPlan();
        toast(result.via === "api" ? `已重命名为「${title}」` : result.message);
      } else {
        const source = currentLayoutDraft();
        const draft = layoutVersionAction === "new" ? blankLayoutDraft(source) : source;
        const doc = createLayoutVersion(draft, title, index);
        const nextIndex = prependVersionMeta(index, { id: doc.id, title: doc.title, savedAt: doc.savedAt, file: `${doc.id}.json` });
        const result = await persistDataVersion({ kind: "户型", document: doc, index: nextIndex });
        if (!result.ok) throw new Error(result.message);
        if (level < 0) level = 0;
        await applyLayoutVersion(doc, true);
        activeLayoutVersionFile = `${doc.id}.json`;
        await refreshLayoutVersionSelect(nextIndex);
        setLayoutEditing(true);
        toast(result.via === "api" ? `已${layoutVersionAction === "new" ? "新增" : "复制"}户型「${title}」` : result.message);
      }
      dialog.close();
    });
  } catch (error) {
    $("layout-version-error").textContent = error instanceof Error ? error.message : "户型版本保存失败";
  } finally { submit.disabled = cancel.disabled = false; }
}

async function applySchemeDocument(doc: SchemeDocument, options?: { toastMsg?: string }) {
  replaceCourtyardDimLayout(doc.courtyardDimLayout);
  courtyardDimLayout = loadCourtyardDimLayout();
  replaceLayoutDraftMemory(doc.layoutDraft);
  roofStyle = doc.roofStyle;
  applyCourtyardFinishInputs(doc.courtyardFinish, doc.neighborCourtyardFinish);
  document.querySelectorAll<HTMLButtonElement>("[data-roof-style]").forEach((btn) => {
    const on = btn.dataset.roofStyle === roofStyle;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  await commitVillaParams(doc.villaParams, { persist: false, toastMsg: options?.toastMsg || "" });
  viewer?.setState({
    roofStyle: doc.roofStyle,
    courtyardFinish: doc.courtyardFinish,
    neighborCourtyardFinish: doc.neighborCourtyardFinish,
  });
  updateScene();
  drawPlan();
  setSchemeStatus(`已载入：${doc.title}（${formatSavedAtDisplay(doc.savedAt, true)}）`);
}

async function applySizeVersion(doc: SizeVersionDocument, options?: { toastMsg?: string }) {
  replaceCourtyardDimLayout(doc.courtyardDimLayout);
  courtyardDimLayout = loadCourtyardDimLayout();
  roofStyle = doc.roofStyle;
  applyCourtyardFinishInputs(doc.courtyardFinish, doc.neighborCourtyardFinish);
  document.querySelectorAll<HTMLButtonElement>("[data-roof-style]").forEach((btn) => {
    const on = btn.dataset.roofStyle === roofStyle;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  await commitVillaParams(doc.villaParams, { persist: false, toastMsg: options?.toastMsg });
  viewer?.setState({
    roofStyle: doc.roofStyle,
    courtyardFinish: doc.courtyardFinish,
    neighborCourtyardFinish: doc.neighborCourtyardFinish,
  });
  updateScene();
  drawPlan();
  setSchemeStatus(`已载入尺寸：${doc.title}（${formatSavedAtDisplay(doc.savedAt, true)}）`);
}

async function applyLayoutVersion(doc: LayoutVersionDocument, silent = false) {
  replaceLayoutDraftMemory(doc.layoutDraft);
  if (layoutEditor) {
    layoutEditor.setTool("select");
    layoutEditor.loadDraft(doc.layoutDraft);
  }
  drawPlan();
  await applyLayoutDraftTo3d();
  if (!silent) toast(`已载入户型版本：${doc.title}（一二三楼）`);
}

async function saveSchemeCurrent() {
  if (hasPendingVillaParamChanges()) {
    toast("尺寸设置有未应用的修改，请先点「应用」再保存");
    return;
  }
  try {
    const doc = collectSchemeDocument("当前方案", "current");
    const result = await persistSchemeFile("current", doc);
    setSchemeStatus(result.message);
    toast(result.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "当前方案保存失败";
    setSchemeStatus(message);
    toast(message);
  }
}

/** 尺寸设置「保存版本」→ data/尺寸/，自动中文前缀＋日期编号。 */
async function saveSizeVersion() {
  try {
    if (hasPendingVillaParamChanges()) {
      toast("尺寸设置有未应用的修改，请先点「应用」再保存版本");
      return;
    }
    const title = makeDataVersionTitle("尺寸");
    const doc = buildSizeVersionDocument({
      id: title,
      title,
      courtyardDimLayout: loadCourtyardDimLayout(),
      roofStyle,
      courtyardFinish: selectedCourtyardFinish("courtyard-finish"),
      neighborCourtyardFinish: selectedCourtyardFinish("neighbor-courtyard-finish"),
    });
    const index = await loadDataVersionsIndex("尺寸");
    const nextIndex = prependVersionMeta(index, {
      id: doc.id,
      title: doc.title,
      savedAt: doc.savedAt,
      file: `${doc.id}.json`,
    });
    const result = await persistDataVersion({ kind: "尺寸", document: doc, index: nextIndex });
    await refreshSizeVersionSelect(nextIndex);
    setSchemeStatus(result.message);
    toast(result.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "尺寸版本保存失败";
    setSchemeStatus(message);
    toast(message);
  }
}

async function deleteSizeVersion() {
  const select = document.getElementById("scheme-version-select") as HTMLSelectElement | null;
  const file = select?.value;
  if (!file) {
    toast("请先选择要删除的尺寸版本");
    return;
  }
  const label = select?.selectedOptions[0]?.textContent?.trim() || file;
  if (!window.confirm(`确定删除尺寸版本「${label}」？将从仓库 data/尺寸/ 去掉该文件，不可撤销。`)) return;
  try {
    const index = await loadDataVersionsIndex("尺寸");
    const nextIndex = removeVersionMeta(index, file);
    const result = await deleteDataVersion({ kind: "尺寸", file, index: nextIndex });
    await refreshSizeVersionSelect(nextIndex);
    if (select) select.value = "";
    setSchemeStatus(result.message);
    toast(result.message);
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除尺寸版本失败");
  }
}

async function deleteLayoutVersion() {
  if (planLoadingTasks || !activeLayoutVersionFile) return;
  const file = activeLayoutVersionFile;
  const title = layoutVersionsIndex.versions.find(v => v.file === file)?.title ?? file;
  if (!window.confirm(`确定删除户型版本「${title}」？一二三楼一体删除，不可撤销。`)) return;
  await runLayoutVersionTask("正在删除户型版本…", async () => {
    const index = await loadDataVersionsIndex("户型");
    const nextIndex = removeVersionMeta(index, file);
    const result = await deleteDataVersion({ kind: "户型", file, index: nextIndex });
    if (!result.ok) throw new Error(result.message);
    activeLayoutVersionFile = "";
    await refreshLayoutVersionSelect(nextIndex);
    if (nextIndex.versions[0]) await selectLayoutVersion(nextIndex.versions[0].file, true);
    $("layout-save-status").textContent = result.message;
    toast(result.message);
  });
}

/** 保存当前三层户型；新增与复制通过独立入口创建，避免误覆盖。 */
async function saveLayoutVersion() {
  if (planLoadingTasks) return;
  const button = $("layout-save") as HTMLButtonElement;
  button.disabled = true;
  const status = $("layout-save-status");
  status.textContent = "正在保存户型版本…";
  try {
    layoutEditor?.saveNow({ silent: true });
    const draft = currentLayoutDraft();
    const index = await loadDataVersionsIndex("户型");
    const existing = index.versions.find(v => v.file === activeLayoutVersionFile);
    if (activeLayoutVersionFile && !existing) throw new Error("当前版本已不存在，请通过「复制」另存为新版本");
    const doc = existing
      ? buildLayoutVersionDocument(draft, { id: existing.id, title: existing.title })
      : createLayoutVersion(draft, makeDataVersionTitle("户型"), index);
    const file = existing?.file ?? `${doc.id}.json`;
    const nextIndex = prependVersionMeta(index, { id: doc.id, title: doc.title, savedAt: doc.savedAt, file });
    const result = await persistDataVersion({ kind: "户型", document: doc, index: nextIndex });
    if (!result.ok) throw new Error(result.message);
    activeLayoutVersionFile = file;
    await refreshLayoutVersionSelect(nextIndex);
    const message = result.via === "api" ? `已保存户型版本「${doc.title}」` : result.message;
    status.textContent = message;
    toast(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "户型版本保存失败";
    status.textContent = message;
    toast(message);
  } finally {
    button.disabled = !layoutEditing;
  }
}

async function resetSchemeToInitial() {
  const ok = window.confirm("确定恢复默认方案？将还原写死的默认尺寸，并清空布局草稿与院坪标注偏移。不会保存文件。");
  if (!ok) return;
  const doc = resetSchemeDocument();
  clearLayoutDraft();
  clearCourtyardDimLayout();
  courtyardDimLayout = {};
  await applySchemeDocument(doc, { toastMsg: "正在恢复默认方案…" });
  setSchemeStatus("已恢复默认方案（未写入文件）");
  toast("已恢复默认方案");
}
function renderFacts() {
  $("fact-list").innerHTML = facts
    .filter((f) => !checked("pending-only") || f.source === "待测")
    .map(
      (f) =>
        `<div class="fact-row"><div><strong>${f.label}</strong><span class="evidence ${f.source === "用户提供" ? "user" : f.source === "照片估算" ? "photo" : f.source === "设计建议" ? "design" : "pending"}">${f.source}</span></div><b>${f.value}</b><p>${f.note}</p></div>`,
    )
    .join("");
}

function refreshAreaMetrics() {
  const p = getVillaParams();
  const main = buildingAreas.main;
  const annex = buildingAreas.annex;
  const total = buildingAreas.total;
  const areaNumber = document.getElementById("area-number");
  if (areaNumber) areaNumber.innerHTML = `${total.toFixed(1)}<span>m²</span>`;
  const caption = document.getElementById("area-caption");
  if (caption) caption.textContent = `主楼 ${main.toFixed(1)}㎡ ＋ 辅楼 ${annex.toFixed(1)}㎡ ＋ 门厅 ${buildingAreas.portico.toFixed(1)}㎡`;
  const micro = document.getElementById("area-micro");
  if (micro) {
    micro.textContent = site.porticoStyle === "recessed" ? "首层建筑面积合计 · 主楼扣凹口后门厅计入一次 · 全楼各层总面积另行汇总" : "首层建筑面积合计 · 已含外伸门厅 · 全楼各层总面积另行汇总";
  }
  renderFacts();
  const metrics = document.getElementById("metric-list");
  if (metrics) {
    metrics.innerHTML = [
      ["总面宽", formatMm(LOCKED_SITE_WIDTH)],
      ["主楼", `${formatMm(p.mainWidth)} × ${formatMm(p.mainDepth)}`],
      ["辅楼", `${formatMm(p.annexWidth)} × ${formatMm(p.annexDepth)} · 内退${formatMm(p.annexSetback)}`],
      ["子孙道", formatMm(p.lane)],
      ["三楼模式", p.thirdFloorMode === "flush" ? "不内退" : `北向内退 ${formatMm(p.thirdSetback)}`],
      [p.porticoStyle === "recessed" ? "门厅凹入" : "门厅外伸", formatMm(p.porticoProjection)],
      ["二楼前檐", formatMm(p.secondFrontEave)],
      ["三楼四面檐", formatMm(p.thirdEave)],
      ["右端人行通道", "约 2000"],
    ]
      .map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`)
      .join("");
  }
}

function syncVillaParamsWidthSum() {
  // 只更新合计／校验文案，绝不 fill 回写输入框，否则小数点和光标会被冲掉。
  const params = readVillaParamsFromDom();
  updateVillaParamsMeta(params);
  const issues = validateVillaParams(params);
  const err = document.getElementById("villa-params-error");
  const applyBtn = document.getElementById("villa-params-apply") as HTMLButtonElement | null;
  if (err) {
    if (issues.length) {
      err.hidden = false;
      err.textContent = issues.map((i) => i.message).join("；");
    } else {
      err.hidden = true;
      err.textContent = "";
    }
  }
  if (applyBtn) applyBtn.disabled = issues.length > 0;
}

function syncFenShuiInputs(value: number) {
  for (const id of ["fen-shui", "fen-shui-number"]) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = String(value);
  }
  const out = document.getElementById("fen-shui-output");
  if (out) out.textContent = String(Math.round(value * 10) / 10);
}

function rescaleStoredLayoutDraft(): LayoutDraft | null {
  const draft = loadLayoutDraft();
  if (!draft) return null;
  const next = scaleLayoutDraftToEnvelope(draft, envelopeFromSite());
  saveLayoutDraft(next);
  if (layoutEditor) layoutEditor.loadDraft(next);
  return next;
}

/** 版本载入及立体更新共用遮罩与绘制时序。 */
let planLoadingTasks = 0;
async function withPlanLoading<T>(message: string, work: () => Promise<T> | T): Promise<T> {
  planLoadingTasks++;
  syncLayoutVersionActions();
  try {
    return await withLoadingOverlay($("plan-loading"), message, work);
  } finally {
    planLoadingTasks--;
    syncLayoutVersionActions();
  }
}

async function withVillaParamsBusy(message: string, work: () => void | Promise<void>) {
  const section = document.getElementById("villa-params-section");
  const applyBtn = document.getElementById("villa-params-apply") as HTMLButtonElement | null;
  const actionBtns = [
    applyBtn,
    ...document.querySelectorAll<HTMLButtonElement>("[data-building-variant]"),
    document.getElementById("villa-params-reset"),
    document.getElementById("scheme-save-current"),
    document.getElementById("scheme-save-version"),
    document.getElementById("scheme-load-version"),
  ].filter((el): el is HTMLButtonElement => el instanceof HTMLButtonElement);
  const busy = document.getElementById("villa-params-busy");
  const applyLabel = applyBtn?.textContent ?? "应用参数";
  section?.classList.add("is-busy");
  if (busy) {
    busy.hidden = false;
    busy.textContent = message;
  }
  for (const btn of actionBtns) btn.disabled = true;
  if (applyBtn) applyBtn.textContent = "重建中…";
  try {
    const overlay = isSceneVisible() ? $("scene-loading") : $("plan-loading");
    await withLoadingOverlay(overlay, message, work);
  } finally {
    section?.classList.remove("is-busy");
    if (busy) busy.hidden = true;
    for (const btn of actionBtns) btn.disabled = false;
    if (applyBtn) {
      applyBtn.textContent = applyLabel;
      applyBtn.disabled = validateVillaParams(readVillaParamsFromDom()).length > 0;
    }
  }
}

async function commitVillaParams(params: VillaParams, options?: { persist?: boolean; toastMsg?: string }) {
  const issues = validateVillaParams(params);
  if (issues.length) {
    const err = document.getElementById("villa-params-error");
    if (err) {
      err.hidden = false;
      err.textContent = issues.map((i) => i.message).join("；");
    }
    toast(issues[0]?.message ?? "参数未通过校验");
    return false;
  }
  let draftRescaled = false;
  await withVillaParamsBusy(options?.toastMsg?.includes("恢复") ? "正在恢复方案尺寸…" : "正在应用方案尺寸…", () => {
    const wasEditing = layoutEditing;
    if (wasEditing) setLayoutEditing(false);
    applyVillaParams(params);
    const applied = getVillaParams();
    if (options?.persist !== false) saveVillaParams(applied);
    fillVillaParamsDom(applied, document, { force: true });
    syncFenShuiInputs(applied.roofFenShui);
    const pitched = roofPitch(params.roofFenShui);
    $("fen-shui-result").textContent =
      `主楼升高 ${formatMm(pitched.mainRise)}，半坡 ${formatMm(pitched.mainRun)}。辅楼升高 ${formatMm(pitched.annexRise)}，半坡 ${formatMm(pitched.annexRun)}（mm）。`;
    const scaledDraft = rescaleStoredLayoutDraft();
    draftRescaled = !!scaledDraft;
    sceneUpdates.invalidate();
    refreshAreaMetrics();
    updateScene();
    drawPlan();
    syncVillaParamsWidthSum();
  });
  if (!await syncLayoutTo3d()) return false;
  if (options?.toastMsg !== "") {
    toast(
      options?.toastMsg ??
        (draftRescaled ? "已应用方案尺寸；布局草稿已随方案参数重算" : "已应用方案尺寸"),
    );
  }
  return true;
}
function parseLayoutNumber(raw: string): number | null {
  const text = raw.trim().replace(/[，．。]/g, ".").replace(/[^\d.\-]/g, "");
  if (!text || text === "-" || text === "." || text === "-.") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function refreshLayoutInspector(force = false) {
  const panel = $("layout-inspector");
  const hasSelection = !!(layoutEditor && layoutEditing && layoutEditor.selection);
  const nextSelectionKey = selectionKey(layoutEditing ? layoutEditor?.selection ?? null : null);
  if (nextSelectionKey && nextSelectionKey !== inspectorSelectionKey && !inspectorFloating) $("designer-properties").scrollTop = 0;
  inspectorSelectionKey = nextSelectionKey;
  $("designer-inspector-empty").hidden = hasSelection && !inspectorFloating;
  $("designer-inspector-empty").querySelector("span")!.textContent = hasSelection && inspectorFloating
    ? "属性已浮动，可拖动标题栏"
    : "选择画布中的对象以编辑属性";
  if (!layoutEditor || !layoutEditing || !layoutEditor.selection) {
    stopLayoutInspectorDrag();
    panel.innerHTML = "";
    inspectorHtml = "";
    panel.hidden = true;
    return;
  }
  // 仅在有选中对象时展示属性条，避免空提示占高度
  const html = layoutEditor.inspectorHtml().replace(
    'title="拖动标题栏以移动属性面板"',
    `title="${inspectorFloating ? "拖动标题栏以移动属性面板" : "对象属性"}"`,
  );
  // 比较模板缓存，保留正在输入的 DOM；浏览器会规范化 input 等标签。
  if (force || inspectorHtml !== html) {
    panel.innerHTML = html;
    inspectorHtml = html;
  }
  panel.hidden = false;
  positionLayoutInspector();
}

/** 为长属性面板预留滚动空间，并避开顶部操作条／模型面板。 */
function layoutInspectorBounds(panel: HTMLElement, wrap: HTMLElement) {
  const rect = wrap.getBoundingClientRect();
  const minTop = 8;
  panel.style.maxHeight = `${Math.max(0, rect.height - minTop - 8)}px`;
  return {
    minTop,
    maxTop: Math.max(minTop, rect.height - panel.offsetHeight - 8),
    maxLeft: Math.max(8, rect.width - panel.offsetWidth - 8),
  };
}

function placeLayoutInspector(
  panel: HTMLElement,
  position: LayoutInspectorPosition,
  bounds: ReturnType<typeof layoutInspectorBounds>,
): LayoutInspectorPosition {
  const left = Math.round(Math.max(8, Math.min(position.left, bounds.maxLeft)));
  const top = Math.round(Math.max(bounds.minTop, Math.min(position.top, bounds.maxTop)));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  return { left, top };
}

function stopLayoutInspectorDrag() {
  if (!layoutInspectorDrag) return;
  const { pointerId } = layoutInspectorDrag;
  layoutInspectorDrag = null;
  const panel = $("layout-inspector");
  panel.classList.remove("is-dragging");
  if (panel.hasPointerCapture(pointerId)) panel.releasePointerCapture(pointerId);
}

/** 初次贴着选中模型定位；手动拖动后，重绘、缩放与切换模型均保留位置。 */
function positionLayoutInspector() {
  const panel = $("layout-inspector");
  if (panel.hidden || !inspectorFloating) return;
  const wrap = document.querySelector<HTMLElement>(".designer-canvas");
  if (!wrap) return;
  const place = () => {
    if (panel.hidden || wrap.offsetWidth < 8) return;
    const bounds = layoutInspectorBounds(panel, wrap);
    if (layoutInspectorPosition) {
      layoutInspectorPosition = placeLayoutInspector(panel, layoutInspectorPosition, bounds);
      return;
    }
    const marks = wrap.querySelectorAll(".edit-selection");
    const wrapRect = wrap.getBoundingClientRect();
    const gap = 10;
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    if (pw < 8 || ph < 8) return;
    let left = wrapRect.width - pw - 12;
    let top = 12;
    if (marks.length) {
      let minL = Infinity;
      let minT = Infinity;
      let maxR = -Infinity;
      let maxB = -Infinity;
      marks.forEach((el) => {
        const r = el.getBoundingClientRect();
        minL = Math.min(minL, r.left);
        minT = Math.min(minT, r.top);
        maxR = Math.max(maxR, r.right);
        maxB = Math.max(maxB, r.bottom);
      });
      const selL = minL - wrapRect.left;
      const selT = minT - wrapRect.top;
      const selR = maxR - wrapRect.left;
      const selB = maxB - wrapRect.top;
      left = selR + gap;
      top = selT;
      if (left + pw > wrapRect.width - 8) left = selL - gap - pw;
      if (left < 8) {
        left = Math.max(8, Math.min(selL, wrapRect.width - pw - 8));
        top = selB + gap;
      }
    }
    placeLayoutInspector(panel, { left, top }, bounds);
  };
  requestAnimationFrame(place);
}

/** 把编辑条实高写入 CSS 变量，模型面板才能贴齐其下沿。 */
function syncLayoutChromeHeight() {
  const wrap = document.querySelector<HTMLElement>(".plan-canvas-wrap");
  const bar = document.getElementById("layout-edit-bar");
  if (!wrap) return;
  const h = bar && !bar.hidden ? Math.ceil(bar.getBoundingClientRect().height) : 0;
  wrap.style.setProperty("--layout-edit-bar-h", `${h || 48}px`);
}

function syncLayoutPalette() {
  const palette = $("layout-palette");
  const chips = $("layout-palette-chips");
  const label = $("layout-palette-label");
  const hint = $("layout-palette-hint");
  const setExpanded = (id: string, on: boolean) => {
    const btn = document.getElementById(id);
    if (btn) btn.setAttribute("aria-expanded", String(on));
  };
  setExpanded("tool-room", false);
  setExpanded("tool-door", false);
  setExpanded("tool-furniture", false);
  setExpanded("tool-wall", false);
  if (drawingView !== "floor" || level < 0) {
    palette.hidden = true;
    syncLayoutChromeHeight();
    return;
  }
  const tool = layoutEditing ? layoutEditor?.tool ?? "select" : "select";
  if (tool !== "select") libraryCategory = tool;
  palette.hidden = false;
  active("[data-edit-tool]", (b) => b.dataset.editTool === tool);
  const category = libraryCategory;
  let items: { value: string; text: string; active: boolean }[] = [];
  if (category === "room") {
    label.textContent = "房间库";
    hint.textContent = "选择后点击画布或拖入放置；楼梯为整套模型（一二三层同步），其它为房间框";
    setExpanded("tool-room", true);
    items = roomKindOptions.map(([value, text]) => ({
      value,
      text,
      active: tool === "room" && layoutEditor?.roomKind === (value === "stair-triple" ? "stair" : value) && (!value.startsWith("stair") || layoutEditor?.stairModel === (value === "stair-triple" ? "triple" : "double")),
    }));
  } else if (category === "wall") {
    label.textContent = "墙体库";
    hint.textContent = planMode === "3d"
      ? "选择后点击或拖入场景放置；墙端点与虚拟分界在 2D 中调整"
      : "拖放后拉端点，或在图上点两点绘制；虚拟墙用细灰虚线划分开放区域并标尺寸";
    setExpanded("tool-wall", true);
    items = [
      { value: "partition", text: "隔墙", active: tool === "wall" && layoutEditor?.wallRole === "partition" },
      { value: "bearing", text: "承重墙", active: tool === "wall" && layoutEditor?.wallRole === "bearing" },
      { value: "virtual", text: "虚拟墙", active: tool === "wall" && layoutEditor?.wallRole === "virtual" },
    ];
  } else if (category === "door") {
    label.textContent = "门窗库";
    hint.textContent = "选择后点击或拖到隔墙、外墙附近；放下后可改开向、宽度";
    setExpanded("tool-door", true);
    items = OPENING_KINDS.map((value) => ({
      value,
      text: openingLabels[value],
      active: tool === "door" && layoutEditor?.openingKind === value,
    }));
  } else {
    label.textContent = "家具库";
    hint.textContent = planMode === "3d"
      ? "选择后点击或拖入场景放置；选中家具后拖动摆放，在右侧调整尺寸与旋转"
      : "拖到平面图放置；放下后拖四角缩放、拖蓝点旋转";
    setExpanded("tool-furniture", true);
    items = furniturePickerOrder.map((value) => ({
      value,
      text: furnitureLabels[value],
      active: tool === "furniture" && layoutEditor?.furnitureKind === value,
    }));
  }
  const html = libraryCardsHtml(category, items);
  // SVG 在 DOM 序列化时会改写自闭合标签；比较原始模板，避免每帧替换素材节点。
  if (libraryHtml !== html) {
    chips.innerHTML = html;
    libraryHtml = html;
  }
  $("designer-library-filters").hidden = category !== "furniture";
  filterDesignerLibrary();
  requestAnimationFrame(syncLayoutChromeHeight);
}
function filterDesignerLibrary() {
  const query = $<HTMLInputElement>("designer-library-search").value.trim().toLowerCase();
  let visible = 0;
  $("layout-palette-chips").querySelectorAll<HTMLElement>("[data-palette-kind]").forEach(chip => {
    chip.hidden = !(chip.dataset.librarySearch?.toLowerCase().includes(query) &&
      (libraryCategory !== "furniture" || libraryGroup === "全部" || chip.dataset.libraryGroupName === libraryGroup));
    if (!chip.hidden) visible++;
  });
  $("designer-library-count").textContent = `${visible} 项`;
  $("designer-library-empty").hidden = visible > 0;
}

function selectDesignerRoom(id: string, annex: boolean) {
  if (!layoutEditing) setLayoutEditing(true);
  if (!layoutEditor) return;
  const rooms = annex ? layoutEditor.draft.annexRooms : layoutEditor.draft.floors[level].rooms;
  const room = rooms.find(room => room.id === id);
  if (!room) return;
  layoutEditor.setTool("select");
  layoutEditor.selection = room.kind === "stair" && !annex
    ? { kind: "stair" }
    : { kind: "room", id, floor: level, annex };
  drawPlan();
}

function syncEditorSelection() {
  const bar = $("editor-selection-bar");
  const selection = layoutEditing ? layoutEditor?.selection : null;
  bar.hidden = !selection || drawingView !== "floor" || level < 0;
  if (!selection || !layoutEditor) return;
  const draft = layoutEditor.draft;
  const selectedRoom = selection.kind === "room" ? (selection.annex ? draft.annexRooms : draft.floors[selection.floor].rooms).find(room => room.id === selection.id) : undefined;
  let name = "", detail = "";
  if (selection.kind === "furniture") {
    const item = (selection.annex ? draft.annexFurniture : draft.floors[selection.floor].furniture)[selection.index];
    if (item) { name = item.label || furnitureLabels[item.kind]; detail = `${Math.round(item.w)} × ${Math.round(item.d)}`; }
  } else if (selection.kind === "room") {
    name = selectedRoom?.name ?? "房间";
  } else if (selection.kind === "wall") {
    const wall = (selection.annex ? draft.annexPartitions : draft.floors[selection.floor].partitions)[selection.index];
    name = wall?.role === "virtual" ? "虚拟墙" : wall?.role === "bearing" ? "承重墙" : "隔墙";
    if (wall) detail = `${Math.round(Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]))}`;
  } else name = selection.kind === "stair" ? "楼梯" : selection.kind === "portico" ? "门厅" : "门窗";
  $("editor-selection-title").textContent = layoutEditor.selections.length > 1
    ? `已选 ${layoutEditor.selections.length} 项` : [name, detail].filter(Boolean).join(" · ");
  for (const button of bar.querySelectorAll<HTMLButtonElement>("[data-editor-action]")) {
    const action = button.dataset.editorAction;
    button.hidden = (action === "rotate-left" || action === "rotate-right") ? selection.kind !== "furniture" || layoutEditor.selections.length !== 1
      : action === "duplicate" ? selection.kind === "stair" || selection.kind === "portico" || selection.kind === "door" || selectedRoom?.kind === "void"
      : action === "delete" && selection.kind === "portico";
  }
}

function syncDesignerOverview(source: ReturnType<typeof planSourceFromPublished>) {
  const selection = layoutEditing ? layoutEditor?.selection : null;
  const selectedRoomId = selection?.kind === "stair"
    ? source.floor.rooms.find(room => room.kind === "stair")?.id
    : selection?.kind === "room" ? selection.id : undefined;
  const html = designerRoomListHtml(source, level, selectedRoomId, selection?.kind === "room" && !!selection.annex);
  if ($("designer-room-list").innerHTML !== html) $("designer-room-list").innerHTML = html;
  const furnitureCount = source.floor.furniture.length + (level === 0 ? source.annexFurniture.length : 0);
  const wallCount = source.floor.partitions.length + (level === 0 ? source.annexPartitions.length : 0);
  $("designer-plan-stats").innerHTML = `<div><small>本层家具</small><b>${furnitureCount}</b></div><div><small>本层内墙／分界</small><b>${wallCount}</b></div>`;
  $("designer-building-area").textContent = level === 0 ? `首层建筑面积（含门厅）${buildingAreas.total.toFixed(1)}㎡，报建面积以核定为准。` : "房间面积按当前楼层统计，挑空不计入房间清单。";
  for (const button of document.querySelectorAll<HTMLElement>("[data-designer-display]")) {
    button.setAttribute("aria-pressed", String(checked(button.dataset.designerDisplay!)));
  }
  $<HTMLSelectElement>("designer-dining-mode").value = $<HTMLSelectElement>("dining-mode").value;
  $<HTMLSelectElement>("designer-dining-mode").disabled = level !== 0 || planMode === "3d";
  $<HTMLButtonElement>("layout-save").disabled = !layoutEditing;
}
const planRedraw = new FrameRedraw(() => {
  if (tab === "floor") drawPlan();
});
let boundPlanSvgs: SVGSVGElement[] = [];
function drawPlan() {
  planRedraw.clear();
  const specialDrawing = drawingView !== "floor" || level < 0;
  $("plan-panel").dataset.editorCanvas = String(!specialDrawing);
  $("editor-plan-tools").hidden = specialDrawing || planMode === "3d";
  $("editor-plan-scale").hidden = specialDrawing || planMode === "3d";
  $("editor-auto-annex").hidden = level !== 0;
  $("plan-panel").classList.toggle("is-special-drawing", specialDrawing);
  for (const id of ["layout-export", "layout-reset", "layout-import"]) $<HTMLButtonElement | HTMLInputElement>(id).disabled = specialDrawing;
  $("plan-panel").classList.toggle("is-editing", layoutEditing);
  const sharedDimensionsOpen = $("plan-drawing").querySelector<HTMLDetailsElement>(".plan-shared-dimensions")?.open ?? false;
  unbindCourtyardDims?.();
  unbindCourtyardDims = null;
  $("floor-room-options").hidden = drawingView !== "floor";
  if (drawingView !== "floor") {
    layoutEditing = false;
    unbindLayoutEditor?.();
    unbindLayoutEditor = null;
    boundPlanSvgs = [];
    const draft = loadLayoutDraft();
    const layout = draft ? villaLayoutFromDraft(draft) : null;
    const elevation = drawingView === "elevation";
    patchPlanDrawing($("plan-drawing"), elevation ? elevationPlan(elevationView, roofStyle, layout, balcony) : roofPlan(roofDrawingView, roofStyle, layout));
    active("[data-floor]", () => false);
    active("[data-roof-plan]", () => !elevation);
    active("[data-elevation-plan]", () => elevation);
    document.querySelectorAll<HTMLInputElement>('input[name="floor"]').forEach(input => { input.checked = false; });
    for (const id of ["layout-edit-bar", "layout-palette", "layout-inspector", "toggle-layout-edit", "toggle-wall-width", "room-detail", "dining-check"]) $(id).hidden = true;
    $("toggle-layout-edit").setAttribute("aria-pressed", "false");
    document.querySelector<HTMLElement>(".layout-version-label")!.hidden = false;
    $("floor-summary-title").textContent = elevation ? elevationLabels[elevationView] : roofDrawingLabels[roofDrawingView];
    $("floor-summary").textContent = elevation
      ? "四向立面采用正投影，北侧为正门。展示当前主辅楼、外部门窗、门厅、三楼退台模式、露台、屋面与烟囱，标注层高、控制尺寸及相对标高。图纸与当前尺寸及户型草稿联动，细部简化，非施工图。"
      : "三层为现有顶层；屋顶层图补充三层顶板与下层露台的关系，两种官帽图显示外露坡面和真实交线。图纸随当前尺寸与门厅草稿联动，可下载 SVG。屋面排水、防水及结构仍需专业深化。";
    $("plan-orient-hint").textContent = elevation ? "正投影 · 单位 mm" : "南 ↑ · 西 →";
    $("plan-orient-hint").title = elevation ? "四向建筑立面 · 当前方案" : "屋面设计图 · 单位 mm · 门头朝下";
    applyPlanZoom();
    return;
  }
  active("[data-roof-plan]", () => false);
  active("[data-elevation-plan]", () => false);
  const sitePlan = level < 0;
  if (sitePlan && layoutEditing) layoutEditing = false;

  if (sitePlan) {
    unbindLayoutEditor?.();
    unbindLayoutEditor = null;
    boundPlanSvgs = [];
    $("plan-drawing").innerHTML = courtyardSitePlan(courtyardDimLayout);
    syncWallWidthToggle();
    active("[data-floor]", (b) => Number(b.dataset.floor) === level);
    document.querySelectorAll<HTMLInputElement>('input[name="floor"]').forEach((input) => {
      input.checked = false;
    });
    $("floor-summary-title").textContent = "院坪 · 自家与邻居总图";
    $("floor-summary").textContent =
      "只画主楼、辅楼、过道与门厅外轮廓，不画室内布局。尺寸线可拖：黄点固定在被量边上，虚线可拉长或翻到另一侧，文字紧贴尺寸线；位置记在本浏览器。外沿按口述三点过圆：东界总进深19400、中约15800、西端11000（均含屋后到水泥边10800；单位 mm）。主辅楼位置、门厅造型及内退取当前参数。邻居占位面宽13000、进深10800，水泥外院坪北缘与自家东界外沿齐平、不再北伸。待现场复核。";
    $("room-detail").hidden = true;
    $("room-detail").replaceChildren();
    $("dining-check").hidden = true;
    $("layout-edit-bar").hidden = true;
    $("toggle-layout-edit").hidden = true;
    $("toggle-wall-width").hidden = true;
    const layoutVersionLabel = document.querySelector<HTMLElement>(".layout-version-label");
    if (layoutVersionLabel) layoutVersionLabel.hidden = true;
    $("toggle-layout-edit").setAttribute("aria-pressed", "false");
    $("toggle-layout-edit").classList.remove("active");
    $("toggle-layout-edit").textContent = "编辑布局";
    syncLayoutPalette();
    const courtyardSvg = $("plan-drawing").querySelector("svg.courtyard-site-svg") as SVGSVGElement | null;
    if (courtyardSvg) {
      unbindCourtyardDims = bindCourtyardDimDrag(
        courtyardSvg,
        () => courtyardDimLayout,
        (next) => {
          courtyardDimLayout = next;
        },
      );
    }
    requestAnimationFrame(() => {
      syncLayoutChromeHeight();
      positionLayoutInspector();
    });
    const orient = document.getElementById("plan-orient-hint");
    if (orient) {
      orient.textContent = "北 ↑ · 东 →";
      orient.title = "院坪总图 · 北向上，东向右 · 尺寸线可拖 · 左右按面对房子";
    }
    refreshLayoutInspector();
    applyPlanZoom();
    return;
  }

  $("toggle-layout-edit").hidden = false;
  $("toggle-wall-width").hidden = false;
  const layoutVersionLabel = document.querySelector<HTMLElement>(".layout-version-label");
  if (layoutVersionLabel) layoutVersionLabel.hidden = false;

  const memoryDraft = layoutEditing && layoutEditor ? null : loadLayoutDraft();
  const source = layoutEditing && layoutEditor
    ? planSourceFromDraft(layoutEditor.draft, level)
    : memoryDraft
      ? planSourceFromDraft(memoryDraft, level)
      : planSourceFromPublished(level);
  const selected = layoutEditing && layoutEditor?.selection
    ? layoutEditor.selection.kind === "room"
      ? { kind: "room", id: layoutEditor.selection.id }
      : layoutEditor.selection.kind === "furniture"
        ? {
            kind: "furniture",
            index: layoutEditor.selection.index,
            annex: layoutEditor.selection.annex,
          }
        : layoutEditor.selection.kind === "door"
          ? {
              kind: "door",
              index: layoutEditor.selection.index,
              annex: layoutEditor.selection.annex,
              exterior: layoutEditor.selection.exterior,
            }
          : layoutEditor.selection.kind === "wall"
            ? {
                kind: "wall",
                index: layoutEditor.selection.index,
                annex: layoutEditor.selection.annex,
              }
            : { kind: layoutEditor.selection.kind }
    : null;
  const selectedFurniture =
    layoutEditing && layoutEditor
      ? layoutEditor.selections
          .filter((s): s is Extract<typeof s, { kind: "furniture" }> => s.kind === "furniture" && s.floor === level)
          .map((s) => (s.annex ? 1000 + s.index : s.index))
      : [];
  const selectedRooms =
    layoutEditing && layoutEditor
      ? layoutEditor.selections
          .filter((s): s is Extract<typeof s, { kind: "room" }> => s.kind === "room" && s.floor === level)
          .map((s) => s.id)
      : [];
  patchPlanDrawing($("plan-drawing"), floorPlan(
    level,
    checked("chair-clearance"),
    balcony,
    {
      editorCanvas: true,
      useZones: checked("room-clearance"),
      dining: $<HTMLSelectElement>("dining-mode").value as "full" | "daily",
      editable: layoutEditing,
      selected,
      selectedFurniture,
      selectedRooms,
      showWallWidth,
      drawGuide: layoutEditing ? layoutEditor?.getDrawGuide() ?? null : null,
      alignGuide: layoutEditing ? layoutEditor?.getAlignGuide() ?? null : null,
    },
    source,
  ));
  const editorSvg = $("plan-drawing").querySelector<SVGSVGElement>(".editor-floor-svg");
  if (editorSvg && planMode === "2d") planCanvas?.sync(editorSvg, level);
  const sharedDimensions = $("plan-drawing").querySelector<HTMLDetailsElement>(".plan-shared-dimensions");
  if (sharedDimensions) sharedDimensions.open = sharedDimensionsOpen;
  syncWallWidthToggle();
  active("[data-floor]", (b) => Number(b.dataset.floor) === level);
  document.querySelectorAll<HTMLInputElement>('input[name="floor"]').forEach(input => {
    input.checked = Number(input.value) === level;
  });
  const liveFloors = layoutEditing && layoutEditor ? layoutEditor.draft.floors : memoryDraft?.floors ?? floors;
  document.querySelectorAll<HTMLElement>("#floor-select label small").forEach((small, i) => {
    small.textContent = bedroomSummary(i, liveFloors[i].rooms);
  });
  $("floor-summary-title").textContent =
    `${source.floor.name} · ${bedroomSummary(level, source.floor.rooms)}`;
  $("floor-summary").textContent = layoutEditing
    ? "编辑草稿中。外墙锁定；2D 与 3D 共用选中属性和撤销记录，三维可点选、摆放与拖动家具；导出 JSON 可回写源码定稿。"
    : activeLayoutVersionFile
      ? `当前户型：${layoutVersionsIndex.versions.find(v => v.file === activeLayoutVersionFile)?.title ?? "已保存版本"}。切换楼层查看，点「编辑布局」修改，点「保存」写入当前版本。`
      : "当前草稿。切换楼层查看，点「编辑布局」修改，点「新增」建立空白户型，或点「复制」另存当前布局。";
  $("room-detail").hidden = true;
  $("room-detail").replaceChildren();
  $("dining-check").hidden = level !== 0 || layoutEditing || !source.annexFurniture.some(item => item.kind === "roundTable");
  $("layout-edit-bar").hidden = false;
  $("toggle-layout-edit").setAttribute("aria-pressed", String(layoutEditing));
  $("toggle-layout-edit").classList.toggle("active", layoutEditing);
  $("toggle-layout-edit").textContent = layoutEditing ? "退出编辑" : "编辑布局";
  const undoBtn = document.getElementById("layout-undo") as HTMLButtonElement | null;
  const redoBtn = document.getElementById("layout-redo") as HTMLButtonElement | null;
  if (undoBtn) undoBtn.disabled = !layoutEditing || !layoutEditor || !layoutEditor.canUndo;
  if (redoBtn) redoBtn.disabled = !layoutEditing || !layoutEditor || !layoutEditor.canRedo;
  const magnetBtn = document.getElementById("layout-magnet-snap");
  if (magnetBtn && layoutEditor) {
    magnetBtn.classList.toggle("active", layoutEditor.magnetSnap);
    magnetBtn.setAttribute("aria-pressed", String(layoutEditor.magnetSnap));
  }
  syncLayoutPalette();
  syncDesignerOverview(source);
  requestAnimationFrame(() => {
    syncLayoutChromeHeight();
    positionLayoutInspector();
  });
  const orient = document.getElementById("plan-orient-hint");
  if (orient) {
    orient.textContent = "南 ↑ · 西 →";
    orient.title = layoutEditing
      ? "编辑：⌘S 暂存 ·「保存」写户型版本 · 连按两下 Esc 取消选中并回「选择」· 吸附可关 · Shift 拖暂关／点选多选 · 方向键微调"
      : level === 0 && $<HTMLSelectElement>("dining-mode").value === "daily"
        ? "日常6座示意；尺寸与留位仅作模型参考"
        : "外轮廓／内侧参考未扣装修；南向上、西向右（门头朝下）";
  }
  refreshLayoutInspector();
  layoutScene?.sync();
  syncEditorSelection();
  $("designer-status-hint").textContent = planMode === "3d"
    ? "点选模型编辑属性 · 选中家具后可拖动 · 与 2D 共用草稿"
    : "滚轮缩放 · 空格 / 中键平移 · 墙体修改后房间自动联动";
  if (planMode === "3d") $("plan-orient-hint").textContent = `${source.floor.name} · 3D 场景`;
  const svgs = [...$("plan-drawing").querySelectorAll<SVGSVGElement>("svg.floor-svg")];
  if (!layoutEditing || !layoutEditor || svgs.length !== boundPlanSvgs.length || svgs.some((svg, i) => svg !== boundPlanSvgs[i])) {
    unbindLayoutEditor?.();
    unbindLayoutEditor = null;
    boundPlanSvgs = [];
    if (layoutEditing && layoutEditor) {
      const cleanups = svgs.map(svg => layoutEditor!.bind(svg));
      boundPlanSvgs = svgs;
      unbindLayoutEditor = () => cleanups.forEach(cleanup => cleanup());
    }
  }
  for (const svg of svgs) {
    for (const tool of ["wall", "room", "door", "furniture"]) {
      svg.classList.toggle(`tool-${tool}`, layoutEditing && layoutEditor?.tool === tool);
    }
  }
  applyPlanZoom();
  if (initialPlanFit && planMode === "2d") requestAnimationFrame(() => {
    if (!$("plan-panel").hidden && planMode === "2d") {
      initialPlanFit = false;
      fitPlanToWindow();
    }
  });
}
function formatSaveStatus(updatedAt: string, manual: boolean) {
  const t = new Date(updatedAt);
  const clock = Number.isNaN(t.getTime())
    ? ""
    : `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
  return manual ? `已写入内存 ${clock} · 可点「保存」` : `已暂存 ${clock}`;
}

/** 二维编辑只标记脏数据；三维显示前集中同步最新版本。 */
function isSceneVisible() {
  return !!viewer && (tab === "model" || tab === "sun" || (tab === "floor" && planMode === "3d"));
}
let sceneParamsKey = "";
const sceneUpdates = new DeferredSceneUpdate({
  visible: isSceneVisible,
  capture: () => {
    const draft = layoutEditor?.draft ?? loadLayoutDraft();
    const layout = draft ? villaLayoutFromDraft(draft) : null;
    const params = getVillaParams();
    return { key: JSON.stringify({ params, layout }), value: { params, layout } };
  },
  apply: ({ params, layout }) => {
    const paramsKey = JSON.stringify(params);
    if (paramsKey !== sceneParamsKey) viewer!.rebuildAfterParams(params.roofFenShui, layout);
    else viewer!.rebuildLayout(layout);
    sceneParamsKey = paramsKey;
    layoutScene?.sync();
  },
  loading: work => withLoadingOverlay($("scene-loading"), "正在更新立体模型…", work),
});
async function syncLayoutTo3d() {
  try { await sceneUpdates.flush(); return true; }
  catch (error) {
    console.error("立体模型更新失败", error);
    toast("立体更新失败，请重新切换立体重试；户型草稿已保留");
    return false;
  }
}
function applyLayoutDraftTo3d() {
  sceneUpdates.invalidate();
  return syncLayoutTo3d();
}
function setLayoutSaveStatus(updatedAt: string, manual: boolean) {
  const el = document.getElementById("layout-save-status");
  if (el) el.textContent = formatSaveStatus(updatedAt, manual);
  void applyLayoutDraftTo3d();
}

function setLayoutEditing(on: boolean) {
  if (on && drawingView !== "floor") return;
  if (on && level < 0) {
    toast("院坪总图不支持编辑布局，请先切换到一层／二层／三楼");
    return;
  }
  // 保留进入编辑前的侧栏高度，隐藏说明卡片后仍保持原有滚动范围。
  if (on && !layoutEditing) {
    const controls = $("floor-controls");
    controls.style.minHeight = `${controls.getBoundingClientRect().height}px`;
  }
  layoutEditing = on;
  if (on && !layoutEditor) {
    layoutEditor = new LayoutEditor({
      getFloor: () => level,
      redraw: () => planRedraw.schedule(),
      toast,
      onDraftSaved: setLayoutSaveStatus,
    });
  } else if (on && layoutEditor) {
    setLayoutSaveStatus(layoutEditor.draft.updatedAt, false);
  }
  if (!on) {
    const el = document.getElementById("layout-save-status");
    if (el) el.textContent = "";
  }
  updateScene();
}
function updateScene() {
  document.body.classList.toggle("plan-designer", tab === "floor");
  const floor3d = tab === "floor" && planMode === "3d";
  if (floor3d && level < 0) level = 0;
  if (designerSceneActive && viewer && !viewer.state.exploded) designerScenePoses.set(designerSceneLevel, viewer.cameraPose());
  const frameChanged = floor3d && (!designerSceneActive || designerSceneLevel !== level || viewer?.state.exploded !== checked("explode"));
  designerSceneActive = floor3d;
  designerSceneLevel = level;
  const viewportParent = floor3d ? $("designer-scene-host") : document.querySelector<HTMLElement>(".stage")!;
  for (const id of ["viewport", "scene-loading"]) {
    const element = $(id);
    if (element.parentElement !== viewportParent) viewportParent.prepend(element);
  }
  $("designer-scene").hidden = !floor3d;
  $("plan-drawing").hidden = floor3d;
  $("plan-panel").hidden = tab !== "floor";
  $("designer-explode").setAttribute("aria-pressed", String(checked("explode")));
  document.querySelector<HTMLElement>(".designer-scene-hint")!.textContent = checked("explode")
    ? "楼层分离展示 · 关闭分离后可在场景中点选和摆放模型"
    : "拖动空白处旋转 · 右键平移 · 滚轮缩放 · 点选家具后可拖动摆放";
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-designer-layer="dims"], #toggle-wall-width, [data-designer-display="chair-clearance"], [data-designer-display="room-clearance"]')) {
    button.disabled = floor3d;
    button.title = floor3d ? "此项用于二维图纸" : "";
  }
  layoutScene?.sync();
  if (!layoutEditing) $("floor-controls").style.removeProperty("min-height");
  $("floor-room-options").hidden = drawingView !== "floor" && planMode === "2d";
  active("[data-roof-plan]", () => drawingView === "roof" && planMode === "2d");
  active("[data-elevation-plan]", () => drawingView === "elevation" && planMode === "2d");
  active("[data-floor]", b => drawingView === "floor" && Number(b.dataset.floor) === level);
  document.querySelectorAll<HTMLInputElement>('input[name="floor"]').forEach(input => {
    input.checked = drawingView === "floor" && Number(input.value) === level;
  });
  const design = tab === "design";
  const originals = tab === "originals";
  const realScene = tab === "real";
  // 页脚保留；画布下说明条已去掉。撑满编辑区时仍隐藏页脚。
  document.querySelector<HTMLElement>(".app-footer")!.hidden =
    design || realScene || originals || tab === "sources" || planEditorFocus;
  document.body.classList.toggle(
    "focused-view",
    design || realScene || originals || tab === "sources" || planEditorFocus,
  );
  $("design-panel").hidden = !design;
  $("real-scene-panel").hidden = !realScene;
  $("originals-panel").hidden = !originals;
  document.querySelector<HTMLElement>(".stage")!.hidden = realScene || design || originals;
  document.querySelector<HTMLElement>(".inspector")!.hidden = realScene || design || originals;
  if (design) {
    $("loading").hidden = true;
    $("interaction-hint").textContent = "按编号记录意见 · 保存快照与JSON备份 · 导出离线沟通图册";
    review?.refresh();
    return;
  }
  if (originals) {
    const frame = $<HTMLIFrameElement>("originals-frame");
    if (!frame.hasAttribute("src")) frame.src = "../original-materials/";
    return;
  }
  if (realScene) {
    const frame = $<HTMLIFrameElement>("real-scene-frame");
    if (!frame.hasAttribute("src")) frame.src = "../villa-real-scene/?embed=1&ui=11";
    $("interaction-hint").textContent = "切换机位 · 原片对比 · 下载实景效果";
    return;
  }
  const garage = tab === "model" && camera === "garage";
  const plan = tab === "floor" && planMode === "2d";
  if (plan || tab === "sources") $("loading").hidden = true;
  $("viewport").hidden = plan || tab === "sources";
  $("sources-panel").hidden = tab !== "sources";
  $("scene-heading").hidden = plan || tab === "sources";
  $("scene-tools").hidden = tab === "floor" || tab === "sources";
  $("compass").hidden = tab === "floor" || tab === "sources";
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
    roofStyle,
    courtyardFinish: selectedCourtyardFinish("courtyard-finish"),
    neighborCourtyardFinish: selectedCourtyardFinish("neighbor-courtyard-finish"),
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
  active("[data-roof-style]", b => b.dataset.roofStyle === roofStyle);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-roof-style]"))
    button.disabled = isExisting && tab === "model";
  $("roof-style-note").textContent = isExisting && tab === "model"
    ? "切换到新建方案，可比较两种官帽造型。"
    : roofStyle === "floating"
      ? "默认帽顶低于主脊50cm，纵脊接入正屋，檐底贴近屋面。"
      : "官帽与正屋同脊高，檐口相连。";
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
    ? drawingView !== "floor" ? "切换图纸 · 可缩放、下载 SVG · 尺寸设置联动" : "点击房间查看说明 · 滚轮或右下角按钮缩放图纸"
    : "拖动旋转 · 滚轮缩放 · 右键平移";
  if (tab === "floor") drawPlan();
  if (isSceneVisible()) void syncLayoutTo3d();
  if (frameChanged) {
    const revision = ++designerCameraRevision;
    const targetLevel = level;
    void syncLayoutTo3d().then(ready => {
      if (!ready || revision !== designerCameraRevision || tab !== "floor" || planMode !== "3d" || level !== targetLevel) return;
      viewer?.resize();
      if (checked("explode")) {
        designerSceneCamera = "orbit";
        viewer?.setFloorCamera(designerSceneCamera);
        active("[data-designer-camera]", button => button.dataset.designerCamera === designerSceneCamera);
      } else {
        const pose = designerScenePoses.get(targetLevel);
        if (pose) viewer?.restoreCameraPose(pose);
        else viewer?.setFloorCamera(designerSceneCamera);
      }
      layoutScene?.sync();
    });
  }
}
function switchTab(name: string) {
  const resumePose = tab === "design" && name === lastViewingTab ? reviewPose : null;
  if (name === "design" && tab !== "design") reviewPose = viewer?.cameraPose() ?? null;
  tab = name;
  if (name !== "floor" && planEditorFocus) setPlanEditorFocus(false);
  if (name === "model" || name === "floor" || name === "sun") lastViewingTab = name;
  active("[data-tab]", (b) => b.dataset.tab === tab);
  if (tab === "real" || tab === "design" || tab === "originals") {
    updateScene();
    return;
  }
  if (tab === "floor") {
    updateScene();
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
    `主楼升高 ${formatMm(pitch.mainRise)}，半坡 ${formatMm(pitch.mainRun)}。辅楼升高 ${formatMm(pitch.annexRise)}，半坡 ${formatMm(pitch.annexRun)}（mm）。`;
  viewer?.setRoofFenShui(value);
  const fenInput = document.querySelector<HTMLInputElement>('[data-villa-param="roofFenShui"]');
  if (fenInput) fenInput.value = String(value);
  const next = { ...getVillaParams(), roofFenShui: value };
  rememberVillaParams(next);
  saveVillaParams(next);
}
function updateRamp() {
  const roadY = Number($<HTMLInputElement>("road-level").value),
    len = Number($<HTMLInputElement>("ramp-length").value);
  if (
    !$<HTMLInputElement>("road-level").value ||
    !Number.isFinite(roadY) ||
    roadY < -3800 ||
    roadY > 0 ||
    !Number.isFinite(len) ||
    len < 3000 ||
    len > 10000
  ) {
    $("ramp-result").textContent =
      "请输入有效范围：道路 −3800～0 mm，坡长 3000～10000 mm。图中沿用上次有效的示意参数。";
    return;
  }
  viewer?.updateRamp(roadY, len);
  const grade = ((roadY - site.garageFloor) / len) * 100;
  $("ramp-result").textContent =
    `示意高差 ${formatMm(Math.abs(roadY - site.garageFloor))} mm / ${formatMm(len)} mm → ${grade >= 0 ? "下坡" : "上坡"} ${Math.abs(grade).toFixed(1)}%`;
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
  if (layoutEditing) return;
  const room = [...floors[level].rooms, ...(level === 0 ? annexRooms : [])].find((r) => r.id === id);
  if (!room) return;
  const areas = roomAreas(room, level);
  $("room-detail").hidden = false;
  $("room-detail").innerHTML = `<strong>${escapeHtml(room.name)}</strong>${room.kind !== "void" ? `<p>墙线面积 ${areas.building.toFixed(2)} m² · 净空面积 ${areas.interior.toFixed(2)} m²</p>` : ""}<p>${escapeHtml(room.note ?? "家具与空间为方案参考，需结合结构、装修和使用进一步深化。")}</p>${room.purposeStatus ? "<p>用途待确认；当前不计入6间用途明确的卧室。</p>" : ""}<button class="text-button" data-design-issue="${room.id === "dining" ? "D09" : room.id === "stair" ? "D03" : room.id === "spare" ? "D10" : "D08"}">打开相关议题与记录 ↗</button>`;
}
function captureMeetingView(): MeetingView {
  return {
    roofStyle,
    courtyardFinish: selectedCourtyardFinish("courtyard-finish"),
    neighborCourtyardFinish: selectedCourtyardFinish("neighbor-courtyard-finish"),
    tab: ["model", "floor", "sun"].includes(tab) ? tab as MeetingView["tab"] : lastViewingTab,
    camera: viewer?.activeCamera ?? camera,
    level, planMode: planMode as "2d" | "3d", existing: viewer?.state.existing ?? (isExisting && lastViewingTab === "model"), balcony,
    fenShui: Number($<HTMLInputElement>("fen-shui").value),
    roadY: viewer?.roadY ?? surroundings.road.entryY, rampLength: viewer?.rampLength ?? 5000,
    progress: Number($<HTMLInputElement>("route-progress").value),
    sunDate: $<HTMLInputElement>("sun-date").value, sunTime: Number($<HTMLInputElement>("sun-time").value),
    dining: $<HTMLSelectElement>("dining-mode").value as "full" | "daily",
    // 旧快照字段可能对应已移除的开关，仍输出布尔值以兼容资料格式。
    flags: Object.fromEntries(viewFlags.map((id) => [id, document.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false])),
    pose: viewer?.cameraPose() ?? null,
    villaParams: getVillaParams(),
  };
}
async function restoreMeetingView(view: MeetingView) {
  const params = { ...DEFAULT_VILLA_PARAMS, ...view.villaParams, roofFenShui: view.fenShui };
  if (!await commitVillaParams(params, { persist: true, toastMsg: "" })) {
    throw new Error("方案尺寸或立体更新失败；当前草稿已保留");
  }
  drawingView = "floor";
  level = view.level; planMode = view.planMode; isExisting = view.existing; balcony = view.balcony; camera = view.camera;
  roofStyle = view.roofStyle;
  $<HTMLInputElement>(`courtyard-finish-${view.courtyardFinish}`).checked = true;
  $<HTMLInputElement>(`neighbor-courtyard-finish-${view.neighborCourtyardFinish}`).checked = true;
  for (const id of viewFlags) {
    const input = document.querySelector<HTMLInputElement>(`#${id}`);
    if (input) input.checked = view.flags[id];
  }
  $<HTMLInputElement>("road-level").value = String(view.roadY);
  $<HTMLInputElement>("ramp-length").value = String(view.rampLength);
  $<HTMLInputElement>("route-progress").value = String(view.progress);
  $<HTMLInputElement>("sun-date").value = view.sunDate;
  $<HTMLInputElement>("sun-time").value = String(view.sunTime);
  $<HTMLSelectElement>("dining-mode").value = view.dining;
  for (const id of ["balcony", "sun-balcony"]) $<HTMLSelectElement>(id).value = balcony ? "local" : "none";
  active("[data-existing]", (b) => b.dataset.existing === String(isExisting));
  active("[data-plan-mode]", (b) => b.dataset.planMode === planMode);
  updateRamp(); updateSun();
  switchTab(view.tab);
  // 快照有自己的机位；取消切回户型时排队的自动取景，等模型完成再恢复。
  designerCameraRevision++;
  if (!await syncLayoutTo3d()) throw new Error("立体模型未能完成更新；当前草稿已保留");
  camera = view.camera;
  viewer?.setCamera(view.camera);
  if (view.pose) viewer?.restoreCameraPose(view.pose);
  if (view.tab === "floor" && view.planMode === "3d" && !view.flags.explode && view.pose) {
    designerScenePoses.set(view.level, view.pose);
  }
  viewer?.setRouteLayers({ sweep: view.flags["route-sweep"], clearance: view.flags["route-clearance"], conflicts: view.flags["route-conflicts"] });
  active("[data-camera]", (b) => b.dataset.camera === camera);
}
function locateDesignIssue(issue: DesignIssue) {
  drawingView = "floor";
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
  if (el.dataset.canvasTool) {
    if (el.dataset.canvasTool === "select" && !layoutEditing) setLayoutEditing(true);
    planCanvas?.setMode(el.dataset.canvasTool as PlanCanvas["mode"]);
    if (el.dataset.canvasTool === "select") layoutEditor?.setTool("select");
    return;
  }
  if (el.dataset.editorWallHeight) {
    layoutScene?.setWallHeight(el.dataset.editorWallHeight === "full" ? "full" : 1200);
    active("[data-editor-wall-height]", button => button === el);
    return;
  }
  if (el.dataset.editorAction && layoutEditor) {
    const action = el.dataset.editorAction;
    if (action === "done") layoutEditor.selectObject(null);
    else if (action === "rotate-left" || action === "rotate-right") layoutEditor.rotateSelectedFurniture(action === "rotate-left" ? -90 : 90);
    else if (action === "duplicate") { layoutEditor.copySelection(); layoutEditor.pasteClipboard(); }
    else if (action === "delete") layoutEditor.deleteSelection();
    else if (action === "focus") {
      if (planMode === "3d") layoutScene?.focusSelection();
      else {
        const boxes = Array.from($("plan-drawing").querySelectorAll<SVGGraphicsElement>(".edit-selection"), element => element.getBoundingClientRect());
        if (boxes.length) {
          const left = Math.min(...boxes.map(box => box.left)), top = Math.min(...boxes.map(box => box.top));
          planCanvas?.focus(new DOMRect(left, top, Math.max(...boxes.map(box => box.right)) - left, Math.max(...boxes.map(box => box.bottom)) - top));
        }
      }
    }
    return;
  }
  if (el.closest(".designer-menu-pop")) el.closest("details")?.removeAttribute("open");
  if (el.dataset.libraryGroup) {
    libraryGroup = el.dataset.libraryGroup;
    active("[data-library-group]", b => b.dataset.libraryGroup === libraryGroup);
    filterDesignerLibrary();
    return;
  }
  if (el.dataset.designerLayer) {
    const layer = el.dataset.designerLayer;
    const on = el.getAttribute("aria-pressed") !== "true";
    el.setAttribute("aria-pressed", String(on));
    $("plan-panel").classList.toggle(layer === "grid" ? "designer-grid" : `designer-hide-${layer}`, layer === "grid" ? on : !on);
    layoutScene?.sync();
    return;
  }
  if (el.dataset.designerCamera === "orbit" || el.dataset.designerCamera === "top") {
    designerSceneCamera = el.dataset.designerCamera;
    viewer?.setFloorCamera(designerSceneCamera);
    active("[data-designer-camera]", button => button.dataset.designerCamera === designerSceneCamera);
    return;
  }
  if (el.id === "designer-explode") {
    $<HTMLInputElement>("explode").checked = !checked("explode");
    updateScene();
    return;
  }
  if (el.id === "designer-scene-export") {
    $("save-view").click();
    return;
  }
  if (el.dataset.designerDisplay) {
    const input = $<HTMLInputElement>(el.dataset.designerDisplay);
    input.checked = !input.checked;
    input.dispatchEvent(new Event("change"));
    return;
  }
  if (el.id === "designer-inspector-float") {
    inspectorFloating = !inspectorFloating;
    stopLayoutInspectorDrag();
    const panel = $("layout-inspector");
    panel.classList.toggle("layout-inspector-float", inspectorFloating);
    (document.querySelector(inspectorFloating ? ".designer-canvas" : ".designer-property-section") as HTMLElement).append(panel);
    if (!inspectorFloating) {
      for (const property of ["left", "top", "right", "bottom", "max-height"]) panel.style.removeProperty(property);
    }
    el.setAttribute("aria-pressed", String(inspectorFloating));
    el.textContent = inspectorFloating ? "停靠" : "浮动";
    el.title = inspectorFloating ? "将属性停靠到右侧" : "将属性切换为可拖动浮窗";
    refreshLayoutInspector();
    return;
  }
  if (el.dataset.designerRoom) {
    selectDesignerRoom(el.dataset.designerRoom, el.dataset.designerAnnex === "true");
    return;
  }
  if (el.dataset.tab) switchTab(el.dataset.tab);
  if (el.dataset.camera) setCamera(el.dataset.camera as CameraName);
  if (el.dataset.existing) {
    isExisting = el.dataset.existing === "true";
    if (isExisting && camera === "garage") camera = "aerial";
    active("[data-existing]", (b) => b === el);
    updateScene();
    viewer?.setCamera(camera);
  }
  if (el.dataset.buildingVariant) {
    const params = readVillaParamsFromDom(document, { finalize: true });
    const key = el.dataset.buildingVariant;
    if (key === "porticoStyle" && (el.dataset.variantValue === "projecting" || el.dataset.variantValue === "recessed")) params.porticoStyle = el.dataset.variantValue;
    if (key === "buildingPlacement" && (el.dataset.variantValue === "main-east" || el.dataset.variantValue === "main-west")) params.buildingPlacement = el.dataset.variantValue;
    if (key === "thirdFloorMode" && (el.dataset.variantValue === "setback" || el.dataset.variantValue === "flush")) params.thirdFloorMode = el.dataset.variantValue;
    void commitVillaParams(params, { toastMsg: "已切换造型与布局，相关视图已同步" });
    return;
  }
  if (el.dataset.roofStyle) {
    roofStyle = parseRoofStyle(el.dataset.roofStyle);
    if (roofDrawingView !== "slab") roofDrawingView = roofStyle;
    updateScene();
  }
  if (el.hasAttribute("data-roof-plan")) {
    drawingView = "roof";
    layoutEditing = false;
    level = 2;
    planMode = "2d";
    active("[data-plan-mode]", b => b.dataset.planMode === "2d");
    updateScene();
  }
  if (el.hasAttribute("data-elevation-plan")) {
    drawingView = "elevation";
    layoutEditing = false;
    planMode = "2d";
    active("[data-plan-mode]", b => b.dataset.planMode === "2d");
    updateScene();
  }
  if (el.dataset.elevationView && el.dataset.elevationView in elevationLabels) {
    elevationView = el.dataset.elevationView as ElevationView;
    updateScene();
  }
  if (el.dataset.roofDrawingView) {
    roofDrawingView = el.dataset.roofDrawingView as RoofDrawingView;
    if (roofDrawingView !== "slab") roofStyle = roofDrawingView;
    updateScene();
  }
  if (el.id === "download-roof-svg" || el.id === "download-elevation-svg") {
    const elevation = el.id === "download-elevation-svg";
    const svg = $("plan-drawing").querySelector<SVGSVGElement>(elevation ? "svg.elevation-svg" : "svg.roof-svg");
    if (svg) {
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `安化山居-${elevation ? elevationLabels[elevationView] : roofDrawingLabels[roofDrawingView]}.svg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  if (el.dataset.floor) {
    drawingView = "floor";
    level = Number(el.dataset.floor);
    if (level < 0) {
      planMode = "2d";
      active("[data-plan-mode]", (b) => b.dataset.planMode === "2d");
      if (layoutEditing) layoutEditing = false;
    }
    layoutEditor?.clearSelectionOnFloorChange();
    updateScene();
  }
  if (el.dataset.planMode) {
    planCanvas?.setMode("select");
    drawingView = "floor";
    planMode = el.dataset.planMode;
    if (planMode === "3d" && level < 0) level = 0;
    active("[data-plan-mode]", (b) => b.dataset.planMode === planMode);
    updateScene();
  }
  if (el.id === "toggle-layout-edit") setLayoutEditing(!layoutEditing);
  if (el.dataset.autoRooms) {
    if (!layoutEditing) setLayoutEditing(true);
    layoutEditor?.generateAutoRooms(el.dataset.autoRooms === "annex");
    el.closest("details")?.removeAttribute("open");
    return;
  }
  if (el.id === "layout-magnet-snap" && !layoutEditing) setLayoutEditing(true);
  if (el.id === "layout-magnet-snap" && layoutEditor) {
    layoutEditor.magnetSnap = !layoutEditor.magnetSnap;
    el.classList.toggle("active", layoutEditor.magnetSnap);
    el.setAttribute("aria-pressed", String(layoutEditor.magnetSnap));
    toast(
      layoutEditor.magnetSnap
        ? "已开吸附：拖墙／家具对齐附近墙线；Shift 拖可暂关"
        : "已关吸附：拖移不再自动对齐",
    );
  }
  if (el.dataset.editTool && !layoutEditing) setLayoutEditing(true);
  if (el.dataset.editTool && layoutEditor) {
    planCanvas?.setMode("select");
    suppressPaletteClickUntil = 0;
    const next = el.dataset.editTool as "select" | "wall" | "room" | "door" | "furniture";
    if (next !== "select") {
      libraryCategory = next;
      libraryGroup = "全部";
      $<HTMLInputElement>("designer-library-search").value = "";
      active("[data-library-group]", b => b.dataset.libraryGroup === "全部");
    }
    layoutEditor.setTool(next);
    if (next === "wall") toast(planMode === "3d" ? "选择墙体类型后点击或拖入场景放置，端点可在 2D 中调整" : "选择墙体类型后拖入，或在平面图上点两点画水平／竖直分界");
    syncLayoutPalette();
    refreshLayoutInspector();
  }
  if (el.dataset.paletteKind && !layoutEditing) setLayoutEditing(true);
  if (el.dataset.paletteKind && layoutEditor) {
    planCanvas?.setMode("select");
    if (Date.now() < suppressPaletteClickUntil) return;
    layoutEditor.setTool(el.dataset.paletteCategory as LibraryCategory);
    const kind = el.dataset.paletteKind;
    if (layoutEditor.tool === "room") {
      layoutEditor.roomKind = (kind === "stair-triple" ? "stair" : kind) as typeof layoutEditor.roomKind;
      if (kind === "stair" || kind === "stair-triple") layoutEditor.stairModel = kind === "stair-triple" ? "triple" : "double";
    } else if (layoutEditor.tool === "door") {
      layoutEditor.openingKind = kind as typeof layoutEditor.openingKind;
    } else if (layoutEditor.tool === "furniture") {
      layoutEditor.furnitureKind = kind as typeof layoutEditor.furnitureKind;
    } else if (layoutEditor.tool === "wall") {
      layoutEditor.wallRole = kind as typeof layoutEditor.wallRole;
    }
    syncLayoutPalette();
    toast(planMode === "3d" ? "已选中，点击场景或拖入放置" : "已选中，请拖到平面图放置");
  }
  if (el.id === "plan-zoom-in") {
    if (planMode === "3d") viewer?.zoomFloor(.8);
    else setPlanZoom(planZoom + planZoomStep);
    return;
  }
  if (el.id === "plan-zoom-out") {
    if (planMode === "3d") viewer?.zoomFloor(1.25);
    else setPlanZoom(planZoom - planZoomStep);
    return;
  }
  if (el.id === "plan-zoom-reset") {
    if (planMode === "3d") viewer?.setFloorCamera(designerSceneCamera);
    else fitPlanToWindow();
    return;
  }
  if (el.id === "plan-focus-toggle") {
    setPlanEditorFocus(!planEditorFocus);
    return;
  }
  if (el.id === "toggle-wall-width") {
    showWallWidth = !showWallWidth;
    drawPlan();
    return;
  }
  if (el.id === "layout-save") {
    void saveLayoutVersion();
  }
  if (el.id === "layout-undo") layoutEditor?.undo();
  if (el.id === "layout-redo") layoutEditor?.redo();
  if (el.id === "layout-export" || el.id === "layout-reset") {
    if (!layoutEditor) setLayoutEditing(true);
    if (el.id === "layout-export") layoutEditor!.exportJson();
    else layoutEditor!.resetToPublished();
  }
  if (el.dataset.editDelete !== undefined) layoutEditor?.deleteSelection();
  if (el.dataset.furnRotate !== undefined) layoutEditor?.rotateSelectedFurniture(Number(el.dataset.furnRotate));
  if (el.dataset.alignCenter === "opening") layoutEditor?.centerSelectedOpeningInBay();
  if (el.dataset.alignCenter === "furniture") layoutEditor?.centerSelectedFurnitureInRoom();
  if (el.dataset.alignCenter === "portico") layoutEditor?.centerSelectedPorticoInBay();
  if (el.hasAttribute("data-reset-window-height")) layoutEditor?.resetSelectedWindowDimensions();
  if (el.hasAttribute("data-align-wall-line")) layoutEditor?.alignSelectedWallLine();
  if (
    el.dataset.alignWall === "left" ||
    el.dataset.alignWall === "right" ||
    el.dataset.alignWall === "up" ||
    el.dataset.alignWall === "down"
  ) {
    layoutEditor?.alignSelectedWall(el.dataset.alignWall);
  }
  if (el.dataset.photo) openPhoto(Number(el.dataset.photo));
  if (el.dataset.photoModal) openPhoto(Number(el.dataset.photoModal), true);
  if (el.dataset.season) {
    $<HTMLInputElement>("sun-date").value = `2026-${el.dataset.season}`;
    $("sun-report").innerHTML = "";
    updateSun();
  }
  if (el.dataset.room) {
    if (tab === "floor" && planMode === "2d" && level >= 0) {
      // 编辑时由 SVG 的 pointerdown 处理画墙、拖动与组合多选；仅接管浏览及键盘点选。
      if (layoutEditing && event.detail > 0) return;
      const annex = el.closest<HTMLElement>("[data-plan-building]")?.dataset.planBuilding === "annex";
      selectDesignerRoom(el.dataset.room, annex);
      return;
    }
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
for (const id of ["courtyard-finish-concrete", "courtyard-finish-tile", "neighbor-courtyard-finish-concrete", "neighbor-courtyard-finish-tile"])
  $(id).addEventListener("change", () => {
    updateScene();
  });
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
  drawingView = "floor";
  level = Number(input.value);
  layoutEditor?.clearSelectionOnFloorChange();
  updateScene();
});
$("explode").addEventListener("change", () => {
  drawingView = "floor";
  if (checked("explode")) {
    planMode = "3d";
    active("[data-plan-mode]", (b) => b.dataset.planMode === "3d");
  }
  updateScene();
});
$("chair-clearance").addEventListener("change", drawPlan);
for (const id of ["room-clearance", "dining-mode"])
  $(id).addEventListener("change", drawPlan);
$("layout-import").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!layoutEditing) setLayoutEditing(true);
  if (!layoutEditor) return;
  try {
    layoutEditor.importJson(await file.text());
  } catch (error) {
    toast(error instanceof Error ? error.message : "导入失败");
  }
  input.value = "";
});
$("layout-palette-chips").addEventListener("dragstart", (event) => {
  const chip = (event.target as Element).closest<HTMLElement>("[data-palette-kind]");
  if (!chip || !(event instanceof DragEvent) || !event.dataTransfer) return;
  // 拖放开始时同步选中该模型，避免只靠 click（拖后 click 常被吞）
  if (layoutEditor) {
    const kind = chip.dataset.paletteKind;
    if (kind && layoutEditor.tool === "room") {
      layoutEditor.roomKind = (kind === "stair-triple" ? "stair" : kind) as typeof layoutEditor.roomKind;
      if (kind === "stair" || kind === "stair-triple") layoutEditor.stairModel = kind === "stair-triple" ? "triple" : "double";
    } else if (kind && layoutEditor.tool === "door") {
      layoutEditor.openingKind = kind as typeof layoutEditor.openingKind;
    } else if (kind && layoutEditor.tool === "furniture") {
      layoutEditor.furnitureKind = kind as typeof layoutEditor.furnitureKind;
    } else if (kind && layoutEditor.tool === "wall") {
      layoutEditor.wallRole = kind as typeof layoutEditor.wallRole;
    }
  }
  const payload = JSON.stringify({
    category: chip.dataset.paletteCategory,
    kind: chip.dataset.paletteKind,
  });
  event.dataTransfer.setData("application/x-anhua-layout", payload);
  event.dataTransfer.setData("text/plain", payload);
  event.dataTransfer.effectAllowed = "copy";
  chip.classList.add("dragging");
  $("plan-drawing").classList.add("layout-drop-target");
});
$("layout-palette-chips").addEventListener("dragend", (event) => {
  const chip = (event.target as Element).closest<HTMLElement>("[data-palette-kind]");
  chip?.classList.remove("dragging");
  $("plan-drawing").classList.remove("layout-drop-target");
  // 仅压制紧随其后的幽灵 click，不长期锁死芯片
  suppressPaletteClickUntil = Date.now() + 120;
  syncLayoutPalette();
});
$("plan-drawing").addEventListener("dragover", (event) => {
  if (drawingView !== "floor" || level < 0) return;
  if (!event.dataTransfer?.types.includes("application/x-anhua-layout")) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
$("plan-drawing").addEventListener("drop", (event) => {
  if (drawingView !== "floor" || level < 0 || !(event instanceof DragEvent)) return;
  event.preventDefault();
  $("plan-drawing").classList.remove("layout-drop-target");
  const raw =
    event.dataTransfer?.getData("application/x-anhua-layout") ||
    event.dataTransfer?.getData("text/plain");
  if (!raw) return;
  let payload: { category?: string; kind?: string };
  try {
    payload = JSON.parse(raw) as { category?: string; kind?: string };
  } catch {
    return;
  }
  if (
    payload.category !== "room" &&
    payload.category !== "door" &&
    payload.category !== "furniture" &&
    payload.category !== "wall"
  ) {
    return;
  }
  if (!payload.kind) return;
  const targetSvg = (event.target as Element | null)?.closest<SVGSVGElement>("svg.floor-svg");
  if (!targetSvg) return;
  const building = targetSvg.dataset.planBuilding;
  if (!layoutEditing) setLayoutEditing(true);
  const svg = $("plan-drawing").querySelector<SVGSVGElement>(`svg[data-plan-building="${building}"]`);
  if (!svg || !layoutEditor) return;
  if (payload.category === "furniture") {
    $("plan-panel").classList.remove("designer-hide-furniture");
    document.querySelector('[data-designer-layer="furniture"]')?.setAttribute("aria-pressed", "true");
  }
  layoutEditor.dropPlace(svg, event.clientX, event.clientY, payload.category, payload.kind);
  active("[data-edit-tool]", (b) => b.dataset.editTool === "select");
  syncLayoutPalette();
  toast("已放置，可在图上调整方位与大小");
});
$("plan-drawing").addEventListener(
  "wheel",
  (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -planZoomStep : planZoomStep;
    setPlanZoom(planZoom + delta, { clientX: event.clientX, clientY: event.clientY });
  },
  { passive: false },
);
$("plan-drawing").addEventListener("scroll", () => positionLayoutInspector(), { passive: true });
$("designer-library-search").addEventListener("input", filterDesignerLibrary);
$("designer-dining-mode").addEventListener("change", event => {
  $<HTMLSelectElement>("dining-mode").value = (event.target as HTMLSelectElement).value;
  drawPlan();
});
window.addEventListener("resize", () => {
  syncLayoutChromeHeight();
  positionLayoutInspector();
});
// 绑定到外层面板，避免属性重绘替换标题栏后丢失拖动监听或指针捕获。
$("layout-inspector").addEventListener("pointerdown", (event) => {
  if (!inspectorFloating) return;
  const target = event.target;
  if (event.button !== 0 || !event.isPrimary || !(target instanceof Element)) return;
  if (!target.closest("[data-inspector-drag-handle]")) return;
  if (target.closest("button, input, select, textarea, a, [contenteditable]")) return;
  const panel = $("layout-inspector");
  const wrap = panel.closest<HTMLElement>(".designer-canvas");
  if (!wrap) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = panel.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  layoutInspectorPosition = { left: rect.left - wrapRect.left, top: rect.top - wrapRect.top };
  layoutInspectorDrag = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    position: layoutInspectorPosition,
  };
  panel.classList.add("is-dragging");
  panel.setPointerCapture(event.pointerId);
});
$("layout-inspector").addEventListener("pointermove", (event) => {
  const drag = layoutInspectorDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const panel = $("layout-inspector");
  const wrap = panel.closest<HTMLElement>(".designer-canvas");
  if (!wrap) return;
  event.preventDefault();
  event.stopPropagation();
  layoutInspectorPosition = placeLayoutInspector(panel, {
    left: drag.position.left + event.clientX - drag.clientX,
    top: drag.position.top + event.clientY - drag.clientY,
  }, layoutInspectorBounds(panel, wrap));
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
  $("layout-inspector").addEventListener(type, (event) => {
    if (event.pointerId !== layoutInspectorDrag?.pointerId) return;
    stopLayoutInspectorDrag();
  });
}
window.addEventListener("blur", stopLayoutInspectorDrag);
$("layout-inspector").addEventListener("change", (event) => {
  const el = event.target as HTMLElement;
  if (!layoutEditor) return;
  if (el.id === "edit-model-name") {
    layoutEditor.updateSelectedName((el as HTMLInputElement).value);
    return;
  }
  const voidField = el.getAttribute("data-void-field");
  if (voidField && el instanceof HTMLSelectElement) {
    layoutEditor.updateLivingVoidField(voidField, el.value);
    refreshLayoutInspector(true);
    return;
  }
  const openingField = el.getAttribute("data-opening-field");
  if (openingField && el instanceof HTMLSelectElement) {
    layoutEditor.updateOpeningField(openingField, el.value);
    return;
  }
  const wallField = el.getAttribute("data-wall-field");
  if (wallField && el instanceof HTMLSelectElement) {
    layoutEditor.updateWallField(wallField, el.value);
    return;
  }
  const stairField = el.getAttribute("data-stair-field");
  if (stairField === "model" && el instanceof HTMLSelectElement) {
    if (el.value === "double" || el.value === "triple") layoutEditor.setStairModel(el.value);
    refreshLayoutInspector(true);
    return;
  }
  if (stairField === "direction" && el instanceof HTMLSelectElement) {
    if (el.value === "east" || el.value === "west" || el.value === "south" || el.value === "north") layoutEditor.setStairDirection(el.value);
    refreshLayoutInspector(true);
    return;
  }
  if (stairField === "axis" && el instanceof HTMLSelectElement) {
    if (el.value === "x" || el.value === "z") layoutEditor.setStairAxis(el.value);
    refreshLayoutInspector(true);
    return;
  }
  if (stairField === "lowerSide" && el instanceof HTMLSelectElement) {
    if (el.value === "min" || el.value === "max") layoutEditor.setStairLowerSide(el.value);
    return;
  }
  const field = el.getAttribute("data-edit-field");
  if (field && el instanceof HTMLInputElement) {
    const value = parseLayoutNumber(el.value);
    if (value === null) {
      toast("请输入有效数字，可用小数点，例如 1.5");
      refreshLayoutInspector(true);
      return;
    }
    const committed = layoutEditor.updateSelectedNumber(field, value);
    // 成功提交由下一帧统一刷新；约束拒绝仍立即回显实际几何。
    if (!committed || !planRedraw.pending) refreshLayoutInspector(true);
  }
});
$("layout-inspector").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const el = event.target;
  if (!(el instanceof HTMLInputElement)) return;
  // 尺寸字段与名称：回车即失焦触发 change 提交。
  if (el.id === "edit-model-name" || el.hasAttribute("data-edit-field")) {
    event.preventDefault();
    el.blur();
  }
});
function layoutEditorTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!el.isContentEditable;
}

document.addEventListener("contextmenu", (event) => {
  const target = event.target as Element | null;
  if (!target?.closest(".plan-canvas-wrap")) return;
  event.preventDefault();
  if (planLoadingTasks || !layoutEditor) return;
  layoutEditor.cancelWallDraft();
  layoutEditor.selection = null;
  layoutEditor.setTool("select");
  lastLayoutEscAt = performance.now();
  syncLayoutPalette();
  refreshLayoutInspector();
});

document.addEventListener(
  "keydown",
  (event) => {
    if (planLoadingTasks || document.querySelector("dialog[open]")) return;
    if (layoutEditorTypingTarget(event.target)) return;
    if (tab === "floor" && planMode === "2d" && drawingView === "floor" && level >= 0 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "v" || key === "h" || key === "m" || key === "f") {
        event.preventDefault();
        if (key === "f") planCanvas?.fit();
        else {
          planCanvas?.setMode(key === "h" ? "pan" : key === "m" ? "measure" : "select");
          if (key === "v") layoutEditor?.setTool("select");
        }
        return;
      }
    }
    if (tab !== "floor" || !layoutEditing || !layoutEditor) return;

    const arrow =
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.code === "ArrowLeft" ||
      event.code === "ArrowRight" ||
      event.code === "ArrowUp" ||
      event.code === "ArrowDown";
    // 捕获阶段拦截方向键，避免工具栏按钮抢走后无法移动选中模型。
    if (arrow && layoutEditor.selections.length) {
      event.preventDefault();
      event.stopPropagation();
      // 世界坐标已是毫米：方向键 1 mm，Shift＋方向键 10 mm。
      const step = event.shiftKey ? 10 : 1;
      const key = event.key.startsWith("Arrow") ? event.key : event.code;
      if (planMode === "3d" && viewer) {
        const right = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
        const up = key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0;
        const delta = viewer.floorNudge(right, up, step);
        layoutEditor.nudgeSelection(delta.x, delta.z);
        return;
      }
      // 门头朝下时平面转 180°（南↑西→）：屏左＝东、屏上＝南，与北上东右相反。
      const s = PLAN_ENTRANCE_DOWN ? -1 : 1;
      if (key === "ArrowLeft") layoutEditor.nudgeSelection(-s * step, 0);
      else if (key === "ArrowRight") layoutEditor.nudgeSelection(s * step, 0);
      else if (key === "ArrowUp") layoutEditor.nudgeSelection(0, -s * step);
      else if (key === "ArrowDown") layoutEditor.nudgeSelection(0, s * step);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveLayoutVersion();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) layoutEditor.redo();
      else layoutEditor.undo();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      layoutEditor.redo();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      layoutEditor.copySelection();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
      event.preventDefault();
      layoutEditor.pasteClipboard();
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      layoutEditor.deleteSelection();
    }
    if (event.key === "Escape") {
      const paramsOpen = !document.getElementById("params-float")?.hidden;
      if (paramsOpen) {
        event.preventDefault();
        event.stopPropagation();
        setParamsPanelOpen(false);
        return;
      }
      event.preventDefault();
      layoutEditor.cancelWallDraft();
      const now = performance.now();
      const doubleEsc = now - lastLayoutEscAt <= LAYOUT_DOUBLE_ESC_MS;
      lastLayoutEscAt = now;
      // 连按两下 Esc：取消选中，工具切回「选择」（与点工具栏选择按钮一致）。
      if (doubleEsc) {
        layoutEditor.selection = null;
        layoutEditor.setTool("select");
        syncLayoutPalette();
        refreshLayoutInspector();
        return;
      }
      if (layoutEditor.selections.length) {
        layoutEditor.selection = null;
        drawPlan();
      }
    }
    if (event.key.toLowerCase() === "r" && layoutEditor.selection?.kind === "furniture") {
      event.preventDefault();
      layoutEditor.rotateSelectedFurniture(event.shiftKey ? -90 : 90);
    }
  },
  true,
);
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
          units: "mm",
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
            roofStyle,
            courtyardFinish: selectedCourtyardFinish("courtyard-finish"),
            neighborCourtyardFinish: selectedCourtyardFinish("neighbor-courtyard-finish"),
            fenShui: Number($<HTMLInputElement>("fen-shui").value),
            villaParams: getVillaParams(),
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
  options: () => ({ fenShui: Number($<HTMLInputElement>("fen-shui").value), roadY: viewer?.roadY ?? surroundings.road.entryY, rampLength: viewer?.rampLength ?? 5000 }),
  navigate: locateDesignIssue, image: () => viewer?.exportImage(), toast,
});
{
  fillVillaParamsDom(DEFAULT_VILLA_PARAMS);
  syncFenShuiInputs(DEFAULT_VILLA_PARAMS.roofFenShui);
  refreshAreaMetrics();
  syncVillaParamsWidthSum();
}
bindParamsInnerTabs();
document.getElementById("open-params-panel")?.addEventListener("click", () => {
  const panel = document.getElementById("params-float");
  setParamsPanelOpen(!!panel?.hidden);
});
document.getElementById("open-params-from-inspector")?.addEventListener("click", () => {
  setParamsPanelOpen(true);
});
document.getElementById("params-float")?.addEventListener("click", (event) => {
  const t = event.target as HTMLElement | null;
  if (t?.closest?.("[data-params-close]")) setParamsPanelOpen(false);
});
document.addEventListener("pointerdown", (event) => {
  const panel = document.getElementById("params-float");
  if (!panel || panel.hidden) return;
  const t = event.target as Element | null;
  if (!t) return;
  if (panel.contains(t)) return;
  if (t.closest("#open-params-panel, #open-params-from-inspector")) return;
  setParamsPanelOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.getElementById("params-float")?.hidden) {
    setParamsPanelOpen(false);
  }
});
window.addEventListener("resize", () => {
  if (!document.getElementById("params-float")?.hidden) positionParamsFloat();
});
$("villa-params-apply").addEventListener("click", () => {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.dataset.villaParam) {
    active.blur();
    sanitizeVillaParamInput(active, true);
  }
  void commitVillaParams(readVillaParamsFromDom(document, { finalize: true }));
});
document.getElementById("scheme-save-current")?.addEventListener("click", () => {
  void saveSchemeCurrent();
});
document.getElementById("scheme-save-version")?.addEventListener("click", () => {
  void saveSizeVersion();
});
document.getElementById("scheme-load-version")?.addEventListener("click", () => {
  void (async () => {
    const select = document.getElementById("scheme-version-select") as HTMLSelectElement | null;
    const file = select?.value;
    if (!file) {
      toast("请先选择一个已保存的尺寸版本");
      return;
    }
    const doc = await loadSizeVersion(file);
    if (!doc) {
      toast("载入尺寸版本失败");
      return;
    }
    await applySizeVersion(doc, { toastMsg: "正在载入尺寸版本…" });
    toast(`已载入尺寸：${doc.title}`);
  })();
});
document.getElementById("scheme-delete-version")?.addEventListener("click", () => {
  void deleteSizeVersion();
});
document.getElementById("layout-delete-version")?.addEventListener("click", () => {
  void deleteLayoutVersion();
});
for (const [id, action] of [["layout-new-version", "new"], ["layout-copy-version", "copy"], ["layout-rename-version", "rename"]] as const) {
  $(id).addEventListener("click", () => openLayoutVersionDialog(action));
}
$("layout-version-form").addEventListener("submit", event => { void submitLayoutVersionDialog(event as SubmitEvent); });
$("layout-version-cancel").addEventListener("click", () => ($("layout-version-dialog") as HTMLDialogElement).close());
$("layout-version-dialog").addEventListener("cancel", event => { if (planLoadingTasks) event.preventDefault(); });
document.getElementById("layout-version-select")?.addEventListener("change", () => {
  const select = $("layout-version-select") as HTMLSelectElement;
  const file = select.value;
  if (!file) return;
  void runLayoutVersionTask("正在载入户型…", async () => {
    try { await selectLayoutVersion(file); }
    catch (error) { select.value = activeLayoutVersionFile; throw error; }
  });
});
$("villa-params-reset").addEventListener("click", () => {
  void resetSchemeToInitial();
});
document.getElementById("villa-params-scroll")?.addEventListener("input", (event) => {
  const input = (event.target as HTMLElement | null)?.closest?.("input[data-villa-param]") as HTMLInputElement | null;
  if (input) sanitizeVillaParamInput(input, false);
  syncVillaParamsWidthSum();
  const fen = document.querySelector<HTMLInputElement>('[data-villa-param="roofFenShui"]');
  if (fen && document.activeElement === fen) {
    const fenValue = Number(fen.value);
    if (Number.isFinite(fenValue)) syncFenShuiInputs(fenValue);
  }
});
document.getElementById("villa-params-scroll")?.addEventListener("blur", (event) => {
  const input = (event.target as HTMLElement | null)?.closest?.("input[data-villa-param]") as HTMLInputElement | null;
  if (!input) return;
  sanitizeVillaParamInput(input, true);
  syncVillaParamsWidthSum();
}, true);
planCanvas = new PlanCanvas($("plan-drawing"), {
  active: () => tab === "floor" && planMode === "2d" && drawingView === "floor" && level >= 0,
  selecting: () => !layoutEditing || layoutEditor?.tool === "select",
  clearSelection: () => layoutEditor?.selectObject(null),
  viewChanged: percent => {
    if (planMode === "2d") $("plan-zoom-reset").textContent = `${percent}%`;
    positionLayoutInspector();
  },
});
renderFacts();
drawPlan();
updateFenShui();
const clear = diningClearance();
$("dining-warning").textContent =
  `按当前拉椅包络，西侧余量${formatMm(clear.west)} mm、北侧${formatMm(clear.north)} mm；东侧仅${formatMm(clear.east)} mm。两桌拉椅包络局部相交，满座上菜需错让。`;

// 先载入方案并对齐 site（含门厅居中），再创建 3D。
// 否则首帧用 data.ts 占位，方案应用后门厅会左右弹一下再回正。
{
  let boot = await loadCurrentScheme();
  if (!boot) {
    const legacy = migrateLegacyLocalStorage();
    if (legacy) {
      boot = { ...resetSchemeDocument(), ...legacy, schema: "anhua-villa-scheme-v1", id: "current", title: "从浏览器缓存迁移", savedAt: formatSavedAt() };
      const migrated = await persistSchemeFile("current", boot as SchemeDocument);
      setSchemeStatus(migrated.message);
      toast("已将浏览器旧缓存迁到方案文件，请确认后点「保存到文件」");
    }
  }
  clearLegacyLocalStorage();
  if (boot) {
    await applySchemeDocument(boot);
  } else {
    applyVillaParams(DEFAULT_VILLA_PARAMS);
    fillVillaParamsDom(DEFAULT_VILLA_PARAMS, document, { force: true });
    setSchemeStatus("使用初始化默认值；改完请「保存到文件」写入 public/scheme/current.json");
  }
  await refreshSizeVersionSelect();
  await refreshLayoutVersionSelect();
  // 首次打开载入目录第一项；视图切换不重载，保留用户正在编辑的内容。
  const first = layoutVersionsIndex.versions[0];
  if (first) {
    try { await selectLayoutVersion(first.file, true); }
    catch (error) { toast(error instanceof Error ? error.message : "默认户型载入失败"); }
  }
}

await new Promise((resolve) => requestAnimationFrame(resolve));
try {
  viewer = new VillaViewer($("viewport"));
  layoutScene = new LayoutScene(viewer, {
    active: () => tab === "floor" && planMode === "3d",
    floor: () => Math.max(0, level),
    draft: currentLayoutDraft,
    editor: () => layoutEditing ? layoutEditor : null,
    beginEditing: () => {
      if (!layoutEditing) {
        setLayoutEditing(true);
        layoutEditor?.setTool("select");
      }
      return layoutEditor;
    },
    placed: () => {
      $("plan-panel").classList.remove("designer-hide-furniture");
      document.querySelector('[data-designer-layer="furniture"]')?.setAttribute("aria-pressed", "true");
      syncLayoutPalette();
      drawPlan();
    },
    toast,
    layers: () => ({
      furniture: !$("plan-panel").classList.contains("designer-hide-furniture"),
      labels: !$("plan-panel").classList.contains("designer-hide-labels"),
      grid: $("plan-panel").classList.contains("designer-grid"),
    }),
  });
  sceneParamsKey = JSON.stringify(getVillaParams());
  viewer.onCompass = (angle) =>
    $("compass-arrow").setAttribute(
      "transform",
      `rotate(${(angle * 180) / Math.PI} 26 26)`,
    );
  viewer.onContextLoss = () => {
    $("loading").hidden = false;
    $("loading").classList.add("is-error");
    $("loading").setAttribute("aria-busy", "false");
    $("loading").innerHTML =
      "<strong>图形上下文已中断</strong><p>请刷新页面恢复3D；仍可查看分层平面与资料。</p>";
  };
  updateSun();
  updateRamp();
  // 已有布局草稿时立体与平面一致（挑空边栏杆由家具「栏杆」自画）
  await applyLayoutDraftTo3d();
  updateScene();
  const initialView = new URLSearchParams(location.search).get("view");
  if (initialView === "garage") setCamera("garage");
  $("loading").hidden = true;
} catch (error) {
  console.error(error);
  $("loading").classList.add("is-error");
  $("loading").setAttribute("aria-busy", "false");
  $("loading").innerHTML =
    "<strong>当前环境未能启动3D</strong><p>请在支持WebGL2的浏览器打开。分层平面与资料仍可查看。</p>";
  toast("3D加载失败，平面图与资料可以继续查看。");
}
const initialTab = new URLSearchParams(location.search).get("tab");
if (initialTab && ["model", "floor", "sun", "sources", "real", "design", "originals"].includes(initialTab)) switchTab(initialTab);
